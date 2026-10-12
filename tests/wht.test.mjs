// ภาษีหัก ณ ที่จ่ายบนหนังสือรับรอง 50 ทวิ — ตัวเลขผิดคือเอกสารภาษีผิด
import test from 'node:test';
import assert from 'node:assert/strict';
import { computeWht, bahtText, fmtTaxId, summarizeEmployeeYear } from '../lib/wht.js';
import { form50Html } from '../lib/form50-template.js';

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

test('สรุปรายได้พนักงานทั้งปี: รวมเฉพาะปีที่ขอ ไม่นับเงินคืนประกัน', () => {
  const hist = [
    { month: '09/2026', gross: 5600, commTax: 0, ssoEmp: 280, refund: 3000, netTransfer: 8320 },
    { month: '08/2026', gross: 12000, commTax: 0, ssoEmp: 600 },
    { month: '12/2025', gross: 12000, commTax: 0, ssoEmp: 600 },
  ];
  assert.deepEqual(summarizeEmployeeYear(hist, '2026'), { months: ['08/2026', '09/2026'], income: 17600, tax: 0, sso: 880 });
});

test('สรุปรายได้พนักงานทั้งปี: ภาษีที่หักมาจากคอมมิชชั่น และประวัติว่างไม่พัง', () => {
  const hist = [{ month: '09/2026', gross: 17584, commTax: 63, ssoEmp: 650 }, { month: '07/2026', gross: 16000, commTax: 45, ssoEmp: 650 }];
  assert.deepEqual(summarizeEmployeeYear(hist, 2026), { months: ['07/2026', '09/2026'], income: 33584, tax: 108, sso: 1300 });
  assert.deepEqual(summarizeEmployeeYear(null, '2026'), { months: [], income: 0, tax: 0, sso: 0 });
});

test('แม่แบบ 50 ทวิ: ออก 3 ฉบับต่อใบ ลงยอดถูกข้อ ติ๊กแบบและเงื่อนไขถูกช่อง', () => {
  const base = {
    bookNo: '2569', docNo: '01/01', payer: { name: 'ร้าน', taxId: '1234567890123', address: 'ที่อยู่ร้าน' },
    payee: { name: 'ผู้รับ <b>', taxId: '3569900056213', address: 'ที่อยู่' }, seq: '1', issueDateText: '12 ตุลาคม 2569',
  };
  const rent = form50Html({ title: 't', docs: [{ ...base, pnd: '4', row: 5, detail: 'ค่าเช่า', dateText: '11 มกราคม 2569', paid: 5250, tax: 262.5, cond: '3' }] });
  assert.equal(rent.split('class="page"').length - 1, 3);
  assert.ok(rent.includes('☑ (4) ภ.ง.ด.3') && rent.includes('☐ (7) ภ.ง.ด.53'));
  assert.ok(rent.includes('☑ (3) ออกให้ครั้งเดียว') && rent.includes('☐ (1) หัก ณ ที่จ่าย'));
  assert.ok(rent.includes('(ระบุ) ค่าเช่า') && rent.includes('5,250.00') && rent.includes('262.50'));
  assert.ok(rent.includes('สองร้อยหกสิบสองบาทห้าสิบสตางค์'));
  assert.ok(rent.includes('3-5699-00056-21-3'));
  assert.ok(rent.includes('ผู้รับ &lt;b&gt;') && !rent.includes('ผู้รับ <b>'));   // escape ชื่อ

  const emp = form50Html({ title: 't', docs: [{ ...base, pnd: '1', row: 1, dateText: '2569', paid: 17600, tax: 0, sso: 880, cond: '1' }] });
  assert.ok(emp.includes('☑ (1) ภ.ง.ด.1ก'));
  assert.ok(/40 \(1\)<\/td><td class="mid">2569<\/td><td class="num">17,600.00/.test(emp));   // ยอดอยู่ข้อ 1
  assert.ok(emp.includes('กองทุนประกันสังคม <b>880.00</b>'));
  assert.ok(emp.includes('ศูนย์บาทถ้วน'));
});
