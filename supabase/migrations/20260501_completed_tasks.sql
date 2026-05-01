-- Completed task archive for corrective actions and additional tasks.
-- Rows are retained for 30 days so closed task details can be reviewed,
-- then removed to keep operational storage compact.

alter table public.work_orders
  add column if not exists action_created_at timestamptz null,
  add column if not exists action_closed_at timestamptz null;

update public.work_orders
set action_created_at = coalesce(last_manual_update, last_system_update, now())
where action_created_at is null
  and required_next_action is not null
  and trim(required_next_action) <> ''
  and coalesce(action_closed, false) = false
  and coalesce(action_status, '') <> 'Done';

create table if not exists public.completed_tasks (
  id bigserial primary key,
  source_key text not null unique,
  task_type text not null check (task_type in ('corrective_action', 'additional_task')),
  source_work_order_id text null,
  source_extra_action_id bigint null,
  required_next_action text not null,
  assigned_person_team text null,
  created_at timestamptz not null,
  closed_at timestamptz not null default now(),
  inserted_at timestamptz not null default now()
);

create index if not exists completed_tasks_closed_at_idx
  on public.completed_tasks (closed_at desc);

create index if not exists completed_tasks_task_type_closed_at_idx
  on public.completed_tasks (task_type, closed_at desc);

create or replace function public.cleanup_completed_tasks_retention()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.completed_tasks
  where closed_at < now() - interval '30 days';
$$;

revoke all on function public.cleanup_completed_tasks_retention() from public;
grant execute on function public.cleanup_completed_tasks_retention() to authenticated;

alter table public.completed_tasks enable row level security;

drop policy if exists "completed_tasks_select_office" on public.completed_tasks;
create policy "completed_tasks_select_office"
on public.completed_tasks
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

drop policy if exists "completed_tasks_insert_office_shop" on public.completed_tasks;
create policy "completed_tasks_insert_office_shop"
on public.completed_tasks
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

drop policy if exists "completed_tasks_update_office_shop" on public.completed_tasks;
create policy "completed_tasks_update_office_shop"
on public.completed_tasks
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

drop policy if exists "completed_tasks_delete_office" on public.completed_tasks;
create policy "completed_tasks_delete_office"
on public.completed_tasks
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

do $cleanup$
begin
  perform public.cleanup_completed_tasks_retention();
end
$cleanup$;

notify pgrst, 'reload schema';
