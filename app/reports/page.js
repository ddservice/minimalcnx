import { requirePage } from '../../lib/session';
import { currentMonthInput, monthInputToLabel } from '../../lib/opex';
import { readBusinessConfig } from '../../lib/config-store';
import ReportsClient from './reports-client';

export default async function ReportsPage({ searchParams }) {
  const { supabase, role, name, isAdmin, allowed } = await requirePage('/reports');

  const sp = await searchParams;
  const monthInput = /^\d{4}-\d{2}$/.test(sp?.month || '') ? sp.month : currentMonthInput();
  const monthLabel = monthInputToLabel(monthInput);

  const [{ data: summary }, opexDefaults, bizInfo] = await Promise.all([
    supabase.rpc('get_monthly_summary', { p_month_label: monthLabel }),
    readBusinessConfig(supabase, 'opex_defaults', {}),
    readBusinessConfig(supabase, 'biz_info', {}),
  ]);

  const initialData = {
    sales: summary?.sales || [],
    expenses: summary?.expenses || [],
    opexDefaults: opexDefaults || {},
    bizInfo: bizInfo || {},
  };

  return (
    <ReportsClient
      key={monthInput}
      initialMonth={monthInput}
      initialData={initialData}
      role={role}
      name={name}
      isAdmin={isAdmin}
      allowed={allowed}
    />
  );
}
