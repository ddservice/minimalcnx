// ภาษีหัก ณ ที่จ่าย สำหรับหนังสือรับรอง 50 ทวิ — ใช้ร่วมกับ app/opex/form50.js และมีเทสต์ใน tests/wht.test.mjs

const r2 = (x) => Math.round(x * 100) / 100;

// เงื่อนไขผู้จ่ายเงิน — เลขตรงกับช่องบนแบบ 50 ทวิ ของกรมสรรพากร
export const WHT_CONDITIONS = [
  { value: '1', label: 'หัก ณ ที่จ่าย' },
  { value: '2', label: 'ออกให้ตลอดไป' },
  { value: '3', label: 'ออกให้ครั้งเดียว' },
];

/**
 * amount = ยอดที่บันทึกใน OPEX
 *  (1) หัก ณ ที่จ่าย    : amount คือเงินได้เต็ม → ภาษี = amount × rate
 *  (2) ออกให้ตลอดไป     : amount คือยอดที่ผู้รับได้จริง → ภาษี = amount × rate ÷ (1 − rate), เงินได้ = amount + ภาษี
 *  (3) ออกให้ครั้งเดียว : amount คือยอดที่ผู้รับได้จริง → เงินได้ = amount × (1 + rate), ภาษี = เงินได้ × rate
 * คิดถึงสตางค์ ไม่ปัดเป็นบาทเต็ม
 */
export function computeWht(amount, rate, cond = '1') {
  const a = Math.max(0, Number(amount) || 0);
  if (cond === '2') {
    const tax = r2((a * rate) / (1 - rate));
    return { paid: r2(a + tax), tax };
  }
  if (cond === '3') {
    const paid = r2(a * (1 + rate));
    return { paid, tax: r2(paid * rate) };
  }
  return { paid: r2(a), tax: r2(a * rate) };
}

// จำนวนเงินเป็นตัวอักษร (รองรับ ≤ 999,999.99 — เพียงพอสำหรับ WHT)
export function bahtText(num) {
  const t = ['ศูนย์', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า'];
  const p = ['', 'สิบ', 'ร้อย', 'พัน', 'หมื่น', 'แสน'];
  const conv = (s) => {
    let out = '';
    const len = s.length;
    for (let i = 0; i < len; i++) {
      const d = +s[i];
      const place = len - i - 1;
      if (d === 0) continue;
      if (place === 1 && d === 1) out += 'สิบ';
      else if (place === 1 && d === 2) out += 'ยี่สิบ';
      else if (place === 0 && d === 1 && len > 1) out += 'เอ็ด';
      else out += t[d] + p[place];
    }
    return out;
  };
  const n = Math.round((Number(num) || 0) * 100) / 100;
  const [ip, dp] = n.toFixed(2).split('.');
  let s = (+ip === 0 ? 'ศูนย์' : conv(String(+ip))) + 'บาท';
  s += dp === '00' ? 'ถ้วน' : conv(String(+dp)) + 'สตางค์';
  return s;
}

// 1234567890123 → 1-2345-67890-12-3 (รูปแบบเลขประจำตัวผู้เสียภาษี 13 หลัก)
export function fmtTaxId(id) {
  const d = String(id || '').replace(/\D/g, '');
  if (d.length !== 13) return d;
  return `${d[0]}-${d.slice(1, 5)}-${d.slice(5, 10)}-${d.slice(10, 12)}-${d[12]}`;
}

/**
 * สรุปรายได้ทั้งปีของพนักงานหนึ่งคนจากประวัติจ่ายเงิน (business_config.emp_pay_history) — ใช้ออก 50 ทวิ ประจำปี
 *  income = ผลรวม gross (เงินเดือน + ค่าตำแหน่ง + คอมมิชชั่น + เบี้ยขยัน) — ไม่รวมเงินคืนประกัน (ไม่ใช่เงินได้)
 *  tax    = ผลรวมภาษีที่หักไว้ (ระบบหักเฉพาะจากคอมมิชชั่น)
 *  sso    = ผลรวมประกันสังคมส่วนของพนักงาน
 * year = ปี ค.ศ. เป็นสตริง เช่น '2026'
 */
export function summarizeEmployeeYear(hist, year) {
  const rows = (Array.isArray(hist) ? hist : []).filter((r) => String(r?.month || '').split('/')[1] === String(year));
  const sum = (k) => Math.round(rows.reduce((a, r) => a + (Number(r[k]) || 0), 0) * 100) / 100;
  return {
    months: rows.map((r) => r.month).sort(),
    income: sum('gross'),
    tax: sum('commTax'),
    sso: sum('ssoEmp'),
  };
}
