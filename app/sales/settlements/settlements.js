'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import DateField from '../../../components/date-field';
import DataTable from '../../../components/data-table';
import { PLATFORMS, STATEMENT_MONEY, statementNet, settlementStatus, amountText } from '../../../lib/reconciliation';
import { MoneyField, DayField, Message, VoidForm, useReconciliationCommand } from '../reconciliation-ui';

export default function Settlements({ state, month, today, canEdit }) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [filter, setFilter] = useState('all');
  const rows = state.rows.filter((r) => filter === 'all' || (filter === 'open'
    ? !r.voided_at && (Number(r.expected_net) !== Number(r.received_total) || Number(r.sales_difference) !== 0 || r.missing_days > 0)
    : !!r.voided_at));
  return <>
    <section className="recon-card">
      <p>เทียบ 3 ยอด: ยอดขายในระบบ → ใบสรุปแพลตฟอร์ม → เงินเข้าธนาคารจริง</p>
      <p className="muted">ยอดตามใบสรุปใช้ค่าธรรมเนียมจริง ไม่ใช่อัตรา GP ประมาณ และไม่เปลี่ยนยอดขาย รายจ่าย หรือกำไรเดิม</p>
      <div className="recon-grid"><div className="recon-field"><span>รอบใบสรุปที่ทับซ้อนเดือน</span>
        <DateField type="month" value={month} onChange={(value) => {
          if (/^\d{4}-\d{2}$/.test(value)) router.push(`/sales/settlements?month=${value}`);
        }} placeholder="เลือกเดือนใบสรุป" />
      </div><label className="recon-field">แสดงรายการ<select value={filter} onChange={(e) => setFilter(e.target.value)}>
        <option value="all">ทั้งหมด</option><option value="open">ยังต้องตรวจ / รับไม่ครบ</option><option value="void">ยกเลิกแล้ว</option>
      </select></label></div>
      {!state.ready ? <p role="status">{state.error || 'ระบบกระทบยอดอยู่ระหว่างเตรียมเปิดใช้งาน ยอดขายเดิมยังใช้งานได้ตามปกติ'}</p>
        : <>
          {canEdit && <button className="recon-button recon-primary" onClick={() => setAdding(!adding)}>{adding ? 'ปิดฟอร์มเพิ่มใบสรุป' : 'เพิ่มใบสรุปแพลตฟอร์ม'}</button>}
          {adding && <StatementForm month={month} today={today} onSaved={() => setAdding(false)} />}
        </>}
    </section>
    {state.ready && !rows.length && <section className="recon-card"><h2>ยังไม่มีใบสรุปในรายการนี้</h2>
      <p className="muted">{filter === 'all' ? 'เตรียมใบสรุปของแพลตฟอร์ม แล้วเพิ่มรอบยอดขายและยอดหักตามเอกสาร เมื่อเงินเข้าจึงเพิ่มเลขอ้างอิงธนาคาร' : 'ลองเปลี่ยนตัวกรองหรือเลือกเดือนอื่น'}</p>
    </section>}
    {rows.map((row) => <Statement key={row.id} row={row} today={today} month={month} canEdit={canEdit} />)}
  </>;
}

function StatementForm({ initial, month, today, onSaved }) {
  const [f, setF] = useState(() => ({ platform: 'grab', period_from: `${month}-01`,
    period_to: month === today.slice(0,7) ? today : `${month}-${new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),0)).getUTCDate()}`,
    reference: '', due_date: '', note: '', ...Object.fromEntries(Object.keys(STATEMENT_MONEY).map((k) => [k, ''])), ...initial }));
  const { busy, message, send } = useReconciliationCommand();
  const set = (key) => (value) => setF((old) => ({ ...old, [key]: value }));
  async function save(e) {
    e.preventDefault();
    const result = await send('settlement.save', { ...f, id: initial?.id || null, version: initial?.version || 0 });
    if (result) onSaved();
  }
  return <form onSubmit={save} className="recon-card">
    <h3>{initial ? 'แก้ไขใบสรุป' : 'เพิ่มใบสรุปตามเอกสาร'}</h3>
    <p className="muted">หนึ่งแพลตฟอร์มใช้รอบวันที่ที่ไม่ซ้อนกัน หากโอนหลายครั้งให้เพิ่มเงินรับใต้ใบสรุปเดิม · เลขใบสรุปที่ยกเลิกแล้วยังเก็บเป็นประวัติ</p>
    <fieldset disabled={busy}>
      <div className="recon-grid">
        <label className="recon-field">แพลตฟอร์ม<select value={f.platform} onChange={(e) => set('platform')(e.target.value)}>
          {Object.entries(PLATFORMS).map(([key,name]) => <option key={key} value={key}>{name}</option>)}
        </select></label>
        <label className="recon-field">เลขที่ใบสรุป *<input required maxLength={120} value={f.reference} onChange={(e) => set('reference')(e.target.value)} /></label>
        <DayField label="เริ่มรอบยอดขาย" value={f.period_from} onChange={set('period_from')} max={today} />
        <DayField label="สิ้นสุดรอบยอดขาย" value={f.period_to} onChange={set('period_to')} max={today} />
        <DayField label="กำหนดรับเงิน (ถ้ามี)" value={f.due_date || ''} onChange={set('due_date')} />
      </div>
      <div className="recon-grid">{Object.entries(STATEMENT_MONEY).map(([key,label]) =>
        <MoneyField key={key} label={label} value={f[key]} onChange={set(key)} required={key === 'gross'} />)}</div>
      <p className="muted">ใส่ยอดหักแต่ละรายการเพียงครั้งเดียว ถ้าค่าคอมมิชชั่นรวม VAT แล้ว ไม่กรอก VAT ซ้ำ · ภาษีใช้ยอดจริงจากเอกสาร ไม่คำนวณอัตราให้อัตโนมัติ</p>
      <label className="recon-field">หมายเหตุ / เหตุผลแก้ไข<textarea maxLength={1000} value={f.note} onChange={(e) => set('note')(e.target.value)} rows={2} required={!!initial} /></label>
    </fieldset>
    <div className="recon-totals" aria-live="polite">คาดรับสุทธิตามใบสรุป<strong>{amountText(statementNet(f))} ฿</strong></div>
    <div className="recon-actions"><button className="recon-button recon-primary" type="submit" disabled={busy}>{busy ? 'กำลังบันทึก…' : 'บันทึกใบสรุป'}</button></div>
    <Message message={message} />
  </form>;
}

function Statement({ row, today, month, canEdit }) {
  const [editing, setEditing] = useState(false);
  const { busy, message, send } = useReconciliationCommand();
  const status = settlementStatus(row, today);
  const activeReceipts = row.receipts.filter((r) => !r.voided_at);
  return <section className="recon-card">
    <div className="recon-actions"><h2>{PLATFORMS[row.platform]} · {row.reference}</h2>
      <span className={`recon-badge recon-${status.tone}`}>{status.label}</span></div>
    <p>รอบยอดขาย {row.period_from} ถึง {row.period_to}{row.due_date ? ` · กำหนดรับเงิน ${row.due_date}` : ' · ยังไม่ระบุกำหนดรับเงิน'}</p>
    {row.voided_at ? <p className="recon-message">ยกเลิก: {row.void_reason}</p> : null}
    <div className="recon-grid recon-totals">
      <div>ยอดขายในระบบ<strong>{amountText(row.sales_gross)} ฿</strong></div>
      <div>ยอดขายตามใบสรุป<strong>{amountText(row.gross)} ฿</strong></div>
      <div>ส่วนต่างยอดขาย<strong className={Number(row.sales_difference) ? 'recon-danger' : ''}>{amountText(row.sales_difference)} ฿</strong></div>
      <div>คาดรับตามใบสรุป<strong>{amountText(row.expected_net)} ฿</strong></div>
      <div>เงินเข้าจริงรวม<strong>{amountText(row.received_total)} ฿</strong></div>
      <div>ยังขาดรับ / รับเกินเมื่อค่าลบ<strong>{amountText(Number(row.expected_net) - Number(row.received_total))} ฿</strong></div>
    </div>
    {row.missing_days > 0 && <p role="status" className="recon-message recon-warning">ยังไม่มียอดขาย {row.missing_days} วันในรอบนี้ จึงยังยืนยันยอดขายตรงกันไม่ได้ ตรวจวันที่ในเมนูยอดขายก่อน</p>}
    <details><summary>ยอดหักและหมายเหตุ</summary>
      <DataTable columns={[{ key: 'label', label: 'รายการ' }, { key: 'amount', label: 'บาท', align: 'right' }]}
        rows={Object.entries(STATEMENT_MONEY).filter(([key]) => key !== 'gross').map(([key,label]) => ({ key,label,amount:amountText(row[key]) }))}
        rowKey={(r) => r.key} />
      <p>{row.note || 'ไม่มีหมายเหตุ'} · บันทึกครั้งที่ {row.version}</p>
    </details>
    <h3>รายการเงินเข้าจริง</h3>
    <DataTable rowKey={(r) => r.id} emptyText="ยังไม่มีเงินรับ เพิ่มเมื่อพบยอดเข้าจริงในธนาคารเท่านั้น"
      columns={[{ key:'received_date',label:'วันที่เงินเข้า' },{ key:'bank_reference',label:'อ้างอิงธนาคาร' },
        { key:'amount',label:'จำนวนเงิน',align:'right',render:(r) => amountText(r.amount) },
        { key:'note',label:'หมายเหตุ',render:(r) => r.voided_at ? `ยกเลิก: ${r.void_reason}` : r.note || '—' },
        { key:'actions',label:'จัดการ',render:(r) => canEdit && !row.voided_at && !r.voided_at
          ? <VoidForm title="ยกเลิกเงินรับ" busy={busy} onSubmit={(reason) => send('payment.void',{ id:r.id,version:row.version,reason })} /> : '—' }]}
      rows={row.receipts} />
    {canEdit && !row.voided_at && <>
      <PaymentForm row={row} today={today} />
      {!activeReceipts.length && <div className="recon-actions"><button className="recon-button" onClick={() => setEditing(!editing)}>{editing ? 'ปิดฟอร์มแก้ไข' : 'แก้ไขใบสรุป'}</button></div>}
      {editing && !activeReceipts.length && <StatementForm initial={row} month={month} today={today} onSaved={() => setEditing(false)} />}
      {!activeReceipts.length && <VoidForm title="ยกเลิกใบสรุป" busy={busy} onSubmit={(reason) => send('settlement.void',{ id:row.id,version:row.version,reason })} />}
    </>}
    <Message message={message} />
  </section>;
}

function PaymentForm({ row, today }) {
  const [f,setF] = useState({ received_date:today,amount:'',bank_reference:'',note:'' });
  const { busy,message,send } = useReconciliationCommand();
  const set = (key) => (value) => setF((old) => ({ ...old,[key]:value }));
  return <details><summary>เพิ่มเงินรับเข้าธนาคาร</summary>
    <form onSubmit={async (e) => {
      e.preventDefault();
      const result = await send('payment.add',{ ...f,settlement_id:row.id,version:row.version });
      if (result) setF({ received_date:today,amount:'',bank_reference:'',note:'' });
    }}>
      <fieldset disabled={busy}><div className="recon-grid">
        <DayField label="วันที่เงินเข้าจริง" value={f.received_date} onChange={set('received_date')} max={today} />
        <MoneyField label="เงินเข้าจริงครั้งนี้" value={f.amount} onChange={set('amount')} required />
        <label className="recon-field">เลขอ้างอิงธนาคาร *<input required maxLength={120} value={f.bank_reference} onChange={(e) => set('bank_reference')(e.target.value)} /></label>
        <label className="recon-field">หมายเหตุ<input maxLength={1000} value={f.note} onChange={(e) => set('note')(e.target.value)} /></label>
      </div></fieldset>
      <p className="muted">รองรับการโอนหลายครั้ง เลขอ้างอิงต้องไม่ซ้ำทั้งระบบ หากบันทึกผิดให้ยกเลิกพร้อมเหตุผล แล้วเพิ่มรายการแก้ไขด้วยเลขอ้างอิงที่ระบุฉบับแก้ไข</p>
      <button className="recon-button recon-primary" type="submit" disabled={busy}>{busy ? 'กำลังบันทึก…' : 'บันทึกเงินรับครั้งนี้'}</button>
      <Message message={message} />
    </form>
  </details>;
}
