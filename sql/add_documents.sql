-- ================================================================
-- add_documents.sql — คลังเอกสารของร้าน (หน้า /admin/documents)
-- สัญญาเช่า / สำเนาบัตร / เอกสารพนักงาน / ใบเสร็จยื่นราชการ / ใบอนุญาต
-- รันใน Supabase SQL Editor — Idempotent รันซ้ำได้
-- ต้องรันหลัง harden_security.sql (ใช้ fn_my_role) และ add_audit_forensics.sql (fn_audit_log รุ่นล่าสุด)
--
-- ⚠️ ไฟล์ในนี้มีสำเนาบัตรประชาชน = ข้อมูลส่วนบุคคลตาม PDPA
--    bucket ต้องเป็น private เสมอ (ต่างจาก bucket 'evidence' ที่เปิด public)
--    เปิดดูได้ผ่าน signed URL อายุสั้นที่ Server Action ออกให้เท่านั้น
--    เห็น/เพิ่ม/ลบได้เฉพาะ admin + co-admin ทั้งระดับตารางและระดับไฟล์
-- ================================================================

-- ── 1. ตาราง metadata ───────────────────────────────────────────
create table if not exists public.documents (
  id            uuid        primary key default gen_random_uuid(),
  category      text        not null check (category in ('landlord', 'filing', 'employee', 'shop', 'other')),
  title         text        not null,
  owner_label   text,                    -- เอกสารของใคร/เรื่องอะไร เช่น ชื่อพนักงาน, "ภ.ง.ด.3 ก.ย. 69"
  doc_date      date,                    -- วันที่บนเอกสาร
  expires_at    date,                    -- วันหมดอายุ (สัญญาเช่า / ใบอนุญาต) — null = ไม่มีวันหมด
  note          text,
  storage_path  text        not null unique,   -- path ใน bucket 'documents'
  file_name     text,
  mime_type     text,
  size_bytes    integer,
  uploaded_by   uuid        references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now()
);

create index if not exists idx_documents_category on public.documents (category, created_at desc);
create index if not exists idx_documents_expires  on public.documents (expires_at) where expires_at is not null;

alter table public.documents enable row level security;

drop policy if exists "documents: read admin+co-admin"   on public.documents;
drop policy if exists "documents: insert admin+co-admin" on public.documents;
drop policy if exists "documents: update admin+co-admin" on public.documents;
drop policy if exists "documents: delete admin+co-admin" on public.documents;

create policy "documents: read admin+co-admin"
  on public.documents for select to authenticated
  using (public.fn_my_role() in ('admin', 'co-admin'));

create policy "documents: insert admin+co-admin"
  on public.documents for insert to authenticated
  with check (public.fn_my_role() in ('admin', 'co-admin'));

create policy "documents: update admin+co-admin"
  on public.documents for update to authenticated
  using (public.fn_my_role() in ('admin', 'co-admin'))
  with check (public.fn_my_role() in ('admin', 'co-admin'));

create policy "documents: delete admin+co-admin"
  on public.documents for delete to authenticated
  using (public.fn_my_role() in ('admin', 'co-admin'));

-- ── 2. Storage bucket แบบ private ───────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'documents', 'documents', false, 10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf']
)
on conflict (id) do update
  set public             = false,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "documents: storage read admin+co-admin"   on storage.objects;
drop policy if exists "documents: storage insert admin+co-admin" on storage.objects;
drop policy if exists "documents: storage delete admin+co-admin" on storage.objects;

create policy "documents: storage read admin+co-admin"
  on storage.objects for select to authenticated
  using (bucket_id = 'documents' and public.fn_my_role() in ('admin', 'co-admin'));

create policy "documents: storage insert admin+co-admin"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'documents' and public.fn_my_role() in ('admin', 'co-admin'));

create policy "documents: storage delete admin+co-admin"
  on storage.objects for delete to authenticated
  using (bucket_id = 'documents' and public.fn_my_role() in ('admin', 'co-admin'));

-- ── 3. Audit — ใครเพิ่ม/ลบเอกสารเมื่อไหร่ (การ "เปิดดู" บันทึกจาก Server Action เป็น EXPORT) ──
drop trigger if exists tr_audit_documents on public.documents;
create trigger tr_audit_documents
  after insert or update or delete on public.documents
  for each row execute function public.fn_audit_log();

select 'add_documents applied ✓ — table documents + private bucket documents (admin/co-admin only) + audit trigger' as result;
