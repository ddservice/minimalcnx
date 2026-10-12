'use client';
import Icon from '../../components/icon';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import DateField from '../../components/date-field';
import { stripDigits, digitsOnly } from '../../lib/format';
import { computeWht, bahtText, fmtTaxId, WHT_CONDITIONS } from '../../lib/wht';
import { saveForm50Payees } from './actions';

const fmt = (n) => Number(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const todayISO = () => new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
const thaiDate = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' });

// detail = ชนิดเงินได้ที่ระบุในข้อ 5 ของแบบ (จ่ายตามคำสั่งกรมสรรพากรที่ออกตามมาตรา 3 เตรส)
const ITEMS = [
  { id: 'rent', no: 1, label: 'ค่าเช่าร้าน', rate: 0.05, rateLabel: '5%', detail: 'ค่าเช่า' },
  { id: 'staff_sub', no: 2, label: 'ค่าพนักงานแทน (รับเหมา)', rate: 0.03, rateLabel: '3%', detail: 'ค่าบริการ' },
];

// แบบแสดงรายการที่ใช้นำส่ง — เลขลำดับตรงกับช่องบนแบบ 50 ทวิ
const PND_FORMS = [
  { value: '1', label: 'ภ.ง.ด.1ก' },
  { value: '2', label: 'ภ.ง.ด.1ก พิเศษ' },
  { value: '3', label: 'ภ.ง.ด.2' },
  { value: '4', label: 'ภ.ง.ด.3' },
  { value: '5', label: 'ภ.ง.ด.2ก' },
  { value: '6', label: 'ภ.ง.ด.3ก' },
  { value: '7', label: 'ภ.ง.ด.53' },
];
// ที่ผู้ใช้เลือกได้จริงในระบบนี้: บุคคลธรรมดา → ภ.ง.ด.3, นิติบุคคล → ภ.ง.ด.53
const PND_CHOICES = [
  { value: '4', label: 'ผู้รับเป็นบุคคลธรรมดา (ภ.ง.ด.3)' },
  { value: '7', label: 'ผู้รับเป็นนิติบุคคล (ภ.ง.ด.53)' },
];

const INCOME_ROWS = [
  '1. เงินเดือน ค่าจ้าง เบี้ยเลี้ยง โบนัส ฯลฯ ตามมาตรา 40 (1)',
  '2. ค่าธรรมเนียม ค่านายหน้า ฯลฯ ตามมาตรา 40 (2)',
  '3. ค่าแห่งลิขสิทธิ์ ฯลฯ ตามมาตรา 40 (3)',
  '4. (ก) ดอกเบี้ย ฯลฯ ตามมาตรา 40 (4) (ก)',
  '&nbsp;&nbsp;&nbsp;&nbsp;(ข) เงินปันผล เงินส่วนแบ่งกำไร ฯลฯ ตามมาตรา 40 (4) (ข)',
];
const ROW5 = '5. การจ่ายเงินได้ที่ต้องหักภาษี ณ ที่จ่าย ตามคำสั่งกรมสรรพากรที่ออกตามมาตรา 3 เตรส เช่น รางวัล ส่วนลดหรือประโยชน์ใด ๆ เนื่องจากการส่งเสริมการขาย รางวัลในการประกวด การแข่งขัน การชิงโชค ค่าแสดงของนักแสดงสาธารณะ ค่าจ้างทำของ ค่าโฆษณา ค่าเช่า ค่าขนส่ง ค่าบริการ ค่าเบี้ยประกันวินาศภัย ฯลฯ';

const COPIES = [
  { no: 1, note: 'สำหรับผู้ถูกหักภาษี ณ ที่จ่าย ใช้แนบพร้อมกับแบบแสดงรายการภาษี' },
  { no: 2, note: 'สำหรับผู้ถูกหักภาษี ณ ที่จ่าย เก็บไว้เป็นหลักฐาน' },
  { no: 3, note: 'สำหรับผู้มีหน้าที่หักภาษี ณ ที่จ่าย เก็บไว้เป็นหลักฐาน' },
];

export default function Form50({ amounts, payees, bizInfo, monthLabel, canEdit = false, isAdmin = false }) {
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
        // วันที่จ่ายเงินจริง แยกตามเดือน { '09/2026': '2026-09-05' } — ต่างกันทุกเดือน จึงไม่เก็บเป็นค่าเดียว
        paidDates: pv.paidDates || {},
      };
    });
    return s;
  });
  // ค่าที่อยู่ในฐานข้อมูลล่าสุด — ใช้บอกว่ามีอะไรยังไม่ได้บันทึก
  const [savedJson, setSavedJson] = useState(() => JSON.stringify(state));
  const dirty = JSON.stringify(state) !== savedJson;

  const set = (id, k, v) => setState((s) => ({ ...s, [id]: { ...s[id], [k]: v } }));
  const setPaid = (id, v) => setState((s) => ({ ...s, [id]: { ...s[id], paidDates: { ...s[id].paidDates, [monthLabel]: v } } }));

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

  function print(it) {
    const amt = Number(amounts?.[it.id]) || 0;
    if (amt <= 0) { setMsg({ text: `ยังไม่มียอด${it.label}ในเดือนนี้ (บันทึกค่าดำเนินการก่อน)`, type: 'err' }); return; }
    const pv = state[it.id];
    const biz = bizInfo || {};
    const paidDate = pv.paidDates?.[monthLabel] || '';

    // เอกสารภาษี — ข้อมูลไม่ครบห้ามพิมพ์ ดีกว่าได้ใบที่มีขีด "—" ไปยื่น
    const missing = [];
    if (!String(biz.name || '').trim()) missing.push('ชื่อผู้จ่ายเงิน (ตั้งค่าร้าน)');
    if (String(biz.tax_id || '').replace(/\D/g, '').length !== 13) missing.push('เลขผู้เสียภาษี 13 หลักของร้าน (ตั้งค่าร้าน)');
    if (!String(biz.address || '').trim()) missing.push('ที่อยู่ร้าน (ตั้งค่าร้าน)');
    if (!pv.name.trim()) missing.push('ชื่อผู้รับเงิน');
    if (pv.taxid.length !== 13) missing.push('เลขผู้เสียภาษี/บัตรประชาชน 13 หลักของผู้รับเงิน');
    if (!pv.addr.trim()) missing.push('ที่อยู่ผู้รับเงิน');
    if (!paidDate) missing.push('วันที่จ่ายเงินจริงของเดือนนี้');
    if (missing.length) { setMsg({ text: `ยังพิมพ์ 50 ทวิ ${it.label} ไม่ได้ — ขาด: ${missing.join(' · ')}`, type: 'err' }); return; }

    const { paid, tax } = computeWht(amt, it.rate, pv.cond);
    const esc = (x) => String(x == null ? '' : x).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const box = (on) => (on ? '☑' : '☐');
    const [mm, yy] = String(monthLabel).split('/');
    const bookNo = String((Number(yy) || 0) + 543);                 // เล่มที่ = ปี พ.ศ.
    const docNo = `${mm}/${String(it.no).padStart(2, '0')}`;          // เลขที่ = เดือน/ลำดับรายการ (ไม่ซ้ำกันในปีเดียวกัน)
    const issueDate = thaiDate(pv.date || todayISO());
    const blankRow = (label) => `<tr><td>${label}</td><td></td><td></td><td></td></tr>`;

    const page = (copy) => `
  <section class="page">
    <div class="top"><span>ฉบับที่ ${copy.no} <span class="note">(${esc(copy.note)})</span></span><span>เล่มที่ ${esc(bookNo)} &nbsp; เลขที่ ${esc(docNo)}</span></div>
    <h1>หนังสือรับรองการหักภาษี ณ ที่จ่าย</h1>
    <div class="sub">ตามมาตรา 50 ทวิ แห่งประมวลรัษฎากร</div>
    <div class="box">
      <div class="row"><span class="lab">ผู้มีหน้าที่หักภาษี ณ ที่จ่าย :</span><span>เลขประจำตัวผู้เสียภาษีอากร (13 หลัก) <b>${esc(fmtTaxId(biz.tax_id))}</b></span></div>
      <div>ชื่อ <b>${esc(biz.name)}</b></div>
      <div>ที่อยู่ ${esc(biz.address)}</div>
    </div>
    <div class="box">
      <div class="row"><span class="lab">ผู้ถูกหักภาษี ณ ที่จ่าย :</span><span>เลขประจำตัวผู้เสียภาษีอากร (13 หลัก) <b>${esc(fmtTaxId(pv.taxid))}</b></span></div>
      <div>ชื่อ <b>${esc(pv.name)}</b></div>
      <div>ที่อยู่ ${esc(pv.addr)}</div>
      <div class="pnd">ลำดับที่ <b>${esc(pv.seq || '1')}</b> ในแบบ &nbsp; ${PND_FORMS.map((f) => `${box(f.value === pv.pnd)} (${f.value}) ${f.label}`).join(' &nbsp; ')}</div>
    </div>
    <table>
      <tr><th style="width:52%">ประเภทเงินได้พึงประเมินที่จ่าย</th><th style="width:17%">วัน เดือน หรือปีภาษี ที่จ่าย</th><th style="width:16%">จำนวนเงินที่จ่าย</th><th>ภาษีที่หักและนำส่งไว้</th></tr>
      ${INCOME_ROWS.map(blankRow).join('')}
      <tr><td>${ROW5}<br><b>(ระบุ) ${esc(it.detail)}</b></td><td class="mid">${esc(thaiDate(paidDate))}</td><td class="num">${fmt(paid)}</td><td class="num">${fmt(tax)}</td></tr>
      ${blankRow('6. อื่น ๆ (ระบุ)')}
      <tr class="tot"><td colspan="2" style="text-align:right">รวมเงินที่จ่ายและภาษีที่หักนำส่ง</td><td class="num">${fmt(paid)}</td><td class="num">${fmt(tax)}</td></tr>
      <tr><td colspan="4">รวมเงินภาษีที่หักนำส่ง (ตัวอักษร) &nbsp; <b>${bahtText(tax)}</b></td></tr>
    </table>
    <div class="line">เงินที่จ่ายเข้า &nbsp; กบข./กสจ./กองทุนสงเคราะห์ครูโรงเรียนเอกชน ............ บาท &nbsp; กองทุนประกันสังคม ............ บาท &nbsp; กองทุนสำรองเลี้ยงชีพ ............ บาท</div>
    <div class="line">ผู้จ่ายเงิน &nbsp; ${WHT_CONDITIONS.map((c) => `${box(c.value === pv.cond)} (${c.value}) ${c.label}`).join(' &nbsp; ')} &nbsp; ☐ (4) อื่น ๆ (ระบุ) ............</div>
    <div class="foot">
      <div class="warn"><b>คำเตือน</b> ผู้มีหน้าที่ออกหนังสือรับรองการหักภาษี ณ ที่จ่าย ฝ่าฝืนไม่ปฏิบัติตามมาตรา 50 ทวิ แห่งประมวลรัษฎากร ต้องรับโทษทางอาญาตามมาตรา 35 แห่งประมวลรัษฎากร</div>
      <div class="cert">
        <div>ขอรับรองว่าข้อความและตัวเลขดังกล่าวข้างต้นถูกต้องตรงกับความจริงทุกประการ</div>
        <div class="sig">ลงชื่อ ........................................................ ผู้จ่ายเงิน</div>
        <div>${esc(issueDate)}</div>
        <div class="note">(วัน เดือน ปี ที่ออกหนังสือรับรองฯ)</div>
        <div class="seal">ประทับตรา<br>นิติบุคคล<br>(ถ้ามี)</div>
      </div>
    </div>
  </section>`;

    const html = `<!DOCTYPE html><html lang="th"><head><meta charset="utf-8"><title>50 ทวิ ${esc(it.label)} ${esc(monthLabel)}</title>
<style>
  @page{size:A4;margin:12mm}
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:'Sarabun','TH Sarabun New','Segoe UI',sans-serif;font-size:12px;color:#000;line-height:1.5}
  .page{max-width:720px;margin:0 auto;padding:18px 8px;page-break-after:always}
  .page:last-child{page-break-after:auto}
  .top{display:flex;justify-content:space-between;font-size:12px;font-weight:700;margin-bottom:6px}
  .note{font-weight:400;font-size:11px}
  h1{font-size:16px;text-align:center;font-weight:700}
  .sub{text-align:center;font-size:12px;margin-bottom:10px}
  .box{border:1px solid #000;padding:7px 10px;margin-bottom:8px}
  .row{display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap}
  .lab{font-weight:700}
  .pnd{margin-top:5px;font-size:11px}
  table{width:100%;border-collapse:collapse;margin:8px 0}
  th,td{border:1px solid #000;padding:4px 7px;font-size:11px;vertical-align:top}
  th{text-align:center}
  .num{text-align:right;white-space:nowrap}
  .mid{text-align:center}
  .tot td{font-weight:700}
  .line{border:1px solid #000;padding:6px 10px;margin-bottom:8px;font-size:11px}
  .foot{display:flex;gap:8px}
  .warn{flex:1;border:1px solid #000;padding:8px 10px;font-size:11px}
  .cert{flex:1.3;border:1px solid #000;padding:8px 10px;text-align:center;position:relative;font-size:11px}
  .sig{margin:26px 0 4px}
  .seal{position:absolute;right:8px;bottom:8px;width:62px;height:62px;border:1px dashed #000;border-radius:50%;font-size:9px;display:flex;align-items:center;justify-content:center;line-height:1.2}
</style></head><body>${COPIES.map(page).join('')}</body></html>`;
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
          const { paid, tax } = computeWht(amt, it.rate, pv.cond);
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
                <select className="input" disabled={!canEdit} value={pv.pnd} onChange={(e) => set(it.id, 'pnd', e.target.value)}>
                  {PND_CHOICES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
                <select className="input" disabled={!canEdit} value={pv.cond} onChange={(e) => set(it.id, 'cond', e.target.value)}>
                  {WHT_CONDITIONS.map((c) => <option key={c.value} value={c.value}>({c.value}) {c.label}</option>)}
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
              <div style={{ marginTop: 10, textAlign: 'right' }}>
                <button type="button" className="btn btn-gold" onClick={() => print(it)}><Icon name="ti-printer" /> พิมพ์ 50 ทวิ</button>
              </div>
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
