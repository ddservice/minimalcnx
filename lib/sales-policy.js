export function bangkokToday(now = new Date()) {
  return new Date(now.getTime() + 7 * 3600000).toISOString().slice(0, 10);
}

export function validBusinessDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false;
  const date = new Date(value + 'T00:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function salesDateError(role, date, now = new Date()) {
  if (!validBusinessDate(date)) return 'วันที่ไม่ถูกต้อง';
  if (role === 'staff' && date !== bangkokToday(now)) {
    return 'พนักงานบันทึกยอดขายได้เฉพาะวันนี้ตามเวลาไทย กรุณาเปิดหน้าวันนี้ใหม่';
  }
  return null;
}
