import { headers } from 'next/headers';

/**
 * แยก User-Agent เป็นชิ้นๆ (ชนิดเครื่อง / OS / เบราว์เซอร์ พร้อมเลขเวอร์ชัน)
 * เก็บแยกคอลัมน์ใน audit_log ด้วย เพื่อให้กรอง/จัดกลุ่มได้ ไม่ต้องมานั่ง LIKE ทั้งสตริง
 */
export function parseUserAgent(ua) {
  const s = String(ua || '');
  if (!s) return { form: '', os: '', browser: '', summary: 'ไม่ทราบเครื่อง' };

  const form = /iPad|Tablet/i.test(s)
    ? 'แท็บเล็ต'
    : /Mobile|Android|iPhone/i.test(s)
      ? 'มือถือ'
      : 'คอมพิวเตอร์';

  const m = (re) => (s.match(re) || [])[1] || '';
  let os = 'OS อื่น';
  if (/Windows NT/i.test(s)) {
    // Windows 11 รายงานตัวเองเป็น NT 10.0 เหมือน Windows 10 — แยกจาก UA ไม่ได้ จึงเขียนรวม
    const v = m(/Windows NT ([0-9._]+)/i);
    os = v === '10.0' ? 'Windows 10/11' : `Windows${v ? ' NT ' + v : ''}`;
  } else if (/Android/i.test(s)) {
    os = `Android${m(/Android ([0-9._]+)/i) ? ' ' + m(/Android ([0-9._]+)/i) : ''}`;
  } else if (/iPhone|iPad|iOS/i.test(s)) {
    os = `iOS${m(/OS ([0-9_]+)/i) ? ' ' + m(/OS ([0-9_]+)/i).replace(/_/g, '.') : ''}`;
  } else if (/Mac OS X|Macintosh/i.test(s)) {
    os = `macOS${m(/Mac OS X ([0-9_]+)/i) ? ' ' + m(/Mac OS X ([0-9_]+)/i).replace(/_/g, '.') : ''}`;
  } else if (/Linux/i.test(s)) {
    os = 'Linux';
  }

  // ลำดับสำคัญ: Edge/Opera/Samsung แปะ Chrome ไว้ใน UA ด้วย ถ้าเช็ค Chrome ก่อนจะจับผิดหมด
  let browser = 'เบราว์เซอร์อื่น';
  if (/Edg\//i.test(s)) browser = `Edge ${m(/Edg\/([0-9.]+)/i)}`;
  else if (/OPR\/|Opera/i.test(s)) browser = `Opera ${m(/(?:OPR|Opera)\/([0-9.]+)/i)}`;
  else if (/SamsungBrowser\//i.test(s)) browser = `Samsung ${m(/SamsungBrowser\/([0-9.]+)/i)}`;
  else if (/Line\//i.test(s)) browser = `LINE ${m(/Line\/([0-9.]+)/i)}`;
  else if (/FBAV\/|FBAN\//i.test(s)) browser = 'Facebook in-app';
  else if (/CriOS\//i.test(s)) browser = `Chrome iOS ${m(/CriOS\/([0-9.]+)/i)}`;
  else if (/Chrome\//i.test(s)) browser = `Chrome ${m(/Chrome\/([0-9.]+)/i)}`;
  else if (/Firefox\//i.test(s)) browser = `Firefox ${m(/Firefox\/([0-9.]+)/i)}`;
  else if (/Safari/i.test(s)) browser = `Safari ${m(/Version\/([0-9.]+)/i)}`;
  browser = browser.trim();

  return { form, os, browser, summary: `${form} · ${os} · ${browser}` };
}

/** สรุปเครื่องจาก User-Agent (device / OS / browser) — เก็บไว้เพื่อความเข้ากันได้ย้อนหลัง */
export function summarizeDevice(ua) {
  return parseUserAgent(ua).summary;
}

function firstIp(raw) {
  return String(raw || '')
    .split(',')
    .map((x) => x.trim())
    .find((x) => x && x !== 'unknown') || '';
}

/**
 * อ่านบริบทคำขอจาก header ที่ nginx + Cloudflare ส่งมา (Server Action / Route Handler)
 *
 * ⚠️ ทุกค่าที่นี่คือ "ค่าที่รายงานมา" ไม่ใช่หลักฐานแข็ง — set_audit_context ถูก grant
 * ให้ role authenticated เรียกได้ ผู้ใช้ที่ล็อกอินแล้วจึงยัดค่าปลอมเองผ่าน devtools ได้
 * ตัวที่ปลอมไม่ได้คือ session_id / actor_email ซึ่งฝั่ง SQL อ่านจาก claim ใน JWT เอง
 * (ดูหัวไฟล์ sql/add_audit_forensics.sql)
 */
export async function getRequestMeta(pathHint) {
  const h = await headers();
  const xff = h.get('x-forwarded-for') || '';
  const ip = firstIp(h.get('cf-connecting-ip') || h.get('x-real-ip') || xff);
  const userAgent = h.get('user-agent') || '';
  const country = (h.get('cf-ipcountry') || '').toUpperCase();
  const path = pathHint || h.get('x-invoke-path') || '';
  const { form, os, browser, summary } = parseUserAgent(userAgent);

  return {
    ip,
    userAgent,
    device: summary,
    deviceForm: form,
    os,
    browser,
    country: country && country !== 'XX' ? country : '',
    path,
    // CF-Ray = รหัสคำขอของ Cloudflare เอาไปเทียบกับ log ฝั่ง Cloudflare ได้ตรงคำขอ
    cfRay: h.get('cf-ray') || '',
    // สาย proxy ทั้งหมด ต่างจาก ip ที่เลือกมาตัวเดียว — เห็นว่ามี VPN/proxy คั่นไหม
    forwardedFor: xff,
    referer: h.get('referer') || '',
    acceptLanguage: h.get('accept-language') || '',
    method: h.get('x-http-method') || '',
    // สองตัวนี้ต้องเปิด Managed Transform บน Cloudflare ก่อนถึงจะมีค่า ไม่เปิดก็ว่างเฉยๆ
    asn: h.get('cf-ipasn') || '',
    city: h.get('cf-ipcity') || '',
  };
}
