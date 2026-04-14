export const OPTIONAL_PROCESS_STEPS = ["Magnetic Test (if applicable)"];
export const FINAL_PROCESS_STEP = "EASA-Form 1";

export const PROCESS_STEPS: Record<string, string[]> = {
  "Wheel Repair": [
    "Intake",
    "Disassembly",
    "Cleaning",
    "Magnetic Test (if applicable)",
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
    "Magnetic Test (if applicable)",
    "Penetrant NDT Inspection",
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
    "Magnetic Test (if applicable)",
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
    "Magnetic Test (if applicable)",
    "Penetrant NDT Inspection",
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

export function getProcessStepsForType(workOrderType: string | null): string[] {
  if (!workOrderType) return [];
  return PROCESS_STEPS[workOrderType] || [];
}

export function isOptionalProcessStep(step: string | null): boolean {
  if (!step) return false;
  return OPTIONAL_PROCESS_STEPS.includes(step);
}

export function getCompletableStepsForType(
  workOrderType: string | null,
): string[] {
  return getProcessStepsForType(workOrderType).filter(
    (step) => !isOptionalProcessStep(step) && step !== FINAL_PROCESS_STEP,
  );
}

export function getNextProcessStepAfterCompleted(
  workOrderType: string | null,
  completedStep: string | null,
): string | null {
  if (!workOrderType || !completedStep) return null;

  const steps = getProcessStepsForType(workOrderType);
  const completedIndex = steps.indexOf(completedStep);

  if (completedIndex === -1) return null;

  for (let i = completedIndex + 1; i < steps.length; i++) {
    const nextStep = steps[i];

    if (!isOptionalProcessStep(nextStep)) {
      return nextStep;
    }
  }

  return FINAL_PROCESS_STEP;
}

export function getCompletedStepSelectionForCurrent(
  workOrderType: string | null,
  currentProcessStep: string | null,
): string {
  if (!workOrderType || !currentProcessStep) return "";

  const completableSteps = getCompletableStepsForType(workOrderType);
  if (completableSteps.includes(currentProcessStep)) {
    return currentProcessStep;
  }

  const steps = getProcessStepsForType(workOrderType);
  const currentIndex = steps.indexOf(currentProcessStep);

  if (currentIndex === -1) return "";

  for (let i = currentIndex - 1; i >= 0; i--) {
    const previousStep = steps[i];
    if (
      !isOptionalProcessStep(previousStep) &&
      previousStep !== FINAL_PROCESS_STEP
    ) {
      return previousStep;
    }
  }

  return "";
}