'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { fmtMoney } from '../../lib/format';
import NumberInput from '../../components/number-input';
import { PAYMENT_METHODS, EXPENSE_CATEGORIES } from '../../lib/expense-categories';
import { updateExpenseAction, deleteExpenseAction } from './actions';

const CATEGORY_LABEL = {};
EXPENSE_CATEGORIES.forEach((c) => { CATEGORY_LABEL[c.value] = c.label; });

export default function ExpenseList({ rows, date, canEdit = false, canDelete = false }) {
  const [msg, setMsg] = useState(null);
  const [editingId, setEditingId] = useState(null);

  const sum = rows.reduce((a, r) => a + Number(r.total_amount || 0), 0);

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: 16, background: 'var(--surface)', marginTop: 8 }}>
      <h2 style={{ marginTop: 0, fontSize: 15 }}>รายการที่บันทึกแล้ว ({date}) — ทุกหมวด</h2>

      {msg && (
        <div style={{ margin: '8px 0', fontSize: 13, color: msg.type === 'ok' ? '#1e7e34' : '#c0392b' }}>{msg.text}</div>
      )}

      {!rows.length ? (
        <p style={{ color: 'var(--muted)', fontSize: 13, margin: 0 }}>ยังไม่มีรายการในวันนี้</p>
      ) : (
        <>
          <div style={{ display: 'grid', gap: 8 }}>
            {rows.map((r) =>
              editingId === r.id ? (
                <EditRow key={r.id} row={r} onDone={() => setEditingId(null)} onMsg={setMsg} />
              ) : (
                <ViewRow key={r.id} row={r} onEdit={canEdit ? () => setEditingId(r.id) : null} onMsg={setMsg} canDelete={canDelete} />
              )
            )}
          </div>
          <div style={{ textAlign: 'right', marginTop: 12, fontSize: 14 }}>
            รวมทั้งหมด (ทุกหมวด): <strong style={{ color: 'var(--coffee)' }}>{fmtMoney(sum)} ฿</strong>
          </div>
        </>
      )}
    </div>
  );
}

function ViewRow({ row, onEdit, onMsg, canDelete }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  async function onDelete() {
    if (!window.confirm(`ลบ "${row.item_name}" ?`)) return;
    const res = await deleteExpenseAction(row.id);
    onMsg({ text: res.message, type: res.status === 'ok' ? 'ok' : 'err' });
    if (res.status === 'ok') startTransition(() => router.refresh());
  }

  return (
    <div style={rowBox}>
      <div style={{ flex: '1 1 auto', minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 600, fontSize: 14 }}>{row.item_name}</span>
          <span style={catBadge}>{CATEGORY_LABEL[row.category] || row.category}</span>
        </div>
        <div style={{ fontSize: 12, color: 'var(--muted)' }}>
          {row.subcategory ? `${row.subcategory} · ` : ''}
          {fmtMoney(row.quantity)} {row.unit || ''} × {fmtMoney(row.unit_price)} · {row.payment_method}
        </div>
      </div>
      <div style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>{fmtMoney(row.total_amount)} ฿</div>
      <div style={{ display: 'flex', gap: 6 }}>
        {onEdit && <button type="button" style={btnGhost} onClick={onEdit}>แก้ไข</button>}
        {canDelete && <button type="button" style={btnDanger} onClick={onDelete} disabled={isPending}>ลบ</button>}
      </div>
    </div>
  );
}

function EditRow({ row, onDone, onMsg }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [f, setF] = useState({
    item_name: row.item_name || '',
    supplier: row.subcategory || '',
    quantity: row.quantity != null ? String(row.quantity) : '1',
    unit: row.unit || '',
    unit_price: row.unit_price != null ? String(row.unit_price) : '',
    vat: false, // VAT ไม่ได้เก็บแยก — ติ๊กใหม่ถ้าต้องการรวม VAT
    payment_method: row.payment_method || 'บัญชี หจก.',
  });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const price = Number(f.unit_price) || 0;
  const qty = Number(f.quantity) || 0;
  const total = Math.round((f.vat ? price * 1.07 : price) * qty * 100) / 100;

  async function onSave() {
    const res = await updateExpenseAction({ id: row.id, ...f });
    onMsg({ text: res.message, type: res.status === 'ok' ? 'ok' : 'err' });
    if (res.status === 'ok') {
      onDone();
      startTransition(() => router.refresh());
    }
  }

  return (
    <div style={{ ...rowBox, flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
      <div style={editGrid}>
        <input value={f.item_name} onChange={set('item_name')} placeholder="ชื่อรายการ" style={inp} />
        <input value={f.supplier} onChange={set('supplier')} placeholder="ผู้ขาย" style={inp} />
        <NumberInput value={f.quantity} onChange={(v) => setF({ ...f, quantity: v })} placeholder="จำนวน" style={inp} />
        <input value={f.unit} onChange={set('unit')} placeholder="หน่วย" style={inp} />
        <NumberInput value={f.unit_price} onChange={(v) => setF({ ...f, unit_price: v })} placeholder="ราคา/หน่วย" style={inp} />
        <select value={f.payment_method} onChange={set('payment_method')} style={inp}>
          {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
          <input type="checkbox" checked={f.vat} onChange={(e) => setF({ ...f, vat: e.target.checked })} /> VAT 7%
        </label>
        <div style={{ fontSize: 13 }}>รวม: <strong style={{ color: 'var(--coffee)' }}>{fmtMoney(total)} ฿</strong></div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button type="button" style={btnPrimary} onClick={onSave} disabled={isPending}>บันทึก</button>
          <button type="button" style={btnGhost} onClick={onDone}>ยกเลิก</button>
        </div>
      </div>
    </div>
  );
}

const rowBox = { display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '10px 12px' };
const editGrid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8 };
const inp = { width: '100%', padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', fontSize: 13 };
const btnBase = { border: 0, borderRadius: 'var(--radius-md)', padding: '6px 12px', fontSize: 12, cursor: 'pointer', fontWeight: 600 };
const btnGhost = { ...btnBase, background: '#f5ede3', color: 'var(--coffee)' };
const btnDanger = { ...btnBase, background: '#fff0f0', color: 'var(--danger)' };
const btnPrimary = { ...btnBase, background: 'var(--coffee)', color: '#fff' };
const catBadge = { fontSize: 11, color: 'var(--coffee)', background: '#f5ede3', borderRadius: 'var(--radius-full)', padding: '2px 8px', fontWeight: 600 };
