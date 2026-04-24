-- Pending AcMP review queue.
--
-- New AcMP work orders detected during a manual import are staged here so
-- Office can review and configure them on /acmp-review before they enter
-- `work_orders`. The global Office-only gate blocks the rest of the Office
-- app while rows with `status = 'pending'` exist.
--
-- `work_order_id` is the natural key: re-importing the same Excel file must
-- not create duplicate pending rows for the same work order.

create table if not exists public.pending_acmp_work_orders (
  id uuid primary key default gen_random_uuid(),
  work_order_id text not null unique,
  customer text null,
  rfq_state text null,
  last_system_update timestamptz null,
  is_open boolean not null default true,
  work_order_type text null,
  part_number text null,
  source_filename text null,
  raw_payload jsonb null,
  detected_at timestamptz not null default now(),
  processed_at timestamptz null,
  status text not null default 'pending'
);

create index if not exists pending_acmp_work_orders_status_idx
  on public.pending_acmp_work_orders (status);

alter table public.pending_acmp_work_orders enable row level security;

drop policy if exists "pending_acmp_work_orders_select_all"
  on public.pending_acmp_work_orders;
create policy "pending_acmp_work_orders_select_all"
on public.pending_acmp_work_orders
for select
to anon, authenticated
using (true);

drop policy if exists "pending_acmp_work_orders_insert_all"
  on public.pending_acmp_work_orders;
create policy "pending_acmp_work_orders_insert_all"
on public.pending_acmp_work_orders
for insert
to anon, authenticated
with check (true);

drop policy if exists "pending_acmp_work_orders_update_all"
  on public.pending_acmp_work_orders;
create policy "pending_acmp_work_orders_update_all"
on public.pending_acmp_work_orders
for update
to anon, authenticated
using (true)
with check (true);

drop policy if exists "pending_acmp_work_orders_delete_all"
  on public.pending_acmp_work_orders;
create policy "pending_acmp_work_orders_delete_all"
on public.pending_acmp_work_orders
for delete
to anon, authenticated
using (true);
