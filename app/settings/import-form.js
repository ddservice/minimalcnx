'use client';
import Icon from '../../components/icon';

import { useActionState } from 'react';
import { importData } from './actions';

export default function ImportForm() {
  const [state, action, pending] = useActionState(importData, {});

  return (
    <form action={action} className="card">
      <div className="card-head"><Icon name="ti-file-import" /><h2>นำเข้าข้อมูลจาก Excel</h2></div>
      <div className="card-body">
        <div className="field" style={{ marginBottom: 12 }}>
          <label>ชนิดข้อมูล</label>
          <select name="type" className="input" defaultValue="sales">
            <option value="sales">ยอดขายรายวัน</option>
            <option value="expense">รายจ่าย</option>
          </select>
        </div>
        <div className="field" style={{ marginBottom: 12 }}>
          <label>ไฟล์ .xlsx</label>
          <input name="file" type="file" accept=".xlsx" className="input" required />
        </div>
        <button className="btn btn-coffee" type="submit" disabled={pending}>
          <Icon name="ti-upload" /> {pending ? 'กำลังนำเข้า...' : 'นำเข้า'}
        </button>
        {state?.message && (
          <div style={{ marginTop: 12, fontSize: 'var(--fs-md)', color: state.status === 'ok' ? 'var(--success)' : 'var(--danger)' }}>{state.message}</div>
        )}
        <p className="muted" style={{ fontSize: 'var(--fs-sm)', marginTop: 12 }}>
          รองรับคอลัมน์ภาษาไทยแบบเดียวกับไฟล์ที่ Export · ยอดขายจะทับตามวันที่ · รายจ่ายเพิ่มเป็นรายการใหม่ · วันที่รองรับทั้ง ค.ศ./พ.ศ.
        </p>
      </div>
    </form>
  );
}
