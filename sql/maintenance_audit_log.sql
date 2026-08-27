-- ================================================================
-- maintenance_audit_log.sql — การบริหารจัดการอายุข้อมูล Audit Log
--
-- ป้องกันไม่ให้ตาราง public.audit_log มีขนาดใหญ่เกินไปในระยะยาว
-- ค่าเริ่มต้น: เก็บบันทึกย้อนหลัง 365 วัน (1 ปี) ตามมาตรฐาน PDPA และความปลอดภัย
--
-- รันได้เฉพาะ Super Admin (profiles.role = 'admin')
-- ================================================================

create or replace function public.cleanup_old_audit_logs(p_days_to_keep int default 365)
returns int
language plpgsql
security definer
as $$
declare
  _deleted_count int;
  _caller_role text;
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

  -- บันทึกการล้างข้อมูลลงใน audit_log ด้วย
  perform public.write_audit_event(
    'DELETE',
    'audit_log',
    null,
    jsonb_build_object('days_to_keep', p_days_to_keep, 'records_purged', _deleted_count),
    'success'
  );

  return _deleted_count;
end;
$$;

comment on function public.cleanup_old_audit_logs is 'ลบ Audit Logs ที่เก่ากว่าระยะเวลาที่กำหนด (ขั้นต่ำ 90 วัน ค่าเริ่มต้น 365 วัน) รันได้เฉพาะ Super Admin';
