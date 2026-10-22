#!/usr/bin/env bash
#
# install-schema.sh — สร้างโครงสร้างฐานข้อมูลให้ "ร้านใหม่" จากไฟล์ sql/ ล้วนๆ
# (โปรเจกต์ Supabase ว่าง ไม่ต้องต่อไปที่ฐานของร้านอื่นเลย) — ดู deploy/NEW-INSTANCE.md
#
#   NEW_DB_URL='postgresql://postgres.<ref>:<รหัส>@<host>:5432/postgres' bash scripts/install-schema.sh
#   bash scripts/install-schema.sh            # ไม่ตั้งตัวแปร = ถามแล้วพิมพ์แบบไม่แสดงบนจอ
#   bash scripts/install-schema.sh --check    # รันเฉพาะ sql/check_migrations.sql
#
# ปฏิเสธการรันถ้าปลายทางมีตารางของแอปอยู่แล้ว — กันพิมพ์ URL ของร้านที่ใช้งานอยู่ผิดมา
# ลำดับไฟล์ด้านล่างคือลำดับเดียวที่ทดสอบแล้ว: หลายไฟล์ create or replace ฟังก์ชันชื่อเดียวกัน
# ไฟล์ที่รันทีหลังต้องเป็นรุ่นใหม่กว่า สลับลำดับ = ได้ฟังก์ชันรุ่นเก่าโดยไม่มี error

set -Eeuo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SQL_DIR="$HERE/../sql"
PG_IMAGE="${PG_IMAGE:-postgres:17-alpine}"

FILES=(
  supabase_migration.sql
  add_unit_column.sql
  add_email_to_profiles.sql
  admin_user_functions.sql
  harden_security.sql
  add_audit_context.sql
  add_loyalty_system.sql
  harden_loyalty_rls.sql
  harden_loyalty_writes.sql
  add_loyalty_indexes.sql
  harden_loyalty_reads.sql
  add_loyalty_rewards.sql
  add_customer_privacy_consent.sql
  harden_loyalty_integrity.sql
  add_analytics_range_kpis.sql
  fix_bugs.sql
  optimize_queries.sql
  add_audit_forensics.sql
  add_free_cup_actual_cost.sql
  add_documents.sql
  maintenance_audit_log.sql
  cleanup_legacy_tables.sql
  add_expense_documents.sql
  harden_sales_staff.sql
  add_sales_day_edit_grants.sql
  new_instance_finalize.sql
)

fail() { printf 'XX  %s\n' "$*" >&2; exit 1; }

command -v docker >/dev/null 2>&1 || fail "ไม่พบคำสั่ง docker"

if [ -z "${NEW_DB_URL:-}" ]; then
  printf 'วาง connection string ของโปรเจกต์ใหม่ (Session pooler :5432) แล้วกด Enter: ' >&2
  read -rs NEW_DB_URL < /dev/tty
  echo >&2
fi
case "$NEW_DB_URL" in
  *:6543*) fail "ชี้ไป transaction pooler (:6543) — ใช้ Session pooler (:5432)" ;;
esac
case "$NEW_DB_URL" in
  postgresql://*|postgres://*) : ;;
  *) fail "ต้องขึ้นต้นด้วย postgresql:// (ถ้ารหัสผ่านมี @ # ? / ต้อง percent-encode ก่อน)" ;;
esac

psql_new() { docker run --rm -i -e PGCONNECT_TIMEOUT=30 "$PG_IMAGE" psql "$NEW_DB_URL" "$@"; }

for f in "${FILES[@]}" check_migrations.sql; do
  [ -f "$SQL_DIR/$f" ] || fail "ไม่พบ sql/$f — git pull ให้ครบก่อน"
done

psql_new -tAc "select 'ต่อได้: ' || current_database() || ' / ' || substring(version() from 'PostgreSQL [0-9.]+');" \
  || fail "ต่อฐานข้อมูลไม่ได้ — ตรวจ connection string"

if [ "${1:-}" = "--check" ]; then
  psql_new -x -f - < "$SQL_DIR/check_migrations.sql"
  exit 0
fi

existing="$(psql_new -tAc "select count(*) from information_schema.tables where table_schema='public' and table_name in ('sales_daily','expenses','profiles');")"
[ "${existing:-0}" = "0" ] \
  || fail "ปลายทางมีตารางของแอปอยู่แล้ว (${existing}/3) — สคริปต์นี้ใช้กับโปรเจกต์ว่างเท่านั้น ตรวจว่าไม่ได้ใส่ URL ของร้านที่ใช้งานอยู่"

for f in "${FILES[@]}"; do
  echo "==> $f"
  psql_new -v ON_ERROR_STOP=1 -q -f - < "$SQL_DIR/$f" >/dev/null \
    || fail "$f ล้มเหลว — หยุดตรงนี้ อย่ารันไฟล์ถัดไปเอง แก้สาเหตุแล้วล้างโปรเจกต์ (หรือสร้างใหม่) ก่อนรันซ้ำ"
done

echo "==> check_migrations.sql (ทุกช่องต้องเป็น t)"
psql_new -x -f - < "$SQL_DIR/check_migrations.sql"
bad="$(psql_new -x -tA -f - < "$SQL_DIR/check_migrations.sql" | grep -c '|f$' || true)"
[ "${bad:-0}" = "0" ] || fail "มี ${bad} ช่องที่ยังเป็น f — ดูรายการด้านบน"
echo "เสร็จ — โครงสร้างครบทุกช่อง ต่อไปสร้างผู้ใช้ admin คนแรก (deploy/NEW-INSTANCE.md ข้อ 4)"
