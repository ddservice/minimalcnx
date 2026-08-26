import { redirect } from 'next/navigation';
import { createClient } from './supabase/server';
import { allowedHrefs, canAccess, capsForRole, homePathForRole } from './perms';
import { getProfile } from './account';
import { readBusinessConfig } from './config-store';

// ตรวจ session + ดึง profile ครั้งเดียว ใช้ร่วมทุกหน้า (คืน supabase client มาใช้ต่อได้)
//
// ใช้ getSession() (อ่าน JWT จาก cookie ในเครื่อง) แทน getUser() (ยิง request ไป Supabase Auth
// server จริง) เพราะ middleware.js เรียก getUser() ยืนยัน + refresh cookie ให้แล้วเสมอก่อนหน้านี้
// ในทุก request (รวม Server Action) — เรียก getUser() ซ้ำอีกทีที่นี่มีแต่เสียเวลาเปล่า (round-trip
// ไป Supabase Auth 2 รอบต่อการโหลดหน้า 1 ครั้ง) โดยไม่ได้เพิ่มความปลอดภัยจริง เพราะพึ่ง cookie
// ชุดเดียวกันที่ middleware เพิ่ง verify มา — ถ้า middleware ไม่ได้รันมาก่อนหน้า (ไม่ควรเกิดขึ้นตาม
// matcher ปัจจุบันซึ่งครอบทุก path) getSession() ก็จะแค่ไม่พบ session แล้วเด้งไป /login เหมือนเดิม
export async function requireSession() {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const user = session?.user;
  if (!user) redirect('/login');

  // getProfile() dedupe ภายใน request เดียว (lib/account.js) และ readBusinessConfig()
  // อ่าน role_perms จากแคชในหน่วยความจำ (lib/config-cache.js) — ค่านี้เหมือนกันทุกคนที่ล็อกอิน
  const [profile, perms] = await Promise.all([
    getProfile(user.id),
    readBusinessConfig(supabase, 'role_perms', {}),
  ]);

  // บัญชีถูกปิดใช้งาน (is_active=false) → เซ็นเอาต์ทันที ไม่ให้ session ที่ล็อกอินค้างอยู่ใช้งานต่อได้
  if (profile && profile.is_active === false) {
    await supabase.auth.signOut();
    redirect('/login');
  }

  const role = profile?.role || 'manager';
  return {
    supabase,
    user,
    profile,
    role,
    perms,
    isAdmin: role === 'admin',
    name: profile?.full_name || profile?.username || 'ผู้ใช้',
    allowed: allowedHrefs(role, perms),
    caps: capsForRole(role, perms),
  };
}

/** บังคับมีสิทธิ์ดูหน้านั้น — ไม่มีแล้วเด้งไปหน้าแรกของตำแหน่ง */
export async function requirePage(href) {
  const s = await requireSession();
  if (!canAccess(s.role, href, 'view', s.perms)) {
    redirect(homePathForRole(s.role));
  }
  return s;
}
