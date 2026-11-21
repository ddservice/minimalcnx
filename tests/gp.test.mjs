// GP delivery + net_revenue — ต้องเท่ากับ dashboard เดิมเป๊ะ (CLAUDE.md "Domain formulas")
import test from 'node:test';
import assert from 'node:assert/strict';
import { GP_RATES, gpNet, computeNetRevenue, computeSalesReconciliation } from '../lib/gp.js';

test('Mae Rim Nov 12–17: LINE MAN is included once and each channel is rounded', () => {
  const rows = [
    [1823,3431,65,189,132,5386,5640,5514.70],
    [748,4879,398,752,65,5692,6842,6443.47],
    [1335,5334,184,494,551,7220,7898,7499.56],
    [821,5156,950,249,132,6109,7308,6860.42],
    [1158,4308,621,498,195,5661,6780,6344.92],
    [1255,4067,195,394,824,6146,6735,6277.26],
  ];
  let netSatang = 0;
  for (const [cash, transfer, shopee, grab, lineman, expectedPos, gross, net] of rows) {
    const reconciliation = computeSalesReconciliation({
      cash_amount: cash, kshop_amount: transfer, shopee_before_gp: shopee,
      grab_before_gp: grab, lineman_before_gp: lineman,
    });
    assert.deepEqual(reconciliation, { expectedPos, gross, net });
    netSatang += Math.round(reconciliation.net * 100);
  }
  assert.equal(netSatang, 3894033);
});

test('เรต GP ตรงตามสัญญาแต่ละเจ้า', () => {
  assert.equal(GP_RATES.shopee, 0.3424);
  assert.equal(GP_RATES.grab, 0.321);
  assert.equal(GP_RATES.lineman, 0.321);
});

test('ยอดหลังหัก GP ปัดทศนิยม 2 ตำแหน่ง', () => {
  assert.equal(gpNet('shopee', 1000), 657.6);   // 1000 x (1 - 0.3424)
  assert.equal(gpNet('grab', 1000), 679);       // 1000 x (1 - 0.321)
  assert.equal(gpNet('lineman', 1000), 679);
  assert.equal(gpNet('shopee', 333), 218.98);   // 218.9808 -> 218.98
});

test('platform ที่ไม่รู้จัก = ไม่หัก GP (ไม่ใช่ NaN)', () => {
  assert.equal(gpNet('robinhood', 500), 500);
  assert.equal(gpNet('shopee', ''), 0);
  assert.equal(gpNet('shopee', null), 0);
});

test('net_revenue = kshop + เงินสด + delivery หลังหัก GP', () => {
  const net = computeNetRevenue({
    kshop_amount: 100,
    cash_amount: 50,
    shopee_before_gp: 1000,
    grab_before_gp: 0,
    lineman_before_gp: 0,
  });
  assert.equal(net, 807.6); // 100 + 50 + 657.60
});

test('net_revenue ไม่รวมรายได้ขนม/ต้นทุนแก้วฟรี (เก็บคนละคอลัมน์)', () => {
  const net = computeNetRevenue({
    kshop_amount: 1000,
    cash_amount: 0,
    pastry_revenue: 5000,
    free_cups: 10,
    coffee_price: 55,
  });
  assert.equal(net, 1000);
});
