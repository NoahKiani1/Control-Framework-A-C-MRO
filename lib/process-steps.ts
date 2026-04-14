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
 * Optional steps (e.g. Magnetic Test) are skipped by default but can be
 * included per work order via the `includeOptional` flag.
 */

/** Steps that are skipped unless explicitly included per work order. */
export const OPTIONAL_PROCESS_STEPS = ["Magnetic Test"];

/** The last tracked step in every flow. */
export const FINAL_PROCESS_STEP = "EASA-Form 1";

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
    "Cleaning",
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
    "Cleaning",
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

/** Whether a step is optional (skipped unless override is set). */
export function isOptionalProcessStep(step: string | null): boolean {
  if (!step) return false;
  return OPTIONAL_PROCESS_STEPS.includes(step);
}

/** Whether a work-order type contains any optional steps. */
export function hasOptionalSteps(workOrderType: string | null): boolean {
  return getProcessStepsForType(workOrderType).some(isOptionalProcessStep);
}

// ---------------------------------------------------------------------------
// Step filtering
// ---------------------------------------------------------------------------

/**
 * Active steps for the current configuration.
 * When `includeOptional` is false (default) optional steps are excluded.
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

/**
 * Steps the shop engineer can select as "completed" in the shop-update form.
 * Excludes Intake (set automatically) and optional steps (unless overridden).
 */
export function getCompletableStepsForType(
  workOrderType: string | null,
  includeOptional = false,
): string[] {
  return getActiveStepsForType(workOrderType, includeOptional).filter(
    (step) => step !== INTAKE_STEP,
  );
}

// ---------------------------------------------------------------------------
// Progression
// ---------------------------------------------------------------------------

/**
 * Given a completed step, return the value that `current_process_step` should
 * be set to. Optional steps are skipped unless `includeOptional` is true.
 *
 * Returns `null` when the completed step is the final step (EASA-Form 1),
 * meaning there are no more steps remaining.
 */
export function getNextProcessStepAfterCompleted(
  workOrderType: string | null,
  completedStep: string | null,
  includeOptional = false,
): string | null {
  if (!workOrderType || !completedStep) return null;

  const steps = getProcessStepsForType(workOrderType);
  const completedIndex = steps.indexOf(completedStep);

  if (completedIndex === -1) return null;

  // Walk forward, skipping optional steps when not included
  for (let i = completedIndex + 1; i < steps.length; i++) {
    if (includeOptional || !isOptionalProcessStep(steps[i])) {
      return steps[i];
    }
  }

  // Completed step was the last step — nothing left
  return null;
}

/**
 * Given the current `current_process_step`, return the step that was most
 * recently completed (i.e. the active step directly before the current one).
 *
 * Used to pre-select the "completed step" dropdown so the engineer sees where
 * the order currently stands.
 *
 * Returns "" when the order is at the first step (nothing completed yet).
 */
export function getLastCompletedStep(
  workOrderType: string | null,
  currentProcessStep: string | null,
  includeOptional = false,
): string {
  if (!workOrderType || !currentProcessStep) return "";

  const completable = getCompletableStepsForType(workOrderType, includeOptional);
  const currentIndex = completable.indexOf(currentProcessStep);

  // Current step is the first completable step or not found — nothing completed yet
  if (currentIndex <= 0) return "";

  return completable[currentIndex - 1];
}
