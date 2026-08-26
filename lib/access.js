import { createClient } from './supabase/server';
import { canAccess, denyMessage } from './perms';
import { stampAuditContext, logAuditEvent } from './audit';
import { getProfile } from './account';
import { readBusinessConfig } from './config-store';

export async function loadAccess() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, supabase, user: null, profile: null, role: null, perms: {}, isAdmin: false };

  // ใช้ตัวเดียวกับ requireSession() → หน้าเดียวที่เรียกทั้งสองทางไม่ยิงหา profile ซ้ำ
  // (getUser() ที่บรรทัดบนยังคงไว้โดยตั้งใจ — Server Action ไม่ควรเชื่อ cookie อย่างเดียว
  //  ดูเหตุผลเต็มในหมายเหตุ Performance ของ CLAUDE.md)
  const [profile, perms] = await Promise.all([
    getProfile(user.id),
    readBusinessConfig(supabase, 'role_perms', {}),
  ]);

  const role = profile?.role || 'manager';
  return {
    ok: true,
    supabase,
    user,
    profile,
    role,
    perms,
    isAdmin: role === 'admin',
  };
}

/** กัน Server Action ตามระดับสิทธิ์ของหน้า — defense-in-depth (RLS ยังเป็นด่านจริง) */
export async function requireCap(href, action) {
  const a = await loadAccess();
  if (!a.user) return { ...a, allowed: false, message: 'กรุณาเข้าสู่ระบบ' };
  if (a.profile && a.profile.is_active === false) {
    return { ...a, allowed: false, message: 'บัญชีถูกปิดใช้งาน' };
  }
  if (!canAccess(a.role, href, action, a.perms)) {
    await logAuditEvent(a.supabase, {
      action: 'DENY',
      table: 'access',
      details: { href, needed: action, role: a.role },
      outcome: 'failure',
      pathHint: href,
    });
    return { ...a, allowed: false, message: denyMessage(action) };
  }
  await stampAuditContext(a.supabase, href);
  return { ...a, allowed: true };
}
