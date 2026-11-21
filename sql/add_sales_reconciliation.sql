-- Run after add_sales_day_edit_grants.sql and add_sales_close_evidence.sql.
-- Creates separate reconciliation records; never backfills or changes sales/expenses.
begin;
create table if not exists public.sales_closings (
  id uuid primary key default gen_random_uuid(),
  sales_date date not null unique references public.sales_daily(date) on delete restrict,
  printed_pos numeric(14,2) not null check (printed_pos >= 0),
  opening_float numeric(14,2) not null check (opening_float >= 0),
  cash_count numeric(14,2) not null check (cash_count >= 0),
  cash_in numeric(14,2) not null check (cash_in >= 0),
  cash_out numeric(14,2) not null check (cash_out >= 0),
  sales_snapshot jsonb not null,
  expected_pos numeric(14,2) not null,
  expected_cash numeric(14,2) not null check (expected_cash >= 0),
  pos_difference numeric(14,2) not null,
  cash_difference numeric(14,2) not null,
  note text not null check (length(note) <= 1000),
  version integer not null default 1,
  created_by uuid not null references public.profiles(id),
  updated_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.platform_settlements (
  id uuid primary key default gen_random_uuid(),
  platform text not null check (platform in ('grab','lineman','shopee')),
  period_from date not null,
  period_to date not null check (period_to >= period_from and period_to - period_from <= 365),
  reference text not null check (length(btrim(reference)) between 1 and 120),
  due_date date,
  gross numeric(14,2) not null check (gross >= 0),
  commission numeric(14,2) not null check (commission >= 0),
  fees numeric(14,2) not null check (fees >= 0),
  discounts numeric(14,2) not null check (discounts >= 0),
  refunds numeric(14,2) not null check (refunds >= 0),
  withholding numeric(14,2) not null check (withholding >= 0),
  additions numeric(14,2) not null check (additions >= 0),
  deductions numeric(14,2) not null check (deductions >= 0),
  expected_net numeric(14,2) not null check (expected_net >= 0),
  note text not null check (length(note) <= 1000),
  version integer not null default 1,
  created_by uuid not null references public.profiles(id),
  updated_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  voided_at timestamptz,
  void_reason text
);
create unique index if not exists platform_settlement_reference on public.platform_settlements(platform, lower(btrim(reference)));
create index if not exists platform_settlement_period on public.platform_settlements(period_to, period_from);
create table if not exists public.platform_receipts (
  id uuid primary key default gen_random_uuid(),
  settlement_id uuid not null references public.platform_settlements(id) on delete restrict,
  received_date date not null,
  amount numeric(14,2) not null check (amount > 0),
  bank_reference text not null check (length(btrim(bank_reference)) between 1 and 120),
  note text not null check (length(note) <= 1000),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  voided_at timestamptz,
  voided_by uuid references public.profiles(id),
  void_reason text
);
-- References remain reserved after void, preserving the original bank transfer trail.
create unique index if not exists platform_receipt_bank_reference on public.platform_receipts(lower(btrim(bank_reference)));
create index if not exists platform_receipt_settlement on public.platform_receipts(settlement_id);
create table if not exists public.reconciliation_commands (
  id uuid primary key,
  actor_id uuid not null references public.profiles(id),
  command text not null,
  payload jsonb not null,
  response jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.sales_closings enable row level security;
alter table public.platform_settlements enable row level security;
alter table public.platform_receipts enable row level security;
alter table public.reconciliation_commands enable row level security;
revoke all on public.sales_closings, public.platform_settlements, public.platform_receipts,
  public.reconciliation_commands from public, anon, authenticated;

create or replace function public.fn_reconciliation_access(p_write boolean default false)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = auth.uid() and is_active
    and role in ('admin','co-admin','manager'))
    and public.fn_page_cap('/sales', case when p_write then 'edit' else 'view' end)
    and public.fn_page_cap('/reports','view');
$$;

create or replace function public.fn_reconciliation_snapshot(p_sales public.sales_daily)
returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object('cash_amount', round(p_sales.cash_amount,2),
    'kshop_amount', round(p_sales.kshop_amount,2), 'lineman_before_gp', round(p_sales.lineman_before_gp,2),
    'grab_before_gp', round(p_sales.grab_before_gp,2), 'shopee_before_gp', round(p_sales.shopee_before_gp,2));
$$;

create or replace function public.sales_closing_state(p_date date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare s public.sales_daily; c public.sales_closings; r text;
begin
  select role into r from public.profiles where id = auth.uid() and is_active;
  if r is null or not public.fn_page_cap('/sales','view') or
    (r = 'staff' and p_date <> (statement_timestamp() at time zone 'Asia/Bangkok')::date) or
    r not in ('admin','co-admin','manager','staff') then raise exception 'ไม่มีสิทธิ์ดูการปิดร้าน'; end if;
  select * into s from public.sales_daily where date = p_date;
  select * into c from public.sales_closings where sales_date = p_date;
  return jsonb_build_object('closing',case when c.id is null then null else to_jsonb(c) end,
    'stale', c.id is not null and c.sales_snapshot is distinct from public.fn_reconciliation_snapshot(s));
end $$;

create or replace function public.platform_reconciliation_state(p_month date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  if not public.fn_reconciliation_access(false) then raise exception 'ไม่มีสิทธิ์ดูกระทบยอดแพลตฟอร์ม'; end if;
  if p_month is null or p_month <> date_trunc('month',p_month)::date then raise exception 'เดือนไม่ถูกต้อง'; end if;
  select coalesce(jsonb_agg(q.item order by q.period_to desc, q.id), '[]'::jsonb) into result from (
    select t.id,t.period_to, to_jsonb(t) || jsonb_build_object(
      'sales_gross', coalesce(s.gross,0), 'missing_days', t.period_to - t.period_from + 1 - s.days,
      'sales_difference', t.gross - coalesce(s.gross,0), 'received_total',coalesce(p.total,0),
      'receipts',coalesce(p.receipts,'[]'::jsonb)) as item
    from public.platform_settlements t
    cross join lateral (select count(*)::integer as days, sum(case t.platform
      when 'grab' then d.grab_before_gp when 'lineman' then d.lineman_before_gp
      else d.shopee_before_gp end) as gross from public.sales_daily d
      where d.date between t.period_from and t.period_to) s
    cross join lateral (select sum(r.amount) filter (where r.voided_at is null) as total,
      jsonb_agg(to_jsonb(r) order by r.received_date,r.created_at) as receipts
      from public.platform_receipts r where r.settlement_id=t.id) p
    where t.period_from < (p_month + interval '1 month')::date and t.period_to >= p_month
  ) q;
  return result;
end $$;

-- Validate amounts in PostgreSQL as well as the Server Action. Reject invalid/rounded input.
create or replace function public.fn_reconciliation_money(p_data jsonb,p_key text)
returns numeric language plpgsql immutable set search_path = '' as $$
declare v text := p_data->>p_key;
begin
  if v is null or v !~ '^[0-9]+([.][0-9]{1,2})?$' or v::numeric > 999999999.99 then
    raise exception 'จำนวนเงินไม่ถูกต้อง: %',p_key;
  end if;
  return v::numeric;
end $$;

create or replace function public.reconciliation_command(p_command text,p_data jsonb,p_request uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
#variable_conflict use_variable
<<command_vars>>
declare
  actor uuid := auth.uid(); r text; prior public.reconciliation_commands; response jsonb;
  s public.sales_daily; c public.sales_closings; t public.platform_settlements; receipt public.platform_receipts;
  snapshot jsonb; v integer; d date; id uuid; note text; reason text; n numeric; amount numeric;
  printed numeric; opening numeric; counted numeric; cin numeric; cout numeric; expected numeric; pos numeric;
  gross numeric; commission numeric; fees numeric; discounts numeric; refunds numeric; withholding numeric;
  additions numeric; deductions numeric; reference text; platform text; pfrom date; pto date;
  today date := (statement_timestamp() at time zone 'Asia/Bangkok')::date;
begin
  select p.role into r from public.profiles p where p.id=actor and p.is_active;
  if r is null then raise exception 'กรุณาเข้าสู่ระบบด้วยบัญชีที่ใช้งานได้'; end if;
  if p_request is null or jsonb_typeof(p_data) is distinct from 'object' then raise exception 'ข้อมูลไม่ถูกต้อง'; end if;
  if p_command <> 'close.save' and not public.fn_reconciliation_access(true) then raise exception 'ไม่มีสิทธิ์แก้ไขกระทบยอดแพลตฟอร์ม'; end if;
  if p_command = 'close.save' and (r not in ('admin','co-admin','manager','staff') or not public.fn_page_cap('/sales','create')) then
    raise exception 'ไม่มีสิทธิ์บันทึกการปิดร้าน'; end if;
  perform pg_advisory_xact_lock(hashtextextended('reconciliation-request:' || p_request::text,0));
  select * into prior from public.reconciliation_commands rc where rc.id=p_request;
  if found then
    if prior.actor_id <> actor or prior.command <> p_command or prior.payload <> p_data then raise exception 'รหัสคำขอถูกใช้กับข้อมูลอื่น กรุณาเปิดหน้าใหม่'; end if;
    return prior.response;
  end if;
  -- One shop, infrequent reconciliation commands: serialize edits, overlap checks and receipts.
  perform pg_advisory_xact_lock(hashtextextended('reconciliation-write',0));
  if (select count(*) from public.reconciliation_commands where actor_id=actor and created_at>now()-interval '1 minute')>=30 then
    raise exception 'บันทึกถี่เกินไป กรุณารอสักครู่'; end if;
  if (p_data->>'version') is null or (p_data->>'version') !~ '^[0-9]{1,9}$' then raise exception 'เวอร์ชันไม่ถูกต้อง'; end if;
  v := (p_data->>'version')::integer;
  note := btrim(coalesce(p_data->>'note',''));
  if length(note)>1000 then raise exception 'หมายเหตุยาวเกิน 1000 ตัวอักษร'; end if;
  if p_command='close.save' then
    d := (p_data->>'date')::date;
    select * into s from public.sales_daily where date=d for update;
    if not found then raise exception 'บันทึกยอดขายของวันนี้ก่อนปิดร้าน'; end if;
    select * into c from public.sales_closings where sales_date=d for update;
    if r='staff' then
      if d<>today or s.recorded_by<>actor then raise exception 'ปิดร้านได้เฉพาะวันนี้ที่คุณบันทึกยอดขาย'; end if;
      if c.id is not null and not public.fn_can_edit_sales_today() then raise exception 'บันทึกแล้ว ให้ผู้จัดการเป็นผู้แก้ไข'; end if;
    elsif not public.fn_page_cap('/sales','edit') then raise exception 'ไม่มีสิทธิ์ปิดร้าน'; end if;
    if coalesce(c.version,0)<>v then raise exception 'ข้อมูลเปลี่ยนแล้ว กรุณาเปิดหน้าใหม่ก่อนแก้ไข'; end if;
    snapshot := public.fn_reconciliation_snapshot(s);
    if p_data->'sales_snapshot' is distinct from snapshot then raise exception 'ยอดขายเปลี่ยนแล้ว กรุณาเปิดหน้าใหม่ก่อนปิดร้าน'; end if;
    printed:=public.fn_reconciliation_money(p_data,'printed_pos');
    opening:=public.fn_reconciliation_money(p_data,'opening_float');
    counted:=public.fn_reconciliation_money(p_data,'cash_count');
    cin:=public.fn_reconciliation_money(p_data,'cash_in'); cout:=public.fn_reconciliation_money(p_data,'cash_out');
    expected:=opening+s.cash_amount+cin-cout; pos:=s.cash_amount+s.kshop_amount+s.lineman_before_gp;
    if expected<0 then raise exception 'เงินออกลิ้นชักเกินเงินที่ควรมี'; end if;
    if (cin<>0 or cout<>0 or printed<>pos or counted<>expected or v>0) and note='' then raise exception 'กรอกเหตุผลส่วนต่างหรือการแก้ไข'; end if;
    insert into public.sales_closings(sales_date,printed_pos,opening_float,cash_count,cash_in,cash_out,sales_snapshot,
      expected_pos,expected_cash,pos_difference,cash_difference,note,created_by,updated_by)
    values(d,printed,opening,counted,cin,cout,snapshot,pos,expected,printed-pos,counted-expected,note,actor,actor)
    on conflict(sales_date) do update set printed_pos=excluded.printed_pos,opening_float=excluded.opening_float,
      cash_count=excluded.cash_count,cash_in=excluded.cash_in,cash_out=excluded.cash_out,sales_snapshot=excluded.sales_snapshot,
      expected_pos=excluded.expected_pos,expected_cash=excluded.expected_cash,pos_difference=excluded.pos_difference,
      cash_difference=excluded.cash_difference,note=excluded.note,updated_by=actor,updated_at=now(),version=sales_closings.version+1
    returning * into c;
    response:=jsonb_build_object('id',c.id,'version',c.version,'closing',to_jsonb(c));
  elsif p_command='settlement.save' then
    id:=nullif(p_data->>'id','')::uuid; platform:=p_data->>'platform';
    if platform is null or platform not in ('grab','lineman','shopee') then raise exception 'เลือกแพลตฟอร์ม'; end if;
    pfrom:=(p_data->>'period_from')::date; pto:=(p_data->>'period_to')::date;
    if pfrom is null or pto is null or pfrom>pto or pto>today or pto-pfrom>365 then raise exception 'รอบวันที่ไม่ถูกต้อง'; end if;
    reference:=btrim(coalesce(p_data->>'reference',''));
    if length(reference) not between 1 and 120 then raise exception 'เลขที่ใบสรุปต้องมี 1-120 ตัวอักษร'; end if;
    if id is not null then
      select * into t from public.platform_settlements where platform_settlements.id=id for update;
      if not found or t.voided_at is not null then raise exception 'ไม่พบใบสรุปที่แก้ไขได้'; end if;
      if exists(select 1 from public.platform_receipts where settlement_id=id and voided_at is null) then raise exception 'มีเงินรับแล้ว ยกเลิกรายการเงินรับก่อนแก้ใบสรุป'; end if;
      if t.version<>v then raise exception 'ข้อมูลเปลี่ยนแล้ว กรุณาเปิดหน้าใหม่'; end if;
      if note='' then raise exception 'กรอกเหตุผลการแก้ไข'; end if;
    elsif v<>0 then raise exception 'เวอร์ชันใบสรุปใหม่ไม่ถูกต้อง'; end if;
    if exists(select 1 from public.platform_settlements x where x.platform=platform and x.voided_at is null
      and x.id is distinct from id and x.period_from<=pto and x.period_to>=pfrom) then
      raise exception 'รอบวันที่ซ้อนกับใบสรุปเดิมของแพลตฟอร์มนี้ ใช้ใบสรุปเดิมและเพิ่มเงินรับแต่ละครั้ง'; end if;
    gross:=public.fn_reconciliation_money(p_data,'gross'); commission:=public.fn_reconciliation_money(p_data,'commission');
    fees:=public.fn_reconciliation_money(p_data,'fees'); discounts:=public.fn_reconciliation_money(p_data,'discounts');
    refunds:=public.fn_reconciliation_money(p_data,'refunds'); withholding:=public.fn_reconciliation_money(p_data,'withholding');
    additions:=public.fn_reconciliation_money(p_data,'additions'); deductions:=public.fn_reconciliation_money(p_data,'deductions');
    n:=gross+additions-commission-fees-discounts-refunds-withholding-deductions;
    if n<0 then raise exception 'ยอดหักเกินยอดขายและเงินเพิ่ม'; end if;
    if id is null then
      insert into public.platform_settlements(platform,period_from,period_to,reference,due_date,gross,commission,fees,
        discounts,refunds,withholding,additions,deductions,expected_net,note,created_by,updated_by)
      values(platform,pfrom,pto,reference,nullif(p_data->>'due_date','')::date,gross,commission,fees,discounts,
        refunds,withholding,additions,deductions,n,note,actor,actor) returning * into t;
    else
      update public.platform_settlements x set platform=command_vars.platform,period_from=pfrom,period_to=pto,
        reference=command_vars.reference,due_date=nullif(p_data->>'due_date','')::date,gross=command_vars.gross,
        commission=command_vars.commission,fees=command_vars.fees,discounts=command_vars.discounts,
        refunds=command_vars.refunds,withholding=command_vars.withholding,additions=command_vars.additions,
        deductions=command_vars.deductions,expected_net=n,note=command_vars.note,version=x.version+1,
        updated_by=actor,updated_at=now() where x.id=command_vars.id returning * into t;
    end if;
    response:=jsonb_build_object('id',t.id,'version',t.version);
  elsif p_command in ('payment.add','payment.void','settlement.void') then
    if p_command='payment.void' then
      select * into receipt from public.platform_receipts where platform_receipts.id=(p_data->>'id')::uuid;
      if not found or receipt.voided_at is not null then raise exception 'ไม่พบเงินรับที่ยกเลิกได้'; end if;
      id:=receipt.settlement_id;
    elsif p_command='payment.add' then id:=(p_data->>'settlement_id')::uuid;
    else id:=(p_data->>'id')::uuid; end if;
    select * into t from public.platform_settlements where platform_settlements.id=command_vars.id for update;
    if not found or t.voided_at is not null then raise exception 'ไม่พบใบสรุปที่ใช้งานได้'; end if;
    if t.version<>v then raise exception 'ข้อมูลเปลี่ยนแล้ว กรุณาเปิดหน้าใหม่'; end if;
    if p_command='payment.add' then
      amount:=public.fn_reconciliation_money(p_data,'amount'); d:=(p_data->>'received_date')::date;
      reference:=btrim(coalesce(p_data->>'bank_reference',''));
      if amount<=0 or d is null or d>today or length(reference) not between 1 and 120 then raise exception 'ตรวจยอด วันที่เงินเข้า และเลขอ้างอิงธนาคาร'; end if;
      insert into public.platform_receipts(settlement_id,received_date,amount,bank_reference,note,created_by)
      values(t.id,d,amount,reference,note,actor) returning platform_receipts.id into id;
    else
      reason:=btrim(coalesce(p_data->>'reason',''));
      if length(reason) not between 1 and 1000 then raise exception 'กรอกเหตุผลยกเลิก ไม่เกิน 1000 ตัวอักษร'; end if;
      if p_command='payment.void' then
        update public.platform_receipts set voided_at=now(),voided_by=actor,void_reason=reason where platform_receipts.id=receipt.id;
      else
        if exists(select 1 from public.platform_receipts where settlement_id=t.id and voided_at is null) then raise exception 'ยกเลิกเงินรับที่ยังใช้งานก่อนยกเลิกใบสรุป'; end if;
        update public.platform_settlements set voided_at=now(),void_reason=reason where platform_settlements.id=t.id;
      end if;
    end if;
    update public.platform_settlements set version=version+1,updated_by=actor,updated_at=now() where platform_settlements.id=t.id returning * into t;
    response:=jsonb_build_object('id',t.id,'version',t.version);
  else raise exception 'คำสั่งไม่ถูกต้อง'; end if;
  insert into public.reconciliation_commands(id,actor_id,command,payload,response) values(p_request,actor,p_command,p_data,response);
  return response;
exception when unique_violation then raise exception 'เลขใบสรุปหรือเลขอ้างอิงธนาคารซ้ำ กรุณาตรวจรายการเดิม';
end $$;

drop trigger if exists tr_audit_sales_closings on public.sales_closings;
create trigger tr_audit_sales_closings after insert or update or delete on public.sales_closings for each row execute function public.fn_audit_log();
drop trigger if exists tr_audit_platform_settlements on public.platform_settlements;
create trigger tr_audit_platform_settlements after insert or update or delete on public.platform_settlements for each row execute function public.fn_audit_log();
drop trigger if exists tr_audit_platform_receipts on public.platform_receipts;
create trigger tr_audit_platform_receipts after insert or update or delete on public.platform_receipts for each row execute function public.fn_audit_log();
revoke all on function public.fn_reconciliation_access(boolean), public.fn_reconciliation_snapshot(public.sales_daily),
  public.fn_reconciliation_money(jsonb,text), public.reconciliation_command(text,jsonb,uuid),
  public.sales_closing_state(date), public.platform_reconciliation_state(date) from public,anon,authenticated;
grant execute on function public.reconciliation_command(text,jsonb,uuid), public.sales_closing_state(date),
  public.platform_reconciliation_state(date) to authenticated;
commit;
