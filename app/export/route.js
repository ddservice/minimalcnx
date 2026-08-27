import ExcelJS from 'exceljs';
import { createClient } from '../../lib/supabase/server';
import { monthInputToLabel, currentMonthInput, OPEX_ALL_CATEGORIES, computeEffectiveOpex } from '../../lib/opex';
import { readBusinessConfig } from '../../lib/config-store';
import { logAuditEvent } from '../../lib/audit';

export const runtime = 'nodejs';

const money = { numFmt: '#,##0.00' };

// GET /export?month=YYYY-MM  → ดาวน์โหลด .xlsx สรุปรายเดือน
export async function GET(request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response('Unauthorized', { status: 401 });

  const url = new URL(request.url);
  const m = url.searchParams.get('month');
  const monthInput = /^\d{4}-\d{2}$/.test(m || '') ? m : currentMonthInput();
  const monthLabel = monthInputToLabel(monthInput);

  const [{ data: summary }, opexDefaults] = await Promise.all([
    supabase.rpc('get_monthly_summary', { p_month_label: monthLabel }),
    readBusinessConfig(supabase, 'opex_defaults', {}),
  ]);
  const sales = summary?.sales || [];
  const expenses = summary?.expenses || [];

  // ── คำนวณ (ตรงกับหน้ารายงาน) ──
  const income = sales.reduce((a, s) => a + Number(s.net_revenue || 0), 0);
  const catSum = (c) =>
    expenses.filter((e) => !e.item_key && e.category === c).reduce((a, e) => a + Number(e.total_amount || 0), 0);
  const matTotal = catSum('ต้นทุนวัตถุดิบ');
  const bakTotal = catSum('ต้นทุนขนมหน้าร้าน');
  const miscTotal = catSum('รายจ่ายจิปาถะ');
  const opexTotal = computeEffectiveOpex(expenses, opexDefaults);
  const totalExp = matTotal + bakTotal + miscTotal + opexTotal;
  const profit = income - totalExp;
  const freeCups = sales.reduce((a, s) => a + Number(s.free_cups || 0), 0);

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Minimal Maerim';
  wb.created = new Date();

  // ── Sheet 1: สรุป ──
  const s1 = wb.addWorksheet('สรุป');
  s1.columns = [{ width: 32 }, { width: 18 }];
  s1.addRow([`สรุปรายเดือน — ${monthLabel}`]).font = { bold: true, size: 14 };
  s1.addRow([]);
  const kv = (label, val, color, fmt) => {
    const r = s1.addRow([label, val]);
    r.getCell(2).numFmt = fmt || money.numFmt;
    if (color) r.getCell(2).font = { bold: true, color: { argb: color } };
    return r;
  };
  kv('รายรับสุทธิ (หัก GP)', income, 'FF1E7E34');
  s1.addRow([]);
  kv('ต้นทุนวัตถุดิบ', matTotal);
  kv('ต้นทุนขนม', bakTotal);
  kv('รายจ่ายจิปาถะ', miscTotal);
  kv('ค่าดำเนินการ', opexTotal);
  kv('รวมรายจ่าย', totalExp, 'FFC0392B');
  s1.addRow([]);
  kv(profit >= 0 ? 'กำไรสุทธิ' : 'ขาดทุนสุทธิ', profit, profit >= 0 ? 'FF1A5FA5' : 'FFC0392B');
  s1.addRow([]);
  kv('แก้วฟรี (แก้ว)', freeCups, null, '#,##0');

  // ── Sheet 2: ยอดขายรายวัน ──
  const s2 = wb.addWorksheet('ยอดขายรายวัน');
  s2.columns = [
    { header: 'วันที่', key: 'date', width: 14 },
    { header: 'แก้วรวม', key: 'cups', width: 10 },
    { header: 'แก้วฟรี(แก้ว)', key: 'freeCups', width: 12 },
    { header: 'K-Shop', key: 'kshop', width: 12 },
    { header: 'เงินสด', key: 'cash', width: 12 },
    { header: 'Shopee(ก่อน GP)', key: 'shopee', width: 15 },
    { header: 'Grab(ก่อน GP)', key: 'grab', width: 14 },
    { header: 'Lineman(ก่อน GP)', key: 'lineman', width: 15 },
    { header: 'รายได้ขนม', key: 'pastry', width: 12 },
    { header: 'รายรับสุทธิ', key: 'net', width: 14 },
  ];
  s2.getRow(1).font = { bold: true };
  [...sales]
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))
    .forEach((s) => {
      const r = s2.addRow({
        date: s.date,
        cups: Number(s.total_cups || 0),
        freeCups: Number(s.free_cups || 0),
        kshop: Number(s.kshop_amount || 0),
        cash: Number(s.cash_amount || 0),
        shopee: Number(s.shopee_before_gp || 0),
        grab: Number(s.grab_before_gp || 0),
        lineman: Number(s.lineman_before_gp || 0),
        pastry: Number(s.pastry_revenue || 0),
        net: Number(s.net_revenue || 0),
      });
      ['kshop', 'cash', 'shopee', 'grab', 'lineman', 'pastry', 'net'].forEach((k) => {
        r.getCell(s2.getColumn(k).number).numFmt = money.numFmt;
      });
    });

  // ── Sheet 3: รายจ่าย ──
  const s3 = wb.addWorksheet('รายจ่าย');
  s3.columns = [
    { header: 'วันที่', key: 'date', width: 14 },
    { header: 'หมวด', key: 'category', width: 20 },
    { header: 'รายการ', key: 'item', width: 26 },
    { header: 'ผู้ขาย', key: 'sub', width: 18 },
    { header: 'จำนวน', key: 'qty', width: 10 },
    { header: 'หน่วย', key: 'unit', width: 10 },
    { header: 'ราคา/หน่วย', key: 'price', width: 12 },
    { header: 'รวม (฿)', key: 'total', width: 14 },
    { header: 'ชำระด้วย', key: 'method', width: 14 },
  ];
  s3.getRow(1).font = { bold: true };
  [...expenses]
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))
    .forEach((e) => {
      const r = s3.addRow({
        date: e.date,
        category: e.category,
        item: e.item_name,
        sub: e.subcategory || '',
        qty: Number(e.quantity || 0),
        unit: e.unit || '',
        price: Number(e.unit_price || 0),
        total: Number(e.total_amount || 0),
        method: e.payment_method || '',
      });
      ['price', 'total'].forEach((k) => {
        r.getCell(s3.getColumn(k).number).numFmt = money.numFmt;
      });
    });

  const buf = await wb.xlsx.writeBuffer();
  const filename = `minimalcnx-${monthLabel.replace('/', '-')}.xlsx`;
  await logAuditEvent(supabase, {
    action: 'EXPORT',
    table: 'reports',
    details: { month: monthLabel, filename },
    pathHint: '/export',
  });
  return new Response(buf, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}
