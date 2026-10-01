// หน้าภาพรวม — เทียบเดือนก่อน + วันที่ยังไม่ได้กรอกยอดขาย
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  prevMonthInput,
  daysInMonth,
  cutoffDay,
  missingSalesDays,
  summarizeMonth,
  pctChange,
} from '../lib/dashboard.js';
import { computeEffectiveOpex } from '../lib/opex.js';

test('prevMonthInput ข้ามปีได้', () => {
  assert.equal(prevMonthInput('2026-10'), '2026-09');
  assert.equal(prevMonthInput('2026-01'), '2025-12');
});

test('daysInMonth รวมปีอธิกสุรทิน', () => {
  assert.equal(daysInMonth('2026-09'), 30);
  assert.equal(daysInMonth('2026-02'), 28);
  assert.equal(daysInMonth('2028-02'), 29);
});

test('cutoffDay: เดือนที่ผ่านแล้วนับทั้งเดือน เดือนอนาคตไม่นับ', () => {
  assert.equal(cutoffDay('2026-09', '2026-10-05', []), 30);
  assert.equal(cutoffDay('2026-11', '2026-10-05', []), 0);
});

test('cutoffDay: เดือนปัจจุบันนับถึงเมื่อวาน จนกว่าจะกรอกยอดวันนี้', () => {
  assert.equal(cutoffDay('2026-10', '2026-10-05', ['2026-10-04']), 4);
  assert.equal(cutoffDay('2026-10', '2026-10-05', ['2026-10-05']), 5);
  assert.equal(cutoffDay('2026-10', '2026-10-01', []), 0);
});

test('missingSalesDays คืนเฉพาะวันที่ไม่มีแถวยอดขาย', () => {
  assert.deepEqual(
    missingSalesDays('2026-10', ['2026-10-01', '2026-10-03'], 4),
    ['2026-10-02', '2026-10-04'],
  );
  assert.deepEqual(missingSalesDays('2026-10', [], 0), []);
});

test('pctChange: ฐานเป็น 0 ไม่มีค่าให้เทียบ, ฐานติดลบใช้ค่าสัมบูรณ์', () => {
  assert.equal(pctChange(110, 100), 10);
  assert.equal(pctChange(50, 100), -50);
  assert.equal(pctChange(100, 0), null);
  assert.equal(pctChange(100, -100), 200);
});

const SUMMARY = {
  sales: [
    { date: '2026-09-01', net_revenue: 1000, total_cups: 10, pastry_pieces: 2, free_cups: 1 },
    { date: '2026-09-02', net_revenue: 2000, total_cups: 20, pastry_pieces: 3, free_cups: 0 },
    { date: '2026-09-20', net_revenue: 4000, total_cups: 40, pastry_pieces: 5, free_cups: 2 },
  ],
  expenses: [
    { date: '2026-09-01', total_amount: 300, item_key: null, category: 'ต้นทุนวัตถุดิบ' },
    { date: '2026-09-25', total_amount: 700, item_key: null, category: 'ต้นทุนวัตถุดิบ' },
  ],
};
const OPEX = computeEffectiveOpex(SUMMARY.expenses, {});

test('summarizeMonth ทั้งเดือน', () => {
  const s = summarizeMonth(SUMMARY, {});
  assert.equal(s.income, 7000);
  assert.equal(s.totalExp, 1000 + OPEX);
  assert.equal(s.profit, 7000 - 1000 - OPEX);
  assert.equal(s.totalCups, 70);
  assert.equal(s.pastryPieces, 10);
  assert.equal(s.freeCups, 3);
});

test('summarizeMonth ตัดถึงวันที่กำหนด — ยอดขาย/รายจ่ายรายวันถูกตัด แต่ OPEX นับเต็มเดือน', () => {
  const s = summarizeMonth(SUMMARY, {}, 2);
  assert.equal(s.income, 3000);
  assert.equal(s.totalExp, 300 + OPEX);
  assert.equal(s.totalCups, 30);
  assert.equal(s.freeCups, 1);
});
