begin;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('sales-close-evidence', 'sales-close-evidence', false, 5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do update set public = false,
  file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.fn_access_sales_close_evidence(p_path text, p_upload boolean)
returns boolean language sql stable security invoker set search_path = pg_catalog, public as $$
  select p_path ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}/[0-9a-f-]{36}[.](jpg|png|webp|pdf)$'
    and public.fn_page_cap('/sales', case when p_upload then 'create' else 'view' end)
    and exists (
      select 1 from public.sales_daily s
      where to_char(s.date, 'YYYY-MM-DD') = split_part(p_path, '/', 1)
        and (not p_upload or public.fn_page_cap('/sales', 'edit')
          or (s.recorded_by = auth.uid()
            and s.date = (statement_timestamp() at time zone 'Asia/Bangkok')::date))
    );
$$;
revoke all on function public.fn_access_sales_close_evidence(text, boolean) from public, anon;
grant execute on function public.fn_access_sales_close_evidence(text, boolean) to authenticated;

drop policy if exists "sales close evidence: read" on storage.objects;
create policy "sales close evidence: read" on storage.objects for select to authenticated
using (bucket_id = 'sales-close-evidence' and public.fn_access_sales_close_evidence(name, false));

drop policy if exists "sales close evidence: upload" on storage.objects;
create policy "sales close evidence: upload" on storage.objects for insert to authenticated
with check (bucket_id = 'sales-close-evidence' and public.fn_access_sales_close_evidence(name, true));
commit;
