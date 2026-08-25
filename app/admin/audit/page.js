import { redirect } from 'next/navigation';
import Link from 'next/link';
import { requireSession } from '../../../lib/session';
import AppShell from '../../../components/app-shell';
import PageHeader from '../../../components/page-header';
import AuditFilters from './audit-filters';
import AuditRow from './audit-row';

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
const SELECT_COLS = 'id, table_name, record_id, action, old_data, new_data, performed_by, performed_at, ip_address, user_agent, device_summary, request_path, actor_username, actor_role, outcome, country';

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

  let query = supabase
    .from('audit_log')
    .select(SELECT_COLS)
    .order('performed_at', { ascending: false })
    .limit(limit);
  if (table) query = query.eq('table_name', table);
  if (action) query = query.eq('action', action);
  if (ip) query = query.ilike('ip_address', `%${ip}%`);
  // .or() รับ filter เป็นสตริงดิบ — ตัดอักขระที่มีความหมายในไวยากรณ์ของ PostgREST ออกก่อน
  // ไม่งั้นค่าที่มี , . ( ) " หรือ % ปนมาจะทำให้เงื่อนไขเพี้ยนและกรองผิดโดยไม่มี error
  const qSafe = q.replace(/[,.()"\\%*]/g, '');
  if (qSafe) query = query.or(`actor_username.ilike.%${qSafe}%,actor_role.ilike.%${qSafe}%`);

  let { data: rows, error } = await query;
  let sqlHint = '';
  if (error && /column|does not exist/i.test(error.message || '')) {
    sqlHint = 'ยังไม่ได้รัน sql/add_audit_context.sql ใน Supabase — ตอนนี้เห็นแค่ใคร/ทำอะไร/เมื่อไหร่ ยังไม่มี IP และเครื่อง';
    const fallback = await supabase
      .from('audit_log')
      .select('id, table_name, record_id, action, old_data, new_data, performed_by, performed_at')
      .order('performed_at', { ascending: false })
      .limit(limit);
    rows = fallback.data;
    error = fallback.error;
  }

  const userIds = [...new Set((rows || []).map((r) => r.performed_by).filter(Boolean))];
  let profileMap = {};
  if (userIds.length) {
    const { data: profs } = await supabase.from('profiles').select('id, username, full_name, role').in('id', userIds);
    (profs || []).forEach((p) => { profileMap[p.id] = p; });
  }

  return (
    <AppShell role={role} name={name} isAdmin={isAdmin} allowed={allowed}>
      <PageHeader icon="ti-history" title="บันทึกตรวจสอบ (Super Admin)">
        <Link className="link-btn" href="/admin">← กลับหน้าผู้ใช้</Link>
      </PageHeader>

      <p className="muted" style={{ fontSize: 12, marginTop: -8, marginBottom: 12 }}>
        เห็นได้เฉพาะ Super Admin (ตำแหน่ง admin) · เก็บผู้ใช้, การกระทำ, เวลา, IP, ประเทศ, ชนิดเครื่อง และ User-Agent
      </p>

      <div style={{ marginBottom: 12 }}>
        <AuditFilters table={table} action={action} ip={ip} q={q} limit={limit} />
      </div>

      {sqlHint && (
        <div className="card" style={{ marginBottom: 12 }}>
          <div className="card-body" style={{ color: 'var(--taupe-dark)', fontSize: 13 }}>{sqlHint}</div>
        </div>
      )}
      {error && (
        <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: 12 }}>
          <div className="card-body" style={{ color: 'var(--danger)', fontSize: 13 }}>
            {error.message}
          </div>
        </div>
      )}

      {!error && (!rows || !rows.length) && (
        <p className="muted" style={{ fontSize: 13 }}>ไม่พบรายการตามเงื่อนไขที่เลือก</p>
      )}

      <div style={{ display: 'grid', gap: 8 }}>
        {(rows || []).map((r) => (
          <AuditRow key={r.id} row={r} performer={profileMap[r.performed_by]} />
        ))}
      </div>

      {rows?.length === limit && (
        <p className="muted" style={{ fontSize: 11, marginTop: 10 }}>
          แสดง {limit} รายการล่าสุด — เลือกจำนวนด้านบนหรือใช้ตัวกรองเพื่อดูเพิ่ม
        </p>
      )}
    </AppShell>
  );
}
