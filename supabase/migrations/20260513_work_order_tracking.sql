-- Replace the Work Order Data event log with compact one-row tracking state.
-- Active tracked work orders are migrated from public.work_order_events into
-- public.work_order_tracking, then the old event table is removed.

create table if not exists public.work_order_tracking (
  work_order_id text primary key,
  activated_at timestamptz null,
  work_order_type text null,
  part_number text null,
  customer text null,
  included_process_steps text[] null,
  completed_steps jsonb not null default '[]'::jsonb,
  block_periods jsonb not null default '[]'::jsonb,
  total_blocked_seconds integer not null default 0,
  current_block_started_at timestamptz null,
  current_block_step text null,
  current_block_reason text null,
  sequence_valid boolean not null default true,
  sequence_issue text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists work_order_tracking_sequence_valid_idx
  on public.work_order_tracking (sequence_valid);

create index if not exists work_order_tracking_current_block_idx
  on public.work_order_tracking (current_block_started_at)
  where current_block_started_at is not null;

with
tracked_orders as (
  select *
  from public.work_orders
  where data_tracking_enabled = true
),
activated_events as (
  select distinct on (event.work_order_id)
    event.work_order_id,
    event.occurred_at
  from public.work_order_events event
  where event.event_type = 'activated'
  order by event.work_order_id, event.occurred_at asc, event.id asc
),
first_event_steps as (
  select distinct on (event.work_order_id)
    event.work_order_id,
    event.included_process_steps
  from public.work_order_events event
  where event.included_process_steps is not null
    and array_length(event.included_process_steps, 1) > 0
  order by event.work_order_id, event.occurred_at asc, event.id asc
),
completed_steps as (
  select
    event.work_order_id,
    jsonb_agg(
      jsonb_strip_nulls(
        jsonb_build_object(
          'step', event.completed_step,
          'occurred_at', event.occurred_at,
          'previous_step', event.previous_step,
          'next_step', event.next_step,
          'expected_step', event.expected_step,
          'is_in_sequence', event.is_in_sequence
        )
      )
      order by event.occurred_at asc, event.id asc
    ) as completed_steps
  from public.work_order_events event
  where event.event_type = 'step_completed'
    and event.completed_step is not null
  group by event.work_order_id
),
block_starts as (
  select
    start_event.work_order_id,
    start_event.occurred_at as started_at,
    start_event.next_step as block_step,
    start_event.block_reason,
    (
      select end_event.occurred_at
      from public.work_order_events end_event
      where end_event.work_order_id = start_event.work_order_id
        and end_event.event_type = 'blocked_ended'
        and (end_event.occurred_at, end_event.id) >
          (start_event.occurred_at, start_event.id)
      order by end_event.occurred_at asc, end_event.id asc
      limit 1
    ) as ended_at
  from public.work_order_events start_event
  where start_event.event_type = 'blocked_started'
),
closed_blocks as (
  select
    work_order_id,
    started_at,
    ended_at,
    block_step,
    block_reason,
    greatest(0, extract(epoch from (ended_at - started_at))::integer) as seconds
  from block_starts
  where ended_at is not null
),
closed_block_periods as (
  select
    work_order_id,
    coalesce(sum(seconds), 0)::integer as total_blocked_seconds,
    jsonb_agg(
      jsonb_strip_nulls(
        jsonb_build_object(
          'started_at', started_at,
          'ended_at', ended_at,
          'step', block_step,
          'reason', block_reason,
          'seconds', seconds
        )
      )
      order by started_at asc
    ) as block_periods
  from closed_blocks
  group by work_order_id
),
latest_block_event as (
  select distinct on (event.work_order_id)
    event.work_order_id,
    event.event_type,
    event.occurred_at,
    event.next_step,
    event.block_reason
  from public.work_order_events event
  where event.event_type in ('blocked_started', 'blocked_ended')
  order by event.work_order_id, event.occurred_at desc, event.id desc
)
insert into public.work_order_tracking (
  work_order_id,
  activated_at,
  work_order_type,
  part_number,
  customer,
  included_process_steps,
  completed_steps,
  block_periods,
  total_blocked_seconds,
  current_block_started_at,
  current_block_step,
  current_block_reason,
  sequence_valid,
  sequence_issue,
  updated_at
)
select
  work_order.work_order_id,
  coalesce(work_order.data_tracking_started_at, activated_events.occurred_at),
  work_order.work_order_type,
  work_order.part_number,
  work_order.customer,
  coalesce(work_order.included_process_steps, first_event_steps.included_process_steps),
  coalesce(completed_steps.completed_steps, '[]'::jsonb),
  coalesce(closed_block_periods.block_periods, '[]'::jsonb),
  coalesce(closed_block_periods.total_blocked_seconds, 0),
  case
    when latest_block_event.event_type = 'blocked_started'
      then latest_block_event.occurred_at
    else null
  end,
  case
    when latest_block_event.event_type = 'blocked_started'
      then latest_block_event.next_step
    else null
  end,
  case
    when latest_block_event.event_type = 'blocked_started'
      then latest_block_event.block_reason
    else null
  end,
  coalesce(work_order.sequence_valid, true),
  work_order.sequence_issue,
  now()
from tracked_orders work_order
left join activated_events
  on activated_events.work_order_id = work_order.work_order_id
left join first_event_steps
  on first_event_steps.work_order_id = work_order.work_order_id
left join completed_steps
  on completed_steps.work_order_id = work_order.work_order_id
left join closed_block_periods
  on closed_block_periods.work_order_id = work_order.work_order_id
left join latest_block_event
  on latest_block_event.work_order_id = work_order.work_order_id
on conflict (work_order_id) do update
set
  activated_at = excluded.activated_at,
  work_order_type = excluded.work_order_type,
  part_number = excluded.part_number,
  customer = excluded.customer,
  included_process_steps = excluded.included_process_steps,
  completed_steps = excluded.completed_steps,
  block_periods = excluded.block_periods,
  total_blocked_seconds = excluded.total_blocked_seconds,
  current_block_started_at = excluded.current_block_started_at,
  current_block_step = excluded.current_block_step,
  current_block_reason = excluded.current_block_reason,
  sequence_valid = excluded.sequence_valid,
  sequence_issue = excluded.sequence_issue,
  updated_at = now();

alter table public.work_order_tracking enable row level security;

drop policy if exists "work_order_tracking_select_office_shop"
  on public.work_order_tracking;
create policy "work_order_tracking_select_office_shop"
on public.work_order_tracking
for select
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role in ('office', 'shop')
  )
);

drop policy if exists "work_order_tracking_insert_office_shop"
  on public.work_order_tracking;
create policy "work_order_tracking_insert_office_shop"
on public.work_order_tracking
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

drop policy if exists "work_order_tracking_update_office_shop"
  on public.work_order_tracking;
create policy "work_order_tracking_update_office_shop"
on public.work_order_tracking
for update
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role in ('office', 'shop')
  )
)
with check (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role in ('office', 'shop')
  )
);

drop policy if exists "work_order_tracking_delete_office"
  on public.work_order_tracking;
create policy "work_order_tracking_delete_office"
on public.work_order_tracking
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

drop table if exists public.work_order_events;

notify pgrst, 'reload schema';
-- noah was hier
