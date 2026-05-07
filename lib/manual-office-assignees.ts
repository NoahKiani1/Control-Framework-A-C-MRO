export const RENS_OFFICE_ASSIGNEE_NAME = "Rens";

const RENS_WORK_ORDER_TYPES = new Set(["Wheel Repair", "Wheel Overhaul"]);
const RENS_EXCLUDED_STEPS = new Set([
  "Magnetic Test",
  "Penetrant Testing",
  "Eddy Current",
  "MT",
  "PT",
  "ET",
]);

type StaffLike = {
  name: string;
  role?: string | null;
};

type RensAssignableWorkOrder = {
  work_order_type?: string | null;
  current_process_step?: string | null;
};

function normalizeName(value: string | null | undefined): string {
  return (value || "").trim().toLowerCase();
}

export function isRensOfficeAssigneeName(
  value: string | null | undefined,
): boolean {
  return normalizeName(value) === normalizeName(RENS_OFFICE_ASSIGNEE_NAME);
}

export function isRensOfficeStaff<T extends StaffLike>(staffMember: T): boolean {
  return (
    isRensOfficeAssigneeName(staffMember.name) &&
    (!("role" in staffMember) || staffMember.role === "office")
  );
}

export function getRensOfficeStaff<T extends StaffLike>(
  staff: T[],
): T[] {
  return staff.filter(isRensOfficeStaff);
}

export function isRensAssignableWorkOrderType(
  workOrderType: string | null | undefined,
): boolean {
  return RENS_WORK_ORDER_TYPES.has((workOrderType || "").trim());
}

export function isRensExcludedStep(
  step: string | null | undefined,
): boolean {
  return RENS_EXCLUDED_STEPS.has((step || "").trim());
}

export function canAssignRensToWorkOrder(
  order: RensAssignableWorkOrder,
): boolean {
  return (
    isRensAssignableWorkOrderType(order.work_order_type) &&
    !isRensExcludedStep(order.current_process_step)
  );
}

export function canUseRensOfficeAssignment(
  assignedPersonTeam: string | null | undefined,
  order: RensAssignableWorkOrder,
): boolean {
  return (
    isRensOfficeAssigneeName(assignedPersonTeam) &&
    canAssignRensToWorkOrder(order)
  );
}

export function getRensAssignmentUnavailableMessage(): string {
  return "Rens can only be assigned manually to Wheel Repair or Wheel Overhaul tasks, excluding MT, PT, and ET.";
}
