export const PROCESS_STEPS: Record<string, string[]> = {
  "Wheel Repair": ["Intake", "Disassembly", "Cleaning", "Inspection", "Eddy Current", "Repair", "Assembly", "EASA-Form 1"],
  "Wheel Overhaul": ["Intake", "Disassembly", "Cleaning", "Paint Blasting", "Inspection", "Penetrant NDT Inspection", "Eddy Current", "Repair", "Painting", "Assembly", "EASA-Form 1"],
  "Brake Repair": ["Intake", "Disassembly", "Cleaning", "Inspection", "Eddy Current", "Repair", "Assembly", "EASA-Form 1"],
  "Brake Overhaul": ["Intake", "Disassembly", "Cleaning", "Paint Blasting", "Inspection", "Penetrant NDT Inspection", "Eddy Current", "Repair", "Painting", "Assembly", "EASA-Form 1"],
  Battery: ["Disassembly", "Cleaning", "Inspection", "Repair", "Assembly", "EASA-Form 1"],
};

export function getProcessStepsForType(workOrderType: string | null): string[] {
  if (!workOrderType) return [];
  return PROCESS_STEPS[workOrderType] || [];
}
