// GP delivery + net_revenue — ต้องเท่ากับ dashboard เดิมเป๊ะ (CLAUDE.md "Domain formulas")
import test from 'node:test';
import assert from 'node:assert/strict';
import { GP_RATES, gpNet, computeNetRevenue } from '../lib/gp.js';

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
