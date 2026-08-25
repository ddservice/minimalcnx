'use client';
import Icon from '../../../components/icon';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  upsertBranchAction,
  toggleBranchAction,
  upsertStaffProfileAction,
  deleteStaffProfileAction,
  upsertRewardAction,
  toggleRewardAction,
} from './actions';
import { REWARD_ICON_OPTIONS } from '../../../lib/loyalty-rewards';
import NumberInput from '../../../components/number-input';

function cleanStaffCode(v) {
  return String(v || '').toUpperCase().replace(/[^A-Z0-9_-]/g, '');
}

const fieldLbl = {
  display: 'grid',
  gap: 6,
  fontSize: 13,
  fontWeight: 600,
  color: 'var(--color-text)',
};

const hintBox = {
  margin: 0,
  padding: '12px 14px',
  borderRadius: 'var(--radius-md)',
  background: 'var(--color-surface-2)',
  border: '1px solid var(--color-border)',
  fontSize: 13,
  lineHeight: 1.55,
  color: 'var(--color-text-muted)',
};

const stepBadge = {
  width: 28,
  height: 28,
  borderRadius: 'var(--radius-full)',
  background: 'var(--color-primary)',
  color: '#fff',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 13,
  fontWeight: 700,
  flexShrink: 0,
};

export default function LoyaltyAdmin({ branches = [], staffProfiles = [], users = [], rewards = [] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [msg, setMsg] = useState(null);

  const activeBranches = branches.filter((b) => b.is_active);
  const linkedUserIds = new Set(staffProfiles.map((sp) => sp.user_id));
  const unlinkedUsers = users.filter((u) => !linkedUserIds.has(u.id));

  const [branchForm, setBranchForm] = useState({ code: '', name: '', location: '' });
  const [staffForm, setStaffForm] = useState({
    user_id: '',
    branch_id: activeBranches[0]?.id || '',
    staff_code: '',
    role: 'staff',
  });
  const [rewardForm, setRewardForm] = useState({
    id: '',
    name: '',
    points: '10',
    icon: 'ti-gift',
    sort_order: '100',
  });

  function flash(res) {
    setMsg({ text: res.message, type: res.status === 'ok' ? 'ok' : 'err' });
    if (res.status === 'ok') startTransition(() => router.refresh());
  }

  async function onCreateBranch(e) {
    e.preventDefault();
    const res = await upsertBranchAction(branchForm);
    flash(res);
    if (res.status === 'ok') setBranchForm({ code: '', name: '', location: '' });
  }

  async function onCreateStaff(e) {
    e.preventDefault();
    const res = await upsertStaffProfileAction(staffForm);
    flash(res);
    if (res.status === 'ok') {
      setStaffForm((f) => ({ ...f, user_id: '', staff_code: '', role: 'staff' }));
    }
  }

  async function onCreateReward(e) {
    e.preventDefault();
    const res = await upsertRewardAction({
      ...rewardForm,
      points: rewardForm.points,
      sort_order: rewardForm.sort_order,
      is_active: true,
    });
    flash(res);
    if (res.status === 'ok') {
      setRewardForm({ id: '', name: '', points: '10', icon: 'ti-gift', sort_order: '100' });
    }
  }

  const userLabel = (u) => {
    const nick = u.nickname ? ` (${u.nickname})` : '';
    return `${u.full_name || u.username}${nick}`;
  };

  return (
    <div style={{ display: 'grid', gap: 24, maxWidth: 920 }}>
      {msg && (
        <div
          style={{
            padding: '12px 14px',
            borderRadius: 'var(--radius-md)',
            fontSize: 14,
            fontWeight: 600,
            background: msg.type === 'ok' ? '#f0fdf4' : '#fef2f2',
            color: msg.type === 'ok' ? '#15803d' : '#b91c1c',
            border: `1px solid ${msg.type === 'ok' ? '#bbf7d0' : '#fecaca'}`,
          }}
        >
          <Icon name={msg.type === 'ok' ? 'ti-circle-check' : 'ti-alert-circle'} /> {msg.text}
        </div>
      )}

      {/* ── 1. สาขา ── */}
      <section className="card">
        <div className="card-head">
          <span style={stepBadge}>1</span>
          <div>
            <h2 style={{ margin: 0 }}>สาขา</h2>
            <div className="muted" style={{ fontSize: 12, fontWeight: 400, marginTop: 2 }}>
              รายชื่อสาขาที่ใช้ตอนแจก/แลกแต้ม · มี {branches.length} สาขา
            </div>
          </div>
        </div>

        <div className="card-body" style={{ display: 'grid', gap: 20 }}>
          {/* รายการสาขา */}
          <div style={{ display: 'grid', gap: 10 }}>
            {branches.length === 0 && (
              <div style={{ ...hintBox, textAlign: 'center', padding: 24 }}>
                ยังไม่มีสาขา — เพิ่มสาขาด้านล่างก่อน แล้วค่อยผูกพนักงาน
              </div>
            )}
            {branches.map((b) => (
              <div
                key={b.id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'auto 1fr auto',
                  gap: 14,
                  alignItems: 'center',
                  padding: '14px 16px',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--color-border)',
                  background: b.is_active ? 'var(--color-surface)' : 'var(--color-surface-2)',
                  opacity: b.is_active ? 1 : 0.72,
                }}
              >
                <div
                  style={{
                    minWidth: 64,
                    padding: '6px 10px',
                    borderRadius: 'var(--radius-sm)',
                    background: 'var(--color-surface-2)',
                    fontFamily: 'ui-monospace, monospace',
                    fontSize: 13,
                    fontWeight: 700,
                    textAlign: 'center',
                    color: 'var(--color-primary)',
                  }}
                >
                  {b.code}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>{b.name}</div>
                  <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                    <Icon name="ti-map-pin" style={{ marginRight: 4 }} />
                    {b.location || 'ไม่ได้ระบุที่ตั้ง'}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: 700,
                      padding: '4px 10px',
                      borderRadius: 'var(--radius-full)',
                      background: b.is_active ? '#dcfce7' : '#f3f4f6',
                      color: b.is_active ? '#15803d' : '#6b7280',
                    }}
                  >
                    {b.is_active ? 'เปิดใช้' : 'ปิดอยู่'}
                  </span>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{ fontSize: 12, padding: '6px 12px' }}
                    disabled={isPending}
                    onClick={async () => flash(await toggleBranchAction({ id: b.id, is_active: !b.is_active }))}
                  >
                    {b.is_active ? 'ปิดสาขา' : 'เปิดสาขา'}
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* ฟอร์มเพิ่มสาขา */}
          <div
            style={{
              padding: 16,
              borderRadius: 'var(--radius-md)',
              background: 'var(--color-surface-2)',
              border: '1px dashed var(--color-border)',
            }}
          >
            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 12 }}>
              <Icon name="ti-plus" style={{ marginRight: 6, color: 'var(--color-primary)' }} />
              เพิ่มสาขาใหม่
            </div>
            <form onSubmit={onCreateBranch} style={{ display: 'grid', gap: 12 }}>
              <div
                style={{
                  display: 'grid',
                  gap: 12,
                  gridTemplateColumns: 'minmax(100px, 140px) 1fr',
                }}
                className="loyalty-admin-branch-fields"
              >
                <label style={fieldLbl}>
                  รหัสสาขา
                  <input
                    className="input"
                    value={branchForm.code}
                    onChange={(e) => setBranchForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))}
                    placeholder="เช่น MAIN"
                    required
                  />
                </label>
                <label style={fieldLbl}>
                  ชื่อสาขา
                  <input
                    className="input"
                    value={branchForm.name}
                    onChange={(e) => setBranchForm((f) => ({ ...f, name: e.target.value }))}
                    placeholder="เช่น สาขาแม่ริม"
                    required
                  />
                </label>
              </div>
              <label style={fieldLbl}>
                ที่ตั้ง <span className="muted" style={{ fontWeight: 400 }}>(ไม่บังคับ)</span>
                <input
                  className="input"
                  value={branchForm.location}
                  onChange={(e) => setBranchForm((f) => ({ ...f, location: e.target.value }))}
                  placeholder="เช่น อ.แม่ริม จ.เชียงใหม่"
                />
              </label>
              <div>
                <button className="btn btn-coffee" type="submit" disabled={isPending}>
                  <Icon name="ti-plus" /> เพิ่มสาขา
                </button>
              </div>
            </form>
          </div>
        </div>
      </section>

      {/* ── 2. ผูกพนักงาน ── */}
      <section className="card">
        <div className="card-head">
          <span style={stepBadge}>2</span>
          <div>
            <h2 style={{ margin: 0 }}>ผูกพนักงานกับสาขา</h2>
            <div className="muted" style={{ fontSize: 12, fontWeight: 400, marginTop: 2 }}>
              ต้องผูกก่อนจึงจะแจก/แลกแต้มได้ · ผูกแล้ว {staffProfiles.length} คน
              {unlinkedUsers.length > 0 ? ` · ยังไม่ผูก ${unlinkedUsers.length} คน` : ''}
            </div>
          </div>
        </div>

        <div className="card-body" style={{ display: 'grid', gap: 20 }}>
          <p style={hintBox}>
            <strong style={{ color: 'var(--color-text)' }}>ทำไมต้องผูก?</strong>
            {' '}ระบบจะรู้ว่า <em>สาขาไหน</em> และ <em>พนักงานคนไหน</em> เป็นผู้ให้/รับแลกแต้ม
            — พนักงานยังเปลี่ยนสาขาชั่วคราวในหน้าสะสมแต้มได้
          </p>

          {/* ฟอร์มผูก */}
          <div
            style={{
              padding: 16,
              borderRadius: 'var(--radius-md)',
              background: 'var(--color-surface-2)',
              border: '1px dashed var(--color-border)',
            }}
          >
            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 12 }}>
              <Icon name="ti-link" style={{ marginRight: 6, color: 'var(--color-primary)' }} />
              ผูกพนักงานใหม่
            </div>
            <form onSubmit={onCreateStaff} style={{ display: 'grid', gap: 12 }}>
              <label style={fieldLbl}>
                ผู้ใช้ในระบบ
                <select
                  className="input"
                  value={staffForm.user_id}
                  onChange={(e) => setStaffForm((f) => ({ ...f, user_id: e.target.value }))}
                  required
                >
                  <option value="">— เลือกผู้ใช้ที่ยังไม่ผูก —</option>
                  {(unlinkedUsers.length ? unlinkedUsers : users).map((u) => (
                    <option key={u.id} value={u.id}>
                      {userLabel(u)} · {u.role}
                      {linkedUserIds.has(u.id) ? ' (ผูกแล้ว)' : ''}
                    </option>
                  ))}
                </select>
              </label>

              <div
                style={{
                  display: 'grid',
                  gap: 12,
                  gridTemplateColumns: '1.4fr 1fr 1fr',
                }}
                className="loyalty-admin-staff-fields"
              >
                <label style={fieldLbl}>
                  สาขาตั้งต้น
                  <select
                    className="input"
                    value={staffForm.branch_id}
                    onChange={(e) => setStaffForm((f) => ({ ...f, branch_id: e.target.value }))}
                    required
                    disabled={!activeBranches.length}
                  >
                    <option value="">— เลือกสาขา —</option>
                    {activeBranches.map((b) => (
                      <option key={b.id} value={b.id}>{b.code} — {b.name}</option>
                    ))}
                  </select>
                </label>
                <label style={fieldLbl}>
                  รหัสพนักงาน
                  <input
                    className="input"
                    value={staffForm.staff_code}
                    onChange={(e) => setStaffForm((f) => ({ ...f, staff_code: cleanStaffCode(e.target.value) }))}
                    placeholder="เช่น EMP01"
                    required
                  />
                </label>
                <label style={fieldLbl}>
                  บทบาทที่สาขา
                  <select
                    className="input"
                    value={staffForm.role}
                    onChange={(e) => setStaffForm((f) => ({ ...f, role: e.target.value }))}
                  >
                    <option value="staff">พนักงาน (staff)</option>
                    <option value="manager">ผู้จัดการ (manager)</option>
                    <option value="admin">แอดมินสาขา (admin)</option>
                  </select>
                </label>
              </div>

              <div>
                <button
                  className="btn btn-coffee"
                  type="submit"
                  disabled={isPending || !activeBranches.length || !users.length}
                >
                  <Icon name="ti-link" /> บันทึกการผูก
                </button>
                {!activeBranches.length && (
                  <span className="muted" style={{ marginLeft: 12, fontSize: 12 }}>
                    ต้องมีสาขาที่เปิดใช้อย่างน้อย 1 สาขาก่อน
                  </span>
                )}
              </div>
            </form>
          </div>

          {/* รายชื่อที่ผูกแล้ว */}
          <div>
            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10 }}>
              พนักงานที่ผูกแล้ว
            </div>
            {staffProfiles.length === 0 ? (
              <div style={{ ...hintBox, textAlign: 'center', padding: 28 }}>
                <div style={{ fontSize: 28, marginBottom: 8, opacity: 0.45 }}>
                  <Icon name="ti-user-off" />
                </div>
                <div style={{ fontWeight: 600, color: 'var(--color-text)' }}>ยังไม่มีพนักงานที่ผูกสาขา</div>
                <div style={{ marginTop: 4 }}>เลือกผู้ใช้ด้านบน แล้วกด “บันทึกการผูก”</div>
              </div>
            ) : (
              <div style={{ display: 'grid', gap: 10 }}>
                {staffProfiles.map((sp) => (
                  <div
                    key={sp.id}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'auto 1fr auto',
                      gap: 14,
                      alignItems: 'center',
                      padding: '14px 16px',
                      borderRadius: 'var(--radius-md)',
                      border: '1px solid var(--color-border)',
                      background: 'var(--color-surface)',
                    }}
                  >
                    <div
                      style={{
                        minWidth: 64,
                        padding: '6px 10px',
                        borderRadius: 'var(--radius-sm)',
                        background: 'var(--color-surface-2)',
                        fontFamily: 'ui-monospace, monospace',
                        fontSize: 13,
                        fontWeight: 700,
                        textAlign: 'center',
                      }}
                    >
                      {sp.staff_code}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 15 }}>
                        {sp.profiles?.full_name || sp.profiles?.username || '—'}
                      </div>
                      <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                        <Icon name="ti-building-store" style={{ marginRight: 4 }} />
                        {sp.branches?.name || '—'}
                        <span style={{ margin: '0 6px' }}>·</span>
                        {sp.role}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      style={{ fontSize: 12, padding: '6px 12px', color: '#b91c1c' }}
                      disabled={isPending}
                      onClick={async () => {
                        if (!confirm(`เลิกผูก "${sp.staff_code}" ออกจากสาขา?`)) return;
                        flash(await deleteStaffProfileAction({ id: sp.id }));
                      }}
                    >
                      <Icon name="ti-unlink" /> เลิกผูก
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ── 3. ของรางวัล ── */}
      <section className="card">
        <div className="card-head">
          <span style={stepBadge}>3</span>
          <div>
            <h2 style={{ margin: 0 }}>ของรางวัล</h2>
            <div className="muted" style={{ fontSize: 12, fontWeight: 400, marginTop: 2 }}>
              แคตตาล็อกที่ใช้ตอนแลกแต้ม · ต้องรัน sql/add_loyalty_rewards.sql ก่อน
            </div>
          </div>
        </div>
        <div className="card-body" style={{ display: 'grid', gap: 16 }}>
          <p style={hintBox}>
            รหัสรางวัล (เช่น <code>free_coffee</code>) ใช้ในประวัติการแลก — อย่าเปลี่ยนรหัสของรายการเก่าถ้าไม่จำเป็น
            ปิดใช้งานแทนการลบ เพื่อไม่ให้ประวัติเก่าอ้างอิงพัง
          </p>

          <form onSubmit={onCreateReward} style={{ display: 'grid', gap: 12 }}>
            <div
              className="loyalty-admin-reward-fields"
              style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr 0.7fr 0.9fr 0.7fr', gap: 10 }}
            >
              <label style={fieldLbl}>
                รหัส
                <input
                  className="input"
                  value={rewardForm.id}
                  onChange={(e) => setRewardForm((f) => ({ ...f, id: e.target.value }))}
                  placeholder="free_drink"
                  required
                />
              </label>
              <label style={fieldLbl}>
                ชื่อรางวัล
                <input
                  className="input"
                  value={rewardForm.name}
                  onChange={(e) => setRewardForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="เครื่องดื่มฟรี 1 แก้ว"
                  required
                />
              </label>
              <label style={fieldLbl}>
                แต้ม
                <NumberInput
                  className="input"
                  mode="numeric"
                  value={rewardForm.points}
                  onChange={(v) => setRewardForm((f) => ({ ...f, points: v }))}
                  required
                />
              </label>
              <label style={fieldLbl}>
                ไอคอน
                <select
                  className="input"
                  value={rewardForm.icon}
                  onChange={(e) => setRewardForm((f) => ({ ...f, icon: e.target.value }))}
                >
                  {REWARD_ICON_OPTIONS.map((ic) => (
                    <option key={ic} value={ic}>{ic}</option>
                  ))}
                </select>
              </label>
              <label style={fieldLbl}>
                ลำดับ
                <NumberInput
                  className="input"
                  mode="numeric"
                  value={rewardForm.sort_order}
                  onChange={(v) => setRewardForm((f) => ({ ...f, sort_order: v }))}
                />
              </label>
            </div>
            <button type="submit" className="btn btn-primary" disabled={isPending} style={{ justifySelf: 'start' }}>
              <Icon name="ti-plus" /> เพิ่ม / อัปเดตรางวัล
            </button>
          </form>

          {rewards.length === 0 ? (
            <p className="muted" style={{ margin: 0, fontSize: 13 }}>
              ยังไม่มีรางวัลในฐานข้อมูล — เพิ่มด้านบน หรือรัน seed ใน sql/add_loyalty_rewards.sql
            </p>
          ) : (
            <div style={{ display: 'grid', gap: 8 }}>
              {rewards.map((rw) => (
                <div
                  key={rw.id}
                  style={{
                    display: 'flex',
                    gap: 12,
                    alignItems: 'center',
                    padding: '12px 14px',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--color-border)',
                    background: rw.is_active ? 'var(--color-surface)' : 'var(--color-surface-2)',
                    opacity: rw.is_active ? 1 : 0.7,
                    flexWrap: 'wrap',
                  }}
                >
                  <div
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 'var(--radius-md)',
                      background: 'var(--color-primary)',
                      color: '#fff',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Icon name={rw.icon || 'ti-gift'} />
                  </div>
                  <div style={{ flex: 1, minWidth: 140 }}>
                    <div style={{ fontWeight: 700 }}>{rw.name}</div>
                    <div className="muted" style={{ fontSize: 12 }}>
                      <code>{rw.id}</code> · {rw.points} แต้ม · ลำดับ {rw.sort_order}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{ fontSize: 12 }}
                    disabled={isPending}
                    onClick={async () => {
                      flash(await toggleRewardAction({ id: rw.id, is_active: !rw.is_active }));
                    }}
                  >
                    {rw.is_active ? 'ปิดใช้' : 'เปิดใช้'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    style={{ fontSize: 12 }}
                    disabled={isPending}
                    onClick={() => {
                      setRewardForm({
                        id: rw.id,
                        name: rw.name,
                        points: String(rw.points),
                        icon: rw.icon || 'ti-gift',
                        sort_order: String(rw.sort_order ?? 0),
                      });
                    }}
                  >
                    แก้ไข
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <style>{`
        @media (max-width: 720px) {
          .loyalty-admin-branch-fields,
          .loyalty-admin-staff-fields,
          .loyalty-admin-reward-fields {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </div>
  );
}
