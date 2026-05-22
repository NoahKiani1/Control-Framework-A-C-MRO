-- Move shop-added Repair to the post-RFQ part of the process flow.
-- Repair is still selected by the shop after Inspection, but it should be
-- executed after all included inspection/NDT steps and before Assembly.

with step_templates(work_order_type, step_order) as (
  values
    ('Wheel Repair', array['Intake','Disassembly','Cleaning','Inspection','Eddy Current','Magnetic Test','Repair','Assembly','EASA-Form 1']::text[]),
    ('Wheel Overhaul', array['Intake','Disassembly','Paint Stripping','Inspection','Eddy Current','Penetrant Testing','Magnetic Test','Painting','Repair','Assembly','EASA-Form 1']::text[]),
    ('Brake Repair', array['Intake','Disassembly','Cleaning','Inspection','Eddy Current','Magnetic Test','Repair','Assembly','EASA-Form 1']::text[]),
    ('Brake Overhaul', array['Intake','Disassembly','Paint Stripping','Inspection','Eddy Current','Penetrant Testing','Magnetic Test','Painting','Repair','Assembly','EASA-Form 1']::text[]),
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
          ('Wheel Overhaul', array['Intake','Disassembly','Paint Stripping','Inspection','Eddy Current','Penetrant Testing','Magnetic Test','Painting','Repair','Assembly','EASA-Form 1']::text[]),
          ('Brake Repair', array['Intake','Disassembly','Cleaning','Inspection','Eddy Current','Magnetic Test','Repair','Assembly','EASA-Form 1']::text[]),
          ('Brake Overhaul', array['Intake','Disassembly','Paint Stripping','Inspection','Eddy Current','Penetrant Testing','Magnetic Test','Painting','Repair','Assembly','EASA-Form 1']::text[]),
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
      with step_templates(work_order_type, step_order) as (
        values
          ('Wheel Repair', array['Intake','Disassembly','Cleaning','Inspection','Eddy Current','Magnetic Test','Repair','Assembly','EASA-Form 1']::text[]),
          ('Wheel Overhaul', array['Intake','Disassembly','Paint Stripping','Inspection','Eddy Current','Penetrant Testing','Magnetic Test','Painting','Repair','Assembly','EASA-Form 1']::text[]),
          ('Brake Repair', array['Intake','Disassembly','Cleaning','Inspection','Eddy Current','Magnetic Test','Repair','Assembly','EASA-Form 1']::text[]),
          ('Brake Overhaul', array['Intake','Disassembly','Paint Stripping','Inspection','Eddy Current','Penetrant Testing','Magnetic Test','Painting','Repair','Assembly','EASA-Form 1']::text[]),
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
          ('Wheel Overhaul', array['Intake','Disassembly','Paint Stripping','Inspection','Eddy Current','Penetrant Testing','Magnetic Test','Painting','Repair','Assembly','EASA-Form 1']::text[]),
          ('Brake Repair', array['Intake','Disassembly','Cleaning','Inspection','Eddy Current','Magnetic Test','Repair','Assembly','EASA-Form 1']::text[]),
          ('Brake Overhaul', array['Intake','Disassembly','Paint Stripping','Inspection','Eddy Current','Penetrant Testing','Magnetic Test','Painting','Repair','Assembly','EASA-Form 1']::text[]),
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
