-- ================================================================
-- harden_loyalty_integrity.sql — ปิดช่องโหว่เชิงข้อมูลของระบบสะสมแต้ม
-- รันหลัง: add_loyalty_system → harden_loyalty_rls → harden_loyalty_writes
--          → add_loyalty_indexes → harden_loyalty_reads → add_loyalty_rewards
-- Idempotent — รันซ้ำใน Supabase SQL Editor ได้ปลอดภัย
--
-- แก้ 5 เรื่อง:
--  1) fn_rfm_segment() — สูตร RFM แหล่งเดียว (เดิมฝังอยู่ใน trigger)
--  2) fn_on_point_transaction() — ไม่นับรายการ void (adjust) เป็นการมาใช้บริการ
--     เดิม: void 1 ครั้ง = visit_count +1 (ยกเลิกธุรกรรมแล้วลูกค้ากลับดู active ขึ้น)
--  3) get_loyalty_segment_counts() — นับ RFM/แต้มคงค้างฝั่ง DB แบบสดเสมอ
--     เดิมหน้า CDP ดึง customers ทั้งตารางมานับใน Node และอ่านคอลัมน์ rfm_segment
--     ที่ค้างอยู่ (trigger ยิงเฉพาะตอนมีธุรกรรม → คนที่หายไปไม่มีวันเป็น At-Risk/Lost)
--  4) uidx_point_tx_earn_receipt — ใบเสร็จใบเดียวแจกแต้มได้ครั้งเดียวต่อสาขา
--  5) loyalty_redeem_reward() — หักแต้ม + ลงประวัติแลก ในทรานแซกชันเดียว
--     เดิมแยก insert 2 ครั้ง ถ้าอันที่สองพลาด = แต้มหายแต่ไม่มีประวัติการแลก
-- ================================================================

-- ── 1) สูตร RFM แหล่งเดียว ──────────────────────────────────────
-- มีคู่แฝดฝั่ง JS ที่ lib/rfm.js (ใช้ตอนโชว์ป้ายลูกค้ารายคน) — แก้ที่ไหนต้องแก้อีกที่
create or replace function public.fn_rfm_segment(
  p_visit_count int,
  p_last_visited_at timestamptz
)
returns text
language sql
stable
as $fn$
  select case
    when coalesce(p_visit_count, 0) = 0 or p_last_visited_at is null then 'New'
    when p_visit_count >= 10 and now() - p_last_visited_at <= interval '14 days' then 'Champions'
    when p_visit_count >= 5  and now() - p_last_visited_at <= interval '30 days' then 'Loyal'
    when now() - p_last_visited_at > interval '60 days' then 'Lost'
    when now() - p_last_visited_at > interval '30 days' then 'At-Risk'
    else 'Potential'
  end;
$fn$;

comment on function public.fn_rfm_segment(int, timestamptz) is
  'สูตรจัดกลุ่มลูกค้า RFM — แหล่งเดียวของระบบ (คู่แฝดฝั่ง JS: lib/rfm.js)';

-- ── 2) trigger: ไม่นับ adjust (void) เป็นการมาใช้บริการ ─────────
create or replace function public.fn_on_point_transaction()
returns trigger language plpgsql security definer as $tg$
declare
  _total_points int;
  _visit_cnt    int;
  _last_visit   timestamptz;
begin
  -- ยอดแต้ม = ผลรวมทุกรายการ (รวม adjust เพราะ void ต้องคืน/หักแต้มจริง)
  -- แต่ จำนวนครั้งที่มา และ มาล่าสุด นับเฉพาะ earn/redeem — void ไม่ใช่การมาร้าน
  select
    coalesce(sum(points), 0),
    count(*)        filter (where transaction_type in ('earn', 'redeem')),
    max(created_at) filter (where transaction_type in ('earn', 'redeem'))
  into _total_points, _visit_cnt, _last_visit
  from public.point_transactions
  where customer_id = NEW.customer_id;

  if _total_points < 0 then
    raise exception 'แต้มคงเหลือไม่เพียงพอ (Points balance cannot be negative)';
  end if;

  update public.customers
  set points_balance     = _total_points,
      visit_count        = coalesce(_visit_cnt, 0),
      last_visited_at    = _last_visit,
      rfm_segment        = public.fn_rfm_segment(coalesce(_visit_cnt, 0), _last_visit),
      favorite_branch_id = coalesce(favorite_branch_id, NEW.branch_id)
  where id = NEW.customer_id;

  return NEW;
end; $tg$;

-- ── 2b) คำนวณย้อนหลังให้ข้อมูลเดิมตรงตามกติกาใหม่ ───────────────
-- tr_customers_guard_points (harden_loyalty_rls.sql) บล็อกการแก้แต้มที่ depth 0
-- จึงต้องปิดชั่วคราวเฉพาะช่วง backfill นี้
do $backfill$
begin
  if exists (select 1 from pg_trigger where tgname = 'tr_customers_guard_points') then
    alter table public.customers disable trigger tr_customers_guard_points;
  end if;

  update public.customers c
  set points_balance  = coalesce(s.pts, 0),
      visit_count     = coalesce(s.visits, 0),
      last_visited_at = s.last_at,
      rfm_segment     = public.fn_rfm_segment(coalesce(s.visits, 0), s.last_at)
  from (
    select
      customer_id,
      sum(points)     as pts,
      count(*)        filter (where transaction_type in ('earn', 'redeem')) as visits,
      max(created_at) filter (where transaction_type in ('earn', 'redeem')) as last_at
    from public.point_transactions
    group by customer_id
  ) s
  where s.customer_id = c.id;

  update public.customers c
  set points_balance = 0, visit_count = 0, last_visited_at = null, rfm_segment = 'New'
  where not exists (select 1 from public.point_transactions t where t.customer_id = c.id)
    and (c.points_balance <> 0 or c.visit_count <> 0 or c.rfm_segment <> 'New');

  if exists (select 1 from pg_trigger where tgname = 'tr_customers_guard_points') then
    alter table public.customers enable trigger tr_customers_guard_points;
  end if;
end
$backfill$;

-- ── 3) นับ RFM / แต้มคงค้างฝั่ง DB (แทนการดึง customers ทั้งตาราง) ──
create or replace function public.get_loyalty_segment_counts()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $seg$
declare _out jsonb;
begin
  if public.fn_my_role() not in ('admin', 'co-admin', 'manager') then
    raise exception 'ไม่มีสิทธิ์ดูสถิติลูกค้า';
  end if;

  select jsonb_build_object(
    'total', (select count(*) from public.customers),
    'points_outstanding', (select coalesce(sum(points_balance), 0) from public.customers),
    'segments', coalesce(
      (select jsonb_object_agg(seg, cnt) from (
         select public.fn_rfm_segment(visit_count, last_visited_at) as seg, count(*) as cnt
         from public.customers
         group by 1
       ) t),
      '{}'::jsonb
    )
  ) into _out;

  return _out;
end; $seg$;

revoke all on function public.get_loyalty_segment_counts() from public;
grant execute on function public.get_loyalty_segment_counts() to authenticated;

-- ── 4) ใบเสร็จซ้ำ = แจกแต้มซ้ำไม่ได้ (ต่อสาขา ไม่สนตัวพิมพ์/ช่องว่าง) ──
-- ถ้ามีข้อมูลซ้ำอยู่ก่อนแล้วจะข้ามการสร้าง index และแจ้งเตือน (ไม่ทำให้ทั้งไฟล์ล้ม)
-- ดูรายการซ้ำ:
--   select branch_id, lower(trim(receipt_number)) rn, count(*), array_agg(id)
--   from public.point_transactions
--   where transaction_type = 'earn' and coalesce(trim(receipt_number), '') <> ''
--   group by 1, 2 having count(*) > 1;
do $receipt$
declare _dupes int;
begin
  select count(*) into _dupes from (
    select branch_id, lower(trim(receipt_number))
    from public.point_transactions
    where transaction_type = 'earn'
      and coalesce(trim(receipt_number), '') <> ''
    group by 1, 2
    having count(*) > 1
  ) d;

  if _dupes > 0 then
    raise notice 'ข้ามการสร้าง uidx_point_tx_earn_receipt: พบใบเสร็จซ้ำอยู่ก่อนแล้ว % ชุด — void รายการซ้ำก่อน แล้วรันไฟล์นี้ใหม่', _dupes;
  else
    create unique index if not exists uidx_point_tx_earn_receipt
      on public.point_transactions (branch_id, lower(trim(receipt_number)))
      where transaction_type = 'earn' and coalesce(trim(receipt_number), '') <> '';
  end if;
end
$receipt$;

-- ── 5) แลกรางวัลแบบอะตอมมิก (หักแต้ม + ประวัติ + audit ในทรานแซกชันเดียว) ──
create or replace function public.loyalty_redeem_reward(
  p_customer_id uuid,
  p_reward_id   text,
  p_branch_id   uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $redeem$
declare
  _uid    uuid := auth.uid();
  _role   text;
  _sp     public.staff_profiles%rowtype;
  _branch public.branches%rowtype;
  _reward public.loyalty_rewards%rowtype;
  _cust   public.customers%rowtype;
  _target uuid;
  _tx_id  uuid;
begin
  if _uid is null then
    return jsonb_build_object('status', 'error', 'message', 'กรุณาเข้าสู่ระบบ');
  end if;

  select * into _sp from public.staff_profiles where user_id = _uid limit 1;
  if not found then
    return jsonb_build_object('status', 'error',
      'message', 'บัญชียังไม่ได้ผูกกับสาขา — ให้ Admin ตั้งค่าที่ /admin/loyalty ก่อนใช้งาน');
  end if;

  -- staff ล็อกสาขาตัวเองเสมอ (กัน spoof) — manager+ เลือกสาขาอื่นได้
  _role := public.fn_my_role();
  if _role in ('admin', 'co-admin', 'manager') then
    _target := coalesce(p_branch_id, _sp.branch_id);
  else
    _target := _sp.branch_id;
  end if;

  select * into _branch from public.branches where id = _target;
  if not found or _branch.is_active = false then
    return jsonb_build_object('status', 'error', 'message', 'สาขาที่เลือกไม่พร้อมใช้งาน');
  end if;

  select * into _reward from public.loyalty_rewards
  where id = p_reward_id and is_active;
  if not found then
    return jsonb_build_object('status', 'error', 'message', 'ไม่พบรางวัลนี้ในระบบ หรือถูกปิดใช้งาน');
  end if;

  -- ล็อกแถวลูกค้า → กันแลกซ้อนพร้อมกันสองเครื่องแล้วแต้มติดลบ
  select * into _cust from public.customers where id = p_customer_id for update;
  if not found then
    return jsonb_build_object('status', 'error', 'message', 'ไม่พบข้อมูลลูกค้า');
  end if;

  if _cust.points_balance < _reward.points then
    return jsonb_build_object('status', 'error',
      'message', format('แต้มสะสมไม่เพียงพอ (แต้มที่มี: %s แต้ม)', _cust.points_balance));
  end if;

  insert into public.point_transactions (
    customer_id, staff_id, branch_id, points, transaction_type, note
  ) values (
    p_customer_id, _uid, _target, -_reward.points, 'redeem',
    'แลกรางวัล: ' || _reward.name
  )
  returning id into _tx_id;

  insert into public.redemption_history (
    customer_id, reward_id, reward_name, points_used, branch_id, staff_id
  ) values (
    p_customer_id, _reward.id, _reward.name, _reward.points, _target, _uid
  );

  insert into public.loyalty_audit_logs (
    action_type, performed_by_staff_id, customer_id, branch_id, details
  ) values (
    'REDEEM_REWARD', _uid, p_customer_id, _target,
    jsonb_build_object(
      'reward_id', _reward.id,
      'reward_name', _reward.name,
      'points_used', _reward.points,
      'tx_id', _tx_id,
      'staff_code', _sp.staff_code
    )
  );

  return jsonb_build_object(
    'status', 'ok',
    'message', format('แลกของรางวัล "%s" สำเร็จ (-%s แต้ม) ที่%s',
                      _reward.name, _reward.points, _branch.name),
    'points_used', _reward.points,
    'tx_id', _tx_id
  );
end; $redeem$;

revoke all on function public.loyalty_redeem_reward(uuid, text, uuid) from public;
grant execute on function public.loyalty_redeem_reward(uuid, text, uuid) to authenticated;
