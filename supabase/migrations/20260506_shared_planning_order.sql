n-- Shared Planning order.
--
-- Office can manually reorder open work orders. New, reopened, or
-- hierarchy-relevant updates get a fresh automatic insertion point while the
-- rest of the current planning order stays intact.

alter table public.work_orders
  add column if not exists shared_planning_rank numeric null,
  add column if not exists shared_planning_manually_ranked_at timestamptz null;

create index if not exists work_orders_shared_planning_rank_idx
  on public.work_orders (shared_planning_rank);

create or replace function public.work_order_shared_planning_is_blocked(
  hold_reason text,
  rfq_state text
)
returns boolean
language sql
immutable
as $$
  select coalesce(nullif(btrim(hold_reason), ''), '') <> ''
    or lower(btrim(regexp_replace(coalesce(rfq_state, ''), '[[:space:]]+', ' ', 'g'))) in (
      'rfq send',
      'rfq rejected'
    );
$$;

create or replace function public.work_order_shared_planning_is_open(
  is_open boolean,
  is_active boolean,
  hold_reason text,
  rfq_state text,
  current_process_step text
)
returns boolean
language sql
immutable
as $$
  select coalesce(is_open, false) = true
    and coalesce(is_active, false) = true
    and not public.work_order_shared_planning_is_blocked(hold_reason, rfq_state)
    and coalesce(current_process_step, '') <> 'Ready to close';
$$;

create or replace function public.work_order_shared_planning_bucket(
  priority text,
  has_due_date boolean
)
returns integer
language sql
immutable
as $$
  select case
    when lower(btrim(coalesce(priority, ''))) = 'aog' then 0
    when lower(btrim(coalesce(priority, ''))) in ('yes', 'prio', 'priority') then 1
    when has_due_date then 2
    else 3
  end;
$$;

with eligible as (
  select
    work_order_id,
    row_number() over (
      order by
        public.work_order_shared_planning_bucket(priority, due_date is not null),
        due_date asc nulls last,
        work_order_id asc
    ) as row_number
  from public.work_orders
  where public.work_order_shared_planning_is_open(
    is_open,
    is_active,
    hold_reason,
    rfq_state,
    current_process_step
  )
)
update public.work_orders work_order
set shared_planning_rank = eligible.row_number * 1000
from eligible
where work_order.work_order_id = eligible.work_order_id
  and work_order.shared_planning_rank is null;

create or replace function public.assign_work_order_shared_planning_rank()
returns trigger
language plpgsql
as $$
declare
  new_bucket integer;
  next_rank numeric;
  previous_rank numeric;
begin
  if not public.work_order_shared_planning_is_open(
    new.is_open,
    new.is_active,
    new.hold_reason,
    new.rfq_state,
    new.current_process_step
  ) then
    return new;
  end if;

  new_bucket := public.work_order_shared_planning_bucket(
    new.priority,
    new.due_date is not null
  );

  select work_order.shared_planning_rank
  into next_rank
  from public.work_orders work_order
  where work_order.work_order_id <> new.work_order_id
    and public.work_order_shared_planning_is_open(
      work_order.is_open,
      work_order.is_active,
      work_order.hold_reason,
      work_order.rfq_state,
      work_order.current_process_step
    )
    and (
      new_bucket < public.work_order_shared_planning_bucket(
        work_order.priority,
        work_order.due_date is not null
      )
      or (
        new_bucket = 2
        and public.work_order_shared_planning_bucket(
          work_order.priority,
          work_order.due_date is not null
        ) = 2
        and new.due_date is not null
        and work_order.due_date is not null
        and new.due_date < work_order.due_date
      )
    )
  order by
    work_order.shared_planning_rank asc nulls last,
    public.work_order_shared_planning_bucket(
      work_order.priority,
      work_order.due_date is not null
    ),
    work_order.due_date asc nulls last,
    work_order.work_order_id asc
  limit 1;

  if next_rank is null then
    select max(work_order.shared_planning_rank)
    into previous_rank
    from public.work_orders work_order
    where work_order.work_order_id <> new.work_order_id
      and public.work_order_shared_planning_is_open(
        work_order.is_open,
        work_order.is_active,
        work_order.hold_reason,
        work_order.rfq_state,
        work_order.current_process_step
      );
  else
    select max(work_order.shared_planning_rank)
    into previous_rank
    from public.work_orders work_order
    where work_order.work_order_id <> new.work_order_id
      and public.work_order_shared_planning_is_open(
        work_order.is_open,
        work_order.is_active,
        work_order.hold_reason,
        work_order.rfq_state,
        work_order.current_process_step
      )
      and work_order.shared_planning_rank < next_rank;
  end if;

  if previous_rank is null and next_rank is null then
    new.shared_planning_rank := 1000;
  elsif previous_rank is null then
    new.shared_planning_rank := next_rank / 2;
  elsif next_rank is null then
    new.shared_planning_rank := previous_rank + 1000;
  else
    new.shared_planning_rank := (previous_rank + next_rank) / 2;
  end if;

  new.shared_planning_manually_ranked_at := null;
  return new;
end;
$$;

drop trigger if exists work_orders_shared_planning_rank_biu
  on public.work_orders;

create trigger work_orders_shared_planning_rank_biu
before insert or update of
  is_open,
  is_active,
  priority,
  due_date,
  hold_reason,
  rfq_state,
  current_process_step
on public.work_orders
for each row
execute function public.assign_work_order_shared_planning_rank();

create or replace function public.set_shared_planning_order(
  work_order_ids text[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  with input_rows as (
    select
      nullif(btrim(id), '') as work_order_id,
      ordinal
    from unnest(work_order_ids) with ordinality as input(id, ordinal)
  ),
  deduped as (
    select
      work_order_id,
      min(ordinal) as first_position
    from input_rows
    where work_order_id is not null
    group by work_order_id
  ),
  eligible as (
    select
      deduped.work_order_id,
      row_number() over (order by deduped.first_position) as row_number
    from deduped
    join public.work_orders work_order
      on work_order.work_order_id = deduped.work_order_id
    where public.work_order_shared_planning_is_open(
      work_order.is_open,
      work_order.is_active,
      work_order.hold_reason,
      work_order.rfq_state,
      work_order.current_process_step
    )
  )
  update public.work_orders work_order
  set
    shared_planning_rank = eligible.row_number * 1000,
    shared_planning_manually_ranked_at = now()
  from eligible
  where work_order.work_order_id = eligible.work_order_id;
end;
$$;

revoke all on function public.set_shared_planning_order(text[]) from public;
revoke all on function public.set_shared_planning_order(text[]) from anon;
revoke all on function public.set_shared_planning_order(text[]) from authenticated;
grant execute on function public.set_shared_planning_order(text[]) to service_role;
-- noah was hier
