import { requirePage } from '../../lib/session';
import AppShell from '../../components/app-shell';
import PageHeader from '../../components/page-header';
import SalesForm from './sales-form';
import { canDeleteOnPage } from '../../lib/perms';
import { readBusinessConfig } from '../../lib/config-store';

function todayISO() {
  const now = new Date(Date.now() + 7 * 60 * 60 * 1000);
  return now.toISOString().slice(0, 10);
}

export default async function SalesPage({ searchParams }) {
  const { supabase, role, name, isAdmin, allowed, caps, perms } = await requirePage('/sales');

  const sp = await searchParams;
  const date = sp?.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : todayISO();

  const [{ data: existing }, bizInfo] = await Promise.all([
    supabase.from('sales_daily').select('*').eq('date', date).maybeSingle(),
    readBusinessConfig(supabase, 'biz_info', {}),
  ]);
  const defaultCoffeePrice = Number(bizInfo?.free_cup_cost) || 55;

  return (
    <AppShell role={role} name={name} isAdmin={isAdmin} allowed={allowed}>
      <PageHeader icon="ti-cash" title="บันทึกยอดขายรายวัน" />
      {/* key={date} → บังคับ remount ตอนเปลี่ยนวันที่ ไม่งั้น useState ที่ initialize จาก existing
          จะรันแค่ครั้งแรกตอน mount เท่านั้น เปลี่ยนวันที่แล้ว props เปลี่ยนแต่ state ค้างของวันเก่า */}
      <SalesForm
        key={date}
        date={date}
        existing={existing || null}
        defaultCoffeePrice={defaultCoffeePrice}
        access={caps['/sales']}
        canDelete={canDeleteOnPage(role, '/sales', perms)}
      />
    </AppShell>
  );
}
