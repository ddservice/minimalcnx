'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '../../../lib/supabase/server';
import { stampAuditContext } from '../../../lib/audit';
import { MIN_RETENTION_DAYS } from '../../../lib/audit-policy';

async function requireSuperAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { supabase, ok: false };
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();
  const ok = profile?.role === 'admin';
  if (ok) await stampAuditContext(supabase, '/admin/audit');
  return { supabase, ok };
}

/**
 * ล้าง audit_log ที่เก่ากว่า days วัน
 *
 * ตัวการล้างบันทึกร่องรอยของตัวเองไว้ใน audit_log ด้วย (ทำในฝั่ง SQL)
 * — คนที่ล้าง log ต้องปรากฏใน log เสมอ ไม่งั้นการล้างกลายเป็นช่องลบร่องรอย
 */
export async function purgeAuditLogsAction(days) {
  const { supabase, ok } = await requireSuperAdmin();
  if (!ok) return { status: 'error', message: 'เฉพาะ Super Admin เท่านั้น' };

  const n = Number(days);
  if (!Number.isInteger(n) || n < MIN_RETENTION_DAYS) {
    return { status: 'error', message: `ต้องเก็บย้อนหลังอย่างน้อย ${MIN_RETENTION_DAYS} วัน` };
  }

  const { data, error } = await supabase.rpc('cleanup_old_audit_logs', { p_days_to_keep: n });

  if (error) {
    // ยังไม่ได้รันไฟล์ SQL — บอกให้ตรงจุดแทนที่จะโยน error ดิบใส่หน้าจอ
    if (/could not find|does not exist|PGRST202/i.test(error.message || '')) {
      return { status: 'error', message: 'ยังไม่ได้รัน sql/maintenance_audit_log.sql บน Supabase' };
    }
    return { status: 'error', message: error.message };
  }

  revalidatePath('/admin/audit');
  const deleted = Number(data || 0);
  return {
    status: 'ok',
    message: deleted
      ? `ล้างแล้ว ${deleted.toLocaleString('th-TH')} รายการที่เก่ากว่า ${n} วัน`
      : `ไม่มีรายการที่เก่ากว่า ${n} วัน — ไม่ได้ลบอะไร`,
  };
}
