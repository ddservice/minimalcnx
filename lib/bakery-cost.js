// Bakery purchase cost and POS review. All money is rounded in satang.
export const BAKERY_CATEGORY = 'ต้นทุนขนมหน้าร้าน';
export const money = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
export function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value || '') &&
    !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
export function validMonth(value) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value || '') && Number(value.slice(0, 4)) >= 2000;
}
export function monthBounds(month) {
  if (!validMonth(month)) throw new Error('เดือนไม่ถูกต้อง');
  const [year, m] = month.split('-').map(Number);
  return { start: `${month}-01`, end: `${m === 12 ? year + 1 : year}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-01` };
}
export function normalizeName(name) {
  return String(name || '').normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();
}
export function posBakeryName(name) {
  const text = String(name || '').trim();
  // Generic POS names carry the actual pastry in the ประเภท modifier.
  const variant = text.match(/ประเภท\s*:\s*(.+?)\s+x\s+\d+(?:\.\d+)?(?:\s|$)/i);
  return (variant ? variant[1] : text).trim();
}
export function computeInvoice(input) {
  const discount = Number(input.discount_pct);
  if (input.discount_pct === '' || input.discount_pct == null || !Number.isFinite(discount) || discount < 0 || discount > 100 || money(discount) !== discount) throw new Error('ส่วนลดต้องอยู่ระหว่าง 0–100 และไม่เกิน 2 ตำแหน่ง');
  if (!Array.isArray(input.lines) || !input.lines.length || input.lines.length > 100) throw new Error('ต้องมีขนม 1–100 รายการ');
  const lines = input.lines.map((r, i) => {
    const qty = Number(r.quantity), price = Number(r.unit_price);
    if (!String(r.name || '').trim() || !String(r.unit || '').trim() || r.unit_price === '' || r.unit_price == null || !Number.isFinite(qty) || qty <= 0 || qty > 100000 || !Number.isFinite(price) || price < 0 || price > 1000000 || money(price) !== price || Math.abs(Math.round(qty * 1000) - qty * 1000) > 0.000001) throw new Error(`รายการที่ ${i + 1}: ตรวจชื่อ หน่วย จำนวน และราคา`);
    const gross = money(qty * price);
    return { name: String(r.name).trim(), unit: String(r.unit).trim(), quantity: qty, unit_price: price, gross, net: money(gross * (1 - discount / 100)) };
  });
  const gross = money(lines.reduce((a, r) => a + r.gross, 0));
  const net = money(gross * (1 - discount / 100));
  // The invoice is authoritative: allocate any satang rounding residue to last line.
  lines[lines.length - 1].net = money(lines.at(-1).net + net - money(lines.reduce((a, r) => a + r.net, 0)));
  if (lines.some(r => r.net < 0)) throw new Error('ส่วนลดปัดเศษไม่ถูกต้อง');
  return { lines, gross, discount: money(gross - net), net };
}

function dateFromCell(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const text = String(value || '').trim();
  const m = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return text;
  const year = Number(m[3]) > 2500 ? Number(m[3]) - 543 : Number(m[3]);
  return `${year}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

// Receives plain cell arrays from ExcelJS. Never adds the workbook's Total row.
export function parseBakeryPOS(grid, month) {
  if (!validMonth(month)) throw new Error('เดือนไม่ถูกต้อง');
  const headerIndex = grid.findIndex(row => row.includes('วันที่ชำระเงิน') && row.includes('ชื่อเมนู'));
  if (headerIndex < 0) throw new Error('ใช้ไฟล์ Wongnai ยอดขายแยกตามรายละเอียดบิล (ไม่ใช่ยอดขายสินค้าตามวัน)');
  const header = grid[headerIndex];
  const index = Object.fromEntries(header.map((h, i) => [String(h).trim(), i]));
  for (const h of ['วันที่ชำระเงิน', 'ชื่อเมนู', 'หมายเลขใบเสร็จ / ID', 'หมวดสินค้า', 'จำนวน', 'ราคาสุทธิ', 'ช่องทาง', 'สาขา']) {
    if (!(h in index)) throw new Error(`ไม่พบคอลัมน์ ${h}`);
  }
  const rows = [], issues = [], dates = new Set(), branches = new Set();
  grid.slice(headerIndex + 1).forEach((cells, offset) => {
    const rowNo = headerIndex + offset + 2;
    if (!cells.some(v => v !== '' && v != null) || /^total$/i.test(String(cells[0]).trim())) return;
    const get = (h) => cells[index[h]];
    const date = dateFromCell(get('วันที่ชำระเงิน'));
    if (!validDate(date) || !date.startsWith(`${month}-`)) {
      issues.push(`แถว ${rowNo}: วันที่ ${String(get('วันที่ชำระเงิน'))} ไม่อยู่ในเดือนที่เลือก`);
      return;
    }
    dates.add(date);
    if (get('สาขา')) branches.add(String(get('สาขา')).trim());
    if (String(get('หมวดสินค้า')).trim().toUpperCase() !== 'BAKERY') return;
    const quantity = Number(get('จำนวน')), revenue = Number(get('ราคาสุทธิ'));
    const name = posBakeryName(get('ชื่อเมนู'));
    const receipt = String(get('หมายเลขใบเสร็จ / ID') || '').trim();
    if (!name || !receipt || !Number.isFinite(quantity) || quantity <= 0 || quantity > 100000 || !Number.isFinite(revenue) || revenue < 0 || revenue > 10000000) {
      issues.push(`แถว ${rowNo}: ชื่อขนม เลขบิล จำนวน หรือยอดเงินไม่ถูกต้อง`); return;
    }
    rows.push({ date, receipt, name, key: normalizeName(name), quantity, revenue: money(revenue), channel: String(get('ช่องทาง') || '').trim(), source_row: rowNo });
  });
  if (branches.size > 1) issues.push('มีหลายสาขาในไฟล์ กรุณาส่งออกรายงานทีละสาขา');
  if (!rows.length) issues.push('ไม่พบรายการหมวด BAKERY ในเดือนที่เลือก');
  if (rows.length > 4000) issues.push('รายการขนมเกิน 4,000 แถว กรุณาแบ่งช่วงวันที่');
  if (new TextEncoder().encode(JSON.stringify(rows)).length > 650000) issues.push('รายละเอียดขนมใหญ่เกินไป กรุณาแยกไฟล์ต้นทางก่อนนำเข้า');
  return { month, rows, issues, branches: [...branches], days: [...dates].sort() };
}

export function bakeryReview(invoices, rows, mappings, sales = []) {
  const purchases = new Map();
  let purchaseTotal = 0;
  for (const invoice of invoices.filter(r => r.status === 'posted')) {
    const calc = computeInvoice(invoice);
    purchaseTotal = money(purchaseTotal + calc.net);
    for (const line of calc.lines) {
      const key = `${normalizeName(invoice.supplier)}|${normalizeName(line.name)}`;
      const prev = purchases.get(key) || { quantity: 0, net: 0, units: new Set() };
      prev.quantity += line.quantity; prev.net = money(prev.net + line.net); prev.units.add(line.unit);
      purchases.set(key, prev);
    }
  }
  const groups = new Map();
  for (const row of rows) {
    const prev = groups.get(row.key) || { key: row.key, name: row.name, quantity: 0, revenue: 0, zeroQuantity: 0 };
    prev.quantity += row.quantity; prev.revenue = money(prev.revenue + row.revenue);
    if (row.revenue === 0) prev.zeroQuantity += row.quantity;
    groups.set(row.key, prev);
  }
  let coveredRevenue = 0, coveredCost = 0, revenue = 0, quantity = 0;
  const items = [...groups.values()].map(item => {
    const mapping = mappings.find(m => m.pos_key === item.key);
    const purchase = mapping && purchases.get(`${normalizeName(mapping.supplier)}|${normalizeName(mapping.purchase_name)}`);
    const covered = !!(purchase && purchase.units.size === 1 && Number(mapping.factor) > 0 && item.zeroQuantity === 0);
    const cost = covered ? money(item.quantity * Number(mapping.factor) * purchase.net / purchase.quantity) : null;
    revenue = money(revenue + item.revenue); quantity += item.quantity;
    if (covered) { coveredRevenue = money(coveredRevenue + item.revenue); coveredCost = money(coveredCost + cost); }
    return { ...item, cost, margin: covered ? money(item.revenue - cost) : null,
      reason: covered ? '' : item.zeroQuantity ? 'มีรายการราคา 0 ต้องตรวจสถานะบิล' : !mapping ? 'ยังไม่ยืนยันคู่สินค้า/หน่วย' : !purchase ? 'ไม่มีต้นทุนซื้อในเดือนนี้' : 'หน่วยซื้อไม่ตรงกัน' };
  });
  const daily = new Map();
  for (const row of rows) {
    const prev = daily.get(row.date) || { date: row.date, pos_quantity: 0, pos_revenue: 0, zero_quantity: 0 };
    prev.pos_quantity += row.quantity; prev.pos_revenue = money(prev.pos_revenue + row.revenue);
    if (!row.revenue) prev.zero_quantity += row.quantity;
    daily.set(row.date, prev);
  }
  const dates = [...new Set([...daily.keys(), ...sales.map(r => r.date)])].sort();
  return { items, quantity, revenue, purchaseTotal, coveredRevenue, coveredCost,
    complete: items.length > 0 && items.every(r => r.cost !== null),
    coveredMargin: money(coveredRevenue - coveredCost),
    daily: dates.map(date => {
      const pos = daily.get(date) || { date, pos_quantity: 0, pos_revenue: 0, zero_quantity: 0 };
      const saved = sales.find(r => r.date === date);
      return { ...pos, saved_quantity: saved?.pastry_pieces ?? null, saved_revenue: saved?.pastry_revenue ?? null,
        difference: saved ? money(pos.pos_revenue - Number(saved.pastry_revenue)) : null };
    }) };
}
