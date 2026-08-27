#!/usr/bin/env bash
#
# restore-from-r2.sh — ดึง backup กลับมา restore ลง Postgres เปล่าๆ เพื่อ "พิสูจน์ว่า backup ใช้ได้จริง"
#
#   bash scripts/restore-from-r2.sh --list                 # ดูรายการ backup ที่มี
#   bash scripts/restore-from-r2.sh --drill                # ซ้อมกู้ล่าสุดลง container ชั่วคราว (ปลอดภัย)
#   bash scripts/restore-from-r2.sh --key <r2-key> --drill
#
# ⚠️ สคริปต์นี้ "ไม่" restore ทับฐานข้อมูลจริงให้ โดยตั้งใจ — การกู้ของจริงต้องทำด้วยมือ
#    หลังตัดสินใจแล้วว่าจะทับอะไร (ดูขั้นตอนใน deploy/BACKUP.md)
#
# ทำทุกไตรมาส: backup ที่ไม่เคย restore ไม่นับเป็น backup

set -Eeuo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${BACKUP_ENV_FILE:-$HERE/../.backup.env}"
[ -f "$ENV_FILE" ] && set -a && . "$ENV_FILE" && set +a

: "${R2_BUCKET:?ต้องตั้ง R2_BUCKET}"
: "${R2_ENDPOINT:?ต้องตั้ง R2_ENDPOINT}"
: "${AWS_ACCESS_KEY_ID:?ต้องตั้ง AWS_ACCESS_KEY_ID}"
: "${AWS_SECRET_ACCESS_KEY:?ต้องตั้ง AWS_SECRET_ACCESS_KEY}"

export AWS_DEFAULT_REGION="${AWS_DEFAULT_REGION:-auto}"
export AWS_REQUEST_CHECKSUM_CALCULATION="${AWS_REQUEST_CHECKSUM_CALCULATION:-when_required}"
export AWS_RESPONSE_CHECKSUM_VALIDATION="${AWS_RESPONSE_CHECKSUM_VALIDATION:-when_required}"

PG_IMAGE="${PG_IMAGE:-postgres:17-alpine}"
PREFIX="${R2_PREFIX:-minimalcnx}"
KEY=""
DRILL=0
TARGET_TABLE=""

while [ $# -gt 0 ]; do
  case "$1" in
    --list)
      aws s3 ls "s3://$R2_BUCKET/$PREFIX/" --recursive --endpoint-url "$R2_ENDPOINT" | sort
      exit 0 ;;
    --key)   KEY="$2"; shift 2 ;;
    --drill) DRILL=1; shift ;;
    --table) TARGET_TABLE="$2"; shift 2 ;;
    *) echo "ไม่รู้จักตัวเลือก: $1" >&2; exit 1 ;;
  esac
done

[ "$DRILL" = "1" ] || { echo "ต้องระบุ --drill (สคริปต์นี้ไม่ restore ทับของจริงให้)" >&2; exit 1; }
: "${BACKUP_AGE_KEYFILE:?ต้องตั้ง BACKUP_AGE_KEYFILE (ไฟล์ private key ของ age)}"

log()  { printf '[%s] %s\n' "$(date -u +%H:%M:%SZ)" "$*"; }
fail() { printf '[%s] ❌ %s\n' "$(date -u +%H:%M:%SZ)" "$*" >&2; exit 1; }

WORK="$(mktemp -d)"
CONTAINER="minimalcnx-restore-drill-$$"
cleanup() { docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT

if [ -z "$KEY" ]; then
  KEY="$(aws s3 ls "s3://$R2_BUCKET/$PREFIX/daily/" --recursive --endpoint-url "$R2_ENDPOINT" \
        | sort | tail -1 | awk '{print $4}')"
  [ -n "$KEY" ] || fail "ไม่พบ backup ใน r2://$R2_BUCKET/$PREFIX/daily/"
fi
log "จะกู้จาก: $KEY"

aws s3 cp "s3://$R2_BUCKET/$KEY" "$WORK/backup.age" --endpoint-url "$R2_ENDPOINT" --only-show-errors \
  || fail "ดาวน์โหลดไม่สำเร็จ"
age -d -i "$BACKUP_AGE_KEYFILE" -o "$WORK/backup.dump" "$WORK/backup.age" \
  || fail "ถอดรหัสไม่สำเร็จ — private key ไม่ตรงกับตอนเข้ารหัส"
log "ถอดรหัสแล้ว ($(( $(stat -c %s "$WORK/backup.dump" 2>/dev/null || stat -f %z "$WORK/backup.dump") / 1024 )) KB)"

log "ยก Postgres ชั่วคราวขึ้นมา (ไม่ผูกพอร์ตออกนอกเครื่อง)..."
docker run -d --name "$CONTAINER" -e POSTGRES_PASSWORD=drill "$PG_IMAGE" >/dev/null
for _ in $(seq 1 30); do
  docker exec "$CONTAINER" pg_isready -U postgres -h localhost >/dev/null 2>&1 && break
  sleep 1
done
docker exec "$CONTAINER" pg_isready -U postgres -h localhost >/dev/null 2>&1 || fail "Postgres ชั่วคราวไม่ขึ้น"

# สร้าง schema และ extension ที่ Supabase ใช้งาน เพื่อให้ restore ได้สมบูรณ์
docker exec "$CONTAINER" psql -U postgres -d postgres -h localhost -c "
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE EXTENSION IF NOT EXISTS \"uuid-ossp\" SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS \"pgcrypto\" SCHEMA extensions;
" >/dev/null 2>&1 || true

docker cp "$WORK/backup.dump" "$CONTAINER:/tmp/backup.dump"

if [ -n "$TARGET_TABLE" ]; then
  log "กำลัง restore เฉพาะตาราง: $TARGET_TABLE ..."
  docker exec "$CONTAINER" pg_restore -U postgres -d postgres -h localhost --no-owner --no-privileges -t "$TARGET_TABLE" /tmp/backup.dump \
    2> "$WORK/restore.err" || log "⚠️ pg_restore มี warning — ดูสรุปด้านล่าง"
  echo
  log "จำนวนแถวที่กู้มาได้ในตาราง $TARGET_TABLE:"
  docker exec "$CONTAINER" psql -U postgres -d postgres -h localhost -tA -c "
    select '$TARGET_TABLE = ' || count(*) from public.$TARGET_TABLE;
  " || fail "กู้มาแล้วแต่ query ไม่ได้ — ตารางอาจไม่มีอยู่ใน dump"
else
  log "กำลัง restore..."
  docker exec "$CONTAINER" pg_restore -U postgres -d postgres -h localhost --no-owner --no-privileges /tmp/backup.dump \
    2> "$WORK/restore.err" || log "⚠️ pg_restore มี warning (ปกติสำหรับ extension/role ของ Supabase) — ดูสรุปด้านล่าง"

  echo
  log "จำนวนแถวที่กู้มาได้:"
  docker exec "$CONTAINER" psql -U postgres -d postgres -h localhost -tA -c "
    select 'sales_daily        = ' || count(*) from public.sales_daily
    union all select 'expenses           = ' || count(*) from public.expenses
    union all select 'profiles           = ' || count(*) from public.profiles
    union all select 'business_config    = ' || count(*) from public.business_config
    union all select 'customers          = ' || count(*) from public.customers
    union all select 'point_transactions = ' || count(*) from public.point_transactions;
  " || fail "กู้มาแล้วแต่ query ไม่ได้ — backup ใช้ไม่ได้จริง"
fi

echo
log "✅ ซ้อมกู้สำเร็จ — ตัวเลขข้างบนต้องใกล้เคียงของจริง ถ้าเป็น 0 หมดแปลว่า backup มีปัญหา"
log "   (container ชั่วคราวถูกลบอัตโนมัติแล้ว)"
