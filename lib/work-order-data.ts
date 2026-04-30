import { supabase } from "@/lib/supabase";
import {
  FINAL_PROCESS_STEP,
  getCompletableStepsForOrder,
  resolveStepsForOrder,
} from "@/lib/process-steps";
import {
  blockReason,
  hasActiveCorrectiveAction,
  isBlocked,
} from "@/lib/work-order-rules";

export const OUT_OF_SEQUENCE_ISSUE =
  "Steps were not completed in process order. Step-level durations are unreliable.";

export const EASA_MISSING_ISSUE =
  "EASA-Form 1 was not selected before the work order was closed in AcMP.";

const MISSING_STEP_ISSUE_PREFIX = "Missing included process step completion";
const DAY_SECONDS = 86400;

export type WorkOrderEventPayload = {
  work_order_id: string;
  event_type: "activated" | "step_completed" | "blocked_started" | "blocked_ended";
  occurred_at?: string;
  previous_step?: string | null;
  completed_step?: string | null;
  next_step?: string | null;
  expected_step?: string | null;
  is_in_sequence?: boolean;
  work_order_type?: string | null;
  part_number?: string | null;
  customer?: string | null;
  included_process_steps?: string[] | null;
  block_reason?: string | null;
};

export type TrackedWorkOrder = {
  work_order_id: string;
  customer: string | null;
  part_number: string | null;
  work_order_type: string | null;
  current_process_step: string | null;
  data_tracking_enabled?: boolean | null;
  data_tracking_started_at?: string | null;
  easa_selected_at?: string | null;
  sequence_valid?: boolean | null;
  sequence_issue?: string | null;
  included_process_steps?: string[] | null;
};

export type WorkOrderDataBlockStateOrder = TrackedWorkOrder & {
  hold_reason?: string | null;
  rfq_state?: string | null;
  required_next_action?: string | null;
  action_owner?: string | null;
  action_status?: string | null;
  action_closed?: boolean | null;
};

export type StepDurationDays = Record<string, number | "NaN">;

export type ClosedWorkOrderReport = {
  work_order_id: string;
  customer: string | null;
  part_number: string | null;
  work_order_type: string | null;
  activated_at: string | null;
  easa_selected_at: string | null;
  total_seconds_to_easa: number | null;
  total_days_to_certification: number | null;
  included_process_steps: string[] | null;
  step_durations_days: StepDurationDays;
  sequence_valid: boolean;
  sequence_issue: string | null;
  closed_year: number;
  created_at: string;
};

export type WorkOrderEvent = {
  id: number;
  work_order_id: string;
  event_type: string;
  occurred_at: string;
  previous_step: string | null;
  completed_step: string | null;
  next_step: string | null;
  expected_step: string | null;
  is_in_sequence: boolean;
  work_order_type: string | null;
  part_number: string | null;
  customer: string | null;
  included_process_steps: string[] | null;
  block_reason: string | null;
};

export type WorkOrderDataFilters = {
  year?: number;
  workOrderType?: string;
  sequenceStatus?: "all" | "valid" | "invalid";
};

export type WorkOrderDataSummary = {
  trackedClosedWorkOrders: number;
  validSequences: number;
  invalidSequences: number;
  averageDaysToCertification: number | null;
};

type HelperResult<T = null> = {
  data: T | null;
  error: { message: string } | null;
};

type WorkOrderEventInsert = WorkOrderEventPayload & {
  is_in_sequence: boolean;
};

function isMissingOptionalEventColumnError(error: {
  code?: string;
  message?: string;
}): boolean {
  return (
    error.code === "PGRST204" &&
    (Boolean(error.message?.includes("included_process_steps")) ||
      Boolean(error.message?.includes("block_reason")))
  );
}

function withoutOptionalEventColumns(
  payload: WorkOrderEventInsert,
): Omit<WorkOrderEventInsert, "included_process_steps" | "block_reason"> {
  const {
    included_process_steps: _includedProcessSteps,
    block_reason: _blockReason,
    ...fallbackPayload
  } = payload;
  return fallbackPayload;
}

function yearRange(year: number): { start: string; end: string } {
  return {
    start: `${year}-01-01T00:00:00.000Z`,
    end: `${year + 1}-01-01T00:00:00.000Z`,
  };
}

function yearFromDate(value: string | null | undefined): number {
  if (value) {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date.getUTCFullYear();
  }
  return new Date().getFullYear();
}

function secondsBetween(start: string | null, end: string | null): number | null {
  if (!start || !end) return null;
  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) return null;
  return Math.max(0, Math.round((endMs - startMs) / 1000));
}

function daysBetween(start: string | null, end: string | null): number | null {
  const seconds = secondsBetween(start, end);
  if (seconds === null) return null;
  return roundDays(seconds / DAY_SECONDS);
}

type PauseInterval = {
  start: string;
  end: string | null;
};

function msFromTimestamp(value: string | null): number | null {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? null : time;
}

function getPauseIntervals(events: WorkOrderEvent[]): PauseInterval[] {
  const intervals: PauseInterval[] = [];
  let openStart: string | null = null;

  for (const event of events) {
    if (event.event_type === "blocked_started" && !openStart) {
      openStart = event.occurred_at;
    } else if (event.event_type === "blocked_ended" && openStart) {
      intervals.push({ start: openStart, end: event.occurred_at });
      openStart = null;
    }
  }

  if (openStart) {
    intervals.push({ start: openStart, end: null });
  }

  return intervals;
}

function pausedSecondsBetween(
  start: string | null,
  end: string | null,
  intervals: PauseInterval[],
): number {
  const startMs = msFromTimestamp(start);
  const endMs = msFromTimestamp(end);
  if (startMs === null || endMs === null || endMs <= startMs) return 0;

  return intervals.reduce((total, interval) => {
    const intervalStartMs = msFromTimestamp(interval.start);
    const intervalEndMs = msFromTimestamp(interval.end) ?? endMs;
    if (intervalStartMs === null || intervalEndMs <= startMs) return total;

    const overlapStart = Math.max(startMs, intervalStartMs);
    const overlapEnd = Math.min(endMs, intervalEndMs);
    if (overlapEnd <= overlapStart) return total;

    return total + Math.round((overlapEnd - overlapStart) / 1000);
  }, 0);
}

function activeSecondsBetween(
  start: string | null,
  end: string | null,
  intervals: PauseInterval[],
): number | null {
  const seconds = secondsBetween(start, end);
  if (seconds === null) return null;
  return Math.max(0, seconds - pausedSecondsBetween(start, end, intervals));
}

function activeDaysBetween(
  start: string | null,
  end: string | null,
  intervals: PauseInterval[],
): number | null {
  const seconds = activeSecondsBetween(start, end, intervals);
  if (seconds === null) return null;
  return roundDays(seconds / DAY_SECONDS);
}

function roundDays(days: number): number {
  return Math.round(days * 1000) / 1000;
}

function reportTotalDays(row: ClosedWorkOrderReport): number | null {
  if (typeof row.total_days_to_certification === "number") {
    return row.total_days_to_certification;
  }
  if (typeof row.total_seconds_to_easa === "number") {
    return roundDays(row.total_seconds_to_easa / DAY_SECONDS);
  }
  return null;
}

function firstPresentIncludedSteps(
  order: TrackedWorkOrder,
  events: WorkOrderEvent[],
): string[] | null {
  if (order.included_process_steps && order.included_process_steps.length > 0) {
    return order.included_process_steps;
  }

  const eventWithSteps = events.find(
    (event) =>
      event.included_process_steps && event.included_process_steps.length > 0,
  );
  return eventWithSteps?.included_process_steps ?? null;
}

function getActivationTimestamp(
  order: TrackedWorkOrder,
  events: WorkOrderEvent[],
): string | null {
  return (
    order.data_tracking_started_at ??
    events.find((event) => event.event_type === "activated")?.occurred_at ??
    null
  );
}

function getCertificationTimestamp(
  order: TrackedWorkOrder,
  events: WorkOrderEvent[],
): string | null {
  return (
    order.easa_selected_at ??
    events.find(
      (event) =>
        event.event_type === "step_completed" &&
        event.completed_step === FINAL_PROCESS_STEP,
    )?.occurred_at ??
    null
  );
}

function invalidDurationsForSteps(steps: string[]): StepDurationDays {
  return Object.fromEntries(steps.map((step) => [step, "NaN"])) as StepDurationDays;
}

function calculateClosedReportTiming(
  order: TrackedWorkOrder,
  events: WorkOrderEvent[],
): {
  activatedAt: string | null;
  certificationSelectedAt: string | null;
  totalDaysToCertification: number | null;
  totalSecondsToEasa: number | null;
  includedProcessSteps: string[] | null;
  stepDurationsDays: StepDurationDays;
  sequenceValid: boolean;
  sequenceIssue: string | null;
} {
  const includedProcessSteps = firstPresentIncludedSteps(order, events);
  const resolvedProcessSteps = resolveStepsForOrder(
    order.work_order_type,
    includedProcessSteps,
  );
  const expectedCompletableSteps = getCompletableStepsForOrder(
    order.work_order_type,
    includedProcessSteps,
  );
  const includedProcessStepsForReport =
    resolvedProcessSteps.length > 0 ? resolvedProcessSteps : includedProcessSteps;
  const expectedSet = new Set(expectedCompletableSteps);
  const completedEvents = events.filter(
    (event) =>
      event.event_type === "step_completed" &&
      event.completed_step &&
      expectedSet.has(event.completed_step),
  );
  const completedByStep = new Map<string, WorkOrderEvent>();

  for (const event of completedEvents) {
    if (event.completed_step && !completedByStep.has(event.completed_step)) {
      completedByStep.set(event.completed_step, event);
    }
  }

  const activatedAt = getActivationTimestamp(order, events);
  const certificationSelectedAt = getCertificationTimestamp(order, events);
  const pauseIntervals = getPauseIntervals(events);
  const totalSecondsToEasa = activeSecondsBetween(
    activatedAt,
    certificationSelectedAt,
    pauseIntervals,
  );
  const totalDaysToCertification = activeDaysBetween(
    activatedAt,
    certificationSelectedAt,
    pauseIntervals,
  );
  const hasOutOfSequenceEvent = events.some((event) => event.is_in_sequence === false);
  const completedSequence = completedEvents.map((event) => event.completed_step);
  const missingStep = expectedCompletableSteps.find(
    (step) => !completedByStep.has(step),
  );
  const sequenceMatchesExpected =
    completedSequence.length === expectedCompletableSteps.length &&
    expectedCompletableSteps.every((step, index) => completedSequence[index] === step);

  let sequenceValid = Boolean(certificationSelectedAt) && !hasOutOfSequenceEvent;
  let sequenceIssue: string | null = null;

  if (!certificationSelectedAt) {
    sequenceValid = false;
    sequenceIssue = EASA_MISSING_ISSUE;
  } else if (hasOutOfSequenceEvent || !sequenceMatchesExpected) {
    sequenceValid = false;
    sequenceIssue = hasOutOfSequenceEvent
      ? OUT_OF_SEQUENCE_ISSUE
      : missingStep
        ? `${MISSING_STEP_ISSUE_PREFIX}: ${missingStep}.`
        : OUT_OF_SEQUENCE_ISSUE;
  }

  if (!sequenceValid) {
    return {
      activatedAt,
      certificationSelectedAt,
      totalDaysToCertification,
      totalSecondsToEasa,
      includedProcessSteps: includedProcessStepsForReport,
      stepDurationsDays: invalidDurationsForSteps(expectedCompletableSteps),
      sequenceValid,
      sequenceIssue,
    };
  }

  const stepDurationsDays: StepDurationDays = {};
  let previousTimestamp = activatedAt;

  for (const step of expectedCompletableSteps) {
    const event = completedByStep.get(step);
    const days = event
      ? activeDaysBetween(previousTimestamp, event.occurred_at, pauseIntervals)
      : null;
    stepDurationsDays[step] = days ?? "NaN";
    previousTimestamp = event?.occurred_at ?? previousTimestamp;
  }

  return {
    activatedAt,
    certificationSelectedAt,
    totalDaysToCertification,
    totalSecondsToEasa,
    includedProcessSteps: includedProcessStepsForReport,
    stepDurationsDays,
    sequenceValid,
    sequenceIssue,
  };
}

export async function recordWorkOrderEvent(
  payload: WorkOrderEventPayload,
): Promise<HelperResult> {
  const insertPayload = {
    ...payload,
    is_in_sequence: payload.is_in_sequence ?? true,
  };
  const { error } = await supabase.from("work_order_events").insert(insertPayload);

  if (error) {
    if (isMissingOptionalEventColumnError(error)) {
      const { error: fallbackError } = await supabase
        .from("work_order_events")
        .insert(withoutOptionalEventColumns(insertPayload));

      if (!fallbackError) {
        return { data: null, error: null };
      }

      console.error("Failed to record Work Order Data event", fallbackError);
      return { data: null, error: { message: fallbackError.message } };
    }

    console.error("Failed to record Work Order Data event", error);
    return { data: null, error: { message: error.message } };
  }

  return { data: null, error: null };
}

export async function startWorkOrderDataTracking(
  order: TrackedWorkOrder,
  startedAt = new Date().toISOString(),
): Promise<HelperResult> {
  const { error: updateError } = await supabase
    .from("work_orders")
    .update({
      data_tracking_enabled: true,
      data_tracking_started_at: startedAt,
      sequence_valid: true,
      sequence_issue: null,
      easa_selected_at: null,
    })
    .eq("work_order_id", order.work_order_id);

  if (updateError) {
    console.error("Failed to start Work Order Data tracking", updateError);
    return { data: null, error: { message: updateError.message } };
  }

  return recordWorkOrderEvent({
    work_order_id: order.work_order_id,
    event_type: "activated",
    occurred_at: startedAt,
    next_step: order.current_process_step,
    work_order_type: order.work_order_type,
    part_number: order.part_number,
    customer: order.customer,
    included_process_steps: order.included_process_steps ?? null,
    is_in_sequence: true,
  });
}

export async function stopWorkOrderDataTracking(
  workOrderId: string,
): Promise<HelperResult> {
  const { error: updateError } = await supabase
    .from("work_orders")
    .update({
      data_tracking_enabled: false,
      data_tracking_started_at: null,
      easa_selected_at: null,
      sequence_valid: null,
      sequence_issue: null,
    })
    .eq("work_order_id", workOrderId);

  if (updateError) {
    console.error("Failed to stop Work Order Data tracking", updateError);
    return { data: null, error: { message: updateError.message } };
  }

  const { error: eventsError } = await supabase
    .from("work_order_events")
    .delete()
    .eq("work_order_id", workOrderId);

  if (eventsError) {
    console.error("Failed to remove Work Order Data events", eventsError);
    return { data: null, error: { message: eventsError.message } };
  }

  const { error: reportError } = await supabase
    .from("closed_work_order_reports")
    .delete()
    .eq("work_order_id", workOrderId);

  if (reportError) {
    console.error("Failed to remove closed Work Order Data report", reportError);
    return { data: null, error: { message: reportError.message } };
  }

  return { data: null, error: null };
}

export function workOrderDataBlockReason(
  order: WorkOrderDataBlockStateOrder,
): string | null {
  if (isBlocked(order)) return blockReason(order);

  if (hasActiveCorrectiveAction(order)) {
    return order.action_owner?.trim()
      ? `Corrective action: ${order.required_next_action?.trim()} (${order.action_owner.trim()})`
      : `Corrective action: ${order.required_next_action?.trim()}`;
  }

  return null;
}

export function isWorkOrderDataBlocked(
  order: WorkOrderDataBlockStateOrder,
): boolean {
  return Boolean(workOrderDataBlockReason(order));
}

export async function syncWorkOrderDataBlockState(
  order: WorkOrderDataBlockStateOrder,
  occurredAt = new Date().toISOString(),
): Promise<HelperResult> {
  if (!order.data_tracking_enabled) {
    return { data: null, error: null };
  }

  const nextBlockReason = workOrderDataBlockReason(order);
  const { data: latestEvents, error: latestError } = await supabase
    .from("work_order_events")
    .select("event_type, block_reason")
    .eq("work_order_id", order.work_order_id)
    .in("event_type", ["blocked_started", "blocked_ended"])
    .order("occurred_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(1);

  if (latestError) {
    if (isMissingOptionalEventColumnError(latestError)) {
      return syncWorkOrderDataBlockStateWithoutBlockReason(order, occurredAt);
    }

    console.error("Failed to inspect Work Order Data block state", latestError);
    return { data: null, error: { message: latestError.message } };
  }

  const latestEvent = latestEvents?.[0] as
    | { event_type: string; block_reason: string | null }
    | undefined;
  const currentlyPaused = latestEvent?.event_type === "blocked_started";

  if (nextBlockReason && !currentlyPaused) {
    return recordWorkOrderEvent({
      work_order_id: order.work_order_id,
      event_type: "blocked_started",
      occurred_at: occurredAt,
      next_step: order.current_process_step,
      work_order_type: order.work_order_type,
      part_number: order.part_number,
      customer: order.customer,
      included_process_steps: order.included_process_steps ?? null,
      block_reason: nextBlockReason,
      is_in_sequence: true,
    });
  }

  if (!nextBlockReason && currentlyPaused) {
    return recordWorkOrderEvent({
      work_order_id: order.work_order_id,
      event_type: "blocked_ended",
      occurred_at: occurredAt,
      next_step: order.current_process_step,
      work_order_type: order.work_order_type,
      part_number: order.part_number,
      customer: order.customer,
      included_process_steps: order.included_process_steps ?? null,
      block_reason: latestEvent?.block_reason ?? null,
      is_in_sequence: true,
    });
  }

  return { data: null, error: null };
}

async function syncWorkOrderDataBlockStateWithoutBlockReason(
  order: WorkOrderDataBlockStateOrder,
  occurredAt: string,
): Promise<HelperResult> {
  const nextBlockReason = workOrderDataBlockReason(order);
  const { data: latestEvents, error: latestError } = await supabase
    .from("work_order_events")
    .select("event_type")
    .eq("work_order_id", order.work_order_id)
    .in("event_type", ["blocked_started", "blocked_ended"])
    .order("occurred_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(1);

  if (latestError) {
    console.error("Failed to inspect Work Order Data block state", latestError);
    return { data: null, error: { message: latestError.message } };
  }

  const latestEvent = latestEvents?.[0] as { event_type: string } | undefined;
  const currentlyPaused = latestEvent?.event_type === "blocked_started";

  if (nextBlockReason && !currentlyPaused) {
    return recordWorkOrderEvent({
      work_order_id: order.work_order_id,
      event_type: "blocked_started",
      occurred_at: occurredAt,
      next_step: order.current_process_step,
      work_order_type: order.work_order_type,
      part_number: order.part_number,
      customer: order.customer,
      included_process_steps: order.included_process_steps ?? null,
      is_in_sequence: true,
    });
  }

  if (!nextBlockReason && currentlyPaused) {
    return recordWorkOrderEvent({
      work_order_id: order.work_order_id,
      event_type: "blocked_ended",
      occurred_at: occurredAt,
      next_step: order.current_process_step,
      work_order_type: order.work_order_type,
      part_number: order.part_number,
      customer: order.customer,
      included_process_steps: order.included_process_steps ?? null,
      is_in_sequence: true,
    });
  }

  return { data: null, error: null };
}

export async function recordTrackedShopStepCompletion({
  selectedOrder,
  completedStep,
  nextProcessStep,
}: {
  selectedOrder: TrackedWorkOrder;
  completedStep: string;
  nextProcessStep: string;
}): Promise<HelperResult> {
  if (!selectedOrder.data_tracking_enabled) {
    return { data: null, error: null };
  }

  const now = new Date().toISOString();
  const completableSteps = getCompletableStepsForOrder(
    selectedOrder.work_order_type,
    selectedOrder.included_process_steps,
  );
  const expectedStep =
    completableSteps.find((step) => step === selectedOrder.current_process_step) ??
    selectedOrder.current_process_step;
  const isInSequence = completedStep === expectedStep;
  const updatePayload: Record<string, unknown> = {};

  if (!isInSequence) {
    updatePayload.sequence_valid = false;
    updatePayload.sequence_issue = OUT_OF_SEQUENCE_ISSUE;
  }

  if (completedStep === FINAL_PROCESS_STEP) {
    updatePayload.easa_selected_at = now;
  }

  const eventResult = await recordWorkOrderEvent({
    work_order_id: selectedOrder.work_order_id,
    event_type: "step_completed",
    occurred_at: now,
    previous_step: selectedOrder.current_process_step,
    completed_step: completedStep,
    next_step: nextProcessStep,
    expected_step: expectedStep,
    is_in_sequence: isInSequence,
    work_order_type: selectedOrder.work_order_type,
    part_number: selectedOrder.part_number,
    customer: selectedOrder.customer,
    included_process_steps: selectedOrder.included_process_steps ?? null,
  });

  if (eventResult.error) return eventResult;

  if (Object.keys(updatePayload).length === 0) {
    return { data: null, error: null };
  }

  const { error } = await supabase
    .from("work_orders")
    .update(updatePayload)
    .eq("work_order_id", selectedOrder.work_order_id);

  if (error) {
    console.error("Failed to update Work Order Data sequence fields", error);
    return { data: null, error: { message: error.message } };
  }

  return { data: null, error: null };
}

export async function createClosedWorkOrderReportFromWorkOrder({
  workOrderId,
  closeDate,
}: {
  workOrderId: string;
  closeDate: string | null;
}): Promise<HelperResult<{ created: boolean }>> {
  const { data: order, error: orderError } = await supabase
    .from("work_orders")
    .select(
      "work_order_id, customer, part_number, work_order_type, current_process_step, data_tracking_enabled, data_tracking_started_at, easa_selected_at, sequence_valid, sequence_issue, included_process_steps",
    )
    .eq("work_order_id", workOrderId)
    .maybeSingle();

  if (orderError) {
    console.error("Failed to load tracked work order for report", orderError);
    return { data: null, error: { message: orderError.message } };
  }

  const trackedOrder = order as TrackedWorkOrder | null;
  if (!trackedOrder?.data_tracking_enabled) {
    return { data: { created: false }, error: null };
  }

  const { data: eventRows, error: eventError } = await supabase
    .from("work_order_events")
    .select("*")
    .eq("work_order_id", workOrderId)
    .order("occurred_at", { ascending: true });

  if (eventError) {
    console.error("Failed to inspect Work Order Data events", eventError);
    return { data: null, error: { message: eventError.message } };
  }

  const timing = calculateClosedReportTiming(
    trackedOrder,
    (eventRows as WorkOrderEvent[]) || [],
  );

  const { error: reportError } = await supabase
    .from("closed_work_order_reports")
    .upsert(
      {
        work_order_id: trackedOrder.work_order_id,
        customer: trackedOrder.customer,
        part_number: trackedOrder.part_number,
        work_order_type: trackedOrder.work_order_type,
        activated_at: timing.activatedAt,
        easa_selected_at: timing.certificationSelectedAt,
        total_seconds_to_easa: timing.totalSecondsToEasa,
        total_days_to_certification: timing.totalDaysToCertification,
        included_process_steps: timing.includedProcessSteps,
        step_durations_days: timing.stepDurationsDays,
        sequence_valid: timing.sequenceValid,
        sequence_issue: timing.sequenceIssue,
        closed_year: yearFromDate(closeDate),
      },
      { onConflict: "work_order_id" },
    );

  if (reportError) {
    console.error("Failed to create closed Work Order Data report", reportError);
    return { data: null, error: { message: reportError.message } };
  }

  return { data: { created: true }, error: null };
}

export async function getClosedWorkOrderReports(
  filters: WorkOrderDataFilters = {},
): Promise<ClosedWorkOrderReport[]> {
  let query = supabase
    .from("closed_work_order_reports")
    .select("*")
    .order("created_at", { ascending: false });

  if (filters.year) {
    query = query.eq("closed_year", filters.year);
  }

  if (filters.workOrderType && filters.workOrderType !== "all") {
    query = query.eq("work_order_type", filters.workOrderType);
  }

  if (filters.sequenceStatus === "valid") {
    query = query.eq("sequence_valid", true);
  } else if (filters.sequenceStatus === "invalid") {
    query = query.eq("sequence_valid", false);
  }

  const { data, error } = await query;
  if (error) {
    console.error("Failed to load Work Order Data reports", error);
    return [];
  }

  return (data as ClosedWorkOrderReport[]) || [];
}

export async function getWorkOrderDataSummary(
  filters: WorkOrderDataFilters = {},
): Promise<WorkOrderDataSummary> {
  const reports = await getClosedWorkOrderReports(filters);
  const validSequences = reports.filter((row) => row.sequence_valid).length;
  const invalidSequences = reports.length - validSequences;
  const totals = reports
    .map(reportTotalDays)
    .filter((value): value is number => typeof value === "number");
  const averageDaysToCertification =
    totals.length > 0
      ? roundDays(totals.reduce((sum, value) => sum + value, 0) / totals.length)
      : null;

  return {
    trackedClosedWorkOrders: reports.length,
    validSequences,
    invalidSequences,
    averageDaysToCertification,
  };
}

export async function getWorkOrderDataYears(): Promise<number[]> {
  const { data, error } = await supabase
    .from("closed_work_order_reports")
    .select("closed_year")
    .order("closed_year", { ascending: false });

  if (error) {
    console.error("Failed to load Work Order Data years", error);
    return [new Date().getFullYear()];
  }

  const years = Array.from(
    new Set(((data as { closed_year: number }[]) || []).map((row) => row.closed_year)),
  );
  const currentYear = new Date().getFullYear();
  return years.includes(currentYear) ? years : [currentYear, ...years];
}

export async function getWorkOrderDataTypes(): Promise<string[]> {
  const { data, error } = await supabase
    .from("closed_work_order_reports")
    .select("work_order_type")
    .order("work_order_type", { ascending: true });

  if (error) {
    console.error("Failed to load Work Order Data types", error);
    return [];
  }

  return Array.from(
    new Set(
      ((data as { work_order_type: string | null }[]) || [])
        .map((row) => row.work_order_type)
        .filter((value): value is string => Boolean(value)),
    ),
  );
}

export async function recordWorkOrderDataExport(
  year: number,
): Promise<HelperResult> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const exportedAt = new Date().toISOString();
  const { count } = await supabase
    .from("yearly_report_exports")
    .select("id", { count: "exact", head: true })
    .eq("report_year", year);

  const { error } =
    (count ?? 0) > 0
      ? await supabase
          .from("yearly_report_exports")
          .update({
            exported_at: exportedAt,
            exported_by: user?.id ?? null,
          })
          .eq("report_year", year)
      : await supabase.from("yearly_report_exports").insert({
          report_year: year,
          exported_at: exportedAt,
          exported_by: user?.id ?? null,
        });

  if (error) {
    console.error("Failed to record Work Order Data export", error);
    return { data: null, error: { message: error.message } };
  }

  return { data: null, error: null };
}

export async function cleanWorkOrderDataYear(
  year: number,
): Promise<HelperResult> {
  const range = yearRange(year);
  const now = new Date().toISOString();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { error: exportError } = await supabase.from("yearly_report_exports").upsert(
    {
      report_year: year,
      exported_at: now,
      cleaned_at: now,
      exported_by: user?.id ?? null,
    },
    { onConflict: "report_year" },
  );

  if (exportError) {
    console.error("Failed to mark Work Order Data year as cleaned", exportError);
    return { data: null, error: { message: exportError.message } };
  }

  const { error: eventsError } = await supabase
    .from("work_order_events")
    .delete()
    .gte("occurred_at", range.start)
    .lt("occurred_at", range.end);

  if (eventsError) {
    console.error("Failed to clean Work Order Data events", eventsError);
    return { data: null, error: { message: eventsError.message } };
  }

  const { error: reportsError } = await supabase
    .from("closed_work_order_reports")
    .delete()
    .eq("closed_year", year);

  if (reportsError) {
    console.error("Failed to clean Work Order Data reports", reportsError);
    return { data: null, error: { message: reportsError.message } };
  }

  return { data: null, error: null };
}

export async function hasUncleanedYearEndReport(
  year = new Date().getFullYear(),
): Promise<boolean> {
  const { count, error } = await supabase
    .from("closed_work_order_reports")
    .select("work_order_id", { count: "exact", head: true })
    .eq("closed_year", year);

  if (error) {
    console.error("Failed to check Work Order Data year-end report", error);
    return false;
  }

  return (count ?? 0) > 0;
}
