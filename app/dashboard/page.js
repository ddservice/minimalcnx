import Icon from '../../components/icon';
import Link from 'next/link';
import { requirePage } from '../../lib/session';
import AppShell from '../../components/app-shell';
import Kpi from '../../components/kpi';
import { fmtMoney } from '../../lib/format';
import PageHeader from '../../components/page-header';
import MonthPicker from '../reports/month-picker';
import { currentMonthInput, monthInputToLabel } from '../../lib/opex';
import { prevMonthInput, cutoffDay, missingSalesDays, summarizeMonth, pctChange } from '../../lib/dashboard';
import { readBusinessConfig } from '../../lib/config-store';

const ACTIONS = [
  { href: '/sales', label: 'บันทึกยอดขาย', icon: 'ti-cash', desc: 'ยอดขายรายวัน + delivery' },
  { href: '/expenses', label: 'บันทึกรายจ่าย', icon: 'ti-receipt', desc: 'วัตถุดิบ / ขนม / จิปาถะ' },
  { href: '/opex', label: 'ค่าดำเนินการ', icon: 'ti-building-store', desc: 'ค่าเช่า / พนักงาน / ภาษี' },
  { href: '/reports', label: 'สรุปรายเดือน', icon: 'ti-chart-bar', desc: 'รายรับ-รายจ่าย + กราฟ' },
];

function todayISO() {
  return new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// ▲/▼ เทียบเดือนก่อน — good: ทิศทางที่ถือว่าดี ('up' รายรับ, 'down' รายจ่าย, null = ไม่ตัดสิน)
function pctDelta(cur, prev, good) {
  const pct = pctChange(cur, prev);
  if (pct === null) return null;
  const up = pct >= 0;
  const tone = !good || Math.abs(pct) < 0.05 ? 'flat' : (up ? 'up' : 'down') === good ? 'good' : 'bad';
  return { text: `${up ? '▲' : '▼'} ${Math.abs(pct).toFixed(1)}%`, tone };
}

// กำไรเทียบเป็นบาท ไม่ใช่ % — ฐานที่ติดลบหรือใกล้ศูนย์ทำให้ % ไม่มีความหมาย
function bahtDelta(cur, prev) {
  const diff = cur - prev;
  const up = diff >= 0;
  return { text: `${up ? '▲' : '▼'} ${fmtMoney(Math.abs(diff))} ฿`, tone: Math.abs(diff) < 0.5 ? 'flat' : up ? 'good' : 'bad' };
}

export default async function DashboardPage({ searchParams }) {
  const { supabase, role, name, isAdmin, allowed } = await requirePage('/dashboard');

  const sp = await searchParams;
  const thisMonth = currentMonthInput();
  // เดือนในอนาคตยังไม่มีข้อมูล — ถ้า ?month= เกินเดือนนี้ (แก้ URL เอง) ให้ถอยกลับมาเดือนปัจจุบัน
  const monthInput = /^\d{4}-\d{2}$/.test(sp?.month || '') && sp.month <= thisMonth ? sp.month : thisMonth;
  const isThisMonth = monthInput === thisMonth;
  const ml = monthInputToLabel(monthInput);
  const suffix = isThisMonth ? 'เดือนนี้' : ` ${ml}`;

  const prevInput = prevMonthInput(monthInput);
  const prevLabel = monthInputToLabel(prevInput);

  const [{ data: summary }, { data: prevSummary }, opexDefaults] = await Promise.all([
    supabase.rpc('get_monthly_summary', { p_month_label: ml }),
    supabase.rpc('get_monthly_summary', { p_month_label: prevLabel }),
    readBusinessConfig(supabase, 'opex_defaults', {}),
  ]);

  const salesDates = (summary?.sales || []).map((s) => String(s.date).slice(0, 10));
  const upto = cutoffDay(monthInput, todayISO(), salesDates);
  // เดือนย้อนหลังที่ไม่มียอดขายเลยสักวัน = เดือนที่ยังไม่ได้ใช้ระบบ ไม่ใช่ "ลืมกรอก 30 วัน"
  const missing = !isThisMonth && !salesDates.length ? [] : missingSalesDays(monthInput, salesDates, upto);

  const cur = summarizeMonth(summary, opexDefaults);
  const { income, totalExp, profit, totalCups, pastryPieces, freeCups } = cur;

  // เดือนนี้ยังไม่จบ → เทียบกับช่วงวันเดียวกันของเดือนก่อน (1..upto) ไม่งั้นครึ่งเดือนจะแพ้เดือนเต็มเสมอ
  // เดือนที่จบแล้ว → เทียบเต็มเดือนต่อเต็มเดือน
  const prevHasData = (prevSummary?.sales || []).length > 0;
  const canCompare = prevHasData && upto > 0;
  const prev = canCompare ? summarizeMonth(prevSummary, opexDefaults, isThisMonth ? upto : undefined) : null;
  const compareNote = !canCompare
    ? null
    : isThisMonth
      ? `▲▼ เทียบกับวันที่ 1–${upto} ของเดือน ${prevLabel} · ค่าดำเนินการนับเต็มเดือนทั้งสองฝั่ง`
      : `▲▼ เทียบกับเดือน ${prevLabel} ทั้งเดือน`;
  const canOpenSales = !allowed || allowed.includes('/sales');

  return (
    <AppShell role={role} name={name} isAdmin={isAdmin} allowed={allowed}>
      <PageHeader icon="ti-layout-dashboard" title="ภาพรวม">
        {!isThisMonth && <Link className="link-btn" href="/dashboard">กลับเดือนนี้</Link>}
        <MonthPicker value={monthInput} basePath="/dashboard" max={thisMonth} />
      </PageHeader>

      {missing.length > 0 && (
        <div className="card" style={{ borderColor: 'var(--color-accent)' }}>
          <div className="card-body" style={{ display: 'grid', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600 }}>
              <Icon name="ti-alert-triangle" style={{ color: 'var(--color-accent-hover)' }} />
              ยังไม่ได้กรอกยอดขาย {missing.length} วัน
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {missing.map((d) => {
                const text = `${d.slice(8, 10)}/${d.slice(5, 7)}`;
                return canOpenSales
                  ? <Link key={d} className="link-btn" style={{ padding: '4px 12px' }} href={`/sales?date=${d}`}>{text}</Link>
                  : <span key={d} className="link-btn" style={{ padding: '4px 12px', cursor: 'default' }}>{text}</span>;
              })}
            </div>
            <p className="muted" style={{ fontSize: 'var(--fs-sm)', margin: 0 }}>
              วันที่ขาดไปทำให้รายรับและกำไรของเดือนต่ำกว่าจริง{canOpenSales ? ' — กดวันที่เพื่อไปกรอก' : ''} ถ้าร้านหยุดวันนั้นให้บันทึกยอดเป็น 0
            </p>
          </div>
        </div>
      )}

      <div className="kpis">
        <Kpi icon="ti-trending-up" label={`รายรับ${suffix}`} value={fmtMoney(income)} sub={`บาท (หัก GP) · ${ml}`} cls="green" delta={prev && pctDelta(income, prev.income, 'up')} />
        <Kpi icon="ti-trending-down" label={`รายจ่าย${suffix}`} value={fmtMoney(totalExp)} sub="บาท" cls="red" delta={prev && pctDelta(totalExp, prev.totalExp, 'down')} />
        <Kpi icon="ti-scale" label={profit >= 0 ? 'กำไรสุทธิ' : 'ขาดทุนสุทธิ'} value={fmtMoney(profit)} sub="บาท / เดือน" cls={profit >= 0 ? 'blue' : 'red'} delta={prev && bahtDelta(profit, prev.profit)} />
        <Kpi icon="ti-cup" label="ยอดขายรวม" value={fmtMoney(totalCups)} sub="แก้ว" delta={prev && pctDelta(totalCups, prev.totalCups, 'up')} />
        <Kpi icon="ti-cookie" label="ขนม" value={fmtMoney(pastryPieces)} sub="ชิ้น" delta={prev && pctDelta(pastryPieces, prev.pastryPieces, 'up')} />
        <Kpi icon="ti-gift" label="แก้วฟรี" value={fmtMoney(freeCups)} sub="แก้ว" delta={prev && pctDelta(freeCups, prev.freeCups, null)} />
      </div>
      {compareNote && (
        <p className="muted" style={{ fontSize: 'var(--fs-sm)', marginTop: -12, marginBottom: 20 }}>{compareNote}</p>
      )}

      <div className="card-head" style={{ background: 'transparent', border: 0, padding: '4px 2px 10px' }}>
        <Icon name="ti-bolt" /> <span>เมนูลัด</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
        {ACTIONS.filter((a) => !allowed || allowed.includes(a.href)).map((a) => (
          <Link key={a.href} href={a.href === '/reports' && !isThisMonth ? `/reports?month=${monthInput}` : a.href} className="card" style={{ textDecoration: 'none', color: 'inherit', marginBottom: 0 }}>
            <div className="card-body" style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <div className="brand-icon" style={{ width: 42, height: 42, fontSize: 21, boxShadow: 'none' }}>
                <Icon name={a.icon} />
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: 'var(--fs-lg)' }}>{a.label}</div>
                <div className="muted" style={{ fontSize: 'var(--fs-sm)', marginTop: 2 }}>{a.desc}</div>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </AppShell>
  );
}
