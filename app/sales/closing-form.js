'use client';

import { useState } from 'react';
import { closingTotals, salesSnapshot, amountText } from '../../lib/reconciliation';
import CloseEvidence from './close-evidence';
import { MoneyField, Message, useReconciliationCommand } from './reconciliation-ui';

export default function ClosingForm({ date, sales, state, canCreate, canEdit, canAttach }) {
  const [closing, setClosing] = useState(state.closing);
  const [f, setF] = useState(Object.fromEntries(['printed_pos', 'opening_float', 'cash_count', 'cash_in', 'cash_out', 'note']
    .map((k) => [k, state.closing?.[k] ?? ''])));
  const { busy, message, send } = useReconciliationCommand();
  const set = (k) => (value) => setF((old) => ({ ...old, [k]: value }));
  const totals = closingTotals(sales || {}, f);
  const editable = sales && (closing ? canEdit : canCreate);
  async function save(e) {
    e.preventDefault();
    const result = await send('close.save', { ...f, date, version: closing?.version || 0, sales_snapshot: salesSnapshot(sales) });
    if (result) setClosing(result.closing);
  }
  return <section className="recon-card" aria-labelledby="closing-heading">
    <h2 id="closing-heading">ปิดร้านและตรวจเงิน</h2>
    {!state.ready ? <p role="status">{state.error || 'ระบบบันทึกปิดร้านอยู่ระหว่างเตรียมเปิดใช้งาน ยอดขายยังบันทึกได้ตามปกติ'}</p>
      : !sales ? <p className="muted">บันทึกยอดขายด้านบนก่อน แล้วกลับมาตรวจยอดและแนบหลักฐานที่นี่</p>
        : <>
          <p className="muted">ใช้ยอดขายที่บันทึกแล้วของวันที่ {date} · ยอด POS = เงินสด + K-Shop + LINE MAN ตามรูปแบบใบปิดรอบของร้าน</p>
          {state.stale && !message?.result && <p role="alert" className="recon-message recon-warning">ยอดขายถูกแก้หลังปิดร้าน ผลตรวจเดิมอ้างอิงยอดก่อนแก้ กรุณาตรวจและบันทึกการปิดร้านอีกครั้ง</p>}
          {closing && <p className="muted">บันทึกครั้งที่ {closing.version} · {new Date(closing.updated_at).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })}</p>}
          <form onSubmit={save}>
            <fieldset disabled={!editable || busy}>
              <div className="recon-grid">
                <MoneyField label="ยอดสุทธิบนใบ POS" value={f.printed_pos} onChange={set('printed_pos')} required />
                <MoneyField label="เงินทอนตั้งต้น" value={f.opening_float} onChange={set('opening_float')} required />
                <MoneyField label="เงินสดนับได้รวมเงินทอน" value={f.cash_count} onChange={set('cash_count')} required />
                <MoneyField label="เงินเข้าลิ้นชักเพิ่ม ไม่รวมยอดขาย" value={f.cash_in} onChange={set('cash_in')} />
                <MoneyField label="เงินออกลิ้นชักระหว่างวัน" value={f.cash_out} onChange={set('cash_out')} />
              </div>
              <label className="recon-field">เหตุผลส่วนต่าง / เงินเข้าออก / การแก้ไข
                <textarea maxLength={1000} value={f.note} onChange={(e) => set('note')(e.target.value)} rows={3} />
              </label>
            </fieldset>
            <div className="recon-grid recon-totals" aria-live="polite">
              <div>POS ที่ควรได้<strong>{amountText(totals.expected_pos)} ฿</strong></div>
              <div>เงินสดที่ควรนับได้<strong>{amountText(totals.expected_cash)} ฿</strong></div>
              <div>ส่วนต่าง POS<strong>{f.printed_pos === '' ? 'ยังไม่กรอก' : `${amountText(totals.pos_difference)} ฿`}</strong></div>
              <div>ส่วนต่างเงินสด<strong>{f.cash_count === '' || f.opening_float === '' ? 'ยังไม่กรอก' : `${amountText(totals.cash_difference)} ฿`}</strong></div>
            </div>
            <p className="muted">ส่วนต่าง = ยอดจริง − ยอดที่ควรได้ · ค่าลบคือขาด ค่าบวกคือเกิน · การปิดร้านไม่ลงรายจ่ายหรือเปลี่ยนยอดขาย</p>
            {editable ? <button className="recon-button recon-primary" disabled={busy} type="submit">
              {busy ? 'กำลังบันทึก…' : closing ? 'บันทึกการตรวจใหม่' : 'บันทึกปิดร้าน'}</button>
              : <p className="muted">{closing ? 'ดูข้อมูลที่บันทึกแล้ว หากต้องการแก้ไขให้ติดต่อผู้จัดการ' : 'คุณมีสิทธิ์ดูข้อมูลปิดร้านเท่านั้น'}</p>}
          </form>
          <Message message={message} />
          <CloseEvidence date={date} canUpload={canAttach} />
        </>}
  </section>;
}
