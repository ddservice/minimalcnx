'use client';
import Icon from '../../components/icon';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import DateField from '../../components/date-field';
import { deleteMonthAction, dedupMonthAction } from './actions';

function curMonth() {
  const d = new Date(Date.now() + 7 * 60 * 60 * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export default function DataTools() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [month, setMonth] = useState(curMonth());
  const [scope, setScope] = useState('all');
  const [msg, setMsg] = useState(null);

  const flash = (res) => {
    setMsg({ text: res.message, type: res.status === 'ok' ? 'ok' : 'err' });
    if (res.status === 'ok') startTransition(() => router.refresh());
  };

  async function onDelete() {
    const label = { all: 'ทั้งหมด (ขาย+จ่าย)', sales: 'ยอดขาย', expense: 'รายจ่าย' }[scope];
    if (!window.confirm(`ลบข้อมูล "${label}" ของเดือน ${month} ?\n\n⚠️ ลบถาวร ย้อนกลับไม่ได้`)) return;
    if (!window.confirm('ยืนยันอีกครั้ง — ลบข้อมูลเดือนนี้จริงหรือไม่?')) return;
    flash(await deleteMonthAction({ month, scope }));
  }
  async function onDedup() {
    if (!window.confirm(`ลบรายจ่ายที่ซ้ำกันในเดือน ${month} ?`)) return;
    flash(await dedupMonthAction({ month }));
  }

  return (
    <div className="card" style={{ borderColor: 'var(--danger)' }}>
      <div className="card-head" style={{ background: '#fbece6' }}>
        <Icon name="ti-alert-triangle" style={{ color: 'var(--danger)' }} />
        <h2 style={{ color: 'var(--danger)' }}>เครื่องมือลบข้อมูล (Admin)</h2>
      </div>
      <div className="card-body">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 12 }}>
          <div className="field"><label>เดือน</label><DateField type="month" value={month} onChange={setMonth} /></div>
          <div className="field"><label>ขอบเขต</label>
            <select className="input" value={scope} onChange={(e) => setScope(e.target.value)}>
              <option value="all">ทั้งหมด (ขาย + จ่าย)</option>
              <option value="sales">เฉพาะยอดขาย</option>
              <option value="expense">เฉพาะรายจ่าย</option>
            </select>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-danger" type="button" onClick={onDelete} disabled={isPending}><Icon name="ti-trash" /> ลบข้อมูลทั้งเดือน</button>
          <button className="btn btn-ghost" type="button" onClick={onDedup} disabled={isPending}><Icon name="ti-copy-off" /> ลบรายจ่ายซ้ำ</button>
        </div>
        {msg && <div style={{ marginTop: 12, fontSize: 'var(--fs-md)', color: msg.type === 'ok' ? 'var(--success)' : 'var(--danger)' }}>{msg.text}</div>}
        <p className="muted" style={{ fontSize: 'var(--fs-sm)', marginTop: 10 }}>⚠️ การลบเป็นการลบถาวรจาก database ตรวจเดือนให้ถูกก่อนกดยืนยัน</p>
      </div>
    </div>
  );
}
