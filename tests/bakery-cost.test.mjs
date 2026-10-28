import test from 'node:test';
import assert from 'node:assert/strict';
import { computeInvoice, parseBakeryPOS, bakeryReview, validDate, monthBounds } from '../lib/bakery-cost.js';

const invoice = { supplier: 'Queen', status: 'posted', discount_pct: 25, lines: [{ name: 'ครัวซอง', unit: 'ชิ้น', quantity: 2, unit_price: 35 }] };
test('purchase discount is applied once, and may change per invoice', () => {
  assert.equal(computeInvoice(invoice).net, 52.5);
  assert.equal(computeInvoice({ ...invoice, discount_pct: 27 }).net, 51.1);
  assert.equal(computeInvoice({ ...invoice, discount_pct: 0 }).net, 70);
});
test('satang allocation reconciles to the invoice, not individually rounded line sum', () => {
  const result = computeInvoice({ discount_pct: 25, lines: Array.from({ length: 3 }, () => ({ name: 'ขนม', unit: 'ชิ้น', quantity: 1, unit_price: 0.05 })) });
  assert.equal(result.net, 0.11);
  assert.equal(Math.round(result.lines.reduce((s, l) => s + l.net, 0) * 100), 11);
});
test('invalid and missing numeric fields do not silently become valid costs', () => {
  for (const value of ['', null, -1, Infinity, NaN, 101, 25.555]) assert.throws(() => computeInvoice({ ...invoice, discount_pct: value }));
  assert.throws(() => computeInvoice({ ...invoice, lines: [{ name: 'ขนม', unit: 'ชุด', quantity: 1, unit_price: '' }] }));
  assert.throws(() => computeInvoice({ ...invoice, lines: [{ name: 'ขนม', unit: 'ชุด', quantity: 0, unit_price: 40 }] }));
  assert.equal(validDate('2026-02-30'), false);
  assert.deepEqual(monthBounds('2026-12'), { start: '2026-12-01', end: '2027-01-01' });
});
const header = ['วันที่ชำระเงิน', 'ชื่อเมนู', 'หมายเลขใบเสร็จ / ID', 'หมวดสินค้า', 'จำนวน', 'ราคาสุทธิ', 'ช่องทาง', 'สาขา'];
test('POS preserves bakery variants, zero-price lines and repeated line items, excludes Total', () => {
  const parsed = parseBakeryPOS([['รายงาน'], header,
    ['01/01/2026', 'ปังสด ประเภท : ครัวซอง x 1 ', 'A', 'BAKERY', 2, 100, 'หน้าร้าน', 'แม่ริม'],
    ['01/01/2026', 'ครัวซอง', 'A', 'BAKERY', 1, 0, 'หน้าร้าน', 'แม่ริม'],
    ['Total', '', '', '', 999, 999]], '2026-01');
  assert.equal(parsed.rows.length, 2);
  assert.equal(parsed.rows[0].name, 'ครัวซอง');
  assert.equal(parsed.rows[1].revenue, 0);
  assert.equal(parsed.issues.length, 0);
});
test('wrong dates including 1970 and mixed branches block the import instead of being guessed', () => {
  const p = parseBakeryPOS([header, ['01/01/1970', 'ขนม', 'A', 'BAKERY', 1, 50, 'หน้าร้าน', 'แม่ริม'],
    ['01/03/2026', 'ขนม', 'B', 'BAKERY', 1, 50, 'หน้าร้าน', 'แม่ริม'],
    ['01/03/2026', 'ขนม', 'C', 'BAKERY', 1, 50, 'หน้าร้าน', 'Think Park']], '2026-03');
  assert.equal(p.issues.length, 2);
  assert.throws(() => parseBakeryPOS([['วันที่', 'ชื่อสินค้า']], '2026-01'));
});
const rows = [{ date: '2026-01-01', name: 'ครัวซอง', key: 'ครัวซอง', quantity: 1, revenue: 50 }];
const mappings = [{ pos_key: 'ครัวซอง', supplier: 'Queen', purchase_name: 'ครัวซอง', factor: 1 }];
test('unconfirmed units are missing cost, never zero-cost profit', () => {
  const report = bakeryReview([invoice], rows, []);
  assert.equal(report.complete, false);
  assert.equal(report.items[0].cost, null);
  assert.equal(report.coveredRevenue, 0);
  assert.equal(report.coveredMargin, 0);
});
test('cost uses weighted purchase prices after discount; drafts and void invoices excluded', () => {
  const expensive = { ...invoice, lines: [{ ...invoice.lines[0], quantity: 2, unit_price: 45 }] };
  const report = bakeryReview([invoice, expensive, { ...invoice, status: 'draft' }, { ...invoice, status: 'void' }], rows, mappings);
  assert.equal(report.purchaseTotal, 120);
  assert.equal(report.items[0].cost, 30);
  assert.equal(report.coveredMargin, 20);
  assert.equal(report.complete, true);
});
test('split-pack conversions require explicit factor, zero-price sales stay unresolved', () => {
  const split = bakeryReview([invoice], rows, [{ ...mappings[0], factor: 0.25 }]);
  assert.equal(split.items[0].cost, 6.56);
  const free = bakeryReview([invoice], [{ ...rows[0], revenue: 0 }], mappings);
  assert.equal(free.items[0].cost, null);
  assert.equal(free.complete, false);
});
test('daily review distinguishes absent sales row from an actual zero', () => {
  const report = bakeryReview([], rows, [], [{ date: '2026-01-02', pastry_pieces: 0, pastry_revenue: 0 }]);
  assert.equal(report.daily[0].saved_revenue, null);
  assert.equal(report.daily[1].saved_revenue, 0);
});
