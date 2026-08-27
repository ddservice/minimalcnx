-- ================================================================
-- optimize_queries.sql: Database Performance & Speed Optimization
-- รัน SQL นี้ใน Supabase SQL Editor เพื่อเร่งความเร็วการดึงข้อมูลรายงานและสรุปรายเดือน
-- Idempotent — รันซ้ำได้ปลอดภัย
-- ================================================================

-- ── 1. ดัชนีเพิ่มประสิทธิภาพการค้นหาตามช่วงวันที่และเดือน ──
-- สำหรับ regular expenses (mat/bak/misc) ที่ค้นหาด้วย date
create index if not exists idx_expenses_date_item_null
  on public.expenses (date desc)
  where item_key is null;

-- สำหรับ opex items ที่ค้นหาด้วย month_label
create index if not exists idx_expenses_month_opex
  on public.expenses (month_label)
  where item_key is not null;

-- ดัชนี composite สำหรับ analytics materials aggregation
create index if not exists idx_expenses_date_category
  on public.expenses (date, category)
  where item_key is null;


-- ── 2. ปรับปรุง get_monthly_summary RPC ให้ใช้ Index Scan 100% ──
-- แทนที่ OR condition เดิมด้วย UNION ALL เพื่อให้ Postgres ใช้ index ตรงจุด
-- ดึงข้อมูลยอดขายและรายจ่ายรายเดือนได้รวดเร็วทันที แม้มีรายการนับร้อยแถว
create or replace function public.get_monthly_summary(p_month_label text)
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  _sales        jsonb;
  _expenses     jsonb;
  _month_start  date;
  _month_end    date;
begin
  _month_start := date_trunc('month', to_date(p_month_label, 'MM/YYYY'))::date;
  _month_end   := (_month_start + interval '1 month - 1 day')::date;

  -- ดึงยอดขายประจำเดือน เรียงตามวันที่
  select jsonb_agg(row_to_json(s) order by s.date asc) into _sales
  from public.sales_daily s
  where s.date >= _month_start and s.date <= _month_end;

  -- ดึงรายจ่ายประจำเดือน:
  -- 1) Regular expenses (วัตถุดิบ/ขนม/จิปาถะ) กรองด้วย date range ผ่าน idx_expenses_date_item_null
  -- 2) OPEX items กรองด้วย month_label ผ่าน idx_expenses_month_opex
  select jsonb_agg(row_to_json(e) order by e.date asc, e.created_at asc) into _expenses
  from (
    select * from public.expenses
    where date >= _month_start and date <= _month_end and item_key is null
    union all
    select * from public.expenses
    where month_label = p_month_label and item_key is not null
  ) e;

  return jsonb_build_object(
    'month',    p_month_label,
    'sales',    coalesce(_sales, '[]'::jsonb),
    'expenses', coalesce(_expenses, '[]'::jsonb)
  );
end;
$$;

revoke all on function public.get_monthly_summary(text) from public;
grant execute on function public.get_monthly_summary(text) to authenticated;


-- ── 3. ปรับปรุง get_months_kpis RPC สำหรับหน้า /analytics ──
-- ใช้ date range เทียบ index ตรงๆ แทน to_char() บน sales_daily
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
  _reg numeric;
  _opex jsonb;
  _materials jsonb;
  _m_start date;
  _m_end date;
begin
  if p_month_labels is null or array_length(p_month_labels, 1) is null then
    return jsonb_build_object('months', '[]'::jsonb);
  end if;

  foreach _label in array p_month_labels loop
    _m_start := date_trunc('month', to_date(_label, 'MM/YYYY'))::date;
    _m_end   := (_m_start + interval '1 month - 1 day')::date;

    -- รายรับสุทธิ (ใช้ index บน date)
    select coalesce(sum(s.net_revenue), 0) into _income
    from public.sales_daily s
    where s.date >= _m_start and s.date <= _m_end;

    -- รายจ่ายทั่วไป (ใช้ index บน date)
    select coalesce(sum(e.total_amount), 0) into _reg
    from public.expenses e
    where e.date >= _m_start and e.date <= _m_end
      and e.item_key is null;

    -- ค่าดำเนินการ (OPEX)
    select coalesce(jsonb_agg(jsonb_build_object(
      'item_key', e.item_key,
      'category', e.category,
      'total_amount', e.total_amount
    )), '[]'::jsonb)
    into _opex
    from public.expenses e
    where e.month_label = _label
      and e.item_key is not null;

    -- วัตถุดิบแยกรายการสำหรับหน้าวิเคราะห์
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
      where e.date >= _m_start and e.date <= _m_end
        and e.item_key is null
        and e.category = 'ต้นทุนวัตถุดิบ'
        and trim(coalesce(e.item_name, '')) <> ''
      group by 1, 2
    ) x;

    _months := _months || jsonb_build_array(jsonb_build_object(
      'month', _label,
      'income', _income,
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
