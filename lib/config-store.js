import { invalidateConfigCache, readCachedConfig, writeCachedConfig } from './config-cache';

// เขียนลง business_config พร้อมตรวจจับ RLS บล็อกแบบเงียบ
//
// Postgres RLS บน UPDATE ใช้ USING clause กำหนด "แถวที่มองเห็น" — ถ้า role
// ไม่ผ่านเงื่อนไข แถวนั้นจะถูกมองว่า "ไม่มีอยู่" สำหรับ UPDATE โดยไม่ error
// (ต่างจาก INSERT ที่ WITH CHECK ไม่ผ่านจะ throw error ชัดเจน) แปลว่าถ้า key
// นั้นเคยมีแถวอยู่แล้ว (กรณี upsert ครั้งที่ 2 เป็นต้นไป) และ RLS บล็อก
// จะได้ error:null + data ว่างเปล่า — ดูเหมือน "กดปุ่มแล้วไม่มีอะไรเกิดขึ้น"
// ฟังก์ชันนี้เช็ค data ว่างแล้วแปลงเป็น error message ที่เห็นได้ชัดแทน
//
// extra = คอลัมน์เพิ่มเติมบนแถวเดียวกัน (เช่น updated_by) — ทุกการเขียนต้องผ่านที่นี่
// เพราะเป็นจุดเดียวที่ล้างแคชให้ (ดู lib/config-cache.js)
export async function upsertBusinessConfig(supabase, key, value, extra = {}) {
  const { data, error } = await supabase
    .from('business_config')
    .upsert({ key, value, ...extra })
    .select('key');
  if (error) return { ok: false, message: error.message };
  if (!data?.length) return { ok: false, message: 'บันทึกไม่สำเร็จ — คุณไม่มีสิทธิ์แก้ไขข้อมูลนี้' };

  invalidateConfigCache(key);
  return { ok: true };
}

/**
 * อ่านค่าจาก business_config ผ่านแคชในหน่วยความจำ
 *
 * ปลอดภัยกับ RLS เพราะ policy "config: read authenticated" เปิดให้ทุกคนที่ล็อกอิน
 * อ่านได้เหมือนกันหมด — ค่าที่ได้จึงไม่ผูกกับตัวผู้ใช้ ไม่มีทางที่ของคนหนึ่งจะไปโผล่ให้อีกคน
 * (ห้ามเอาแพตเทิร์นนี้ไปใช้กับตารางที่ RLS คืนคนละแถวตาม user เด็ดขาด เช่น sales/expenses/customers)
 *
 * ไม่แคชกรณี error หรือหาแถวไม่เจอ — กัน "แคชความว่างเปล่า" ที่จะทำให้ทั้งระบบ
 * ตกไปใช้ค่า default ชั่วคราว ซึ่งกับ role_perms แปลว่าสิทธิ์เพี้ยนทั้งบ้าน
 */
export async function readBusinessConfig(supabase, key, fallback = null) {
  const hit = readCachedConfig(key);
  if (hit.found) return hit.value;

  const { data, error } = await supabase
    .from('business_config')
    .select('value')
    .eq('key', key)
    .maybeSingle();

  if (error) return fallback;
  if (!data) return fallback;

  writeCachedConfig(key, data.value ?? fallback);
  return data.value ?? fallback;
}
