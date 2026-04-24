-- Extend the pending AcMP review queue to cover two review types:
--   - 'new_work_order'         : a brand-new AcMP work order waiting to be set up.
--   - 'rfq_approved_inactive'  : an existing inactive work order whose RFQ state
--                                now indicates approved/continue. Office must
--                                decide whether to activate it or keep it inactive.
--
-- Snapshot columns capture values at the moment the row was queued so Office can
-- review them without needing to cross-reference work_orders in the UI.
--
-- The existing `unique(work_order_id)` stays in place. A given work order can
-- only be in one category at a time: new_work_order rows are only ever created
-- when the work order does not yet exist in `work_orders`, and
-- rfq_approved_inactive rows are only created when it already does.

alter table public.pending_acmp_work_orders
  add column if not exists review_type text not null default 'new_work_order',
  add column if not exists previous_rfq_state text null,
  add column if not exists current_process_step text null,
  add column if not exists assigned_person_team text null;

create index if not exists pending_acmp_work_orders_review_type_idx
  on public.pending_acmp_work_orders (review_type);

create index if not exists pending_acmp_work_orders_status_review_type_idx
  on public.pending_acmp_work_orders (status, review_type);
