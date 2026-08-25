// สูตรจัดกลุ่มลูกค้า RFM (Recency / Frequency)
//
// ⚠️ ไฟล์นี้เป็นคู่แฝดของ fn_rfm_segment() ใน sql/harden_loyalty_integrity.sql — แก้ที่ไหนต้องแก้อีกที่
// ทำไมต้องมีสองที่: หน้า CDP นับทั้งระบบด้วย SQL (ไม่ดึงลูกค้าทุกแถวมานับใน Node)
// ส่วนป้ายของลูกค้ารายคนคำนวณฝั่ง JS จากแถวที่ดึงมาอยู่แล้ว ไม่ต้องยิง DB เพิ่ม
// มีเทสต์คุมเกณฑ์ทั้งหมดที่ tests/rfm.test.mjs
//
// ทำไมคำนวณสด ไม่อ่านคอลัมน์ customers.rfm_segment: trigger เขียนคอลัมน์นั้นเฉพาะตอน
// "มีธุรกรรมเข้ามา" แต่ลูกค้าที่กำลังจะหลุดคือคนที่ *ไม่มี* ธุรกรรม — คอลัมน์จึงค้างที่ค่าเดิมตลอดไป

export const RFM_SEGMENTS = ['Champions', 'Loyal', 'Potential', 'At-Risk', 'Lost', 'New'];

const DAY_MS = 24 * 60 * 60 * 1000;

export function computeRfmSegment(visitCount, lastVisitedAt, now = new Date()) {
  const visits = Number(visitCount) || 0;
  const last = lastVisitedAt ? new Date(lastVisitedAt) : null;
  if (visits <= 0 || !last || Number.isNaN(last.getTime())) return 'New';

  const days = (now.getTime() - last.getTime()) / DAY_MS;
  if (visits >= 10 && days <= 14) return 'Champions';
  if (visits >= 5 && days <= 30) return 'Loyal';
  if (days > 60) return 'Lost';
  if (days > 30) return 'At-Risk';
  return 'Potential';
}

/** ป้ายที่ควรโชว์ให้ลูกค้ารายนี้ — สดเสมอ ไม่ใช่คอลัมน์ rfm_segment ที่อาจค้าง */
export function customerSegment(customer, now) {
  if (!customer) return 'New';
  return computeRfmSegment(customer.visit_count, customer.last_visited_at, now);
}
