'use client';
import Icon from '../../components/icon';

import { useEffect, useState, useTransition } from 'react';
import { searchCustomerAction, registerCustomerAction, issuePointsAction, redeemRewardAction } from './actions';
import { sanitizeNumberString, digitsOnly } from '../../lib/format';
import { suggestPointsFromSpend } from '../../lib/loyalty-rewards';
import { PRIVACY_CONSENT_TEXT } from '../../lib/privacy';
import AccessBanner from '../../components/access-banner';
import NumberInput from '../../components/number-input';
import { customerSegment } from '../../lib/rfm';

const RFM_COLOR = {
  Champions: '#16a34a',
  Loyal: '#2563eb',
  Potential: '#d97706',
  'At-Risk': '#dc2626',
  Lost: '#6b7280',
  New: '#8b5cf6',
};

const RECENT_KEY = 'mm69_loyalty_recent_phones';
const MAX_RECENT = 8;

function loadRecent() {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const arr = JSON.parse(raw || '[]');
    return Array.isArray(arr) ? arr.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function pushRecent(phone) {
  const p = digitsOnly(phone);
  if (!p || p.length < 9) return;
  try {
    const next = [p, ...loadRecent().filter((x) => x !== p)].slice(0, MAX_RECENT);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}

export default function LoyaltyClient({
  branches = [],
  rewards = [],
  defaultBranchId = '',
  staffLinked = false,
  staffCode = '',
  canVoid = false,
  canPickBranch = false,
  canCreate = true,
}) {
  const [query, setQuery] = useState('');
  const [recent, setRecent] = useState([]);
  const [customer, setCustomer] = useState(null);
  const [notFound, setNotFound] = useState(false);
  const [newPhone, setNewPhone] = useState('');
  const [newName, setNewName] = useState('');
  const [privacyConsent, setPrivacyConsent] = useState(false);
  const [spendAmount, setSpendAmount] = useState('');
  const [pointsInput, setPointsInput] = useState('');
  const [receiptNo, setReceiptNo] = useState('');
  const initialBranch =
    (defaultBranchId && branches.some((b) => b.id === defaultBranchId) && defaultBranchId)
    || '';
  const [selectedBranch, setSelectedBranch] = useState(initialBranch);
  const [msg, setMsg] = useState(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    setRecent(loadRecent());
  }, []);

  function rememberPhone(phone) {
    pushRecent(phone);
    setRecent(loadRecent());
  }

  function runSearch(q) {
    const term = String(q || '').trim();
    if (!term) return;
    setMsg(null);
    setNotFound(false);
    startTransition(async () => {
      const res = await searchCustomerAction(term);
      if (res.status === 'ok') {
        setCustomer(res.customer);
        rememberPhone(res.customer.phone);
        setQuery(res.customer.phone);
      } else if (res.status === 'not_found') {
        setCustomer(null);
        setNotFound(true);
        setNewPhone(digitsOnly(term));
      } else {
        setMsg({ text: res.message, type: 'err' });
      }
    });
  }

  function handleSearch(e) {
    e.preventDefault();
    runSearch(query);
  }

  function handleRegister(e) {
    e.preventDefault();
    setMsg(null);
    if (!privacyConsent) {
      setMsg({ text: 'กรุณาติ๊กยอมรับการเก็บข้อมูลส่วนบุคคลก่อนสมัคร', type: 'err' });
      return;
    }
    startTransition(async () => {
      const res = await registerCustomerAction({
        phone: newPhone,
        name: newName,
        privacy_consent: true,
      });
      if (res.status === 'ok') {
        setCustomer(res.customer);
        setNotFound(false);
        setQuery(res.customer.phone);
        rememberPhone(res.customer.phone);
        setPrivacyConsent(false);
        setMsg({ text: res.message, type: 'ok' });
      } else {
        setMsg({ text: res.message, type: 'err' });
      }
    });
  }

  function handleSpendChange(val) {
    const s = sanitizeNumberString(val);
    setSpendAmount(s);
    const calcPts = suggestPointsFromSpend(s);
    setPointsInput(calcPts > 0 ? String(calcPts) : '');
  }

  function issue(pts) {
    if (!customer) return;
    if (!staffLinked) {
      setMsg({ text: 'บัญชียังไม่ได้ผูกสาขา — ติดต่อ Admin ที่ /admin/loyalty', type: 'err' });
      return;
    }
    if (!selectedBranch) {
      setMsg({ text: 'กรุณาเลือกสาขา', type: 'err' });
      return;
    }
    if (!receiptNo.trim()) {
      setMsg({ text: 'กรุณาระบุเลขที่ใบเสร็จ', type: 'err' });
      return;
    }
    if (!pts || pts <= 0) {
      setMsg({ text: 'กรุณาระบุจำนวนแต้ม', type: 'err' });
      return;
    }

    setMsg(null);
    startTransition(async () => {
      const res = await issuePointsAction({
        customer_id: customer.id,
        points: pts,
        receipt_number: receiptNo,
        branch_id: selectedBranch,
      });

      if (res.status === 'ok') {
        const added = res.points || pts;
        setMsg({ text: res.message, type: 'ok' });
        setCustomer((prev) => (prev ? { ...prev, points_balance: (prev.points_balance || 0) + added } : null));
        setSpendAmount('');
        setPointsInput('');
        setReceiptNo('');
      } else {
        setMsg({ text: res.message, type: 'err' });
      }
    });
  }

  function handleIssuePoints(e) {
    e.preventDefault();
    issue(Number(pointsInput));
  }

  function handleQuickIssue() {
    const pts = suggestPointsFromSpend(spendAmount);
    if (!spendAmount || pts <= 0) {
      setMsg({ text: 'พิมพ์ยอดซื้อก่อน แล้วกดแจกตามยอด', type: 'err' });
      return;
    }
    setPointsInput(String(pts));
    issue(pts);
  }

  function handleRedeem(reward) {
    if (!customer) return;
    if (!staffLinked) {
      setMsg({ text: 'บัญชียังไม่ได้ผูกสาขา — ติดต่อ Admin ที่ /admin/loyalty', type: 'err' });
      return;
    }
    if (!selectedBranch) {
      setMsg({ text: 'กรุณาเลือกสาขา', type: 'err' });
      return;
    }
    if ((customer.points_balance || 0) < reward.points) {
      setMsg({ text: `แต้มไม่เพียงพอ ต้องการ ${reward.points} แต้ม`, type: 'err' });
      return;
    }
    if (!confirm(`ยืนยันการแลก "${reward.name}" ใช้ ${reward.points} แต้ม สำหรับลูกค้า ${customer.name}?`)) return;

    setMsg(null);
    startTransition(async () => {
      const res = await redeemRewardAction({
        customer_id: customer.id,
        reward_id: reward.id,
        branch_id: selectedBranch,
      });

      if (res.status === 'ok') {
        const used = res.points_used || reward.points;
        setMsg({ text: res.message, type: 'ok' });
        setCustomer((prev) => (prev ? { ...prev, points_balance: Math.max(0, (prev.points_balance || 0) - used) } : null));
      } else {
        setMsg({ text: res.message, type: 'err' });
      }
    });
  }

  const suggested = suggestPointsFromSpend(spendAmount);

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      {!staffLinked && (
        <div
          style={{
            padding: '12px 14px',
            borderRadius: 'var(--radius-md)',
            background: '#fef2f2',
            border: '1px solid #fecaca',
            color: '#dc2626',
            fontWeight: 600,
            fontSize: 13,
          }}
        >
          <Icon name="ti-alert-triangle" /> บัญชียังไม่ได้ผูกกับสาขา — แจก/แลกแต้มไม่ได้จนกว่า Admin จะตั้งค่าที่เมนูตั้งค่าสาขา
        </div>
      )}

      <div className="card">
        <div className="card-head">
          <Icon name="ti-search" /> <h2>ค้นหาลูกค้าสะสมแต้ม</h2>
          {staffCode && (
            <span className="muted" style={{ marginLeft: 'auto', fontSize: 12 }}>รหัสพนักงาน: {staffCode}</span>
          )}
        </div>
        <div className="card-body">
          <form onSubmit={handleSearch} style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 220 }}>
              <input
                type="text"
                inputMode="tel"
                className="input"
                placeholder="เบอร์โทร (ตัวเลข) หรือ LINE User ID"
                value={query}
                onChange={(e) => {
                  const v = e.target.value;
                  // ถ้าพิมพ์ตัวเลข/ขีดเป็นหลัก → เก็บเฉพาะตัวเลขให้พิมพ์เร็ว
                  if (/^[\d\s\-]*$/.test(v)) setQuery(digitsOnly(v));
                  else setQuery(v);
                }}
                autoFocus
              />
            </div>
            <button type="submit" className="btn btn-primary" disabled={isPending}>
              <Icon name="ti-search" /> {isPending ? 'กำลังค้นหา...' : 'ค้นหา'}
            </button>
          </form>

          {recent.length > 0 && (
            <div style={{ marginTop: 12, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
              <span className="muted" style={{ fontSize: 12 }}>เบอร์ล่าสุด:</span>
              {recent.map((p) => (
                <button
                  key={p}
                  type="button"
                  className="btn btn-secondary"
                  style={{ fontSize: 12, padding: '4px 10px' }}
                  onClick={() => {
                    setQuery(p);
                    runSearch(p);
                  }}
                  disabled={isPending}
                >
                  {p}
                </button>
              ))}
            </div>
          )}

          {msg && (
            <div
              style={{
                marginTop: 14,
                padding: '10px 14px',
                borderRadius: 'var(--radius-md)',
                fontSize: 13,
                fontWeight: 600,
                background: msg.type === 'ok' ? '#f0fdf4' : '#fef2f2',
                color: msg.type === 'ok' ? '#16a34a' : '#dc2626',
                border: `1px solid ${msg.type === 'ok' ? '#bbf7d0' : '#fecaca'}`,
              }}
            >
              <Icon name={msg.type === 'ok' ? 'ti-circle-check' : 'ti-alert-circle'} /> {msg.text}
            </div>
          )}
        </div>
      </div>

      {!canCreate && <AccessBanner level="view" extra="ค้นหาและดูยอดแต้มได้ — ไม่มีสิทธิ์สมัคร / แจก / แลก" />}

      {notFound && !canCreate && (
        <p className="muted" style={{ fontSize: 13 }}>ไม่พบลูกค้านี้ — ไม่มีสิทธิ์สมัครสมาชิกใหม่</p>
      )}
      {notFound && canCreate && (
        <div className="card" style={{ borderColor: 'var(--color-primary)' }}>
          <div className="card-head">
            <Icon name="ti-user-plus" /> <h2>ไม่พบข้อมูล — ลงทะเบียนสมาชิกใหม่</h2>
          </div>
          <div className="card-body">
            <form onSubmit={handleRegister} style={{ display: 'grid', gap: 12, maxWidth: 400 }}>
              <div>
                <label style={lbl}>เบอร์โทรศัพท์</label>
                <input
                  type="text"
                  inputMode="numeric"
                  className="input"
                  value={newPhone}
                  onChange={(e) => setNewPhone(digitsOnly(e.target.value))}
                  placeholder="08XXXXXXXXX"
                  required
                />
              </div>
              <div>
                <label style={lbl}>ชื่อลูกค้า (หรือชื่อเล่น)</label>
                <input
                  type="text"
                  className="input"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="เช่น คุณสมชาย"
                />
              </div>
              <label
                style={{
                  display: 'flex',
                  gap: 10,
                  alignItems: 'flex-start',
                  fontSize: 13,
                  lineHeight: 1.45,
                  color: 'var(--color-text-muted)',
                  cursor: 'pointer',
                }}
              >
                <input
                  type="checkbox"
                  checked={privacyConsent}
                  onChange={(e) => setPrivacyConsent(e.target.checked)}
                  style={{ marginTop: 3, width: 18, height: 18, flexShrink: 0 }}
                  required
                />
                <span>{PRIVACY_CONSENT_TEXT}</span>
              </label>
              <button type="submit" className="btn btn-primary" disabled={isPending || !privacyConsent} style={{ minHeight: 48 }}>
                <Icon name="ti-check" /> สมัครสมาชิกและเริ่มสะสมแต้ม
              </button>
            </form>
          </div>
        </div>
      )}

      {customer && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 20 }}>
          <div className="card">
            <div className="card-head">
              <Icon name="ti-id-badge" /> <h2>ข้อมูลสมาชิก</h2>
              <span
                style={{
                  marginLeft: 'auto',
                  padding: '2px 10px',
                  borderRadius: 'var(--radius-full)',
                  fontSize: 11,
                  fontWeight: 700,
                  color: '#fff',
                  background: RFM_COLOR[customerSegment(customer)] || '#6b7280',
                }}
              >
                {customerSegment(customer)}
              </span>
            </div>
            <div className="card-body">
              <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>{customer.name}</div>
              <div className="muted" style={{ fontSize: 13 }}><Icon name="ti-phone" /> {customer.phone}</div>
              {customer.line_user_id && <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>LINE: {customer.line_user_id}</div>}

              <div
                style={{
                  margin: '16px 0',
                  padding: 16,
                  borderRadius: 'var(--radius-md)',
                  background: 'var(--color-surface-2)',
                  textAlign: 'center',
                }}
              >
                <div className="muted" style={{ fontSize: 12 }}>แต้มสะสมคงเหลือ</div>
                <div style={{ fontSize: 36, fontWeight: 800, color: 'var(--color-primary)', margin: '4px 0' }}>
                  {customer.points_balance || 0} <span style={{ fontSize: 16, fontWeight: 600 }}>แต้ม</span>
                </div>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                  เข้ามาใช้บริการแล้ว {customer.visit_count || 0} ครั้ง
                </div>
              </div>

              <div>
                <label style={lbl}>สาขาทำรายการ *</label>
                <select
                  className="input"
                  value={selectedBranch}
                  onChange={(e) => setSelectedBranch(e.target.value)}
                  required
                  disabled={!canPickBranch}
                >
                  <option value="">— เลือกสาขา —</option>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
                {!canPickBranch && (
                  <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
                    พนักงานใช้สาขาที่ผูกไว้เท่านั้น (เปลี่ยนได้เฉพาะ manager+)
                  </div>
                )}
              </div>
            </div>
          </div>

          {canCreate && (
          <>
          <div className="card">
            <div className="card-head">
              <Icon name="ti-plus" /> <h2>สะสมแต้ม</h2>
            </div>
            <div className="card-body">
              <form onSubmit={handleIssuePoints} style={{ display: 'grid', gap: 12 }}>
                <div>
                  <label style={lbl}>ยอดซื้อสินค้า (บาท)</label>
                  <NumberInput
                    className="input"
                    placeholder="เช่น 150"
                    value={spendAmount}
                    onChange={handleSpendChange}
                  />
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
                    ทุก 50 บาท = 1 แต้ม {suggested > 0 ? `→ แนะนำ ${suggested} แต้ม` : ''}
                  </div>
                </div>

                <div>
                  <label style={lbl}>เลขที่ใบเสร็จ *</label>
                  <input
                    type="text"
                    className="input"
                    placeholder="บังคับใส่เพื่อไล่ย้อนบิล"
                    value={receiptNo}
                    onChange={(e) => setReceiptNo(e.target.value)}
                    required
                  />
                </div>

                <div>
                  <label style={lbl}>จำนวนแต้ม (แก้ได้)</label>
                  <NumberInput
                    mode="numeric"
                    className="input"
                    placeholder="ระบุจำนวนแต้ม..."
                    value={pointsInput}
                    onChange={setPointsInput}
                  />
                </div>

                <button
                  type="button"
                  className="btn btn-coffee"
                  disabled={isPending || !staffLinked || !suggested}
                  onClick={handleQuickIssue}
                >
                  <Icon name="ti-bolt" /> แจกตามยอด (+{suggested || 0} แต้ม)
                </button>

                <button type="submit" className="btn btn-primary" disabled={isPending || !staffLinked || !pointsInput}>
                  <Icon name="ti-gift" /> {isPending ? 'กำลังบันทึก...' : `บันทึกสะสม +${pointsInput || 0} แต้ม`}
                </button>
              </form>
            </div>
          </div>

          <div className="card" style={{ gridColumn: '1 / -1' }}>
            <div className="card-head">
              <Icon name="ti-trophy" /> <h2>แลกของรางวัล</h2>
            </div>
            <div className="card-body">
              {(rewards || []).length === 0 ? (
                <p className="muted" style={{ margin: 0, fontSize: 13 }}>
                  ยังไม่มีรางวัลที่เปิดใช้ — ให้ Admin ตั้งค่าที่เมนูตั้งค่าสาขา
                </p>
              ) : null}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
                {(rewards || []).map((rw) => {
                  const canRedeem = staffLinked && selectedBranch && (customer.points_balance || 0) >= rw.points;
                  return (
                    <div
                      key={rw.id}
                      style={{
                        padding: 14,
                        borderRadius: 'var(--radius-md)',
                        border: '1px solid var(--color-border)',
                        background: canRedeem ? 'var(--color-surface)' : 'var(--color-surface-2)',
                        opacity: canRedeem ? 1 : 0.6,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 10,
                      }}
                    >
                      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                        <div
                          style={{
                            width: 36,
                            height: 36,
                            borderRadius: 'var(--radius-md)',
                            background: canRedeem ? 'var(--color-primary)' : 'var(--color-muted)',
                            color: '#fff',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: 18,
                          }}
                        >
                          <Icon name={rw.icon} />
                        </div>
                        <div>
                          <div style={{ fontWeight: 700, fontSize: 14 }}>{rw.name}</div>
                          <div style={{ fontSize: 12, color: 'var(--color-primary)', fontWeight: 600 }}>
                            {rw.points} แต้ม
                          </div>
                        </div>
                      </div>

                      <button
                        type="button"
                        className={`btn ${canRedeem ? 'btn-primary' : ''}`}
                        onClick={() => handleRedeem(rw)}
                        disabled={!canRedeem || isPending}
                        style={{ width: '100%', fontSize: 12, padding: '6px 12px' }}
                      >
                        {canRedeem ? 'กดแลกรางวัล' : `แต้มไม่พอ (ขาด ${Math.max(0, rw.points - (customer.points_balance || 0))} แต้ม)`}
                      </button>
                    </div>
                  );
                })}
              </div>
              {canVoid && (
                <p className="muted" style={{ marginTop: 12, fontSize: 12, marginBottom: 0 }}>
                  ต้องการยกเลิกรายการผิดพลาด → ไปที่เมนูประวัติธุรกรรม
                </p>
              )}
            </div>
          </div>
          </>
          )}
        </div>
      )}
    </div>
  );
}

const lbl = { display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--color-text)', marginBottom: 4 };
