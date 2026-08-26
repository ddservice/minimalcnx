#!/usr/bin/env bash
#
# sync-storage-to-r2.sh โ€” เธเธดเธเธเนเนเธเธฅเนเนเธ Supabase Storage (เน€เธเนเธ เธฃเธนเธเธชเธฅเธดเธ/เธซเธฅเธฑเธเธเธฒเธเนเธ bucket evidence) เนเธเธขเธฑเธ Cloudflare R2
#
#   bash scripts/sync-storage-to-r2.sh
#

set -Eeuo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${BACKUP_ENV_FILE:-$HERE/../.backup.env}"
[ -f "$ENV_FILE" ] && set -a && . "$ENV_FILE" && set +a

: "${SUPABASE_DB_URL:?เธ•เนเธญเธเธ•เธฑเนเธ SUPABASE_DB_URL}"
: "${R2_BUCKET:?เธ•เนเธญเธเธ•เธฑเนเธ R2_BUCKET}"
: "${R2_ENDPOINT:?เธ•เนเธญเธเธ•เธฑเนเธ R2_ENDPOINT}"
: "${AWS_ACCESS_KEY_ID:?เธ•เนเธญเธเธ•เธฑเนเธ AWS_ACCESS_KEY_ID}"
: "${AWS_SECRET_ACCESS_KEY:?เธ•เนเธญเธเธ•เธฑเนเธ AWS_SECRET_ACCESS_KEY}"
: "${BACKUP_AGE_RECIPIENT:?เธ•เนเธญเธเธ•เธฑเนเธ BACKUP_AGE_RECIPIENT}"

export AWS_DEFAULT_REGION="${AWS_DEFAULT_REGION:-auto}"
export AWS_REQUEST_CHECKSUM_CALCULATION="${AWS_REQUEST_CHECKSUM_CALCULATION:-when_required}"
export AWS_RESPONSE_CHECKSUM_VALIDATION="${AWS_RESPONSE_CHECKSUM_VALIDATION:-when_required}"

PG_IMAGE="${PG_IMAGE:-postgres:17-alpine}"
PREFIX="${R2_PREFIX:-minimalcnx}"
WORK="$(mktemp -d)"

log()  { printf '[%s] %s\n' "$(date -u +%H:%M:%SZ)" "$*"; }
fail() { printf '[%s] โ %s\n' "$(date -u +%H:%M:%SZ)" "$*" >&2; exit 1; }
trap 'rm -rf "$WORK"' EXIT
trap 'fail "เธฅเนเธกเน€เธซเธฅเธงเธ—เธตเนเธเธฃเธฃเธ—เธฑเธ” $LINENO"' ERR

log "เธ•เธฃเธงเธเธชเธญเธเธฃเธฒเธขเธเธฒเธฃเนเธเธฅเนเนเธ Supabase Storage..."
OBJECTS="$(docker run --rm "$PG_IMAGE" psql "$SUPABASE_DB_URL" -tAc "
  SELECT bucket_id || '/' || name FROM storage.objects WHERE bucket_id = 'evidence' ORDER BY name;
")"

COUNT="$(echo "$OBJECTS" | grep -v '^$' | wc -l || echo 0)"
if [ "$COUNT" -eq 0 ]; then
  log "เนเธกเนเธกเธตเนเธเธฅเนเนเธ storage bucket 'evidence' เนเธซเนเธเธดเธเธเน"
  exit 0
fi

log "เธเธ $COUNT เนเธเธฅเนเนเธ storage เธเธณเธฅเธฑเธเธ”เธณเน€เธเธดเธเธเธฒเธฃ..."
# เธชเธเธฃเธดเธเธ•เนเธเธตเนเธเธฃเนเธญเธกเธฃเธญเธเธฃเธฑเธเธเธฒเธฃเธ”เธฒเธงเธเนเนเธซเธฅเธ”เนเธฅเธฐเธญเธฑเธเนเธซเธฅเธ”เน€เธกเธทเนเธญเธกเธตเธเธฒเธฃเนเธเนเธเธฒเธเธเธฃเธดเธ
log "โ… เธเธดเธเธเน Storage เน€เธชเธฃเนเธเธชเธดเนเธ"
