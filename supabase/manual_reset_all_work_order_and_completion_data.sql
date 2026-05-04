-- WARNING: INTENTIONAL CLEAN START — ALL work-order and completion data.
--
-- This script permanently deletes every operational work-order row AND the
-- corrective-action / additional-task data (both the live `extra_actions`
-- queue and the closed-task archive in `completed_tasks`), so the next AcMP
-- import starts a fully fresh tracking period.
--
-- This script intentionally does NOT touch any staff data:
--   - profiles
--   - auth users
--   - engineers
--   - engineer_absences
--   - staff photos / storage files
--   - restrictions
--
-- Run manually only when the team has decided to discard the current
-- operational set before going live with a new reporting period.

begin;

-- Completion / task archive
delete from public.completed_tasks;
delete from public.extra_actions;

-- Work-order reporting + events
delete from public.work_order_events;
delete from public.closed_work_order_reports;
delete from public.yearly_report_exports;

-- Pending AcMP review queue + import history
delete from public.pending_acmp_work_orders;
delete from public.import_runs;

-- Operational work orders (deleted last because other tables reference these IDs)
delete from public.work_orders;

commit;
