#!/usr/bin/env bash
#
# backup-to-r2.sh — สำรอง Supabase Postgres ไป Cloudflare R2 (off-site, เข้ารหัส)
#
# รันบน VPS ผ่าน cron วันละครั้ง — ดูวิธีตั้งค่าที่ deploy/BACKUP.md
#
#   bash scripts/backup-to-r2.sh              # สำรองปกติ
#   bash scripts/backup-to-r2.sh --check      # เช็คว่าเครื่องมือ/ตัวแปรครบไหม แล้วออก
#
# ออกแบบให้ "ล้มแล้วรู้" — ทุกขั้นตรวจผลจริง ไม่ใช่แค่ปล่อยผ่าน
# เพราะ backup ที่ล้มเงียบๆ แย่กว่าไม่มี backup (เพราะเราคิดว่ามี)

set -Eeuo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${BACKUP_ENV_FILE:-$HERE/../.backup.env}"
[ -f "$ENV_FILE" ] && set -a && . "$ENV_FILE" && set +a

: "${SUPABASE_DB_URL:?ต้องตั้ง SUPABASE_DB_URL (session pooler หรือ direct connection — ห้ามใช้ transaction pooler)}"
: "${R2_BUCKET:?ต้องตั้ง R2_BUCKET}"
: "${R2_ENDPOINT:?ต้องตั้ง R2_ENDPOINT เช่น https://<account_id>.r2.cloudflarestorage.com}"
: "${AWS_ACCESS_KEY_ID:?ต้องตั้ง AWS_ACCESS_KEY_ID (R2 Access Key ID)}"
: "${AWS_SECRET_ACCESS_KEY:?ต้องตั้ง AWS_SECRET_ACCESS_KEY (R2 Secret Access Key)}"
: "${BACKUP_AGE_RECIPIENT:?ต้องตั้ง BACKUP_AGE_RECIPIENT (public key ของ age) — ห้ามอัปข้อมูลลูกค้าแบบไม่เข้ารหัส}"

# R2 ไม่มี region จริงแต่ aws cli บังคับต้องมี — ไม่ตั้งแล้วจะฟ้อง "You must specify a region"
export AWS_DEFAULT_REGION="${AWS_DEFAULT_REGION:-auto}"
# aws cli v2 ตั้งแต่ 2.23 แนบ CRC32 checksum ไปทุก request ซึ่ง R2 ปฏิเสธ (ล้มแบบ error งงๆ)
# ตัวแปรนี้สั่งให้แนบเฉพาะตอนจำเป็น — v1 ไม่รู้จักตัวแปรนี้ ใส่ไว้ก็ไม่มีผลข้างเคียง
export AWS_REQUEST_CHECKSUM_CALCULATION="${AWS_REQUEST_CHECKSUM_CALCULATION:-when_required}"
export AWS_RESPONSE_CHECKSUM_VALIDATION="${AWS_RESPONSE_CHECKSUM_VALIDATION:-when_required}"

PG_IMAGE="${PG_IMAGE:-postgres:17-alpine}"
PREFIX="${R2_PREFIX:-minimalcnx}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DAY="$(date -u +%Y-%m-%d)"
WORK="$(mktemp -d)"
DUMP="$WORK/minimalcnx-$STAMP.dump"
ENC="$DUMP.age"
KEY="$PREFIX/daily/$DAY/minimalcnx-$STAMP.dump.age"

log()  { printf '[%s] %s\n' "$(date -u +%H:%M:%SZ)" "$*"; }
fail() { printf '[%s] ❌ %s\n' "$(date -u +%H:%M:%SZ)" "$*" >&2; exit 1; }
trap 'rm -rf "$WORK"' EXIT
trap 'fail "ล้มเหลวที่บรรทัด $LINENO"' ERR

need() { command -v "$1" >/dev/null 2>&1 || fail "ไม่พบคำสั่ง $1 — ดูวิธีติดตั้งใน deploy/BACKUP.md"; }
need docker
need age
need aws

# transaction pooler (พอร์ต 6543) ใช้ pg_dump ไม่ได้ — มันต้องการ session state + snapshot
# ที่คงที่ตลอดการ dump ซึ่ง transaction mode ไม่รับประกันให้
case "$SUPABASE_DB_URL" in
  *:6543*) fail "SUPABASE_DB_URL ชี้ไป transaction pooler (:6543) — pg_dump ใช้ไม่ได้ ต้องใช้ session pooler (:5432) หรือ direct connection" ;;
esac

# psql/pg_dump ที่ได้สตริงซึ่งไม่ใช่ URI จะตีความว่าเป็น "ชื่อฐานข้อมูล" แล้วเงียบๆ ไปต่อ socket
# ในเครื่องแทน — error ที่ได้จะพูดถึง /var/run/postgresql ซึ่งชวนให้ไล่ผิดทางไปไกลมาก
case "$SUPABASE_DB_URL" in
  postgresql://*|postgres://*) : ;;
  *) fail "SUPABASE_DB_URL ต้องขึ้นต้นด้วย postgresql:// — คัดลอกมาจาก Supabase → Project Settings → Database → Connection string → URI (เลือก Session pooler พอร์ต 5432) และถ้ารหัสผ่านมีอักขระพิเศษอย่าง @ # ? / ต้อง percent-encode ก่อน" ;;
esac

if [ "${1:-}" = "--check" ]; then
  log "เครื่องมือครบ และตัวแปรครบทุกตัว"
  log "ทดสอบต่อ Postgres..."
  docker run --rm -e PGCONNECT_TIMEOUT=15 "$PG_IMAGE" \
    psql "$SUPABASE_DB_URL" -tAc 'select current_database(), version();' \
    || fail "ต่อฐานข้อมูลไม่ได้ — เช็ค SUPABASE_DB_URL"
  log "ทดสอบเขียน R2..."
  echo ok | aws s3 cp - "s3://$R2_BUCKET/$PREFIX/.healthcheck" --endpoint-url "$R2_ENDPOINT" >/dev/null \
    || fail "เขียน R2 ไม่ได้ — เช็ค token/bucket/endpoint"
  log "✅ พร้อมใช้งาน"
  exit 0
fi

# ── 1) dump ────────────────────────────────────────────────────
# ใช้ pg_dump จาก docker image ให้ major version ตรงกับเซิร์ฟเวอร์ — pg_dump ที่เก่ากว่า
# เซิร์ฟเวอร์จะปฏิเสธทำงานทันที และของที่ติดมากับ VPS มักเป็นคนละเวอร์ชัน
# -Fc = custom format (บีบอัดในตัว + restore ทีละตารางได้)
log "กำลัง dump ฐานข้อมูล..."
docker run --rm -e PGCONNECT_TIMEOUT=30 -v "$WORK:/out" "$PG_IMAGE" \
  pg_dump "$SUPABASE_DB_URL" \
    --format=custom \
    --no-owner --no-privileges \
    --schema=public --schema=storage \
    --file="/out/$(basename "$DUMP")" \
  || fail "pg_dump ล้มเหลว"

[ -s "$DUMP" ] || fail "ไฟล์ dump ว่างเปล่า"
SIZE=$(stat -c %s "$DUMP" 2>/dev/null || stat -f %z "$DUMP")
[ "$SIZE" -gt 20480 ] || fail "ไฟล์ dump เล็กผิดปกติ ($SIZE bytes) — น่าจะ dump ไม่ครบ"
log "dump สำเร็จ ($((SIZE / 1024)) KB)"

# ── 2) เข้ารหัส ────────────────────────────────────────────────
# ข้างในมีเบอร์โทรลูกค้าทั้งฐาน + เลขบัตรประชาชน/เลขบัญชีธนาคารพนักงาน (business_config.emp_details)
# + เลขผู้เสียภาษีใน form50_payees — เป็นข้อมูลส่วนบุคคลตาม PDPA เต็มๆ ห้ามวางดิบบน object storage
log "กำลังเข้ารหัส..."
age -r "$BACKUP_AGE_RECIPIENT" -o "$ENC" "$DUMP" || fail "เข้ารหัสล้มเหลว"
[ -s "$ENC" ] || fail "ไฟล์ที่เข้ารหัสว่างเปล่า"
rm -f "$DUMP"

# ── 3) อัปขึ้น R2 ──────────────────────────────────────────────
log "กำลังอัปโหลดไป r2://$R2_BUCKET/$KEY ..."
aws s3 cp "$ENC" "s3://$R2_BUCKET/$KEY" \
  --endpoint-url "$R2_ENDPOINT" \
  --only-show-errors \
  || fail "อัปโหลดล้มเหลว"

# ── 4) ตรวจว่าไฟล์อยู่จริงและขนาดตรง ───────────────────────────
# ไม่เชื่อ exit code อย่างเดียว — ถามกลับว่าไฟล์อยู่บน R2 จริงไหมและขนาดเท่ากันไหม
LOCAL_SIZE=$(stat -c %s "$ENC" 2>/dev/null || stat -f %z "$ENC")
REMOTE_SIZE=$(aws s3api head-object --bucket "$R2_BUCKET" --key "$KEY" \
  --endpoint-url "$R2_ENDPOINT" --query ContentLength --output text) \
  || fail "อัปโหลดแล้วแต่หาไฟล์บน R2 ไม่เจอ"
[ "$LOCAL_SIZE" = "$REMOTE_SIZE" ] \
  || fail "ขนาดไฟล์บน R2 ไม่ตรงกับต้นทาง ($REMOTE_SIZE != $LOCAL_SIZE)"

# ── 5) สำเนารายเดือน (เก็บยาว) ─────────────────────────────────
# lifecycle rule ของ R2 ลบ daily/ ตามอายุ แต่ monthly/ เก็บไว้ยาว — วันที่ 1 ของเดือนทำสำเนาเพิ่ม
if [ "$(date -u +%d)" = "01" ]; then
  MKEY="$PREFIX/monthly/$(date -u +%Y-%m)/minimalcnx-$STAMP.dump.age"
  aws s3 cp "s3://$R2_BUCKET/$KEY" "s3://$R2_BUCKET/$MKEY" \
    --endpoint-url "$R2_ENDPOINT" --only-show-errors \
    && log "ทำสำเนารายเดือนไว้ที่ $MKEY"
fi

log "✅ สำรองข้อมูลสำเร็จ — $((LOCAL_SIZE / 1024)) KB → $KEY"
