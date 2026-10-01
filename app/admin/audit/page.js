import { redirect } from 'next/navigation';
import Link from 'next/link';
import { requireSession } from '../../../lib/session';
import AppShell from '../../../components/app-shell';
import PageHeader from '../../../components/page-header';
import AuditFilters from './audit-filters';
import AuditRow from './audit-row';
import AuditPurge from './audit-purge';

const VALID_TABLES = new Set([
  'sales_daily', 'expenses', 'business_config', 'profiles',
  'auth', 'access', 'admin', 'reports',
  'customers', 'point_transactions', 'redemption_history',
]);
const VALID_ACTIONS = new Set([
  'INSERT', 'UPDATE', 'DELETE',
  'LOGIN', 'LOGIN_FAIL', 'LOGOUT', 'DENY', 'EXPORT', 'IMPORT',
  'CREATE_USER', 'UPDATE_USER', 'RESET_PASSWORD', 'TOGGLE_USER', 'DELETE_USER',
]);
const PAGE_SIZES = [10, 20, 50, 100];
const DEFAULT_LIMIT = 20;

// เลือกคอลัมน์แบบไล่ลง: ถ้า SQL ไฟล์ล่าสุดยังไม่ได้รัน คอลัมน์ที่ยังไม่มีจะทำให้ทั้ง query พัง
// จึงถอยไปชุดที่แคบลงทีละขั้นแทนที่จะโชว์หน้าเปล่า (พร้อมบอกว่าต้องรันไฟล์ไหน)
const COLS_BASE = 'id, table_name, record_id, action, old_data, new_data, performed_by, performed_at';
const COLS_CONTEXT = `${COLS_BASE}, ip_address, user_agent, device_summary, request_path, actor_username, actor_role, outcome, country`;
const COLS_FORENSICS = `${COLS_CONTEXT}, session_id, actor_email, cf_ray, referer, accept_language, forwarded_for, http_method, browser, os, device_form, asn, city`;
const COL_TIERS = [
  { cols: COLS_FORENSICS, hint: '' },
  { cols: COLS_CONTEXT, hint: 'ยังไม่ได้รัน sql/add_audit_forensics.sql — ยังไม่มี session, อีเมล, CF-Ray, referer และเบราว์เซอร์/OS แยกช่อง' },
  { cols: COLS_BASE, hint: 'ยังไม่ได้รัน sql/add_audit_context.sql ใน Supabase — ตอนนี้เห็นแค่ใคร/ทำอะไร/เมื่อไหร่ ยังไม่มี IP และเครื่อง' },
];

export default async function AuditPage({ searchParams }) {
  const { supabase, role, name, isAdmin, allowed } = await requireSession();
  if (!isAdmin) redirect('/dashboard');

  const sp = await searchParams;
  const table = VALID_TABLES.has(sp?.table) ? sp.table : '';
  const action = VALID_ACTIONS.has(sp?.action) ? sp.action : '';
  const ip = String(sp?.ip || '').trim();
  const q = String(sp?.q || '').trim();
  const parsed = Number(sp?.limit);
  const limit = PAGE_SIZES.includes(parsed) ? parsed : DEFAULT_LIMIT;

  // .or() รับ filter เป็นสตริงดิบ — ตัดอักขระที่มีความหมายในไวยากรณ์ของ PostgREST ออกก่อน
  // ไม่งั้นค่าที่มี , . ( ) " หรือ % ปนมาจะทำให้เงื่อนไขเพี้ยนและกรองผิดโดยไม่มี error
  const qSafe = q.replace(/[,.()"\\%*]/g, '');

  let rows = null;
  let error = null;
  let sqlHint = '';
  for (const tier of COL_TIERS) {
    let query = supabase
      .from('audit_log')
      .select(tier.cols)
      .order('performed_at', { ascending: false })
      .limit(limit);
    if (table) query = query.eq('table_name', table);
    if (action) query = query.eq('action', action);
    if (ip && tier.cols !== COLS_BASE) query = query.ilike('ip_address', `%${ip}%`);
    if (qSafe && tier.cols !== COLS_BASE) {
      query = query.or(`actor_username.ilike.%${qSafe}%,actor_role.ilike.%${qSafe}%`);
    }
    const res = await query;
    rows = res.data;
    error = res.error;
    if (!error || !/column|does not exist/i.test(error.message || '')) {
      sqlHint = tier.hint;
      break;
    }
  }

  const userIds = [...new Set((rows || []).map((r) => r.performed_by).filter(Boolean))];
  let profileMap = {};
  if (userIds.length) {
    const { data: profs } = await supabase.from('profiles').select('id, username, full_name, role').in('id', userIds);
    (profs || []).forEach((p) => { profileMap[p.id] = p; });
  }

  return (
    <AppShell role={role} name={name} isAdmin={isAdmin} allowed={allowed}>
      <PageHeader icon="ti-history" title="ประวัติการใช้งาน (Audit Log)">
        <Link className="link-btn" href="/admin">← กลับหน้าผู้ใช้</Link>
      </PageHeader>

      <p className="muted" style={{ fontSize: 'var(--fs-sm)', marginTop: -8, marginBottom: 12 }}>
        เห็นได้เฉพาะ Super Admin (ตำแหน่ง admin) · เก็บผู้ใช้ · การกระทำ · เวลา · session · อีเมล · IP ·
        ประเทศ/เมือง · เครื่อง/OS/เบราว์เซอร์ · หน้า · CF-Ray · User-Agent
      </p>
      <p className="muted" style={{ fontSize: 'var(--fs-xs)', marginTop: -6, marginBottom: 12 }}>
        หมายเหตุ: IP และ User-Agent เป็นค่าที่แอปรายงานมา ผู้ใช้ที่ล็อกอินแล้วปลอมได้ในทางทฤษฎี —
        ช่อง session กับอีเมลมาจาก JWT ปลอมไม่ได้ ใช้ยึดเวลาสอบสวน
      </p>

      <div style={{ marginBottom: 12 }}>
        <AuditFilters table={table} action={action} ip={ip} q={q} limit={limit} />
      </div>

      {sqlHint && (
        <div className="card" style={{ marginBottom: 12 }}>
          <div className="card-body" style={{ color: 'var(--taupe-dark)', fontSize: 'var(--fs-base)' }}>{sqlHint}</div>
        </div>
      )}
      {error && (
        <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: 12 }}>
          <div className="card-body" style={{ color: 'var(--danger)', fontSize: 'var(--fs-base)' }}>
            {error.message}
          </div>
        </div>
      )}

      {!error && (!rows || !rows.length) && (
        <p className="muted" style={{ fontSize: 'var(--fs-base)' }}>ไม่พบรายการตามเงื่อนไขที่เลือก</p>
      )}

      <div style={{ display: 'grid', gap: 8 }}>
        {(rows || []).map((r) => (
          <AuditRow key={r.id} row={r} performer={profileMap[r.performed_by]} />
        ))}
      </div>

      {rows?.length === limit && (
        <p className="muted" style={{ fontSize: 'var(--fs-xs)', marginTop: 10 }}>
          แสดง {limit} รายการล่าสุด — เลือกจำนวนด้านบนหรือใช้ตัวกรองเพื่อดูเพิ่ม
        </p>
      )}

      <AuditPurge />
    </AppShell>
  );
}
