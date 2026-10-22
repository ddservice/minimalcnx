-- Per-user same-day correction grant. Run after harden_sales_staff.sql / add_audit_forensics.sql.
-- No user is granted permission automatically; configure each shop explicitly.
begin;
create table if not exists public.sales_day_edit_grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.profiles(id) on delete cascade,
  granted_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
alter table public.sales_day_edit_grants enable row level security;
revoke all on public.sales_day_edit_grants from public, anon, authenticated;
grant select, insert, delete on public.sales_day_edit_grants to authenticated;
drop policy if exists "sales day grants: read self/admin" on public.sales_day_edit_grants;
create policy "sales day grants: read self/admin" on public.sales_day_edit_grants for select to authenticated
using (user_id = auth.uid() or (public.fn_my_role() = 'admin' and public.fn_page_cap('/settings','edit')));
drop policy if exists "sales day grants: admin manage" on public.sales_day_edit_grants;
create policy "sales day grants: admin manage" on public.sales_day_edit_grants for all to authenticated
using (public.fn_my_role() = 'admin' and public.fn_page_cap('/settings','edit'))
with check (public.fn_my_role() = 'admin' and public.fn_page_cap('/settings','edit'));
drop trigger if exists tr_audit_sales_day_edit_grants on public.sales_day_edit_grants;
create trigger tr_audit_sales_day_edit_grants after insert or update or delete on public.sales_day_edit_grants
for each row execute function public.fn_audit_log();

create or replace function public.fn_can_edit_sales_today()
returns boolean language sql stable security definer set search_path = public as $$
  select public.fn_page_cap('/sales','create') and exists (
    select 1 from public.sales_day_edit_grants g join public.profiles p on p.id = g.user_id
    where p.id = auth.uid() and p.is_active = true and p.role = 'staff'
  );
$$;
revoke all on function public.fn_can_edit_sales_today() from public, anon;
grant execute on function public.fn_can_edit_sales_today() to authenticated;

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
  if not public.fn_page_cap('/sales',case when tg_op = 'UPDATE' and r <> 'staff' then 'edit' else 'create' end) then
    raise exception 'ไม่มีสิทธิ์บันทึกยอดขาย';
  end if;
  if r = 'staff' then
    if tg_op = 'UPDATE' then
      new.id := old.id;
      new.recorded_by := old.recorded_by;
      new.created_at := old.created_at;
      if not public.fn_can_edit_sales_today() then raise exception 'บันทึกแล้ว ให้ผู้จัดการเป็นผู้แก้ไข'; end if;
      if old.date <> (statement_timestamp() at time zone 'Asia/Bangkok')::date or new.date is distinct from old.date then
        raise exception 'แก้ไขได้เฉพาะยอดขายของวันนี้ตามเวลาไทย ห้ามเปลี่ยนวันที่';
      end if;
    end if;
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

-- The trigger is also enforced inside the definer upsert RPC. Permit direct same-day updates too.
drop policy if exists "sales: update day editor" on public.sales_daily;
create policy "sales: update day editor" on public.sales_daily for update to authenticated
using (public.fn_can_edit_sales_today() and date = (statement_timestamp() at time zone 'Asia/Bangkok')::date)
with check (public.fn_can_edit_sales_today() and date = (statement_timestamp() at time zone 'Asia/Bangkok')::date);
commit;
