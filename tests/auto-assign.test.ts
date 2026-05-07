import assert from "node:assert/strict";
import {
  applySuggestedAssignmentsForCurrentStep,
  autoAssignForStep,
  hasActiveRestrictionForStep,
  type AssignableEngineer,
} from "../lib/auto-assign";
import { DEFAULT_ASSIGNED_PERSON_TEAM } from "../lib/work-order-rules";

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

console.log("Auto-assign tests passed.");
