-- Track blocked intervals so Work Order Data timing excludes time spent waiting
-- on RFQ, qualification availability, or corrective actions.

alter table public.work_order_events
  add column if not exists block_reason text null;

create index if not exists work_order_events_block_events_idx
  on public.work_order_events (work_order_id, event_type, occurred_at)
  where event_type in ('blocked_started', 'blocked_ended');

insert into public.work_order_events (
  work_order_id,
  event_type,
  occurred_at,
  next_step,
  work_order_type,
  part_number,
  customer,
  included_process_steps,
  block_reason,
  is_in_sequence
)
select
  work_order_id,
  'blocked_started',
  greatest(
    coalesce(last_manual_update, last_system_update, data_tracking_started_at, now()),
    coalesce(data_tracking_started_at, now())
  ),
  current_process_step,
  work_order_type,
  part_number,
  customer,
  included_process_steps,
  case
    when nullif(trim(hold_reason), '') is not null then hold_reason
    when lower(trim(coalesce(rfq_state, ''))) = 'rfq send' then 'RFQ sent'
    when lower(trim(coalesce(rfq_state, ''))) = 'rfq rejected' then 'RFQ rejected'
    when nullif(trim(required_next_action), '') is not null then
      case
        when nullif(trim(action_owner), '') is not null then
          'Corrective action: ' || trim(required_next_action) || ' (' || trim(action_owner) || ')'
        else 'Corrective action: ' || trim(required_next_action)
      end
    else 'Blocked'
  end,
  true
from public.work_orders work_order
where work_order.data_tracking_enabled = true
  and work_order.is_active = true
  and (
    nullif(trim(work_order.hold_reason), '') is not null
    or lower(trim(coalesce(work_order.rfq_state, ''))) in ('rfq send', 'rfq rejected')
    or (
      nullif(trim(work_order.required_next_action), '') is not null
      and coalesce(work_order.action_status, '') <> 'Done'
      and coalesce(work_order.action_closed, false) = false
    )
  )
  and not exists (
    select 1
    from public.work_order_events existing_event
    where existing_event.work_order_id = work_order.work_order_id
      and existing_event.event_type = 'blocked_started'
  );

notify pgrst, 'reload schema';
