'use server';

import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { createClient } from '../../lib/supabase/server';
import { homePathForRole } from '../../lib/perms';
import { logAuditEvent } from '../../lib/audit';
import { readBusinessConfig } from '../../lib/config-store';

const ROLE_COOKIE = 'mm69_role';

async function setRoleCookie(role) {
  const jar = await cookies();
  jar.set(ROLE_COOKIE, role || '', {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 60 * 24 * 40,
  });
}

export async function clearRoleCookie() {
  const jar = await cookies();
  jar.delete(ROLE_COOKIE);
}

// Login ทำงานฝั่งเซิร์ฟเวอร์ทั้งหมด — รหัสผ่านไม่ผ่าน client-side logic ที่แก้ได้
export async function login(prevState, formData) {
  const supabase = await createClient();

  const usernameRaw = String(formData.get('username') || '').trim().toLowerCase();
  const password = String(formData.get('password') || '');

  if (!usernameRaw || !password) {
    return { error: 'กรุณากรอกชื่อผู้ใช้และรหัสผ่าน' };
  }

  // ระบบเดิมใช้ email แบบ <username>@marim69.internal
  const email = usernameRaw.includes('@')
    ? usernameRaw
    : `${usernameRaw}@marim69.internal`;

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    await logAuditEvent(supabase, {
      action: 'LOGIN_FAIL',
      table: 'auth',
      details: { username: usernameRaw, reason: 'invalid_credentials' },
      outcome: 'failure',
      pathHint: '/login',
      username: usernameRaw,
    });
    return { error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' };
  }

  // เช็กว่าบัญชียังใช้งานได้อยู่ก่อนปล่อยผ่าน — ถ้าถูกปิดใช้งาน (is_active=false) ให้เซ็นเอาต์ทันที
  const { data: profile } = await supabase
    .from('profiles')
    .select('is_active, role')
    .eq('id', data.user.id)
    .maybeSingle();
  if (profile?.is_active === false) {
    await logAuditEvent(supabase, {
      action: 'LOGIN_FAIL',
      table: 'auth',
      details: { username: usernameRaw, reason: 'disabled' },
      outcome: 'failure',
      pathHint: '/login',
      username: usernameRaw,
    });
    await supabase.auth.signOut();
    await clearRoleCookie();
    return { error: 'บัญชีนี้ถูกปิดใช้งาน กรุณาติดต่อผู้ดูแลระบบ' };
  }

  await logAuditEvent(supabase, {
    action: 'LOGIN',
    table: 'auth',
    details: { username: usernameRaw, role: profile?.role },
    pathHint: '/login',
    username: usernameRaw,
  });

  await setRoleCookie(profile?.role);
  const perms = await readBusinessConfig(supabase, 'role_perms', {});
  redirect(homePathForRole(profile?.role, perms));
}

export async function signOutAction() {
  const supabase = await createClient();
  await logAuditEvent(supabase, { action: 'LOGOUT', table: 'auth', pathHint: '/logout' });
  await supabase.auth.signOut();
  await clearRoleCookie();
  redirect('/login');
}
