import { supabase } from "@/lib/supabase";
import type { SupabaseClient } from "@supabase/supabase-js";
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
import { zonedDateTimeToUtcIso } from "@/lib/time-zone";

export const OUT_OF_SEQUENCE_ISSUE =
  "Steps were not completed in process order. Step-level durations are unreliable.";

export const EASA_MISSING_ISSUE =
  "EASA-Form 1 was not selected before the work order was closed in AcMP.";

const MISSING_STEP_ISSUE_PREFIX = "Missing included process step completion";
const DAY_SECONDS = 86400;
const ACMP_CLOSE_FALLBACK_HOUR = 16;
const ACMP_CLOSE_FALLBACK_MINUTE = 30;
const ACMP_CLOSE_TIME_ZONE = "Europe/Amsterdam";

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
  rfq_manual_approved_at?: string | null;
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

export type CompletedTrackedStep = {
  step: string;
  occurred_at: string;
  previous_step: string | null;
  next_step: string | null;
  expected_step: string | null;
  is_in_sequence: boolean;
};

export type TrackedBlockPeriod = {
  started_at: string;
  ended_at: string;
  step: string | null;
  reason: string | null;
  seconds: number;
};

export type WorkOrderTracking = {
  work_order_id: string;
  activated_at: string | null;
  work_order_type: string | null;
  part_number: string | null;
  customer: string | null;
  included_process_steps: string[] | null;
  completed_steps: CompletedTrackedStep[] | null;
  block_periods: TrackedBlockPeriod[] | null;
  total_blocked_seconds: number | null;
  current_block_started_at: string | null;
  current_block_step: string | null;
  current_block_reason: string | null;
  sequence_valid: boolean | null;
  sequence_issue: string | null;
};

function yearFromDate(value: string | null | undefined): number {
  if (value) {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date.getUTCFullYear();
  }
  return new Date().getFullYear();
}

function acmpCloseTimestamp(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  return zonedDateTimeToUtcIso({
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: ACMP_CLOSE_FALLBACK_HOUR,
    minute: ACMP_CLOSE_FALLBACK_MINUTE,
    timeZone: ACMP_CLOSE_TIME_ZONE,
  });
}

function secondsBetween(start: string | null, end: string | null): number | null {
  if (!start || !end) return null;
  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) return null;
  return Math.max(0, Math.round((endMs - startMs) / 1000));
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function normalizeCompletedSteps(value: unknown): CompletedTrackedStep[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item) => {
    if (!isRecord(item)) return [];
    const step = stringValue(item.step);
    const occurredAt = stringValue(item.occurred_at);
    if (!step || !occurredAt) return [];

    return [
      {
        step,
        occurred_at: occurredAt,
        previous_step: stringValue(item.previous_step),
        next_step: stringValue(item.next_step),
        expected_step: stringValue(item.expected_step),
        is_in_sequence: item.is_in_sequence !== false,
      },
    ];
  });
}

function normalizeBlockPeriods(value: unknown): TrackedBlockPeriod[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item) => {
    if (!isRecord(item)) return [];
    const startedAt = stringValue(item.started_at);
    const endedAt = stringValue(item.ended_at);
    if (!startedAt || !endedAt) return [];

    return [
      {
        started_at: startedAt,
        ended_at: endedAt,
        step: stringValue(item.step),
        reason: stringValue(item.reason),
        seconds: numberValue(item.seconds),
      },
    ];
  });
}

function getPauseIntervals(tracking: WorkOrderTracking | null): PauseInterval[] {
  const intervals: PauseInterval[] = normalizeBlockPeriods(tracking?.block_periods).map(
    (period) => ({
      start: period.started_at,
      end: period.ended_at,
    }),
  );

  if (tracking?.current_block_started_at) {
    intervals.push({ start: tracking.current_block_started_at, end: null });
  }

  return intervals;
}

function firstPresentIncludedSteps(
  order: TrackedWorkOrder,
  tracking: WorkOrderTracking | null,
): string[] | null {
  if (order.included_process_steps && order.included_process_steps.length > 0) {
    return order.included_process_steps;
  }

  return tracking?.included_process_steps &&
    tracking.included_process_steps.length > 0
    ? tracking.included_process_steps
    : null;
}

function getActivationTimestamp(
  order: TrackedWorkOrder,
  tracking: WorkOrderTracking | null,
): string | null {
  return order.data_tracking_started_at ?? tracking?.activated_at ?? null;
}

function getCertificationTimestamp(
  order: TrackedWorkOrder,
  completedSteps: CompletedTrackedStep[],
  fallbackCloseTimestamp: string | null = null,
): string | null {
  return (
    order.easa_selected_at ??
    completedSteps.find((step) => step.step === FINAL_PROCESS_STEP)?.occurred_at ??
    fallbackCloseTimestamp ??
    null
  );
}

function invalidDurationsForSteps(steps: string[]): StepDurationDays {
  return Object.fromEntries(steps.map((step) => [step, "NaN"])) as StepDurationDays;
}

function calculateClosedReportTiming(
  order: TrackedWorkOrder,
  tracking: WorkOrderTracking | null,
  closeDate: string | null,
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
  const includedProcessSteps = firstPresentIncludedSteps(order, tracking);
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
  const fallbackCloseTimestamp = acmpCloseTimestamp(closeDate);
  const actualCompletedSteps = normalizeCompletedSteps(
    tracking?.completed_steps,
  ).filter((step) => expectedSet.has(step.step));
  const hasFinalStepCompletion = actualCompletedSteps.some(
    (step) => step.step === FINAL_PROCESS_STEP,
  );
  const finalStepIsExpected = expectedSet.has(FINAL_PROCESS_STEP);
  const completedSteps =
    fallbackCloseTimestamp && finalStepIsExpected && !hasFinalStepCompletion
      ? [
          ...actualCompletedSteps,
          {
            step: FINAL_PROCESS_STEP,
            occurred_at: fallbackCloseTimestamp,
            previous_step: null,
            next_step: null,
            expected_step: FINAL_PROCESS_STEP,
            is_in_sequence: true,
          },
        ].sort((a, b) => {
          const timeDiff =
            new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime();
          return timeDiff;
        })
      : actualCompletedSteps;
  const completedByStep = new Map<string, CompletedTrackedStep>();

  for (const step of completedSteps) {
    if (!completedByStep.has(step.step)) {
      completedByStep.set(step.step, step);
    }
  }

  const activatedAt = getActivationTimestamp(order, tracking);
  const certificationSelectedAt = getCertificationTimestamp(
    order,
    completedSteps,
    fallbackCloseTimestamp,
  );
  const pauseIntervals = getPauseIntervals(tracking);
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
  const hasOutOfSequenceStep =
    order.sequence_valid === false ||
    tracking?.sequence_valid === false ||
    completedSteps.some((step) => step.is_in_sequence === false);
  const completedSequence = completedSteps.map((step) => step.step);
  const missingStep = expectedCompletableSteps.find(
    (step) => !completedByStep.has(step),
  );
  const sequenceMatchesExpected =
    completedSequence.length === expectedCompletableSteps.length &&
    expectedCompletableSteps.every((step, index) => completedSequence[index] === step);

  let sequenceValid = Boolean(certificationSelectedAt) && !hasOutOfSequenceStep;
  let sequenceIssue: string | null = null;

  if (!certificationSelectedAt) {
    sequenceValid = false;
    sequenceIssue = EASA_MISSING_ISSUE;
  } else if (hasOutOfSequenceStep || !sequenceMatchesExpected) {
    sequenceValid = false;
    sequenceIssue = hasOutOfSequenceStep
      ? order.sequence_issue ?? tracking?.sequence_issue ?? OUT_OF_SEQUENCE_ISSUE
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
    const completedStep = completedByStep.get(step);
    const days = completedStep
      ? activeDaysBetween(previousTimestamp, completedStep.occurred_at, pauseIntervals)
      : null;
    stepDurationsDays[step] = days ?? "NaN";
    previousTimestamp = completedStep?.occurred_at ?? previousTimestamp;
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

function trackingSnapshotPayload(
  order: TrackedWorkOrder,
  activatedAt: string,
): Record<string, unknown> {
  return {
    work_order_id: order.work_order_id,
    activated_at: activatedAt,
    work_order_type: order.work_order_type,
    part_number: order.part_number,
    customer: order.customer,
    included_process_steps: order.included_process_steps ?? null,
    completed_steps: [],
    block_periods: [],
    total_blocked_seconds: 0,
    current_block_started_at: null,
    current_block_step: null,
    current_block_reason: null,
    sequence_valid: true,
    sequence_issue: null,
    updated_at: activatedAt,
  };
}

async function loadWorkOrderTracking(
  workOrderId: string,
  client: SupabaseClient,
): Promise<HelperResult<WorkOrderTracking>> {
  const { data, error } = await client
    .from("work_order_tracking")
    .select("*")
    .eq("work_order_id", workOrderId)
    .maybeSingle();

  if (error) {
    console.error("Failed to load Work Order Data tracking state", error);
    return { data: null, error: { message: error.message } };
  }

  return { data: (data as WorkOrderTracking | null) ?? null, error: null };
}

async function ensureWorkOrderTracking(
  order: TrackedWorkOrder,
  activatedAt: string,
  client: SupabaseClient,
): Promise<HelperResult<WorkOrderTracking>> {
  const existing = await loadWorkOrderTracking(order.work_order_id, client);
  if (existing.error || existing.data) return existing;

  const { data, error } = await client
    .from("work_order_tracking")
    .upsert(trackingSnapshotPayload(order, activatedAt), {
      onConflict: "work_order_id",
    })
    .select("*")
    .maybeSingle();

  if (error) {
    console.error("Failed to initialize Work Order Data tracking state", error);
    return { data: null, error: { message: error.message } };
  }

  return { data: (data as WorkOrderTracking | null) ?? null, error: null };
}

export async function startWorkOrderDataTracking(
  order: TrackedWorkOrder,
  startedAt = new Date().toISOString(),
  client: SupabaseClient = supabase,
): Promise<HelperResult> {
  const { error: updateError } = await client
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

  const { error: trackingError } = await client
    .from("work_order_tracking")
    .upsert(trackingSnapshotPayload(order, startedAt), {
      onConflict: "work_order_id",
    });

  if (trackingError) {
    console.error("Failed to start Work Order Data tracking state", trackingError);
    return { data: null, error: { message: trackingError.message } };
  }

  return { data: null, error: null };
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

  const { error: trackingError } = await supabase
    .from("work_order_tracking")
    .delete()
    .eq("work_order_id", workOrderId);

  if (trackingError) {
    console.error("Failed to remove Work Order Data tracking state", trackingError);
    return { data: null, error: { message: trackingError.message } };
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

export async function deleteWorkOrderTrackingRows(
  workOrderIds: string[],
  client: SupabaseClient = supabase,
): Promise<HelperResult> {
  if (workOrderIds.length === 0) return { data: null, error: null };

  const { error } = await client
    .from("work_order_tracking")
    .delete()
    .in("work_order_id", workOrderIds);

  if (error) {
    console.error("Failed to remove Work Order Data tracking rows", error);
    return { data: null, error: { message: error.message } };
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
  client: SupabaseClient = supabase,
): Promise<HelperResult> {
  if (!order.data_tracking_enabled) {
    return { data: null, error: null };
  }

  const nextBlockReason = workOrderDataBlockReason(order);
  const trackingResult = await ensureWorkOrderTracking(
    order,
    order.data_tracking_started_at ?? occurredAt,
    client,
  );
  if (trackingResult.error) {
    return { data: null, error: trackingResult.error };
  }

  const tracking = trackingResult.data;
  const currentlyPaused = Boolean(tracking?.current_block_started_at);
  const commonPayload = {
    work_order_type: order.work_order_type,
    part_number: order.part_number,
    customer: order.customer,
    included_process_steps: order.included_process_steps ?? null,
    updated_at: occurredAt,
  };

  if (nextBlockReason && !currentlyPaused) {
    const { error } = await client
      .from("work_order_tracking")
      .update({
        ...commonPayload,
        current_block_started_at: occurredAt,
        current_block_step: order.current_process_step,
        current_block_reason: nextBlockReason,
      })
      .eq("work_order_id", order.work_order_id);

    if (error) {
      console.error("Failed to start Work Order Data block timing", error);
      return { data: null, error: { message: error.message } };
    }

    return { data: null, error: null };
  }

  if (!nextBlockReason && currentlyPaused) {
    const blockedSeconds =
      secondsBetween(tracking?.current_block_started_at ?? null, occurredAt) ?? 0;
    const nextBlockPeriods = [
      ...normalizeBlockPeriods(tracking?.block_periods),
      {
        started_at: tracking?.current_block_started_at ?? occurredAt,
        ended_at: occurredAt,
        step: tracking?.current_block_step ?? order.current_process_step,
        reason: tracking?.current_block_reason ?? null,
        seconds: blockedSeconds,
      },
    ];
    const nextTotalBlockedSeconds =
      Math.max(0, tracking?.total_blocked_seconds ?? 0) + blockedSeconds;

    const { error } = await client
      .from("work_order_tracking")
      .update({
        ...commonPayload,
        block_periods: nextBlockPeriods,
        total_blocked_seconds: nextTotalBlockedSeconds,
        current_block_started_at: null,
        current_block_step: null,
        current_block_reason: null,
      })
      .eq("work_order_id", order.work_order_id);

    if (error) {
      console.error("Failed to finish Work Order Data block timing", error);
      return { data: null, error: { message: error.message } };
    }

    return { data: null, error: null };
  }

  if (nextBlockReason && currentlyPaused && nextBlockReason !== tracking?.current_block_reason) {
    const { error } = await client
      .from("work_order_tracking")
      .update({
        ...commonPayload,
        current_block_reason: nextBlockReason,
      })
      .eq("work_order_id", order.work_order_id);

    if (error) {
      console.error("Failed to update Work Order Data block reason", error);
      return { data: null, error: { message: error.message } };
    }
  }

  return { data: null, error: null };
}

export async function syncWorkOrderDataSnapshot(
  order: TrackedWorkOrder,
  occurredAt = new Date().toISOString(),
  client: SupabaseClient = supabase,
): Promise<HelperResult> {
  if (!order.data_tracking_enabled) {
    return { data: null, error: null };
  }

  const trackingResult = await ensureWorkOrderTracking(
    order,
    order.data_tracking_started_at ?? occurredAt,
    client,
  );
  if (trackingResult.error) {
    return { data: null, error: trackingResult.error };
  }

  const { error } = await client
    .from("work_order_tracking")
    .update({
      work_order_type: order.work_order_type,
      part_number: order.part_number,
      customer: order.customer,
      included_process_steps: order.included_process_steps ?? null,
      updated_at: occurredAt,
    })
    .eq("work_order_id", order.work_order_id);

  if (error) {
    console.error("Failed to sync Work Order Data snapshot", error);
    return { data: null, error: { message: error.message } };
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

  const trackingResult = await ensureWorkOrderTracking(
    selectedOrder,
    selectedOrder.data_tracking_started_at ?? now,
    supabase,
  );
  if (trackingResult.error) {
    return { data: null, error: trackingResult.error };
  }

  const tracking = trackingResult.data;
  const completedSteps = normalizeCompletedSteps(tracking?.completed_steps);
  const nextCompletedSteps: CompletedTrackedStep[] = [
    ...completedSteps,
    {
      step: completedStep,
      occurred_at: now,
      previous_step: selectedOrder.current_process_step,
      next_step: nextProcessStep,
      expected_step: expectedStep,
      is_in_sequence: isInSequence,
    },
  ];
  const nextSequenceValid =
    Boolean(tracking?.sequence_valid ?? selectedOrder.sequence_valid ?? true) &&
    isInSequence;
  const nextSequenceIssue = !isInSequence
    ? OUT_OF_SEQUENCE_ISSUE
    : tracking?.sequence_issue ?? selectedOrder.sequence_issue ?? null;

  const { error: trackingError } = await supabase
    .from("work_order_tracking")
    .update({
      work_order_type: selectedOrder.work_order_type,
      part_number: selectedOrder.part_number,
      customer: selectedOrder.customer,
      included_process_steps: selectedOrder.included_process_steps ?? null,
      completed_steps: nextCompletedSteps,
      sequence_valid: nextSequenceValid,
      sequence_issue: nextSequenceIssue,
      updated_at: now,
    })
    .eq("work_order_id", selectedOrder.work_order_id);

  if (trackingError) {
    console.error("Failed to record Work Order Data step", trackingError);
    return { data: null, error: { message: trackingError.message } };
  }

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
  client = supabase,
}: {
  workOrderId: string;
  closeDate: string | null;
  client?: SupabaseClient;
}): Promise<HelperResult<{ created: boolean }>> {
  const { data: order, error: orderError } = await client
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

  const trackingResult = await loadWorkOrderTracking(workOrderId, client);
  if (trackingResult.error) {
    return { data: null, error: trackingResult.error };
  }

  const timing = calculateClosedReportTiming(
    trackedOrder,
    trackingResult.data,
    closeDate,
  );

  const { error: reportError } = await client
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

  const { error: cleanupError } = await client
    .from("work_order_tracking")
    .delete()
    .eq("work_order_id", workOrderId);

  if (cleanupError) {
    console.error("Failed to clean closed Work Order Data tracking", cleanupError);
    return { data: null, error: { message: cleanupError.message } };
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
// noah was hier
