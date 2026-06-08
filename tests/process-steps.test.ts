import assert from "node:assert/strict";
import {
  addRepairAfterInspectionForOrder,
  canAddRepairAfterInspectionForOrder,
  getActualCompletedStepsForGroupedCompletion,
  getCompletedNdtChecklistForOrder,
  getDefaultCompletedStepForOrder,
  getGroupedCompletableStepsForOrder,
  getGroupedProcessStepsForOrder,
  getNextProcessStepAfterNdtChecklistForOrder,
  getNextProcessStepAfterCompletedForOrder,
  getNextProcessStepAfterGroupedCompletedForOrder,
  getOfficeConfigurableProcessStepsForType,
  getProcessStepDisplayName,
  NDT_PROCESS_STEP,
  resolveStepsForOrder,
} from "../lib/process-steps";
import {
  ABSOLUTE_STEP_HOURS,
  getExpectedHoursForStep,
  getRemainingHours,
} from "../lib/capacity";
import {
  RFQ_AWAITING_APPROVAL_REASON,
  RFQ_MUST_BE_SENT_REASON,
  buildCloseRfqActionPayload,
  buildImportedRfqActionClosePayload,
  getImportedRfqManualApprovedAt,
  getLastIncludedRfqInspectionStep,
  shouldRequestRfqAfterCompletedStep,
} from "../lib/rfq-workflow";
import { isBlocked, rfqDisplay } from "../lib/work-order-rules";

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
    "Eddy Current",
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
    "Eddy Current",
  );
  assert.equal(
    getNextProcessStepAfterCompletedForOrder(
      "Wheel Repair",
      "Eddy Current",
      withRepair,
    ),
    "Repair",
  );
  assert.equal(
    shouldRequestRfqAfterCompletedStep({
      workOrderType: "Wheel Repair",
      includedSteps: withRepair,
      completedStep: "Inspection",
      rfqState: null,
    }),
    false,
  );
  assert.equal(
    shouldRequestRfqAfterCompletedStep({
      workOrderType: "Wheel Repair",
      includedSteps: withRepair,
      completedStep: "Eddy Current",
      rfqState: null,
    }),
    true,
  );

  const wheelRepairWithoutNdt = [
    "Intake",
    "Disassembly",
    "Cleaning",
    "Inspection",
    "Assembly",
    "EASA-Form 1",
  ];
  const withRepairWithoutNdt = addRepairAfterInspectionForOrder(
    "Wheel Repair",
    wheelRepairWithoutNdt,
  );
  assert.deepEqual(withRepairWithoutNdt, [
    "Intake",
    "Disassembly",
    "Cleaning",
    "Inspection",
    "Repair",
    "Assembly",
    "EASA-Form 1",
  ]);
  assert.equal(
    shouldRequestRfqAfterCompletedStep({
      workOrderType: "Wheel Repair",
      includedSteps: withRepairWithoutNdt,
      completedStep: "Inspection",
      rfqState: null,
    }),
    true,
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
  assert.deepEqual(
    resolveStepsForOrder("Wheel Overhaul", [
      "Intake",
      "Disassembly",
      "Paint Stripping",
      "Inspection",
      "Eddy Current",
      "Penetrant Testing",
      "Magnetic Test",
      "Painting",
      "Repair",
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
      "Repair",
      "Painting",
      "Assembly",
      "EASA-Form 1",
    ],
  );
  assert.equal(ABSOLUTE_STEP_HOURS.Repair, 1.5);
  assert.equal(getExpectedHoursForStep("Wheel Repair", "Repair", "PN-1"), 1.5);
  assert.equal(
    getRemainingHours("Wheel Repair", "Repair", "PN-1", withRepair),
    3.3,
  );

  const fullWheelOverhaulSteps = [
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
  ];
  assert.deepEqual(
    addRepairAfterInspectionForOrder("Wheel Overhaul", fullWheelOverhaulSteps),
    [
      "Intake",
      "Disassembly",
      "Paint Stripping",
      "Inspection",
      "Eddy Current",
      "Penetrant Testing",
      "Magnetic Test",
      "Repair",
      "Painting",
      "Assembly",
      "EASA-Form 1",
    ],
  );
  const wheelOverhaulWithRepair = addRepairAfterInspectionForOrder(
    "Wheel Overhaul",
    fullWheelOverhaulSteps,
  );
  assert.deepEqual(
    getGroupedProcessStepsForOrder(
      "Wheel Overhaul",
      wheelOverhaulWithRepair,
    ).map((group) => group.name),
    [
      "Intake",
      "Disassembly",
      "Paint Stripping",
      "Inspection",
      NDT_PROCESS_STEP,
      "Repair",
      "Painting",
      "Assembly",
      "EASA-Form 1",
    ],
  );
  assert.equal(
    getNextProcessStepAfterGroupedCompletedForOrder(
      "Wheel Overhaul",
      NDT_PROCESS_STEP,
      wheelOverhaulWithRepair,
    ),
    "Repair",
  );
  assert.deepEqual(
    getGroupedProcessStepsForOrder("Wheel Overhaul", fullWheelOverhaulSteps).map(
      (group) => group.name,
    ),
    [
      "Intake",
      "Disassembly",
      "Paint Stripping",
      "Inspection",
      NDT_PROCESS_STEP,
      "Painting",
      "Assembly",
      "EASA-Form 1",
    ],
  );
  assert.deepEqual(
    getGroupedCompletableStepsForOrder("Wheel Overhaul", fullWheelOverhaulSteps),
    [
      "Disassembly",
      "Paint Stripping",
      "Inspection",
      NDT_PROCESS_STEP,
      "Painting",
      "Assembly",
      "EASA-Form 1",
    ],
  );
  assert.equal(getProcessStepDisplayName("Eddy Current"), NDT_PROCESS_STEP);
  assert.deepEqual(
    getActualCompletedStepsForGroupedCompletion(
      "Wheel Overhaul",
      NDT_PROCESS_STEP,
      fullWheelOverhaulSteps,
      "Eddy Current",
    ),
    ["Eddy Current", "Penetrant Testing", "Magnetic Test"],
  );
  assert.deepEqual(
    getActualCompletedStepsForGroupedCompletion(
      "Wheel Overhaul",
      NDT_PROCESS_STEP,
      fullWheelOverhaulSteps,
      "Penetrant Testing",
    ),
    ["Penetrant Testing", "Magnetic Test"],
  );
  assert.deepEqual(
    getCompletedNdtChecklistForOrder(
      "Wheel Overhaul",
      fullWheelOverhaulSteps,
      "Penetrant Testing",
      null,
    ),
    ["Eddy Current"],
  );
  assert.deepEqual(
    getCompletedNdtChecklistForOrder(
      "Wheel Overhaul",
      fullWheelOverhaulSteps,
      "Eddy Current",
      ["Magnetic Test"],
    ),
    ["Magnetic Test"],
  );
  assert.equal(
    getNextProcessStepAfterNdtChecklistForOrder(
      "Wheel Overhaul",
      fullWheelOverhaulSteps,
      ["Eddy Current"],
    ),
    "Penetrant Testing",
  );
  assert.equal(
    getNextProcessStepAfterNdtChecklistForOrder(
      "Wheel Overhaul",
      fullWheelOverhaulSteps,
      ["Magnetic Test"],
    ),
    "Eddy Current",
  );
  assert.equal(
    getNextProcessStepAfterGroupedCompletedForOrder(
      "Wheel Overhaul",
      NDT_PROCESS_STEP,
      fullWheelOverhaulSteps,
    ),
    "Painting",
  );
  assert.equal(
    getLastIncludedRfqInspectionStep("Wheel Overhaul", fullWheelOverhaulSteps),
    "Magnetic Test",
  );
  assert.equal(
    getLastIncludedRfqInspectionStep(
      "Wheel Overhaul",
      fullWheelOverhaulSteps.filter((step) => step !== "Magnetic Test"),
    ),
    "Penetrant Testing",
  );
  assert.equal(
    getLastIncludedRfqInspectionStep(
      "Wheel Overhaul",
      fullWheelOverhaulSteps.filter(
        (step) => step !== "Magnetic Test" && step !== "Penetrant Testing",
      ),
    ),
    "Eddy Current",
  );
  assert.equal(
    shouldRequestRfqAfterCompletedStep({
      workOrderType: "Wheel Overhaul",
      includedSteps: fullWheelOverhaulSteps,
      completedStep: "Magnetic Test",
      rfqState: null,
    }),
    true,
  );
  assert.equal(
    shouldRequestRfqAfterCompletedStep({
      workOrderType: "Wheel Overhaul",
      includedSteps: fullWheelOverhaulSteps,
      completedStep: "Penetrant Testing",
      rfqState: null,
    }),
    false,
  );
  assert.equal(
    shouldRequestRfqAfterCompletedStep({
      workOrderType: "Wheel Overhaul",
      includedSteps: fullWheelOverhaulSteps,
      completedStep: "Magnetic Test",
      rfqState: "RFQ Send - Continue",
    }),
    false,
  );

  assert.deepEqual(
    buildImportedRfqActionClosePayload(
      {
        required_next_action: RFQ_MUST_BE_SENT_REASON,
        action_status: "Open",
        action_closed: false,
      },
      "RFQ Send",
      "2026-05-11T10:00:00.000Z",
    ),
    {
      action_status: "Done",
      action_closed: true,
      action_closed_at: "2026-05-11T10:00:00.000Z",
      hold_reason: RFQ_AWAITING_APPROVAL_REASON,
      rfq_manual_approved_at: null,
      required_next_action: null,
      action_owner: null,
      action_created_at: null,
      last_system_update: "2026-05-11T10:00:00.000Z",
    },
  );

  assert.equal(
    isBlocked({ rfq_state: "RFQ Send", rfq_manual_approved_at: null }),
    true,
  );
  assert.equal(
    isBlocked({
      rfq_state: "RFQ Send",
      rfq_manual_approved_at: "2026-05-11T10:00:00.000Z",
    }),
    false,
  );
  assert.equal(
    isBlocked({
      rfq_state: "RFQ Rejected",
      rfq_manual_approved_at: "2026-05-11T10:00:00.000Z",
    }),
    true,
  );
  assert.deepEqual(
    rfqDisplay("RFQ Send", "2026-05-11T10:00:00.000Z"),
    { label: "Manual approved", color: "#16a34a" },
  );
  assert.deepEqual(
    buildCloseRfqActionPayload({
      mode: "continue",
      timestamp: "2026-05-11T10:00:00.000Z",
      updateSource: "manual",
    }),
    {
      action_status: "Done",
      action_closed: true,
      action_closed_at: "2026-05-11T10:00:00.000Z",
      hold_reason: null,
      rfq_manual_approved_at: "2026-05-11T10:00:00.000Z",
      required_next_action: null,
      action_owner: null,
      action_created_at: null,
      last_manual_update: "2026-05-11T10:00:00.000Z",
    },
  );
  assert.deepEqual(
    buildCloseRfqActionPayload({
      mode: "continue",
      timestamp: "2026-05-11T10:00:00.000Z",
      updateSource: "system",
    }),
    {
      action_status: "Done",
      action_closed: true,
      action_closed_at: "2026-05-11T10:00:00.000Z",
      hold_reason: null,
      rfq_manual_approved_at: null,
      required_next_action: null,
      action_owner: null,
      action_created_at: null,
      last_system_update: "2026-05-11T10:00:00.000Z",
    },
  );
  assert.equal(
    getImportedRfqManualApprovedAt(
      "2026-05-11T10:00:00.000Z",
      "RFQ Send",
    ),
    "2026-05-11T10:00:00.000Z",
  );
  assert.equal(
    getImportedRfqManualApprovedAt(
      "2026-05-11T10:00:00.000Z",
      "RFQ Send - Continue",
    ),
    null,
  );
}

main();
// noah was hier
