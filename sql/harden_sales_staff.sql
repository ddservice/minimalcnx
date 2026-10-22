-- Sales staff: current Thai day, insert once; page permissions also enforced in Postgres.
-- Run AFTER add_free_cup_actual_cost.sql / optimize_queries.sql / harden_security.sql.
begin;
create or replace function public.fn_page_cap(p_page text, p_action text default 'view')
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  r text; raw jsonb; level text; rank integer;
begin
  select role into r from public.profiles where id = auth.uid() and is_active = true;
  if r is null then return false; end if;
  if r = 'admin' then return true; end if;
  if r not in ('co-admin','manager','staff','loyalty_staff') then return false; end if;
  if r = 'loyalty_staff' and p_page <> '/loyalty' then return false; end if;
  select value -> r -> p_page into raw from public.business_config where key = 'role_perms';
  if raw is null or raw = 'null'::jsonb or raw = 'true'::jsonb then
    level := case when p_page in ('/dashboard','/reports','/analytics') then 'view'
      when r = 'loyalty_staff' then 'create'
      when r = 'staff' then case when p_page = '/settings' then 'view' else 'create' end
      else 'edit' end;
  elsif raw = 'false'::jsonb then level := 'none';
  else level := raw #>> '{}'; end if;
  rank := case level when 'edit' then 3 when 'create' then 2 when 'view' then 1 else 0 end;
  return rank >= case p_action when 'edit' then 3 when 'create' then 2 else 1 end;
end $$;
revoke all on function public.fn_page_cap(text,text) from public, anon;
grant execute on function public.fn_page_cap(text,text) to authenticated;

create or replace function public.fn_guard_sales_day()
returns trigger language plpgsql security definer set search_path = public as $$
declare r text;
begin
  select role into r from public.profiles where id = auth.uid() and is_active = true;
  if r is null then raise exception 'กรุณาเข้าสู่ระบบด้วยบัญชีที่ใช้งานได้'; end if;
  if tg_op = 'DELETE' then
    if r <> 'admin' or not public.fn_page_cap('/sales','edit') then raise exception 'ไม่มีสิทธิ์ลบยอดขาย'; end if;
    return old;
  end if;
  if not public.fn_page_cap('/sales',case when tg_op = 'UPDATE' then 'edit' else 'create' end) then
    raise exception 'ไม่มีสิทธิ์บันทึกยอดขาย';
  end if;
  if r = 'staff' then
    if tg_op <> 'INSERT' then raise exception 'บันทึกแล้ว ให้ผู้จัดการเป็นผู้แก้ไข'; end if;
    if new.date <> (statement_timestamp() at time zone 'Asia/Bangkok')::date then
      raise exception 'พนักงานบันทึกยอดขายได้เฉพาะวันนี้ตามเวลาไทย';
    end if;
  elsif r not in ('admin','co-admin','manager') then raise exception 'ไม่มีสิทธิ์บันทึกยอดขาย'; end if;
  if new.total_cups < 0 or new.free_cups < 0 or new.pastry_pieces < 0
    or new.kshop_amount < 0 or new.cash_amount < 0 or new.shopee_before_gp < 0
    or new.grab_before_gp < 0 or new.lineman_before_gp < 0 or new.free_cup_cost < 0
    or new.pastry_revenue < 0 then raise exception 'ยอดขายต้องไม่ติดลบ'; end if;
  new.net_revenue := new.kshop_amount + new.cash_amount
    + round(new.shopee_before_gp * 0.6576, 2)
    + round(new.grab_before_gp * 0.679, 2)
    + round(new.lineman_before_gp * 0.679, 2);
  if tg_op = 'INSERT' then new.recorded_by := auth.uid(); end if;
  return new;
end $$;
revoke all on function public.fn_guard_sales_day() from public, anon, authenticated;
drop trigger if exists tr_sales_day_guard on public.sales_daily;
create trigger tr_sales_day_guard before insert or update or delete on public.sales_daily
for each row execute function public.fn_guard_sales_day();

drop policy if exists "sales: page boundary" on public.sales_daily;
create policy "sales: page boundary" on public.sales_daily as restrictive for all to authenticated
using (public.fn_page_cap('/sales') and (public.fn_my_role() <> 'staff' or date = (statement_timestamp() at time zone 'Asia/Bangkok')::date))
with check (public.fn_page_cap('/sales','create') and (public.fn_my_role() <> 'staff' or date = (statement_timestamp() at time zone 'Asia/Bangkok')::date));

-- Expenses and OPEX share a table. Keep existing role ceilings and add page restrictions.
drop policy if exists "expenses: page boundary" on public.expenses;
create policy "expenses: page boundary" on public.expenses as restrictive for all to authenticated
using (public.fn_page_cap(case when item_key is null then '/expenses' else '/opex' end)
  or public.fn_page_cap('/reports') or public.fn_page_cap('/analytics') or public.fn_page_cap('/dashboard'))
with check (public.fn_page_cap(case when item_key is null then '/expenses' else '/opex' end, 'create'));

create or replace function public.fn_guard_expense_page()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op <> 'INSERT' and not public.fn_page_cap(case when old.item_key is null then '/expenses' else '/opex' end,'edit') then
    raise exception 'ไม่มีสิทธิ์แก้ไขรายจ่ายหน้านี้';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  if not public.fn_page_cap(case when new.item_key is null then '/expenses' else '/opex' end,case when tg_op = 'UPDATE' then 'edit' else 'create' end) then
    raise exception 'ไม่มีสิทธิ์บันทึกรายจ่ายหน้านี้';
  end if;
  return new;
end $$;
revoke all on function public.fn_guard_expense_page() from public, anon, authenticated;
drop trigger if exists tr_expenses_page_guard on public.expenses;
create trigger tr_expenses_page_guard before insert or update or delete on public.expenses
for each row execute function public.fn_guard_expense_page();

-- Sensitive config is now user-scoped; app must not cache these keys across users.
drop policy if exists "config: page read boundary" on public.business_config;
create policy "config: page read boundary" on public.business_config as restrictive for select to authenticated
using (key in ('role_perms','biz_info') or public.fn_page_cap('/settings') or public.fn_page_cap('/opex')
  or (key = 'opex_defaults' and (public.fn_page_cap('/reports') or public.fn_page_cap('/analytics') or public.fn_page_cap('/dashboard'))));
drop policy if exists "config: page insert boundary" on public.business_config;
create policy "config: page insert boundary" on public.business_config as restrictive for insert to authenticated
with check (public.fn_page_cap('/settings','edit') or (key = 'emp_pay_history' and public.fn_page_cap('/opex','create'))
  or (key in ('emp_details','form50_payees') and public.fn_my_role() in ('admin','co-admin') and public.fn_page_cap('/opex','edit')));
drop policy if exists "config: page update boundary" on public.business_config;
create policy "config: page update boundary" on public.business_config as restrictive for update to authenticated
using (public.fn_page_cap('/settings','edit') or (key = 'emp_pay_history' and public.fn_page_cap('/opex','create'))
  or (key in ('emp_details','form50_payees') and public.fn_my_role() in ('admin','co-admin') and public.fn_page_cap('/opex','edit')))
with check (public.fn_page_cap('/settings','edit') or (key = 'emp_pay_history' and public.fn_page_cap('/opex','create'))
  or (key in ('emp_details','form50_payees') and public.fn_my_role() in ('admin','co-admin') and public.fn_page_cap('/opex','edit')));

-- RPCs bypass RLS. Add an explicit guard to their existing definitions, preserving installed versions.
do $migration$
declare signature text; definition text; guard text;
begin
  foreach signature in array array['public.get_monthly_summary(text)','public.get_months_kpis(text[])','public.upsert_opex_item(jsonb)'] loop
    definition := pg_get_functiondef(signature::regprocedure);
    if position('-- page_cap_boundary' in definition) > 0 then continue; end if;
    guard := case signature
      when 'public.get_monthly_summary(text)' then 'public.fn_page_cap(''/reports'') or public.fn_page_cap(''/dashboard'') or public.fn_page_cap(''/analytics'')'
      when 'public.get_months_kpis(text[])' then 'public.fn_page_cap(''/analytics'')'
      else 'public.fn_page_cap(''/opex'',''create'')' end;
    if definition !~* E'\nbegin\r?\n' then raise exception 'Cannot locate function entry: %', signature; end if;
    definition := regexp_replace(definition, E'\nbegin\r?\n', E'\nbegin\n  -- page_cap_boundary\n  if not (' || guard || E') then raise exception ''ไม่มีสิทธิ์ใช้ข้อมูลหน้านี้''; end if;\n', 'i');
    execute definition;
  end loop;
end $migration$;
alter function public.upsert_sales_daily(jsonb) set search_path = public;
revoke all on function public.upsert_sales_daily(jsonb) from public, anon;
grant execute on function public.upsert_sales_daily(jsonb) to authenticated;
commit;
