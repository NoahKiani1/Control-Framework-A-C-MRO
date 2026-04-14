export const PROCESS_STEPS: Record<string, string[]> = {
  // "Repair" stap verwijderd: valt samen met Assembly
  // "Magnetic Test" toegevoegd na Cleaning/Paint Stripping (optionele stap, weight = 0)
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
  // Battery ongewijzigd
  Battery: ["Disassembly", "Cleaning", "Inspection", "Assembly", "EASA-Form 1"],
};

export function getProcessStepsForType(workOrderType: string | null): string[] {
  if (!workOrderType) return [];
  return PROCESS_STEPS[workOrderType] || [];
}