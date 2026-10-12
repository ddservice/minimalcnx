'use client';
import Icon from '../../components/icon';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import DateField from '../../components/date-field';
import { stripDigits, digitsOnly } from '../../lib/format';
import { computeWht, WHT_CONDITIONS } from '../../lib/wht';
import { form50Html, FORM50_COPIES } from '../../lib/form50-template';
import { saveForm50Payees } from './actions';

const fmt = (n) => Number(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const todayISO = () => new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
const thaiDate = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' });

// detail = ชนิดเงินได้ที่ระบุในข้อ 5 ของแบบ (จ่ายตามคำสั่งกรมสรรพากรที่ออกตามมาตรา 3 เตรส)
const ITEMS = [
  { id: 'rent', no: 1, label: 'ค่าเช่าร้าน', rate: 0.05, rateLabel: '5%', detail: 'ค่าเช่า' },
  { id: 'staff_sub', no: 2, label: 'ค่าพนักงานแทน (รับเหมา)', rate: 0.03, rateLabel: '3%', detail: 'ค่าบริการ' },
];

// ที่ผู้ใช้เลือกได้จริงในระบบนี้: บุคคลธรรมดา → ภ.ง.ด.3, นิติบุคคล → ภ.ง.ด.53
const PND_CHOICES = [
  { value: '4', label: 'ผู้รับเป็นบุคคลธรรมดา (ภ.ง.ด.3)' },
  { value: '7', label: 'ผู้รับเป็นนิติบุคคล (ภ.ง.ด.53)' },
];

export default function Form50({ amounts, yearAmounts = {}, payees, bizInfo, monthLabel, canEdit = false, isAdmin = false }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [msg, setMsg] = useState(null);
  const [state, setState] = useState(() => {
    const s = {};
    ITEMS.forEach((it) => {
      const pv = payees?.[it.id] || {};
      s[it.id] = {
        name: pv.name || '', taxid: pv.taxid || '', addr: pv.addr || '', date: pv.date || '',
        cond: pv.cond || '1', pnd: pv.pnd || '4', seq: pv.seq || '1',
        // บัญชีรับโอน — เก็บไว้ใช้ตอนจ่าย ไม่ได้พิมพ์ลงใบ 50 ทวิ
        bank: pv.bank || '', account: pv.account || '',
        // วันที่จ่ายเงินจริง แยกตามเดือน { '09/2026': '2026-09-05' } — ต่างกันทุกเดือน จึงไม่เก็บเป็นค่าเดียว
        paidDates: pv.paidDates || {},
        // เงื่อนไขเฉพาะเดือน { '01/2026': '3' } — ทับค่าหลัก (cond) เฉพาะเดือนที่จ่ายต่างจากปกติ
        // เช่น เดือนที่ลืมหักแล้วร้านออกภาษีให้ ขณะที่เดือนอื่นหัก ณ ที่จ่าย
        conds: pv.conds || {},
      };
    });
    return s;
  });
  // ค่าที่อยู่ในฐานข้อมูลล่าสุด — ใช้บอกว่ามีอะไรยังไม่ได้บันทึก
  const [savedJson, setSavedJson] = useState(() => JSON.stringify(state));
  const dirty = JSON.stringify(state) !== savedJson;

  const set = (id, k, v) => setState((s) => ({ ...s, [id]: { ...s[id], [k]: v } }));
  const condOf = (pv, month) => pv.conds?.[month] || pv.cond;
  // '' = กลับไปใช้ค่าหลัก (ลบ key ทิ้ง ไม่เก็บค่าว่างค้างไว้)
  const setCond = (id, month, v) => setState((s) => {
    const conds = { ...s[id].conds };
    if (v) conds[month] = v; else delete conds[month];
    return { ...s, [id]: { ...s[id], conds } };
  });
  const setPaid = (id, v, month = monthLabel) => setState((s) => ({ ...s, [id]: { ...s[id], paidDates: { ...s[id].paidDates, [month]: v } } }));

  // ── พิมพ์หลายเดือน / ทั้งปี ──
  const year = String(monthLabel).split('/')[1];
  const MONTHS = Array.from({ length: 12 }, (_, i) => `${String(i + 1).padStart(2, '0')}/${year}`);
  // ยอดของเดือนที่กำลังเปิดอยู่ใช้ค่าจาก amounts (ตรงกับฟอร์มด้านบน) เดือนอื่นใช้ยอดที่บันทึกไว้ทั้งปี
  const amtOf = (id, month) => Number(month === monthLabel ? amounts?.[id] : yearAmounts?.[id]?.[month]) || 0;
  const [multi, setMulti] = useState({}); // { [id]: { open, sel: { 'MM/YYYY': true }, day } }
  const multiOf = (id) => multi[id] || { open: false, sel: {}, day: '' };
  const setMultiOf = (id, patch) => setMulti((m) => ({ ...m, [id]: { ...multiOf(id), ...m[id], ...patch } }));
  function toggleMulti(id) {
    const cur = multiOf(id);
    // เปิดครั้งแรก → เลือกทุกเดือนที่มียอดให้เลย (กรณีใช้บ่อยสุดคือออกทั้งปี)
    const sel = Object.keys(cur.sel).length ? cur.sel : Object.fromEntries(MONTHS.filter((m) => amtOf(id, m) > 0).map((m) => [m, true]));
    setMultiOf(id, { open: !cur.open, sel });
  }
  // เติมวันที่จ่ายให้เดือนที่เลือกและยังว่าง ด้วยวันเดียวกันของทุกเดือน (ค่าเช่ามักจ่ายวันเดิม) — เกินสิ้นเดือนให้ใช้วันสุดท้าย
  function fillDay(id) {
    const cur = multiOf(id);
    const day = Number(cur.day);
    if (!day || day < 1 || day > 31) { setMsg({ text: 'ใส่วันที่จ่าย 1–31 ก่อน', type: 'err' }); return; }
    setState((s) => {
      const paidDates = { ...s[id].paidDates };
      MONTHS.forEach((m) => {
        if (!cur.sel[m] || paidDates[m]) return;
        const [mm, yy] = m.split('/');
        const last = new Date(Number(yy), Number(mm), 0).getDate();
        paidDates[m] = `${yy}-${mm}-${String(Math.min(day, last)).padStart(2, '0')}`;
      });
      return { ...s, [id]: { ...s[id], paidDates } };
    });
  }

  async function onSave() {
    setMsg(null);
    const snapshot = JSON.stringify(state);
    const res = await saveForm50Payees(state);
    setMsg({ text: res.message, type: res.status === 'ok' ? 'ok' : 'err' });
    if (res.status === 'ok') {
      setSavedJson(snapshot);
      startTransition(() => router.refresh());
    }
  }

  // months = [{ month: 'MM/YYYY', amt }] — เดือนเดียวหรือหลายเดือนใช้ทางเดียวกัน
  function printMonths(it, months) {
    const list = months.filter((m) => m.amt > 0);
    if (!list.length) { setMsg({ text: `ยังไม่มียอด${it.label}ในเดือนที่เลือก (บันทึกค่าดำเนินการของเดือนนั้นก่อน)`, type: 'err' }); return; }
    const pv = state[it.id];
    const biz = bizInfo || {};

    // เอกสารภาษี — ข้อมูลไม่ครบห้ามพิมพ์ ดีกว่าได้ใบที่มีขีด "—" ไปยื่น
    const missing = [];
    if (!String(biz.name || '').trim()) missing.push('ชื่อผู้จ่ายเงิน (ตั้งค่าร้าน)');
    if (String(biz.tax_id || '').replace(/\D/g, '').length !== 13) missing.push('เลขผู้เสียภาษี 13 หลักของร้าน (ตั้งค่าร้าน)');
    if (!String(biz.address || '').trim()) missing.push('ที่อยู่ร้าน (ตั้งค่าร้าน)');
    if (!pv.name.trim()) missing.push('ชื่อผู้รับเงิน');
    if (pv.taxid.length !== 13) missing.push('เลขผู้เสียภาษี/บัตรประชาชน 13 หลักของผู้รับเงิน');
    if (!pv.addr.trim()) missing.push('ที่อยู่ผู้รับเงิน');
    const noDate = list.filter((m) => !pv.paidDates?.[m.month]).map((m) => m.month);
    if (noDate.length) missing.push(`วันที่จ่ายเงินจริงของเดือน ${noDate.join(', ')}`);
    if (missing.length) { setMsg({ text: `ยังพิมพ์ 50 ทวิ ${it.label} ไม่ได้ — ขาด: ${missing.join(' · ')}`, type: 'err' }); return; }

    const issueDateText = thaiDate(pv.date || todayISO());
    const docs = list.map(({ month, amt }) => {
      const cond = condOf(pv, month);
      const { paid, tax } = computeWht(amt, it.rate, cond);
      const [mm, yy] = String(month).split('/');
      return {
        bookNo: String((Number(yy) || 0) + 543),              // เล่มที่ = ปี พ.ศ.
        docNo: `${mm}/${String(it.no).padStart(2, '0')}`,       // เลขที่ = เดือน/ลำดับรายการ (ไม่ซ้ำกันในปีเดียวกัน)
        payer: { name: biz.name, taxId: biz.tax_id, address: biz.address },
        payee: { name: pv.name, taxId: pv.taxid, address: pv.addr },
        pnd: pv.pnd, seq: pv.seq || '1',
        row: 5, detail: it.detail, dateText: thaiDate(pv.paidDates[month]),
        paid, tax, cond, issueDateText,
      };
    });
    const range = list.length > 1 ? `${list[0].month} - ${list[list.length - 1].month}` : list[0].month;
    const html = form50Html({ title: `50 ทวิ ${it.label} ${range}`, docs });
    const w = window.open('', '_blank', 'width=820,height=960');
    if (!w) { setMsg({ text: 'เบราว์เซอร์บล็อกป๊อปอัป — โปรดอนุญาต', type: 'err' }); return; }
    w.document.write(html); w.document.close(); w.focus();
    setTimeout(() => w.print(), 400);

    // พิมพ์แล้วเก็บข้อมูลผู้รับเงินให้เลย — เดิมต้องกดปุ่ม "บันทึกข้อมูลผู้รับเงิน" แยกต่างหาก
    // พอพิมพ์เสร็จแล้วปิดหน้า ข้อมูลหายทุกครั้ง ต้องพิมพ์ชื่อ/เลขบัตร/ที่อยู่ใหม่ทุกเดือน
    // (เปิดหน้าต่างพิมพ์ก่อนแล้วค่อยบันทึก — ถ้า await ก่อน เบราว์เซอร์จะบล็อกป๊อปอัป)
    if (canEdit && dirty) {
      const snapshot = JSON.stringify(state);
      saveForm50Payees(state).then((res) => {
        if (res.status === 'ok') setSavedJson(snapshot);
        else setMsg({ text: `พิมพ์แล้ว แต่บันทึกข้อมูลผู้รับเงินไม่สำเร็จ: ${res.message}`, type: 'err' });
      }).catch(() => setMsg({ text: 'พิมพ์แล้ว แต่บันทึกข้อมูลผู้รับเงินไม่สำเร็จ — กด "บันทึกข้อมูลผู้รับเงิน" อีกครั้ง', type: 'err' }));
    }
  }

  const print = (it) => printMonths(it, [{ month: monthLabel, amt: amtOf(it.id, monthLabel) }]);

  return (
    <div className="card" style={{ marginTop: 12 }}>
      <div className="card-head"><Icon name="ti-file-invoice" /><h2>หนังสือรับรองหัก ณ ที่จ่าย (50 ทวิ)</h2></div>
      <div className="card-body">
        <p className="muted" style={{ fontSize: 'var(--fs-sm)', marginTop: -4, marginBottom: 14 }}>
          ออกให้ผู้รับเงิน (เจ้าของที่เช่า / ผู้รับเหมา) — ยอดดึงจากที่บันทึกในเดือน {monthLabel} · พิมพ์ครั้งละ 3 ฉบับ (ให้ผู้รับเงินฉบับที่ 1–2 ร้านเก็บฉบับที่ 3)
        </p>
        {ITEMS.map((it) => {
          const amt = Number(amounts?.[it.id]) || 0;
          const pv = state[it.id];
          const { paid, tax } = computeWht(amt, it.rate, condOf(pv, monthLabel));
          return (
            <div key={it.id} style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: 14, marginBottom: 12, background: 'var(--beige)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
                <strong style={{ fontSize: 'var(--fs-md)' }}>{it.label} — หัก ณ ที่จ่าย {it.rateLabel}</strong>
                <span style={{ fontSize: 'var(--fs-base)', color: 'var(--muted)' }}>เงินได้ {fmt(paid)} · ภาษี <strong style={{ color: 'var(--danger)' }}>{fmt(tax)}</strong> ฿</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8 }}>
                <input className="input" disabled={!canEdit} placeholder="ชื่อผู้รับเงิน" value={pv.name} onChange={(e) => set(it.id, 'name', stripDigits(e.target.value))} />
                <input className="input" disabled={!canEdit} inputMode="numeric" maxLength={13} placeholder="เลขผู้เสียภาษี/บัตรปชช. 13 หลัก" value={pv.taxid} onChange={(e) => set(it.id, 'taxid', digitsOnly(e.target.value).slice(0, 13))} />
                <input className="input" disabled={!canEdit} style={{ gridColumn: '1 / -1' }} placeholder="ที่อยู่ผู้รับเงิน" value={pv.addr} onChange={(e) => set(it.id, 'addr', e.target.value)} />
                <input className="input" disabled={!canEdit} placeholder="ธนาคาร (สำหรับโอน)" value={pv.bank} onChange={(e) => set(it.id, 'bank', e.target.value)} />
                <input className="input" disabled={!canEdit} inputMode="numeric" placeholder="เลขที่บัญชี" value={pv.account} onChange={(e) => set(it.id, 'account', digitsOnly(e.target.value))} />
                <select className="input" disabled={!canEdit} value={pv.pnd} onChange={(e) => set(it.id, 'pnd', e.target.value)}>
                  {PND_CHOICES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
                <select className="input" disabled={!canEdit} value={pv.cond} onChange={(e) => set(it.id, 'cond', e.target.value)} title="เงื่อนไขปกติ ใช้กับทุกเดือนที่ไม่ได้ตั้งแยก">
                  {WHT_CONDITIONS.map((c) => <option key={c.value} value={c.value}>ปกติ: ({c.value}) {c.label}</option>)}
                </select>
                <select className="input" disabled={!canEdit} value={pv.conds?.[monthLabel] || ''} onChange={(e) => setCond(it.id, monthLabel, e.target.value)} title="ตั้งเฉพาะเดือนนี้ เมื่อจ่ายต่างจากปกติ">
                  <option value="">เดือน {monthLabel}: ตามปกติ</option>
                  {WHT_CONDITIONS.map((c) => <option key={c.value} value={c.value}>เดือน {monthLabel}: ({c.value}) {c.label}</option>)}
                </select>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8, marginTop: 8 }}>
                <div>
                  <label style={lbl}>วันที่จ่ายเงินจริง — เดือน {monthLabel} *</label>
                  <DateField value={pv.paidDates?.[monthLabel] || ''} onChange={(v) => setPaid(it.id, v)} placeholder="เลือกวันที่จ่าย" />
                </div>
                <div>
                  <label style={lbl}>ลำดับที่ในแบบ ภ.ง.ด.</label>
                  <input className="input" disabled={!canEdit} inputMode="numeric" maxLength={3} value={pv.seq} onChange={(e) => set(it.id, 'seq', digitsOnly(e.target.value))} />
                </div>
                {/* วันที่ออกหนังสือใช้วันที่พิมพ์จริงเสมอ เว้นแต่ admin ตั้งวันตายตัวไว้ (เช่น ออกย้อนหลัง) —
                    ค่านี้ค้างถาวรจนกว่าจะล้าง ไม่ใช่แค่ครั้งเดียว */}
                {isAdmin && (
                  <div>
                    <label style={lbl}>วันที่ออกหนังสือ (เว้นว่าง = วันที่พิมพ์ · เฉพาะ Admin)</label>
                    <DateField value={pv.date} onChange={(v) => set(it.id, 'date', v)} placeholder="ใช้วันที่พิมพ์จริง" />
                  </div>
                )}
              </div>
              <div style={{ marginTop: 10, display: 'flex', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
                <button type="button" className="btn btn-ghost" onClick={() => toggleMulti(it.id)}>
                  <Icon name="ti-calendar-event" /> {multiOf(it.id).open ? 'ซ่อนหลายเดือน' : `พิมพ์หลายเดือน / ทั้งปี ${year}`}
                </button>
                <button type="button" className="btn btn-gold" onClick={() => print(it)}><Icon name="ti-printer" /> พิมพ์ 50 ทวิ เดือน {monthLabel}</button>
              </div>

              {multiOf(it.id).open && (() => {
                const mu = multiOf(it.id);
                const picked = MONTHS.filter((m) => mu.sel[m] && amtOf(it.id, m) > 0);
                const setSel = (sel) => setMultiOf(it.id, { sel });
                return (
                  <div style={{ marginTop: 10, border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', background: 'var(--surface)', padding: 12 }}>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10, fontSize: 'var(--fs-sm)' }}>
                      <button type="button" className="link-btn" onClick={() => setSel(Object.fromEntries(MONTHS.filter((m) => amtOf(it.id, m) > 0).map((m) => [m, true])))}>เลือกทุกเดือนที่มียอด</button>
                      <button type="button" className="link-btn" onClick={() => setSel({})}>ไม่เลือกเลย</button>
                      <span className="muted" style={{ marginLeft: 'auto' }}>จ่ายทุกวันที่</span>
                      <input className="input" inputMode="numeric" maxLength={2} placeholder="เช่น 5" value={mu.day} onChange={(e) => setMultiOf(it.id, { day: digitsOnly(e.target.value) })} style={{ width: 80 }} />
                      <button type="button" className="link-btn" onClick={() => fillDay(it.id)}>เติมวันที่ให้เดือนที่ยังว่าง</button>
                    </div>
                    <div style={{ display: 'grid', gap: 6 }}>
                      {MONTHS.map((m) => {
                        const a = amtOf(it.id, m);
                        const w = computeWht(a, it.rate, condOf(pv, m));
                        return (
                          <div key={m} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', opacity: a > 0 ? 1 : 0.5 }}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 110, fontSize: 'var(--fs-base)', cursor: a > 0 ? 'pointer' : 'default' }}>
                              <input type="checkbox" disabled={a <= 0} checked={!!mu.sel[m] && a > 0} onChange={(e) => setSel({ ...mu.sel, [m]: e.target.checked })} />
                              {m}
                            </label>
                            <span style={{ flex: '1 1 160px', fontSize: 'var(--fs-sm)', color: 'var(--muted)' }}>
                              {a > 0 ? `เงินได้ ${fmt(w.paid)} · ภาษี ${fmt(w.tax)} ฿` : 'ยังไม่มียอดที่บันทึก'}
                            </span>
                            {a > 0 && (
                              <select className="input" disabled={!canEdit} value={pv.conds?.[m] || ''} onChange={(e) => setCond(it.id, m, e.target.value)} style={{ width: 170 }}>
                                <option value="">ตามปกติ</option>
                                {WHT_CONDITIONS.map((c) => <option key={c.value} value={c.value}>({c.value}) {c.label}</option>)}
                              </select>
                            )}
                            {a > 0 && (
                              <div style={{ width: 180 }}>
                                <DateField value={pv.paidDates?.[m] || ''} onChange={(v) => setPaid(it.id, v, m)} placeholder="วันที่จ่ายจริง" />
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    <div style={{ marginTop: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span className="muted" style={{ fontSize: 'var(--fs-sm)' }}>เลือก {picked.length} เดือน · พิมพ์ {picked.length * FORM50_COPIES.length} หน้า (เดือนละ {FORM50_COPIES.length} ฉบับ)</span>
                      <button type="button" className="btn btn-gold" disabled={!picked.length} onClick={() => printMonths(it, picked.map((m) => ({ month: m, amt: amtOf(it.id, m) })))}>
                        <Icon name="ti-printer" /> พิมพ์ {picked.length} เดือนที่เลือก
                      </button>
                    </div>
                  </div>
                );
              })()}
            </div>
          );
        })}
        {canEdit ? (
          <>
          <button type="button" className="btn btn-coffee" onClick={onSave} disabled={isPending}>
            <Icon name="ti-device-floppy" /> {isPending ? 'กำลังบันทึก...' : 'บันทึกข้อมูลผู้รับเงิน'}
          </button>
          {dirty && <span style={{ marginLeft: 10, fontSize: 'var(--fs-sm)', color: 'var(--danger)' }}>มีข้อมูลที่ยังไม่ได้บันทึก</span>}
          </>
        ) : (
          <p className="muted" style={{ fontSize: 'var(--fs-sm)' }}><Icon name="ti-lock" /> เฉพาะ Admin หรือ Co-Admin แก้ไขข้อมูลผู้รับเงินได้ (พิมพ์เอกสารได้ตามปกติ)</p>
        )}
        {msg && <div style={{ marginTop: 12, fontSize: 'var(--fs-md)', color: msg.type === 'ok' ? 'var(--success)' : 'var(--danger)' }}>{msg.text}</div>}
      </div>
    </div>
  );
}

const lbl = { display: 'block', fontSize: 'var(--fs-xs)', color: 'var(--muted)', marginBottom: 4 };
