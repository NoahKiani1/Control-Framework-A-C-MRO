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
  unavailableEngineerNames: Set<string> = new Set(),
): string {
  const normalizedAssigned = normalizeAssignedPersonTeam(currentAssignedPersonTeam);
  const step = currentProcessStep?.trim();

  if (!step) return normalizedAssigned;

  if (normalizedAssigned === DEFAULT_ASSIGNED_PERSON_TEAM) {
    return normalizedAssigned;
  }

  const availableEngineers = engineers.filter(
    (engineer) => !unavailableEngineerNames.has(engineer.name),
  );

  const eligibleEngineers = availableEngineers.filter((engineer) =>
    canPerformStep(engineer.restrictions, step),
  );

  if (eligibleEngineers.length === 0) {
    return normalizedAssigned;
  }

  const assignedEngineer = engineers.find(
    (engineer) => engineer.name === normalizedAssigned,
  );
  const assignedEngineerUnavailable =
    assignedEngineer && unavailableEngineerNames.has(assignedEngineer.name);

  if (
    assignedEngineer &&
    !assignedEngineerUnavailable &&
    canPerformStep(assignedEngineer.restrictions, step)
  ) {
    return normalizedAssigned;
  }

  if (!assignedEngineer) {
    return normalizedAssigned;
  }

  return randomItem(eligibleEngineers)?.name || normalizedAssigned;
}
