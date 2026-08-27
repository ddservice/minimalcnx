import Icon from '../../components/icon';
import { requirePage } from '../../lib/session';
import AppShell from '../../components/app-shell';
import PageHeader from '../../components/page-header';
import { fmtMoney } from '../../lib/format';
import { monthInputToLabel, currentMonthInput, OPEX_ALL_CATEGORIES, computeEffectiveOpex } from '../../lib/opex';
import { EXPENSE_CATEGORIES } from '../../lib/expense-categories';
import MonthPicker from './month-picker';
import RevenueChart from './revenue-chart';
import ExpenseChart from './expense-chart';
import DataTable from '../../components/data-table';
import { readBusinessConfig } from '../../lib/config-store';
import Kpi from '../../components/kpi';

export default async function ReportsPage({ searchParams }) {
  const { supabase, role, name, isAdmin, allowed } = await requirePage('/reports');

  const sp = await searchParams;
  const monthInput = /^\d{4}-\d{2}$/.test(sp?.month || '') ? sp.month : currentMonthInput();
  const monthLabel = monthInputToLabel(monthInput);

  const [{ data: summary }, opexDefaults] = await Promise.all([
    supabase.rpc('get_monthly_summary', { p_month_label: monthLabel }),
    readBusinessConfig(supabase, 'opex_defaults', {}),
  ]);
  const sales = summary?.sales || [];
  const expenses = summary?.expenses || [];

  const income = sales.reduce((a, s) => a + Number(s.net_revenue || 0), 0);
  const catSum = (c) =>
    expenses.filter((e) => !e.item_key && e.category === c).reduce((a, e) => a + Number(e.total_amount || 0), 0);
  const matTotal = catSum('ต้นทุนวัตถุดิบ');
  const bakTotal = catSum('ต้นทุนขนมหน้าร้าน');
  const miscTotal = catSum('รายจ่ายจิปาถะ');
  const opexTotal = computeEffectiveOpex(expenses, opexDefaults);
  const totalExp = matTotal + bakTotal + miscTotal + opexTotal;
  const profit = income - totalExp;

  const totalCups = sales.reduce((a, s) => a + Number(s.total_cups || 0), 0);
  const pastryRev = sales.reduce((a, s) => a + Number(s.pastry_revenue || 0), 0);
  const freeCups = sales.reduce((a, s) => a + Number(s.free_cups || 0), 0);
  const daysRecorded = sales.length;

  const expRows = [
    { label: 'ต้นทุนวัตถุดิบ', v: matTotal },
    { label: 'ต้นทุนขนม', v: bakTotal },
    { label: 'รายจ่ายจิปาถะ', v: miscTotal },
    { label: 'ค่าดำเนินการ', v: opexTotal },
    { label: 'รวมรายจ่าย', v: totalExp, total: true },
  ];
  const expCols = [
    { key: 'label', label: 'หมวด', render: (r) => <span style={{ fontWeight: r.total ? 700 : 400 }}>{r.label}</span> },
    { key: 'v', label: 'จำนวนเงิน', align: 'right', render: (r) => (
      <strong style={{ fontWeight: r.total ? 700 : 600, color: r.total ? 'var(--danger)' : 'var(--text)' }}>{fmtMoney(r.v)} ฿</strong>
    ) },
  ];

  // รายการรายจ่ายทั้งเดือนแบบละเอียด (ไม่รวมค่าดำเนินการ — มีหน้า /opex ของตัวเองแล้ว)
  const catLabel = {};
  EXPENSE_CATEGORIES.forEach((c) => { catLabel[c.value] = c.label; });
  const itemRows = expenses
    .filter((e) => !e.item_key)
    .slice()
    .sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  const itemCols = [
    { key: 'date', label: 'วันที่' },
    { key: 'category', label: 'หมวด', render: (r) => catLabel[r.category] || r.category },
    { key: 'item_name', label: 'รายการ' },
    { key: 'subcategory', label: 'ผู้ขาย/ซัพพลายเออร์', render: (r) => r.subcategory || '—' },
    { key: 'quantity', label: 'จำนวน', align: 'right', render: (r) => `${fmtMoney(r.quantity)} ${r.unit || ''}` },
    { key: 'unit_price', label: 'ราคา/หน่วย', align: 'right', render: (r) => `${fmtMoney(r.unit_price)} ฿` },
    { key: 'payment_method', label: 'ชำระด้วย' },
    { key: 'total_amount', label: 'รวม', align: 'right', render: (r) => <strong>{fmtMoney(r.total_amount)} ฿</strong> },
  ];

  return (
    <AppShell role={role} name={name} isAdmin={isAdmin} allowed={allowed}>
      <PageHeader icon="ti-chart-bar" title="สรุปรายเดือน">
        <MonthPicker value={monthInput} />
        <a className="link-btn" href={`/export?month=${monthInput}`}>
          <Icon name="ti-download" /> Excel
        </a>
      </PageHeader>

      <div className="kpis">
        <Kpi label="รายรับสุทธิ (หัก GP)" value={fmtMoney(income)} sub="บาท" cls="green" icon="ti-trending-up" />
        <Kpi label="รายจ่ายรวม" value={fmtMoney(totalExp)} sub="บาท" cls="red" icon="ti-trending-down" />
        <Kpi label={profit >= 0 ? 'กำไรสุทธิ' : 'ขาดทุนสุทธิ'} value={fmtMoney(profit)} sub="บาท" cls={profit >= 0 ? 'blue' : 'red'} icon="ti-scale" />
      </div>

      <RevenueChart sales={sales} />
      <ExpenseChart mat={matTotal} bak={bakTotal} misc={miscTotal} opex={opexTotal} />

      <div className="card">
        <div className="card-head"><Icon name="ti-list-details" /><h2>รายจ่ายแยกหมวด — {monthLabel}</h2></div>
        <div className="card-body">
          <DataTable columns={expCols} rows={expRows} rowKey={(r) => r.label} />
        </div>
      </div>

      <div className="card">
        <div className="card-head"><Icon name="ti-receipt-2" /><h2>รายการรายจ่ายทั้งเดือน — {monthLabel}</h2></div>
        <div className="card-body">
          <DataTable columns={itemCols} rows={itemRows} rowKey={(r) => r.id} emptyText="ยังไม่มีรายจ่ายในเดือนนี้" />
        </div>
      </div>

      <div className="card">
        <div className="card-head"><Icon name="ti-cup" /><h2>สถิติการขาย</h2></div>
        <div className="card-body" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 12 }}>
          <Mini label="วันที่บันทึก" value={`${daysRecorded} วัน`} />
          <Mini label="ยอดขายรวม" value={`${fmtMoney(totalCups)} แก้ว`} />
          <Mini label="รายได้ขนม" value={`${fmtMoney(pastryRev)} ฿`} />
          <Mini label="แก้วฟรี" value={`${fmtMoney(freeCups)} แก้ว`} />
        </div>
      </div>

      {daysRecorded === 0 && <p className="muted" style={{ fontSize: 13 }}>ยังไม่มีข้อมูลยอดขายในเดือนนี้</p>}
    </AppShell>
  );
}

function Mini({ label, value }) {
  return (
    <div>
      <div className="muted" style={{ fontSize: 12 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, marginTop: 2 }}>{value}</div>
    </div>
  );
}
