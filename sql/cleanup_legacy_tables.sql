-- ================================================================
-- cleanup_legacy_tables.sql — เก็บกวาดตารางค้างจาก supabase_migration.sql รุ่นแรก
--
-- employees / payroll_monthly / price_list ถูกสร้างไว้ตั้งแต่ตอนพอร์ตจาก GAS
-- แต่สุดท้ายระบบไม่ได้ใช้เลย — ข้อมูลพนักงานย้ายไปอยู่ business_config.emp_details
-- (ดู "Lesson learned 2026-07-19" ใน CLAUDE.md) เงินเดือนคำนวณสดจาก lib/payslip.js
-- แล้วเก็บประวัติใน business_config.emp_pay_history ส่วนราคาสินค้าอยู่ในแคตตาล็อก
-- ที่ expense-form สร้างจาก expenses เอง
--
-- ตรวจแล้วเมื่อ 2026-09-09: ไม่มีโค้ดใน app/ lib/ components/ templates/
-- และไม่มีไฟล์ SQL อื่นอ้างถึงสามตารางนี้เลยสักที่ และทั้งสามมี 0 แถวบน production
--
-- ทำไมถึงควรลบ ไม่ใช่ปล่อยไว้เฉยๆ:
--   1. price_list เปิดอ่านได้โดยไม่ต้องล็อกอิน — policy เป็น "for select using (true)"
--      ไม่มี "to authenticated" จึงมีผลกับ PUBLIC ซึ่งรวม role anon ด้วย
--      ใครถือ anon key (ซึ่งฝังอยู่ใน JS ที่ส่งให้เบราว์เซอร์ทุกคนอยู่แล้ว) ก็อ่านได้
--      ตอนนี้ไม่รั่วเพราะไม่มีข้อมูล แต่วันที่มีคนเผลอใส่ราคาลงไป มันจะเป็นสาธารณะทันที
--   2. payroll_monthly เปิดให้ผู้ใช้ที่ล็อกอินคนไหนก็ได้ insert/update — เป็นพื้นที่เขียน
--      ที่ไม่มีใครดูแลและไม่มีอะไรในแอปเรียกใช้
--
-- ปลอดภัยแค่ไหน: ไฟล์นี้ "ปฏิเสธที่จะลบ" ถ้าตารางไหนมีข้อมูล และไม่ใช้ cascade
-- ถ้ามีอะไรอ้างถึงอยู่จริงมันจะ error ให้เห็น ไม่ใช่ลบพ่วงไปเงียบๆ
-- และ DDL เดิมยังอยู่ในประวัติ git ของ sql/supabase_migration.sql ถ้าอยากได้คืน
--
-- รันใน Supabase → SQL Editor → Run (idempotent รันซ้ำได้)
-- ================================================================

-- ── 1. รัดนโยบายอ่าน price_list ────────────────────────────────
-- ทำก่อนขั้นลบ เพื่อให้ช่องโหว่ถูกปิดแม้กรณีที่ขั้นลบถูกข้าม (เพราะตารางมีข้อมูล)
do $$
begin
  if to_regclass('public.price_list') is not null then
    drop policy if exists "price_list: read all" on public.price_list;
    create policy "price_list: read authenticated"
      on public.price_list for select to authenticated
      using (true);
    raise notice 'price_list: รัดนโยบายอ่านเป็น authenticated แล้ว';
  end if;
end $$;

-- ── 2. ลบตารางที่ไม่ได้ใช้ (เฉพาะเมื่อว่างทั้งหมด) ─────────────
do $$
declare
  _emp   bigint := 0;
  _pay   bigint := 0;
  _price bigint := 0;
begin
  if to_regclass('public.employees')       is not null then execute 'select count(*) from public.employees'       into _emp;   end if;
  if to_regclass('public.payroll_monthly') is not null then execute 'select count(*) from public.payroll_monthly' into _pay;   end if;
  if to_regclass('public.price_list')      is not null then execute 'select count(*) from public.price_list'      into _price; end if;

  if _emp > 0 or _pay > 0 or _price > 0 then
    raise notice 'ข้ามการลบ — มีข้อมูลค้างอยู่ (employees=%, payroll_monthly=%, price_list=%)', _emp, _pay, _price;
    raise notice 'ตรวจว่าข้อมูลนั้นคืออะไรก่อน ถ้าไม่ต้องการแล้วค่อยลบเองด้วยมือ';
    return;
  end if;

  -- ลำดับสำคัญ: payroll_monthly มี FK ชี้ employees จึงต้องไปก่อน
  -- ไม่ใช้ cascade โดยตั้งใจ — ถ้ามีอะไรอ้างถึงอยู่ ให้มัน error ดังๆ ดีกว่าลบพ่วงเงียบๆ
  drop table if exists public.payroll_monthly;
  drop table if exists public.employees;
  drop table if exists public.price_list;
  raise notice 'ลบ employees / payroll_monthly / price_list เรียบร้อย (ทั้งสามว่างเปล่า)';
end $$;

-- ── ตรวจผล ─────────────────────────────────────────────────────
select
  to_regclass('public.employees')       is null as employees_dropped,
  to_regclass('public.payroll_monthly') is null as payroll_monthly_dropped,
  to_regclass('public.price_list')      is null as price_list_dropped;

select 'cleanup_legacy_tables applied ✓' as result;
