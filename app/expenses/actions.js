'use server';

import { revalidatePath } from 'next/cache';
import { EXPENSE_CATEGORY_VALUES } from '../../lib/expense-categories';
import { requireCap } from '../../lib/access';
import { canDeleteOnPage } from '../../lib/perms';

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : 0;
};

// total รวม VAT 7% (ตรงกับ dashboard เดิม: pEff = price * 1.07)
const lineTotal = (price, qty, vat) =>
  Math.round((vat ? price * 1.07 : price) * qty * 100) / 100;

function refresh() {
  revalidatePath('/expenses');
  revalidatePath('/reports');
  revalidatePath('/dashboard');
  revalidatePath('/analytics');
}

// map row จากฟอร์ม → record สำหรับ insert/update (คำนวณ total ฝั่งเซิร์ฟเวอร์)
function toRecord(r) {
  const price = num(r.unit_price);
  const qty = num(r.quantity) || 1;
  return {
    subcategory: String(r.supplier || '').trim() || null,
    item_name: String(r.item_name || '').trim(),
    unit: String(r.unit || '').trim(),
    unit_price: price,
    quantity: qty,
    total_amount: lineTotal(price, qty, !!r.vat),
    payment_method: String(r.payment_method || 'บัญชี หจก.'),
  };
}

// ── เพิ่มรายจ่ายหลายรายการ (append) ──
export async function saveExpensesAction(input) {
  const acc = await requireCap('/expenses', 'create');
  if (!acc.allowed) return { status: 'error', message: acc.message };
  const { supabase, user } = acc;

  const date = String(input.date || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { status: 'error', message: 'วันที่ไม่ถูกต้อง' };
  const category = String(input.category || '');
  if (!EXPENSE_CATEGORY_VALUES.includes(category)) return { status: 'error', message: 'หมวดหมู่ไม่ถูกต้อง' };

  const records = (Array.isArray(input.rows) ? input.rows : [])
    .filter((r) => String(r.item_name || '').trim() && num(r.unit_price) > 0)
    .map((r) => ({ ...toRecord(r), date, category, month_label: '', recorded_by: user.id }));

  if (!records.length) return { status: 'error', message: 'กรุณากรอกอย่างน้อย 1 รายการ (ชื่อ + ราคา)' };

  // เตือนก่อนบันทึกถ้าดูซ้ำกับรายการที่มีอยู่แล้ว (วันที่+หมวด+ชื่อ+ยอดเงินตรงกัน — เกณฑ์เดียวกับ dedupMonthAction)
  // ไม่บล็อกอัตโนมัติ เพราะบางครั้งซื้อของชื่อ/ราคาเดียวกัน 2 รอบในวันเดียวกันจริงๆ ก็มีได้
  if (!input.force) {
    const { data: sameDay } = await supabase
      .from('expenses')
      .select('item_name, total_amount')
      .eq('date', date)
      .eq('category', category);
    const dupNames = records
      .filter((r) => (sameDay || []).some((e) =>
        (e.item_name || '').trim().toLowerCase() === r.item_name.trim().toLowerCase() &&
        Number(e.total_amount) === r.total_amount
      ))
      .map((r) => r.item_name);
    if (dupNames.length) {
      return {
        status: 'confirm',
        message: `รายการนี้ดูซ้ำกับที่บันทึกไว้แล้วในวันนี้: ${dupNames.join(', ')} — ต้องการบันทึกต่อไปหรือไม่?`,
      };
    }
  }

  const { error } = await supabase.from('expenses').insert(records);
  if (error) return { status: 'error', message: error.message };

  refresh();
  const sum = records.reduce((a, r) => a + r.total_amount, 0);
  return { status: 'ok', message: `บันทึก ${records.length} รายการ รวม ${sum.toLocaleString('th-TH')} ฿` };
}

// ── แก้ไขรายการเดียว (RLS update = authenticated) ──
export async function updateExpenseAction(input) {
  const acc = await requireCap('/expenses', 'edit');
  if (!acc.allowed) return { status: 'error', message: acc.message };
  const { supabase } = acc;

  const id = String(input.id || '');
  if (!id) return { status: 'error', message: 'ไม่พบรายการ' };
  const rec = toRecord(input);
  if (!rec.item_name) return { status: 'error', message: 'กรุณาระบุชื่อรายการ' };

  const { data, error } = await supabase.from('expenses').update(rec).eq('id', id).select('id');
  if (error) return { status: 'error', message: error.message };
  if (!data?.length) return { status: 'error', message: 'แก้ไขไม่สำเร็จ (ไม่พบรายการ)' };

  refresh();
  return { status: 'ok', message: 'แก้ไขรายการเรียบร้อย' };
}

// ── ลบรายการเดียว (RLS delete = admin/manager+ เท่านั้น) ──
export async function deleteExpenseAction(id) {
  const acc = await requireCap('/expenses', 'edit');
  if (!acc.allowed) return { status: 'error', message: acc.message };
  if (!canDeleteOnPage(acc.role, '/expenses', acc.perms)) {
    return { status: 'error', message: 'ลบไม่สำเร็จ — ต้องมีสิทธิ์ admin หรือ manager' };
  }
  const { supabase } = acc;
  if (!id) return { status: 'error', message: 'ไม่พบรายการ' };

  // .select() เพื่อเช็คว่าลบได้จริง — RLS ที่บล็อกจะคืน 0 แถว (ไม่ error)
  const { data, error } = await supabase.from('expenses').delete().eq('id', String(id)).select('id');
  if (error) return { status: 'error', message: error.message };
  if (!data?.length) return { status: 'error', message: 'ลบไม่สำเร็จ — ต้องมีสิทธิ์ admin หรือ manager' };

  refresh();
  return { status: 'ok', message: 'ลบรายการเรียบร้อย' };
}
