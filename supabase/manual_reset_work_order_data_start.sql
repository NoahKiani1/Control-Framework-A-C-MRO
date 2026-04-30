-- WARNING: INTENTIONAL CLEAN START ONLY.
--
-- This script permanently deletes operational work-order/import data so the
-- next AcMP import starts a fresh tracking period for Work Order Data.
-- Run it manually only when the team has decided to discard the current
-- operational work-order set before going live with the new reporting period.
--
-- This script intentionally does NOT delete profiles, auth users, engineers,
-- engineer absences, staff photos, storage files, restrictions, or any
-- staff-related data.

begin;

delete from public.work_order_events;
delete from public.closed_work_order_reports;
delete from public.yearly_report_exports;
delete from public.pending_acmp_work_orders;
delete from public.import_runs;
delete from public.work_orders;

commit;
