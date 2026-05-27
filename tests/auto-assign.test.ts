import assert from "node:assert/strict";
import {
  applySuggestedAssignmentsForCurrentStep,
  autoAssignForStep,
  hasActiveRestrictionForStep,
  type AssignableEngineer,
} from "../lib/auto-assign";
import {
  applyTodayQualificationBlocks,
  DEFAULT_ASSIGNED_PERSON_TEAM,
  NO_QUALIFIED_ENGINEER_REASON,
} from "../lib/work-order-rules";

const unrestrictedEngineers: AssignableEngineer[] = [
  { name: "Alex", restrictions: null },
  { name: "Bo", restrictions: [] },
];

const disassemblyRestrictedEngineers: AssignableEngineer[] = [
  { name: "Alex", restrictions: ["disassembly"] },
  { name: "Bo", restrictions: [] },
];

assert.equal(
  hasActiveRestrictionForStep("Disassembly", unrestrictedEngineers),
  false,
);
assert.equal(
  autoAssignForStep(
    DEFAULT_ASSIGNED_PERSON_TEAM,
    "Disassembly",
    unrestrictedEngineers,
  ),
  DEFAULT_ASSIGNED_PERSON_TEAM,
);

assert.equal(
  autoAssignForStep(
    "Alex",
    "Disassembly",
    unrestrictedEngineers,
    new Set(["Alex"]),
  ),
  "Bo",
);

assert.equal(
  hasActiveRestrictionForStep("Disassembly", disassemblyRestrictedEngineers),
  true,
);
assert.equal(
  autoAssignForStep(
    DEFAULT_ASSIGNED_PERSON_TEAM,
    "Disassembly",
    disassemblyRestrictedEngineers,
  ),
  "Bo",
);
assert.equal(
  autoAssignForStep("Alex", "Disassembly", disassemblyRestrictedEngineers),
  "Bo",
);
assert.equal(
  autoAssignForStep("Bo", "Disassembly", disassemblyRestrictedEngineers),
  "Bo",
);

const [unrestrictedSuggestion] = applySuggestedAssignmentsForCurrentStep(
  [
    {
      work_order_id: "WO-1",
      assigned_person_team: DEFAULT_ASSIGNED_PERSON_TEAM,
      current_process_step: "Cleaning",
    },
  ],
  disassemblyRestrictedEngineers,
);

assert.equal(
  unrestrictedSuggestion.assigned_person_team,
  DEFAULT_ASSIGNED_PERSON_TEAM,
);

const [restrictedSuggestion] = applySuggestedAssignmentsForCurrentStep(
  [
    {
      work_order_id: "WO-2",
      assigned_person_team: DEFAULT_ASSIGNED_PERSON_TEAM,
      current_process_step: "Disassembly",
    },
  ],
  disassemblyRestrictedEngineers,
);

assert.equal(restrictedSuggestion.assigned_person_team, "Bo");

const [manualRensWheelSuggestion] = applySuggestedAssignmentsForCurrentStep(
  [
    {
      work_order_id: "WO-3",
      work_order_type: "Wheel Overhaul",
      assigned_person_team: "Rens",
      current_process_step: "EASA-Form 1",
    },
  ],
  disassemblyRestrictedEngineers,
);

assert.equal(manualRensWheelSuggestion.assigned_person_team, "Rens");

const [manualRensNdtSuggestion] = applySuggestedAssignmentsForCurrentStep(
  [
    {
      work_order_id: "WO-4",
      work_order_type: "Wheel Overhaul",
      assigned_person_team: "Rens",
      current_process_step: "Magnetic Test",
    },
  ],
  [
    { name: "Alex", restrictions: ["magnetic_test"] },
    { name: "Bo", restrictions: [] },
  ],
);

assert.equal(manualRensNdtSuggestion.assigned_person_team, "Shop");

assert.equal(
  hasActiveRestrictionForStep("Magnetic Test", [
    { name: "Alex", restrictions: ["ndt"] },
    { name: "Bo", restrictions: [] },
  ]),
  true,
);

const fullNdtOrder = {
  work_order_id: "WO-NDT-1",
  work_order_type: "Wheel Overhaul",
  current_process_step: "Eddy Current",
  included_process_steps: [
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
  completed_ndt_steps: null,
  hold_reason: null,
  rfq_state: null,
  rfq_manual_approved_at: null,
};

const [openWhenAnyNdtStepIsPossible] = applyTodayQualificationBlocks(
  [fullNdtOrder],
  [
    {
      id: 1,
      restrictions: ["eddy_current", "magnetic_test"],
    },
  ],
  [],
  "2026-05-27",
);

assert.equal(openWhenAnyNdtStepIsPossible.hold_reason, null);

const [blockedWhenOnlyCompletedNdtStepIsPossible] = applyTodayQualificationBlocks(
  [
    {
      ...fullNdtOrder,
      completed_ndt_steps: ["Penetrant Testing"],
    },
  ],
  [
    {
      id: 1,
      restrictions: ["eddy_current", "magnetic_test"],
    },
  ],
  [],
  "2026-05-27",
);

assert.equal(
  blockedWhenOnlyCompletedNdtStepIsPossible.hold_reason,
  NO_QUALIFIED_ENGINEER_REASON,
);

console.log("Auto-assign tests passed.");
