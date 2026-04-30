-- Ensure Work Order Data tables include the process-step snapshot columns even
-- when the original 20260430 migration was applied before those columns existed.

alter table public.work_order_events
  add column if not exists included_process_steps text[] null;

alter table public.closed_work_order_reports
  add column if not exists included_process_steps text[] null,
  add column if not exists step_durations_days jsonb not null default '{}'::jsonb,
  add column if not exists total_days_to_certification numeric null;

notify pgrst, 'reload schema';
