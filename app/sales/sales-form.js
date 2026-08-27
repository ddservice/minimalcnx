'use client';
import Icon from '../../components/icon';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { gpNet, computeNetRevenue } from '../../lib/gp';
import { createClient } from '../../lib/supabase/client';
import DateField from '../../components/date-field';
import NumberInput from '../../components/number-input';
import AccessBanner from '../../components/access-banner';
import { ACCESS_HINT } from '../../lib/perms';
import { saveSalesAction, deleteSalesAction } from './actions';

const EVIDENCE_BUCKET = 'evidence';
const MAX_EVIDENCE_MB = 5;

const fmt = (n) =>
  Number(n || 0).toLocaleString('th-TH', { maximumFractionDigits: 2 });

export default function SalesForm({ date, existing, defaultCoffeePrice = 55, access = {}, canDelete = false }) {
  const canCreate = !!access.create;
  const canEdit = !!access.edit;
  const hasExisting = !!existing;
  const readOnly = !canCreate || (hasExisting && !canEdit);
  const canSave = canCreate && (!hasExisting || canEdit);
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [msg, setMsg] = useState(null); // { text, type }

  // coffee_price ไม่ได้เก็บใน DB — back-compute จาก free_cup_cost/free_cups ถ้ามี, ไม่งั้นใช้ค่าตั้งต้นจากตั้งค่า
  const initPrice =
    existing && existing.free_cups > 0
      ? Math.round((existing.free_cup_cost / existing.free_cups) * 100) / 100
      : defaultCoffeePrice;

  const [f, setF] = useState({
    total_cups: existing?.total_cups ?? '',
    kshop_amount: existing?.kshop_amount ?? '',
    cash_amount: existing?.cash_amount ?? '',
    shopee_before_gp: existing?.shopee_before_gp ?? '',
    grab_before_gp: existing?.grab_before_gp ?? '',
    lineman_before_gp: existing?.lineman_before_gp ?? '',
    pastry_pieces: existing?.pastry_pieces ?? '',
    pastry_revenue: existing?.pastry_revenue ?? '',
    free_cups: existing?.free_cups ?? '',
    coffee_price: initPrice,
  });
  const [evidenceUrl, setEvidenceUrl] = useState(existing?.free_cup_evidence_url || '');
  const [evidenceStatus, setEvidenceStatus] = useState(null); // { text, type }

  const set = (k) => (v) => setF({ ...f, [k]: v });

  // แนบหลักฐานแก้วฟรี (แคปจาก LINE OA / POS) → Supabase Storage bucket 'evidence'
  async function onEvidenceFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > MAX_EVIDENCE_MB * 1024 * 1024) {
      setEvidenceStatus({ text: `ไฟล์ใหญ่เกิน ${MAX_EVIDENCE_MB}MB`, type: 'err' });
      return;
    }
    setEvidenceStatus({ text: 'กำลังอัปโหลด...', type: '' });
    try {
      const supabase = createClient();
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
      const path = `free_cups/${date}_${Date.now()}.${ext}`;
      const { error } = await supabase.storage.from(EVIDENCE_BUCKET).upload(path, file, {
        upsert: true,
        contentType: file.type || undefined,
      });
      if (error) throw error;
      const { data } = supabase.storage.from(EVIDENCE_BUCKET).getPublicUrl(path);
      setEvidenceUrl(data?.publicUrl || '');
      setEvidenceStatus({ text: 'แนบหลักฐานแล้ว ✓ — จะบันทึกลงระบบเมื่อกดบันทึกยอดขาย', type: 'ok' });
    } catch (err) {
      const m = err?.message || String(err);
      const hint = /bucket/i.test(m) ? ' (ยังไม่ได้รัน sql/add_free_cup_actual_cost.sql ใน Supabase)' : '';
      setEvidenceStatus({ text: `อัปโหลดไม่สำเร็จ: ${m}${hint}`, type: 'err' });
    }
  }

  // ── live preview ──
  const shopeeNet = gpNet('shopee', f.shopee_before_gp);
  const grabNet = gpNet('grab', f.grab_before_gp);
  const linemanNet = gpNet('lineman', f.lineman_before_gp);
  const netRevenue = computeNetRevenue(f);
  const freeCupCost =
    Math.round((Number(f.free_cups) || 0) * (Number(f.coffee_price) || 0) * 100) /
    100;

  function onDateChange(d) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) {
      startTransition(() => {
        router.push(`/sales?date=${d}`);
      });
    }
  }

  async function onSubmit(e) {
    e.preventDefault();
    setMsg(null);
    const res = await saveSalesAction({
      date,
      total_cups: f.total_cups,
      kshop_amount: f.kshop_amount,
      cash_amount: f.cash_amount,
      shopee_before_gp: f.shopee_before_gp,
      grab_before_gp: f.grab_before_gp,
      lineman_before_gp: f.lineman_before_gp,
      pastry_pieces: f.pastry_pieces,
      pastry_revenue: f.pastry_revenue,
      free_cups: f.free_cups,
      free_cup_cost: freeCupCost,
      free_cup_evidence_url: evidenceUrl,
    });
    setMsg({ text: res.message, type: res.status === 'ok' ? 'ok' : 'err' });
    if (res.status === 'ok') startTransition(() => router.refresh());
  }

  async function onDelete() {
    if (!window.confirm(`ลบยอดขายวันที่ ${date} ทั้งหมด?`)) return;
    const res = await deleteSalesAction(date);
    setMsg({ text: res.message, type: res.status === 'ok' ? 'ok' : 'err' });
    if (res.status === 'ok') startTransition(() => router.refresh());
  }

  return (
    <form onSubmit={onSubmit}>
      {readOnly && (
        <AccessBanner
          level={access.level || 'view'}
          extra={hasExisting && canCreate && !canEdit ? ACCESS_HINT.create : undefined}
        />
      )}
      {/* วันที่ */}
      <div style={card}>
        <label style={lbl}>วันที่</label>
        <DateField value={date} loading={isPending} onChange={onDateChange} />
        {existing && canEdit && (
          <span style={{ fontSize: 12, color: 'var(--muted)', marginLeft: 8 }}>
            (มีข้อมูลแล้ว — บันทึกจะทับของเดิม)
          </span>
        )}
      </div>

      <fieldset disabled={readOnly} style={{ border: 0, padding: 0, margin: 0, minInlineSize: 0 }}>

      {/* ยอดขายหน้าร้าน */}
      <div style={card}>
        <h2 style={h2}>ยอดขายหน้าร้าน</h2>
        <div style={grid}>
          <Field label="ยอดขายรวม (แก้ว)" value={f.total_cups} onChange={set('total_cups')} />
          <Field label="K-Shop (฿)" value={f.kshop_amount} onChange={set('kshop_amount')} />
          <Field label="เงินสด (฿)" value={f.cash_amount} onChange={set('cash_amount')} />
        </div>
      </div>

      {/* Delivery — หัก GP อัตโนมัติ */}
      <div style={card}>
        <h2 style={h2}>Delivery Platforms <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--muted)' }}>(กรอกยอดก่อนหัก GP)</span></h2>
        <div style={grid}>
          <FieldNet label="Shopee Food" value={f.shopee_before_gp} onChange={set('shopee_before_gp')} net={shopeeNet} />
          <FieldNet label="Grab" value={f.grab_before_gp} onChange={set('grab_before_gp')} net={grabNet} />
          <FieldNet label="Lineman" value={f.lineman_before_gp} onChange={set('lineman_before_gp')} net={linemanNet} />
        </div>
      </div>

      {/* ขนม + แก้วฟรี */}
      <div style={card}>
        <h2 style={h2}>ขนม & แก้วฟรี</h2>
        <div style={grid}>
          <Field label="ขนม (ชิ้น)" value={f.pastry_pieces} onChange={set('pastry_pieces')} />
          <Field label="รายได้ขนม (฿)" value={f.pastry_revenue} onChange={set('pastry_revenue')} />
          <Field label="แก้วฟรี (แก้ว)" value={f.free_cups} onChange={set('free_cups')} />
          <Field label="ต้นทุน/แก้วฟรี (฿)" value={f.coffee_price} onChange={set('coffee_price')} />
        </div>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 8 }}>
          ต้นทุนแก้วฟรีรวม: <strong>{fmt(freeCupCost)} ฿</strong>
        </div>

        {Number(f.free_cups) > 0 && (
          <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px dashed var(--border)' }}>
            <label style={lbl}>แนบหลักฐานแก้วฟรี (แคปจาก LINE OA / POS)</label>
            <input type="file" accept="image/*,.pdf" onChange={onEvidenceFile} style={inp} />
            {evidenceStatus && (
              <div style={{ fontSize: 12, marginTop: 4, color: evidenceStatus.type === 'ok' ? 'var(--success)' : evidenceStatus.type === 'err' ? 'var(--danger)' : 'var(--muted)' }}>
                {evidenceStatus.text}
              </div>
            )}
            {evidenceUrl && (
              <a href={evidenceUrl} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-block', marginTop: 6, fontSize: 12, color: 'var(--taupe-dark)' }}>
                <Icon name="ti-paperclip" /> ดูหลักฐานที่แนบไว้
              </a>
            )}
          </div>
        )}
      </div>

      {/* สรุป */}
      <div style={{ ...card, background: '#f5ede3' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
          <div>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>รายรับสุทธิ (หัก GP แล้ว)</div>
            <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--coffee)' }}>{fmt(netRevenue)} ฿</div>
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>= K-Shop + เงินสด + Delivery(หลัง GP)</div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {existing && canDelete && (
              <button type="button" onClick={onDelete} style={btnDelete} disabled={isPending}>
                ลบวันนี้
              </button>
            )}
            {canSave && (
              <button type="submit" style={btn} disabled={isPending}>
                {isPending ? 'กำลังบันทึก...' : existing ? 'อัปเดตยอดขาย' : 'บันทึกยอดขาย'}
              </button>
            )}
          </div>
        </div>
      </div>
      </fieldset>

      {msg && (
        <div style={{ marginTop: 14, color: msg.type === 'ok' ? '#1e7e34' : '#c0392b', fontSize: 14 }}>
          {msg.text}
        </div>
      )}
    </form>
  );
}

function Field({ label, value, onChange }) {
  return (
    <div>
      <label style={lbl}>{label}</label>
      <NumberInput value={value} onChange={onChange} placeholder="0" style={inp} />
    </div>
  );
}

function FieldNet({ label, value, onChange, net }) {
  const raw = Number(value) || 0;
  return (
    <div>
      <label style={lbl}>{label}</label>
      <NumberInput value={value} onChange={onChange} placeholder="0" style={inp} />
      {raw > 0 && (
        <div style={{ fontSize: 11, color: 'var(--success, #1e7e34)', marginTop: 3 }}>
          หลังหัก GP: {Number(net).toLocaleString('th-TH', { minimumFractionDigits: 2 })} ฿
        </div>
      )}
    </div>
  );
}

const card = {
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-md)',
  padding: 16,
  background: 'var(--surface)',
  marginBottom: 12,
};
const h2 = { marginTop: 0, marginBottom: 12, fontSize: 15 };
const grid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 };
const lbl = { display: 'block', fontSize: 12, color: 'var(--muted)', marginBottom: 4 };
const inp = { width: '100%', padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', fontSize: 14 };
const btn = { border: 0, borderRadius: 'var(--radius-md)', padding: '12px 22px', fontSize: 15, fontWeight: 700, background: 'var(--coffee)', color: '#fff', cursor: 'pointer', alignSelf: 'center' };
const btnDelete = { border: 0, borderRadius: 'var(--radius-md)', padding: '12px 16px', fontSize: 14, fontWeight: 600, background: '#fff0f0', color: 'var(--danger)', cursor: 'pointer' };
