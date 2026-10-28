-- After harden_sales_staff.sql and add_expense_documents.sql. No historical data changes.
begin;
create or replace function public.fn_bakery_access(p_action text default 'view')
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.profiles where id=auth.uid() and is_active
    and role in ('admin','co-admin'))
    and public.fn_page_cap('/expenses',p_action) and public.fn_page_cap('/reports','view');
$$;
revoke all on function public.fn_bakery_access(text) from public,anon;
grant execute on function public.fn_bakery_access(text) to authenticated;

create table if not exists public.bakery_invoices (
  id uuid primary key default gen_random_uuid(), supplier text not null,
  invoice_no text not null, received_on date not null, due_on date,
  discount_pct numeric(5,2) not null check(discount_pct between 0 and 100),
  lines jsonb not null, expected_total numeric(12,2) not null,
  net_total numeric(12,2) not null, payment_method text not null default 'ค้างชำระ',
  status text not null default 'draft' check(status in ('draft','posted','void')),
  version integer not null default 1, expense_id uuid unique,
  note text not null default '', void_reason text,
  created_by uuid references public.profiles(id), updated_at timestamptz not null default now(),
  check(length(supplier) between 1 and 100), check(length(invoice_no) between 1 and 100),
  check(jsonb_typeof(lines)='array'), check(due_on is null or due_on>=received_on)
);
create unique index if not exists bakery_invoice_identity on public.bakery_invoices(lower(trim(supplier)),lower(trim(invoice_no)));
create index if not exists bakery_invoice_date on public.bakery_invoices(received_on);
alter table public.expenses add column if not exists bakery_invoice_id uuid references public.bakery_invoices(id) on delete restrict;
create unique index if not exists bakery_expense_invoice on public.expenses(bakery_invoice_id) where bakery_invoice_id is not null;

create table if not exists public.bakery_pos_imports (
  id uuid primary key default gen_random_uuid(), month text not null unique check(month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  source_hash text not null unique, source_name text not null, rows jsonb not null,
  branch text not null, version integer not null default 1,
  created_by uuid references public.profiles(id), updated_at timestamptz not null default now()
);
create table if not exists public.bakery_item_mappings (
  id uuid primary key default gen_random_uuid(), pos_key text not null unique,
  supplier text not null, purchase_name text not null, factor numeric(12,4) not null check(factor>0 and factor<=10000),
  created_by uuid references public.profiles(id), updated_at timestamptz not null default now()
);
do $$ declare t text; begin
  foreach t in array array['bakery_invoices','bakery_pos_imports','bakery_item_mappings'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from anon,authenticated',t);
    execute format('grant select on public.%I to authenticated',t);
    execute format('drop policy if exists bakery_read on public.%I',t);
    execute format('create policy bakery_read on public.%I for select to authenticated using (public.fn_bakery_access())',t);
    execute format('drop trigger if exists bakery_audit on public.%I',t);
    execute format('create trigger bakery_audit after insert or update or delete on public.%I for each row execute function public.fn_audit_log()',t);
  end loop;
end $$;

-- Independent database validation/recomputation, also used before posting.
create or replace function public.bakery_invoice_total(p_lines jsonb,p_discount numeric)
returns numeric language plpgsql immutable set search_path = '' as $$
declare row jsonb; qty numeric; price numeric; gross numeric:=0; line_net numeric:=0; net_sum numeric:=0; total numeric;
begin
  if p_discount is null or p_discount<0 or p_discount>100 or round(p_discount,2)<>p_discount
     or jsonb_typeof(p_lines) is distinct from 'array' then raise exception 'ส่วนลดหรือรายการไม่ถูกต้อง'; end if;
  if jsonb_array_length(p_lines) not between 1 and 100 then raise exception 'ต้องมี 1–100 รายการ'; end if;
  for row in select value from jsonb_array_elements(p_lines) loop
    qty:=(row->>'quantity')::numeric; price:=(row->>'unit_price')::numeric;
    if qty is null or price is null or qty::text in ('NaN','Infinity','-Infinity') or price::text in ('NaN','Infinity','-Infinity')
       or qty<=0 or qty>100000 or round(qty,3)<>qty or price<0 or price>1000000 or round(price,2)<>price
       or length(trim(coalesce(row->>'name',''))) not between 1 and 150
       or length(trim(coalesce(row->>'unit',''))) not between 1 and 30 then raise exception 'ตรวจชื่อ หน่วย จำนวน และราคาขนม'; end if;
    gross:=gross+round(qty*price,2);
    line_net:=round(round(qty*price,2)*(1-p_discount/100),2);
    net_sum:=net_sum+line_net;
  end loop;
  total:=round(gross*(1-p_discount/100),2);
  if line_net+total-net_sum<0 then raise exception 'ส่วนลดปัดเศษไม่ถูกต้อง'; end if;
  return total;
end $$;
revoke all on function public.bakery_invoice_total(jsonb,numeric) from public,anon,authenticated;

create or replace function public.bakery_save_invoice(p_data jsonb,p_version integer default 0)
returns uuid language plpgsql security definer set search_path = '' as $$
declare inv public.bakery_invoices; new_id uuid; total numeric; expected numeric;
begin
  if not public.fn_bakery_access('edit') then raise exception 'ไม่มีสิทธิ์จัดการต้นทุนขนม'; end if;
  if octet_length(p_data::text)>100000 then raise exception 'บิลใหญ่เกินไป'; end if;
  total:=public.bakery_invoice_total(p_data->'lines',(p_data->>'discount_pct')::numeric);
  expected:=(p_data->>'expected_total')::numeric;
  if expected is null or expected<0 or expected::text in ('NaN','Infinity','-Infinity') or expected<>round(expected,2) then raise exception 'ระบุยอดสุทธิตามเอกสาร'; end if;
  if (p_data->>'received_on')::date<'2000-01-01'::date or (p_data->>'received_on')::date>(statement_timestamp() at time zone 'Asia/Bangkok')::date then raise exception 'วันที่รับขนมไม่ถูกต้อง'; end if;
  if p_data->>'received_on' is null then raise exception 'ต้องระบุวันที่รับขนม'; end if;
  if length(coalesce(p_data->>'note',''))>1000 or length(coalesce(p_data->>'payment_method',''))>100 then raise exception 'ข้อความยาวเกินไป'; end if;
  -- Strip derived amounts from input; the database owns the total.
  if coalesce(p_data->>'id','')<>'' then
    select * into inv from public.bakery_invoices where id=(p_data->>'id')::uuid for update;
    if not found or inv.version is distinct from p_version then raise exception 'ข้อมูลเปลี่ยนแล้ว กรุณาโหลดใหม่'; end if;
    if inv.status<>'draft' then raise exception 'บิลบันทึกรายจ่ายแล้ว แก้ไขไม่ได้ ให้ยกเลิกพร้อมเหตุผล'; end if;
    update public.bakery_invoices set supplier=trim(p_data->>'supplier'),invoice_no=trim(p_data->>'invoice_no'),
      received_on=(p_data->>'received_on')::date,due_on=nullif(p_data->>'due_on','')::date,
      discount_pct=(p_data->>'discount_pct')::numeric,lines=p_data->'lines',expected_total=expected,net_total=total,
      payment_method=coalesce(nullif(trim(p_data->>'payment_method'),''),'ค้างชำระ'),note=coalesce(p_data->>'note',''),
      version=version+1,updated_at=now() where id=inv.id returning id into new_id;
  else
    insert into public.bakery_invoices(supplier,invoice_no,received_on,due_on,discount_pct,lines,expected_total,net_total,payment_method,note,created_by)
    values(trim(p_data->>'supplier'),trim(p_data->>'invoice_no'),(p_data->>'received_on')::date,nullif(p_data->>'due_on','')::date,
      (p_data->>'discount_pct')::numeric,p_data->'lines',expected,total,coalesce(nullif(trim(p_data->>'payment_method'),''),'ค้างชำระ'),coalesce(p_data->>'note',''),auth.uid()) returning id into new_id;
  end if;
  return new_id;
end $$;

-- Expense rows linked to invoices are immutable to direct clients and legacy tools.
create or replace function public.fn_guard_bakery_expense()
returns trigger language plpgsql set search_path = '' as $$
begin
  if pg_trigger_depth()<=1 and ((tg_op<>'INSERT' and old.bakery_invoice_id is not null) or (tg_op<>'DELETE' and new.bakery_invoice_id is not null)) then
    raise exception 'รายจ่ายนี้ผูกบิลขนม ให้ยกเลิกจากหน้าต้นทุนขนมพร้อมเหตุผล';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
drop trigger if exists guard_bakery_expense on public.expenses;
create trigger guard_bakery_expense before insert or update or delete on public.expenses for each row execute function public.fn_guard_bakery_expense();

create or replace function public.fn_sync_bakery_expense()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.status='draft' and new.status='posted' then
    insert into public.expenses(id,date,category,subcategory,item_name,unit,quantity,unit_price,total_amount,payment_method,recorded_by,note,bakery_invoice_id)
    values(new.expense_id,new.received_on,'ต้นทุนขนมหน้าร้าน',new.supplier,'บิลขนม '||new.invoice_no,'บิล',1,new.net_total,new.net_total,new.payment_method,auth.uid(),
      'รายละเอียดและส่วนลดอยู่ในหน้าต้นทุนขนม · '||new.note,new.id);
  elsif old.status='posted' and new.status='void' then
    -- Linked private documents intentionally block deletion until reviewed.
    delete from public.expenses where bakery_invoice_id=new.id;
  end if;
  return new;
end $$;
drop trigger if exists sync_bakery_expense on public.bakery_invoices;
create trigger sync_bakery_expense after update of status on public.bakery_invoices for each row execute function public.fn_sync_bakery_expense();

create or replace function public.bakery_change_invoice(p_id uuid,p_version integer,p_action text,p_reason text default '')
returns void language plpgsql security definer set search_path = '' as $$
declare inv public.bakery_invoices; total numeric;
begin
  if not public.fn_bakery_access('edit') then raise exception 'ไม่มีสิทธิ์จัดการต้นทุนขนม'; end if;
  select * into inv from public.bakery_invoices where id=p_id for update;
  if not found or inv.version is distinct from p_version then raise exception 'ข้อมูลเปลี่ยนแล้ว กรุณาโหลดใหม่'; end if;
  if p_action='post' and inv.status='draft' then
    total:=public.bakery_invoice_total(inv.lines,inv.discount_pct);
    if total<>inv.expected_total then raise exception 'ยอดคำนวณไม่ตรงยอดสุทธิในเอกสาร'; end if;
    perform pg_advisory_xact_lock(hashtextextended('bakery:'||inv.received_on::text,0));
    if exists(select 1 from public.expenses where date=inv.received_on and category='ต้นทุนขนมหน้าร้าน' and bakery_invoice_id is null) then
      raise exception 'วันนี้มีต้นทุนขนมแบบเดิมอยู่แล้ว ตรวจและจัดการก่อนเพื่อไม่บันทึกซ้ำ';
    end if;
    update public.bakery_invoices set status='posted',net_total=total,expense_id=gen_random_uuid(),version=version+1,updated_at=now() where id=p_id;
  elsif p_action='void' and inv.status in ('draft','posted') then
    if length(trim(p_reason)) not between 3 and 500 then raise exception 'ระบุเหตุผลยกเลิก 3–500 ตัวอักษร'; end if;
    update public.bakery_invoices set status='void',void_reason=trim(p_reason),version=version+1,updated_at=now() where id=p_id;
  elsif p_action='reopen' and inv.status='void' then
    update public.bakery_invoices set status='draft',expense_id=null,version=version+1,updated_at=now() where id=p_id;
  else raise exception 'สถานะบิลไม่รองรับคำสั่งนี้'; end if;
end $$;

create or replace function public.bakery_save_pos(p_month text,p_rows jsonb,p_hash text,p_name text,p_branch text,p_version integer default 0)
returns void language plpgsql security definer set search_path = '' as $$
declare row jsonb; current_version integer; qty numeric; rev numeric;
begin
  if not public.fn_bakery_access('edit') then raise exception 'ไม่มีสิทธิ์นำเข้า POS'; end if;
  if p_month is null or p_month !~ '^(20[0-9]{2})-(0[1-9]|1[0-2])$' or p_hash is null or p_hash !~ '^[a-f0-9]{64}$'
    or length(trim(coalesce(p_name,''))) not between 1 and 200 or length(trim(coalesce(p_branch,''))) not between 1 and 100
    or jsonb_typeof(p_rows) is distinct from 'array' or octet_length(p_rows::text)>750000 then raise exception 'ไฟล์หรือเดือนไม่ถูกต้อง'; end if;
  if jsonb_array_length(p_rows) not between 1 and 4000 then raise exception 'ต้องมีรายการขนม 1–4000 แถว'; end if;
  for row in select value from jsonb_array_elements(p_rows) loop
    qty:=(row->>'quantity')::numeric; rev:=(row->>'revenue')::numeric;
    if qty is null or rev is null or qty::text in ('NaN','Infinity','-Infinity') or rev::text in ('NaN','Infinity','-Infinity')
      or qty<=0 or qty>100000 or rev<0 or rev>10000000 or round(rev,2)<>rev
      or to_char((row->>'date')::date,'YYYY-MM') is distinct from p_month
      or length(trim(coalesce(row->>'name',''))) not between 1 and 200
      or length(trim(coalesce(row->>'key',''))) not between 1 and 200
      or length(trim(coalesce(row->>'receipt',''))) not between 1 and 100 then raise exception 'รายการ POS ไม่ถูกต้อง'; end if;
  end loop;
  perform pg_advisory_xact_lock(hashtextextended('bakery-pos:'||p_month,0));
  select version into current_version from public.bakery_pos_imports where month=p_month for update;
  if coalesce(current_version,0) is distinct from p_version then raise exception 'มีการนำเข้าใหม่แล้ว กรุณาโหลดหน้าใหม่'; end if;
  if exists(select 1 from public.bakery_pos_imports where source_hash=p_hash) then raise exception 'ไฟล์นี้นำเข้าแล้ว'; end if;
  insert into public.bakery_pos_imports(month,source_hash,source_name,rows,branch,created_by)
  values(p_month,p_hash,p_name,p_rows,p_branch,auth.uid())
  on conflict(month) do update set source_hash=excluded.source_hash,source_name=excluded.source_name,rows=excluded.rows,branch=excluded.branch,
    version=bakery_pos_imports.version+1,updated_at=now(),created_by=auth.uid();
end $$;

create or replace function public.bakery_save_mapping(p_key text,p_supplier text,p_purchase text,p_factor numeric)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.fn_bakery_access('edit') then raise exception 'ไม่มีสิทธิ์จับคู่สินค้า'; end if;
  if length(trim(coalesce(p_key,''))) not between 1 and 200 or length(trim(coalesce(p_supplier,''))) not between 1 and 100
     or length(trim(coalesce(p_purchase,''))) not between 1 and 150 or p_factor is null or p_factor::text in ('NaN','Infinity','-Infinity')
     or p_factor<=0 or p_factor>10000 or round(p_factor,4)<>p_factor then raise exception 'ตรวจคู่สินค้าและอัตราแปลงหน่วย'; end if;
  insert into public.bakery_item_mappings(pos_key,supplier,purchase_name,factor,created_by)
  values(trim(p_key),trim(p_supplier),trim(p_purchase),p_factor,auth.uid())
  on conflict(pos_key) do update set supplier=excluded.supplier,purchase_name=excluded.purchase_name,factor=excluded.factor,updated_at=now(),created_by=auth.uid();
end $$;
revoke all on function public.bakery_save_invoice(jsonb,integer) from public,anon;
revoke all on function public.bakery_change_invoice(uuid,integer,text,text) from public,anon;
revoke all on function public.bakery_save_pos(text,jsonb,text,text,text,integer) from public,anon;
revoke all on function public.bakery_save_mapping(text,text,text,numeric) from public,anon;
grant execute on function public.bakery_save_invoice(jsonb,integer) to authenticated;
grant execute on function public.bakery_change_invoice(uuid,integer,text,text) to authenticated;
grant execute on function public.bakery_save_pos(text,jsonb,text,text,text,integer) to authenticated;
grant execute on function public.bakery_save_mapping(text,text,text,numeric) to authenticated;
-- Trigger helpers are not callable application APIs.
revoke all on function public.fn_sync_bakery_expense() from public,anon,authenticated;
revoke all on function public.fn_guard_bakery_expense() from public,anon,authenticated;
commit;
