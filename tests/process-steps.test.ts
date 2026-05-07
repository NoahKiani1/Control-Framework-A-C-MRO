import assert from "node:assert/strict";
import {
  addRepairAfterInspectionForOrder,
  canAddRepairAfterInspectionForOrder,
  getDefaultCompletedStepForOrder,
  getNextProcessStepAfterCompletedForOrder,
  getOfficeConfigurableProcessStepsForType,
  resolveStepsForOrder,
} from "../lib/process-steps";
import {
  ABSOLUTE_STEP_HOURS,
  getExpectedHoursForStep,
  getRemainingHours,
} from "../lib/capacity";

function main() {
  const standardWheelRepair = resolveStepsForOrder("Wheel Repair", null);
  assert.deepEqual(standardWheelRepair, [
    "Intake",
    "Disassembly",
    "Cleaning",
    "Eddy Current",
    "Inspection",
    "Assembly",
    "EASA-Form 1",
  ]);

  assert.equal(
    getOfficeConfigurableProcessStepsForType("Wheel Repair").includes("Repair"),
    false,
  );

  assert.equal(
    canAddRepairAfterInspectionForOrder(
      "Wheel Repair",
      "Inspection",
      standardWheelRepair,
    ),
    true,
  );
  assert.equal(
    getDefaultCompletedStepForOrder(
      "Wheel Repair",
      "Inspection",
      standardWheelRepair,
    ),
    "Inspection",
  );

  const withRepair = addRepairAfterInspectionForOrder(
    "Wheel Repair",
    standardWheelRepair,
  );
  assert.deepEqual(withRepair, [
    "Intake",
    "Disassembly",
    "Cleaning",
    "Eddy Current",
    "Inspection",
    "Repair",
    "Assembly",
    "EASA-Form 1",
  ]);

  assert.equal(
    getNextProcessStepAfterCompletedForOrder(
      "Wheel Repair",
      "Inspection",
      withRepair,
    ),
    "Repair",
  );
  assert.equal(ABSOLUTE_STEP_HOURS.Repair, 1.5);
  assert.equal(getExpectedHoursForStep("Wheel Repair", "Repair", "PN-1"), 1.5);
  assert.equal(
    getRemainingHours("Wheel Repair", "Repair", "PN-1", withRepair),
    3.3,
  );
}

main();
