-- Work Order Data reporting.
-- This migration adds compact timing/reporting tables. It does not change
-- operational work-order behavior.

alter table public.work_orders
  add column if not exists data_tracking_enabled boolean not null default false,
  add column if not exists data_tracking_started_at timestamptz null,
  add column if not exists easa_selected_at timestamptz null,
  add column if not exists sequence_valid boolean null,
  add column if not exists sequence_issue text null;

create table if not exists public.work_order_events (
  id bigserial primary key,
  work_order_id text not null,
  event_type text not null,
  occurred_at timestamptz not null default now(),
  previous_step text null,
  completed_step text null,
  next_step text null,
  expected_step text null,
  is_in_sequence boolean not null default true,
  work_order_type text null,
  part_number text null,
  customer text null,
  included_process_steps text[] null
);

alter table public.work_order_events
  add column if not exists included_process_steps text[] null;

create index if not exists work_order_events_work_order_id_occurred_at_idx
  on public.work_order_events (work_order_id, occurred_at);

create index if not exists work_order_events_event_type_occurred_at_idx
  on public.work_order_events (event_type, occurred_at);

create index if not exists work_order_events_is_in_sequence_idx
  on public.work_order_events (is_in_sequence);

create table if not exists public.closed_work_order_reports (
  work_order_id text primary key,
  customer text null,
  part_number text null,
  work_order_type text null,
  activated_at timestamptz null,
  easa_selected_at timestamptz null,
  total_seconds_to_easa integer null,
  included_process_steps text[] null,
  step_durations_days jsonb not null default '{}'::jsonb,
  total_days_to_certification numeric null,
  sequence_valid boolean not null default true,
  sequence_issue text null,
  closed_year integer not null,
  created_at timestamptz not null default now()
);

alter table public.closed_work_order_reports
  add column if not exists included_process_steps text[] null,
  add column if not exists step_durations_days jsonb not null default '{}'::jsonb,
  add column if not exists total_days_to_certification numeric null;

create index if not exists closed_work_order_reports_closed_year_idx
  on public.closed_work_order_reports (closed_year);

create index if not exists closed_work_order_reports_sequence_valid_idx
  on public.closed_work_order_reports (sequence_valid);

create index if not exists closed_work_order_reports_work_order_type_idx
  on public.closed_work_order_reports (work_order_type);

create table if not exists public.yearly_report_exports (
  id bigserial primary key,
  report_year integer not null unique,
  exported_at timestamptz null,
  cleaned_at timestamptz null,
  exported_by uuid null
);

alter table public.work_order_events enable row level security;
alter table public.closed_work_order_reports enable row level security;
alter table public.yearly_report_exports enable row level security;

drop policy if exists "work_order_events_select_office" on public.work_order_events;
create policy "work_order_events_select_office"
on public.work_order_events
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

drop policy if exists "work_order_events_insert_office_shop" on public.work_order_events;
create policy "work_order_events_insert_office_shop"
on public.work_order_events
for insert
to authenticated
with check (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role in ('office', 'shop')
  )
);

drop policy if exists "work_order_events_delete_office" on public.work_order_events;
create policy "work_order_events_delete_office"
on public.work_order_events
for delete
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'office'
  )
);

drop policy if exists "closed_work_order_reports_select_office" on public.closed_work_order_reports;
create policy "closed_work_order_reports_select_office"
on public.closed_work_order_reports
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

drop policy if exists "closed_work_order_reports_insert_office" on public.closed_work_order_reports;
create policy "closed_work_order_reports_insert_office"
on public.closed_work_order_reports
for insert
to authenticated
with check (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'office'
  )
);

drop policy if exists "closed_work_order_reports_update_office" on public.closed_work_order_reports;
create policy "closed_work_order_reports_update_office"
on public.closed_work_order_reports
for update
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'office'
  )
)
with check (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'office'
  )
);

drop policy if exists "closed_work_order_reports_delete_office" on public.closed_work_order_reports;
create policy "closed_work_order_reports_delete_office"
on public.closed_work_order_reports
for delete
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'office'
  )
);

drop policy if exists "yearly_report_exports_select_office" on public.yearly_report_exports;
create policy "yearly_report_exports_select_office"
on public.yearly_report_exports
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

drop policy if exists "yearly_report_exports_insert_office" on public.yearly_report_exports;
create policy "yearly_report_exports_insert_office"
on public.yearly_report_exports
for insert
to authenticated
with check (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'office'
  )
);

drop policy if exists "yearly_report_exports_update_office" on public.yearly_report_exports;
create policy "yearly_report_exports_update_office"
on public.yearly_report_exports
for update
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'office'
  )
)
with check (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'office'
  )
);
