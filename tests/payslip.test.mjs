// สูตรเงินเดือน — ตัวเลขทุกตัวอ้างอิงกติกาใน CLAUDE.md ("Domain formulas")
// SSO 5% ของ min(salary, 15000) ทั้งฝั่งลูกจ้างและบริษัท / คอมมิชชั่นหักภาษี 3%
// ค่าที่บันทึกเป็น OPEX = companyCost = gross + ประกันสังคมฝั่งบริษัท
import test from 'node:test';
import assert from 'node:assert/strict';
import { computePayslip } from '../lib/payslip.js';

test('พนักงานเงินเดือน 13,000 + ค่าตำแหน่ง 1,500 ไม่มีคอมมิชชั่น', () => {
  const p = computePayslip({ salary: 13000, position: 1500, diligence: 0, commRate: 0 }, 0);
  assert.equal(p.ssoEmp, 650);        // 5% ของ 13,000
  assert.equal(p.ssoCo, 650);
  assert.equal(p.gross, 14500);       // 13,000 + 1,500
  assert.equal(p.commAmt, 0);
  assert.equal(p.commTax, 0);
  assert.equal(p.netTransfer, 13850); // 13,000 - 650 + 1,500
  assert.equal(p.companyCost, 15150); // gross + ประกันสังคมบริษัท
});

test('เพดานประกันสังคมอยู่ที่ฐาน 15,000 — เงินเดือนสูงกว่านั้นไม่ทำให้หักเพิ่ม', () => {
  const p = computePayslip({ salary: 36000, position: 0, diligence: 0, commRate: 0 }, 0);
  assert.equal(p.ssoEmp, 750);  // 5% ของ 15,000 ไม่ใช่ของ 36,000
  assert.equal(p.ssoCo, 750);
  assert.equal(p.companyCost, 36750);
});

test('คอมมิชชั่นคิดจากยอดขาย แล้วหักภาษี ณ ที่จ่าย 3%', () => {
  const p = computePayslip({ salary: 12000, position: 0, diligence: 500, commRate: 0.02 }, 250000);
  assert.equal(p.commAmt, 5000);   // 250,000 x 2%
  assert.equal(p.commTax, 150);    // 3% ของคอมมิชชั่น
  assert.equal(p.ssoEmp, 600);
  assert.equal(p.gross, 17500);    // 12,000 + 0 + 5,000 + 500
  assert.equal(p.netTransfer, 16750); // 12,000 - 600 + 500 + (5,000 - 150)
  assert.equal(p.companyCost, 18100); // 17,500 + 600
});

test('ค่าว่าง/สตริง ไม่ทำให้ผลลัพธ์กลายเป็น NaN', () => {
  const p = computePayslip({ salary: '', position: null, diligence: undefined, commRate: '' }, '');
  assert.equal(p.gross, 0);
  assert.equal(p.companyCost, 0);
  assert.equal(p.netTransfer, 0);
});

test('เบี้ยขยันไม่ถูกนำไปคิดประกันสังคม แต่รวมใน gross และยอดโอน', () => {
  const withoutBonus = computePayslip({ salary: 13000, position: 0, diligence: 0, commRate: 0 }, 0);
  const withBonus = computePayslip({ salary: 13000, position: 0, diligence: 1000, commRate: 0 }, 0);
  assert.equal(withBonus.ssoEmp, withoutBonus.ssoEmp);
  assert.equal(withBonus.gross - withoutBonus.gross, 1000);
  assert.equal(withBonus.netTransfer - withoutBonus.netTransfer, 1000);
});
