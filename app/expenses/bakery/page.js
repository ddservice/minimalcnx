import { redirect } from 'next/navigation';
import { requirePage } from '../../../lib/session';
import AppShell from '../../../components/app-shell';
import PageHeader from '../../../components/page-header';
import { monthBounds, validMonth } from '../../../lib/bakery-cost';
import { currentMonthInput } from '../../../lib/opex';
import BakeryClient from './review-client';

export default async function BakeryPage({ searchParams }) {
  const { supabase, role, name, isAdmin, allowed, caps } = await requirePage('/expenses');
  if (!['admin', 'co-admin'].includes(role) || !allowed.includes('/reports')) redirect('/expenses');
  const sp = await searchParams;
  let defaultMonth = currentMonthInput();
  if (!validMonth(sp?.month)) {
    const [latestInvoice, latestPOS] = await Promise.all([
      supabase.from('bakery_invoices').select('received_on').order('received_on', { ascending: false }).limit(1),
      supabase.from('bakery_pos_imports').select('month').order('month', { ascending: false }).limit(1),
    ]);
    const available = [latestInvoice.data?.[0]?.received_on?.slice(0, 7), latestPOS.data?.[0]?.month].filter(validMonth).sort();
    if (available.length) defaultMonth = available[available.length - 1];
  }
  const month = validMonth(sp?.month) ? sp.month : defaultMonth;
  const { start, end } = monthBounds(month);
  const [invoices, imported, mappings, sales] = await Promise.all([
    supabase.from('bakery_invoices').select('*').gte('received_on', start).lt('received_on', end).order('received_on').limit(301),
    supabase.from('bakery_pos_imports').select('*').eq('month', month).maybeSingle(),
    supabase.from('bakery_item_mappings').select('pos_key,supplier,purchase_name,factor').limit(1001),
    supabase.from('sales_daily').select('date,pastry_pieces,pastry_revenue').gte('date', start).lt('date', end).order('date'),
  ]);
  const failed = invoices.error || imported.error || mappings.error || sales.error;
  const overflow = invoices.data?.length > 300 || mappings.data?.length > 1000;
  return <AppShell role={role} name={name} isAdmin={isAdmin} allowed={allowed}>
    <PageHeader icon="ti-cookie" title="ต้นทุนและกำไรขนม" />
    {failed || overflow ? <div className="card"><div className="card-body" role="alert">
      {overflow ? 'ข้อมูลเกินขอบเขตชุดทดลอง กรุณาติดต่อผู้ดูแลก่อนคำนวณ' : 'ยังอ่านข้อมูลต้นทุนขนมไม่ได้ กรุณาติดต่อผู้ดูแลเพื่อตรวจการติดตั้งและสิทธิ์ แล้วลองโหลดใหม่'}
    </div></div> : <BakeryClient key={month} month={month} invoices={invoices.data || []} imported={imported.data}
      mappings={mappings.data || []} sales={sales.data || []} canManage={!!caps['/expenses']?.edit} />}
  </AppShell>;
}
