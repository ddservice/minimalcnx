// สะสมแต้ม — เกณฑ์ RFM ต้องตรงกับ fn_rfm_segment() ใน sql/harden_loyalty_integrity.sql
import test from 'node:test';
import assert from 'node:assert/strict';
import { computeRfmSegment, customerSegment } from '../lib/rfm.js';
import { suggestPointsFromSpend } from '../lib/loyalty-rewards.js';

const NOW = new Date('2026-08-25T12:00:00Z');
const daysAgo = (n) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000).toISOString();

test('ยังไม่เคยมีธุรกรรม = New', () => {
  assert.equal(computeRfmSegment(0, null, NOW), 'New');
  assert.equal(computeRfmSegment(0, daysAgo(1), NOW), 'New');
  assert.equal(computeRfmSegment(5, null, NOW), 'New');
  assert.equal(computeRfmSegment(3, 'ไม่ใช่วันที่', NOW), 'New');
});

test('Champions = มา 10 ครั้งขึ้นไป และมาภายใน 14 วัน', () => {
  assert.equal(computeRfmSegment(10, daysAgo(1), NOW), 'Champions');
  assert.equal(computeRfmSegment(20, daysAgo(14), NOW), 'Champions');
  assert.equal(computeRfmSegment(10, daysAgo(15), NOW), 'Loyal'); // เกิน 14 วันแต่ยังในกรอบ Loyal
  assert.equal(computeRfmSegment(9, daysAgo(1), NOW), 'Loyal');   // ครั้งไม่ถึง
});

test('Loyal = มา 5 ครั้งขึ้นไป และมาภายใน 30 วัน', () => {
  assert.equal(computeRfmSegment(5, daysAgo(30), NOW), 'Loyal');
  assert.equal(computeRfmSegment(5, daysAgo(31), NOW), 'At-Risk');
});

test('At-Risk = หายไปเกิน 30 วัน / Lost = เกิน 60 วัน', () => {
  assert.equal(computeRfmSegment(2, daysAgo(31), NOW), 'At-Risk');
  assert.equal(computeRfmSegment(2, daysAgo(60), NOW), 'At-Risk'); // ครบ 60 วันพอดี ยังไม่ Lost
  assert.equal(computeRfmSegment(2, daysAgo(61), NOW), 'Lost');
  assert.equal(computeRfmSegment(50, daysAgo(365), NOW), 'Lost'); // มาบ่อยแค่ไหนก็หลุดได้
});

test('Potential = มาไม่บ่อยแต่ยังไม่หาย', () => {
  assert.equal(computeRfmSegment(1, daysAgo(0), NOW), 'Potential');
  assert.equal(computeRfmSegment(4, daysAgo(29), NOW), 'Potential');
});

test('ป้ายลูกค้าคำนวณสด ไม่สนคอลัมน์ rfm_segment ที่ค้างอยู่ใน DB', () => {
  const stale = { visit_count: 3, last_visited_at: daysAgo(200), rfm_segment: 'Champions' };
  assert.equal(customerSegment(stale, NOW), 'Lost');
  assert.equal(customerSegment(null, NOW), 'New');
});

test('แต้มแนะนำ: ทุก 50 บาท = 1 แต้ม ปัดลงเสมอ', () => {
  assert.equal(suggestPointsFromSpend(0), 0);
  assert.equal(suggestPointsFromSpend(49), 0);
  assert.equal(suggestPointsFromSpend(50), 1);
  assert.equal(suggestPointsFromSpend(149), 2);
  assert.equal(suggestPointsFromSpend(150), 3);
  assert.equal(suggestPointsFromSpend(-100), 0);
  assert.equal(suggestPointsFromSpend('abc'), 0);
});
