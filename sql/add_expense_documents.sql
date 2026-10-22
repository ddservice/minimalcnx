-- Run after add_documents.sql. Private attachments, same admin/co-admin boundary.
begin;
alter table public.documents add column if not exists expense_id uuid references public.expenses(id) on delete restrict;
create index if not exists idx_documents_expense on public.documents(expense_id) where expense_id is not null;
commit;
