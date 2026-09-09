import { getRequestMeta } from './request-meta';

/** แปลง meta ให้เป็นพารามิเตอร์ของ RPC — ใช้ร่วมกันทั้ง stamp และ event */
function contextParams(m) {
  return {
    p_ip: m.ip,
    p_ua: m.userAgent,
    p_device: m.device,
    p_country: m.country,
    p_cf_ray: m.cfRay,
    p_referer: m.referer,
    p_lang: m.acceptLanguage,
    p_xff: m.forwardedFor,
    p_method: m.method,
    p_browser: m.browser,
    p_os: m.os,
    p_form: m.deviceForm,
    p_asn: m.asn,
    p_city: m.city,
  };
}

/** stamp บริบทคำขอก่อนเขียนข้อมูล — trigger audit_log จะอ่านต่อ */
export async function stampAuditContext(supabase, pathHint) {
  if (!supabase) return;
  try {
    const m = await getRequestMeta(pathHint);
    await supabase.rpc('set_audit_context', { ...contextParams(m), p_path: m.path });
  } catch {
    // ยังไม่รัน sql/add_audit_context.sql — ไม่บล็อกงานหลัก
  }
}

/** บันทึกเหตุการณ์ login / logout / deny / admin / export */
export async function logAuditEvent(supabase, {
  action,
  table = 'auth',
  details = {},
  outcome = 'success',
  pathHint = '',
  username = '',
} = {}) {
  if (!supabase || !action) return;
  try {
    const m = await getRequestMeta(pathHint);
    await supabase.rpc('write_audit_event', {
      ...contextParams(m),
      p_action: action,
      p_table: table,
      p_details: details,
      p_outcome: outcome,
      p_path: m.path || pathHint,
      p_username: username || null,
    });
  } catch {
    // ยังไม่รัน SQL หรือ RPC ล้ม — ไม่บล็อก login/งานหลัก
  }
}
