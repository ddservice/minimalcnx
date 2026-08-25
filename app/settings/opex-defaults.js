'use client';
import Icon from '../../components/icon';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { OPEX_OPERATING, OPEX_STAFF } from '../../lib/opex';
import NumberInput from '../../components/number-input';
import { saveOpexDefaults } from './actions';

const ITEMS = [...OPEX_OPERATING.items, ...OPEX_STAFF.fixed];

export default function OpexDefaults({ defaults }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [msg, setMsg] = useState(null);
  const [f, setF] = useState(() => {
    const o = {};
    ITEMS.forEach((it) => { o[it.key] = defaults?.[it.key] != null ? String(defaults[it.key]) : (it.def != null ? String(it.def) : ''); });
    return o;
  });

  async function onSave() {
    setMsg(null);
    const res = await saveOpexDefaults(f);
    setMsg({ text: res.message, type: res.status === 'ok' ? 'ok' : 'err' });
    if (res.status === 'ok') startTransition(() => router.refresh());
  }

  return (
    <div className="card">
      <div className="card-head"><Icon name="ti-adjustments" /><h2>ค่าตั้งต้นค่าดำเนินการ (รายเดือน)</h2></div>
      <div className="card-body">
        <p className="muted" style={{ fontSize: 12, marginTop: -4, marginBottom: 12 }}>
          ค่าที่เติมให้อัตโนมัติในหน้าค่าดำเนินการ (เช่น ค่าเช่า เงินเดือนกรรมการ)
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
          {ITEMS.map((it) => (
            <div className="field" key={it.key}>
              <label>{it.label}</label>
              <NumberInput className="input" value={f[it.key]}
                onChange={(v) => setF({ ...f, [it.key]: v })} placeholder="0" />
            </div>
          ))}
        </div>
        <button className="btn btn-coffee" type="button" onClick={onSave} disabled={isPending} style={{ marginTop: 14 }}>
          <Icon name="ti-device-floppy" /> {isPending ? 'กำลังบันทึก...' : 'บันทึกค่าตั้งต้น'}
        </button>
        {msg && <div style={{ marginTop: 12, fontSize: 14, color: msg.type === 'ok' ? 'var(--success)' : 'var(--danger)' }}>{msg.text}</div>}
      </div>
    </div>
  );
}
