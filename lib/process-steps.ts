/**
 * Process step definitions and progression logic.
 *
 * Terminology:
 * - `current_process_step` = the step the work order is currently AT (i.e. the
 *   next thing that needs to happen). Displayed as "Current Step" in planning,
 *   dashboard, and shop wall.
 * - "Completed step" = the step the shop engineer just finished. The shop-update
 *   page lets the engineer pick the completed step; this module calculates what
 *   `current_process_step` should become.
 *
 * Step configuration is per work order: `work_orders.included_process_steps`
 * is the authoritative, ordered list of steps the shop has to run through for
 * that order. Office sets it during import / activation (Standard uses the
 * default active steps for the type; Custom lets them add/drop tasks such as
 * Magnetic Test).
 *
 * Template-level helpers (those that only take `workOrderType`) remain for
 * places where no order is in scope — for example restriction lookups and the
 * shared planning legend. Order-aware call sites must pass
 * `includedSteps` so the per-order configuration is respected.
 */

/** Steps that are skipped unless explicitly included per work order. */
export const OPTIONAL_PROCESS_STEPS = ["Magnetic Test"];

/** The last tracked step in every flow. */
export const FINAL_PROCESS_STEP = "EASA-Form 1";

/** Status after the final tracked step has been completed. */
export const READY_TO_CLOSE_STEP = "Ready to close";

/**
 * Full step sequences per work-order type, including optional steps.
 * Used by capacity calculations (STEP_WEIGHTS) and restriction checks.
 */
export const PROCESS_STEPS: Record<string, string[]> = {
  "Wheel Repair": [
    "Intake",
    "Disassembly",
    "Cleaning",
    "Magnetic Test",
    "Eddy Current",
    "Inspection",
    "Assembly",
    "EASA-Form 1",
  ],
  "Wheel Overhaul": [
    "Intake",
    "Disassembly",
    "Paint Stripping",
    "Magnetic Test",
    "Penetrant Testing",
    "Eddy Current",
    "Inspection",
    "Painting",
    "Assembly",
    "EASA-Form 1",
  ],
  "Brake Repair": [
    "Intake",
    "Disassembly",
    "Cleaning",
    "Magnetic Test",
    "Eddy Current",
    "Inspection",
    "Assembly",
    "EASA-Form 1",
  ],
  "Brake Overhaul": [
    "Intake",
    "Disassembly",
    "Paint Stripping",
    "Magnetic Test",
    "Penetrant Testing",
    "Eddy Current",
    "Inspection",
    "Painting",
    "Assembly",
    "EASA-Form 1",
  ],
  Battery: [
    "Disassembly",
    "Cleaning",
    "Inspection",
    "Assembly",
    "EASA-Form 1",
  ],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** All steps for a given type (including optional). */
export function getProcessStepsForType(workOrderType: string | null): string[] {
  if (!workOrderType) return [];
  return PROCESS_STEPS[workOrderType] || [];
}

/** Whether a step is optional (skipped unless included per order). */
export function isOptionalProcessStep(step: string | null): boolean {
  if (!step) return false;
  return OPTIONAL_PROCESS_STEPS.includes(step);
}

/** Whether a work-order type contains any optional steps. */
export function hasOptionalSteps(workOrderType: string | null): boolean {
  return getProcessStepsForType(workOrderType).some(isOptionalProcessStep);
}

// ---------------------------------------------------------------------------
// Template-level step filtering (no per-order configuration)
// ---------------------------------------------------------------------------

/**
 * Default active steps for a type. `includeOptional` decides whether optional
 * steps (Magnetic Test) are part of the default set. Used as the baseline for
 * Standard variant orders and for non-order contexts (restrictions, legends).
 */
export function getActiveStepsForType(
  workOrderType: string | null,
  includeOptional = false,
): string[] {
  return getProcessStepsForType(workOrderType).filter(
    (step) => includeOptional || !isOptionalProcessStep(step),
  );
}

/** Alias kept for capacity / restriction code that never needs optionals. */
export function getTrackedStepsForType(workOrderType: string | null): string[] {
  return getActiveStepsForType(workOrderType, false);
}

/** The first step, set automatically when a work order is activated. */
export const INTAKE_STEP = "Intake";
export const DEFAULT_START_PROCESS_STEP = "Disassembly";

// ---------------------------------------------------------------------------
// Order-aware step resolution
// ---------------------------------------------------------------------------

/**
 * The effective step list for an order.
 *
 * If the order has `included_process_steps`, that is authoritative (kept in
 * template order and filtered to known steps so a stale value cannot inject an
 * unknown step). Otherwise we fall back to the default active steps for the
 * type — this handles orders that pre-date the column and orders whose
 * `work_order_type` is null.
 */
export function resolveStepsForOrder(
  workOrderType: string | null,
  includedSteps: string[] | null | undefined,
): string[] {
  const template = getProcessStepsForType(workOrderType);
  if (template.length === 0) return [];

  if (includedSteps && includedSteps.length > 0) {
    const includedSet = new Set(includedSteps);
    return template.filter((step) => includedSet.has(step));
  }

  return getActiveStepsForType(workOrderType, false);
}

/**
 * Steps the shop engineer can select as "completed" in the shop-update form.
 * Excludes Intake — it is set automatically when the order is activated.
 */
export function getCompletableStepsForOrder(
  workOrderType: string | null,
  includedSteps: string[] | null | undefined,
): string[] {
  return resolveStepsForOrder(workOrderType, includedSteps).filter(
    (step) => step !== INTAKE_STEP,
  );
}

/** The first completable step for an order (used on activation). */
export function getInitialProcessStepForOrder(
  workOrderType: string | null,
  includedSteps: string[] | null | undefined,
): string {
  const completable = getCompletableStepsForOrder(workOrderType, includedSteps);
  return completable[0] || DEFAULT_START_PROCESS_STEP;
}

/**
 * Given a completed step, return the value `current_process_step` should
 * become. Returns `READY_TO_CLOSE_STEP` when the completed step is the last in
 * the order's configured sequence.
 */
export function getNextProcessStepAfterCompletedForOrder(
  workOrderType: string | null,
  completedStep: string | null,
  includedSteps: string[] | null | undefined,
): string | null {
  if (!workOrderType || !completedStep) return null;

  const steps = resolveStepsForOrder(workOrderType, includedSteps);
  const completedIndex = steps.indexOf(completedStep);
  if (completedIndex === -1) return null;

  if (completedIndex >= steps.length - 1) return READY_TO_CLOSE_STEP;
  return steps[completedIndex + 1];
}

/**
 * Given `current_process_step`, return the most recently completed step
 * (i.e. the active step directly before the current one) for the
 * shop-update "completed step" dropdown. Returns "" when nothing is completed.
 */
export function getLastCompletedStepForOrder(
  workOrderType: string | null,
  currentProcessStep: string | null,
  includedSteps: string[] | null | undefined,
): string {
  if (!workOrderType || !currentProcessStep) return "";

  const completable = getCompletableStepsForOrder(workOrderType, includedSteps);
  const currentIndex = completable.indexOf(currentProcessStep);
  if (currentIndex <= 0) return "";
  return completable[currentIndex - 1];
}

// ---------------------------------------------------------------------------
// Legacy template-level progression helpers
//
// Kept for places that don't have a concrete order (e.g. the Office Update
// activation-step dropdown for orders that haven't picked a variant yet).
// Prefer the *ForOrder variants when an order is in scope.
// ---------------------------------------------------------------------------

export function getInitialProcessStep(
  workOrderType: string | null,
  includeOptional = false,
): string {
  const completable = getActiveStepsForType(workOrderType, includeOptional).filter(
    (step) => step !== INTAKE_STEP,
  );
  return completable[0] || DEFAULT_START_PROCESS_STEP;
}

export function getCompletableStepsForType(
  workOrderType: string | null,
  includeOptional = false,
): string[] {
  return getActiveStepsForType(workOrderType, includeOptional).filter(
    (step) => step !== INTAKE_STEP,
  );
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

/**
 * Intentional short labels for space-constrained UIs (e.g. the shared planning
 * timeline segments). The full step name stays authoritative — these are only
 * for display. Consumers should keep the full name available via tooltip /
 * aria-label rather than relying on ellipsis truncation.
 */
export const PROCESS_STEP_SHORT_LABELS: Record<string, string> = {
  Intake: "INT",
  Disassembly: "DIS",
  Cleaning: "CLN",
  "Paint Stripping": "PST",
  "Penetrant Testing": "PT",
  "Magnetic Test": "MT",
  "Eddy Current": "ET",
  Inspection: "INSP",
  Painting: "PNT",
  Assembly: "ASS",
  "EASA-Form 1": "EASA Form 1",
};

export function getShortProcessStepLabel(step: string | null | undefined): string {
  if (!step) return "";
  if (step === "EASA Form 1") return "EASA Form 1";
  return PROCESS_STEP_SHORT_LABELS[step] || step;
}
