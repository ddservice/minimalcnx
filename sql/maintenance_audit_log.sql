-- ================================================================
-- maintenance_audit_log.sql — การบริหารจัดการอายุข้อมูล Audit Log
--
-- ป้องกันไม่ให้ตาราง public.audit_log มีขนาดใหญ่เกินไปในระยะยาว
-- ค่าเริ่มต้น: เก็บบันทึกย้อนหลัง 365 วัน (1 ปี) ตามมาตรฐาน PDPA และความปลอดภัย
--
-- รันได้เฉพาะ Super Admin (profiles.role = 'admin')
-- เรียกจากปุ่ม "ล้างบันทึกเก่า" ในหน้า /admin/audit (app/admin/audit/actions.js)
--
-- ต้องรันหลัง sql/add_audit_context.sql (ใช้คอลัมน์ actor_username / actor_role / outcome)
-- Idempotent รันซ้ำได้
-- ================================================================

create or replace function public.cleanup_old_audit_logs(p_days_to_keep int default 365)
returns int
language plpgsql
security definer
-- ตรึง search_path เสมอสำหรับ security definer — ไม่งั้นผู้เรียกตั้ง search_path ชี้ไป
-- schema ของตัวเองที่มี profiles ปลอม แล้วหลอกด่านตรวจสิทธิ์ข้างล่างได้
set search_path = public
as $$
declare
  _deleted_count int;
  _caller_role text;
  _uname text;
  _urole text;
begin
  -- ตรวจสอบสิทธิ์: ผู้เรียกต้องเป็น admin เท่านั้น
  select role into _caller_role
  from public.profiles
  where id = auth.uid();

  if _caller_role is distinct from 'admin' then
    raise exception 'Permission denied: Super Admin role required to purge audit logs';
  end if;

  if p_days_to_keep < 90 then
    raise exception 'Safety limit: Minimum retention period is 90 days';
  end if;

  delete from public.audit_log
  where performed_at < (now() - make_interval(days => p_days_to_keep));

  get diagnostics _deleted_count = row_count;

  -- บันทึกการล้างข้อมูลลงใน audit_log ด้วย — ตัวการล้างต้องทิ้งร่องรอยไว้เองเสมอ
  --
  -- ⚠️ เดิมตรงนี้เรียก write_audit_event('DELETE', ...) ซึ่งพังทั้งสองทาง:
  --    1. write_audit_event ไม่รับ action 'DELETE' (จะ raise 'invalid audit action')
  --    2. ลำดับพารามิเตอร์สลับ — ยัด jsonb ลงช่อง p_outcome ที่เป็น text
  --    รันเมื่อไหร่ก็ล้มทันที ไม่มีใครเจอเพราะไม่เคยมีใครเรียกฟังก์ชันนี้
  --    แก้เป็น insert ตรง เลิกผูกกับ signature ของ write_audit_event ที่เปลี่ยนได้
  select username, role into _uname, _urole from public.profiles where id = auth.uid();

  insert into public.audit_log (
    table_name, record_id, action, new_data, performed_by,
    actor_username, actor_role, outcome
  ) values (
    'audit_log', null, 'DELETE',
    jsonb_build_object('days_to_keep', p_days_to_keep, 'records_purged', _deleted_count),
    auth.uid(), _uname, _urole, 'success'
  );

  return _deleted_count;
end;
$$;

comment on function public.cleanup_old_audit_logs is 'ลบ Audit Logs ที่เก่ากว่าระยะเวลาที่กำหนด (ขั้นต่ำ 90 วัน ค่าเริ่มต้น 365 วัน) รันได้เฉพาะ Super Admin';

-- ไม่มีบรรทัดนี้ = PostgREST เรียกไม่ถึง แอปจะได้ PGRST202 "ไม่พบฟังก์ชัน"
-- ด่านจริงคือการเช็ค role ข้างในฟังก์ชัน ไม่ใช่ตัว grant
revoke all on function public.cleanup_old_audit_logs(int) from public;
grant execute on function public.cleanup_old_audit_logs(int) to authenticated;

select 'maintenance_audit_log applied ✓' as result;
