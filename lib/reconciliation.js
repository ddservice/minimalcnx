import { validBusinessDate, bangkokToday } from './sales-policy.js';

export const PLATFORMS = { grab: 'Grab', lineman: 'LINE MAN', shopee: 'Shopee' };
export const STATEMENT_MONEY = {
  gross: 'ยอดขายตามใบสรุป', commission: 'ค่าคอมมิชชั่นรวม VAT',
  fees: 'ค่าบริการอื่นรวม VAT', discounts: 'ส่วนลดที่ร้านรับภาระ',
  refunds: 'คืนเงิน / ยกเลิก', withholding: 'ภาษีหัก ณ ที่จ่ายตามใบสรุป',
  additions: 'เงินเพิ่ม / ชดเชย', deductions: 'รายการหักอื่น',
};
export function money(value, label, optional = false) {
  if (optional && (value === '' || value == null)) return 0;
  const text = String(value ?? '').trim();
  if (!/^\d+(\.\d{1,2})?$/.test(text) || Number(text) > 999999999.99) {
    throw new Error(`${label}: กรอกจำนวนเงินตั้งแต่ 0 ไม่เกิน 999,999,999.99 และทศนิยมไม่เกิน 2 ตำแหน่ง`);
  }
  return Math.round(Number(text) * 100) / 100;
}
const cents = (v) => Math.round(Number(v || 0) * 100);
export const amountText = (v) => Number(v || 0).toLocaleString('th-TH', {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
});
export function salesSnapshot(sales) {
  return Object.fromEntries(['cash_amount', 'kshop_amount', 'lineman_before_gp',
    'grab_before_gp', 'shopee_before_gp'].map((k) => [k, cents(sales[k]) / 100]));
}
export function closingTotals(sales, input) {
  const expectedPos = cents(sales.cash_amount) + cents(sales.kshop_amount) + cents(sales.lineman_before_gp);
  const expectedCash = cents(input.opening_float) + cents(sales.cash_amount)
    + cents(input.cash_in) - cents(input.cash_out);
  return { expected_pos: expectedPos / 100, expected_cash: expectedCash / 100,
    pos_difference: (cents(input.printed_pos) - expectedPos) / 100,
    cash_difference: (cents(input.cash_count) - expectedCash) / 100 };
}
export function statementNet(input) {
  return (cents(input.gross) + cents(input.additions) - ['commission', 'fees', 'discounts',
    'refunds', 'withholding', 'deductions'].reduce((n, k) => n + cents(input[k]), 0)) / 100;
}
export function settlementStatus(statement, today = bangkokToday()) {
  if (statement.voided_at) return { label: 'ยกเลิก', tone: 'muted' };
  const remaining = cents(statement.expected_net) - cents(statement.received_total);
  if (remaining < 0) return { label: 'รับเกินใบสรุป', tone: 'danger' };
  if (remaining === 0) return { label: Number(statement.sales_difference) !== 0 || statement.missing_days > 0
    ? 'เงินครบ · ตรวจยอดขายต่อ' : 'ตรงกันครบ', tone: 'success' };
  if (statement.due_date && statement.due_date < today) return { label: 'เลยกำหนดรับเงิน', tone: 'danger' };
  return { label: cents(statement.received_total) > 0 ? 'รับบางส่วน' : 'รอรับเงิน', tone: 'warning' };
}
function text(value, label, max, required = false) {
  const s = String(value ?? '').trim();
  if ((required && !s) || s.length > max) throw new Error(`${label}: ${required ? 'กรอกข้อมูลและ' : ''}ใช้ไม่เกิน ${max} ตัวอักษร`);
  return s;
}
function date(value, label) {
  if (!validBusinessDate(value)) throw new Error(`${label}: วันที่ไม่ถูกต้อง`);
  return value;
}
function version(value) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 0) throw new Error('เวอร์ชันรายการไม่ถูกต้อง กรุณาเปิดหน้าใหม่');
  return n;
}
const uuid = (value) => {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value || '')) throw new Error('รหัสรายการไม่ถูกต้อง');
  return value;
};
export function validateReconciliation(command, input, today = bangkokToday()) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('ข้อมูลไม่ถูกต้อง');
  if (command === 'close.save') {
    const p = { date: date(input.date, 'วันปิดร้าน'), version: version(input.version),
      sales_snapshot: salesSnapshot(input.sales_snapshot || {}) };
    for (const k of ['printed_pos', 'opening_float', 'cash_count', 'cash_in', 'cash_out']) {
      p[k] = money(input[k], { printed_pos: 'ยอดใบ POS', opening_float: 'เงินทอนตั้งต้น',
        cash_count: 'เงินสดนับได้', cash_in: 'เงินเข้าลิ้นชักเพิ่ม', cash_out: 'เงินออกลิ้นชัก' }[k], k === 'cash_in' || k === 'cash_out');
    }
    p.note = text(input.note, 'หมายเหตุ', 1000);
    const totals = closingTotals(p.sales_snapshot, p);
    if ((p.cash_in || p.cash_out || totals.pos_difference || totals.cash_difference || p.version > 0) && !p.note) {
      throw new Error('กรอกเหตุผลเมื่อยอดต่าง มีเงินเข้าออกลิ้นชัก หรือแก้ไขการปิดร้าน');
    }
    if (totals.expected_cash < 0) throw new Error('เงินออกลิ้นชักเกินเงินที่ควรมี กรุณาตรวจยอด');
    return p;
  }
  if (command === 'settlement.save') {
    if (!Object.hasOwn(PLATFORMS, input.platform)) throw new Error('เลือกแพลตฟอร์ม');
    const p = { id: input.id ? uuid(input.id) : null, version: version(input.version), platform: input.platform,
      period_from: date(input.period_from, 'เริ่มรอบ'), period_to: date(input.period_to, 'สิ้นสุดรอบ'),
      reference: text(input.reference, 'เลขที่ใบสรุป', 120, true),
      due_date: input.due_date ? date(input.due_date, 'กำหนดรับเงิน') : null,
      note: text(input.note, 'หมายเหตุ', 1000) };
    if (p.period_from > p.period_to || p.period_to > today ||
      (Date.parse(p.period_to) - Date.parse(p.period_from)) / 86400000 > 365) throw new Error('รอบยอดขายต้องเรียงวันที่ ไม่เกินวันนี้ และไม่เกิน 366 วัน');
    for (const [k, label] of Object.entries(STATEMENT_MONEY)) p[k] = money(input[k], label, k !== 'gross');
    if (statementNet(p) < 0) throw new Error('ยอดหักเกินยอดขายและเงินเพิ่ม กรุณาตรวจใบสรุป');
    if (p.version > 0 && !p.note) throw new Error('กรอกเหตุผลการแก้ไขใบสรุป');
    return p;
  }
  if (command === 'payment.add') return { settlement_id: uuid(input.settlement_id), version: version(input.version),
    received_date: date(input.received_date, 'วันที่เงินเข้าจริง'),
    amount: (() => { const n = money(input.amount, 'เงินเข้าจริง'); if (!n) throw new Error('เงินเข้าจริงต้องมากกว่า 0'); return n; })(),
    bank_reference: text(input.bank_reference, 'เลขอ้างอิงธนาคาร', 120, true),
    note: text(input.note, 'หมายเหตุ', 1000),
    ...(() => { if (input.received_date > today) throw new Error('วันที่เงินเข้าจริงต้องไม่เกินวันนี้'); return {}; })() };
  if (command === 'settlement.void' || command === 'payment.void') return {
    id: uuid(input.id), version: version(input.version), reason: text(input.reason, 'เหตุผลยกเลิก', 1000, true),
  };
  throw new Error('คำสั่งไม่ถูกต้อง');
}
