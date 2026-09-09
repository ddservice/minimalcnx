-- ================================================================
-- add_audit_forensics.sql — เก็บร่องรอยผู้ใช้ให้ละเอียดขึ้น เพื่อไล่ว่าใครแก้ข้อมูล
--
-- รันหลัง sql/add_audit_context.sql (idempotent รันซ้ำได้)
-- ถ้าไปรัน harden_security.sql หรือ add_audit_context.sql ซ้ำทีหลัง ต้องรันไฟล์นี้ตามอีกครั้ง
-- (สองไฟล์นั้นมี fn_audit_log / fn_audit_log_config รุ่นที่ยังไม่มีคอลัมน์ในไฟล์นี้)
--
-- ⚠️ เรื่องสำคัญที่สุดในไฟล์นี้ — ความน่าเชื่อถือของหลักฐาน:
--
--   IP / User-Agent / path / ประเทศ ถูก "แอปส่งมา" ผ่าน set_audit_context ซึ่ง
--   grant ให้ role authenticated เรียกได้ แปลว่าผู้ใช้ที่ล็อกอินแล้วเปิด devtools
--   เรียก RPC ตัวนี้เองด้วย anon key แล้วยัดค่าปลอมได้ ทุกการแก้ข้อมูลใน 10 นาที
--   ถัดมาจะถูกบันทึกด้วยค่าปลอมนั้น → ฟิลด์กลุ่มนี้เป็น "ค่าที่รายงานมา" ไม่ใช่หลักฐานแข็ง
--
--   session_id กับ actor_email ในไฟล์นี้ต่างออกไป: อ่านจาก auth.jwt() ในฝั่งฐานข้อมูล
--   ซึ่งเป็น claim ที่ Supabase เซ็นด้วย JWT secret ของโปรเจกต์ ไม่ได้ผ่านมือ client เลย
--   ปลอมไม่ได้เว้นแต่ JWT secret รั่ว → ใช้สองฟิลด์นี้เป็นหลักยึดเวลาสอบสวน
--   แล้วใช้ IP/UA เป็นข้อมูลประกอบ ไม่ใช่ข้อสรุป
--
--   วิธีจับการปลอม: ทุกแถวที่ session_id เดียวกันควรมี IP/เครื่องชุดเดียวกัน
--   ถ้า session เดียวแต่ IP เด้งไปมา = มีคนยัดค่าเอง (ดู view v_audit_session_anomaly ท้ายไฟล์)
-- ================================================================

-- ── 1. คอลัมน์ใหม่บน audit_log ─────────────────────────────────
-- กลุ่ม A — มาจาก JWT ปลอมไม่ได้
alter table public.audit_log add column if not exists session_id uuid;
alter table public.audit_log add column if not exists actor_email text;
-- กลุ่ม B — แอปรายงานมาจาก header (ดูคำเตือนด้านบน)
alter table public.audit_log add column if not exists cf_ray text;
alter table public.audit_log add column if not exists referer text;
alter table public.audit_log add column if not exists accept_language text;
alter table public.audit_log add column if not exists forwarded_for text;
alter table public.audit_log add column if not exists http_method text;
alter table public.audit_log add column if not exists browser text;
alter table public.audit_log add column if not exists os text;
alter table public.audit_log add column if not exists device_form text;
alter table public.audit_log add column if not exists asn text;
alter table public.audit_log add column if not exists city text;

comment on column public.audit_log.session_id is
  'session ของ Supabase Auth จาก claim ใน JWT — ปลอมไม่ได้ ใช้จับกลุ่มว่าการกระทำไหนอยู่ในการล็อกอินครั้งเดียวกัน';
comment on column public.audit_log.actor_email is
  'อีเมลผู้กระทำ ณ เวลานั้น จาก claim ใน JWT — เก็บสำเนาไว้เผื่อบัญชีถูกลบภายหลัง';
comment on column public.audit_log.cf_ray is
  'CF-Ray ของ Cloudflare — เอาไปเทียบกับ log ฝั่ง Cloudflare ได้ว่าคำขอเดียวกัน';
comment on column public.audit_log.forwarded_for is
  'X-Forwarded-For ทั้งสาย (ต่างจาก ip_address ที่เลือกมาตัวเดียว) — เห็นว่ามี proxy/VPN คั่นไหม';
comment on column public.audit_log.asn is
  'CF-IPASN — ต้องเปิด Managed Transform บน Cloudflare ก่อนถึงจะมีค่า ไม่เปิดก็เป็น null เฉยๆ';

create index if not exists idx_audit_session on public.audit_log (session_id, performed_at desc)
  where session_id is not null;
create index if not exists idx_audit_email on public.audit_log (actor_email, performed_at desc)
  where actor_email is not null;

-- ── 2. คอลัมน์ใหม่บนตารางบริบท ─────────────────────────────────
-- ไม่มี session_id / actor_email ตรงนี้โดยตั้งใจ — สองตัวนั้นอ่านจาก auth.jwt()
-- ตอน trigger ทำงาน ถ้าให้ client ส่งมาก็เท่ากับเปิดให้ปลอมได้เหมือนกับ IP
alter table public.audit_context add column if not exists cf_ray text;
alter table public.audit_context add column if not exists referer text;
alter table public.audit_context add column if not exists accept_language text;
alter table public.audit_context add column if not exists forwarded_for text;
alter table public.audit_context add column if not exists http_method text;
alter table public.audit_context add column if not exists browser text;
alter table public.audit_context add column if not exists os text;
alter table public.audit_context add column if not exists device_form text;
alter table public.audit_context add column if not exists asn text;
alter table public.audit_context add column if not exists city text;

-- ── 3. set_audit_context รุ่นใหม่ ───────────────────────────────
-- ต้อง drop ตัวเก่าก่อน เพราะการเพิ่มพารามิเตอร์ทำให้เป็นคนละ signature
-- create or replace จะกลายเป็นสร้าง overload ตัวที่สองแทนที่จะแทนที่ของเดิม
drop function if exists public.set_audit_context(text, text, text, text, text);

create or replace function public.set_audit_context(
  p_ip text,
  p_ua text,
  p_path text,
  p_device text default null,
  p_country text default null,
  p_cf_ray text default null,
  p_referer text default null,
  p_lang text default null,
  p_xff text default null,
  p_method text default null,
  p_browser text default null,
  p_os text default null,
  p_form text default null,
  p_asn text default null,
  p_city text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return;
  end if;
  insert into public.audit_context (
    user_id, ip_address, user_agent, request_path, device_summary, country,
    cf_ray, referer, accept_language, forwarded_for, http_method,
    browser, os, device_form, asn, city, updated_at
  ) values (
    auth.uid(),
    nullif(trim(p_ip), ''),
    nullif(left(trim(p_ua), 512), ''),
    nullif(left(trim(p_path), 200), ''),
    nullif(left(trim(coalesce(p_device, '')), 120), ''),
    nullif(left(trim(coalesce(p_country, '')), 8), ''),
    nullif(left(trim(coalesce(p_cf_ray, '')), 40), ''),
    nullif(left(trim(coalesce(p_referer, '')), 300), ''),
    nullif(left(trim(coalesce(p_lang, '')), 80), ''),
    nullif(left(trim(coalesce(p_xff, '')), 200), ''),
    nullif(left(trim(coalesce(p_method, '')), 10), ''),
    nullif(left(trim(coalesce(p_browser, '')), 60), ''),
    nullif(left(trim(coalesce(p_os, '')), 60), ''),
    nullif(left(trim(coalesce(p_form, '')), 30), ''),
    nullif(left(trim(coalesce(p_asn, '')), 30), ''),
    nullif(left(trim(coalesce(p_city, '')), 60), ''),
    now()
  )
  on conflict (user_id) do update set
    ip_address      = excluded.ip_address,
    user_agent      = excluded.user_agent,
    request_path    = excluded.request_path,
    device_summary  = excluded.device_summary,
    country         = excluded.country,
    cf_ray          = excluded.cf_ray,
    referer         = excluded.referer,
    accept_language = excluded.accept_language,
    forwarded_for   = excluded.forwarded_for,
    http_method     = excluded.http_method,
    browser         = excluded.browser,
    os              = excluded.os,
    device_form     = excluded.device_form,
    asn             = excluded.asn,
    city            = excluded.city,
    updated_at      = now();
end;
$$;

revoke all on function public.set_audit_context(
  text, text, text, text, text, text, text, text, text, text, text, text, text, text, text) from public;
grant execute on function public.set_audit_context(
  text, text, text, text, text, text, text, text, text, text, text, text, text, text, text) to authenticated;

-- ── 4. ตัวช่วยอ่าน claim จาก JWT (ปลอมไม่ได้) ───────────────────
create or replace function public.fn_jwt_session_id()
returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'session_id', '')::uuid;
$$;

create or replace function public.fn_jwt_email()
returns text language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'email', '');
$$;

-- ── 5. trigger ข้อมูล — เติมทุกฟิลด์ ────────────────────────────
create or replace function public.fn_audit_log()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  _uid uuid := auth.uid();
  _c public.audit_context;
  _uname text; _urole text;
  _sid uuid := public.fn_jwt_session_id();
  _mail text := public.fn_jwt_email();
begin
  select * into _c from public.audit_context c
   where c.user_id = _uid and c.updated_at > now() - interval '10 minutes';

  if _uid is not null then
    select username, role into _uname, _urole from public.profiles where id = _uid;
  end if;

  insert into public.audit_log(
    table_name, record_id, action, old_data, new_data, performed_by,
    ip_address, user_agent, device_summary, request_path, actor_username, actor_role,
    country, outcome, session_id, actor_email, cf_ray, referer, accept_language,
    forwarded_for, http_method, browser, os, device_form, asn, city
  ) values (
    tg_table_name,
    case when tg_op = 'DELETE' then old.id else new.id end,
    tg_op,
    case when tg_op = 'INSERT' then null else to_jsonb(old) end,
    case when tg_op = 'DELETE' then null else to_jsonb(new) end,
    _uid,
    _c.ip_address, _c.user_agent, _c.device_summary, _c.request_path, _uname, _urole,
    _c.country, 'success', _sid, _mail, _c.cf_ray, _c.referer, _c.accept_language,
    _c.forwarded_for, _c.http_method, _c.browser, _c.os, _c.device_form, _c.asn, _c.city
  );
  return coalesce(new, old);
end;
$$;

-- business_config มี primary key เป็น key (text) ไม่ใช่ id → record_id เก็บ null (ตัว key อยู่ใน JSON)
create or replace function public.fn_audit_log_config()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  _uid uuid := auth.uid();
  _c public.audit_context;
  _uname text; _urole text;
  _sid uuid := public.fn_jwt_session_id();
  _mail text := public.fn_jwt_email();
begin
  select * into _c from public.audit_context c
   where c.user_id = _uid and c.updated_at > now() - interval '10 minutes';

  if _uid is not null then
    select username, role into _uname, _urole from public.profiles where id = _uid;
  end if;

  insert into public.audit_log(
    table_name, record_id, action, old_data, new_data, performed_by,
    ip_address, user_agent, device_summary, request_path, actor_username, actor_role,
    country, outcome, session_id, actor_email, cf_ray, referer, accept_language,
    forwarded_for, http_method, browser, os, device_form, asn, city
  ) values (
    tg_table_name, null, tg_op,
    case when tg_op = 'INSERT' then null else to_jsonb(old) end,
    case when tg_op = 'DELETE' then null else to_jsonb(new) end,
    _uid,
    _c.ip_address, _c.user_agent, _c.device_summary, _c.request_path, _uname, _urole,
    _c.country, 'success', _sid, _mail, _c.cf_ray, _c.referer, _c.accept_language,
    _c.forwarded_for, _c.http_method, _c.browser, _c.os, _c.device_form, _c.asn, _c.city
  );
  return coalesce(new, old);
end;
$$;

-- ── 6. write_audit_event รุ่นใหม่ (login / logout / export / admin) ──
drop function if exists public.write_audit_event(
  text, text, jsonb, text, text, text, text, text, text, text);

create or replace function public.write_audit_event(
  p_action text,
  p_table text default 'auth',
  p_details jsonb default '{}'::jsonb,
  p_outcome text default 'success',
  p_ip text default null,
  p_ua text default null,
  p_path text default null,
  p_device text default null,
  p_username text default null,
  p_country text default null,
  p_cf_ray text default null,
  p_referer text default null,
  p_lang text default null,
  p_xff text default null,
  p_method text default null,
  p_browser text default null,
  p_os text default null,
  p_form text default null,
  p_asn text default null,
  p_city text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  _uid uuid := auth.uid();
  _uname text; _urole text;
  _action text := upper(trim(p_action));
begin
  if _action not in (
    'LOGIN', 'LOGIN_FAIL', 'LOGOUT', 'DENY', 'EXPORT', 'IMPORT',
    'CREATE_USER', 'UPDATE_USER', 'RESET_PASSWORD', 'TOGGLE_USER', 'DELETE_USER'
  ) then
    raise exception 'invalid audit action';
  end if;

  -- anon ได้แค่ LOGIN_FAIL (ยังไม่มี session)
  if _uid is null and _action <> 'LOGIN_FAIL' then
    raise exception 'not authenticated';
  end if;

  if _uid is not null then
    select username, role into _uname, _urole from public.profiles where id = _uid;
  end if;

  insert into public.audit_log (
    table_name, record_id, action, new_data, performed_by,
    ip_address, user_agent, device_summary, request_path,
    actor_username, actor_role, outcome, country,
    session_id, actor_email, cf_ray, referer, accept_language,
    forwarded_for, http_method, browser, os, device_form, asn, city
  ) values (
    coalesce(nullif(trim(p_table), ''), 'auth'), null, _action,
    coalesce(p_details, '{}'::jsonb), _uid,
    nullif(trim(coalesce(p_ip, '')), ''),
    nullif(left(trim(coalesce(p_ua, '')), 512), ''),
    nullif(left(trim(coalesce(p_device, '')), 120), ''),
    nullif(left(trim(coalesce(p_path, '')), 200), ''),
    coalesce(_uname, nullif(trim(coalesce(p_username, '')), '')),
    _urole,
    coalesce(nullif(trim(p_outcome), ''), 'success'),
    nullif(left(trim(coalesce(p_country, '')), 8), ''),
    public.fn_jwt_session_id(),
    public.fn_jwt_email(),
    nullif(left(trim(coalesce(p_cf_ray, '')), 40), ''),
    nullif(left(trim(coalesce(p_referer, '')), 300), ''),
    nullif(left(trim(coalesce(p_lang, '')), 80), ''),
    nullif(left(trim(coalesce(p_xff, '')), 200), ''),
    nullif(left(trim(coalesce(p_method, '')), 10), ''),
    nullif(left(trim(coalesce(p_browser, '')), 60), ''),
    nullif(left(trim(coalesce(p_os, '')), 60), ''),
    nullif(left(trim(coalesce(p_form, '')), 30), ''),
    nullif(left(trim(coalesce(p_asn, '')), 30), ''),
    nullif(left(trim(coalesce(p_city, '')), 60), '')
  );
end;
$$;

revoke all on function public.write_audit_event(
  text, text, jsonb, text, text, text, text, text, text, text,
  text, text, text, text, text, text, text, text, text, text) from public;
grant execute on function public.write_audit_event(
  text, text, jsonb, text, text, text, text, text, text, text,
  text, text, text, text, text, text, text, text, text, text) to authenticated, anon;

-- ── 7. view ช่วยจับการยัด IP ปลอม ───────────────────────────────
-- session เดียว (login ครั้งเดียว) ควรมาจาก IP/เครื่องชุดเดียว
-- ถ้าเห็นหลายค่าใน session เดียวกัน แปลว่ามีคนเรียก set_audit_context เองเพื่อกลบร่องรอย
create or replace view public.v_audit_session_anomaly as
select
  session_id,
  min(actor_username)             as actor_username,
  min(actor_email)                as actor_email,
  count(*)                        as events,
  count(distinct ip_address)      as distinct_ips,
  count(distinct user_agent)      as distinct_user_agents,
  min(performed_at)               as first_seen,
  max(performed_at)               as last_seen,
  array_agg(distinct ip_address)  as ips
from public.audit_log
where session_id is not null
group by session_id
having count(distinct ip_address) > 1
    or count(distinct user_agent) > 1;

comment on view public.v_audit_session_anomaly is
  'session ที่มี IP หรือ User-Agent มากกว่าหนึ่งค่า — สัญญาณว่ามีคนยัดบริบทปลอมผ่าน set_audit_context (หรืออย่างน้อยก็สลับเครือข่ายกลางคัน)';

-- view สืบทอด RLS ของ audit_log อยู่แล้ว (security_invoker) แต่ประกาศให้ชัด
alter view public.v_audit_session_anomaly set (security_invoker = on);
grant select on public.v_audit_session_anomaly to authenticated;

select 'add_audit_forensics applied ✓' as result;
