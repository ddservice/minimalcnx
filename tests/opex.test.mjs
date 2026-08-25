// ค่าดำเนินการ (OPEX) — ค่าตั้งต้นรายเดือนกับการทับด้วยยอดที่บันทึกจริง
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeEffectiveOpex,
  monthInputToLabel,
  OPEX_OPERATING,
  OPEX_STAFF,
} from '../lib/opex.js';
import { computePayslip } from '../lib/payslip.js';

const OPERATING = 'ค่าใช้จ่ายดำเนินการ';
const STAFF = 'ค่าแรงพนักงาน';

// ค่าตั้งต้นที่คาดหวัง: เช่า 5,000 + ขยะ 200 + เน็ต 319.93 + บัญชี 2,000
// + เงินเดือนกรรมการ 36,000 + พนักงาน 2 คน
const EMP1 = computePayslip({ salary: 13000, position: 1500, diligence: 0, commRate: 0 }, 0).companyCost;
const EMP2 = computePayslip({ salary: 12000, position: 0, diligence: 0, commRate: 0 }, 0).companyCost;
const BASELINE = 5000 + 200 + 319.93 + 2000 + 36000 + EMP1 + EMP2;

const near = (actual, expected) =>
  assert.ok(Math.abs(actual - expected) < 0.005, `${actual} ควรใกล้เคียง ${expected}`);

test('เดือนที่ยังไม่บันทึกอะไรเลย ใช้ค่าตั้งต้นทั้งหมด', () => {
  near(computeEffectiveOpex([]), BASELINE);
  near(computeEffectiveOpex(null), BASELINE);
});

test('ต้นทุนพนักงานตั้งต้นต้องเท่ากับ companyCost ของสลิปจริง (กันสูตรสองที่เพี้ยนกัน)', () => {
  assert.equal(EMP1, 15150); // 13,000 + 1,500 + ประกันสังคมบริษัท 650
  assert.equal(EMP2, 12600); // 12,000 + ประกันสังคมบริษัท 600
});

test('รายการที่บันทึกจริงทับค่าตั้งต้นเป็นรายการๆ ไป', () => {
  const rows = [{ item_key: 'rent', category: OPERATING, total_amount: 8000 }];
  near(computeEffectiveOpex(rows), BASELINE - 5000 + 8000);
});

test('บันทึกเป็น 0 ก็ยังนับเป็น 0 จริง ไม่ใช่ตกกลับไปใช้ค่าตั้งต้น', () => {
  const rows = [{ item_key: 'salary_dir', category: STAFF, total_amount: 0 }];
  near(computeEffectiveOpex(rows), BASELINE - 36000);
});

test('รายการนอกชุดตั้งต้น (เช่น ค่าน้ำ ค่าไฟ VAT) บวกเพิ่มเข้าไป', () => {
  const rows = [
    { item_key: 'water', category: OPERATING, total_amount: 450 },
    { item_key: 'electric', category: OPERATING, total_amount: 3200 },
  ];
  near(computeEffectiveOpex(rows), BASELINE + 450 + 3200);
});

test('แถวที่ไม่มี item_key หรืออยู่คนละหมวด ไม่ถูกนับเป็น OPEX', () => {
  const rows = [
    { item_key: null, category: OPERATING, total_amount: 9999 },
    { item_key: 'milk', category: 'ต้นทุนวัตถุดิบ', total_amount: 9999 },
  ];
  near(computeEffectiveOpex(rows), BASELINE);
});

test('ค่าตั้งต้นที่แอดมินตั้งเองทับค่า hardcode ได้', () => {
  near(computeEffectiveOpex([], { rent: 7000 }), BASELINE - 5000 + 7000);
  near(computeEffectiveOpex([], { rent: '' }), BASELINE);       // ว่าง = ใช้ค่าเดิม
  near(computeEffectiveOpex([], { rent: 'abc' }), BASELINE);    // ไม่ใช่ตัวเลข = ใช้ค่าเดิม
});

test('แปลงเดือนจาก input type=month เป็น month_label ของ DB', () => {
  assert.equal(monthInputToLabel('2026-07'), '07/2026');
  assert.equal(monthInputToLabel('2026-12'), '12/2026');
});

test('รายการตั้งต้นที่เอกสารระบุไว้ยังอยู่ครบ', () => {
  const keys = OPEX_OPERATING.items.map((i) => i.key);
  assert.deepEqual(keys, ['rent', 'water', 'electric', 'trash', 'internet', 'account', 'repair']);
  assert.equal(OPEX_OPERATING.items.find((i) => i.key === 'internet').def, 319.93);
  assert.equal(OPEX_STAFF.fixed.find((i) => i.key === 'salary_dir').def, 36000);
});
