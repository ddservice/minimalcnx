'use client';
import Icon from './icon';

import { useRef } from 'react';

// ช่องวันที่/เดือนที่หน้าตาคุมได้ 100% (ไม่มีเส้น/ขอบ native ของ iOS โผล่มาให้เห็น) แต่ยังใช้
// native <input type="date"|"month"> จริงซ้อนอยู่ข้างใต้แบบโปร่งใส (opacity:0, เต็มพื้นที่) เพื่อให้
// เก็บ/แก้ค่าและรองรับคีย์บอร์ด+accessibility ตามปกติ — ส่วนที่มองเห็นเป็นแค่ <span> ที่จัดสไตล์เอง
//
// ⚠️ บนคอม (desktop Chrome/Edge/Firefox) การคลิกจะเปิดปฏิทินก็ต่อเมื่อคลิกโดนไอคอนปฏิทินเล็กๆ
// ของ native input เท่านั้น (พิมพ์ในช่องข้อความจะแค่โฟกัส ไม่เปิดปฏิทิน) ต่างจาก iOS ที่แตะที่ไหนก็เปิด
// เพราะ overlay โปร่งใสซ่อนไอคอนนั้นไปพร้อมกับซ่อนทุกอย่าง ผู้ใช้เลยหาตำแหน่งคลิกที่ถูกต้องไม่เจอ (ใช้งาน
// ไม่ได้บนคอมทั้งที่มือถือปกติดี) — เรียก showPicker() เองตอนคลิกที่ไหนก็ได้ในกล่อง แก้ปัญหานี้ตรงจุด
export default function DateField({ value, onChange, type = 'date', min, max, disabled, loading = false, placeholder = 'เลือก' }) {
  const ref = useRef(null);
  const display = formatValue(value, type);

  const openPicker = () => {
    if (disabled || loading) return;
    try { ref.current?.showPicker?.(); } catch {}
  };

  return (
    <div className={`date-field${disabled ? ' disabled' : ''}${loading ? ' loading' : ''}`} onClick={openPicker}>
      <span className="date-field-display">
        <Icon name={loading ? 'ti-loader-2' : 'ti-calendar-event'} className={loading ? 'spin' : ''} />
        {display || <span className="muted">{placeholder}</span>}
      </span>
      <input
        ref={ref}
        className="date-field-input"
        type={type}
        value={value || ''}
        min={min}
        max={max}
        disabled={disabled || loading}
        onChange={(e) => onChange(e.target.value)}
        aria-label={placeholder}
      />
    </div>
  );
}

function formatValue(value, type) {
  if (!value) return '';
  if (type === 'month') {
    const [y, m] = value.split('-').map(Number);
    if (!y || !m) return '';
    return new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  }
  const [y, m, d] = value.split('-').map(Number);
  if (!y || !m || !d) return '';
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}
