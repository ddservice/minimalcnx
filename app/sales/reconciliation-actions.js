'use server';

import { revalidatePath } from 'next/cache';
import { requireCap } from '../../lib/access';
import { canAccess } from '../../lib/perms';
import { validateReconciliation } from '../../lib/reconciliation';

export async function saveReconciliationAction(command, input, requestId) {
  let payload;
  try {
    payload = validateReconciliation(command, input);
    if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(requestId || '')) throw new Error('รหัสคำขอไม่ถูกต้อง');
  } catch (error) { return { status: 'error', message: error.message }; }
  const acc = await requireCap('/sales', command === 'close.save' ? 'create' : 'edit');
  if (!acc.allowed) return { status: 'error', message: acc.message };
  if (command !== 'close.save' && (!['admin', 'co-admin', 'manager'].includes(acc.role)
    || !canAccess(acc.role, '/reports', 'view', acc.perms))) {
    return { status: 'error', message: 'ต้องเป็นผู้จัดการขึ้นไปและมีสิทธิ์ดูรายงาน' };
  }
  const { data, error } = await acc.supabase.rpc('reconciliation_command', {
    p_command: command, p_data: payload, p_request: requestId,
  });
  if (error) return { status: 'error', message: error.code === 'P0001' ? error.message
    : error.code === 'PGRST202' ? 'ระบบปิดร้านและกระทบยอดยังไม่เปิดใช้งาน กรุณาติดต่อผู้ดูแล'
      : 'บันทึกไม่สำเร็จ กรุณาตรวจรายการล่าสุดก่อนลองใหม่ ข้อมูลที่กรอกยังอยู่' };
  if (!data?.id) return { status: 'error', message: 'ยังยืนยันผลการบันทึกไม่ได้ กรุณาตรวจรายการล่าสุดก่อนลองใหม่' };
  revalidatePath('/sales');
  revalidatePath('/sales/settlements');
  return { status: 'ok', message: 'บันทึกแล้ว', result: data };
}
