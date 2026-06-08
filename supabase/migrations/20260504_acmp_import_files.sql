create table if not exists public.acmp_import_files (
  id bigserial primary key,
  source_type text not null check (source_type in ('manual', 'dropbox')),
  original_filename text not null,
  rows_signature text not null,
  file_sha256 text null,
  dropbox_path_lower text null,
  dropbox_rev text null,
  dropbox_content_hash text null,
  export_date date null,
  export_sequence integer not null default 0,
  server_modified timestamptz null,
  status text not null check (status in ('processing', 'processed', 'failed', 'ignored')),
  ignore_reason text null,
  rows_processed integer null,
  rows_updated integer null,
  pending_new_work_orders integer null,
  pending_rfq_approved_inactive integer null,
  closed_removed integer null,
  skipped integer null,
  error_message text null,
  started_at timestamptz null,
  finished_at timestamptz null,
  created_at timestamptz not null default now()
);

create unique index if not exists acmp_import_files_processed_rows_signature_uidx
  on public.acmp_import_files (rows_signature)
  where status = 'processed';

create unique index if not exists acmp_import_files_processing_rows_signature_uidx
  on public.acmp_import_files (rows_signature)
  where status = 'processing';

create index if not exists acmp_import_files_created_at_idx
  on public.acmp_import_files (created_at desc);

create index if not exists acmp_import_files_status_idx
  on public.acmp_import_files (status);

create index if not exists acmp_import_files_source_type_idx
  on public.acmp_import_files (source_type);

create index if not exists acmp_import_files_dropbox_path_rev_idx
  on public.acmp_import_files (dropbox_path_lower, dropbox_rev);

create index if not exists acmp_import_files_rows_signature_idx
  on public.acmp_import_files (rows_signature);

create or replace function public.cleanup_acmp_import_files()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.acmp_import_files
  where status in ('processed', 'ignored')
    and created_at < now() - interval '30 days';
$$;

revoke all on function public.cleanup_acmp_import_files() from public;
grant execute on function public.cleanup_acmp_import_files() to service_role;

alter table public.acmp_import_files enable row level security;

drop policy if exists "acmp_import_files_select_office" on public.acmp_import_files;
create policy "acmp_import_files_select_office"
on public.acmp_import_files
for select
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'office'
  )
);

notify pgrst, 'reload schema';
-- noah was hier
