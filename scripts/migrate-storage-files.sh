#!/usr/bin/env bash
#
# migrate-storage-files.sh — ย้ายไฟล์ใน Supabase Storage bucket "evidence" ข้ามโปรเจกต์
# (รูปหลักฐานแก้วฟรี — pg_dump ได้แค่ metadata ในตาราง storage.objects ไม่ได้ตัวไฟล์)
#
#   bash scripts/migrate-storage-files.sh --list     # ดูว่ามีไฟล์อะไรบ้างที่ต้องย้าย
#   bash scripts/migrate-storage-files.sh --copy     # ดาวน์โหลดจากเก่า → อัปขึ้นใหม่
#   bash scripts/migrate-storage-files.sh --relink   # เขียนทับ URL ใน sales_daily ให้ชี้โปรเจกต์ใหม่
#   bash scripts/migrate-storage-files.sh --all      # copy แล้ว relink
#
# ต้องรัน --load ของ migrate-supabase-project.sh ให้เสร็จก่อน (bucket ต้องมีอยู่แล้ว)
# ตั้งค่าใน .migrate.env — ดู deploy/MIGRATE-REGION.md
#
# ทำไมต้องมี --relink:
#   sales_daily.free_cup_evidence_url เก็บ URL เต็มที่มี project ref อยู่ในนั้น
#   (https://<ref>.supabase.co/storage/v1/object/public/evidence/...)
#   ย้าย DB อย่างเดียวแล้วไม่แก้ URL = รูปยังโหลดจากโปรเจกต์เก่า พังทันทีที่ลบโปรเจกต์นั้น

set -Eeuo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

usage() { sed -n '2,17p' "$0" | sed 's/^#\{1,\} \{0,1\}//'; }
case "${1:-}" in
  --list|--copy|--relink|--all) : ;;
  *) usage; exit 1 ;;
esac

ENV_FILE="${MIGRATE_ENV_FILE:-$HERE/../.migrate.env}"
[ -f "$ENV_FILE" ] && set -a && . "$ENV_FILE" && set +a

: "${OLD_DB_URL:?ต้องตั้ง OLD_DB_URL}"
: "${NEW_DB_URL:?ต้องตั้ง NEW_DB_URL}"
: "${OLD_SUPABASE_URL:?ต้องตั้ง OLD_SUPABASE_URL เช่น https://fkhfrylvronkmktlmmia.supabase.co}"
: "${NEW_SUPABASE_URL:?ต้องตั้ง NEW_SUPABASE_URL เช่น https://<ref-ใหม่>.supabase.co}"

PG_IMAGE="${PG_IMAGE:-postgres:17-alpine}"
BUCKET="${STORAGE_BUCKET:-evidence}"
WORK="$(mktemp -d)"

log()  { printf '[%s] %s\n' "$(date -u +%H:%M:%SZ)" "$*"; }
warn() { printf '[%s] !!  %s\n' "$(date -u +%H:%M:%SZ)" "$*" >&2; }
fail() { printf '[%s] XX  %s\n' "$(date -u +%H:%M:%SZ)" "$*" >&2; exit 1; }
trap 'rm -rf "$WORK"' EXIT

command -v docker >/dev/null 2>&1 || fail "ไม่พบคำสั่ง docker"
command -v curl   >/dev/null 2>&1 || fail "ไม่พบคำสั่ง curl"

psql_old() { docker run --rm -i -e PGCONNECT_TIMEOUT=30 "$PG_IMAGE" psql "$OLD_DB_URL" "$@"; }
psql_new() { docker run --rm -i -e PGCONNECT_TIMEOUT=30 "$PG_IMAGE" psql "$NEW_DB_URL" "$@"; }

list_objects() {
  psql_old -tAc "select name from storage.objects where bucket_id = '$BUCKET' order by name;" | grep -v '^$' || true
}

content_type() {
  case "${1##*.}" in
    jpg|jpeg) echo image/jpeg ;;
    png)      echo image/png ;;
    webp)     echo image/webp ;;
    gif)      echo image/gif ;;
    heic)     echo image/heic ;;
    pdf)      echo application/pdf ;;
    *)        echo application/octet-stream ;;
  esac
}

do_list() {
  local n=0
  while IFS= read -r name; do
    printf '  %s\n' "$name"
    n=$((n + 1))
  done < <(list_objects)
  log "รวม $n ไฟล์ใน bucket $BUCKET ของโปรเจกต์เก่า"
}

do_copy() {
  : "${NEW_SERVICE_ROLE_KEY:?ต้องตั้ง NEW_SERVICE_ROLE_KEY (service_role ของโปรเจกต์ใหม่) — อัปไฟล์เข้า Storage ต้องใช้}"

  local total=0 ok=0 skipped=0
  local names; names="$(list_objects)"
  [ -n "$names" ] || { log "ไม่มีไฟล์ใน bucket $BUCKET — ไม่ต้องย้าย"; return 0; }

  while IFS= read -r name; do
    [ -n "$name" ] || continue
    total=$((total + 1))
    case "$name" in
      *[[:space:]]*) warn "ข้าม '$name' — ชื่อไฟล์มีช่องว่าง ต้อง url-encode ก่อน (ย้ายมือเอา)"; skipped=$((skipped + 1)); continue ;;
    esac

    local src="$WORK/blob"
    # bucket เป็น public อยู่แล้ว โหลดผ่าน /object/public ได้เลยไม่ต้องใช้ key
    if ! curl -fsSL --max-time 120 -o "$src" "$OLD_SUPABASE_URL/storage/v1/object/public/$BUCKET/$name"; then
      warn "ดาวน์โหลดไม่สำเร็จ: $name"
      skipped=$((skipped + 1)); continue
    fi
    [ -s "$src" ] || { warn "ไฟล์ว่าง: $name"; skipped=$((skipped + 1)); continue; }

    # x-upsert ทำให้รันซ้ำได้โดยไม่ error ว่าไฟล์มีอยู่แล้ว
    local code
    code="$(curl -s -o "$WORK/resp.json" -w '%{http_code}' --max-time 300 \
      -X POST "$NEW_SUPABASE_URL/storage/v1/object/$BUCKET/$name" \
      -H "Authorization: Bearer $NEW_SERVICE_ROLE_KEY" \
      -H "Content-Type: $(content_type "$name")" \
      -H "x-upsert: true" \
      --data-binary "@$src")"
    if [ "$code" = "200" ] || [ "$code" = "201" ]; then
      ok=$((ok + 1))
      printf '  ok  %s (%s KB)\n' "$name" "$(( $(stat -c %s "$src" 2>/dev/null || stat -f %z "$src") / 1024 ))"
    else
      warn "อัปโหลดไม่สำเร็จ ($code): $name — $(head -c 300 "$WORK/resp.json")"
      skipped=$((skipped + 1))
    fi
    rm -f "$src"
  done <<< "$names"

  log "ย้ายไฟล์: สำเร็จ $ok / ทั้งหมด $total (ข้าม/พลาด $skipped)"

  # ไม่เชื่อ exit code อย่างเดียว — ถามปลายทางว่ามีไฟล์ครบจริงไหม
  local dst_n; dst_n="$(psql_new -tAc "select count(*) from storage.objects where bucket_id = '$BUCKET';")"
  log "โปรเจกต์ใหม่มี ${dst_n:-0} ไฟล์ใน bucket $BUCKET (ต้นทางมี $total)"
  [ "${dst_n:-0}" -ge "$total" ] || fail "ไฟล์ปลายทางไม่ครบ — อย่าเพิ่งลบโปรเจกต์เก่า"
}

do_relink() {
  local old_host new_host
  old_host="${OLD_SUPABASE_URL#https://}"; old_host="${old_host%%/*}"
  new_host="${NEW_SUPABASE_URL#https://}"; new_host="${new_host%%/*}"
  [ "$old_host" != "$new_host" ] || fail "OLD_SUPABASE_URL กับ NEW_SUPABASE_URL เป็นตัวเดียวกัน"

  log "เขียนทับลิงก์ $old_host → $new_host ใน sales_daily.free_cup_evidence_url ..."
  # replica mode = ไม่ให้ audit trigger ยิง audit_log ปลอมว่ามีคนแก้ยอดขายทุกแถว
  psql_new -v ON_ERROR_STOP=1 -tA \
    -c "set session_replication_role = replica;" \
    -c "update public.sales_daily
          set free_cup_evidence_url = replace(free_cup_evidence_url, '$old_host', '$new_host')
        where free_cup_evidence_url like '%$old_host%';" \
    -c "select 'ยังชี้โปรเจกต์เก่าอยู่ = ' || count(*) from public.sales_daily
        where free_cup_evidence_url like '%$old_host%';" \
    || fail "เขียนทับลิงก์ไม่สำเร็จ"
}

case "${1:-}" in
  --list)   do_list ;;
  --copy)   do_copy ;;
  --relink) do_relink ;;
  --all)    do_copy; do_relink ;;
esac
