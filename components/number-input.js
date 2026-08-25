'use client';
import { useState } from 'react';
import { sanitizeNumberString, groupNumberString } from '../lib/format';

// ช่องกรอกตัวเลข/จำนวนเงินมาตรฐานของทั้งแอป
//
// ทำไมไม่ใช้ type="number": ปุ่มลูกศรเพิ่ม/ลด (spinner) กดพลาดได้ง่าย และที่แย่กว่าคือ
// เลื่อนลูกกลิ้งเมาส์ทับช่องขณะ focus แล้วค่าเปลี่ยนเงียบๆ โดยผู้ใช้ไม่รู้ตัว (ยอดเงินเพี้ยน)
// type="text" + inputMode จึงตัดปัญหานี้ทั้งหมด แต่มือถือยังเด้งแป้นตัวเลขให้เหมือนเดิม
//
// พฤติกรรมช่วยคีย์ข้อมูล (ค่าใน state เป็นเลขล้วนเสมอ — จุลภาคเป็นแค่การ "แสดงผล"):
//  - ตอนไม่ได้โฟกัส แสดงจุลภาคคั่นหลักพัน (12,000) อ่านยอดหลักหมื่น-แสนง่ายขึ้น
//  - ตอนโฟกัส กลับเป็นเลขล้วน (12000) แล้วเลือกทั้งช่องให้ พิมพ์ทับได้เลยไม่ต้องลบทีละตัว
//  - ชิดขวาโดยดีฟอลต์ ตัวเลขเรียงหลักตรงกันทั้งคอลัมน์ ตรวจทานง่าย
export default function NumberInput({
  value,
  onChange,
  mode = 'decimal',
  align = 'right',
  selectOnFocus = true,
  style,
  onFocus,
  onBlur,
  ...rest
}) {
  const [editing, setEditing] = useState(false);
  const shown = editing ? String(value ?? '') : groupNumberString(value);

  return (
    <input
      {...rest}
      type="text"
      inputMode={mode}
      autoComplete="off"
      value={shown}
      style={{ textAlign: align, ...style }}
      onChange={(e) => onChange(sanitizeNumberString(e.target.value))}
      onFocus={(e) => {
        const el = e.target;
        setEditing(true);
        // รอให้ React วาดค่าดิบ (ไม่มีจุลภาค) ก่อน ไม่งั้น select() ไปโดนสตริงที่กำลังจะถูกแทนที่
        if (selectOnFocus) requestAnimationFrame(() => { try { el.select(); } catch { /* ไม่เป็นไร */ } });
        onFocus?.(e);
      }}
      onBlur={(e) => {
        setEditing(false);
        onBlur?.(e);
      }}
    />
  );
}
