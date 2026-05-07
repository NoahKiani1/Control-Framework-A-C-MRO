-- Temporarily inactive work orders for absent manual assignees.
--
-- When Office manually assigns a work order to a shop engineer who is absent
-- today, the work order is kept assigned but moved out of the active shop flow.
-- These metadata fields identify that temporary inactive state so the app can
-- reactivate the order automatically once the engineer is present again.

alter table public.work_orders
  add column if not exists inactive_note text null,
  add column if not exists inactive_absent_engineer_id bigint null,
  add column if not exists inactive_absent_engineer_name text null,
  add column if not exists inactive_absence_date date null;

create index if not exists work_orders_inactive_absent_engineer_idx
  on public.work_orders (inactive_absent_engineer_id)
  where inactive_absent_engineer_id is not null;

