-- Per-work-order process-step configuration.
--
-- Replaces the single `magnetic_test_required` boolean with an authoritative,
-- ordered list of steps the shop has to complete for this work order.
-- Allows Office to pick Standard / Custom during import & activation and to
-- add or drop individual tasks (e.g. Magnetic Test) without touching the
-- shared template in `lib/process-steps.ts`.
--
-- The legacy `magnetic_test_required` column is kept for now so rollback and
-- cross-version reads stay safe; a follow-up migration can drop it once every
-- consumer reads `included_process_steps`.

alter table public.work_orders
  add column if not exists included_process_steps text[];

update public.work_orders
set included_process_steps = case work_order_type
    when 'Wheel Repair' then
      case when coalesce(magnetic_test_required, false) then
        array['Intake','Disassembly','Cleaning','Magnetic Test','Eddy Current','Inspection','Assembly','EASA-Form 1']
      else
        array['Intake','Disassembly','Cleaning','Eddy Current','Inspection','Assembly','EASA-Form 1']
      end
    when 'Wheel Overhaul' then
      case when coalesce(magnetic_test_required, false) then
        array['Intake','Disassembly','Paint Stripping','Magnetic Test','Penetrant Testing','Eddy Current','Inspection','Painting','Assembly','EASA-Form 1']
      else
        array['Intake','Disassembly','Paint Stripping','Penetrant Testing','Eddy Current','Inspection','Painting','Assembly','EASA-Form 1']
      end
    when 'Brake Repair' then
      case when coalesce(magnetic_test_required, false) then
        array['Intake','Disassembly','Cleaning','Magnetic Test','Eddy Current','Inspection','Assembly','EASA-Form 1']
      else
        array['Intake','Disassembly','Cleaning','Eddy Current','Inspection','Assembly','EASA-Form 1']
      end
    when 'Brake Overhaul' then
      case when coalesce(magnetic_test_required, false) then
        array['Intake','Disassembly','Paint Stripping','Magnetic Test','Penetrant Testing','Eddy Current','Inspection','Painting','Assembly','EASA-Form 1']
      else
        array['Intake','Disassembly','Paint Stripping','Penetrant Testing','Eddy Current','Inspection','Painting','Assembly','EASA-Form 1']
      end
    when 'Battery' then
      array['Disassembly','Cleaning','Inspection','Assembly','EASA-Form 1']
    else null
  end
where included_process_steps is null;
