'use server';

import { revalidatePath } from 'next/cache';
import { loadAccess } from '../../../lib/access';
import { stampAuditContext, logAuditEvent } from '../../../lib/audit';
import { DOC_BUCKET, DOC_CATEGORY_VALUES, MAX_DOC_MB, isValidDocPath } from '../../../lib/documents';

const PATH = '/admin/documents';
const DENY = { status: 'error', message: 'เฉพาะ Admin หรือ Co-Admin เท่านั้น' };
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
const clean = (v, max) => String(v || '').trim().slice(0, max);

// defense-in-depth — ด่านจริงคือ RLS ของตาราง documents และ storage.objects (sql/add_documents.sql)
async function guard() {
  const a = await loadAccess();
  if (!a.user || a.profile?.is_active === false) return null;
  if (a.role !== 'admin' && a.role !== 'co-admin') return null;
  await stampAuditContext(a.supabase, PATH);
  return a;
}

// บันทึก metadata หลังเบราว์เซอร์อัปโหลดไฟล์เข้า bucket แล้ว (ไฟล์ไม่ผ่าน Server Action — เกินขนาด body ที่ Next รับ)
export async function createDocumentAction(input) {
  const acc = await guard();
  if (!acc) return DENY;
  const { supabase, user } = acc;

  const category = String(input?.category || '');
  if (!DOC_CATEGORY_VALUES.includes(category)) return { status: 'error', message: 'หมวดเอกสารไม่ถูกต้อง' };
  const title = clean(input?.title, 200);
  if (!title) return { status: 'error', message: 'กรุณาระบุชื่อเอกสาร' };
  const storage_path = String(input?.storage_path || '');
  if (!isValidDocPath(storage_path, category)) return { status: 'error', message: 'ตำแหน่งไฟล์ไม่ถูกต้อง' };
  const size = Number(input?.size_bytes) || 0;
  if (size <= 0 || size > MAX_DOC_MB * 1024 * 1024) return { status: 'error', message: `ไฟล์ต้องไม่เกิน ${MAX_DOC_MB}MB` };

  const { data, error } = await supabase
    .from('documents')
    .insert({
      category,
      title,
      owner_label: clean(input?.owner_label, 200) || null,
      doc_date: isDate(input?.doc_date) ? input.doc_date : null,
      expires_at: isDate(input?.expires_at) ? input.expires_at : null,
      note: clean(input?.note, 1000) || null,
      storage_path,
      file_name: clean(input?.file_name, 255) || null,
      mime_type: clean(input?.mime_type, 100) || null,
      size_bytes: Math.round(size),
      uploaded_by: user.id,
    })
    .select('id');
  if (error) return { status: 'error', message: error.message };
  if (!data?.length) return { status: 'error', message: 'บันทึกไม่สำเร็จ — คุณไม่มีสิทธิ์เพิ่มเอกสาร' };

  revalidatePath(PATH);
  return { status: 'ok', message: `เก็บเอกสาร "${title}" เรียบร้อย` };
}

// ออกลิงก์เปิดดูอายุสั้น — bucket เป็น private ไม่มีลิงก์ถาวร และทุกครั้งที่เปิดถูกบันทึกใน audit
export async function getDocumentUrlAction(id) {
  const acc = await guard();
  if (!acc) return DENY;
  const { supabase } = acc;

  const { data: doc } = await supabase
    .from('documents')
    .select('id, title, category, storage_path')
    .eq('id', String(id || ''))
    .maybeSingle();
  if (!doc) return { status: 'error', message: 'ไม่พบเอกสาร' };

  const { data, error } = await supabase.storage.from(DOC_BUCKET).createSignedUrl(doc.storage_path, 120);
  if (error || !data?.signedUrl) return { status: 'error', message: `เปิดไฟล์ไม่สำเร็จ: ${error?.message || 'ไม่พบไฟล์'}` };

  await logAuditEvent(supabase, {
    action: 'EXPORT',
    table: 'documents',
    details: { id: doc.id, title: doc.title, category: doc.category, kind: 'view_document' },
    pathHint: PATH,
  });
  return { status: 'ok', url: data.signedUrl };
}

export async function deleteDocumentAction(id) {
  const acc = await guard();
  if (!acc) return DENY;
  const { supabase } = acc;

  const { data: doc } = await supabase
    .from('documents')
    .select('id, title, storage_path')
    .eq('id', String(id || ''))
    .maybeSingle();
  if (!doc) return { status: 'error', message: 'ไม่พบเอกสาร' };

  // ลบไฟล์ก่อนแถว — ถ้าลบแถวก่อนแล้วไฟล์ลบไม่ได้ จะเหลือสำเนาบัตรค้างใน bucket โดยไม่มีอะไรชี้ถึง
  const { error: rmErr } = await supabase.storage.from(DOC_BUCKET).remove([doc.storage_path]);
  if (rmErr) return { status: 'error', message: `ลบไฟล์ไม่สำเร็จ: ${rmErr.message}` };

  const { data, error } = await supabase.from('documents').delete().eq('id', doc.id).select('id');
  if (error) return { status: 'error', message: error.message };
  if (!data?.length) return { status: 'error', message: 'ลบไม่สำเร็จ — คุณไม่มีสิทธิ์ลบเอกสาร' };

  revalidatePath(PATH);
  return { status: 'ok', message: `ลบเอกสาร "${doc.title}" เรียบร้อย` };
}
