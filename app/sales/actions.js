'use server';

import { revalidatePath } from 'next/cache';
import { computeNetRevenue } from '../../lib/gp';
import { requireCap } from '../../lib/access';
import { canAccess, canDeleteOnPage } from '../../lib/perms';

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : 0;
};
const int = (v) => Math.trunc(num(v));

// บันทึกยอดขายรายวัน — คำนวณ net ฝั่งเซิร์ฟเวอร์ (ไม่เชื่อค่าจาก client)
export async function saveSalesAction(input) {
  const acc = await requireCap('/sales', 'create');
  if (!acc.allowed) return { status: 'error', message: acc.message };
  const { supabase } = acc;

  const date = String(input.date || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { status: 'error', message: 'วันที่ไม่ถูกต้อง' };
  }

  const { data: existing } = await supabase.from('sales_daily').select('id').eq('date', date).maybeSingle();
  if (existing && !canAccess(acc.role, '/sales', 'edit', acc.perms)) {
    return { status: 'error', message: 'มีข้อมูลวันนี้แล้ว — สิทธิ์ของคุณกรอกวันใหม่ได้เท่านั้น ไม่สามารถแก้ไขของเดิม' };
  }

  const payload = {
    date,
    total_cups: int(input.total_cups),
    kshop_amount: num(input.kshop_amount),
    cash_amount: num(input.cash_amount),
    shopee_before_gp: num(input.shopee_before_gp),
    grab_before_gp: num(input.grab_before_gp),
    lineman_before_gp: num(input.lineman_before_gp),
    free_cups: int(input.free_cups),
    free_cup_cost: num(input.free_cup_cost),
    pastry_pieces: int(input.pastry_pieces),
    pastry_revenue: num(input.pastry_revenue),
  };
  // net_revenue คำนวณจากค่าดิบเสมอ (authoritative ฝั่ง server)
  payload.net_revenue = computeNetRevenue(payload);

  // ลิงก์หลักฐานแก้วฟรี (ถ้ามี) — RPC จะ coalesce เก็บของเดิมไว้ถ้าไม่ได้แนบใหม่
  // (ต้องรัน sql/add_free_cup_actual_cost.sql ก่อน คอลัมน์/RPC เวอร์ชันนี้ถึงจะรับค่านี้จริง)
  const evidenceUrl = String(input.free_cup_evidence_url || '').trim();
  if (evidenceUrl) payload.free_cup_evidence_url = evidenceUrl;

  // upsert ตาม date (RPC เดิม, SECURITY DEFINER, ตั้ง recorded_by = auth.uid())
  const { error } = await supabase.rpc('upsert_sales_daily', { p_data: payload });
  if (error) return { status: 'error', message: error.message };

  revalidatePath('/sales');
  revalidatePath('/reports');
  revalidatePath('/dashboard');
  return {
    status: 'ok',
    message: `บันทึกยอดขายวันที่ ${date} เรียบร้อย (สุทธิ ${payload.net_revenue.toLocaleString('th-TH')} ฿)`,
  };
}

// ── ลบยอดขายทั้งวัน (RLS delete = admin เท่านั้น) ──
export async function deleteSalesAction(date) {
  const acc = await requireCap('/sales', 'edit');
  if (!acc.allowed) return { status: 'error', message: acc.message };
  if (!canDeleteOnPage(acc.role, '/sales', acc.perms)) {
    return { status: 'error', message: 'ลบไม่สำเร็จ — ต้องมีสิทธิ์ admin' };
  }
  const { supabase } = acc;

  const d = String(date || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return { status: 'error', message: 'วันที่ไม่ถูกต้อง' };

  // .select() เพื่อเช็คว่าลบได้จริง — RLS ที่บล็อกจะคืน 0 แถว (ไม่ error)
  const { data, error } = await supabase.from('sales_daily').delete().eq('date', d).select('id');
  if (error) return { status: 'error', message: error.message };
  if (!data?.length) return { status: 'error', message: 'ลบไม่สำเร็จ — ต้องมีสิทธิ์ admin' };

  revalidatePath('/sales');
  revalidatePath('/reports');
  revalidatePath('/dashboard');
  return { status: 'ok', message: `ลบยอดขายวันที่ ${d} เรียบร้อย` };
}
