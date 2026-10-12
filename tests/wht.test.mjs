// ภาษีหัก ณ ที่จ่ายบนหนังสือรับรอง 50 ทวิ — ตัวเลขผิดคือเอกสารภาษีผิด
import test from 'node:test';
import assert from 'node:assert/strict';
import { computeWht, bahtText, fmtTaxId } from '../lib/wht.js';

test('หัก ณ ที่จ่าย: ค่าเช่า 5,000 หัก 5% = 250 เงินได้ยังเป็น 5,000', () => {
  assert.deepEqual(computeWht(5000, 0.05, '1'), { paid: 5000, tax: 250 });
});

test('หัก ณ ที่จ่าย คิดถึงสตางค์ ไม่ปัดเป็นบาทเต็ม', () => {
  assert.deepEqual(computeWht(319.93, 0.03, '1'), { paid: 319.93, tax: 9.6 });
});

test('ออกให้ตลอดไป: ภาษี = ยอด × อัตรา ÷ (1 − อัตรา)', () => {
  assert.deepEqual(computeWht(5000, 0.05, '2'), { paid: 5263.16, tax: 263.16 });
});

test('ออกให้ครั้งเดียว: เงินได้ = ยอด × (1 + อัตรา) แล้วคิดภาษีจากเงินได้', () => {
  assert.deepEqual(computeWht(5000, 0.05, '3'), { paid: 5250, tax: 262.5 });
  assert.deepEqual(computeWht(10000, 0.03, '3'), { paid: 10300, tax: 309 });
});

test('ค่าว่าง/ติดลบ ไม่ทำให้เป็น NaN', () => {
  assert.deepEqual(computeWht('', 0.05), { paid: 0, tax: 0 });
  assert.deepEqual(computeWht(-100, 0.05, '2'), { paid: 0, tax: 0 });
});

test('จำนวนเงินเป็นตัวอักษร', () => {
  assert.equal(bahtText(250), 'สองร้อยห้าสิบบาทถ้วน');
  assert.equal(bahtText(262.5), 'สองร้อยหกสิบสองบาทห้าสิบสตางค์');
  assert.equal(bahtText(263.16), 'สองร้อยหกสิบสามบาทสิบหกสตางค์');
  assert.equal(bahtText(21), 'ยี่สิบเอ็ดบาทถ้วน');
  assert.equal(bahtText(101), 'หนึ่งร้อยเอ็ดบาทถ้วน');
  assert.equal(bahtText(9.05), 'เก้าบาทห้าสตางค์');
  assert.equal(bahtText(0), 'ศูนย์บาทถ้วน');
});

test('จัดรูปเลขผู้เสียภาษี 13 หลัก — ไม่ครบ 13 หลักคืนตามเดิม', () => {
  assert.equal(fmtTaxId('1234567890123'), '1-2345-67890-12-3');
  assert.equal(fmtTaxId('12345'), '12345');
});
