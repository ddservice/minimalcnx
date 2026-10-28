'use client';
import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import DateField from '../../../components/date-field';
import NumberInput from '../../../components/number-input';
import { bakeryReview, computeInvoice, normalizeName, parseBakeryPOS } from '../../../lib/bakery-cost';
import { fmtMoney as fmt } from '../../../lib/format';
import { saveInvoiceAction, changeInvoiceAction, savePOSAction, saveMappingAction } from './actions';
import './review.css';

const blankLine = () => ({ name: '', unit: '', quantity: '1', unit_price: '' });
const blankInvoice = month => ({ supplier: '', invoice_no: '', received_on: `${month}-01`, due_on: '', discount_pct: '', expected_total: '', payment_method: 'ยังไม่ระบุ', note: '', lines: [blankLine()] });
export default function BakeryClient({ month, invoices, imported, mappings, sales, canManage }) {
  const router = useRouter();
  const [pending, transition] = useTransition();
  const [busy, setBusy] = useState(false), lock = useRef(false);
  const [message, setMessage] = useState(null);
  const [invoice, setInvoice] = useState(() => blankInvoice(month));
  const [preview, setPreview] = useState(null), [pilot, setPilot] = useState([]);
  const [branchConfirmed, setBranchConfirmed] = useState(false);
  const [mapping, setMapping] = useState({ key: '', supplier: '', purchase_name: '', factor: '', confirmed: false });
  const [tab, setTab] = useState('summary');
  const [editing, setEditing] = useState(false);
  const [showMapping, setShowMapping] = useState(false);
  const drafts = invoices.filter(i => i.status === 'draft');
  const active = invoices.filter(i => i.status !== 'void');
  const receivedTotal = active.reduce((sum, i) => sum + Number(i.net_total), 0);
  const monthLabel = new Intl.DateTimeFormat('th-TH', { month: 'long', year: 'numeric' }).format(new Date(`${month}-01T12:00:00`));
  const report = bakeryReview(invoices, imported?.rows || [], mappings, sales);
  let calc = null;
  try { calc = computeInvoice(invoice); } catch { /* Incomplete form is retained. */ }
  function field(key, value) { setInvoice(v => ({ ...v, [key]: value })); }
  function line(i, key, value) { field('lines', invoice.lines.map((r, n) => n === i ? { ...r, [key]: value } : r)); }
  async function perform(fn, after) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setMessage(null);
    try {
      const result = await fn(); setMessage({ ok: result.ok, text: result.message });
      if (result.ok) { after?.(); transition(() => router.refresh()); }
    } catch { setMessage({ ok: false, text: 'เชื่อมต่อไม่สำเร็จ ข้อมูลที่กรอกยังอยู่ ตรวจรายการก่อนลองอีกครั้ง' }); }
    finally { lock.current = false; setBusy(false); }
  }
  async function readPOS(file) {
    if (!file || lock.current) return;
    lock.current = true; setBusy(true); setMessage(null); setPreview(null); setBranchConfirmed(false);
    try {
      if (!/\.xlsx$/i.test(file.name) || file.size > 10 * 1024 * 1024) throw new Error('ใช้ไฟล์ .xlsx ขนาดไม่เกิน 10 MB');
      const ExcelJS = await import('exceljs');
      const wb = new (ExcelJS.default || ExcelJS).Workbook();
      await wb.xlsx.load(await file.arrayBuffer());
      if (!wb.worksheets[0]) throw new Error('ไฟล์ไม่มีแผ่นงาน');
      const grid = [];
      wb.worksheets[0].eachRow(row => grid.push(Array.from({ length: row.cellCount }, (_, i) => {
        const v = row.getCell(i + 1).value;
        return v && typeof v === 'object' && 'result' in v ? v.result : v;
      })));
      setPreview({ ...parseBakeryPOS(grid, month), source_name: file.name });
    } catch (e) { setMessage({ ok: false, text: e.message || 'อ่านไฟล์ไม่ได้' }); }
    finally { lock.current = false; setBusy(false); }
  }
  async function readPilot(file) {
    if (!file) return;
    try {
      if (file.size > 200000) throw new Error('ชุดตรวจใหญ่เกินไป');
      const data = JSON.parse(await file.text());
      if (!Array.isArray(data.invoices) || data.invoices.length > 50) throw new Error('รูปแบบชุดตรวจไม่ถูกต้อง');
      for (const inv of data.invoices) {
        if (!String(inv.received_on || '').startsWith(`${month}-`)) throw new Error('บิลไม่ตรงเดือนที่เลือก');
        if (computeInvoice(inv).net !== Number(inv.expected_total)) throw new Error(`ยอดบิล ${inv.invoice_no} ไม่ตรงเอกสาร`);
      }
      setPilot(data.invoices); setMessage({ ok: true, text: 'เปิดชุดตรวจแล้ว เลือกทีละบิล ตรวจเอกสาร และเก็บฉบับร่างก่อนลงรายจ่ายจริง' });
    } catch (e) { setMessage({ ok: false, text: e.message || 'อ่านชุดตรวจไม่ได้' }); }
  }
  const choices = [...new Map(invoices.filter(i => i.status === 'posted').flatMap(i => i.lines.map(l => [
    `${i.supplier}|${l.name}`, { supplier: i.supplier, name: l.name, unit: l.unit },
  ]))).values()];
  const known = report.items.filter(i => i.cost != null).length;
  const matchedDays = report.daily.filter(d => d.saved_quantity != null && Number(d.saved_quantity) === d.pos_quantity && d.difference === 0).length;
  function openMapping(key = '') {
    const saved = mappings.find(m => m.pos_key === key);
    setMapping({ key, supplier: saved?.supplier || '', purchase_name: saved?.purchase_name || '', factor: saved?.factor || '', confirmed: false });
    setShowMapping(true);
    setTimeout(() => document.getElementById('bakery-mapping')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
  }
  return <div className="bakery-review">
    <div className="bakery-heading"><div><h2>{monthLabel}</h2><p className="muted">ดูยอดขาย ตรวจบิลซื้อ แล้วค่อยยืนยันต้นทุนขนมทีละชนิด</p></div>
      <label>เลือกเดือน<DateField type="month" value={month} loading={pending} onChange={m => transition(() => router.push(`/expenses/bakery?month=${m}`))} /></label><Link href="/expenses">กลับรายจ่าย</Link></div>
    <nav className="bakery-tabs" aria-label="ต้นทุนขนม">{[['summary', 'ภาพรวมและสิ่งที่ต้องทำ'], ['invoices', `บิลซื้อ (${active.length})`], ['pos', 'ยอดขายจาก POS']].map(([k, text]) => <button className={`btn ${tab === k ? 'btn-coffee' : ''}`} type="button" key={k} onClick={() => setTab(k)} aria-pressed={tab === k}>{text}</button>)}</nav>
    {message && <p role="status" className={message.ok ? 'bakery-success' : 'bakery-error'}>{message.text}</p>}
    <fieldset disabled={busy || pending} className="bakery-fieldset">
    {tab === 'invoices' && <>
      {canManage && !editing && <div className="bakery-actions"><button type="button" className="btn btn-coffee" onClick={() => { setInvoice(blankInvoice(month)); setEditing(true); }}>เพิ่มบิลซื้อ</button><span className="muted">บันทึกเป็นฉบับร่างก่อนตรวจเสมอ</span></div>}
      {canManage && editing && <section className="card"><div className="card-body"><div className="bakery-heading"><h2>{invoice.id ? `แก้ฉบับร่าง ${invoice.invoice_no}` : 'เพิ่มใบส่งสินค้า / บิลซื้อ'}</h2><button type="button" className="btn" onClick={() => setEditing(false)}>ปิดแบบฟอร์ม</button></div>
        <p className="muted">ราคาต่อหน่วยก่อนลดตามบิล ถ้าราคาหลังลดแล้วใช้ส่วนลด 0% ไม่หัก VAT เพิ่มโดยอัตโนมัติ</p>
        <details className="bakery-advanced"><summary>นำเข้าชุดบิลที่เตรียมไว้ (สำหรับผู้ดูแล)</summary><label>เปิดชุดบิลที่ถอดจากเอกสาร (.json)<input type="file" accept=".json" onChange={e => readPilot(e.target.files?.[0])} /></label>
        {pilot.length > 0 && <label>เลือกบิลมาตรวจ<select value="" onChange={e => setInvoice(pilot[Number(e.target.value)])}><option value="">เลือกใบส่งสินค้า</option>{pilot.map((p, i) => <option key={p.invoice_no} value={i}>{p.received_on} · {p.invoice_no} · {fmt(p.expected_total)} บาท</option>)}</select></label>}
        </details><form onSubmit={e => { e.preventDefault(); perform(() => saveInvoiceAction(invoice), () => { setInvoice(blankInvoice(month)); setEditing(false); }); }}>
          <div className="bakery-fields">
            <label>ผู้ขาย<input required value={invoice.supplier} maxLength={100} onChange={e => field('supplier', e.target.value)} placeholder="เช่น Queen" /></label>
            <label>เลขใบส่งสินค้า<input required value={invoice.invoice_no} maxLength={100} onChange={e => field('invoice_no', e.target.value)} /></label>
            <label>วันที่รับขนม<DateField value={invoice.received_on} onChange={v => field('received_on', v)} /></label>
            <label>กำหนดชำระ (ถ้ามี)<DateField value={invoice.due_on || ''} onChange={v => field('due_on', v)} /></label>
            <label>ส่วนลดท้ายบิล (%)<NumberInput required value={invoice.discount_pct} onChange={v => field('discount_pct', v)} /></label>
            <label>ยอดสุทธิที่พิมพ์ในบิล (บาท)<NumberInput required value={invoice.expected_total} onChange={v => field('expected_total', v)} /></label>
            <label>การชำระ<select value={invoice.payment_method} onChange={e => field('payment_method', e.target.value)}>{['ยังไม่ระบุ', 'ค้างชำระ', 'บัญชี หจก.', 'บัญชีส่วนตัว', 'เงินสด'].map(v => <option key={v}>{v}</option>)}</select></label>
            <label>อ้างอิงเอกสาร/หมายเหตุ<input value={invoice.note || ''} maxLength={1000} onChange={e => field('note', e.target.value)} /></label>
          </div>
          {invoice.lines.map((r, i) => <div className="bakery-line" key={i}>
            <label>ขนมรายการ {i + 1}<input required value={r.name} maxLength={150} onChange={e => line(i, 'name', e.target.value)} /></label>
            <label>หน่วยตามบิล<input required value={r.unit} maxLength={30} placeholder="ชิ้น / ชุด" onChange={e => line(i, 'unit', e.target.value)} /></label>
            <label>จำนวน<NumberInput required value={r.quantity} onChange={v => line(i, 'quantity', v)} /></label>
            <label>ราคาก่อนลด/หน่วย<NumberInput required value={r.unit_price} onChange={v => line(i, 'unit_price', v)} /></label>
            <button type="button" className="btn" disabled={invoice.lines.length === 1} onClick={() => field('lines', invoice.lines.filter((_, n) => n !== i))}>ลบรายการ {i + 1}</button>
          </div>)}
          <button type="button" className="btn" disabled={invoice.lines.length >= 100} onClick={() => field('lines', [...invoice.lines, blankLine()])}>เพิ่มรายการ</button>
          {calc && <p>ก่อนลด {fmt(calc.gross)} · ส่วนลด {fmt(calc.discount)} · <strong>ต้นทุนสุทธิ {fmt(calc.net)} บาท</strong>{invoice.expected_total !== '' && calc.net !== Number(invoice.expected_total) && <span className="bakery-error"> — ยังไม่ตรงยอดในเอกสาร</span>}</p>}
          <div className="bakery-actions"><button className="btn btn-coffee" type="submit">เก็บฉบับร่างก่อนตรวจ</button><button className="btn" type="button" onClick={() => setInvoice(blankInvoice(month))}>เริ่มบิลใหม่</button></div>
        </form>
      </div></section>}
      <section className="card"><div className="card-body"><h2>บิลเดือนนี้ ({invoices.length})</h2>{!invoices.length && <p>เดือนนี้ยังไม่มีบิลซื้อ กด “เพิ่มบิลซื้อ” แล้วกรอกตามวันที่รับขนม</p>}
        {invoices.map(inv => <article className="bakery-saved" key={inv.id}><h3>{inv.invoice_no} · {inv.supplier} <span className="muted">{inv.status === 'draft' ? 'ฉบับร่าง' : inv.status === 'posted' ? 'ลงรายจ่ายแล้ว' : 'ยกเลิก'}</span></h3>
          <p>{inv.received_on} · ลด {inv.discount_pct}% · สุทธิ {fmt(inv.net_total)} บาท{inv.due_on ? ` · กำหนดชำระ ${inv.due_on}` : ''}</p>
          <details><summary>เปิดตรวจบิล · {inv.lines.length} รายการ</summary><ul>{computeInvoice(inv).lines.map((l, i) => <li key={i}>{l.name} · {l.quantity} {l.unit} × {fmt(l.unit_price)} → หลังลด {fmt(l.net)} บาท</li>)}</ul><p className="muted">{inv.note}</p>
          {inv.status === 'void' && <p>เหตุผล: {inv.void_reason}</p>}
          {canManage && inv.status === 'void' && <button type="button" className="btn" onClick={() => perform(() => changeInvoiceAction(inv.id, inv.version, 'reopen'))}>เปิดฉบับร่างเพื่อแก้ไข</button>}
          {canManage && inv.status === 'draft' && <div className="bakery-actions"><button type="button" className="btn" onClick={() => { setInvoice({ ...inv, due_on: inv.due_on || '' }); setEditing(true); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>แก้ฉบับร่าง</button>
            <button type="button" className="btn btn-coffee" disabled={Number(inv.net_total) !== Number(inv.expected_total)} onClick={() => {
              if (window.confirm(`ยืนยันว่าเป็นบิลของร้านนี้และยังไม่ลงรายจ่ายซ้ำ?\n${inv.invoice_no} · ${inv.received_on} · ${fmt(inv.net_total)} บาท\nจะเพิ่มรายจ่ายสุทธิหนึ่งบิลในวันที่รับขนม`)) perform(() => changeInvoiceAction(inv.id, inv.version, 'post'));
            }}>ตรวจแล้ว ลงรายจ่ายจริง</button></div>}
          {canManage && inv.status !== 'void' && <button type="button" className="btn" onClick={() => { const reason = window.prompt('เหตุผลยกเลิก (จะถอนรายจ่ายที่ผูกบิลนี้ด้วย ถ้าลงไว้แล้ว)'); if (reason) perform(() => changeInvoiceAction(inv.id, inv.version, 'void', reason)); }}>ยกเลิกพร้อมเหตุผล</button>}
        </details></article>)}
      </div></section>
    </>}
    {tab === 'pos' && <>
      <section className="card"><div className="card-body"><h2>{imported ? "มีข้อมูลยอดขายเดือนนี้แล้ว" : "นำเข้ายอดขายเดือนนี้"}</h2><p>ส่งออก “รายงานยอดขายแยกตามรายละเอียดบิล” จาก Wongnai เป็น Excel แล้วเลือกไฟล์ด้านล่าง ระบบอ่านเฉพาะขนมให้ พนักงานไม่ต้องกรอกใหม่</p><p className="muted">นำเข้าเดือนละชุด หากเลือกไฟล์ใหม่จะขอยืนยันก่อนแทนที่ชุดเดิม ยอดขายรายวันเดิมยังอยู่ครบ</p>
        {imported && <p>ไฟล์ที่เก็บไว้: {imported.source_name} · สาขา {imported.branch} · รุ่น {imported.version}</p>}
        {canManage && <label>ไฟล์รายละเอียดบิล .xlsx<input type="file" accept=".xlsx" onChange={e => readPOS(e.target.files?.[0])} /></label>}
        {preview && <div><p>พบขนม {preview.rows.length} แถว · สาขา {preview.branches.join(', ') || 'ไม่ระบุ'} · ข้อมูล {preview.days.length} วัน</p>
          {preview.issues.length > 0 && <div role="alert" className="bakery-error"><strong>ยังบันทึกไม่ได้ ({preview.issues.length} จุด)</strong><ul>{preview.issues.slice(0, 10).map((v, i) => <li key={i}>{v}</li>)}</ul><p>แก้ไฟล์ต้นทางแล้วนำเข้าใหม่ ไม่ย้ายวันที่ผิดหรือทิ้งรายการเงียบ ๆ</p></div>}
          <label className="bakery-check"><input type="checkbox" checked={branchConfirmed} onChange={e => setBranchConfirmed(e.target.checked)} />ยืนยันว่าเป็นสาขาของร้านนี้ และเป็นไฟล์ครบเดือนที่ต้องการใช้</label>
          <button type="button" className="btn btn-coffee" disabled={preview.issues.length > 0 || !branchConfirmed || !preview.branches.length} onClick={() => {
            if (imported && !window.confirm('แทนที่ชุด POS เดือนนี้ทั้งชุด? ยอดขายรายวันเดิมจะไม่เปลี่ยน')) return;
            perform(() => savePOSAction({ ...preview, branch: preview.branches[0], version: imported?.version || 0 }), () => setPreview(null));
          }}>ยืนยันเก็บชุด POS {imported ? 'แทนชุดเดิม' : ''}</button></div>}
      </div></section>
      <section className="card"><div className="card-body"><h2>เทียบกับยอดขนมที่กรอกไว้</h2>{imported && <p>{matchedDays === report.daily.length ? `ตรงกันครบ ${matchedDays} วัน ทั้งจำนวนและยอดเงิน` : `ตรงกัน ${matchedDays} จาก ${report.daily.length} วัน เปิดรายละเอียดเพื่อตรวจวันที่ต่างกัน`}</p>}<details><summary>ดูรายละเอียดรายวัน</summary>{!imported ? <p>เก็บชุด POS ก่อน จึงจะเทียบจำนวนและยอดเงินรายวันได้</p> : <div className="bakery-scroll"><table><thead><tr>{['วันที่', 'POS หน่วย', 'เดิม ชิ้น', 'POS บาท', 'เดิม บาท', 'ต่าง บาท', 'ราคา 0'].map(h => <th key={h}>{h}</th>)}</tr></thead><tbody>{report.daily.map(r => <tr key={r.date}><td>{r.date}</td><td>{r.pos_quantity}</td><td>{r.saved_quantity ?? 'ไม่มีข้อมูล'}</td><td>{fmt(r.pos_revenue)}</td><td>{r.saved_revenue == null ? 'ไม่มีข้อมูล' : fmt(r.saved_revenue)}</td><td>{r.difference == null ? '—' : fmt(r.difference)}</td><td>{r.zero_quantity || '—'}</td></tr>)}</tbody></table></div>}</details></div></section>
    </>}
    {tab === 'summary' && <>
      <div className="bakery-kpis">
        <section className="card"><div className="card-body"><p className="muted">ยอดขายขนมจาก POS</p><strong className="bakery-value">{imported ? `${fmt(report.revenue)} บาท` : 'ยังไม่มีข้อมูล'}</strong><p>{imported ? `${fmt(report.quantity)} หน่วยขาย · ${report.items.length} ชนิด` : 'นำเข้า Excel จาก Wongnai เพื่อเริ่มตรวจ'}</p></div></section>
        <section className="card"><div className="card-body"><p className="muted">ยอดซื้อขนมตามบิล</p><strong className="bakery-value">{active.length ? `${fmt(receivedTotal)} บาท` : 'ยังไม่มีบิล'}</strong><p>{active.length} บิล · รอตรวจ {drafts.length} บิล</p><small className="muted">ลงรายจ่ายแล้ว {fmt(report.purchaseTotal)} บาท · ฉบับร่างยังไม่เข้ารายจ่าย</small></div></section>
        <section className="card"><div className="card-body"><p className="muted">{report.complete ? 'กำไรขั้นต้นประมาณการ' : known ? 'กำไรเฉพาะรายการที่ตรวจแล้ว' : 'กำไรขั้นต้นประมาณการ'}</p><strong className="bakery-value">{known ? `${fmt(report.coveredMargin)} บาท` : 'รอตรวจต้นทุน'}</strong><p>คำนวณได้ {known} จาก {report.items.length} ชนิด</p><small className="muted">ก่อนค่าแรง ค่าเช่า ค่าธรรมเนียมขาย และของเสีย</small></div></section>
      </div>
      <section className="card bakery-next"><div className="card-body"><h2>ทำอะไรต่อดี?</h2>
        {!active.length ? <><p>เริ่มจากเพิ่มบิลซื้อ ตามวันที่รับขนมจริง ระบบจะเก็บส่วนลดและยอดสุทธิให้</p>{canManage && <button type="button" className="btn btn-coffee" onClick={() => { setTab('invoices'); setEditing(true); }}>เพิ่มบิลซื้อใบแรก</button>}</>
        : drafts.length ? <><p>มีบิลซื้อรอตรวจ <strong>{drafts.length} ใบ</strong> เปิดตรวจชื่อขนม จำนวน หน่วย และส่วนลดกับเอกสาร แล้วจึงลงรายจ่ายจริง</p><button type="button" className="btn btn-coffee" onClick={() => setTab('invoices')}>ตรวจบิลที่เตรียมไว้ ({drafts.length})</button><p className="muted">ยังไม่ต้องกรอกบิลเดิมซ้ำ ไม่ใช้ใบวางบิลหรือใบเสร็จเพิ่มต้นทุนอีกรอบ</p></>
        : !imported ? <><p>บิลซื้อพร้อมแล้ว ต่อไปนำเข้าไฟล์ยอดขายจาก Wongnai ของเดือนนี้</p><button type="button" className="btn btn-coffee" onClick={() => setTab('pos')}>นำเข้าไฟล์ยอดขาย</button></>
        : !report.complete ? <><p>เลือกขนมที่ยังไม่มีต้นทุนด้านล่าง แล้วยืนยันว่าตรงกับรายการซื้อใดและขายเป็นหน่วยเดียวกันหรือแบ่งขาย ระบบจะจำไว้ใช้ครั้งต่อไป</p>{canManage && <button type="button" className="btn btn-coffee" onClick={() => openMapping(report.items.find(i => i.cost == null)?.key)}>ตรวจขนมรายการถัดไป</button>}</>
        : <p>คำนวณต้นทุนได้ครบทุกชนิดในไฟล์แล้ว ดูกำไรประมาณการแยกรายการด้านล่างได้เลย</p>}
      </div></section>
      <section className="card"><div className="card-body"><div className="bakery-heading"><h2>ขนมที่ขายเดือนนี้</h2>{canManage && imported && <button type="button" className="btn" onClick={() => openMapping()}>ตั้งค่าคู่สินค้า</button>}</div>
        <p className="muted">ใช้ต้นทุนเฉลี่ยจากบิลที่ลงรายจ่ายแล้วในเดือนนี้ หากยังไม่แน่ใจหน่วย ระบบจะรอตรวจและไม่แสดงเป็นกำไร</p>
        <details open={!drafts.length}><summary>ดูขนมที่ขาย {report.items.length} ชนิด และสถานะต้นทุน</summary>{!imported ? <p>นำเข้าไฟล์ยอดขายก่อน จึงจะแสดงรายการขนมที่ขายได้</p> : <div className="bakery-scroll"><table><thead><tr>{['ขนม POS', 'หน่วยขาย', 'รายได้', 'ต้นทุนประมาณการ', 'กำไรประมาณการ', 'สถานะ'].map(h => <th key={h}>{h}</th>)}</tr></thead><tbody>{report.items.map(i => <tr key={i.key}><td>{i.name}</td><td>{i.quantity}</td><td>{fmt(i.revenue)}</td><td>{i.cost == null ? 'ยังคำนวณไม่ได้' : fmt(i.cost)}</td><td>{i.margin == null ? '—' : fmt(i.margin)}</td><td>{i.reason || 'ตรวจแล้ว'}{canManage && i.cost == null && !drafts.length && <button type="button" className="btn" onClick={() => openMapping(i.key)}>ตรวจ {i.name}</button>}</td></tr>)}</tbody></table></div>}</details>
      </div></section>
      {canManage && imported && showMapping && <section className="card" id="bakery-mapping"><div className="card-body"><div className="bakery-heading"><h2>ยืนยันต้นทุนของขนม</h2><button type="button" className="btn" onClick={() => setShowMapping(false)}>ปิดการจับคู่</button></div><p>ราคาคล้ายกันช่วยเสนอคู่ได้ แต่ไม่พิสูจน์ว่าขายทั้งแพ็กหรือแบ่งขาย หน่วย “ชุด” ต้องตรวจจากสินค้าจริงหรือผู้ขาย</p>
        {!choices.length && <p className="bakery-error">ต้องตรวจบิลซื้อและลงรายจ่ายก่อน จึงจะมีรายการต้นทุนให้เลือก</p>}<form onSubmit={e => { e.preventDefault(); perform(() => saveMappingAction(mapping), () => setMapping({ ...mapping, confirmed: false })); }}><div className="bakery-fields">
          <label>ขนมจาก POS<select aria-label="ขนมจาก POS" required value={mapping.key} onChange={e => { const saved = mappings.find(m => m.pos_key === e.target.value); setMapping({ key: e.target.value, supplier: saved?.supplier || '', purchase_name: saved?.purchase_name || '', factor: saved?.factor || '', confirmed: false }); }}><option value="">เลือกขนม</option>{report.items.map(i => <option key={i.key} value={i.key}>{i.name}</option>)}</select></label>
          <label>รายการซื้อต้นทุน<select aria-label="รายการซื้อต้นทุน" required value={mapping.purchase_name ? `${mapping.supplier}|${mapping.purchase_name}` : ''} onChange={e => { const c = choices.find(c => `${c.supplier}|${c.name}` === e.target.value); setMapping(v => ({ ...v, supplier: c?.supplier || '', purchase_name: c?.name || '', confirmed: false })); }}><option value="">เลือกผู้ขายและชื่อขนมในบิล</option>{choices.map(c => <option key={`${c.supplier}|${c.name}`} value={`${c.supplier}|${c.name}`}>{c.supplier} · {c.name} · {c.unit}{normalizeName(c.name) === mapping.key ? ' · ชื่อตรง POS' : ''}</option>)}</select></label>
          <label>1 หน่วยขาย ใช้กี่หน่วยตามบิลซื้อ<NumberInput required value={mapping.factor} onChange={v => setMapping(m => ({ ...m, factor: v, confirmed: false }))} placeholder="ต้องยืนยันก่อน เช่น 1" /></label>
        </div><p className="muted">ขายทั้งแพ็ก: 1 · ซื้อ 1 ชุดแบ่งขาย 4 หน่วย: 0.25 · ห้ามใช้ตัวอย่างแทนหน่วยจริง</p><label className="bakery-check"><input type="checkbox" checked={mapping.confirmed} onChange={e => setMapping(v => ({ ...v, confirmed: e.target.checked }))} />ตรวจสินค้าหรือยืนยันกับผู้ขายแล้วว่าชื่อและหน่วยถูกต้อง</label><button className="btn btn-coffee" type="submit" disabled={!mapping.confirmed}>บันทึกคู่สินค้า</button></form>
      </div></section>}
    </>}
    </fieldset>{(busy || pending) && <p role="status">กำลังอ่านหรือบันทึกข้อมูล กรุณารอสักครู่…</p>}
  </div>;
}
