'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { EXPENSE_CATEGORIES, PAYMENT_METHODS } from '../../lib/expense-categories';
import { SUPPLIERS_ITEMS } from '../../lib/suppliers';
import { BAKERY_DEFAULTS } from '../../lib/bakery';
import { BASIC_UNITS } from '../../lib/units';
import NumberInput from '../../components/number-input';
import DateField from '../../components/date-field';
import { saveExpensesAction } from './actions';

const MATERIAL_CATEGORY = 'ต้นทุนวัตถุดิบ';
const BAKERY_CATEGORY = 'ต้นทุนขนมหน้าร้าน';
const SUPPLIER_KEYS = Object.keys(SUPPLIERS_ITEMS);
const BAKERY_KEYS = Object.keys(BAKERY_DEFAULTS);

const fmt = (n) => Number(n || 0).toLocaleString('th-TH', { maximumFractionDigits: 2 });

const emptyRow = () => ({
  item_name: '',
  supplier: '',
  quantity: '1',
  unit: '',
  unit_price: '',
  vat: false,
  payment_method: 'บัญชี หจก.',
});

function rowTotal(r) {
  const price = Number(r.unit_price) || 0;
  const qty = Number(r.quantity) || 0;
  return Math.round((r.vat ? price * 1.07 : price) * qty * 100) / 100;
}

export default function ExpenseForm({ date, category, catalog = [], onCategory }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [msg, setMsg] = useState(null);
  const isMaterial = category === MATERIAL_CATEGORY;
  const isBakery = category === BAKERY_CATEGORY;
  const [lastSupplier, setLastSupplier] = useState(''); // ค้างซัพพลายเออร์ล่าสุดให้แถวถัดไป
  const [rows, setRows] = useState([emptyRow()]);

  const grand = rows.reduce((a, r) => a + rowTotal(r), 0);

  const catMap = {};
  catalog.forEach((c) => { catMap[c.name] = c; });

  const setRow = (i, k, v) =>
    setRows(rows.map((r, idx) => (idx === i ? { ...r, [k]: v } : r)));
  const addRow = () => setRows([...rows, { ...emptyRow(), supplier: isMaterial ? lastSupplier : '' }]);
  const removeRow = (i) => setRows(rows.length > 1 ? rows.filter((_, idx) => idx !== i) : rows);

  // เลือกซัพพลายเออร์ → เคลียร์รายการ (รายการเปลี่ยนตามเจ้า) + จำไว้ให้แถวถัดไป
  function onSupplier(i, sup) {
    setLastSupplier(sup);
    setRows(rows.map((r, idx) => (idx === i ? { ...r, supplier: sup, item_name: '' } : r)));
  }

  // เลือก/พิมพ์ชื่อที่เคยบันทึก → เติมผู้ขาย/หน่วย/ราคาล่าสุดให้ (เฉพาะช่องที่ยังว่าง)
  function onItemName(i, value) {
    const hit = catMap[value.trim()];
    setRows(rows.map((r, idx) => {
      if (idx !== i) return r;
      const next = { ...r, item_name: value };
      if (hit) {
        if (!r.supplier && hit.supplier) next.supplier = hit.supplier;
        if (!r.unit && hit.unit) next.unit = hit.unit;
        if ((r.unit_price === '' || r.unit_price == null) && hit.unit_price != null)
          next.unit_price = String(hit.unit_price);
      }
      // ราคาตั้งต้นของขนม (ถ้ายังไม่มีราคาจาก catalog)
      const bakDef = isBakery ? BAKERY_DEFAULTS[value.trim()] : null;
      if (bakDef != null && (next.unit_price === '' || next.unit_price == null))
        next.unit_price = String(bakDef);
      return next;
    }));
  }

  // เปลี่ยนวันที่ = โหลดข้อมูลวันใหม่ (คงหมวดเดิม); เปลี่ยนหมวด = ฝั่ง client ทันที
  function navDate(nextDate) {
    router.push(`/expenses?date=${nextDate}&category=${encodeURIComponent(category)}`);
  }

  async function onSubmit(e) {
    e.preventDefault();
    setMsg(null);
    let res = await saveExpensesAction({ date, category, rows });
    if (res.status === 'confirm') {
      if (!window.confirm(res.message)) {
        setMsg({ text: 'ยกเลิกการบันทึก (ตรวจพบรายการซ้ำ)', type: 'err' });
        return;
      }
      res = await saveExpensesAction({ date, category, rows, force: true });
    }
    setMsg({ text: res.message, type: res.status === 'ok' ? 'ok' : 'err' });
    if (res.status === 'ok') {
      setRows([{ ...emptyRow(), supplier: isMaterial ? lastSupplier : '' }]);
      startTransition(() => router.refresh());
    }
  }

  return (
    <form onSubmit={onSubmit}>
      <datalist id="exp-catalog">
        {catalog.map((c) => <option key={c.name} value={c.name} />)}
      </datalist>
      <datalist id="exp-units">
        {BASIC_UNITS.map((u) => <option key={u} value={u} />)}
      </datalist>
      {isBakery && (
        <datalist id="exp-bakery">
          {BAKERY_KEYS.map((b) => <option key={b} value={b} />)}
        </datalist>
      )}

      {/* วันที่ + หมวด */}
      <div style={card}>
        <div style={grid}>
          <div>
            <label style={lbl}>วันที่</label>
            <DateField value={date} onChange={(v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && navDate(v)} />
          </div>
          <div>
            <label style={lbl}>หมวดหมู่</label>
            <select value={category} onChange={(e) => onCategory(e.target.value)} style={inp}>
              {EXPENSE_CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* รายการ */}
      {rows.map((r, i) => (
        <div key={i} style={card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <strong style={{ fontSize: 13, color: 'var(--muted)' }}>รายการที่ {i + 1}</strong>
            {rows.length > 1 && (
              <button type="button" onClick={() => removeRow(i)} style={btnRemove}>ลบ</button>
            )}
          </div>
          <div style={grid}>
            {isMaterial ? (
              <>
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={lbl}>ซัพพลายเออร์ *</label>
                  <select value={r.supplier} onChange={(e) => onSupplier(i, e.target.value)} style={inp}>
                    <option value="">— เลือกซัพพลายเออร์ —</option>
                    {SUPPLIER_KEYS.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={lbl}>รายการสินค้า *</label>
                  <input list={`items-${i}`} value={r.item_name} onChange={(e) => onItemName(i, e.target.value)}
                    placeholder={r.supplier ? 'เลือก/พิมพ์รายการ' : 'เลือกซัพพลายเออร์ก่อน'} disabled={!r.supplier} style={inp} />
                  <datalist id={`items-${i}`}>
                    {(SUPPLIERS_ITEMS[r.supplier] || []).map((it) => <option key={it} value={it} />)}
                  </datalist>
                  <LastPrice catMap={catMap} name={r.item_name} />
                </div>
              </>
            ) : (
              <>
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={lbl}>ชื่อรายการ *</label>
                  <input list={isBakery ? 'exp-bakery' : 'exp-catalog'} value={r.item_name} onChange={(e) => onItemName(i, e.target.value)} placeholder={isBakery ? 'เลือก/พิมพ์ชื่อขนม' : 'เช่น น้ำยาล้างจาน'} style={inp} />
                  <LastPrice catMap={catMap} name={r.item_name} />
                </div>
                <div>
                  <label style={lbl}>ผู้ขาย/ซัพพลายเออร์</label>
                  <input value={r.supplier} onChange={(e) => setRow(i, 'supplier', e.target.value)} style={inp} />
                </div>
              </>
            )}
            <div>
              <label style={lbl}>จำนวน</label>
              <NumberInput value={r.quantity} onChange={(v) => setRow(i, 'quantity', v)} style={inp} />
            </div>
            <div>
              <label style={lbl}>หน่วย</label>
              <input list="exp-units" value={r.unit} onChange={(e) => setRow(i, 'unit', e.target.value)} placeholder="เลือก/พิมพ์" style={inp} />
            </div>
            <div>
              <label style={lbl}>ราคา/หน่วย (฿) *</label>
              <NumberInput value={r.unit_price} onChange={(v) => setRow(i, 'unit_price', v)} placeholder="0" style={inp} />
            </div>
            <div>
              <label style={lbl}>ชำระด้วย</label>
              <select value={r.payment_method} onChange={(e) => setRow(i, 'payment_method', e.target.value)} style={inp}>
                {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                <input type="checkbox" checked={r.vat} onChange={(e) => setRow(i, 'vat', e.target.checked)} />
                VAT 7%
              </label>
            </div>
          </div>
          <div style={{ textAlign: 'right', marginTop: 8, fontSize: 13 }}>
            รวม: <strong style={{ color: 'var(--coffee)' }}>{fmt(rowTotal(r))} ฿</strong>
            {r.vat && <span style={{ color: 'var(--muted)', fontSize: 11 }}> (รวม VAT)</span>}
          </div>
        </div>
      ))}

      <button type="button" onClick={addRow} style={btnAdd}>+ เพิ่มรายการ</button>

      {/* สรุป + บันทึก */}
      <div style={{ ...card, background: '#f5ede3', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>ยอดรวมที่จะบันทึก</div>
          <div style={{ fontSize: 26, fontWeight: 700, color: 'var(--coffee)' }}>{fmt(grand)} ฿</div>
        </div>
        <button type="submit" style={btnSave} disabled={isPending}>
          {isPending ? 'กำลังบันทึก...' : 'บันทึกรายจ่าย'}
        </button>
      </div>

      {msg && (
        <div style={{ marginTop: 14, marginBottom: 20, color: msg.type === 'ok' ? '#1e7e34' : '#c0392b', fontSize: 14 }}>
          {msg.text}
        </div>
      )}
    </form>
  );
}

function LastPrice({ catMap, name }) {
  const [open, setOpen] = useState(false);
  const hit = catMap[(name || '').trim()];
  if (!hit || hit.unit_price == null) return null;
  const hist = hit.history || [];
  return (
    <div style={{ fontSize: 11, color: 'var(--taupe-dark)', marginTop: 3 }}>
      ราคาล่าสุด: {fmt(hit.unit_price)} ฿{hit.unit ? ` / ${hit.unit}` : ''}
      {hist.length > 1 && (
        <button type="button" onClick={() => setOpen(!open)}
          style={{ marginLeft: 8, background: 'none', border: 'none', color: 'var(--taupe-dark)', textDecoration: 'underline', cursor: 'pointer', fontSize: 11, padding: 0 }}>
          {open ? 'ซ่อน' : `ประวัติราคา (${hist.length})`}
        </button>
      )}
      {open && (
        <div style={{ marginTop: 4, paddingLeft: 8, borderLeft: '2px solid var(--border)' }}>
          {hist.map((h, i) => <div key={i}>{h.date || '—'} : {fmt(h.price)} ฿</div>)}
        </div>
      )}
    </div>
  );
}

const card = { border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: 16, background: 'var(--surface)', marginBottom: 12 };
const grid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 };
const lbl = { display: 'block', fontSize: 12, color: 'var(--muted)', marginBottom: 4 };
const inp = { width: '100%', padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', fontSize: 14 };
const btnRemove = { border: 0, background: '#fff0f0', color: 'var(--danger)', borderRadius: 'var(--radius-md)', padding: '5px 12px', fontSize: 12, cursor: 'pointer' };
const btnAdd = { border: '1px dashed var(--border)', background: 'var(--surface)', color: 'var(--coffee)', borderRadius: 'var(--radius-md)', padding: '10px', width: '100%', fontSize: 14, cursor: 'pointer', marginBottom: 12, fontWeight: 600 };
const btnSave = { border: 0, borderRadius: 'var(--radius-md)', padding: '12px 22px', fontSize: 15, fontWeight: 700, background: 'var(--coffee)', color: '#fff', cursor: 'pointer' };
