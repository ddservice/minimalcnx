'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  createUserAction,
  updateUserAction,
  resetPasswordAction,
  toggleActiveAction,
  deleteUserAction,
} from './actions';
import { MIN_PASSWORD_LENGTH } from '../../lib/auth-policy';
import { stripDigits } from '../../lib/format';

const ROLES = [
  { value: 'admin', label: 'Admin' },
  { value: 'co-admin', label: 'Co-Admin' },
  { value: 'manager', label: 'Manager' },
  { value: 'staff', label: 'Staff' },
  { value: 'loyalty_staff', label: 'Loyalty only' },
];

const ROLE_COLORS = {
  admin: '#3d2b1f',
  'co-admin': '#1a5fa5',
  manager: '#c8a97e',
  staff: '#7a7a7a',
  loyalty_staff: '#16a34a',
};

export default function UserManager({ initialUsers, myUsername }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [msg, setMsg] = useState(null); // { text, type }
  const [editing, setEditing] = useState(null); // username being edited

  const [form, setForm] = useState({
    username: '',
    full_name: '',
    nickname: '',
    password: '',
    role: 'staff',
  });

  function flash(res) {
    setMsg({ text: res.message, type: res.status === 'ok' ? 'ok' : 'err' });
    if (res.status === 'ok') startTransition(() => router.refresh());
  }

  async function onCreate(e) {
    e.preventDefault();
    const res = await createUserAction(form);
    flash(res);
    if (res.status === 'ok')
      setForm({ username: '', full_name: '', nickname: '', password: '', role: 'staff' });
  }

  async function onSaveEdit(u, values) {
    const res = await updateUserAction({ username: u.username, ...values });
    flash(res);
    if (res.status === 'ok') setEditing(null);
  }

  async function onResetPw(u) {
    const np = window.prompt(`ตั้งรหัสผ่านใหม่ให้ "${u.username}" (อย่างน้อย ${MIN_PASSWORD_LENGTH} ตัว)`);
    if (np == null) return;
    flash(await resetPasswordAction({ username: u.username, new_password: np }));
  }

  async function onDelete(u) {
    if (!window.confirm(`ลบผู้ใช้ "${u.username}" ?\nการกระทำนี้ย้อนกลับไม่ได้`)) return;
    flash(await deleteUserAction({ username: u.username }));
  }

  async function onToggleActive(u) {
    const next = !(u.is_active !== false); // is_active undefined/true -> จะปิด, false -> จะเปิด
    const label = next ? 'เปิดใช้งาน' : 'ปิดใช้งาน';
    if (!window.confirm(`${label}บัญชี "${u.username}" ?${!next ? '\n(ผู้ใช้จะถูกเซ็นเอาต์และเข้าระบบไม่ได้ทันที)' : ''}`)) return;
    flash(await toggleActiveAction({ username: u.username, is_active: next }));
  }

  return (
    <div>
      {/* ── ฟอร์มสร้างผู้ใช้ ── */}
      <form onSubmit={onCreate} style={cardStyle}>
        <h2 style={{ marginTop: 0, fontSize: 'var(--fs-xl)' }}>+ สร้างผู้ใช้ใหม่</h2>
        <div style={grid2}>
          <input style={inp} placeholder="ชื่อผู้ใช้ (username)" value={form.username}
            onChange={(e) => setForm({ ...form, username: e.target.value })} />
          <input style={inp} placeholder="ชื่อ-นามสกุล" value={form.full_name}
            onChange={(e) => setForm({ ...form, full_name: stripDigits(e.target.value) })} />
          <input style={inp} placeholder="ชื่อเล่น" value={form.nickname}
            onChange={(e) => setForm({ ...form, nickname: stripDigits(e.target.value) })} />
          <input style={inp} type="password" placeholder={`รหัสผ่าน (≥${MIN_PASSWORD_LENGTH} ตัว)`} value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })} />
          <select style={inp} value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value })}>
            {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
          <button style={btnPrimary} type="submit" disabled={isPending}>สร้างผู้ใช้</button>
        </div>
      </form>

      {msg && (
        <div style={{ margin: '14px 0', color: msg.type === 'ok' ? '#1e7e34' : '#c0392b', fontSize: 'var(--fs-md)' }}>
          {/* React escape ค่าให้อัตโนมัติ */}
          {msg.text}
        </div>
      )}

      {/* ── รายชื่อผู้ใช้ ── */}
      <div style={{ marginTop: 8 }}>
        {initialUsers.map((u) => (
          <UserCard
            key={u.username}
            user={u}
            isSelf={u.username === myUsername}
            editing={editing === u.username}
            onEdit={() => setEditing(u.username)}
            onCancel={() => setEditing(null)}
            onSave={(values) => onSaveEdit(u, values)}
            onResetPw={() => onResetPw(u)}
            onToggleActive={() => onToggleActive(u)}
            onDelete={() => onDelete(u)}
          />
        ))}
      </div>
    </div>
  );
}

function UserCard({ user, isSelf, editing, onEdit, onCancel, onSave, onResetPw, onToggleActive, onDelete }) {
  const [full, setFull] = useState(user.full_name || '');
  const [nick, setNick] = useState(user.nickname || '');
  const [role, setRole] = useState(user.role || 'staff');
  const isActive = user.is_active !== false;

  return (
    <div style={{ ...cardStyle, opacity: isActive ? 1 : 0.6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <strong style={{ fontSize: 'var(--fs-lg)' }}>{user.username}</strong>{' '}
          <span style={{ ...chip, background: ROLE_COLORS[user.role] || '#999' }}>{user.role}</span>{' '}
          {!isActive && <span style={{ ...chip, background: 'var(--danger)' }}>ปิดใช้งาน</span>}
          {user.full_name && (
            <div style={{ fontSize: 'var(--fs-base)', color: 'var(--muted)', marginTop: 4 }}>{user.full_name}</div>
          )}
          {user.nickname && (
            <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--muted)' }}>ชื่อเล่น: {user.nickname}</div>
          )}
        </div>
        {!editing && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <button style={btnGhost} onClick={onEdit}>แก้ไข</button>
            <button style={btnGhost} onClick={onResetPw}>รีเซ็ต PW</button>
            {!isSelf && (
              <button style={isActive ? btnDanger : btnGhost} onClick={onToggleActive}>
                {isActive ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}
              </button>
            )}
            {!isSelf && <button style={btnDanger} onClick={onDelete}>ลบ</button>}
          </div>
        )}
      </div>

      {editing && (
        <div style={{ ...grid2, marginTop: 12 }}>
          <input style={inp} placeholder="ชื่อ-นามสกุล" value={full} onChange={(e) => setFull(stripDigits(e.target.value))} />
          <input style={inp} placeholder="ชื่อเล่น" value={nick} onChange={(e) => setNick(stripDigits(e.target.value))} />
          <select style={inp} value={role} onChange={(e) => setRole(e.target.value)}>
            {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={btnPrimary} onClick={() => onSave({ full_name: full, nickname: nick, role })}>บันทึก</button>
            <button style={btnGhost} onClick={onCancel}>ยกเลิก</button>
          </div>
        </div>
      )}
    </div>
  );
}

const cardStyle = {
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-md)',
  padding: 16,
  background: 'var(--surface)',
  marginBottom: 12,
};
const grid2 = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, marginTop: 10 };
const inp = { padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', fontSize: 'var(--fs-md)' };
const chip = { color: '#fff', padding: '3px 11px', borderRadius: 'var(--radius-full)', fontSize: 'var(--fs-xs)' };
const btnBase = { border: 0, borderRadius: 'var(--radius-md)', padding: '9px 14px', fontSize: 'var(--fs-base)', cursor: 'pointer', fontWeight: 600 };
const btnPrimary = { ...btnBase, background: 'var(--coffee)', color: '#fff' };
const btnGhost = { ...btnBase, background: '#f5ede3', color: 'var(--coffee)' };
const btnDanger = { ...btnBase, background: '#fff0f0', color: 'var(--danger)' };
