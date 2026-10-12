// ชื่อร้านและตัวตนของการติดตั้ง (instance) — โค้ดชุดเดียวติดตั้งได้หลายร้าน แต่ละร้านมีฐานข้อมูลของตัวเอง
// ค่ามาจาก .deploy.env → build arg → ฝังตอน build (เหมือน NEXT_PUBLIC_SUPABASE_*) ดู deploy/NEW-INSTANCE.md
// ไม่ตั้งค่า = ร้านเดิม (Minimal Maerim) ทุกอย่างทำงานเหมือนก่อนมีไฟล์นี้

export const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME || 'Minimal Maerim';
export const APP_SLUG = process.env.NEXT_PUBLIC_APP_SLUG || 'minimalcnx';

// ค่าตั้งต้นที่ฝังในโค้ด (เงินเดือนกรรมการ 36,000, ค่าเช่า 5,000, พนักงานตั้งต้น 2 คน ฯลฯ) เป็นของร้านเดิมเท่านั้น
// ร้านอื่นต้องไม่ถูกเติมตัวเลขพวกนี้ให้เอง — ไม่งั้นรายงานจะมีรายจ่ายที่ไม่เคยเกิดขึ้น
export const IS_ORIGINAL_SHOP = APP_SLUG === 'minimalcnx';
