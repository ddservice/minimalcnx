'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '../../lib/supabase/client';
import { DOC_BUCKET, DOC_ACCEPT, MAX_DOC_MB, docExt } from '../../lib/documents';
import { createDocumentAction, getDocumentUrlAction } from '../admin/documents/actions';

export default function ExpenseDocuments({ expense, docs = [], available }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const busyRef = useRef(false);
  const fileRef = useRef(null);
  const router = useRouter();
  async function upload(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || busyRef.current) return;
    const ext = docExt(file.name);
    if (!ext || file.size <= 0 || file.size > MAX_DOC_MB * 1024 * 1024) {
      setMessage('รับเฉพาะรูปหรือ PDF ขนาดไม่เกิน ' + MAX_DOC_MB + 'MB'); return;
    }
    busyRef.current = true; setBusy(true); setMessage('');
    const supabase = createClient();
    const path = 'other/' + crypto.randomUUID() + '.' + ext;
    try {
      const { error } = await supabase.storage.from(DOC_BUCKET).upload(path, file, { upsert: false, contentType: file.type || undefined });
      if (error) throw error;
      const res = await createDocumentAction({ category: 'other', title: 'ใบเสร็จ: ' + expense.item_name,
        expense_id: expense.id, storage_path: path, file_name: file.name,
        mime_type: file.type, size_bytes: file.size });
      if (res.status !== 'ok') {
        await supabase.storage.from(DOC_BUCKET).remove([path]);
        setMessage(res.message); return;
      }
      setMessage('แนบใบเสร็จแล้ว'); router.refresh();
    } catch { setMessage('แนบไฟล์ไม่สำเร็จ กรุณาตรวจรายการเอกสารก่อนลองใหม่'); }
    finally { busyRef.current = false; setBusy(false); }
  }
  async function open(doc) {
    const w = window.open('', '_blank');
    setBusy(true);
    try {
      const res = await getDocumentUrlAction(doc.id);
      if (res.status === 'ok') {
        if (w) w.location.href = res.url; else window.location.href = res.url;
      } else { w?.close(); setMessage(res.message); }
    } catch { w?.close(); setMessage('เปิดใบเสร็จไม่สำเร็จ กรุณาลองใหม่'); }
    finally { setBusy(false); }
  }
  return <div style={{ flexBasis: '100%', fontSize: 'var(--fs-sm)' }}>
    {docs.map(d => <button key={d.id} type="button" className="btn btn-ghost" disabled={busy} onClick={() => open(d)}>{d.file_name || d.title}</button>)}
    {available ? <>
      <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => fileRef.current?.click()}>
        {busy ? 'กำลังดำเนินการ...' : 'แนบใบเสร็จ / ใบกำกับภาษี'}
      </button>
      <input ref={fileRef} type="file" accept={DOC_ACCEPT} disabled={busy} onChange={upload} style={{ display: 'none' }} />
    </> : <span className="muted">ยังแนบใบเสร็จไม่ได้ กรุณาให้ผู้ดูแลอัปเดตฐานข้อมูล</span>}
    {message && <p role="status">{message}</p>}
  </div>;
}
