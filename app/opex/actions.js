'use server';

import { revalidatePath } from 'next/cache';
import { OPEX_OPERATING, OPEX_STAFF, OPEX_TAX } from '../../lib/opex';
import { computePayslip } from '../../lib/payslip';
import { upsertBusinessConfig } from '../../lib/config-store';
import { requireCap } from '../../lib/access';
import { canAccess } from '../../lib/perms';

// ยอดขายสุทธิของเดือน — คำนวณฝั่งเซิร์ฟเวอร์เอง (ไม่เชื่อค่า income จาก client)
async function monthIncome(supabase, monthLabel) {
  const [mm, yy] = String(monthLabel).split('/');
  if (!mm || !yy) return 0;
  const start = `${yy}-${mm}-01`;
  const end = new Date(Number(yy), Number(mm), 0).toISOString().slice(0, 10);
  const { data } = await supabase.from('sales_daily').select('net_revenue').gte('date', start).lte('date', end);
  return (data || []).reduce((a, r) => a + Number(r.net_revenue || 0), 0);
}

// บันทึกรายละเอียดพนักงาน (ชื่อ/บัตร ปชช./ธนาคาร) ลง business_config — ใช้ร่วมทุกเครื่อง/ทุกอุปกรณ์
// (เดิมเก็บใน localStorage ของเบราว์เซอร์เท่านั้น → ข้อมูลหายถ้าเปลี่ยนเครื่อง/เบราว์เซอร์ล้าง cache)
export async function saveEmpDetails(details) {
  const acc = await requireCap('/opex', 'edit');
  if (!acc.allowed) return { status: 'error', message: acc.message };
  if (acc.role !== 'admin' && acc.role !== 'co-admin') {
    return { status: 'error', message: 'เฉพาะ Admin / Co-Admin ที่แก้ไขข้อมูลพนักงานได้' };
  }
  const { supabase } = acc;
  const res = await upsertBusinessConfig(supabase, 'emp_details', details || {});
  if (!res.ok) return { status: 'error', message: res.message };
  revalidatePath('/opex');
  return { status: 'ok', message: 'บันทึกข้อมูลพนักงานเรียบร้อย' };
}

// บันทึกข้อมูลผู้รับเงิน (ฟอร์ม 50 ทวิ) ลง business_config — ใช้ร่วมทุกเครื่อง
export async function saveForm50Payees(payees) {
  const acc = await requireCap('/opex', 'edit');
  if (!acc.allowed) return { status: 'error', message: acc.message };
  if (acc.role !== 'admin' && acc.role !== 'co-admin') {
    return { status: 'error', message: 'เฉพาะ Admin / Co-Admin ที่แก้ไขผู้รับเงิน 50 ทวิ ได้' };
  }
  const { supabase } = acc;
  const res = await upsertBusinessConfig(supabase, 'form50_payees', payees || {});
  if (!res.ok) return { status: 'error', message: res.message };
  revalidatePath('/opex');
  return { status: 'ok', message: 'บันทึกข้อมูลผู้รับเงินเรียบร้อย' };
}

const OP_LABEL = Object.fromEntries(OPEX_OPERATING.items.map((i) => [i.key, i.label]));
const OP_KEYS = new Set(OPEX_OPERATING.items.map((i) => i.key));
const STAFF_LABEL = Object.fromEntries(OPEX_STAFF.fixed.map((i) => [i.key, i.label]));
const STAFF_KEYS = new Set(OPEX_STAFF.fixed.map((i) => i.key));
const TAX_LABEL = Object.fromEntries(OPEX_TAX.items.map((i) => [i.key, i.label]));
const TAX_KEYS = new Set(OPEX_TAX.items.map((i) => i.key));

// บันทึกค่า OPEX ทั้ง 3 หมวด — upsert ทีละ item (dedup ตาม item_key+month)
export async function saveOpexAction(input) {
  const acc = await requireCap('/opex', 'create');
  if (!acc.allowed) return { status: 'error', message: acc.message };
  const { supabase, user } = acc;

  const month = String(input.month_label || '');
  if (!/^\d{2}\/\d{4}$/.test(month)) {
    return { status: 'error', message: 'เดือนไม่ถูกต้อง' };
  }

  const { count } = await supabase
    .from('expenses')
    .select('id', { count: 'exact', head: true })
    .eq('month_label', month)
    .not('item_key', 'is', null);
  if (count > 0 && !canAccess(acc.role, '/opex', 'edit', acc.perms)) {
    return { status: 'error', message: 'เดือนนี้มีข้อมูลแล้ว — สิทธิ์ของคุณกรอกเดือนใหม่ได้เท่านั้น ไม่สามารถแก้ไขของเดิม' };
  }

  // สร้างรายการ upsert: [{ item_key, item_name, category, amount }]
  const jobs = [];
  const pushFixed = (obj, keys, labelMap, category) => {
    for (const key of Object.keys(obj || {})) {
      if (!keys.has(key)) continue;
      const amt = toAmt(obj[key]);
      if (amt == null) continue;
      jobs.push({ item_key: key, item_name: labelMap[key], category, amount: amt });
    }
  };

  pushFixed(input.operating, OP_KEYS, OP_LABEL, OPEX_OPERATING.category);
  pushFixed(input.staff, STAFF_KEYS, STAFF_LABEL, OPEX_STAFF.category);
  pushFixed(input.tax, TAX_KEYS, TAX_LABEL, OPEX_TAX.category);

  // พนักงาน (dynamic) → key = emp{n}, ต้องมีชื่อ + ยอด
  const employees = Array.isArray(input.employees) ? input.employees : [];
  employees.forEach((e, idx) => {
    const amt = toAmt(e?.amount);
    if (amt == null) return;
    const key = `${OPEX_STAFF.empPrefix}${idx + 1}`;
    const label = String(e?.label || '').trim() || `พนักงานคนที่ ${idx + 1}`;
    jobs.push({ item_key: key, item_name: label, category: OPEX_STAFF.category, amount: amt });
  });

  if (!jobs.length) return { status: 'error', message: 'ไม่มีรายการให้บันทึก' };

  let saved = 0;
  let sum = 0;
  for (const j of jobs) {
    const { error } = await supabase.rpc('upsert_opex_item', {
      p_data: {
        month_label: month,
        category: j.category,
        item_name: j.item_name,
        item_key: j.item_key,
        total_amount: j.amount,
        payment_method: 'อัตโนมัติ',
      },
    });
    if (error) return { status: 'error', message: error.message };
    saved++;
    sum += j.amount;
  }

  // ── บันทึกประวัติการจ่ายเงินพนักงาน (upsert ตามเดือน, เก็บย้อนหลังสูงสุด 60 รายการ/คน) ──
  const paidEmployees = employees
    .map((e, idx) => ({ e, key: `${OPEX_STAFF.empPrefix}${idx + 1}`, amt: toAmt(e?.amount) }))
    .filter((x) => x.amt != null);
  let historyWarning = '';
  if (paidEmployees.length) {
    const income = await monthIncome(supabase, month);
    const { data: histCfg } = await supabase
      .from('business_config')
      .select('value')
      .eq('key', 'emp_pay_history')
      .maybeSingle();
    const hist = histCfg?.value || {};
    const by = user.email || user.id;
    const savedAt = new Date().toISOString();
    paidEmployees.forEach(({ e, key }) => {
      const ps = computePayslip(e, income);
      const entry = {
        month,
        label: String(e?.label || '').trim() || key,
        salary: Number(e.salary) || 0,
        position: Number(e.position) || 0,
        diligence: Number(e.diligence) || 0,
        commRate: Number(e.commRate) || 0,
        ...ps,
        savedBy: by,
        savedAt,
      };
      const arr = Array.isArray(hist[key]) ? hist[key] : [];
      hist[key] = [entry, ...arr.filter((r) => r.month !== month)].slice(0, 60);
    });
    const histRes = await upsertBusinessConfig(supabase, 'emp_pay_history', hist);
    // ไม่ทำให้การบันทึก OPEX (ที่สำเร็จแล้ว) ล้มเหลวไปด้วย — แค่แจ้งเตือนแยก
    if (!histRes.ok) historyWarning = ` (ประวัติจ่ายเงินเดือนบันทึกไม่สำเร็จ: ${histRes.message})`;
  }

  revalidatePath('/opex');
  revalidatePath('/reports');
  revalidatePath('/dashboard');
  revalidatePath('/analytics');
  return {
    status: 'ok',
    message: `บันทึก ${saved} รายการ รวม ${sum.toLocaleString('th-TH')} ฿${historyWarning}`,
  };
}

// '' / null = ข้าม (คืน null); ตัวเลข >= 0 = ใช้
function toAmt(v) {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}
