#!/usr/bin/env bash
#
# restore-from-r2.sh โ€” เธ”เธถเธ backup เธเธฅเธฑเธเธกเธฒ restore เธฅเธ Postgres เน€เธเธฅเนเธฒเน เน€เธเธทเนเธญ "เธเธดเธชเธนเธเธเนเธงเนเธฒ backup เนเธเนเนเธ”เนเธเธฃเธดเธ"
#
#   bash scripts/restore-from-r2.sh --list                 # เธ”เธนเธฃเธฒเธขเธเธฒเธฃ backup เธ—เธตเนเธกเธต
#   bash scripts/restore-from-r2.sh --drill                # เธเนเธญเธกเธเธนเนเธฅเนเธฒเธชเธธเธ”เธฅเธ container เธเธฑเนเธงเธเธฃเธฒเธง (เธเธฅเธญเธ”เธ เธฑเธข)
#   bash scripts/restore-from-r2.sh --key <r2-key> --drill
#
# โ ๏ธ เธชเธเธฃเธดเธเธ•เนเธเธตเน "เนเธกเน" restore เธ—เธฑเธเธเธฒเธเธเนเธญเธกเธนเธฅเธเธฃเธดเธเนเธซเน เนเธ”เธขเธ•เธฑเนเธเนเธ โ€” เธเธฒเธฃเธเธนเนเธเธญเธเธเธฃเธดเธเธ•เนเธญเธเธ—เธณเธ”เนเธงเธขเธกเธทเธญ
#    เธซเธฅเธฑเธเธ•เธฑเธ”เธชเธดเธเนเธเนเธฅเนเธงเธงเนเธฒเธเธฐเธ—เธฑเธเธญเธฐเนเธฃ (เธ”เธนเธเธฑเนเธเธ•เธญเธเนเธ deploy/BACKUP.md)
#
# เธ—เธณเธ—เธธเธเนเธ•เธฃเธกเธฒเธช: backup เธ—เธตเนเนเธกเนเน€เธเธข restore เนเธกเนเธเธฑเธเน€เธเนเธ backup

set -Eeuo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${BACKUP_ENV_FILE:-$HERE/../.backup.env}"
[ -f "$ENV_FILE" ] && set -a && . "$ENV_FILE" && set +a

: "${R2_BUCKET:?เธ•เนเธญเธเธ•เธฑเนเธ R2_BUCKET}"
: "${R2_ENDPOINT:?เธ•เนเธญเธเธ•เธฑเนเธ R2_ENDPOINT}"
: "${AWS_ACCESS_KEY_ID:?เธ•เนเธญเธเธ•เธฑเนเธ AWS_ACCESS_KEY_ID}"
: "${AWS_SECRET_ACCESS_KEY:?เธ•เนเธญเธเธ•เธฑเนเธ AWS_SECRET_ACCESS_KEY}"

export AWS_DEFAULT_REGION="${AWS_DEFAULT_REGION:-auto}"
export AWS_REQUEST_CHECKSUM_CALCULATION="${AWS_REQUEST_CHECKSUM_CALCULATION:-when_required}"
export AWS_RESPONSE_CHECKSUM_VALIDATION="${AWS_RESPONSE_CHECKSUM_VALIDATION:-when_required}"

PG_IMAGE="${PG_IMAGE:-postgres:17-alpine}"
PREFIX="${R2_PREFIX:-minimalcnx}"
KEY=""
DRILL=0

while [ $# -gt 0 ]; do
  case "$1" in
    --list)
      aws s3 ls "s3://$R2_BUCKET/$PREFIX/" --recursive --endpoint-url "$R2_ENDPOINT" | sort
      exit 0 ;;
    --key)   KEY="$2"; shift 2 ;;
    --drill) DRILL=1; shift ;;
    *) echo "เนเธกเนเธฃเธนเนเธเธฑเธเธ•เธฑเธงเน€เธฅเธทเธญเธ: $1" >&2; exit 1 ;;
  esac
done

[ "$DRILL" = "1" ] || { echo "เธ•เนเธญเธเธฃเธฐเธเธธ --drill (เธชเธเธฃเธดเธเธ•เนเธเธตเนเนเธกเน restore เธ—เธฑเธเธเธญเธเธเธฃเธดเธเนเธซเน)" >&2; exit 1; }
: "${BACKUP_AGE_KEYFILE:?เธ•เนเธญเธเธ•เธฑเนเธ BACKUP_AGE_KEYFILE (เนเธเธฅเน private key เธเธญเธ age)}"

log()  { printf '[%s] %s\n' "$(date -u +%H:%M:%SZ)" "$*"; }
fail() { printf '[%s] โ %s\n' "$(date -u +%H:%M:%SZ)" "$*" >&2; exit 1; }

WORK="$(mktemp -d)"
CONTAINER="minimalcnx-restore-drill-$$"
cleanup() { docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT

if [ -z "$KEY" ]; then
  KEY="$(aws s3 ls "s3://$R2_BUCKET/$PREFIX/daily/" --recursive --endpoint-url "$R2_ENDPOINT" \
        | sort | tail -1 | awk '{print $4}')"
  [ -n "$KEY" ] || fail "เนเธกเนเธเธ backup เนเธ r2://$R2_BUCKET/$PREFIX/daily/"
fi
log "เธเธฐเธเธนเนเธเธฒเธ: $KEY"

aws s3 cp "s3://$R2_BUCKET/$KEY" "$WORK/backup.age" --endpoint-url "$R2_ENDPOINT" --only-show-errors \
  || fail "เธ”เธฒเธงเธเนเนเธซเธฅเธ”เนเธกเนเธชเธณเน€เธฃเนเธ"
age -d -i "$BACKUP_AGE_KEYFILE" -o "$WORK/backup.dump" "$WORK/backup.age" \
  || fail "เธ–เธญเธ”เธฃเธซเธฑเธชเนเธกเนเธชเธณเน€เธฃเนเธ โ€” private key เนเธกเนเธ•เธฃเธเธเธฑเธเธ•เธญเธเน€เธเนเธฒเธฃเธซเธฑเธช"
log "เธ–เธญเธ”เธฃเธซเธฑเธชเนเธฅเนเธง ($(( $(stat -c %s "$WORK/backup.dump" 2>/dev/null || stat -f %z "$WORK/backup.dump") / 1024 )) KB)"

log "เธขเธ Postgres เธเธฑเนเธงเธเธฃเธฒเธงเธเธถเนเธเธกเธฒ (เนเธกเนเธเธนเธเธเธญเธฃเนเธ•เธญเธญเธเธเธญเธเน€เธเธฃเธทเนเธญเธ)..."
docker run -d --name "$CONTAINER" -e POSTGRES_PASSWORD=drill "$PG_IMAGE" >/dev/null
for _ in $(seq 1 30); do
  docker exec "$CONTAINER" pg_isready -U postgres -h localhost >/dev/null 2>&1 && break
  sleep 1
done
docker exec "$CONTAINER" pg_isready -U postgres -h localhost >/dev/null 2>&1 || fail "Postgres เธเธฑเนเธงเธเธฃเธฒเธงเนเธกเนเธเธถเนเธ"

# เธชเธฃเนเธฒเธ schema เนเธฅเธฐ extension เธ—เธตเน Supabase เนเธเนเธเธฒเธ เน€เธเธทเนเธญเนเธซเน restore เนเธ”เนเธชเธกเธเธนเธฃเธ“เน
docker exec "$CONTAINER" psql -U postgres -d postgres -h localhost -c "
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE EXTENSION IF NOT EXISTS \"uuid-ossp\" SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS \"pgcrypto\" SCHEMA extensions;
" >/dev/null 2>&1 || true

docker cp "$WORK/backup.dump" "$CONTAINER:/tmp/backup.dump"
log "เธเธณเธฅเธฑเธ restore..."
docker exec "$CONTAINER" pg_restore -U postgres -d postgres -h localhost --no-owner --no-privileges /tmp/backup.dump \
  2> "$WORK/restore.err" || log "โ ๏ธ pg_restore เธกเธต warning (เธเธเธ•เธดเธชเธณเธซเธฃเธฑเธ extension/role เธเธญเธ Supabase) โ€” เธ”เธนเธชเธฃเธธเธเธ”เนเธฒเธเธฅเนเธฒเธ"

echo
log "เธเธณเธเธงเธเนเธ–เธงเธ—เธตเนเธเธนเนเธกเธฒเนเธ”เน:"
docker exec "$CONTAINER" psql -U postgres -d postgres -h localhost -tA -c "
  select 'sales_daily        = ' || count(*) from public.sales_daily
  union all select 'expenses           = ' || count(*) from public.expenses
  union all select 'profiles           = ' || count(*) from public.profiles
  union all select 'business_config    = ' || count(*) from public.business_config
  union all select 'customers          = ' || count(*) from public.customers
  union all select 'point_transactions = ' || count(*) from public.point_transactions;
" || fail "เธเธนเนเธกเธฒเนเธฅเนเธงเนเธ•เน query เนเธกเนเนเธ”เน โ€” backup เนเธเนเนเธกเนเนเธ”เนเธเธฃเธดเธ"

echo
log "โ… เธเนเธญเธกเธเธนเนเธชเธณเน€เธฃเนเธ โ€” เธ•เธฑเธงเน€เธฅเธเธเนเธฒเธเธเธเธ•เนเธญเธเนเธเธฅเนเน€เธเธตเธขเธเธเธญเธเธเธฃเธดเธ เธ–เนเธฒเน€เธเนเธ 0 เธซเธกเธ”เนเธเธฅเธงเนเธฒ backup เธกเธตเธเธฑเธเธซเธฒ"
log "   (container เธเธฑเนเธงเธเธฃเธฒเธงเธ–เธนเธเธฅเธเธญเธฑเธ•เนเธเธกเธฑเธ•เธดเนเธฅเนเธง)"
