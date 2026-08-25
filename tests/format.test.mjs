// ตัวกรองค่าที่ผู้ใช้พิมพ์ — ด่านแรกที่กันยอดเงินเพี้ยน
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sanitizeNumberString,
  groupNumberString,
  digitsOnly,
  stripDigits,
  fmtMoney,
} from '../lib/format.js';

test('ตัดเลขศูนย์นำหน้า แต่ไม่ทำลาย 0 เดี่ยวและทศนิยม', () => {
  assert.equal(sanitizeNumberString('0123'), '123');
  assert.equal(sanitizeNumberString('0'), '0');
  assert.equal(sanitizeNumberString('0.5'), '0.5');
  assert.equal(sanitizeNumberString('00.5'), '0.5');
});

test('บล็อก e / + / - ที่ input type=number ยอมให้พิมพ์ (1e5 เคยกลายเป็นเลขมหาศาล)', () => {
  assert.equal(sanitizeNumberString('1e5'), '15');
  assert.equal(sanitizeNumberString('-500'), '500');
  assert.equal(sanitizeNumberString('+500'), '500');
  assert.equal(sanitizeNumberString('12abc34'), '1234');
  assert.equal(sanitizeNumberString('1,200'), '1200');
});

test('เหลือจุดทศนิยมได้จุดเดียว', () => {
  assert.equal(sanitizeNumberString('1.2.3'), '1.23');
  assert.equal(sanitizeNumberString('..5'), '.5');
});

test('ค่าว่าง/null ไม่พัง', () => {
  assert.equal(sanitizeNumberString(''), '');
  assert.equal(sanitizeNumberString(null), '');
  assert.equal(sanitizeNumberString(undefined), '');
});

test('จุลภาคหลักพันสำหรับแสดงผล — ไม่ปัดเศษ คงทศนิยมตามที่พิมพ์', () => {
  assert.equal(groupNumberString('12000'), '12,000');
  assert.equal(groupNumberString('12000.5'), '12,000.5');
  assert.equal(groupNumberString('1234567.89'), '1,234,567.89');
  assert.equal(groupNumberString('999'), '999');
  assert.equal(groupNumberString('12000.'), '12,000'); // จุดค้างท้ายไม่ต้องโชว์
  assert.equal(groupNumberString(''), '');
  assert.equal(groupNumberString(null), '');
});

test('digitsOnly เก็บเลข 0 นำหน้าไว้ (เบอร์โทร/เลขบัตร/เลขบัญชี)', () => {
  assert.equal(digitsOnly('081-234-5678'), '0812345678');
  assert.equal(digitsOnly('0-1234-56789-01-2'), '0123456789012');
  assert.equal(digitsOnly('abc012'), '012');
});

test('stripDigits สำหรับช่องชื่อคน', () => {
  assert.equal(stripDigits('สมชาย1'), 'สมชาย');
  assert.equal(stripDigits('John 2nd'), 'John nd');
});

test('fmtMoney แสดงผลแบบไทย ทศนิยมไม่เกิน 2 ตำแหน่ง', () => {
  assert.equal(fmtMoney(1234567.891), '1,234,567.89');
  assert.equal(fmtMoney(0), '0');
  assert.equal(fmtMoney(null), '0');
});
