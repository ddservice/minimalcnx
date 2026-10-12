// แม่แบบพิมพ์หนังสือรับรองการหักภาษี ณ ที่จ่าย (50 ทวิ) — ใช้ร่วมทั้งค่าเช่า/ค่าบริการ (app/opex/form50.js)
// และใบประจำปีของพนักงาน (app/opex/opex-form.js) เพื่อให้ทุกใบออกจากฟอร์มเดียวกัน
// ขนาดตัวอักษรในนี้เป็นของงานพิมพ์ A4 ไม่ใช้ token ของหน้าจอ

import { bahtText, fmtTaxId, WHT_CONDITIONS } from './wht.js';

// แบบแสดงรายการที่ใช้นำส่ง — เลขลำดับตรงกับช่องบนแบบ 50 ทวิ
export const PND_FORMS = [
  { value: '1', label: 'ภ.ง.ด.1ก' },
  { value: '2', label: 'ภ.ง.ด.1ก พิเศษ' },
  { value: '3', label: 'ภ.ง.ด.2' },
  { value: '4', label: 'ภ.ง.ด.3' },
  { value: '5', label: 'ภ.ง.ด.2ก' },
  { value: '6', label: 'ภ.ง.ด.3ก' },
  { value: '7', label: 'ภ.ง.ด.53' },
];

export const FORM50_COPIES = [
  { no: 1, note: 'สำหรับผู้ถูกหักภาษี ณ ที่จ่าย ใช้แนบพร้อมกับแบบแสดงรายการภาษี' },
  { no: 2, note: 'สำหรับผู้ถูกหักภาษี ณ ที่จ่าย เก็บไว้เป็นหลักฐาน' },
  { no: 3, note: 'สำหรับผู้มีหน้าที่หักภาษี ณ ที่จ่าย เก็บไว้เป็นหลักฐาน' },
];

// row = หมายเลขข้อบนแบบที่จะลงยอด (1 = เงินเดือน/ค่าจ้าง 40(1), 5 = จ่ายตามมาตรา 3 เตรส เช่น ค่าเช่า/ค่าบริการ)
const INCOME_ROWS = [
  { row: 1, label: '1. เงินเดือน ค่าจ้าง เบี้ยเลี้ยง โบนัส ฯลฯ ตามมาตรา 40 (1)' },
  { row: 2, label: '2. ค่าธรรมเนียม ค่านายหน้า ฯลฯ ตามมาตรา 40 (2)' },
  { row: 3, label: '3. ค่าแห่งลิขสิทธิ์ ฯลฯ ตามมาตรา 40 (3)' },
  { row: 41, label: '4. (ก) ดอกเบี้ย ฯลฯ ตามมาตรา 40 (4) (ก)' },
  { row: 42, label: '&nbsp;&nbsp;&nbsp;&nbsp;(ข) เงินปันผล เงินส่วนแบ่งกำไร ฯลฯ ตามมาตรา 40 (4) (ข)' },
  { row: 5, label: '5. การจ่ายเงินได้ที่ต้องหักภาษี ณ ที่จ่าย ตามคำสั่งกรมสรรพากรที่ออกตามมาตรา 3 เตรส เช่น รางวัล ส่วนลดหรือประโยชน์ใด ๆ เนื่องจากการส่งเสริมการขาย รางวัลในการประกวด การแข่งขัน การชิงโชค ค่าแสดงของนักแสดงสาธารณะ ค่าจ้างทำของ ค่าโฆษณา ค่าเช่า ค่าขนส่ง ค่าบริการ ค่าเบี้ยประกันวินาศภัย ฯลฯ' },
  { row: 6, label: '6. อื่น ๆ (ระบุ)' },
];

const fmt = (n) => Number(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esc = (x) => String(x == null ? '' : x).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const box = (on) => (on ? '☑' : '☐');

const STYLE = `
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
`;

function pageHtml(d, copy) {
  const incomeRows = INCOME_ROWS.map((r) => {
    if (r.row !== d.row) return `<tr><td>${r.label}</td><td></td><td></td><td></td></tr>`;
    const detail = d.detail ? `<br><b>(ระบุ) ${esc(d.detail)}</b>` : '';
    return `<tr><td>${r.label}${detail}</td><td class="mid">${esc(d.dateText)}</td><td class="num">${fmt(d.paid)}</td><td class="num">${fmt(d.tax)}</td></tr>`;
  }).join('');
  const sso = d.sso > 0 ? `<b>${fmt(d.sso)}</b>` : '............';
  return `
  <section class="page">
    <div class="top"><span>ฉบับที่ ${copy.no} <span class="note">(${esc(copy.note)})</span></span><span>เล่มที่ ${esc(d.bookNo)} &nbsp; เลขที่ ${esc(d.docNo)}</span></div>
    <h1>หนังสือรับรองการหักภาษี ณ ที่จ่าย</h1>
    <div class="sub">ตามมาตรา 50 ทวิ แห่งประมวลรัษฎากร</div>
    <div class="box">
      <div class="row"><span class="lab">ผู้มีหน้าที่หักภาษี ณ ที่จ่าย :</span><span>เลขประจำตัวผู้เสียภาษีอากร (13 หลัก) <b>${esc(fmtTaxId(d.payer.taxId))}</b></span></div>
      <div>ชื่อ <b>${esc(d.payer.name)}</b></div>
      <div>ที่อยู่ ${esc(d.payer.address)}</div>
    </div>
    <div class="box">
      <div class="row"><span class="lab">ผู้ถูกหักภาษี ณ ที่จ่าย :</span><span>เลขประจำตัวผู้เสียภาษีอากร (13 หลัก) <b>${esc(fmtTaxId(d.payee.taxId))}</b></span></div>
      <div>ชื่อ <b>${esc(d.payee.name)}</b></div>
      <div>ที่อยู่ ${esc(d.payee.address)}</div>
      <div class="pnd">ลำดับที่ <b>${esc(d.seq || '1')}</b> ในแบบ &nbsp; ${PND_FORMS.map((f) => `${box(f.value === d.pnd)} (${f.value}) ${f.label}`).join(' &nbsp; ')}</div>
    </div>
    <table>
      <tr><th style="width:52%">ประเภทเงินได้พึงประเมินที่จ่าย</th><th style="width:17%">วัน เดือน หรือปีภาษี ที่จ่าย</th><th style="width:16%">จำนวนเงินที่จ่าย</th><th>ภาษีที่หักและนำส่งไว้</th></tr>
      ${incomeRows}
      <tr class="tot"><td colspan="2" style="text-align:right">รวมเงินที่จ่ายและภาษีที่หักนำส่ง</td><td class="num">${fmt(d.paid)}</td><td class="num">${fmt(d.tax)}</td></tr>
      <tr><td colspan="4">รวมเงินภาษีที่หักนำส่ง (ตัวอักษร) &nbsp; <b>${bahtText(d.tax)}</b></td></tr>
    </table>
    <div class="line">เงินที่จ่ายเข้า &nbsp; กบข./กสจ./กองทุนสงเคราะห์ครูโรงเรียนเอกชน ............ บาท &nbsp; กองทุนประกันสังคม ${sso} บาท &nbsp; กองทุนสำรองเลี้ยงชีพ ............ บาท</div>
    <div class="line">ผู้จ่ายเงิน &nbsp; ${WHT_CONDITIONS.map((c) => `${box(c.value === d.cond)} (${c.value}) ${c.label}`).join(' &nbsp; ')} &nbsp; ☐ (4) อื่น ๆ (ระบุ) ............</div>
    <div class="foot">
      <div class="warn"><b>คำเตือน</b> ผู้มีหน้าที่ออกหนังสือรับรองการหักภาษี ณ ที่จ่าย ฝ่าฝืนไม่ปฏิบัติตามมาตรา 50 ทวิ แห่งประมวลรัษฎากร ต้องรับโทษทางอาญาตามมาตรา 35 แห่งประมวลรัษฎากร</div>
      <div class="cert">
        <div>ขอรับรองว่าข้อความและตัวเลขดังกล่าวข้างต้นถูกต้องตรงกับความจริงทุกประการ</div>
        <div class="sig">ลงชื่อ ........................................................ ผู้จ่ายเงิน</div>
        <div>${esc(d.issueDateText)}</div>
        <div class="note">(วัน เดือน ปี ที่ออกหนังสือรับรองฯ)</div>
        <div class="seal">ประทับตรา<br>นิติบุคคล<br>(ถ้ามี)</div>
      </div>
    </div>
  </section>`;
}

/**
 * docs = [{ bookNo, docNo, payer:{name,taxId,address}, payee:{name,taxId,address}, pnd, seq,
 *           row, detail, dateText, paid, tax, sso, cond, issueDateText }]
 * คืน HTML ทั้งเอกสาร — ใบละ 3 ฉบับ (หน้า)
 */
export function form50Html({ title, docs }) {
  const pages = docs.map((d) => FORM50_COPIES.map((c) => pageHtml(d, c)).join('')).join('');
  return `<!DOCTYPE html><html lang="th"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>${STYLE}</style></head><body>${pages}</body></html>`;
}
