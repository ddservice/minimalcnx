-- ================================================================
-- new_instance_finalize.sql — ขั้นสุดท้ายของการติดตั้ง "ร้านใหม่" จากไฟล์ sql/ ล้วนๆ
-- รันหลังไฟล์อื่นครบแล้ว (scripts/install-schema.sh รันให้เอง) — รันซ้ำได้
--
-- ไม่ใช่ migration ของร้านที่ใช้งานอยู่: ส่วนที่ 2 ทำงานเฉพาะฐานที่ยังไม่มีลูกค้า/แต้ม
-- ================================================================

-- ── 1. ปิดทางสมัครเป็น admin เอง ────────────────────────────────
-- sql/supabase_migration.sql สร้าง trigger on_auth_user_created ที่อ่าน role จาก
-- raw_user_meta_data ซึ่ง "ผู้สมัครเป็นคนส่งมาเอง" — ใครมี publishable key (อยู่ใน JS ของหน้าเว็บ)
-- เรียก auth.signUp({ options: { data: { role: 'admin' } } }) ก็ได้ profile role admin ทันที
-- แอปไม่ได้ใช้ trigger นี้: admin_create_user() และคู่มือติดตั้งเขียน profiles เองทั้งคู่
drop trigger if exists on_auth_user_created on auth.users;

-- ── 2. สาขาตั้งต้นเป็นของร้านเดิม → เปลี่ยนเป็นชื่อกลาง ─────────
-- add_loyalty_system.sql seed "สาขาแม่ริม" + "สาขาตัวเมืองเชียงใหม่" — ร้านใหม่แก้ชื่อจริงที่ /admin/loyalty
do $$
begin
  if exists (select 1 from public.customers) or exists (select 1 from public.point_transactions) then
    raise notice 'ฐานนี้มีลูกค้า/แต้มแล้ว — ข้ามการแก้สาขาตั้งต้น';
    return;
  end if;
  delete from public.branches b
   where b.code = 'CNX01'
     and not exists (select 1 from public.staff_profiles sp where sp.branch_id = b.id);
  update public.branches
     set name = 'สาขาหลัก', location = null
   where code = 'MAIN' and name = 'สาขาแม่ริม (สำนักงานใหญ่)';
end $$;

select
  not exists (select 1 from pg_trigger
               where tgrelid = 'auth.users'::regclass and tgname = 'on_auth_user_created') as signup_trigger_removed,
  (select string_agg(code || ' = ' || name, ', ' order by code) from public.branches)      as branches;
