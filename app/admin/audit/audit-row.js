import { fmtMoney } from '../../../lib/format';
import DataTable from '../../../components/data-table';

const ACTION_LABEL = {
  INSERT: 'เพิ่ม',
  UPDATE: 'แก้ไข',
  DELETE: 'ลบ',
  LOGIN: 'ล็อกอิน',
  LOGIN_FAIL: 'ล็อกอินไม่สำเร็จ',
  LOGOUT: 'ออกจากระบบ',
  DENY: 'ถูกปฏิเสธสิทธิ์',
  EXPORT: 'ส่งออกไฟล์',
  IMPORT: 'นำเข้าไฟล์',
  CREATE_USER: 'สร้างผู้ใช้',
  UPDATE_USER: 'แก้ผู้ใช้',
  RESET_PASSWORD: 'รีเซ็ตรหัส',
  TOGGLE_USER: 'เปิด/ปิดบัญชี',
  DELETE_USER: 'ลบผู้ใช้',
};
const ACTION_COLOR = {
  INSERT: 'var(--success)',
  UPDATE: 'var(--taupe-dark)',
  DELETE: 'var(--danger)',
  LOGIN: 'var(--success)',
  LOGIN_FAIL: 'var(--danger)',
  LOGOUT: 'var(--muted)',
  DENY: 'var(--danger)',
  EXPORT: 'var(--info)',
  IMPORT: 'var(--info)',
  CREATE_USER: 'var(--success)',
  UPDATE_USER: 'var(--taupe-dark)',
  RESET_PASSWORD: 'var(--taupe-dark)',
  TOGGLE_USER: 'var(--taupe-dark)',
  DELETE_USER: 'var(--danger)',
};
const TABLE_LABEL = {
  sales_daily: 'ยอดขาย',
  expenses: 'รายจ่าย',
  business_config: 'ตั้งค่าระบบ',
  profiles: 'บัญชีผู้ใช้',
  auth: 'การเข้าสู่ระบบ',
  access: 'สิทธิ์',
  admin: 'จัดการผู้ใช้',
  reports: 'รายงาน',
  customers: 'ลูกค้าสะสมแต้ม',
  point_transactions: 'ธุรกรรมแต้ม',
  redemption_history: 'แลกรางวัล',
};
const HIDE_FIELDS = new Set(['id', 'created_at', 'updated_at', 'key', 'password', 'hashed_password']);

function fmtVal(field, v) {
  if (v == null || v === '') return '—';
  if (typeof v === 'number' && /amount|cost|revenue|total|price/i.test(field)) return fmtMoney(v);
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function diffRows(oldData, newData) {
  const keys = new Set([...Object.keys(oldData || {}), ...Object.keys(newData || {})]);
  const out = [];
  keys.forEach((k) => {
    if (HIDE_FIELDS.has(k)) return;
    const ov = oldData ? oldData[k] : undefined;
    const nv = newData ? newData[k] : undefined;
    if (JSON.stringify(ov) !== JSON.stringify(nv)) out.push({ field: k, old: ov, new: nv });
  });
  return out;
}

const DATA_ACTIONS = new Set(['INSERT', 'UPDATE', 'DELETE']);

export default function AuditRow({ row, performer }) {
  const label = ACTION_LABEL[row.action] || row.action;
  const color = ACTION_COLOR[row.action] || 'var(--muted)';
  const when = new Date(row.performed_at).toLocaleString('th-TH', {
    dateStyle: 'medium',
    timeStyle: 'medium',
    timeZone: 'Asia/Bangkok',
  });
  const who = row.actor_username
    || performer?.username
    || performer?.full_name
    || 'ไม่ทราบผู้ใช้';
  const whoRole = row.actor_role || performer?.role;
  const configKey = row.table_name === 'business_config' ? (row.new_data?.key || row.old_data?.key) : null;
  const failed = row.outcome === 'failure';

  const changes = DATA_ACTIONS.has(row.action)
    ? row.action === 'UPDATE'
      ? diffRows(row.old_data, row.new_data)
      : row.action === 'INSERT'
        ? diffRows(null, row.new_data)
        : diffRows(row.old_data, null)
    : [];

  const eventDetails = !DATA_ACTIONS.has(row.action) && row.new_data && typeof row.new_data === 'object'
    ? row.new_data
    : null;

  return (
    <details style={rowBox}>
      <summary style={summaryStyle}>
        <span style={{ ...badge, background: failed ? 'var(--danger)' : color }}>{label}</span>
        <span style={{ fontWeight: 600 }}>
          {TABLE_LABEL[row.table_name] || row.table_name}
          {configKey ? ` — ${configKey}` : ''}
        </span>
        <span className="muted" style={{ fontSize: 'var(--fs-sm)' }}>{when}</span>
        <span style={{ fontSize: 'var(--fs-sm)', marginLeft: 'auto', textAlign: 'right' }}>
          <strong>{who}</strong>
          {whoRole ? <span className="muted"> ({whoRole})</span> : null}
          {row.actor_email ? <div className="muted" style={{ fontSize: 'var(--fs-xs)' }}>{row.actor_email}</div> : null}
          {row.ip_address ? (
            <div className="muted" style={{ fontSize: 'var(--fs-xs)' }}>
              IP {row.ip_address}
              {row.country ? ` · ${row.country}` : ''}
              {row.city ? ` · ${row.city}` : ''}
            </div>
          ) : null}
          {row.device_summary ? <div className="muted" style={{ fontSize: 'var(--fs-xs)' }}>{row.device_summary}</div> : null}
          {/* session ย่อ 8 ตัวพอให้ไล่จับกลุ่มด้วยตาว่าแถวไหนอยู่ในการล็อกอินเดียวกัน */}
          {row.session_id ? <div className="muted" style={{ fontSize: 'var(--fs-xs)' }}>session {String(row.session_id).slice(0, 8)}</div> : null}
        </span>
      </summary>
      <div style={{ marginTop: 10, borderTop: '1px solid var(--border)', paddingTop: 10, fontSize: 'var(--fs-sm)' }}>
        <div style={{ display: 'grid', gap: 4, marginBottom: 10, color: 'var(--muted)' }}>
          {row.request_path ? <div>หน้า: <code>{row.request_path}</code>{row.http_method ? ` (${row.http_method})` : ''}</div> : null}
          {row.session_id ? <div>session: <code>{row.session_id}</code> <span style={{ color: 'var(--success)' }}>· จาก JWT ปลอมไม่ได้</span></div> : null}
          {row.actor_email ? <div>อีเมล: {row.actor_email} <span style={{ color: 'var(--success)' }}>· จาก JWT</span></div> : null}
          {row.browser || row.os ? <div>เบราว์เซอร์/OS: {[row.browser, row.os, row.device_form].filter(Boolean).join(' · ')}</div> : null}
          {row.forwarded_for && row.forwarded_for !== row.ip_address
            ? <div style={{ wordBreak: 'break-all' }}>สาย proxy (X-Forwarded-For): {row.forwarded_for}</div> : null}
          {row.asn ? <div>เครือข่าย (ASN): {row.asn}</div> : null}
          {row.cf_ray ? <div>CF-Ray: <code>{row.cf_ray}</code> · เอาไปเทียบ log ฝั่ง Cloudflare ได้</div> : null}
          {row.referer ? <div style={{ wordBreak: 'break-all' }}>มาจากหน้า: {row.referer}</div> : null}
          {row.accept_language ? <div>ภาษาเบราว์เซอร์: {row.accept_language}</div> : null}
          {row.user_agent ? <div style={{ wordBreak: 'break-all' }}>User-Agent: {row.user_agent}</div> : null}
          {row.record_id ? <div>รหัสรายการ: {row.record_id}</div> : null}
          {failed ? <div style={{ color: 'var(--danger)' }}>ผลลัพธ์: ไม่สำเร็จ</div> : null}
        </div>
        {eventDetails ? (
          <pre style={{ margin: 0, background: 'var(--surface-2)', padding: 10, borderRadius: 'var(--radius-sm)', overflowX: 'auto' }}>
            {JSON.stringify(eventDetails, null, 2)}
          </pre>
        ) : changes.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>ไม่มีรายละเอียดเพิ่มเติม</p>
        ) : (
          // DataTable แปลงเป็นการ์ดเองบนจอ <720px — ของเดิมเป็น <table> ดิบที่ล้นขอบจอมือถือ
          <DataTable
            columns={[
              { key: 'field', label: 'ฟิลด์', render: (c) => <strong>{c.field}</strong> },
              {
                key: 'old',
                label: 'ค่าเดิม',
                render: (c) => (
                  <span style={{ color: row.action !== 'INSERT' ? 'var(--danger)' : 'var(--muted)' }}>
                    {row.action === 'INSERT' ? '—' : fmtVal(c.field, c.old)}
                  </span>
                ),
              },
              {
                key: 'new',
                label: 'ค่าใหม่',
                render: (c) => (
                  <span style={{ color: row.action !== 'DELETE' ? 'var(--success)' : 'var(--muted)' }}>
                    {row.action === 'DELETE' ? '—' : fmtVal(c.field, c.new)}
                  </span>
                ),
              },
            ]}
            rows={changes}
            rowKey={(c) => c.field}
          />
        )}
      </div>
    </details>
  );
}

const rowBox = { border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '10px 12px', background: 'var(--surface)' };
const summaryStyle = { display: 'flex', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap', cursor: 'pointer', listStyle: 'none' };
const badge = { color: '#fff', padding: '3px 11px', borderRadius: 'var(--radius-full)', fontSize: 'var(--fs-xs)', fontWeight: 700, flexShrink: 0 };
