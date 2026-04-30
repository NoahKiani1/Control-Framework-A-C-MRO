export type ParsedRow = {
  work_order_id: string;
  customer: string | null;
  rfq_state: string | null;
  last_system_update: string | null;
  is_open: boolean;
  work_order_type: string | null;
  part_number: string | null;
};

export type StepVariant = "standard" | "custom";

export type NewOrderSetup = {
  is_active: boolean;
  priority: string;
  due_date: string;
  assigned_person_team: string;
  step_variant: StepVariant;
  included_steps: string[];
};

export type ExistingOrderSnapshot = ParsedRow & {
  is_active: boolean;
  current_process_step: string | null;
  assigned_person_team: string | null;
  included_process_steps: string[] | null;
  hold_reason: string | null;
  required_next_action: string | null;
  action_owner: string | null;
  action_status: string | null;
  action_closed: boolean | null;
  data_tracking_enabled: boolean | null;
};

export type RfqActivationCandidate = ParsedRow & {
  previous_rfq_state: string | null;
  current_process_step: string | null;
  assigned_person_team: string | null;
};

export type ImportAnalysis = {
  parsed: ParsedRow[];
  newOrders: ParsedRow[];
  existingOrders: ParsedRow[];
  rfqActivationCandidates: RfqActivationCandidate[];
  oldIds: string[];
  closedIds: string[];
  closedWorkOrders: { work_order_id: string; close_date: string | null }[];
  tooOld: number;
  closedSkipped: number;
  skipped: number;
  existingSnapshots: ExistingOrderSnapshot[];
  rawByWorkOrderId: Record<string, Record<string, unknown>>;
};

export type PendingAcmpReviewType = "new_work_order" | "rfq_approved_inactive";

export type PendingAcmpWorkOrder = {
  id: string;
  work_order_id: string;
  customer: string | null;
  rfq_state: string | null;
  last_system_update: string | null;
  is_open: boolean;
  work_order_type: string | null;
  part_number: string | null;
  source_filename: string | null;
  raw_payload: Record<string, unknown> | null;
  detected_at: string;
  processed_at: string | null;
  status: string;
  review_type: PendingAcmpReviewType;
  previous_rfq_state: string | null;
  current_process_step: string | null;
  assigned_person_team: string | null;
};
