'use server';
import { createHash } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { requireCap } from '../../../lib/access';
import { computeInvoice, normalizeName, validDate, validMonth } from '../../../lib/bakery-cost';

async function access() {
  const acc = await requireCap('/expenses', 'edit');
  if (!acc.allowed || !['admin', 'co-admin'].includes(acc.role)) throw new Error('เฉพาะเจ้าของหรือผู้ดูแลที่มีสิทธิ์แก้ไขรายจ่าย');
  return acc;
}
async function run(fn) {
  try {
    const result = await fn();
    for (const path of ['/expenses/bakery', '/expenses', '/reports', '/dashboard', '/analytics']) revalidatePath(path);
    return { ok: true, ...result };
  } catch (e) {
    return { ok: false, message: e.code === '23505' ? 'เลขบิลหรือไฟล์นี้มีอยู่แล้ว เปิดข้อมูลเดิมแทนการเพิ่มซ้ำ' : e.code === '23503' ? 'บิลมีเอกสารแนบ ให้ผู้ดูแลตรวจเอกสารก่อนยกเลิก' : e.message || 'บันทึกไม่สำเร็จ' };
  }
}
export async function saveInvoiceAction(input) {
  return run(async () => {
    const { supabase } = await access();
    const calc = computeInvoice(input);
    if (!validDate(input.received_on) || input.due_on && !validDate(input.due_on)) throw new Error('วันที่ไม่ถูกต้อง');
    if (!String(input.supplier || '').trim() || !String(input.invoice_no || '').trim()) throw new Error('ระบุผู้ขายและเลขใบส่งสินค้า');
    if (input.expected_total === '' || input.expected_total == null || !Number.isFinite(Number(input.expected_total))) throw new Error('ระบุยอดสุทธิตามเอกสาร');
    const clean = { id: input.id || null, supplier: input.supplier.trim(), invoice_no: input.invoice_no.trim(),
      received_on: input.received_on, due_on: input.due_on || null, discount_pct: Number(input.discount_pct),
      lines: calc.lines.map(({ name, unit, quantity, unit_price }) => ({ name, unit, quantity, unit_price })),
      expected_total: Number(input.expected_total), payment_method: String(input.payment_method || 'ค้างชำระ'), note: String(input.note || '') };
    const { data, error } = await supabase.rpc('bakery_save_invoice', { p_data: clean, p_version: input.version || 0 });
    if (error) throw error;
    return { id: data, message: 'เก็บฉบับร่างแล้ว ยังไม่เพิ่มรายจ่ายจริง' };
  });
}
export async function changeInvoiceAction(id, version, action, reason = '') {
  return run(async () => {
    const { supabase } = await access();
    if (!['post', 'void', 'reopen'].includes(action)) throw new Error('คำสั่งไม่ถูกต้อง');
    const { error } = await supabase.rpc('bakery_change_invoice', { p_id: id, p_version: version, p_action: action, p_reason: reason });
    if (error) throw error;
    return { message: action === 'post' ? 'เพิ่มต้นทุนสุทธิในรายจ่ายแล้ว ไม่ต้องลงบิลนี้ซ้ำ' : action === 'reopen' ? 'เปิดเป็นฉบับร่างแล้ว แก้ข้อมูลและตรวจใหม่ก่อนลงรายจ่าย' : 'ยกเลิกบิลแล้ว เก็บประวัติและเหตุผลไว้' };
  });
}
export async function savePOSAction(input) {
  return run(async () => {
    const { supabase } = await access();
    if (!validMonth(input.month) || !Array.isArray(input.rows) || input.rows.length > 4000) throw new Error('เดือนหรือไฟล์ไม่ถูกต้อง');
    const rows = input.rows.map(r => {
      if (!validDate(r.date) || !r.date.startsWith(`${input.month}-`)) throw new Error('วันที่ในไฟล์ไม่ตรงเดือน');
      return { date: r.date, name: String(r.name || '').trim(), key: normalizeName(r.name), receipt: String(r.receipt || '').trim(),
        quantity: Number(r.quantity), revenue: Number(r.revenue), channel: String(r.channel || '').trim() };
    });
    const hash = createHash('sha256').update(JSON.stringify(rows)).digest('hex');
    if (Buffer.byteLength(JSON.stringify(rows)) > 650000) throw new Error('รายละเอียดขนมใหญ่เกินไป');
    const { error } = await supabase.rpc('bakery_save_pos', { p_month: input.month, p_rows: rows, p_hash: hash,
      p_name: String(input.source_name || '').slice(0, 200), p_branch: String(input.branch || ''), p_version: input.version || 0 });
    if (error) throw error;
    return { message: 'เก็บ POS สำหรับตรวจต้นทุนแล้ว ยอดขายรายวันเดิมยังไม่ถูกแก้ไข' };
  });
}
export async function saveMappingAction(input) {
  return run(async () => {
    const { supabase } = await access();
    if (!input.confirmed) throw new Error('ยืนยันหน่วยสินค้าก่อนบันทึกคู่');
    const { error } = await supabase.rpc('bakery_save_mapping', { p_key: normalizeName(input.key), p_supplier: String(input.supplier || '').trim(),
      p_purchase: String(input.purchase_name || '').trim(), p_factor: Number(input.factor) });
    if (error) throw error;
    return { message: 'จำคู่สินค้าและหน่วยแล้ว ใช้กับรายงานเดือนอื่นได้' };
  });
}
