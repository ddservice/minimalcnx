import { cache } from 'react';
import { createClient } from './supabase/server';

const PROFILE_COLS = 'role, full_name, username, nickname, is_active';

/**
 * ดึง profile ของผู้ใช้ — dedupe ภายใน request เดียวด้วย cache() ของ React
 *
 * ทำไมต้องมี: หน้าที่เรียกทั้ง requireSession() (lib/session.js) และฟังก์ชันที่ผ่าน
 * requireCap()/loadAccess() (lib/access.js) ในการ render รอบเดียว จะยิงหา profile ของ
 * คนเดียวกันสองครั้ง — เห็นชัดที่สุดที่ /loyalty/analytics ซึ่ง requirePage() ทำงานก่อน
 * แล้ว getLoyaltyAnalyticsAction() ก็ไปดึง profile ซ้ำอีกรอบ
 *
 * cache() มีขอบเขตแค่ภายใน request เดียวและถูกทิ้งเมื่อจบ request → ไม่มีทางที่ profile
 * ของคนหนึ่งจะข้ามไปอีกคน ต่างจากแคชระดับ process (ดู lib/config-cache.js ที่ใช้ได้เฉพาะ
 * ข้อมูลที่ไม่ผูกกับตัวผู้ใช้เท่านั้น)
 *
 * รับ userId เป็นสตริงตัวเดียว ไม่รับ client เข้ามา เพราะ cache() จำผลตามอาร์กิวเมนต์
 * แบบเทียบ reference — ส่งอ็อบเจกต์เข้ามาแล้ว dedupe จะพลาดง่าย
 */
export const getProfile = cache(async (userId) => {
  if (!userId) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from('profiles')
    .select(PROFILE_COLS)
    .eq('id', userId)
    .maybeSingle();
  return data || null;
});
