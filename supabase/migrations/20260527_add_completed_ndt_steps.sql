-- Persist partial NDT progress while the UI shows the grouped "NDT" step.
--
-- `current_process_step` continues to store the first open real process step
-- (Eddy Current, Penetrant Testing, or Magnetic Test). This column records
-- NDT inspections that were completed out of the normal process order so the
-- shop checklist can keep them checked on later updates.

alter table public.work_orders
  add column if not exists completed_ndt_steps text[] null;
