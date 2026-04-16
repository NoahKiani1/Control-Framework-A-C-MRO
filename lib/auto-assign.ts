import { DEFAULT_ASSIGNED_PERSON_TEAM, normalizeAssignedPersonTeam } from "@/lib/work-order-rules";
import { canPerformStep } from "@/lib/restrictions";

export type AssignableEngineer = {
  name: string;
  restrictions: string[] | null;
};

function randomItem<T>(items: T[]): T | null {
  if (items.length === 0) return null;
  return items[Math.floor(Math.random() * items.length)];
}

export function autoAssignForStep(
  currentAssignedPersonTeam: string | null | undefined,
  currentProcessStep: string | null | undefined,
  engineers: AssignableEngineer[],
): string {
  const normalizedAssigned = normalizeAssignedPersonTeam(currentAssignedPersonTeam);
  const step = currentProcessStep?.trim();

  if (!step) return normalizedAssigned;

  const eligibleEngineers = engineers.filter((engineer) =>
    canPerformStep(engineer.restrictions, step),
  );

  if (eligibleEngineers.length === 0) return normalizedAssigned;

  const assignedEngineer = engineers.find(
    (engineer) => engineer.name === normalizedAssigned,
  );

  if (
    assignedEngineer &&
    canPerformStep(assignedEngineer.restrictions, step)
  ) {
    return normalizedAssigned;
  }

  if (normalizedAssigned !== DEFAULT_ASSIGNED_PERSON_TEAM && !assignedEngineer) {
    return normalizedAssigned;
  }

  return randomItem(eligibleEngineers)?.name || normalizedAssigned;
}