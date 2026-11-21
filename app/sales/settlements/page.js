import { redirect } from 'next/navigation';
import Link from 'next/link';
import AppShell from '../../../components/app-shell';
import PageHeader from '../../../components/page-header';
import { requirePage } from '../../../lib/session';
import { bangkokToday, validBusinessDate } from '../../../lib/sales-policy';
import { readSettlements } from '../../../lib/reconciliation-store';
import Settlements from './settlements';
import '../reconciliation.css';

export default async function SettlementsPage({ searchParams }) {
  const acc = await requirePage('/sales');
  if (!['admin', 'co-admin', 'manager'].includes(acc.role) || !acc.caps['/reports'].view) redirect('/sales');
  const sp = await searchParams;
  const today = bangkokToday();
  const month = validBusinessDate(`${sp?.month}-01`) ? sp.month : today.slice(0, 7);
  const state = await readSettlements(acc.supabase, month);
  return <AppShell role={acc.role} name={acc.name} isAdmin={acc.isAdmin} allowed={acc.allowed}>
    <PageHeader icon="ti-cash" title="กระทบยอดเงินรับจากแพลตฟอร์ม" />
    <Link className="recon-button" href="/sales">กลับยอดขายและปิดร้าน</Link>
    <Settlements key={`${month}:${JSON.stringify(state.rows.map((r) => [r.id,r.version]))}`} state={state}
      month={month} today={today} canEdit={acc.caps['/sales'].edit} />
  </AppShell>;
}
