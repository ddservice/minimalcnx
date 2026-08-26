import Icon from '../../components/icon';
import { requirePage } from '../../lib/session';
import AppShell from '../../components/app-shell';
import PageHeader from '../../components/page-header';
import { fmtMoney } from '../../lib/format';
import { computeEffectiveOpex } from '../../lib/opex';
import ProfitChart from './profit-chart';
import RangePicker from './range-picker';
import DataTable from '../../components/data-table';
import { readBusinessConfig } from '../../lib/config-store';
import Kpi from '../../components/kpi';

const isMonth = (s) => /^\d{4}-\d{2}$/.test(s || '');

function monthsBetween(from, to) {
  let [fy, fm] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  const out = [];
  let guard = 0;
  while ((fy < ty || (fy === ty && fm <= tm)) && guard < 60) {
    out.push({ label: `${String(fm).padStart(2, '0')}/${fy}`, input: `${fy}-${String(fm).padStart(2, '0')}` });
    fm++; if (fm > 12) { fm = 1; fy++; }
    guard++;
  }
  return out;
}

function fromKpi(row, opexDefaults = {}) {
  if (!row) {
    return { income: 0, exp: 0, profit: 0, hasData: false, materials: [] };
  }
  const income = Number(row.income || 0);
  const reg = Number(row.expenses_reg || 0);
  // computeEffectiveOpex คาดหวังแถว expenses ที่มี item_key + total_amount
  const opex = computeEffectiveOpex(row.opex_items || [], opexDefaults);
  const exp = reg + opex;
  const hasData = !!(row.has_data || income > 0 || exp > 0);
  return { income, exp, profit: income - exp, hasData, materials: row.materials || [] };
}

const pct = (cur, prev) => (prev ? ((cur - prev) / Math.abs(prev)) * 100 : null);

export default async function AnalyticsPage({ searchParams }) {
  const { supabase, role, name, isAdmin, allowed } = await requirePage('/analytics');
  const sp = await searchParams;

  const opexDefaults = await readBusinessConfig(supabase, 'opex_defaults', {});

  const now = new Date(Date.now() + 7 * 60 * 60 * 1000);
  const curInput = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  let from = isMonth(sp?.from) ? sp.from : `${now.getFullYear()}-01`;
  let to = isMonth(sp?.to) ? sp.to : curInput;
  if (from > to) [from, to] = [to, from];

  const months = monthsBetween(from, to);
  const curYear = now.getFullYear();
  const yearMonths = monthsBetween(`${curYear}-01`, `${curYear}-12`);

  // รวมเดือนในช่วง + ปีปัจจุบัน แล้วเรียก RPC ครั้งเดียว (fallback เป็นรายเดือนถ้ายังไม่รัน SQL)
  const labelSet = new Map();
  [...months, ...yearMonths].forEach((m) => labelSet.set(m.label, m));
  const allLabels = [...labelSet.keys()];

  let byLabel = {};
  const { data: batch, error: batchErr } = await supabase.rpc('get_months_kpis', {
    p_month_labels: allLabels,
  });

  if (!batchErr && batch?.months) {
    (batch.months || []).forEach((row) => {
      byLabel[row.month] = fromKpi(row, opexDefaults);
    });
  } else {
    // fallback: get_monthly_summary ทีละเดือน (ช้ากว่า — ใช้เมื่อยังไม่รัน add_analytics_range_kpis.sql)
    await Promise.all(
      allLabels.map(async (label) => {
        const { data } = await supabase.rpc('get_monthly_summary', { p_month_label: label });
        const sales = data?.sales || [];
        const expenses = data?.expenses || [];
        const income = sales.reduce((a, s) => a + Number(s.net_revenue || 0), 0);
        const reg = expenses.filter((e) => !e.item_key).reduce((a, e) => a + Number(e.total_amount || 0), 0);
        const opex = computeEffectiveOpex(expenses, opexDefaults);
        const exp = reg + opex;
        const matMap = {};
        expenses
          .filter((e) => !e.item_key && e.category === 'ต้นทุนวัตถุดิบ')
          .forEach((e) => {
            const nm = (e.item_name || '').trim();
            if (!nm) return;
            matMap[nm] = matMap[nm] || { item_name: nm, subcategory: (e.subcategory || '').trim(), total: 0, count: 0 };
            matMap[nm].total += Number(e.total_amount || 0);
            matMap[nm].count += 1;
          });
        byLabel[label] = {
          income,
          exp,
          profit: income - exp,
          hasData: sales.length > 0 || expenses.length > 0,
          materials: Object.values(matMap),
        };
      })
    );
  }

  const results = months.map((mo) => ({
    label: mo.label,
    ...(byLabel[mo.label] || { income: 0, exp: 0, profit: 0, hasData: false, materials: [] }),
  }));
  const yearResults = yearMonths.map((mo) => ({
    label: mo.label,
    ...(byLabel[mo.label] || { income: 0, exp: 0, profit: 0, hasData: false, materials: [] }),
  }));

  const matAgg = {};
  const supAgg = {};
  results.forEach((r) => {
    (r.materials || []).forEach((m) => {
      const nm = (m.item_name || '').trim();
      if (nm) {
        matAgg[nm] = matAgg[nm] || { total: 0, count: 0 };
        matAgg[nm].total += Number(m.total || 0);
        matAgg[nm].count += Number(m.count || 0);
      }
      const sup = (m.subcategory || '').trim();
      if (sup) supAgg[sup] = (supAgg[sup] || 0) + Number(m.total || 0);
    });
  });
  const topSpend = Object.entries(matAgg).map(([n, v]) => ({ n, ...v })).sort((a, b) => b.total - a.total).slice(0, 8);
  const topOrders = Object.entries(matAgg).map(([n, v]) => ({ n, ...v })).sort((a, b) => b.count - a.count).slice(0, 8);
  const topSup = Object.entries(supAgg).map(([n, total]) => ({ n, total })).sort((a, b) => b.total - a.total).slice(0, 6);

  const withData = results.filter((r) => r.hasData);
  const totalProfit = withData.reduce((a, r) => a + r.profit, 0);
  const avgProfit = withData.length ? totalProfit / withData.length : 0;
  const best = withData.slice().sort((a, b) => b.profit - a.profit)[0];
  const tableRows = [...results].reverse();

  return (
    <AppShell role={role} name={name} isAdmin={isAdmin} allowed={allowed}>
      <PageHeader icon="ti-chart-line" title="วิเคราะห์">
        <RangePicker from={from} to={to} />
      </PageHeader>

      <div className="kpis">
        <Kpi icon="ti-calendar-stats" label="ช่วงที่เลือก" value={`${withData.length}/${months.length}`} sub="เดือนที่มีข้อมูล" plain />
        <Kpi icon="ti-sum" label="กำไรรวม" value={fmtMoney(totalProfit)} sub="บาท" cls={totalProfit >= 0 ? 'blue' : 'red'} />
        <Kpi icon="ti-scale" label="กำไรเฉลี่ย/เดือน" value={fmtMoney(avgProfit)} sub="บาท" cls={avgProfit >= 0 ? 'green' : 'red'} />
        <Kpi icon="ti-trophy" label="เดือนกำไรสูงสุด" value={best ? best.label : '—'} sub={best ? `${fmtMoney(best.profit)} ฿` : ''} plain />
      </div>

      <ProfitChart data={yearResults} />

      <div className="card">
        <div className="card-head"><Icon name="ti-package" /><h2>วัตถุดิบใช้จ่ายเยอะสุด (ตามยอดเงิน)</h2></div>
        <div className="card-body">
          <DataTable
            emptyText="ยังไม่มีข้อมูลวัตถุดิบในช่วงนี้"
            rowKey={(r) => r.n}
            rows={topSpend.map((m, i) => ({ ...m, rank: i + 1 }))}
            columns={[
              { key: 'rank', label: '#' },
              { key: 'n', label: 'รายการ' },
              { key: 'total', label: 'ยอดรวม', align: 'right', render: (r) => <strong>{fmtMoney(r.total)} ฿</strong> },
              { key: 'count', label: 'จำนวนครั้ง', align: 'right' },
            ]}
          />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
        <div className="card">
          <div className="card-head"><Icon name="ti-shopping-cart" /><h2>สั่งซื้อบ่อยสุด (จำนวนครั้ง)</h2></div>
          <div className="card-body">
            {topOrders.length ? topOrders.map((m, i) => (
              <div key={m.n} style={rankRow}><span>{i + 1}. {m.n}</span><strong>{m.count} ครั้ง</strong></div>
            )) : <p className="muted" style={{ fontSize: 13, margin: 0 }}>—</p>}
          </div>
        </div>
        <div className="card">
          <div className="card-head"><Icon name="ti-building-warehouse" /><h2>ซัพพลายเออร์ยอดสูงสุด</h2></div>
          <div className="card-body">
            {topSup.length ? topSup.map((s, i) => (
              <div key={s.n} style={rankRow}><span>{i + 1}. {s.n}</span><strong>{fmtMoney(s.total)} ฿</strong></div>
            )) : <p className="muted" style={{ fontSize: 13, margin: 0 }}>—</p>}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head"><Icon name="ti-table" /><h2>เปรียบเทียบรายเดือน</h2></div>
        <div className="card-body">
          <DataTable
            rowKey={(r) => r.label}
            rows={tableRows.map((r, i) => ({ ...r, mom: r.hasData && tableRows[i + 1]?.hasData ? pct(r.profit, tableRows[i + 1].profit) : null }))}
            columns={[
              { key: 'label', label: 'เดือน', render: (r) => <span style={{ fontWeight: 600, opacity: r.hasData ? 1 : 0.45 }}>{r.label}</span> },
              { key: 'income', label: 'รายรับ', align: 'right', render: (r) => <span style={{ opacity: r.hasData ? 1 : 0.45 }}>{fmtMoney(r.income)}</span> },
              { key: 'exp', label: 'รายจ่าย', align: 'right', render: (r) => <span style={{ opacity: r.hasData ? 1 : 0.45 }}>{fmtMoney(r.exp)}</span> },
              { key: 'profit', label: 'กำไร', align: 'right', render: (r) => (
                <strong style={{ color: r.profit >= 0 ? 'var(--success)' : 'var(--danger)', opacity: r.hasData ? 1 : 0.45 }}>{fmtMoney(r.profit)}</strong>
              ) },
              { key: 'mom', label: 'MoM', align: 'right', render: (r) => (
                <span style={{ color: r.mom == null ? 'var(--muted)' : r.mom >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                  {r.mom == null ? '—' : `${r.mom >= 0 ? '+' : ''}${r.mom.toFixed(0)}%`}
                </span>
              ) },
            ]}
          />
        </div>
      </div>
    </AppShell>
  );
}

const rankRow = { display: 'flex', justifyContent: 'space-between', gap: 10, padding: '6px 0', borderTop: '1px solid var(--border)', fontSize: 13 };
