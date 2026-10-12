import { requirePage } from '../../lib/session';
import AppShell from '../../components/app-shell';
import PageHeader from '../../components/page-header';
import {
  OPEX_OPERATING,
  OPEX_STAFF,
  OPEX_TAX,
  OPEX_ALL_CATEGORIES,
  monthInputToLabel,
  currentMonthInput,
} from '../../lib/opex';
import OpexForm from './opex-form';
import Form50 from './form50';

export default async function OpexPage({ searchParams }) {
  const { supabase, role, name, isAdmin, allowed, caps } = await requirePage('/opex');

  const sp = await searchParams;
  const monthInput = /^\d{4}-\d{2}$/.test(sp?.month || '') ? sp.month : currentMonthInput();
  const monthLabel = monthInputToLabel(monthInput);

  const { data: rows } = await supabase
    .from('expenses')
    .select('item_key, item_name, total_amount, category')
    .in('category', OPEX_ALL_CATEGORIES)
    .eq('month_label', monthLabel)
    .not('item_key', 'is', null);

  // ยอดขายสุทธิของเดือน (สำหรับคำนวณ VAT อัตโนมัติ)
  const [yy, mm] = monthInput.split('-');
  const mStart = `${yy}-${mm}-01`;
  const mEnd = new Date(Number(yy), Number(mm), 0).toISOString().slice(0, 10);
  const { data: salesRows } = await supabase
    .from('sales_daily')
    .select('net_revenue')
    .gte('date', mStart)
    .lte('date', mEnd);
  const income = (salesRows || []).reduce((a, r) => a + Number(r.net_revenue || 0), 0);

  // ข้อมูลบริษัท (หัวสลิป) + ผู้รับเงิน 50 ทวิ
  const { data: cfgs } = await supabase
    .from('business_config')
    .select('key, value')
    .in('key', ['biz_info', 'form50_payees', 'opex_defaults', 'emp_pay_history', 'emp_details']);
  const bizInfo = cfgs?.find((c) => c.key === 'biz_info')?.value || {};
  const form50Payees = cfgs?.find((c) => c.key === 'form50_payees')?.value || {};
  const opexDefaults = cfgs?.find((c) => c.key === 'opex_defaults')?.value || {};
  const empPayHistory = cfgs?.find((c) => c.key === 'emp_pay_history')?.value || {};
  const empDetails = cfgs?.find((c) => c.key === 'emp_details')?.value || {};

  // ยอดค่าเช่า/พนักงานแทนของทุกเดือนในปีเดียวกัน — สำหรับพิมพ์ 50 ทวิ หลายเดือน/ทั้งปี
  const { data: yearRows } = await supabase
    .from('expenses')
    .select('item_key, month_label, total_amount')
    .in('item_key', ['rent', 'staff_sub'])
    .like('month_label', `%/${yy}`);
  const yearAmounts = { rent: {}, staff_sub: {} };
  (yearRows || []).forEach((r) => {
    if (yearAmounts[r.item_key]) yearAmounts[r.item_key][r.month_label] = Number(r.total_amount) || 0;
  });

  const operating = {};
  const staff = {};
  const tax = {};
  const employees = [];
  const OP_KEYS = new Set(OPEX_OPERATING.items.map((i) => i.key));
  const STAFF_KEYS = new Set(OPEX_STAFF.fixed.map((i) => i.key));
  const TAX_KEYS = new Set(OPEX_TAX.items.map((i) => i.key));

  (rows || []).forEach((r) => {
    const k = r.item_key;
    if (OP_KEYS.has(k)) operating[k] = r.total_amount;
    else if (STAFF_KEYS.has(k)) staff[k] = r.total_amount;
    else if (TAX_KEYS.has(k)) tax[k] = r.total_amount;
    else if (k.startsWith(OPEX_STAFF.empPrefix)) {
      const idx = parseInt(k.slice(OPEX_STAFF.empPrefix.length), 10);
      if (Number.isFinite(idx)) employees[idx - 1] = { label: r.item_name || '', amount: r.total_amount };
    }
  });

  return (
    <AppShell role={role} name={name} isAdmin={isAdmin} allowed={allowed}>
      <PageHeader icon="ti-building-store" title="ค่าดำเนินการ (รายเดือน)" />
      {/* key={monthInput} → บังคับ remount ตอนเปลี่ยนเดือน — เหตุผลเดียวกับ SalesForm (ดู app/sales/page.js):
          operating/staff/tax/employees ทั้งหมด initialize จาก existing ผ่าน useState(() => ...) ครั้งเดียว
          ตอน mount เท่านั้น ถ้าไม่ remount ตัวเลขเดือนเก่าจะค้างอยู่ทั้งที่เปลี่ยนเดือนแล้ว */}
      <OpexForm
        key={monthInput}
        monthInput={monthInput}
        monthLabel={monthLabel}
        income={income}
        bizInfo={bizInfo}
        isAdmin={isAdmin}
        opexDefaults={opexDefaults}
        empPayHistory={empPayHistory}
        empDetails={empDetails}
        canEditEmpDetails={(role === 'admin' || role === 'co-admin') && caps['/opex']?.edit}
        access={caps['/opex']}
        hasSaved={(rows || []).length > 0}
        existing={{ operating, staff, tax, employees: employees.filter(Boolean) }}
      />
      <Form50
        amounts={{ rent: operating.rent || 0, staff_sub: staff.staff_sub || 0 }}
        yearAmounts={yearAmounts}
        payees={form50Payees}
        bizInfo={bizInfo}
        monthLabel={monthLabel}
        canEdit={(role === 'admin' || role === 'co-admin') && caps['/opex']?.edit}
        isAdmin={isAdmin}
      />
    </AppShell>
  );
}
