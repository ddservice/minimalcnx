'use server';

import { createClient } from '../../lib/supabase/server';
import { monthInputToLabel } from '../../lib/opex';
import { readBusinessConfig } from '../../lib/config-store';
import { requireSession } from '../../lib/session';

export async function getMonthlyReportAction(monthInput) {
  if (!/^\d{4}-\d{2}$/.test(monthInput || '')) {
    return { error: 'รูปแบบเดือนไม่ถูกต้อง' };
  }

  const { supabase, allowed } = await requireSession();
  if (allowed && !allowed.includes('/reports')) {
    return { error: 'ไม่มีสิทธิ์เข้าถึงหน้านี้' };
  }

  const monthLabel = monthInputToLabel(monthInput);
  const [{ data: summary }, opexDefaults, bizInfo] = await Promise.all([
    supabase.rpc('get_monthly_summary', { p_month_label: monthLabel }),
    readBusinessConfig(supabase, 'opex_defaults', {}),
    readBusinessConfig(supabase, 'biz_info', {}),
  ]);

  return {
    sales: summary?.sales || [],
    expenses: summary?.expenses || [],
    opexDefaults: opexDefaults || {},
    bizInfo: bizInfo || {},
  };
}
