'use client';

import { useState, useTransition } from 'react';
import Icon from '../../../components/icon';
import { purgeAuditLogsAction } from './actions';
import { RETENTION_CHOICES, RETENTION_LABEL } from '../../../lib/audit-policy';

export default function AuditPurge() {
  const [days, setDays] = useState(RETENTION_CHOICES[0]);
  const [msg, setMsg] = useState(null);
  const [pending, start] = useTransition();

  function run() {
    // ยืนยันสองชั้นเหมือนเครื่องมือลบข้อมูลใน /settings — ลบ audit ย้อนกลับไม่ได้
    // และมันคือหลักฐานว่าใครทำอะไร ไม่ใช่ข้อมูลที่กรอกใหม่ได้
    if (!window.confirm(`ลบบันทึกที่เก่ากว่า ${days} วันทิ้งถาวร ย้อนกลับไม่ได้ — ยืนยันหรือไม่?`)) return;
    if (!window.confirm('ยืนยันอีกครั้ง: การลบประวัติการใช้งานจะทำให้ไล่ย้อนเหตุการณ์ช่วงนั้นไม่ได้อีก')) return;

    start(async () => {
      const res = await purgeAuditLogsAction(days);
      setMsg(res);
    });
  }

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="card-body" style={{ display: 'grid', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600 }}>
          <Icon name="ti-trash" /> ล้างบันทึกเก่า
        </div>
        <p className="muted" style={{ fontSize: 'var(--fs-sm)', margin: 0 }}>
          กันไม่ให้ตารางโตไม่มีที่สิ้นสุด และสอดคล้องกับหลัก PDPA ที่ไม่เก็บข้อมูลนานเกินจำเป็น
          เก็บย้อนหลังได้ต่ำสุด 90 วัน (ฝั่งฐานข้อมูลบังคับไว้อีกชั้น)
          การล้างแต่ละครั้งจะถูกบันทึกไว้ในประวัติการใช้งานเองด้วย
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <label className="muted" style={{ fontSize: 'var(--fs-sm)' }} htmlFor="retention">เก็บย้อนหลัง</label>
          <select
            id="retention"
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            disabled={pending}
            style={{ minWidth: 140 }}
          >
            {RETENTION_CHOICES.map((d) => (
              <option key={d} value={d}>{RETENTION_LABEL[d] || `${d} วัน`}</option>
            ))}
          </select>
          <button type="button" className="btn btn-danger" onClick={run} disabled={pending}>
            {pending ? 'กำลังล้าง...' : 'ล้างบันทึกที่เก่ากว่านี้'}
          </button>
        </div>
        {msg && (
          <div
            style={{
              fontSize: 'var(--fs-base)',
              color: msg.status === 'ok' ? 'var(--success)' : 'var(--danger)',
            }}
          >
            {msg.message}
          </div>
        )}
      </div>
    </div>
  );
}
