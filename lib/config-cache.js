// Process-wide cache: role_perms and biz_info only. Other config keys have user-scoped RLS.
// Invalidate through upsertBusinessConfig(); never share user-scoped table results.

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
