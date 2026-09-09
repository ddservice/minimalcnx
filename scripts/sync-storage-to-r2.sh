#!/usr/bin/env bash
#
# sync-storage-to-r2.sh — สำรองไฟล์ใน Supabase Storage (bucket evidence = รูปหลักฐานแก้วฟรี)
# ขึ้น Cloudflare R2 แบบเข้ารหัส
#
#   bash scripts/sync-storage-to-r2.sh            # ซิงค์เฉพาะไฟล์ที่ยังไม่เคยขึ้น R2
#   bash scripts/sync-storage-to-r2.sh --dry-run  # บอกว่าจะทำอะไรบ้าง ไม่แตะ R2
#
# pg_dump ใน backup-to-r2.sh ได้แค่ metadata ในตาราง storage.objects ไม่ได้ตัวไฟล์
# ถ้าไม่รันไฟล์นี้ = กู้ฐานข้อมูลกลับมาแล้วลิงก์รูปหลักฐานเสียทั้งหมด
#
# ชื่อไฟล์ใน bucket มี timestamp อยู่แล้ว (free_cups/{date}_{ts}.{ext}) = ไม่ถูกเขียนทับ
# เลยข้ามไฟล์ที่มีบน R2 แล้วได้เลย ไม่ต้องดาวน์โหลดซ้ำทุกคืน

set -Eeuo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${BACKUP_ENV_FILE:-$HERE/../.backup.env}"
[ -f "$ENV_FILE" ] && set -a && . "$ENV_FILE" && set +a

: "${SUPABASE_DB_URL:?ต้องตั้ง SUPABASE_DB_URL}"
: "${R2_BUCKET:?ต้องตั้ง R2_BUCKET}"
: "${R2_ENDPOINT:?ต้องตั้ง R2_ENDPOINT}"
: "${AWS_ACCESS_KEY_ID:?ต้องตั้ง AWS_ACCESS_KEY_ID}"
: "${AWS_SECRET_ACCESS_KEY:?ต้องตั้ง AWS_SECRET_ACCESS_KEY}"
: "${BACKUP_AGE_RECIPIENT:?ต้องตั้ง BACKUP_AGE_RECIPIENT}"

export AWS_DEFAULT_REGION="${AWS_DEFAULT_REGION:-auto}"
export AWS_REQUEST_CHECKSUM_CALCULATION="${AWS_REQUEST_CHECKSUM_CALCULATION:-when_required}"
export AWS_RESPONSE_CHECKSUM_VALIDATION="${AWS_RESPONSE_CHECKSUM_VALIDATION:-when_required}"

PG_IMAGE="${PG_IMAGE:-postgres:17-alpine}"
PREFIX="${R2_PREFIX:-minimalcnx}"
BUCKET="${STORAGE_BUCKET:-evidence}"
DRY_RUN=0
[ "${1:-}" = "--dry-run" ] && DRY_RUN=1

WORK="$(mktemp -d)"
log()  { printf '[%s] %s\n' "$(date -u +%H:%M:%SZ)" "$*"; }
warn() { printf '[%s] !!  %s\n' "$(date -u +%H:%M:%SZ)" "$*" >&2; }
fail() { printf '[%s] XX  %s\n' "$(date -u +%H:%M:%SZ)" "$*" >&2; exit 1; }
trap 'rm -rf "$WORK"' EXIT
trap 'fail "ล้มเหลวที่บรรทัด $LINENO"' ERR

for c in docker age aws curl; do
  command -v "$c" >/dev/null 2>&1 || fail "ไม่พบคำสั่ง $c — ดูวิธีติดตั้งใน deploy/BACKUP.md"
done

# ต้องมี URL ของ Storage API ไม่ใช่แค่ connection string ของ Postgres
# ถ้าไม่ได้ตั้งไว้ ลองแกะ project ref จาก SUPABASE_DB_URL ให้
if [ -z "${SUPABASE_URL:-}" ]; then
  REF="$(printf '%s' "$SUPABASE_DB_URL" | sed -n 's#^postgres\(ql\)\?://postgres\.\([a-z0-9]\{16,\}\):.*#\2#p')"
  [ -n "$REF" ] || REF="$(printf '%s' "$SUPABASE_DB_URL" | sed -n 's#.*@db\.\([a-z0-9]\{16,\}\)\.supabase\.co.*#\1#p')"
  [ -n "$REF" ] || fail "แกะ project ref จาก SUPABASE_DB_URL ไม่ออก — ตั้ง SUPABASE_URL='https://<ref>.supabase.co' ใน .backup.env"
  SUPABASE_URL="https://$REF.supabase.co"
fi
log "Storage API: $SUPABASE_URL / bucket $BUCKET"

log "ตรวจสอบรายการไฟล์ใน Supabase Storage..."
OBJECTS="$(docker run --rm -e PGCONNECT_TIMEOUT=30 "$PG_IMAGE" psql "$SUPABASE_DB_URL" -tAc "
  select name from storage.objects where bucket_id = '$BUCKET' order by name;
" | grep -v '^$' || true)"

COUNT="$(printf '%s\n' "$OBJECTS" | grep -c . || true)"
if [ "${COUNT:-0}" -eq 0 ]; then
  log "ไม่มีไฟล์ใน storage bucket '$BUCKET' ให้ซิงค์"
  exit 0
fi
log "พบ $COUNT ไฟล์ — เริ่มซิงค์"

# ดึงรายชื่อที่มีบน R2 แล้วครั้งเดียว แทนที่จะ head-object ทีละไฟล์ (ประหยัด request มาก)
EXISTING="$(aws s3 ls "s3://$R2_BUCKET/$PREFIX/storage/$BUCKET/" --recursive \
  --endpoint-url "$R2_ENDPOINT" 2>/dev/null | awk '{print $4}' || true)"

UPLOADED=0; SKIPPED=0; FAILED=0
while IFS= read -r name; do
  [ -n "$name" ] || continue
  KEY="$PREFIX/storage/$BUCKET/$name.age"

  if printf '%s\n' "$EXISTING" | grep -qxF "$KEY"; then
    SKIPPED=$((SKIPPED + 1)); continue
  fi
  case "$name" in
    *[[:space:]]*) warn "ข้าม '$name' — ชื่อไฟล์มีช่องว่าง ต้อง url-encode ก่อน"; FAILED=$((FAILED + 1)); continue ;;
  esac

  if [ "$DRY_RUN" = "1" ]; then
    echo "  จะอัป: $name → r2://$R2_BUCKET/$KEY"
    UPLOADED=$((UPLOADED + 1)); continue
  fi

  # bucket เป็น public จึงโหลดผ่าน /object/public ได้โดยไม่ต้องใช้ key
  if ! curl -fsSL --max-time 120 -o "$WORK/blob" "$SUPABASE_URL/storage/v1/object/public/$BUCKET/$name"; then
    warn "ดาวน์โหลดไม่สำเร็จ: $name"; FAILED=$((FAILED + 1)); continue
  fi
  [ -s "$WORK/blob" ] || { warn "ไฟล์ว่าง: $name"; FAILED=$((FAILED + 1)); continue; }

  # เข้ารหัสก่อนออกจากเครื่องเหมือน dump ฐานข้อมูล — รูปหลักฐานเป็นเอกสารของร้าน
  # ที่ผูกกับยอดขายรายวัน ไม่ควรวางดิบบน object storage
  age -r "$BACKUP_AGE_RECIPIENT" -o "$WORK/blob.age" "$WORK/blob" || { warn "เข้ารหัสไม่สำเร็จ: $name"; FAILED=$((FAILED + 1)); continue; }

  if aws s3 cp "$WORK/blob.age" "s3://$R2_BUCKET/$KEY" \
       --endpoint-url "$R2_ENDPOINT" --only-show-errors; then
    UPLOADED=$((UPLOADED + 1))
  else
    warn "อัปโหลดไม่สำเร็จ: $name"; FAILED=$((FAILED + 1))
  fi
  rm -f "$WORK/blob" "$WORK/blob.age"
done <<< "$OBJECTS"

log "อัปใหม่ $UPLOADED / มีอยู่แล้ว $SKIPPED / พลาด $FAILED (ทั้งหมด $COUNT)"
[ "$FAILED" -eq 0 ] || fail "มีไฟล์ที่ซิงค์ไม่สำเร็จ $FAILED ไฟล์"
log "ซิงค์ Storage เสร็จสิ้น"
