import { resolveStepsForOrder } from "@/lib/process-steps";

export const RFQ_MUST_BE_SENT_REASON = "RFQ must be sent";
export const RFQ_AWAITING_APPROVAL_REASON = "Awaiting RFQ approval";

const RFQ_TRIGGER_PROCESS_STEPS = [
  "Inspection",
  "Eddy Current",
  "Penetrant Testing",
  "Magnetic Test",
];

type RfqActionOrder = {
  hold_reason?: string | null;
  rfq_state?: string | null;
  rfq_manual_approved_at?: string | null;
  required_next_action?: string | null;
  action_status?: string | null;
  action_closed?: boolean | null;
};

export type RfqCloseMode = "awaiting_approval" | "continue";

type RfqClosePayloadOptions = {
  mode: RfqCloseMode;
  timestamp: string;
  updateSource: "manual" | "system";
};

export function normalizeRfqWorkflowState(
  state: string | null | undefined,
): string {
  return (state || "").trim().replace(/\s+/g, " ").toLowerCase();
}

export function isRfqPendingApprovalState(
  state: string | null | undefined,
): boolean {
  return normalizeRfqWorkflowState(state) === "rfq send";
}

export function isRfqContinueState(state: string | null | undefined): boolean {
  return normalizeRfqWorkflowState(state) === "rfq send - continue";
}

export function isRfqApprovedState(state: string | null | undefined): boolean {
  const rfq = normalizeRfqWorkflowState(state);
  return rfq === "rfq approved" || rfq === "rfq accepted";
}

export function isRfqApprovedOrContinueState(
  state: string | null | undefined,
): boolean {
  return isRfqContinueState(state) || isRfqApprovedState(state);
}

function normalizedWorkflowText(value: string | null | undefined): string {
  return (value || "").trim().replace(/\s+/g, " ").toLowerCase();
}

export function hasActiveRfqSendAction(order: RfqActionOrder): boolean {
  const action = normalizedWorkflowText(order.required_next_action);
  return (
    action === normalizedWorkflowText(RFQ_MUST_BE_SENT_REASON) &&
    order.action_status !== "Done" &&
    !order.action_closed
  );
}

export function isRfqSendAction(order: RfqActionOrder): boolean {
  return (
    normalizedWorkflowText(order.required_next_action) ===
      normalizedWorkflowText(RFQ_MUST_BE_SENT_REASON) ||
    normalizedWorkflowText(order.hold_reason) ===
      normalizedWorkflowText(RFQ_MUST_BE_SENT_REASON)
  );
}

export function getLastIncludedRfqInspectionStep(
  workOrderType: string | null,
  includedSteps: string[] | null | undefined,
): string | null {
  const rfqTriggerSet = new Set(RFQ_TRIGGER_PROCESS_STEPS);
  const triggerSteps = resolveStepsForOrder(workOrderType, includedSteps).filter(
    (step) => rfqTriggerSet.has(step),
  );
  return triggerSteps[triggerSteps.length - 1] ?? null;
}

export function shouldRequestRfqAfterCompletedStep({
  workOrderType,
  includedSteps,
  completedStep,
  rfqState,
}: {
  workOrderType: string | null;
  includedSteps: string[] | null | undefined;
  completedStep: string | null;
  rfqState?: string | null;
}): boolean {
  if (!completedStep) return false;
  if (
    isRfqPendingApprovalState(rfqState) ||
    isRfqApprovedOrContinueState(rfqState)
  ) {
    return false;
  }

  return (
    completedStep ===
    getLastIncludedRfqInspectionStep(workOrderType, includedSteps)
  );
}

export function buildOpenRfqActionPayload(timestamp: string) {
  return {
    hold_reason: RFQ_MUST_BE_SENT_REASON,
    required_next_action: RFQ_MUST_BE_SENT_REASON,
    action_owner: null,
    action_status: "Open",
    action_closed: false,
    action_created_at: timestamp,
    action_closed_at: null,
  };
}

export function buildCloseRfqActionPayload({
  mode,
  timestamp,
  updateSource,
}: RfqClosePayloadOptions) {
  return {
    action_status: "Done",
    action_closed: true,
    action_closed_at: timestamp,
    hold_reason:
      mode === "awaiting_approval" ? RFQ_AWAITING_APPROVAL_REASON : null,
    rfq_manual_approved_at:
      mode === "continue" && updateSource === "manual" ? timestamp : null,
    required_next_action: null,
    action_owner: null,
    action_created_at: null,
    ...(updateSource === "manual"
      ? { last_manual_update: timestamp }
      : { last_system_update: timestamp }),
  };
}

export function getRfqCloseModeForImportedState(
  rfqState: string | null | undefined,
): RfqCloseMode | null {
  if (isRfqPendingApprovalState(rfqState)) return "awaiting_approval";
  if (isRfqApprovedOrContinueState(rfqState)) return "continue";
  return null;
}

export function getImportedRfqManualApprovedAt(
  currentManualApprovedAt: string | null | undefined,
  importedRfqState: string | null | undefined,
): string | null {
  return isRfqPendingApprovalState(importedRfqState)
    ? currentManualApprovedAt ?? null
    : null;
}

export function buildImportedRfqActionClosePayload(
  order: RfqActionOrder,
  rfqState: string | null | undefined,
  timestamp: string,
) {
  if (!hasActiveRfqSendAction(order)) return null;
  const mode = getRfqCloseModeForImportedState(rfqState);
  if (!mode) return null;

  return buildCloseRfqActionPayload({
    mode,
    timestamp,
    updateSource: "system",
  });
}
