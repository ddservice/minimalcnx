-- ================================================================
-- Supabase Migration: Minimal Maerim 69 Coffee Shop Dashboard
-- ================================================================
--
-- ⛔ ห้ามรันไฟล์นี้บนโปรเจกต์ที่มีข้อมูลอยู่แล้ว
--
-- นี่คือ schema ตั้งต้นสำหรับโปรเจกต์ Supabase "เปล่า" เท่านั้น
-- ทุก create table เป็นแบบไม่มี if not exists รันทับของเดิมจะได้
--   ERROR: 42P07: relation "profiles" already exists
-- (ไม่เสียหายอะไร เพราะ SQL Editor รันทั้งสคริปต์ในทรานแซกชันเดียวแล้ว rollback
--  และไม่มีคำสั่ง drop อยู่ก่อนหน้า — แต่ก็ไม่ได้ประโยชน์อะไรเช่นกัน)
--
-- ถ้าอยากรู้ว่าโปรเจกต์นี้ยังขาด migration ไฟล์ไหน ให้รัน sql/check_migrations.sql
-- (อ่านอย่างเดียว ปลอดภัย) แล้วรันเฉพาะไฟล์ที่ขึ้น false
-- ถ้าจะย้ายข้อมูลข้ามโปรเจกต์ ใช้ scripts/migrate-supabase-project.sh ไม่ใช่ไฟล์นี้
-- ================================================================
-- Schema ครอบคลุม: Sales, Expenses, OPEX, Users, Employees, Payroll
-- CSV Source: Data_Expenses → date, category, subcategory, item_name,
--             unit_price, quantity, total_amount, payment_method
-- ================================================================

-- Extensions
create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- ================================================================
-- 1. PROFILES  (ต่อจาก auth.users ของ Supabase)
-- ================================================================
-- ผู้ใช้ login ด้วย email pattern: {username}@marim69.internal
-- role: 'admin' หรือ 'manager'

create table public.profiles (
  id            uuid        primary key references auth.users(id) on delete cascade,
  username      text        unique not null,
  full_name     text        not null default '',
  nickname      text        not null default '',
  role          text        not null default 'manager'
                              check (role in ('admin', 'manager')),
  is_active     boolean     not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.profiles is
  'ข้อมูลผู้ใช้งาน — linked กับ auth.users, login ด้วย username@marim69.internal';

-- ================================================================
-- 2. SALES_DAILY  (ยอดขายรายวัน)
-- ================================================================
-- ตรงกับ Sheet: Sales / ยอดขาย

create table public.sales_daily (
  id                  uuid        primary key default uuid_generate_v4(),
  date                date        not null unique,           -- วันที่ (unique: 1 แถวต่อวัน)
  total_cups          int         not null default 0,        -- ยอดขาย (แก้วรวม)
  kshop_amount        numeric(12,2) not null default 0,      -- K-Shop (฿)
  cash_amount         numeric(12,2) not null default 0,      -- เงินสด (฿)
  shopee_before_gp    numeric(12,2) not null default 0,      -- Shopee (ก่อน GP)
  grab_before_gp      numeric(12,2) not null default 0,      -- Grab (ก่อน GP)
  lineman_before_gp   numeric(12,2) not null default 0,      -- Lineman (ก่อน GP)
  free_cups           int         not null default 0,        -- แก้วฟรี
  free_cup_cost       numeric(12,2) not null default 0,      -- ต้นทุน/แก้วฟรี (฿)
  pastry_pieces       int         not null default 0,        -- ขนม (ชิ้น)
  pastry_revenue      numeric(12,2) not null default 0,      -- รายได้ขนม (฿)
  net_revenue         numeric(12,2) not null default 0,      -- รายรับสุทธิ (฿) — คำนวณจาก JS
  recorded_by         uuid        references public.profiles(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

comment on column public.sales_daily.net_revenue is
  'รายรับสุทธิ = kshop + cash + delivery(หัก GP%) + pastry - free_cup_cost';
comment on column public.sales_daily.shopee_before_gp is
  'ยอดก่อนหัก GP ~20% — Dashboard คำนวณยอดสุทธิเอง';

-- View สำหรับ summary รายเดือน
create or replace view public.v_sales_monthly as
select
  to_char(date, 'MM/YYYY')       as month_label,
  date_trunc('month', date)      as month_start,
  count(*)                       as days_count,
  sum(total_cups)                as total_cups,
  sum(net_revenue)               as total_net_revenue,
  sum(kshop_amount)              as total_kshop,
  sum(cash_amount)               as total_cash,
  sum(shopee_before_gp)          as total_shopee_before_gp,
  sum(grab_before_gp)            as total_grab_before_gp,
  sum(lineman_before_gp)         as total_lineman_before_gp,
  sum(pastry_revenue)            as total_pastry,
  sum(free_cup_cost)             as total_free_cup_cost
from public.sales_daily
group by 1, 2
order by 2 desc;

-- ================================================================
-- 3. EXPENSES  (รายจ่ายทั้งหมด — ตรงกับ CSV โครงสร้าง)
-- ================================================================
-- ครอบคลุม: วัตถุดิบ, ค่าขนม, รายจ่ายทั่วไป, ค่าดำเนินการ (OPEX)
-- Sheet: Data_Expenses + OPEX / ค่าดำเนินการ

create table public.expenses (
  id              uuid        primary key default uuid_generate_v4(),
  date            date        not null,                   -- วันที่
  month_label     text        not null default '',       -- MM/YYYY (set by trigger)
  category        text        not null,                   -- หมวดหมู่ใหญ่
  subcategory     text,                                   -- หมวดย่อย
  item_name       text        not null,                   -- รายการ
  item_key        text,                                   -- key สำหรับ OPEX (rent, internet, ...)
  unit_price      numeric(12,2),                          -- ราคาต่อหน่วย
  quantity        numeric(10,3) not null default 1,       -- จำนวน
  total_amount    numeric(12,2) not null,                 -- ยอด (฿)
  payment_method  text        not null default 'บัญชี หจก.',
  note            text,                                   -- หมายเหตุเพิ่มเติม
  recorded_by     uuid        references public.profiles(id) on delete set null,
  logged_at       timestamptz not null default now(),     -- เวลาที่บันทึก
  created_at      timestamptz not null default now()
);

-- ค่าที่รองรับใน category (อ้างอิงจาก Dashboard)
comment on column public.expenses.category is
  'ค่าใช้จ่ายดำเนินการ | ค่าแรงพนักงาน | ภาษีและอื่นๆ | วัตถุดิบ | ขนม | รายจ่ายทั่วไป';
comment on column public.expenses.item_key is
  'OPEX keys: rent, water, electric, trash, internet, account, repair, misc,
   salary_dir, staff_sub, emp1, emp2, vat — ใช้สำหรับ upsert / default values';

-- Unique constraint: ป้องกันบันทึกซ้ำ OPEX รายการเดิมในเดือนเดียวกัน
create unique index uidx_expenses_opex_item
  on public.expenses (month_label, item_key)
  where item_key is not null;

-- View สำหรับ summary expenses รายเดือน แยกหมวดหมู่
create or replace view public.v_expenses_monthly as
select
  month_label,
  category,
  sum(total_amount) as total
from public.expenses
group by month_label, category
order by month_label desc, category;

-- ================================================================
-- 4. EMPLOYEES  (ข้อมูลพนักงาน)
--
-- ⚠️ เลิกใช้แล้ว — ข้อมูลพนักงานจริงอยู่ใน business_config.emp_details
-- sql/cleanup_legacy_tables.sql ลบตารางนี้ทิ้ง (2026-09-09)
-- ================================================================

create table public.employees (
  id                  uuid        primary key default uuid_generate_v4(),
  emp_number          int         unique not null,         -- 1, 2, 3...
  label               text        not null,                -- "พนักงานคนที่ 1"
  full_name           text,
  nickname            text,
  title               text,                                -- ตำแหน่งงาน เช่น บาริสต้า
  id_card             text,
  bank_name           text,
  account_no          text,
  account_holder      text,
  base_salary         numeric(12,2) not null default 0,    -- เงินเดือน
  position_allowance  numeric(12,2) not null default 0,    -- ค่าตำแหน่ง
  commission_rate     numeric(6,4)  not null default 0,    -- อัตรา commission (0.0015 = 0.15%)
  sso_rate            numeric(5,4)  not null default 0.05, -- อัตราประกันสังคม
  is_active           boolean       not null default true,
  created_at          timestamptz   not null default now(),
  updated_at          timestamptz   not null default now()
);

-- ================================================================
-- 5. PAYROLL_MONTHLY  (บันทึกเงินเดือนรายเดือน)
--
-- ⚠️ เลิกใช้แล้ว — เงินเดือนคำนวณสดจาก lib/payslip.js และเก็บประวัติใน
-- business_config.emp_pay_history · sql/cleanup_legacy_tables.sql ลบตารางนี้ทิ้ง (2026-09-09)
-- ================================================================

create table public.payroll_monthly (
  id                  uuid        primary key default uuid_generate_v4(),
  employee_id         uuid        not null references public.employees(id) on delete restrict,
  month_label         text        not null,                -- MM/YYYY
  base_salary         numeric(12,2) not null default 0,
  position_allowance  numeric(12,2) not null default 0,
  commission_amount   numeric(12,2) not null default 0,
  diligence_bonus     numeric(12,2) not null default 0,    -- เบี้ยขยัน
  sso_employee        numeric(12,2) not null default 0,    -- ประกันสังคม (ลูกจ้าง)
  sso_company         numeric(12,2) not null default 0,    -- ประกันสังคม (บริษัท)
  commission_tax      numeric(12,2) not null default 0,    -- ภาษีหัก ณ ที่จ่าย commission
  net_transfer        numeric(12,2) not null default 0,    -- ยอดโอนสุทธิ
  company_cost        numeric(12,2) not null default 0,    -- ต้นทุนบริษัทรวม
  payment_method      text,
  slip_snapshot       jsonb,                               -- snapshot สำหรับพิมพ์ย้อนหลัง
  recorded_by         uuid        references public.profiles(id) on delete set null,
  created_at          timestamptz not null default now(),
  unique (employee_id, month_label)
);

-- ================================================================
-- 6. PRICE_LIST  (ราคาสินค้า / ขนม)
--
-- ⚠️ เลิกใช้แล้ว — ราคาอยู่ในแคตตาล็อกที่ expense-form สร้างจาก expenses เอง
-- นโยบายอ่านของเดิม "using (true)" เปิดถึง role anon ด้วย (ไม่มี to authenticated)
-- sql/cleanup_legacy_tables.sql รัดนโยบายแล้วลบตารางนี้ทิ้ง (2026-09-09)
-- ================================================================

create table public.price_list (
  id          uuid    primary key default uuid_generate_v4(),
  category    text    not null,          -- เช่น ขนม, เครื่องดื่ม
  item_name   text    not null,
  price       numeric(10,2) not null,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (category, item_name)
);

-- ================================================================
-- 7. BUSINESS_CONFIG  (ตั้งค่าบริษัท — แทน Script Properties GAS)
-- ================================================================

create table public.business_config (
  key         text    primary key,       -- biz_info, opex_defaults, emp_details_1, ...
  value       jsonb   not null default '{}',
  updated_by  uuid    references public.profiles(id) on delete set null,
  updated_at  timestamptz not null default now()
);

-- Seed ค่าเริ่มต้น
insert into public.business_config (key, value) values
  ('biz_info',      '{"name":"","phone":"","tax_id":"","address":"","logo_url":""}'),
  ('opex_defaults', '{}')
on conflict (key) do nothing;

-- ================================================================
-- 8. AUDIT_LOG  (ประวัติการแก้ไข)
-- ================================================================

create table public.audit_log (
  id            uuid        primary key default uuid_generate_v4(),
  table_name    text        not null,
  record_id     uuid,
  action        text        not null check (action in ('INSERT','UPDATE','DELETE')),
  old_data      jsonb,
  new_data      jsonb,
  performed_by  uuid        references public.profiles(id) on delete set null,
  performed_at  timestamptz not null default now()
);

-- ================================================================
-- INDEXES
-- ================================================================

create index idx_sales_date         on public.sales_daily(date desc);
create index idx_expenses_date      on public.expenses(date desc);
create index idx_expenses_month     on public.expenses(month_label);
create index idx_expenses_category  on public.expenses(category);
create index idx_expenses_key       on public.expenses(item_key) where item_key is not null;
create index idx_payroll_month      on public.payroll_monthly(month_label);
create index idx_payroll_emp        on public.payroll_monthly(employee_id);
create index idx_audit_table_time   on public.audit_log(table_name, performed_at desc);

-- ================================================================
-- TRIGGERS: updated_at อัตโนมัติ
-- ================================================================

create or replace function public.fn_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end; $$;


-- ================================================================
-- TRIGGER: auto-set month_label บน expenses
-- ================================================================

create or replace function public.fn_set_month_label()
returns trigger language plpgsql as $$
begin
  new.month_label := to_char(new.date, 'MM/YYYY');
  return new;
end; $$;

create trigger tr_expenses_month_label
  before insert or update of date on public.expenses
  for each row execute function public.fn_set_month_label();

create trigger tr_profiles_updated_at
  before update on public.profiles
  for each row execute function public.fn_set_updated_at();

create trigger tr_employees_updated_at
  before update on public.employees
  for each row execute function public.fn_set_updated_at();

create trigger tr_sales_updated_at
  before update on public.sales_daily
  for each row execute function public.fn_set_updated_at();

-- ================================================================
-- TRIGGER: auto-create profile เมื่อ Supabase Auth สร้าง user ใหม่
-- ================================================================
-- Login: supabase.auth.signInWithPassword({
--   email: username + '@marim69.internal', password })
-- signup payload metadata: { username, full_name, nickname, role }

create or replace function public.fn_on_auth_user_created()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, username, full_name, nickname, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'username', split_part(new.email,'@',1)),
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    coalesce(new.raw_user_meta_data->>'nickname', ''),
    coalesce(new.raw_user_meta_data->>'role', 'manager')
  )
  on conflict (id) do nothing;
  return new;
end; $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.fn_on_auth_user_created();

-- ================================================================
-- TRIGGER: audit log อัตโนมัติสำหรับ sales_daily และ expenses
-- ================================================================

create or replace function public.fn_audit_log()
returns trigger language plpgsql security definer as $$
declare
  _user_id uuid := auth.uid();
begin
  if (tg_op = 'INSERT') then
    insert into public.audit_log(table_name, record_id, action, new_data, performed_by)
    values (tg_table_name, new.id, 'INSERT', to_jsonb(new), _user_id);
  elsif (tg_op = 'UPDATE') then
    insert into public.audit_log(table_name, record_id, action, old_data, new_data, performed_by)
    values (tg_table_name, new.id, 'UPDATE', to_jsonb(old), to_jsonb(new), _user_id);
  elsif (tg_op = 'DELETE') then
    insert into public.audit_log(table_name, record_id, action, old_data, performed_by)
    values (tg_table_name, old.id, 'DELETE', to_jsonb(old), _user_id);
  end if;
  return coalesce(new, old);
end; $$;

create trigger tr_audit_sales
  after insert or update or delete on public.sales_daily
  for each row execute function public.fn_audit_log();

create trigger tr_audit_expenses
  after insert or update or delete on public.expenses
  for each row execute function public.fn_audit_log();

-- ================================================================
-- ROW LEVEL SECURITY (RLS)
-- ================================================================

alter table public.profiles         enable row level security;
alter table public.sales_daily      enable row level security;
alter table public.expenses         enable row level security;
alter table public.employees        enable row level security;
alter table public.payroll_monthly  enable row level security;
alter table public.price_list       enable row level security;
alter table public.business_config  enable row level security;
alter table public.audit_log        enable row level security;

-- Helper: ดึง role ของ user ปัจจุบัน
create or replace function public.fn_my_role()
returns text language sql security definer stable as $$
  select role from public.profiles where id = auth.uid()
$$;

-- ── profiles ──────────────────────────────────────────────────
create policy "profiles: read all authenticated"
  on public.profiles for select
  using (auth.role() = 'authenticated');

create policy "profiles: update own"
  on public.profiles for update
  using (id = auth.uid());

create policy "profiles: admin full access"
  on public.profiles for all
  using (public.fn_my_role() = 'admin');

-- ── sales_daily ───────────────────────────────────────────────
create policy "sales: read authenticated"
  on public.sales_daily for select
  using (auth.role() = 'authenticated');

create policy "sales: insert authenticated"
  on public.sales_daily for insert
  with check (auth.role() = 'authenticated');

create policy "sales: update authenticated"
  on public.sales_daily for update
  using (auth.role() = 'authenticated');

create policy "sales: delete admin only"
  on public.sales_daily for delete
  using (public.fn_my_role() = 'admin');

-- ── expenses ──────────────────────────────────────────────────
create policy "expenses: read authenticated"
  on public.expenses for select
  using (auth.role() = 'authenticated');

create policy "expenses: insert authenticated"
  on public.expenses for insert
  with check (auth.role() = 'authenticated');

create policy "expenses: update authenticated"
  on public.expenses for update
  using (auth.role() = 'authenticated');

create policy "expenses: delete admin only"
  on public.expenses for delete
  using (public.fn_my_role() = 'admin');

-- ── employees ─────────────────────────────────────────────────
create policy "employees: read authenticated"
  on public.employees for select
  using (auth.role() = 'authenticated');

create policy "employees: write admin only"
  on public.employees for all
  using (public.fn_my_role() = 'admin');

-- ── payroll_monthly ───────────────────────────────────────────
create policy "payroll: read authenticated"
  on public.payroll_monthly for select
  using (auth.role() = 'authenticated');

create policy "payroll: insert authenticated"
  on public.payroll_monthly for insert
  with check (auth.role() = 'authenticated');

create policy "payroll: update authenticated"
  on public.payroll_monthly for update
  using (auth.role() = 'authenticated');

create policy "payroll: delete admin only"
  on public.payroll_monthly for delete
  using (public.fn_my_role() = 'admin');

-- ── price_list ────────────────────────────────────────────────
create policy "price_list: read all"
  on public.price_list for select
  using (true);

create policy "price_list: write admin only"
  on public.price_list for all
  using (public.fn_my_role() = 'admin');

-- ── business_config ───────────────────────────────────────────
-- ทุก role อ่าน/เขียนได้ (แก้ปัญหา manager ถูกบล็อกใน GAS เดิม)
create policy "config: read authenticated"
  on public.business_config for select
  using (auth.role() = 'authenticated');

create policy "config: write authenticated"
  on public.business_config for insert
  with check (auth.role() = 'authenticated');

create policy "config: update authenticated"
  on public.business_config for update
  using (auth.role() = 'authenticated');

-- ── audit_log ─────────────────────────────────────────────────
create policy "audit: read authenticated"
  on public.audit_log for select
  using (auth.role() = 'authenticated');

-- ================================================================
-- HELPER RPCs (เรียกจาก Dashboard แทน GAS endpoints)
-- ================================================================

-- upsert ยอดขายรายวัน (ป้องกัน dup)
create or replace function public.upsert_sales_daily(p_data jsonb)
returns public.sales_daily language plpgsql security definer as $$
declare
  _result public.sales_daily;
begin
  insert into public.sales_daily (
    date, total_cups, kshop_amount, cash_amount,
    shopee_before_gp, grab_before_gp, lineman_before_gp,
    free_cups, free_cup_cost, pastry_pieces, pastry_revenue,
    net_revenue, recorded_by
  ) values (
    (p_data->>'date')::date,
    (p_data->>'total_cups')::int,
    (p_data->>'kshop_amount')::numeric,
    (p_data->>'cash_amount')::numeric,
    (p_data->>'shopee_before_gp')::numeric,
    (p_data->>'grab_before_gp')::numeric,
    (p_data->>'lineman_before_gp')::numeric,
    (p_data->>'free_cups')::int,
    (p_data->>'free_cup_cost')::numeric,
    (p_data->>'pastry_pieces')::int,
    (p_data->>'pastry_revenue')::numeric,
    (p_data->>'net_revenue')::numeric,
    auth.uid()
  )
  on conflict (date) do update set
    total_cups          = excluded.total_cups,
    kshop_amount        = excluded.kshop_amount,
    cash_amount         = excluded.cash_amount,
    shopee_before_gp    = excluded.shopee_before_gp,
    grab_before_gp      = excluded.grab_before_gp,
    lineman_before_gp   = excluded.lineman_before_gp,
    free_cups           = excluded.free_cups,
    free_cup_cost       = excluded.free_cup_cost,
    pastry_pieces       = excluded.pastry_pieces,
    pastry_revenue      = excluded.pastry_revenue,
    net_revenue         = excluded.net_revenue,
    updated_at          = now()
  returning * into _result;
  return _result;
end; $$;

-- upsert OPEX item (ป้องกัน dup ด้วย item_key + month)
create or replace function public.upsert_opex_item(p_data jsonb)
returns public.expenses language plpgsql security definer as $$
declare
  _result public.expenses;
  _date   date := date_trunc('month',
                    to_date(p_data->>'month_label', 'MM/YYYY'))::date
                  + interval '1 day' - interval '1 day';
begin
  -- ใช้วันสุดท้ายของเดือนเป็น date ของ OPEX entry
  _date := (date_trunc('month', to_date(p_data->>'month_label','MM/YYYY'))
            + interval '1 month - 1 day')::date;

  insert into public.expenses (
    date, category, subcategory, item_name, item_key,
    unit_price, quantity, total_amount, payment_method, recorded_by
  ) values (
    _date,
    coalesce(p_data->>'category', 'ค่าใช้จ่ายดำเนินการ'),
    p_data->>'subcategory',
    p_data->>'item_name',
    p_data->>'item_key',
    (p_data->>'unit_price')::numeric,
    coalesce((p_data->>'quantity')::numeric, 1),
    (p_data->>'total_amount')::numeric,
    coalesce(p_data->>'payment_method', 'บัญชี หจก.'),
    auth.uid()
  )
  on conflict on constraint uidx_expenses_opex_item do update set
    item_name      = excluded.item_name,
    total_amount   = excluded.total_amount,
    payment_method = excluded.payment_method,
    recorded_by    = auth.uid(),
    created_at     = now()
  returning * into _result;
  return _result;
end; $$;

-- get_monthly_summary: ดึงข้อมูลรายเดือน (แทน GAS export endpoint)
create or replace function public.get_monthly_summary(p_month_label text)
returns jsonb language plpgsql security definer stable as $$
declare
  _sales    jsonb;
  _expenses jsonb;
begin
  select jsonb_agg(row_to_json(s)) into _sales
  from public.sales_daily s
  where to_char(s.date, 'MM/YYYY') = p_month_label;

  select jsonb_agg(row_to_json(e)) into _expenses
  from public.expenses e
  where e.month_label = p_month_label;

  return jsonb_build_object(
    'month',    p_month_label,
    'sales',    coalesce(_sales, '[]'),
    'expenses', coalesce(_expenses, '[]')
  );
end; $$;

-- ================================================================
-- SAMPLE DATA (จาก CSV ที่อัปโหลด)
-- ================================================================
-- หมายเหตุ: ใช้หลังจาก create user admin แล้ว
-- insert into public.expenses
--   (date, category, subcategory, item_name, item_key, unit_price, quantity, total_amount, payment_method)
-- values
--   ('2026-06-01','ค่าใช้จ่ายดำเนินการ','ค่าดำเนินการ','ค่าอินเทอร์เน็ต','internet',319,1,319,'บัญชี หจก.'),
--   ('2026-06-01','ค่าใช้จ่ายดำเนินการ','ค่าดำเนินการ','ค่าเช่าร้าน','rent',5000,1,5000,'บัญชี หจก.');

-- ================================================================
-- SETUP GUIDE
-- ================================================================
-- 1. วิธี Login จาก Dashboard:
--    supabase.auth.signInWithPassword({
--      email: username + '@marim69.internal',
--      password: password
--    })
--
-- 2. วิธีสร้าง user ใหม่ (admin เท่านั้น — ผ่าน Supabase Dashboard):
--    supabase.auth.admin.createUser({
--      email: 'siwat@marim69.internal',
--      password: 'xxx',
--      user_metadata: { username:'siwat', full_name:'สิวัตร', role:'admin' }
--    })
--
-- 3. RPC calls แทน GAS:
--    supabase.rpc('upsert_sales_daily', { p_data: {...} })
--    supabase.rpc('upsert_opex_item',   { p_data: {...} })
--    supabase.rpc('get_monthly_summary', { p_month_label: '06/2026' })
--
-- 4. Direct query:
--    supabase.from('sales_daily').select('*').eq('date','2026-06-01')
--    supabase.from('expenses').select('*').eq('month_label','06/2026')
-- ================================================================
