// คลังเอกสารของร้าน (/admin/documents) — ค่าคงที่ + ฟังก์ชันล้วนที่ใช้ทั้ง client และ server
// ไฟล์จริงอยู่ใน Storage bucket แบบ private — ดู sql/add_documents.sql

export const DOC_BUCKET = 'documents';
export const MAX_DOC_MB = 10;

export const DOC_CATEGORIES = [
  { value: 'landlord', label: 'ผู้ให้เช่า / สัญญาเช่า' },
  { value: 'filing', label: 'เอกสารยื่นราชการ' },
  { value: 'employee', label: 'พนักงาน' },
  { value: 'shop', label: 'เอกสารร้าน / ใบอนุญาต' },
  { value: 'other', label: 'อื่น ๆ' },
];
export const DOC_CATEGORY_VALUES = DOC_CATEGORIES.map((c) => c.value);

// นามสกุลไฟล์ที่ยอมรับ → mime (ต้องตรงกับ allowed_mime_types ของ bucket)
const EXT_MIME = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
  heic: 'image/heic', heif: 'image/heif', pdf: 'application/pdf',
};
export const DOC_ACCEPT = 'image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf';

/** นามสกุลไฟล์ที่ปลอดภัยจากชื่อไฟล์ — คืน '' ถ้าไม่อยู่ในรายการที่ยอมรับ */
export function docExt(fileName) {
  const m = /\.([a-z0-9]+)$/i.exec(String(fileName || ''));
  const ext = m ? m[1].toLowerCase() : '';
  return EXT_MIME[ext] ? ext : '';
}

/** path ต้องเป็น {หมวด}/{uuid}.{นามสกุลที่ยอมรับ} เท่านั้น — กัน client ส่ง path แปลกมาผูกกับแถว */
export function isValidDocPath(path, category) {
  if (!DOC_CATEGORY_VALUES.includes(category)) return false;
  const m = /^([a-z]+)\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.([a-z0-9]+)$/.exec(String(path || ''));
  return !!m && m[1] === category && !!EXT_MIME[m[2]];
}

/**
 * สถานะวันหมดอายุ เทียบกับ "วันนี้" (YYYY-MM-DD)
 *  none = ไม่มีวันหมด · expired = เลยแล้ว · soon = เหลือไม่เกิน warnDays วัน · ok = ยังอีกนาน
 *  days = จำนวนวันที่เหลือ (ติดลบ = เลยมาแล้วกี่วัน) — วันหมดอายุตรงกับวันนี้ = เหลือ 0 วัน ยังไม่ถือว่าหมด
 */
export function expiryStatus(expiresAt, today, warnDays = 60) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(expiresAt || ''))) return { state: 'none', days: null };
  const days = Math.round((Date.parse(`${expiresAt}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000);
  if (days < 0) return { state: 'expired', days };
  return { state: days <= warnDays ? 'soon' : 'ok', days };
}
