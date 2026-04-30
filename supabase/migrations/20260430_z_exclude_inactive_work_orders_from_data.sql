-- Work Order Data only includes orders that stay active from the moment they
-- enter the tracked flow. Existing inactive orders are excluded immediately.

update public.work_orders
set
  data_tracking_enabled = false,
  data_tracking_started_at = null,
  easa_selected_at = null,
  sequence_valid = null,
  sequence_issue = null
where is_active = false;

delete from public.work_order_events event
using public.work_orders work_order
where event.work_order_id = work_order.work_order_id
  and work_order.is_active = false;

delete from public.closed_work_order_reports report
using public.work_orders work_order
where report.work_order_id = work_order.work_order_id
  and work_order.is_active = false;

notify pgrst, 'reload schema';
