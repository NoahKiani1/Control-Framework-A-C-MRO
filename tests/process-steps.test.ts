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
    "Inspection",
    "Eddy Current",
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
    "Inspection",
    "Repair",
    "Eddy Current",
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
  assert.deepEqual(
    resolveStepsForOrder("Wheel Overhaul", [
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
    ]),
    [
      "Intake",
      "Disassembly",
      "Paint Stripping",
      "Inspection",
      "Eddy Current",
      "Penetrant Testing",
      "Magnetic Test",
      "Painting",
      "Assembly",
      "EASA-Form 1",
    ],
  );
  assert.equal(ABSOLUTE_STEP_HOURS.Repair, 1.5);
  assert.equal(getExpectedHoursForStep("Wheel Repair", "Repair", "PN-1"), 1.5);
  assert.equal(
    getRemainingHours("Wheel Repair", "Repair", "PN-1", withRepair),
    4.5,
  );
}

main();
