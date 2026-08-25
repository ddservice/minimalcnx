'use client';
import Icon from '../../components/icon';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { digitsOnly } from '../../lib/format';
import NumberInput from '../../components/number-input';
import { saveBizInfo } from './actions';
import AccessBanner from '../../components/access-banner';

export default function SettingsForm({ biz, canEdit = true }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [msg, setMsg] = useState(null);
  const [f, setF] = useState({
    name: biz.name || '',
    phone: biz.phone || '',
    tax_id: biz.tax_id || '',
    address: biz.address || '',
    logo_url: biz.logo_url || '',
    free_cup_cost: biz.free_cup_cost ?? '55',
  });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  async function onSubmit(e) {
    e.preventDefault();
    setMsg(null);
    const res = await saveBizInfo(f);
    setMsg({ text: res.message, type: res.status === 'ok' ? 'ok' : 'err' });
    if (res.status === 'ok') startTransition(() => router.refresh());
  }

  return (
    <form onSubmit={onSubmit} className="card">
      <div className="card-head"><Icon name="ti-building" /><h2>ข้อมูลบริษัท / ร้านค้า</h2></div>
      <div className="card-body">
        {!canEdit && <AccessBanner level="view" />}
        <p className="muted" style={{ fontSize: 12, marginTop: -4, marginBottom: 14 }}>
          ใช้ในหัวเอกสารสลิปเงินเดือนและรายงาน
        </p>
        <fieldset disabled={!canEdit} style={{ border: 0, padding: 0, margin: 0, minInlineSize: 0 }}>
        <div style={{ display: 'grid', gap: 12 }}>
          <div className="field"><label>ชื่อบริษัท / ร้านค้า</label><input className="input" value={f.name} onChange={set('name')} placeholder="เช่น ห้างหุ้นส่วนจำกัด มินิมอลคอฟฟี่" /></div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
            <div className="field"><label>เบอร์โทรศัพท์</label><input className="input" value={f.phone} onChange={set('phone')} placeholder="0xx-xxx-xxxx" /></div>
            <div className="field"><label>เลขผู้เสียภาษี (13 หลัก)</label><input className="input" inputMode="numeric" value={f.tax_id} onChange={(e) => setF({ ...f, tax_id: digitsOnly(e.target.value) })} maxLength={13} placeholder="0000000000000" /></div>
          </div>
          <div className="field"><label>ที่อยู่</label><input className="input" value={f.address} onChange={set('address')} placeholder="ที่อยู่เต็ม" /></div>
          <div className="field"><label>URL โลโก้ (ลิงก์รูปภาพ)</label><input className="input" value={f.logo_url} onChange={set('logo_url')} placeholder="https://..." /></div>
          <div className="field"><label>ต้นทุนแก้วฟรี/แก้ว (บาท) — ค่าตั้งต้นหน้ายอดขาย</label><NumberInput className="input" value={f.free_cup_cost} onChange={(v) => setF({ ...f, free_cup_cost: v })} placeholder="55" /></div>
        </div>

        {canEdit && (
        <button className="btn btn-coffee" type="submit" disabled={isPending} style={{ marginTop: 16 }}>
          <Icon name="ti-device-floppy" /> {isPending ? 'กำลังบันทึก...' : 'บันทึก'}
        </button>
        )}
        {msg && (
          <div style={{ marginTop: 12, fontSize: 14, color: msg.type === 'ok' ? 'var(--success)' : 'var(--danger)' }}>{msg.text}</div>
        )}
        </fieldset>
      </div>
    </form>
  );
}
