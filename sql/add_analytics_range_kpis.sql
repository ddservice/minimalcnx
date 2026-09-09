-- ================================================================
-- add_analytics_range_kpis.sql
-- RPC เบาสำหรับหน้า /analytics — คืน KPI รายเดือนหลายเดือนในครั้งเดียว
-- แทนการเรียก get_monthly_summary ทีละเดือน (payload ใหญ่ + N round-trips)
-- Idempotent
-- ================================================================

create or replace function public.get_months_kpis(p_month_labels text[])
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  _label text;
  _months jsonb := '[]'::jsonb;
  _income numeric;
  _free_cups int;
  _reg numeric;
  _opex jsonb;
  _materials jsonb;
begin
  if p_month_labels is null or array_length(p_month_labels, 1) is null then
    return jsonb_build_object('months', '[]'::jsonb);
  end if;

  foreach _label in array p_month_labels loop
    -- ดึงพร้อมกันในสแกนเดียว — แก้วฟรีมาจากตารางเดียวกับรายรับ ไม่ต้องยิงซ้ำ
    select coalesce(sum(s.net_revenue), 0), coalesce(sum(s.free_cups), 0)
      into _income, _free_cups
    from public.sales_daily s
    where to_char(s.date, 'MM/YYYY') = _label;

    select coalesce(sum(e.total_amount), 0) into _reg
    from public.expenses e
    where e.month_label = _label
      and e.item_key is null;

    select coalesce(jsonb_agg(jsonb_build_object(
      'item_key', e.item_key,
      'category', e.category,
      'total_amount', e.total_amount
    )), '[]'::jsonb)
    into _opex
    from public.expenses e
    where e.month_label = _label
      and e.item_key is not null;

    select coalesce(jsonb_agg(jsonb_build_object(
      'item_name', x.item_name,
      'subcategory', x.subcategory,
      'total', x.total,
      'count', x.cnt
    )), '[]'::jsonb)
    into _materials
    from (
      select
        trim(e.item_name) as item_name,
        trim(coalesce(e.subcategory, '')) as subcategory,
        sum(e.total_amount) as total,
        count(*)::int as cnt
      from public.expenses e
      where e.month_label = _label
        and e.item_key is null
        and e.category = 'ต้นทุนวัตถุดิบ'
        and trim(coalesce(e.item_name, '')) <> ''
      group by 1, 2
    ) x;

    _months := _months || jsonb_build_array(jsonb_build_object(
      'month', _label,
      'income', _income,
      'free_cups', _free_cups,
      'expenses_reg', _reg,
      'opex_items', _opex,
      'materials', _materials,
      'has_data', (_income > 0 or _reg > 0 or jsonb_array_length(_opex) > 0)
    ));
  end loop;

  return jsonb_build_object('months', _months);
end;
$$;

revoke all on function public.get_months_kpis(text[]) from public;
grant execute on function public.get_months_kpis(text[]) to authenticated;

-- ดัชนีช่วย filter เดือน (expenses มี month_label อยู่แล้ว; sales ยังพึ่ง to_char)
create index if not exists idx_expenses_month_label_item
  on public.expenses (month_label, item_key);
