'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Icon from '../../../components/icon';
import DateField from '../../../components/date-field';
import { createClient } from '../../../lib/supabase/client';
import { DOC_BUCKET, DOC_CATEGORIES, DOC_ACCEPT, MAX_DOC_MB, docExt, expiryStatus } from '../../../lib/documents';
import { createDocumentAction, getDocumentUrlAction, deleteDocumentAction } from './actions';

const CAT_LABEL = Object.fromEntries(DOC_CATEGORIES.map((c) => [c.value, c.label]));
const thaiDate = (iso) => (iso ? new Date(`${iso}T00:00:00`).toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' }) : '');
const fmtSize = (b) => (b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round((b || 0) / 1024))} KB`);
const emptyForm = (category = 'landlord') => ({ category, title: '', owner_label: '', doc_date: '', expires_at: '', note: '' });

export default function DocumentsClient({ docs, today }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [form, setForm] = useState(emptyForm());
  const [file, setFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const fileRef = useRef(null);
  const [msg, setMsg] = useState(null);
  const [filter, setFilter] = useState('');
  const [busyId, setBusyId] = useState(null);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const shown = filter ? docs.filter((d) => d.category === filter) : docs;
  const alerts = docs
    .map((d) => ({ d, ex: expiryStatus(d.expires_at, today) }))
    .filter((x) => x.ex.state === 'expired' || x.ex.state === 'soon');

  async function onSubmit(e) {
    e.preventDefault();
    if (savingRef.current) return;
    setMsg(null);
    if (!form.title.trim()) { setMsg({ text: 'กรุณาระบุชื่อเอกสาร', type: 'err' }); return; }
    if (!file) { setMsg({ text: 'กรุณาเลือกไฟล์', type: 'err' }); return; }
    const ext = docExt(file.name);
    if (!ext) { setMsg({ text: 'รับเฉพาะไฟล์รูป (JPG / PNG / WEBP / HEIC) หรือ PDF', type: 'err' }); return; }
    if (file.size > MAX_DOC_MB * 1024 * 1024) { setMsg({ text: `ไฟล์ใหญ่เกิน ${MAX_DOC_MB}MB`, type: 'err' }); return; }

    savingRef.current = true;
    setSaving(true);
    const supabase = createClient();
    const path = `${form.category}/${crypto.randomUUID()}.${ext}`;
    try {
      const { error: upErr } = await supabase.storage.from(DOC_BUCKET).upload(path, file, { contentType: file.type || undefined, upsert: false });
      if (upErr) {
        const hint = /bucket/i.test(upErr.message || '') ? ' (ยังไม่ได้รัน sql/add_documents.sql)' : '';
        setMsg({ text: `อัปโหลดไม่สำเร็จ: ${upErr.message}${hint}`, type: 'err' });
        return;
      }
      const res = await createDocumentAction({
        ...form, storage_path: path, file_name: file.name, mime_type: file.type, size_bytes: file.size,
      });
      if (res.status !== 'ok') {
        // แถวไม่ถูกบันทึก → ลบไฟล์ที่เพิ่งอัปทิ้ง ไม่ให้มีไฟล์ค้างที่ไม่มีอะไรชี้ถึง
        await supabase.storage.from(DOC_BUCKET).remove([path]);
        setMsg({ text: res.message, type: 'err' });
        return;
      }
      setMsg({ text: res.message, type: 'ok' });
      setForm(emptyForm(form.category));
      setFile(null);
      if (fileRef.current) fileRef.current.value = '';
      startTransition(() => router.refresh());
    } catch {
      setMsg({ text: 'เก็บเอกสารไม่สำเร็จ — เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ลองใหม่อีกครั้ง', type: 'err' });
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  async function onOpen(d) {
    // เปิดหน้าต่างก่อนแล้วค่อยขอลิงก์ — ถ้า await ก่อน เบราว์เซอร์จะบล็อกป๊อปอัป
    const w = window.open('', '_blank');
    setBusyId(d.id);
    try {
      const res = await getDocumentUrlAction(d.id);
      if (res.status === 'ok') {
        if (w) w.location.href = res.url; else window.location.href = res.url;
      } else {
        if (w) w.close();
        setMsg({ text: res.message, type: 'err' });
      }
    } catch {
      if (w) w.close();
      setMsg({ text: 'เปิดไฟล์ไม่สำเร็จ — ลองใหม่อีกครั้ง', type: 'err' });
    } finally {
      setBusyId(null);
    }
  }

  async function onDelete(d) {
    if (!window.confirm(`ลบเอกสาร "${d.title}" ถาวร? ไฟล์จะถูกลบออกจากระบบและกู้คืนจากหน้านี้ไม่ได้`)) return;
    setBusyId(d.id);
    try {
      const res = await deleteDocumentAction(d.id);
      setMsg({ text: res.message, type: res.status === 'ok' ? 'ok' : 'err' });
      if (res.status === 'ok') startTransition(() => router.refresh());
    } catch {
      setMsg({ text: 'ลบไม่สำเร็จ — ลองใหม่อีกครั้ง', type: 'err' });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <p className="muted" style={{ fontSize: 'var(--fs-sm)', marginTop: -6, marginBottom: 14 }}>
        <Icon name="ti-lock" /> เห็นได้เฉพาะ Admin และ Co-Admin · ไฟล์เก็บแบบปิด เปิดดูผ่านลิงก์ชั่วคราว 2 นาที · ทุกครั้งที่เปิดดูถูกบันทึกในประวัติการใช้งาน
      </p>

      {alerts.length > 0 && (
        <div className="card" style={{ borderColor: 'var(--color-accent)' }}>
          <div className="card-body" style={{ display: 'grid', gap: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600 }}>
              <Icon name="ti-alert-triangle" /> เอกสารที่หมดอายุหรือใกล้หมดอายุ {alerts.length} รายการ
            </div>
            {alerts.map(({ d, ex }) => (
              <div key={d.id} style={{ fontSize: 'var(--fs-base)' }}>
                {d.title}{d.owner_label ? ` — ${d.owner_label}` : ''} · <ExpiryText ex={ex} date={d.expires_at} />
              </div>
            ))}
          </div>
        </div>
      )}

      <form onSubmit={onSubmit} className="card">
        <div className="card-head"><Icon name="ti-upload" /><h2>เก็บเอกสารใหม่</h2></div>
        <div className="card-body">
          <div style={grid}>
            <div>
              <label style={lbl}>หมวด</label>
              <select className="input" value={form.category} onChange={(e) => set('category', e.target.value)}>
                {DOC_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>
            <div>
              <label style={lbl}>ชื่อเอกสาร *</label>
              <input className="input" value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="เช่น สัญญาเช่าร้าน ปี 2569" maxLength={200} />
            </div>
            <div>
              <label style={lbl}>ของใคร / เรื่องอะไร</label>
              <input className="input" value={form.owner_label} onChange={(e) => set('owner_label', e.target.value)} placeholder="เช่น ชื่อพนักงาน, ภ.ง.ด.3 ก.ย. 69" maxLength={200} />
            </div>
            <div>
              <label style={lbl}>วันที่บนเอกสาร</label>
              <DateField value={form.doc_date} onChange={(v) => set('doc_date', v)} placeholder="ไม่ระบุ" />
            </div>
            <div>
              <label style={lbl}>วันหมดอายุ (ถ้ามี)</label>
              <DateField value={form.expires_at} onChange={(v) => set('expires_at', v)} placeholder="ไม่มีวันหมดอายุ" />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={lbl}>หมายเหตุ</label>
              <input className="input" value={form.note} onChange={(e) => set('note', e.target.value)} maxLength={1000} />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={lbl}>ไฟล์ * (รูปหรือ PDF ไม่เกิน {MAX_DOC_MB}MB)</label>
              <input ref={fileRef} className="input" type="file" accept={DOC_ACCEPT} onChange={(e) => setFile(e.target.files?.[0] || null)} />
            </div>
          </div>
          <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <button type="submit" className="btn btn-coffee" disabled={saving || isPending}>
              <Icon name="ti-upload" /> {saving ? 'กำลังอัปโหลด...' : 'เก็บเอกสาร'}
            </button>
            {msg && <span style={{ fontSize: 'var(--fs-md)', color: msg.type === 'ok' ? 'var(--success)' : 'var(--danger)' }}>{msg.text}</span>}
          </div>
        </div>
      </form>

      <div className="card">
        <div className="card-head"><Icon name="ti-file-invoice" /><h2>เอกสารที่เก็บไว้ ({shown.length})</h2></div>
        <div className="card-body">
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
            <button type="button" className={`btn ${!filter ? 'btn-coffee' : 'btn-ghost'}`} style={pill} onClick={() => setFilter('')}>ทั้งหมด</button>
            {DOC_CATEGORIES.map((c) => (
              <button key={c.value} type="button" className={`btn ${filter === c.value ? 'btn-coffee' : 'btn-ghost'}`} style={pill} onClick={() => setFilter(c.value)}>
                {c.label}
              </button>
            ))}
          </div>

          {!shown.length ? (
            <p className="muted" style={{ fontSize: 'var(--fs-base)', margin: 0 }}>ยังไม่มีเอกสารในหมวดนี้</p>
          ) : (
            <div style={{ display: 'grid', gap: 8 }}>
              {shown.map((d) => {
                const ex = expiryStatus(d.expires_at, today);
                return (
                  <div key={d.id} style={rowBox}>
                    <div style={{ flex: '1 1 240px', minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        <span style={{ fontWeight: 600, fontSize: 'var(--fs-md)' }}>{d.title}</span>
                        <span style={badge}>{CAT_LABEL[d.category] || d.category}</span>
                      </div>
                      <div className="muted" style={{ fontSize: 'var(--fs-sm)' }}>
                        {[d.owner_label, d.doc_date && `ลงวันที่ ${thaiDate(d.doc_date)}`, fmtSize(d.size_bytes), `เก็บเมื่อ ${thaiDate(String(d.created_at).slice(0, 10))}`].filter(Boolean).join(' · ')}
                      </div>
                      {d.note && <div className="muted" style={{ fontSize: 'var(--fs-sm)' }}>{d.note}</div>}
                      {ex.state !== 'none' && (
                        <div style={{ fontSize: 'var(--fs-sm)', marginTop: 2 }}><ExpiryText ex={ex} date={d.expires_at} /></div>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button type="button" className="btn btn-ghost" style={pill} disabled={busyId === d.id} onClick={() => onOpen(d)}>เปิดดู</button>
                      <button type="button" className="btn btn-ghost" style={{ ...pill, color: 'var(--danger)' }} disabled={busyId === d.id} onClick={() => onDelete(d)}>
                        <Icon name="ti-trash" /> ลบ
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function ExpiryText({ ex, date }) {
  const d = thaiDate(date);
  if (ex.state === 'expired') return <strong style={{ color: 'var(--danger)' }}>หมดอายุแล้ว {Math.abs(ex.days)} วัน ({d})</strong>;
  if (ex.state === 'soon') return <strong style={{ color: 'var(--danger)' }}>{ex.days === 0 ? 'หมดอายุวันนี้' : `เหลืออีก ${ex.days} วัน`} ({d})</strong>;
  return <span className="muted">หมดอายุ {d}</span>;
}

const grid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 };
const lbl = { display: 'block', fontSize: 'var(--fs-sm)', color: 'var(--muted)', marginBottom: 4 };
const pill = { padding: '5px 12px', fontSize: 'var(--fs-sm)', borderRadius: 'var(--radius-full)' };
const rowBox = { display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '10px 12px' };
const badge = { fontSize: 'var(--fs-xs)', color: 'var(--coffee)', background: 'var(--beige)', borderRadius: 'var(--radius-full)', padding: '2px 8px', fontWeight: 600 };
