'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import NumberInput from '../../components/number-input';
import DateField from '../../components/date-field';
import { saveReconciliationAction } from './reconciliation-actions';

export function useReconciliationCommand() {
  const router = useRouter();
  const lock = useRef(false);
  const retry = useRef(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  async function send(command, data) {
    if (lock.current) return null;
    lock.current = true; setBusy(true); setMessage(null);
    const signature = JSON.stringify({ command, data });
    if (retry.current?.signature !== signature) retry.current = { signature, id: crypto.randomUUID() };
    try {
      const result = await saveReconciliationAction(command, data, retry.current.id);
      setMessage(result);
      if (result.status === 'ok') { retry.current = null; router.refresh(); return result.result; }
      return null;
    } catch {
      setMessage({ status: 'error', message: 'การเชื่อมต่อขัดข้อง ข้อมูลที่กรอกยังอยู่ กดลองใหม่เพื่อยืนยันคำขอเดิม' });
      return null;
    } finally { lock.current = false; setBusy(false); }
  }
  return { busy, message, send };
}
export function MoneyField({ label, value, onChange, required = false }) {
  return <label className="recon-field"><span>{label} (บาท){required ? ' *' : ''}</span>
    <NumberInput value={value} onChange={onChange} required={required} placeholder={required ? 'กรอกยอด' : '0.00'} />
  </label>;
}
export function DayField({ label, value, onChange, max }) {
  return <div className="recon-field"><span>{label}</span>
    <DateField value={value} onChange={onChange} max={max} placeholder={label} /></div>;
}
export function Message({ message }) {
  return message ? <p role={message.status === 'error' ? 'alert' : 'status'}
    className={`recon-message ${message.status === 'error' ? 'recon-danger' : 'recon-success'}`}>{message.message}</p> : null;
}
export function VoidForm({ title, onSubmit, busy }) {
  const [reason, setReason] = useState('');
  return <details className="recon-void"><summary>{title}</summary>
    <form onSubmit={(e) => { e.preventDefault(); onSubmit(reason); }}>
      <label className="recon-field">เหตุผลยกเลิก *<input value={reason} maxLength={1000} required
        onChange={(e) => setReason(e.target.value)} /></label>
      <button type="submit" className="recon-button" disabled={busy}>ยืนยันยกเลิกและเก็บประวัติ</button>
    </form></details>;
}
