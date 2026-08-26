// แคชค่า business_config ในหน่วยความจำของ process (ฝั่งเซิร์ฟเวอร์เท่านั้น)
//
// ทำไมแคชได้อย่างปลอดภัย: policy "config: read authenticated" เปิดให้ทุกคนที่ล็อกอิน
// อ่าน business_config ได้เหมือนกันหมด ค่าที่ได้จึง "ไม่ผูกกับตัวผู้ใช้" — ต่างจากตารางอื่น
// ในระบบนี้ที่ RLS คืนคนละแถวตาม JWT (sales_daily / expenses / customers / audit_log)
// ⚠️ ห้ามเอาแพตเทิร์นนี้ไปใช้กับตารางเหล่านั้น การแคชผลลัพธ์ที่ผูกกับ user คือการยกข้อมูล
// ของคนหนึ่งไปเสิร์ฟให้อีกคน ซึ่งทำลาย security model ทั้งหมดแบบเงียบที่สุด
//
// ทำไมไม่ใช้ unstable_cache ของ Next: callback ของมันห้ามแตะ dynamic API และ Supabase
// client ฝั่งเซิร์ฟเวอร์อ่าน cookie ตอนยิง request (lib/supabase/server.js) จึงเรียกข้างในไม่ได้
// ส่วนการใช้ anon client แบบไม่มี cookie ก็อ่านไม่ได้เพราะ policy บังคับ authenticated
//
// ทำไมไม่กลัวลืม invalidate: ทุกการเขียน business_config ต้องผ่าน upsertBusinessConfig()
// (กฎใน CLAUDE.md) ซึ่งเรียก invalidateConfigCache() ให้เสมอ — TTL เป็นแค่ตาข่ายกันพลาด
// เผื่อมีใครแก้ค่าตรงจาก Supabase Studio

const TTL_MS = 60_000;

/** @type {Map<string, { value: unknown, expires: number }>} */
const store = new Map();

/** คืน { found, value } — แยก "ไม่มีในแคช" ออกจาก "แคชไว้ว่าเป็น null" ให้ชัด */
export function readCachedConfig(key) {
  const hit = store.get(key);
  if (!hit) return { found: false, value: undefined };
  if (hit.expires <= Date.now()) {
    store.delete(key);
    return { found: false, value: undefined };
  }
  return { found: true, value: hit.value };
}

export function writeCachedConfig(key, value) {
  store.set(key, { value, expires: Date.now() + TTL_MS });
}

/** ล้างแคช — ไม่ส่ง key มา = ล้างทั้งหมด */
export function invalidateConfigCache(key) {
  if (key === undefined) store.clear();
  else store.delete(key);
}
