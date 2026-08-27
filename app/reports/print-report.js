import { fmtMoney } from '../../lib/format';
import { computeEffectiveOpex } from '../../lib/opex';
import { EXPENSE_CATEGORIES } from '../../lib/expense-categories';

const esc = (s) =>
  String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

export function printMonthlyReport({
  monthLabel,
  sales = [],
  expenses = [],
  opexDefaults = {},
  bizInfo = {},
  printedBy = '',
}) {
  const income = sales.reduce((a, s) => a + Number(s.net_revenue || 0), 0);
  const catSum = (c) =>
    expenses.filter((e) => !e.item_key && e.category === c).reduce((a, e) => a + Number(e.total_amount || 0), 0);

  const matTotal = catSum('ต้นทุนวัตถุดิบ');
  const bakTotal = catSum('ต้นทุนขนมหน้าร้าน');
  const miscTotal = catSum('รายจ่ายจิปาถะ');
  const opexTotal = computeEffectiveOpex(expenses, opexDefaults);

  const cogsTotal = matTotal + bakTotal;
  const grossProfit = income - cogsTotal;
  const totalExp = matTotal + bakTotal + miscTotal + opexTotal;
  const netProfit = income - totalExp;

  const totalCups = sales.reduce((a, s) => a + Number(s.total_cups || 0), 0);
  const pastryRev = sales.reduce((a, s) => a + Number(s.pastry_revenue || 0), 0);
  const freeCups = sales.reduce((a, s) => a + Number(s.free_cups || 0), 0);
  const daysRecorded = sales.length;

  const catLabel = {};
  EXPENSE_CATEGORIES.forEach((c) => { catLabel[c.value] = c.label; });

  const regularItems = expenses
    .filter((e) => !e.item_key)
    .slice()
    .sort((a, b) => (a.date || '').localeCompare(b.date || '') || (a.created_at || '').localeCompare(b.created_at || ''));

  // หมวดหมู่และสัดส่วน
  const catBreakdown = [
    { label: 'ต้นทุนวัตถุดิบ', amount: matTotal, pct: totalExp > 0 ? (matTotal / totalExp) * 100 : 0 },
    { label: 'ต้นทุนขนมหน้าร้าน', amount: bakTotal, pct: totalExp > 0 ? (bakTotal / totalExp) * 100 : 0 },
    { label: 'รายจ่ายจิปาถะหน้าร้าน', amount: miscTotal, pct: totalExp > 0 ? (miscTotal / totalExp) * 100 : 0 },
    { label: 'ค่าใช้จ่ายดำเนินงาน (OPEX)', amount: opexTotal, pct: totalExp > 0 ? (opexTotal / totalExp) * 100 : 0 },
  ];

  // คำนวณสรุปภาษีหัก ณ ที่จ่าย (สำหรับสำนักงานบัญชี)
  const opexItems = expenses.filter((e) => e.item_key);
  const findOpexAmt = (key, fallbackKey) => {
    const it = opexItems.find((e) => e.item_key === key);
    if (it) return Number(it.total_amount || 0);
    return Number(opexDefaults[fallbackKey || key] || 0);
  };

  const rentAmt = findOpexAmt('rent', 'rent');
  const rentWht = Math.round(rentAmt * 0.05); // 5% ค่าเช่า

  const subStaffAmt = findOpexAmt('staff_sub', 'staff_sub');
  const subStaffWht = Math.round(subStaffAmt * 0.03); // 3% รับเหมาบริการ

  const now = new Date(Date.now() + 7 * 60 * 60 * 1000);
  const printDateStr = `${now.getDate().toString().padStart(2, '0')}/${(now.getMonth() + 1).toString().padStart(2, '0')}/${now.getFullYear()} ${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')} น.`;

  const bizName = bizInfo.name || 'Minimal Maerim (มินิมอล แม่ริม)';
  const bizTaxId = bizInfo.tax_id ? `เลขประจำตัวผู้เสียภาษีอากร: ${bizInfo.tax_id}` : '';
  const bizAddr = bizInfo.address || '';
  const bizPhone = bizInfo.phone ? `โทร. ${bizInfo.phone}` : '';
  const contactLine = [bizAddr, bizPhone].filter(Boolean).join(' · ');

  const html = `<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="utf-8">
  <title>รายงานสรุปรายรับ-รายจ่าย ประจำเดือน ${esc(monthLabel)} - ${esc(bizName)}</title>
  <style>
    @page {
      size: A4 portrait;
      margin: 12mm 14mm 14mm 14mm;
    }
    * {
      box-sizing: border-box;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    body {
      font-family: Sarabun, 'Sarabun PS', 'TH Sarabun New', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      color: #1a1a1a;
      background: #fff;
      margin: 0;
      padding: 0;
      font-size: 12px;
      line-height: 1.4;
    }
    .header-table {
      width: 100%;
      border-bottom: 2px solid #2d241e;
      padding-bottom: 8px;
      margin-bottom: 12px;
    }
    .biz-name {
      font-size: 18px;
      font-weight: 700;
      color: #2d241e;
      letter-spacing: 0.02em;
    }
    .doc-title {
      font-size: 15px;
      font-weight: 700;
      color: #2d241e;
      text-align: right;
    }
    .doc-subtitle {
      font-size: 12px;
      font-weight: 600;
      color: #555;
      text-align: right;
    }
    .meta-bar {
      display: flex;
      justify-content: space-between;
      background: #f8f6f3;
      border: 1px solid #e5dfd8;
      border-radius: 4px;
      padding: 6px 10px;
      margin-bottom: 14px;
      font-size: 11px;
    }
    h3 {
      font-size: 13px;
      font-weight: 700;
      color: #2d241e;
      margin: 14px 0 6px 0;
      padding-bottom: 3px;
      border-bottom: 1px solid #ddd;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 10px;
    }
    th {
      background: #eee8e1;
      color: #2d241e;
      font-weight: 700;
      text-align: left;
      padding: 5px 6px;
      border: 1px solid #c8beaf;
      font-size: 11px;
    }
    td {
      padding: 4px 6px;
      border: 1px solid #e0d8ce;
      font-size: 10.5px;
      vertical-align: top;
    }
    .num {
      text-align: right;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    .center {
      text-align: center;
    }
    .bold {
      font-weight: 700;
    }
    .highlight-row {
      background: #fbf9f6;
      font-weight: 700;
    }
    .grand-row {
      background: #f0eae1;
      font-weight: 700;
      font-size: 11.5px;
      border-top: 2px solid #2d241e;
    }
    .profit-pos {
      color: #1b6d28;
    }
    .profit-neg {
      color: #b3261e;
    }
    .summary-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
      margin-bottom: 12px;
      page-break-inside: avoid;
    }
    .stats-box {
      border: 1px solid #d5cbbf;
      border-radius: 4px;
      padding: 8px 10px;
      background: #faf8f5;
    }
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 8px;
      margin-top: 4px;
      text-align: center;
    }
    .stats-item {
      background: #fff;
      border: 1px solid #e8e2d9;
      border-radius: 4px;
      padding: 5px;
    }
    .stats-label {
      font-size: 10px;
      color: #666;
    }
    .stats-val {
      font-size: 12px;
      font-weight: 700;
      color: #2d241e;
      margin-top: 2px;
    }
    .signatures {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 30px;
      margin-top: 24px;
      page-break-inside: avoid;
    }
    .sign-box {
      border: 1px dashed #aaa;
      border-radius: 4px;
      padding: 12px;
      text-align: center;
      background: #fafafa;
    }
    .sign-line {
      margin-top: 35px;
      border-bottom: 1px dotted #555;
      width: 70%;
      margin-left: auto;
      margin-right: auto;
    }
    .sign-caption {
      margin-top: 6px;
      font-size: 11px;
      font-weight: 600;
    }
    .sign-date {
      margin-top: 4px;
      font-size: 10px;
      color: #666;
    }
    .footer-note {
      margin-top: 14px;
      font-size: 9.5px;
      color: #777;
      text-align: center;
      border-top: 1px solid #eee;
      padding-top: 6px;
    }
    @media print {
      body { margin: 0; }
      .no-print { display: none !important; }
      tr { page-break-inside: avoid; }
    }
  </style>
</head>
<body>

  <table class="header-table" style="border:0; margin-bottom: 6px;">
    <tr>
      <td style="border:0; padding:0; width: 60%;">
        <div class="biz-name">${esc(bizName)}</div>
        <div style="font-size: 11px; color: #444; margin-top: 2px;">${esc(bizTaxId)}</div>
        <div style="font-size: 10.5px; color: #666;">${esc(contactLine)}</div>
      </td>
      <td style="border:0; padding:0; text-align: right; width: 40%; vertical-align: top;">
        <div class="doc-title">รายงานสรุปรายรับ-รายจ่าย</div>
        <div class="doc-subtitle">ประจำงวดเดือน: <b>${esc(monthLabel)}</b></div>
        <div style="font-size: 10px; color: #666; margin-top: 2px;">(เอกสารประกอบการลงบัญชีและภาษี)</div>
      </td>
    </tr>
  </table>

  <div class="meta-bar">
    <div><strong>ผู้จัดทำ / ผู้พิมพ์รายงาน:</strong> ${esc(printedBy || 'ผู้ดูแลระบบ')}</div>
    <div><strong>วันที่และเวลาพิมพ์เอกสาร:</strong> ${esc(printDateStr)}</div>
  </div>

  <!-- สรุปภาพรวมทางการเงิน -->
  <div class="summary-grid">
    <div>
      <h3 style="margin-top:0;">1. สรุปผลการดำเนินงาน (Executive Financial Summary)</h3>
      <table>
        <tr>
          <th>รายการทางการเงิน</th>
          <th class="num" style="width: 110px;">จำนวนเงิน (บาท)</th>
        </tr>
        <tr>
          <td class="bold">รายรับสุทธิ (ยอดขายรวมหัก GP Delivery)</td>
          <td class="num bold">${fmtMoney(income)}</td>
        </tr>
        <tr>
          <td style="padding-left: 14px;">หัก: ต้นทุนขายรวม (วัตถุดิบ + ขนมหน้าร้าน)</td>
          <td class="num">${fmtMoney(cogsTotal)}</td>
        </tr>
        <tr class="highlight-row">
          <td>กำไรขั้นต้น (Gross Profit)</td>
          <td class="num ${grossProfit >= 0 ? 'profit-pos' : 'profit-neg'}">${fmtMoney(grossProfit)}</td>
        </tr>
        <tr>
          <td style="padding-left: 14px;">หัก: รายจ่ายจิปาถะหน้าร้าน</td>
          <td class="num">${fmtMoney(miscTotal)}</td>
        </tr>
        <tr>
          <td style="padding-left: 14px;">หัก: ค่าใช้จ่ายดำเนินงานคงที่ (OPEX)</td>
          <td class="num">${fmtMoney(opexTotal)}</td>
        </tr>
        <tr class="grand-row">
          <td>รวมรายจ่ายทั้งสิ้น (Total Expenses)</td>
          <td class="num">${fmtMoney(totalExp)}</td>
        </tr>
        <tr class="grand-row" style="background: #e8ded2;">
          <td>กำไรสุทธิก่อนภาษี (Net Operating Profit)</td>
          <td class="num bold ${netProfit >= 0 ? 'profit-pos' : 'profit-neg'}">${fmtMoney(netProfit)} ฿</td>
        </tr>
      </table>
    </div>

    <div>
      <h3 style="margin-top:0;">2. รายจ่ายแยกตามหมวดหมู่ (Category Breakdown)</h3>
      <table>
        <tr>
          <th>หมวดหมู่ค่าใช้จ่าย</th>
          <th class="num" style="width: 100px;">จำนวนเงิน (บาท)</th>
          <th class="num" style="width: 60px;">สัดส่วน</th>
        </tr>
        ${catBreakdown
          .map(
            (c) => `<tr>
              <td>${esc(c.label)}</td>
              <td class="num">${fmtMoney(c.amount)}</td>
              <td class="num">${c.pct.toFixed(1)}%</td>
            </tr>`
          )
          .join('')}
        <tr class="grand-row">
          <td>รวมรายจ่ายทั้งสิ้น</td>
          <td class="num">${fmtMoney(totalExp)}</td>
          <td class="num">100.0%</td>
        </tr>
      </table>

      <!-- ภาษีหัก ณ ที่จ่ายสำหรับสำนักงานบัญชี -->
      <h3 style="margin-top: 10px;">3. รายการภาษีหัก ณ ที่จ่ายนำส่ง (Tax Remittance)</h3>
      <table>
        <tr>
          <th>ประเภทภาษี / เงินได้</th>
          <th class="center" style="width: 50px;">อัตรา</th>
          <th class="num" style="width: 90px;">ฐานเงินจ่าย</th>
          <th class="num" style="width: 80px;">ภาษีหักนำส่ง</th>
        </tr>
        <tr>
          <td>ภ.ง.ด. 53 (ค่าเช่าสถานที่ — 50 ทวิ)</td>
          <td class="center">5%</td>
          <td class="num">${fmtMoney(rentAmt)}</td>
          <td class="num bold">${fmtMoney(rentWht)}</td>
        </tr>
        <tr>
          <td>ภ.ง.ด. 3 (ค่าจ้างบริการ / รับเหมา — 50 ทวิ)</td>
          <td class="center">3%</td>
          <td class="num">${fmtMoney(subStaffAmt)}</td>
          <td class="num bold">${fmtMoney(subStaffWht)}</td>
        </tr>
      </table>
    </div>
  </div>

  <!-- สถิติการขาย -->
  <div class="stats-box" style="margin-bottom: 14px;">
    <div style="font-size: 11px; font-weight: 700; color: #2d241e;">4. สถิติการขายและการให้บริการ (Sales Statistics)</div>
    <div class="stats-grid">
      <div class="stats-item">
        <div class="stats-label">จำนวนวันที่เปิดบันทึกยอด</div>
        <div class="stats-val">${daysRecorded} วัน</div>
      </div>
      <div class="stats-item">
        <div class="stats-label">ปริมาณขายเครื่องดื่มรวม</div>
        <div class="stats-val">${fmtMoney(totalCups)} แก้ว</div>
      </div>
      <div class="stats-item">
        <div class="stats-label">รายได้จากขนมหน้าร้าน</div>
        <div class="stats-val">${fmtMoney(pastryRev)} บาท</div>
      </div>
      <div class="stats-item">
        <div class="stats-label">แก้วสิทธิพิเศษ / สมาชิกสะสมแต้ม</div>
        <div class="stats-val">${fmtMoney(freeCups)} แก้ว</div>
      </div>
    </div>
  </div>

  <!-- รายการรายจ่ายทั้งเดือน -->
  <h3>
    <span>5. บัญชีรายการรายจ่ายทั้งเดือน (Itemized Monthly Expense Ledger)</span>
    <span style="font-size: 10.5px; font-weight: 400; color: #666;">(รวม ${regularItems.length} รายการ)</span>
  </h3>
  <table>
    <thead>
      <tr>
        <th style="width: 25px;" class="center">#</th>
        <th style="width: 65px;">วันที่</th>
        <th style="width: 100px;">หมวดหมู่</th>
        <th>รายการ</th>
        <th style="width: 120px;">ผู้ขาย / ซัพพลายเออร์</th>
        <th class="num" style="width: 70px;">จำนวน</th>
        <th class="num" style="width: 65px;">ราคา/หน่วย</th>
        <th style="width: 65px;" class="center">วิธีชำระ</th>
        <th class="num" style="width: 80px;">รวม (บาท)</th>
      </tr>
    </thead>
    <tbody>
      ${
        regularItems.length === 0
          ? `<tr><td colspan="9" class="center" style="padding: 16px; color: #888;">ไม่มีรายการรายจ่ายในงวดเดือนนี้</td></tr>`
          : regularItems
              .map(
                (r, idx) => `<tr>
              <td class="center" style="color: #666;">${idx + 1}</td>
              <td>${esc(r.date)}</td>
              <td>${esc(catLabel[r.category] || r.category)}</td>
              <td><b>${esc(r.item_name)}</b></td>
              <td>${esc(r.subcategory || '—')}</td>
              <td class="num">${fmtMoney(r.quantity)} ${esc(r.unit || '')}</td>
              <td class="num">${fmtMoney(r.unit_price)}</td>
              <td class="center">${esc(r.payment_method || '—')}</td>
              <td class="num bold">${fmtMoney(r.total_amount)}</td>
            </tr>`
              )
              .join('')
      }
      ${
        regularItems.length > 0
          ? `<tr class="grand-row">
              <td colspan="8" style="text-align: right;">รวมรายการรายจ่ายทั่วไปทั้งเดือน (ไม่รวม OPEX)</td>
              <td class="num bold">${fmtMoney(matTotal + bakTotal + miscTotal)}</td>
            </tr>`
          : ''
      }
    </tbody>
  </table>

  <!-- ส่วนลงนามรับรองเอกสาร -->
  <div class="signatures">
    <div class="sign-box">
      <div style="font-size: 11px; font-weight: 700; color: #333;">ผู้จัดทำ / ผู้พิมพ์รายงาน (Prepared By)</div>
      <div class="sign-line"></div>
      <div class="sign-caption">(${esc(printedBy || 'ผู้จัดทำรายงาน')})</div>
      <div class="sign-date">วันที่ ........ / ........ / ................</div>
    </div>
    <div class="sign-box">
      <div style="font-size: 11px; font-weight: 700; color: #333;">ผู้ตรวจสอบ / กรรมการผู้มีอำนาจลงนาม (Approved By)</div>
      <div class="sign-line"></div>
      <div class="sign-caption">(....................................................................)</div>
      <div class="sign-date">วันที่ ........ / ........ / ................</div>
    </div>
  </div>

  <div class="footer-note">
    เอกสารสรุปผลการดำเนินงานนี้จัดทำขึ้นโดยระบบบริหารจัดการ ${esc(bizName)} เพื่อใช้ประกอบการตรวจสอบบัญชีและยื่นภาษีประจำงวด
  </div>

</body>
</html>`;

  const w = window.open('', '_blank', 'width=900,height=1000');
  if (!w) {
    alert('เบราว์เซอร์บล็อกป๊อปอัป — โปรดอนุญาตป๊อปอัปเพื่อเปิดเอกสารสำหรับพิมพ์หรือบันทึกเป็น PDF');
    return;
  }
  w.document.write(html);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 500);
}
