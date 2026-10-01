// ตัวเลขหน้า /dashboard — แยกเป็นฟังก์ชันล้วนเพื่อให้ tests/dashboard.test.mjs ครอบได้
import { computeEffectiveOpex } from './opex.js';

const pad = (n) => String(n).padStart(2, '0');

// 'YYYY-MM' ของเดือนก่อนหน้า
export function prevMonthInput(monthInput) {
  const [y, m] = String(monthInput).split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${pad(m - 1)}`;
}

export function daysInMonth(monthInput) {
  const [y, m] = String(monthInput).split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

// วันสุดท้ายของเดือนที่ "ควรมียอดขายแล้ว"
// - เดือนที่ผ่านไปแล้ว = วันสุดท้ายของเดือน
// - เดือนปัจจุบัน = วันนี้ถ้ากรอกยอดวันนี้แล้ว ไม่งั้นนับถึงเมื่อวาน (ร้านยังไม่ปิด ยังไม่ถือว่าลืมกรอก)
// คืน 0 ได้ (วันที่ 1 และยังไม่ได้กรอก) = ยังไม่มีอะไรให้เทียบหรือเตือน
export function cutoffDay(monthInput, todayISO, salesDates) {
  const todayMonth = todayISO.slice(0, 7);
  if (monthInput < todayMonth) return daysInMonth(monthInput);
  if (monthInput > todayMonth) return 0;
  const today = Number(todayISO.slice(8, 10));
  return (salesDates || []).includes(todayISO) ? today : today - 1;
}

// วันที่ (YYYY-MM-DD) ตั้งแต่วันที่ 1 ถึง uptoDay ที่ยังไม่มีแถวยอดขาย
export function missingSalesDays(monthInput, salesDates, uptoDay) {
  const have = new Set(salesDates || []);
  const out = [];
  for (let d = 1; d <= uptoDay; d += 1) {
    const iso = `${monthInput}-${pad(d)}`;
    if (!have.has(iso)) out.push(iso);
  }
  return out;
}

// สรุปเดือนจากผล get_monthly_summary
// uptoDay: นับยอดขาย + รายจ่ายรายวันเฉพาะวันที่ 1..uptoDay (ไม่ส่ง = ทั้งเดือน)
// ค่าดำเนินการ (OPEX) เป็นยอดรายเดือน จึงนับเต็มเดือนเสมอทั้งสองฝั่งของการเทียบ
export function summarizeMonth(summary, opexDefaults, uptoDay) {
  const within = (row) => !uptoDay || Number(String(row.date || '').slice(8, 10)) <= uptoDay;
  const sales = (summary?.sales || []).filter(within);
  const expenses = summary?.expenses || [];
  const sum = (rows, key) => rows.reduce((a, r) => a + Number(r[key] || 0), 0);

  const income = sum(sales, 'net_revenue');
  const regExp = sum(expenses.filter((e) => !e.item_key && within(e)), 'total_amount');
  const totalExp = regExp + computeEffectiveOpex(expenses, opexDefaults);
  return {
    income,
    totalExp,
    profit: income - totalExp,
    totalCups: sum(sales, 'total_cups'),
    pastryPieces: sum(sales, 'pastry_pieces'),
    freeCups: sum(sales, 'free_cups'),
  };
}

// % เปลี่ยนแปลงเทียบฐานเดิม — null เมื่อไม่มีฐานให้เทียบ (ฐาน = 0 หารไม่ได้ และ "เพิ่ม ∞%" ไม่มีความหมาย)
export function pctChange(cur, prev) {
  const c = Number(cur) || 0;
  const p = Number(prev) || 0;
  if (p === 0) return null;
  return ((c - p) / Math.abs(p)) * 100;
}
