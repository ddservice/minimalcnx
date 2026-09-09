#!/usr/bin/env bash
#
# migrate-supabase-project.sh — ย้ายฐานข้อมูล minimalcnx ข้าม Supabase project
# (ใช้ตอนย้าย region: Sydney ap-southeast-2 → Singapore ap-southeast-1)
#
#   bash scripts/migrate-supabase-project.sh --check     # ตรวจของก่อน ไม่แตะอะไร
#   bash scripts/migrate-supabase-project.sh --dump      # ดูดข้อมูลจากโปรเจกต์เก่า
#   bash scripts/migrate-supabase-project.sh --load      # ยัดลงโปรเจกต์ใหม่
#   bash scripts/migrate-supabase-project.sh --verify    # นับแถวเทียบเก่า/ใหม่
#   bash scripts/migrate-supabase-project.sh --all       # dump → load → verify
#
# ไฟล์ที่ dump ออกมามีข้อมูลส่วนบุคคลตาม PDPA เต็มๆ (เบอร์ลูกค้า / เลขบัตร ปชช.
# + เลขบัญชีธนาคารพนักงาน / เลขผู้เสียภาษี / hash รหัสผ่านใน auth.users)
# สคริปต์เก็บไว้ใน WORKDIR แบบ chmod 700 และเตือนให้ลบทิ้งหลังเสร็จ — อย่าลืมลบจริง
#
# ตั้งค่าใน .migrate.env (ข้างๆ repo, gitignored) — ดู deploy/MIGRATE-REGION.md
#
# ทำไมไม่ใช้ scripts/backup-to-r2.sh แล้ว restore:
#   backup ตั้งใจ dump แค่ public + storage และใส่ --no-privileges (grant หาย)
#   ส่วนการย้ายโปรเจกต์ต้องได้ auth.users มาด้วย ไม่งั้นทุกคน login ไม่ได้

set -Eeuo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

usage() { sed -n '2,20p' "$0" | sed 's/^#\{1,\} \{0,1\}//'; }
case "${1:-}" in
  --check|--dump|--load|--verify|--all) : ;;
  *) usage; exit 1 ;;
esac

ENV_FILE="${MIGRATE_ENV_FILE:-$HERE/../.migrate.env}"
[ -f "$ENV_FILE" ] && set -a && . "$ENV_FILE" && set +a

: "${OLD_DB_URL:?ต้องตั้ง OLD_DB_URL — connection string โปรเจกต์เก่า (Session pooler :5432 หรือ direct)}"
: "${NEW_DB_URL:?ต้องตั้ง NEW_DB_URL — connection string โปรเจกต์ใหม่ (Session pooler :5432 หรือ direct)}"

PG_IMAGE="${PG_IMAGE:-postgres:17-alpine}"
WORKDIR="${MIGRATE_WORKDIR:-$HOME/minimalcnx-migrate}"

log()  { printf '[%s] %s\n' "$(date -u +%H:%M:%SZ)" "$*"; }
warn() { printf '[%s] !!  %s\n' "$(date -u +%H:%M:%SZ)" "$*" >&2; }
fail() { printf '[%s] XX  %s\n' "$(date -u +%H:%M:%SZ)" "$*" >&2; exit 1; }

command -v docker >/dev/null 2>&1 || fail "ไม่พบคำสั่ง docker"

# ── ตรวจรูปแบบ connection string ────────────────────────────────
# transaction pooler (:6543) ใช้ไม่ได้ทั้งสองฝั่ง:
#   ฝั่ง dump — pg_dump ต้องการ snapshot คงที่ตลอดงาน
#   ฝั่ง load — เราตั้ง session_replication_role = replica แล้วต้องให้ค่านั้นอยู่ยาวถึง COPY
#               transaction mode สลับ backend ระหว่างคำสั่ง ค่าหาย → trigger ทำงาน → ข้อมูลเพี้ยน
check_url() {
  local name="$1" url="$2"
  case "$url" in
    *:6543*) fail "$name ชี้ไป transaction pooler (:6543) — ใช้ Session pooler (:5432) หรือ direct connection" ;;
  esac
  case "$url" in
    postgresql://*|postgres://*) : ;;
    *) fail "$name ต้องขึ้นต้นด้วย postgresql:// (คัดลอกจาก Supabase → Project Settings → Database → Connection string → URI) และถ้ารหัสผ่านมี @ # ? / ต้อง percent-encode ก่อน" ;;
  esac
}
check_url OLD_DB_URL "$OLD_DB_URL"
check_url NEW_DB_URL "$NEW_DB_URL"

psql_old() { docker run --rm -i -e PGCONNECT_TIMEOUT=30 "$PG_IMAGE" psql "$OLD_DB_URL" "$@"; }
psql_new() { docker run --rm -i -e PGCONNECT_TIMEOUT=30 "$PG_IMAGE" psql "$NEW_DB_URL" "$@"; }

# ── หา project ref จาก connection string ────────────────────────
# pooler:  postgresql://postgres.<ref>:pw@aws-1-<region>.pooler.supabase.com:5432/postgres
# direct:  postgresql://postgres:pw@db.<ref>.supabase.co:5432/postgres
derive_ref() {
  local url="$1" ref=""
  ref="$(printf '%s' "$url" | sed -n 's#^postgres\(ql\)\?://postgres\.\([a-z0-9]\{16,\}\):.*#\2#p')"
  [ -n "$ref" ] || ref="$(printf '%s' "$url" | sed -n 's#.*@db\.\([a-z0-9]\{16,\}\)\.supabase\.co.*#\1#p')"
  printf '%s' "$ref"
}
OLD_PROJECT_REF="${OLD_PROJECT_REF:-$(derive_ref "$OLD_DB_URL")}"
NEW_PROJECT_REF="${NEW_PROJECT_REF:-$(derive_ref "$NEW_DB_URL")}"

# นับแถวจริงทุกตารางใน public แบบไม่ต้องฮาร์ดโค้ดรายชื่อ — ตารางที่เพิ่มทีหลังก็ถูกนับเอง
COUNT_SQL="
select table_name || ' = ' ||
       (xpath('/row/c/text()', query_to_xml(
          format('select count(*) as c from public.%I', table_name), false, true, '')))[1]::text
from information_schema.tables
where table_schema = 'public' and table_type = 'BASE TABLE'
order by table_name;
select 'auth.users = ' || count(*) from auth.users;
"

# ── preflight ───────────────────────────────────────────────────
do_check() {
  log "ต่อโปรเจกต์เก่า..."
  psql_old -tAc "select 'old: ' || current_database() || ' / ' || substring(version() from 'PostgreSQL [0-9.]+');" \
    || fail "ต่อ OLD_DB_URL ไม่ได้"
  log "ต่อโปรเจกต์ใหม่..."
  psql_new -tAc "select 'new: ' || current_database() || ' / ' || substring(version() from 'PostgreSQL [0-9.]+');" \
    || fail "ต่อ NEW_DB_URL ไม่ได้"

  log "project ref เก่า = ${OLD_PROJECT_REF:-<หาไม่เจอ>} / ใหม่ = ${NEW_PROJECT_REF:-<หาไม่เจอ>}"
  if [ -z "$OLD_PROJECT_REF" ] || [ -z "$NEW_PROJECT_REF" ]; then
    warn "แกะ project ref จาก connection string ไม่ออก — ตั้ง OLD_PROJECT_REF / NEW_PROJECT_REF ใน .migrate.env เอง"
    warn "(จำเป็นตอนย้ายรูป storage เพื่อเขียนทับลิงก์หลักฐานใน sales_daily)"
  fi

  # ปลายทางต้องว่าง — ถ้ามีตารางแอปอยู่แล้วแปลว่าเคยโหลดไปแล้ว โหลดซ้ำจะได้ข้อมูลซ้อน
  local existing
  existing="$(psql_new -tAc "select count(*) from information_schema.tables where table_schema='public' and table_name in ('sales_daily','expenses','profiles');")"
  if [ "${existing:-0}" != "0" ]; then
    warn "โปรเจกต์ใหม่มีตารางของแอปอยู่แล้ว ($existing ตาราง) — --load จะทับ/ซ้ำ"
    warn "ถ้าจะเริ่มใหม่จริงๆ ให้รันบนโปรเจกต์ใหม่: drop schema public cascade; create schema public;"
  else
    log "โปรเจกต์ใหม่ยังว่าง (ยังไม่มีตารางของแอป) — พร้อมโหลด"
  fi

  # session_replication_role ต้องตั้งได้ ไม่งั้น trigger จะทำงานระหว่างโหลด → แต้ม/audit เพี้ยน
  psql_new -v ON_ERROR_STOP=1 -tAc "set session_replication_role = replica; select 'replica mode ok';" \
    || fail "ตั้ง session_replication_role = replica บนโปรเจกต์ใหม่ไม่ได้ — ต้องต่อด้วย user postgres และห้ามใช้ transaction pooler"

  log "OK — พร้อมย้าย"
}

# ── 1) dump จากโปรเจกต์เก่า ─────────────────────────────────────
do_dump() {
  mkdir -p "$WORKDIR" && chmod 700 "$WORKDIR"

  log "นับแถวต้นทางไว้เทียบทีหลัง..."
  psql_old -tA -c "$COUNT_SQL" > "$WORKDIR/rowcount-old.txt" || fail "นับแถวต้นทางไม่ได้"
  log "ต้นทางมี $(wc -l < "$WORKDIR/rowcount-old.txt") รายการ"

  # schema ของ public เท่านั้น — auth/storage/extensions เป็นของ Supabase จัดการเอง
  # โปรเจกต์ใหม่มีให้อยู่แล้ว ถ้าไป dump ทับจะชนกับเวอร์ชันแพลตฟอร์มที่อาจไม่ตรงกัน
  #
  # ไม่ใส่ --no-privileges (ต่างจาก backup-to-r2.sh) เพราะต้องได้ grant execute ... to authenticated
  # ที่ RPC ทุกตัวพึ่งอยู่ ถ้า grant หาย แอปจะเรียก RPC ไม่ได้ทั้งระบบ
  log "dump schema (public)..."
  docker run --rm -e PGCONNECT_TIMEOUT=30 "$PG_IMAGE" \
    pg_dump "$OLD_DB_URL" --schema-only --no-owner --schema=public \
    > "$WORKDIR/01-schema-public.sql" || fail "dump schema ล้มเหลว"

  # auth.users + auth.identities = บัญชีผู้ใช้ + hash รหัสผ่าน
  # ต้องได้ UUID เดิมมาด้วย เพราะ profiles.id / staff_profiles.user_id / audit_log.user_id อ้างอยู่
  log "dump auth (users + identities)..."
  docker run --rm -e PGCONNECT_TIMEOUT=30 "$PG_IMAGE" \
    pg_dump "$OLD_DB_URL" --data-only --no-owner \
      --table=auth.users --table=auth.identities \
    > "$WORKDIR/02-data-auth.sql" || fail "dump auth ล้มเหลว"

  log "dump data (public)..."
  docker run --rm -e PGCONNECT_TIMEOUT=30 "$PG_IMAGE" \
    pg_dump "$OLD_DB_URL" --data-only --no-owner --schema=public \
    > "$WORKDIR/03-data-public.sql" || fail "dump data ล้มเหลว"

  # CREATE SCHEMA public / COMMENT ON SCHEMA public จะพังเพราะเราไม่ใช่เจ้าของ schema
  # และโปรเจกต์ใหม่มี public อยู่แล้ว — ตัดทิ้งตั้งแต่ต้นทาง ดีกว่าปล่อยให้ error
  # แล้วต้องมานั่งแยกทีหลังว่าอันไหนร้ายแรงอันไหนไม่
  sed -i -e '/^CREATE SCHEMA public;$/d' -e '/^COMMENT ON SCHEMA public /d' "$WORKDIR/01-schema-public.sql"

  chmod 600 "$WORKDIR"/*.sql
  local f sz
  for f in 01-schema-public 02-data-auth 03-data-public; do
    sz=$(stat -c %s "$WORKDIR/$f.sql" 2>/dev/null || stat -f %z "$WORKDIR/$f.sql")
    [ "$sz" -gt 512 ] || fail "$f.sql เล็กผิดปกติ ($sz bytes) — dump ไม่ครบ"
    log "  $f.sql = $((sz / 1024)) KB"
  done

  log "dump เสร็จ → $WORKDIR"
  warn "ไฟล์พวกนี้มีข้อมูลส่วนบุคคล + hash รหัสผ่าน — ลบทิ้งด้วย 'rm -rf $WORKDIR' หลังย้ายเสร็จ"
}

# error ที่เจอปกติเวลายัด dump ลง Supabase — ไม่ใช่สัญญาณว่าย้ายพัง
BENIGN='already exists|must be owner of|permission denied for schema public|no privileges were granted|no privileges could be revoked'

run_sql_file() {
  local label="$1" file="$2" pre="${3:-}"
  local err="$WORKDIR/err-$label.log"
  log "โหลด $label ..."
  if [ -n "$pre" ]; then
    psql_new -c "$pre" -f - < "$file" > "$WORKDIR/out-$label.log" 2> "$err" || true
  else
    psql_new -f - < "$file" > "$WORKDIR/out-$label.log" 2> "$err" || true
  fi
  local bad n
  bad="$(grep -E 'ERROR' "$err" 2>/dev/null | grep -Ev "$BENIGN" || true)"
  if [ -n "$bad" ]; then
    printf '%s\n' "$bad" | head -40 >&2
    fail "$label มี error ที่ไม่ใช่เรื่องปกติ (ดูทั้งหมดใน $err) — หยุดก่อน อย่าเพิ่งสลับแอปไปโปรเจกต์ใหม่"
  fi
  n="$(grep -cE 'ERROR' "$err" 2>/dev/null || true)"
  if [ "${n:-0}" = "0" ]; then
    log "  $label ผ่าน ไม่มี error"
  else
    log "  $label ผ่าน (มี $n error ที่เป็นเรื่องปกติของ Supabase — ดู $err)"
  fi
}

# ── 2) โหลดลงโปรเจกต์ใหม่ ───────────────────────────────────────
do_load() {
  [ -f "$WORKDIR/01-schema-public.sql" ] || fail "ยังไม่มีไฟล์ dump — รัน --dump ก่อน"

  run_sql_file schema "$WORKDIR/01-schema-public.sql"

  # ตั้ง replica ใน session เดียวกับตอน COPY (psql -c แล้วตามด้วย -f = session เดียว)
  # ปิด trigger ทั้งหมดระหว่างโหลด ไม่งั้น:
  #   fn_on_point_transaction   → คำนวณ points_balance ซ้ำทับของจริง
  #   tr_customers_guard_points → บล็อกการ insert customers ทิ้งไปเลย
  #   audit trigger             → ยัด audit_log ปลอมเป็นหมื่นแถว
  #   tr_expenses_month_label   → เขียน month_label ทับ
  # และ FK trigger ก็ถูกปิดด้วย เลยไม่ต้องกังวลลำดับตาราง
  run_sql_file auth "$WORKDIR/02-data-auth.sql" 'set session_replication_role = replica;'
  run_sql_file data "$WORKDIR/03-data-public.sql" 'set session_replication_role = replica;'

  # storage bucket + policy อยู่นอก schema public เลยไม่ติดมากับ dump
  # (คัดมาเฉพาะส่วนนี้จาก sql/add_free_cup_actual_cost.sql — ห้ามรันทั้งไฟล์
  #  เพราะท้ายไฟล์มี UPDATE ที่เขียนทับ free_cup_cost ทุกแถวเป็น free_cups * 55)
  log "สร้าง storage bucket evidence + policy..."
  psql_new -v ON_ERROR_STOP=1 -f - >/dev/null <<'EOSQL' || fail "สร้าง bucket ไม่สำเร็จ"
insert into storage.buckets (id, name, public) values ('evidence','evidence',true)
  on conflict (id) do nothing;
drop policy if exists "evidence: upload authenticated" on storage.objects;
create policy "evidence: upload authenticated" on storage.objects for insert to authenticated
  with check (bucket_id = 'evidence');
drop policy if exists "evidence: read all" on storage.objects;
create policy "evidence: read all" on storage.objects for select using (bucket_id = 'evidence');
EOSQL

  log "โหลดเสร็จ — ต่อไปรัน --verify"
}

# ── 3) เทียบจำนวนแถว ────────────────────────────────────────────
do_verify() {
  [ -f "$WORKDIR/rowcount-old.txt" ] || fail "ไม่มี rowcount-old.txt — รัน --dump ก่อน"
  psql_new -tA -c "$COUNT_SQL" > "$WORKDIR/rowcount-new.txt" || fail "นับแถวปลายทางไม่ได้"

  echo
  if diff -u "$WORKDIR/rowcount-old.txt" "$WORKDIR/rowcount-new.txt" > "$WORKDIR/rowcount-diff.txt"; then
    log "จำนวนแถวตรงกันทุกตาราง:"
    sed 's/^/    /' "$WORKDIR/rowcount-new.txt"
  else
    warn "จำนวนแถวไม่ตรง (- คือของเก่า, + คือของใหม่):"
    sed 's/^/    /' "$WORKDIR/rowcount-diff.txt" >&2
    fail "ยังย้ายไม่ครบ — อย่าเพิ่งสลับแอปไปโปรเจกต์ใหม่"
  fi

  echo
  log "ตรวจว่า migration ทุกไฟล์ติดมาครบ (sql/check_migrations.sql):"
  psql_new -f - < "$HERE/../sql/check_migrations.sql" || warn "รัน check_migrations.sql ไม่สำเร็จ — เปิด Supabase SQL Editor รันเองอีกที"

  if [ -n "$NEW_PROJECT_REF" ]; then
    echo
    log "ลิงก์รูปหลักฐานที่ยังชี้โปรเจกต์เก่า (ต้องเป็น 0 หลังรัน migrate-storage-files.sh):"
    psql_new -tAc "select count(*) from public.sales_daily where free_cup_evidence_url is not null and free_cup_evidence_url not like '%${NEW_PROJECT_REF}%';" \
      | sed 's/^/    ยังเหลือ /'
  fi
}

case "${1:-}" in
  --check)  do_check ;;
  --dump)   do_dump ;;
  --load)   do_load ;;
  --verify) do_verify ;;
  --all)    do_check; do_dump; do_load; do_verify ;;
esac
