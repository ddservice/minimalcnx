// GP rates ของ delivery platforms — หักจาก "ยอดก่อน GP"
// ค่า default ตรงกับ dashboard เดิม (hardcode) — ภายหลังอ่านจาก business_config ทับได้
export const GP_RATES = { shopee: 0.3424, grab: 0.321, lineman: 0.321 };

// ยอดสุทธิของ platform หนึ่ง หลังหัก GP
export function gpNet(platform, raw) {
  const rate = GP_RATES[platform] ?? 0;
  return Math.round((Number(raw) || 0) * (1 - rate) * 100) / 100;
}

// net_revenue ที่เก็บ = รายได้กาแฟ = kshop + cash + delivery(หลังหัก GP)
// หมายเหตุ: ไม่รวมรายได้ขนม/ต้นทุนแก้วฟรี (เก็บแยกคนละคอลัมน์) — ตรงกับ dashboard เดิม
export function computeNetRevenue(v) {
  const k = Number(v.kshop_amount) || 0;
  const c = Number(v.cash_amount) || 0;
  const s = gpNet('shopee', v.shopee_before_gp);
  const g = gpNet('grab', v.grab_before_gp);
  const l = gpNet('lineman', v.lineman_before_gp);
  return Math.round((k + c + s + g + l) * 100) / 100;
}

export function computeSalesReconciliation(sales) {
  const satang = (value) => Math.round((Number(value) || 0) * 100);
  const expectedPos = satang(sales.cash_amount) + satang(sales.kshop_amount)
    + satang(sales.lineman_before_gp);
  const gross = expectedPos + satang(sales.shopee_before_gp) + satang(sales.grab_before_gp);
  return {
    expectedPos: expectedPos / 100,
    gross: gross / 100,
    net: computeNetRevenue(sales),
  };
}
