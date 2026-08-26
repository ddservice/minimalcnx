'use server';

import ExcelJS from 'exceljs';
import { revalidatePath } from 'next/cache';
import { createClient } from '../../lib/supabase/server';
import { computeNetRevenue } from '../../lib/gp';
import { upsertBusinessConfig } from '../../lib/config-store';
import { requireCap } from '../../lib/access';
import { normalizeRolePerms } from '../../lib/perms';
import { stampAuditContext, logAuditEvent } from '../../lib/audit';

const FIELDS = ['name', 'phone', 'tax_id', 'address', 'logo_url', 'free_cup_cost'];

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

// อ่านค่าจากหลายชื่อคอลัมน์ที่เป็นไปได้
const pick = (row, ...names) => {
  for (const n of names) if (row[n] != null && row[n] !== '') return row[n];
  return '';
};

// แปลงวันที่: Date | ISO | dd/mm/yyyy (รองรับปี พ.ศ.)
function toISO(v) {
  if (v instanceof Date) return new Date(v.getTime() - v.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const s = String(v || '').trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) {
    let [, d, mo, y] = m; y = Number(y); if (y > 2500) y -= 543;
    return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  return null;
}

function sheetToObjects(ws) {
  if (!ws) return [];
  const out = [];
  let headers = [];
  ws.eachRow((row, n) => {
    const vals = row.values; // 1-indexed (vals[0] undefined)
    if (n === 1) { headers = vals.map((v) => String(v == null ? '' : v).trim()); return; }
    const obj = {};
    headers.forEach((h, i) => { if (h) obj[h] = vals[i]; });
    out.push(obj);
  });
  return out;
}

// นำเข้าข้อมูลจาก .xlsx (type: 'sales' | 'expense')
export async function importData(prevState, formData) {
  const { supabase, ok: isAdmin, user } = await requireAdmin();
  if (!isAdmin) return { status: 'error', message: 'เฉพาะ Admin เท่านั้น' };

  const type = String(formData.get('type') || '');
  const file = formData.get('file');
  if (!(file instanceof File) || !file.size) return { status: 'error', message: 'กรุณาเลือกไฟล์ .xlsx' };

  let ws;
  try {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(await file.arrayBuffer()));
    ws = wb.worksheets[0];
  } catch {
    return { status: 'error', message: 'อ่านไฟล์ไม่ได้ — ต้องเป็น .xlsx' };
  }
  const rows = sheetToObjects(ws);
  if (!rows.length) return { status: 'error', message: 'ไม่พบข้อมูลในไฟล์' };

  let ok = 0;
  let skipped = 0;

  if (type === 'sales') {
    for (const r of rows) {
      const date = toISO(pick(r, 'วันที่', 'date'));
      if (!date) { skipped++; continue; }
      const payload = {
        date,
        total_cups: num(pick(r, 'แก้วรวม', 'ยอดขาย(แก้ว)', 'ยอดขาย(แก้วรวม)', 'total_cups')),
        kshop_amount: num(pick(r, 'K-Shop', 'K-Shop(฿)', 'kshop_amount')),
        cash_amount: num(pick(r, 'เงินสด', 'เงินสด(฿)', 'cash_amount')),
        shopee_before_gp: num(pick(r, 'Shopee(ก่อน GP)', 'Shopee(฿)ก่อน GP', 'shopee_before_gp')),
        grab_before_gp: num(pick(r, 'Grab(ก่อน GP)', 'Grab(฿)ก่อน GP', 'grab_before_gp')),
        lineman_before_gp: num(pick(r, 'Lineman(ก่อน GP)', 'LineMan(฿)ก่อน GP', 'lineman_before_gp')),
        free_cups: num(pick(r, 'แก้วฟรี(แก้ว)', 'free_cups')),
        free_cup_cost: num(pick(r, 'ต้นทุน/แก้วฟรี(฿)', 'free_cup_cost')),
        pastry_pieces: num(pick(r, 'ขนม(ชิ้น)', 'pastry_pieces')),
        pastry_revenue: num(pick(r, 'รายได้ขนม', 'รายได้ขนม(฿)', 'pastry_revenue')),
      };
      const provided = num(pick(r, 'รายรับสุทธิ', 'รายรับสุทธิ(฿)', 'net_revenue'));
      payload.net_revenue = provided > 0 ? provided : computeNetRevenue(payload);
      const { error } = await supabase.rpc('upsert_sales_daily', { p_data: payload });
      if (error) return { status: 'error', message: `แถวขาย: ${error.message}` };
      ok++;
    }
  } else if (type === 'expense') {
    const records = [];
    for (const r of rows) {
      const date = toISO(pick(r, 'วันที่', 'date'));
      const item_name = String(pick(r, 'รายการ', 'item_name')).trim();
      // ใช้หมวดตามไฟล์ (รองรับทั้งหมวดรายจ่ายและ OPEX เหมือน import เดิม)
      const category = String(pick(r, 'หมวดหมู่', 'หมวด', 'category')).trim() || 'ต้นทุนวัตถุดิบ';
      if (!date || !item_name) { skipped++; continue; }
      records.push({
        date, category,
        subcategory: String(pick(r, 'ซัพพลายเออร์', 'ผู้ขาย', 'supplier')).trim() || null,
        item_name,
        unit: String(pick(r, 'หน่วย', 'unit')).trim(),
        unit_price: num(pick(r, 'ราคา/หน่วย', 'ราคา/หน่วย(฿)', 'unit_price')),
        quantity: num(pick(r, 'จำนวน', 'quantity')) || 1,
        total_amount: num(pick(r, 'รวม (฿)', 'รวม(฿)', 'total_amount')),
        payment_method: String(pick(r, 'ชำระด้วย', 'payment_method')).trim() || 'บัญชี หจก.',
        month_label: '',
        recorded_by: user.id,
      });
      ok++;
    }
    if (records.length) {
      const { error } = await supabase.from('expenses').insert(records);
      if (error) return { status: 'error', message: error.message };
    }
  } else {
    return { status: 'error', message: 'ชนิดข้อมูลไม่ถูกต้อง' };
  }

  revalidatePath('/reports');
  revalidatePath('/dashboard');
  await logAuditEvent(supabase, {
    action: 'IMPORT',
    table: 'reports',
    details: { type, rows: ok, skipped },
    pathHint: '/settings',
  });
  return { status: 'ok', message: `นำเข้าสำเร็จ ${ok} แถว${skipped ? ` (ข้าม ${skipped} แถวที่ข้อมูลไม่ครบ)` : ''}` };
}

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { supabase, ok: false };
  const { data: p } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle();
  if (p?.role === 'admin') await stampAuditContext(supabase, '/settings');
  return { supabase, user, ok: p?.role === 'admin' };
}

const monthRange = (ym) => {
  const [y, m] = String(ym).split('-');
  return { start: `${y}-${m}-01`, end: new Date(Number(y), Number(m), 0).toISOString().slice(0, 10), y, m };
};

// ลบข้อมูลทั้งเดือน (admin) — scope: all | sales | expense
export async function deleteMonthAction(input) {
  const { supabase, ok } = await requireAdmin();
  if (!ok) return { status: 'error', message: 'เฉพาะ Admin เท่านั้น' };
  if (!/^\d{4}-\d{2}$/.test(input.month || '')) return { status: 'error', message: 'เดือนไม่ถูกต้อง' };
  const { start, end, y, m } = monthRange(input.month);
  const scope = input.scope || 'all';
  let deleted = 0;
  if (scope === 'all' || scope === 'sales') {
    const { data } = await supabase.from('sales_daily').delete().gte('date', start).lte('date', end).select('id');
    deleted += data?.length || 0;
  }
  if (scope === 'all' || scope === 'expense') {
    const { data } = await supabase.from('expenses').delete().gte('date', start).lte('date', end).select('id');
    deleted += data?.length || 0;
  }
  revalidatePath('/reports'); revalidatePath('/analytics'); revalidatePath('/dashboard');
  return { status: 'ok', message: `ลบ ${deleted} รายการของเดือน ${m}/${y} เรียบร้อย` };
}

// ลบรายจ่ายที่ซ้ำกันในเดือน (admin) — ซ้ำ = date+category+item_name+total เท่ากัน
export async function dedupMonthAction(input) {
  const { supabase, ok } = await requireAdmin();
  if (!ok) return { status: 'error', message: 'เฉพาะ Admin เท่านั้น' };
  if (!/^\d{4}-\d{2}$/.test(input.month || '')) return { status: 'error', message: 'เดือนไม่ถูกต้อง' };
  const { start, end } = monthRange(input.month);
  const { data: rows } = await supabase.from('expenses')
    .select('id, date, category, item_name, total_amount, logged_at')
    .gte('date', start).lte('date', end).order('logged_at', { ascending: true });
  const seen = new Set();
  const dupIds = [];
  (rows || []).forEach((r) => {
    const key = `${r.date}|${r.category}|${r.item_name}|${r.total_amount}`;
    if (seen.has(key)) dupIds.push(r.id); else seen.add(key);
  });
  if (!dupIds.length) return { status: 'ok', message: 'ไม่พบรายการซ้ำ' };
  const { data } = await supabase.from('expenses').delete().in('id', dupIds).select('id');
  revalidatePath('/reports'); revalidatePath('/analytics'); revalidatePath('/dashboard');
  return { status: 'ok', message: `ลบรายการซ้ำ ${data?.length || 0} รายการ` };
}

// บันทึกค่าตั้งต้น OPEX (business_config key = opex_defaults) — admin
export async function saveOpexDefaults(defaults) {
  const { supabase, ok } = await requireAdmin();
  if (!ok) return { status: 'error', message: 'เฉพาะ Admin เท่านั้น' };
  const clean = {};
  Object.entries(defaults || {}).forEach(([k, v]) => {
    if (v !== '' && v != null && Number.isFinite(Number(v))) clean[k] = Number(v);
  });
  const res = await upsertBusinessConfig(supabase, 'opex_defaults', clean);
  if (!res.ok) return { status: 'error', message: res.message };
  revalidatePath('/opex');
  return { status: 'ok', message: 'บันทึกค่าตั้งต้นค่าดำเนินการเรียบร้อย' };
}

// บันทึกสิทธิ์การมองเห็นแท็บตามตำแหน่ง (business_config key = role_perms)
export async function saveRolePerms(perms) {
  const { supabase, ok } = await requireAdmin();
  if (!ok) return { status: 'error', message: 'เฉพาะ Admin เท่านั้น' };
  const res = await upsertBusinessConfig(supabase, 'role_perms', normalizeRolePerms(perms || {}));
  if (!res.ok) return { status: 'error', message: res.message };
  revalidatePath('/', 'layout');
  return { status: 'ok', message: 'บันทึกสิทธิ์การเข้าถึงเรียบร้อย' };
}

// บันทึกข้อมูลบริษัทลง business_config (key = biz_info) — ใช้ร่วมทุกเครื่อง
export async function saveBizInfo(input) {
  const acc = await requireCap('/settings', 'edit');
  if (!acc.allowed) return { status: 'error', message: acc.message };
  const { supabase, user } = acc;

  const value = {};
  FIELDS.forEach((k) => { value[k] = String(input[k] || '').trim(); });

  // ผ่าน helper เสมอ — เป็นจุดเดียวที่ล้างแคช business_config ให้ (กฎใน CLAUDE.md)
  const res = await upsertBusinessConfig(supabase, 'biz_info', value, { updated_by: user.id });
  if (!res.ok) return { status: 'error', message: res.message };

  revalidatePath('/settings');
  revalidatePath('/opex');
  return { status: 'ok', message: 'บันทึกข้อมูลบริษัทเรียบร้อย' };
}
