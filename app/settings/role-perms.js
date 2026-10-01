'use client';
import Icon from '../../components/icon';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  NAV_TABS,
  MANAGED_ROLES,
  PAGE_LEVELS,
  ACCESS_LABEL,
  ACCESS_HINT,
  parseStoredLevel,
  recommendedPerms,
  isLoyaltyOnlyRole,
} from '../../lib/perms';
import { saveRolePerms } from './actions';

export default function RolePerms({ perms }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [msg, setMsg] = useState(null);
  const [state, setState] = useState(() => {
    const s = {};
    MANAGED_ROLES.forEach((r) => {
      s[r.value] = {};
      NAV_TABS.forEach((t) => {
        s[r.value][t.href] = parseStoredLevel(perms?.[r.value]?.[t.href], t.href, r.value);
      });
    });
    return s;
  });

  const setLevel = (role, href, level) =>
    setState((s) => ({ ...s, [role]: { ...s[role], [href]: level } }));

  async function persist(next) {
    setMsg(null);
    const res = await saveRolePerms(next);
    setMsg({ text: res.message, type: res.status === 'ok' ? 'ok' : 'err' });
    if (res.status === 'ok') startTransition(() => router.refresh());
  }

  function applyRecommended() {
    const next = recommendedPerms();
    setState(next);
    persist(next);
  }

  return (
    <div className="card">
      <div className="card-head"><Icon name="ti-lock-access" /><h2>สิทธิ์ตามตำแหน่ง — ดู / กรอก / แก้ได้</h2></div>
      <div className="card-body" style={{ overflowX: 'auto' }}>
        <p className="muted" style={{ fontSize: 'var(--fs-sm)', marginTop: -4, marginBottom: 10 }}>
          Super Admin (admin) เต็มสิทธิ์เสมอ · กดปุ่ม <strong>แก้ได้</strong> เมื่อต้องการให้แก้ของเดิมได้ ·
          <strong> กรอกอย่างเดียว</strong> = เพิ่มใหม่ได้แต่ห้ามแก้/ลบ · ระดับสูงรวมระดับล่าง
        </p>
        <p className="muted" style={{ fontSize: 'var(--fs-sm)', marginBottom: 10 }}>
          เพดานฐานข้อมูล (RLS) ที่เมทริกซ์ขยายเกินไม่ได้: Staff เพิ่มยอดขาย/รายจ่ายได้ แต่แก้ของเดิมและลบรายจ่ายต้องเป็น Manager+ · ลบยอดขายทั้งวันได้เฉพาะ Admin · ยกเลิกธุรกรรมแต้มได้เฉพาะ Manager+
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12, fontSize: 'var(--fs-xs)', color: 'var(--muted)' }}>
          {['none', 'view', 'create', 'edit'].map((lv) => (
            <span key={lv}><strong>{ACCESS_LABEL[lv]}</strong> = {ACCESS_HINT[lv]}</span>
          ))}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
          <button type="button" className="btn btn-ghost" onClick={applyRecommended} disabled={isPending} style={{ padding: '8px 12px', fontSize: 'var(--fs-base)' }}>
            ใช้ค่าแนะนำ (Staff กรอก / Manager แก้ไข)
          </button>
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--fs-base)', minWidth: 640 }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 600 }}>เมนู</th>
              {MANAGED_ROLES.map((r) => <th key={r.value} style={{ padding: '6px 8px', fontWeight: 600 }}>{r.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {NAV_TABS.map((t) => (
              <tr key={t.href} style={{ borderTop: '1px solid var(--border)' }}>
                <td style={{ padding: '8px', whiteSpace: 'nowrap' }}>
                  <Icon name={t.icon} style={{ marginRight: 6, color: 'var(--taupe)' }} />{t.label}
                </td>
                {MANAGED_ROLES.map((r) => {
                  const locked = isLoyaltyOnlyRole(r.value) && t.href !== '/loyalty';
                  const levels = PAGE_LEVELS[t.href] || ['none', 'view'];
                  const current = state[r.value][t.href];
                  return (
                    <td key={r.value} style={{ padding: '8px', textAlign: 'center' }}>
                      <div className="perm-pills">
                        {levels.map((lv) => (
                          <button
                            key={lv}
                            type="button"
                            className={`perm-pill${current === lv ? ` on-${lv}` : ''}`}
                            disabled={locked && lv !== 'none'}
                            onClick={() => setLevel(r.value, t.href, locked ? 'none' : lv)}
                            title={ACCESS_HINT[lv]}
                          >
                            {ACCESS_LABEL[lv]}
                          </button>
                        ))}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        <button className="btn btn-coffee" type="button" onClick={() => persist(state)} disabled={isPending} style={{ marginTop: 14 }}>
          <Icon name="ti-device-floppy" /> {isPending ? 'กำลังบันทึก...' : 'บันทึกสิทธิ์'}
        </button>
        {msg && <div style={{ marginTop: 12, fontSize: 'var(--fs-md)', color: msg.type === 'ok' ? 'var(--success)' : 'var(--danger)' }}>{msg.text}</div>}
      </div>
    </div>
  );
}
