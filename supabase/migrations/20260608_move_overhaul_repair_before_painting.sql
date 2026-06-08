-- Move shop-added Repair before Painting for overhaul flows.
-- Repair is still selected by the shop after Inspection, then executed after
-- all included NDT steps. Repair work orders run Repair before Assembly;
-- overhaul work orders run Repair before Painting.

with stale_current_overhaul_repairs as (
  select work_order_id
  from public.work_orders
  where work_order_type in ('Wheel Overhaul', 'Brake Overhaul')
    and current_process_step = 'Painting'
    and included_process_steps is not null
    and array_position(included_process_steps, 'Painting') <
      array_position(included_process_steps, 'Repair')
)
update public.work_orders work_order
set current_process_step = 'Repair'
from stale_current_overhaul_repairs stale_order
where work_order.work_order_id = stale_order.work_order_id;

with step_templates(work_order_type, step_order) as (
  values
    ('Wheel Repair', array['Intake','Disassembly','Cleaning','Inspection','Eddy Current','Magnetic Test','Repair','Assembly','EASA-Form 1']::text[]),
    ('Wheel Overhaul', array['Intake','Disassembly','Paint Stripping','Inspection','Eddy Current','Penetrant Testing','Magnetic Test','Repair','Painting','Assembly','EASA-Form 1']::text[]),
    ('Brake Repair', array['Intake','Disassembly','Cleaning','Inspection','Eddy Current','Magnetic Test','Repair','Assembly','EASA-Form 1']::text[]),
    ('Brake Overhaul', array['Intake','Disassembly','Paint Stripping','Inspection','Eddy Current','Penetrant Testing','Magnetic Test','Repair','Painting','Assembly','EASA-Form 1']::text[]),
    ('Battery', array['Disassembly','Cleaning','Inspection','Repair','Assembly','EASA-Form 1']::text[])
),
reordered as (
  select
    work_order.work_order_id,
    array_agg(ordered.step order by ordered.ordinal) as next_steps
  from public.work_orders work_order
  join step_templates template
    on template.work_order_type = work_order.work_order_type
  cross join lateral unnest(template.step_order) with ordinality as ordered(step, ordinal)
  where work_order.included_process_steps is not null
    and ordered.step = any(work_order.included_process_steps)
  group by work_order.work_order_id
)
update public.work_orders work_order
set included_process_steps = reordered.next_steps
from reordered
where work_order.work_order_id = reordered.work_order_id;

do $$
begin
  if to_regclass('public.work_order_events') is not null then
    execute $sql$
      with step_templates(work_order_type, step_order) as (
        values
          ('Wheel Repair', array['Intake','Disassembly','Cleaning','Inspection','Eddy Current','Magnetic Test','Repair','Assembly','EASA-Form 1']::text[]),
          ('Wheel Overhaul', array['Intake','Disassembly','Paint Stripping','Inspection','Eddy Current','Penetrant Testing','Magnetic Test','Repair','Painting','Assembly','EASA-Form 1']::text[]),
          ('Brake Repair', array['Intake','Disassembly','Cleaning','Inspection','Eddy Current','Magnetic Test','Repair','Assembly','EASA-Form 1']::text[]),
          ('Brake Overhaul', array['Intake','Disassembly','Paint Stripping','Inspection','Eddy Current','Penetrant Testing','Magnetic Test','Repair','Painting','Assembly','EASA-Form 1']::text[]),
          ('Battery', array['Disassembly','Cleaning','Inspection','Repair','Assembly','EASA-Form 1']::text[])
      ),
      reordered as (
        select
          event.id,
          array_agg(ordered.step order by ordered.ordinal) as next_steps
        from public.work_order_events event
        join step_templates template
          on template.work_order_type = event.work_order_type
        cross join lateral unnest(template.step_order) with ordinality as ordered(step, ordinal)
        where event.included_process_steps is not null
          and ordered.step = any(event.included_process_steps)
        group by event.id
      )
      update public.work_order_events event
      set included_process_steps = reordered.next_steps
      from reordered
      where event.id = reordered.id
    $sql$;
  end if;
end $$;

do $$
begin
  if to_regclass('public.work_order_tracking') is not null then
    execute $sql$
      with stale_current_overhaul_repairs as (
        select work_order_id
        from public.work_order_tracking
        where work_order_type in ('Wheel Overhaul', 'Brake Overhaul')
          and current_block_step = 'Painting'
          and included_process_steps is not null
          and array_position(included_process_steps, 'Painting') <
            array_position(included_process_steps, 'Repair')
      )
      update public.work_order_tracking tracking
      set current_block_step = 'Repair',
          updated_at = now()
      from stale_current_overhaul_repairs stale_order
      where tracking.work_order_id = stale_order.work_order_id;

      with step_templates(work_order_type, step_order) as (
        values
          ('Wheel Repair', array['Intake','Disassembly','Cleaning','Inspection','Eddy Current','Magnetic Test','Repair','Assembly','EASA-Form 1']::text[]),
          ('Wheel Overhaul', array['Intake','Disassembly','Paint Stripping','Inspection','Eddy Current','Penetrant Testing','Magnetic Test','Repair','Painting','Assembly','EASA-Form 1']::text[]),
          ('Brake Repair', array['Intake','Disassembly','Cleaning','Inspection','Eddy Current','Magnetic Test','Repair','Assembly','EASA-Form 1']::text[]),
          ('Brake Overhaul', array['Intake','Disassembly','Paint Stripping','Inspection','Eddy Current','Penetrant Testing','Magnetic Test','Repair','Painting','Assembly','EASA-Form 1']::text[]),
          ('Battery', array['Disassembly','Cleaning','Inspection','Repair','Assembly','EASA-Form 1']::text[])
      ),
      reordered as (
        select
          tracking.work_order_id,
          array_agg(ordered.step order by ordered.ordinal) as next_steps
        from public.work_order_tracking tracking
        join step_templates template
          on template.work_order_type = tracking.work_order_type
        cross join lateral unnest(template.step_order) with ordinality as ordered(step, ordinal)
        where tracking.included_process_steps is not null
          and ordered.step = any(tracking.included_process_steps)
        group by tracking.work_order_id
      )
      update public.work_order_tracking tracking
      set included_process_steps = reordered.next_steps
      from reordered
      where tracking.work_order_id = reordered.work_order_id
    $sql$;
  end if;
end $$;

do $$
begin
  if to_regclass('public.closed_work_order_reports') is not null then
    execute $sql$
      with step_templates(work_order_type, step_order) as (
        values
          ('Wheel Repair', array['Intake','Disassembly','Cleaning','Inspection','Eddy Current','Magnetic Test','Repair','Assembly','EASA-Form 1']::text[]),
          ('Wheel Overhaul', array['Intake','Disassembly','Paint Stripping','Inspection','Eddy Current','Penetrant Testing','Magnetic Test','Repair','Painting','Assembly','EASA-Form 1']::text[]),
          ('Brake Repair', array['Intake','Disassembly','Cleaning','Inspection','Eddy Current','Magnetic Test','Repair','Assembly','EASA-Form 1']::text[]),
          ('Brake Overhaul', array['Intake','Disassembly','Paint Stripping','Inspection','Eddy Current','Penetrant Testing','Magnetic Test','Repair','Painting','Assembly','EASA-Form 1']::text[]),
          ('Battery', array['Disassembly','Cleaning','Inspection','Repair','Assembly','EASA-Form 1']::text[])
      ),
      reordered as (
        select
          report.work_order_id,
          array_agg(ordered.step order by ordered.ordinal) as next_steps
        from public.closed_work_order_reports report
        join step_templates template
          on template.work_order_type = report.work_order_type
        cross join lateral unnest(template.step_order) with ordinality as ordered(step, ordinal)
        where report.included_process_steps is not null
          and ordered.step = any(report.included_process_steps)
        group by report.work_order_id
      )
      update public.closed_work_order_reports report
      set included_process_steps = reordered.next_steps
      from reordered
      where report.work_order_id = reordered.work_order_id
    $sql$;
  end if;
end $$;

notify pgrst, 'reload schema';
-- noah was hier
