// นโยบายอายุข้อมูล audit_log — แชร์กันระหว่าง Server Action กับ UI
// แยกออกมาจาก app/admin/audit/actions.js เพราะไฟล์ 'use server' export ได้แต่ async function
// (แบบเดียวกับ lib/auth-policy.js ที่เก็บ MIN_PASSWORD_LENGTH)

/**
 * เก็บย้อนหลังต่ำสุดกี่วัน — ต้องตรงกับด่านใน sql/maintenance_audit_log.sql
 * ฝั่ง SQL คือด่านจริง ค่านี้มีไว้ให้ผู้ใช้เห็นข้อความไทยแทน error ดิบจาก Postgres
 */
export const MIN_RETENTION_DAYS = 90;

/** ตัวเลือกในหน้าจอ — 1 ปีเป็นค่าเริ่มต้นตามแนวทาง PDPA */
export const RETENTION_CHOICES = [365, 730, 1095];

export const RETENTION_LABEL = {
  365: '365 วัน (1 ปี)',
  730: '730 วัน (2 ปี)',
  1095: '1095 วัน (3 ปี)',
};
