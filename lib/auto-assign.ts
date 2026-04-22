import { DEFAULT_ASSIGNED_PERSON_TEAM, normalizeAssignedPersonTeam } from "@/lib/work-order-rules";
import { canPerformStep, getRestrictionForStep } from "@/lib/restrictions";

export type AssignableEngineer = {
  name: string;
  restrictions: string[] | null;
};

export type CurrentStepAssignableOrder = {
  work_order_id: string;
  assigned_person_team?: string | null;
  current_process_step: string | null;
};

function randomItem<T>(items: T[]): T | null {
  if (items.length === 0) return null;
  return items[Math.floor(Math.random() * items.length)];
}

function hashSeed(value: string): number {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }

  return hash;
}

function deterministicItem<T>(items: T[], seed: string): T | null {
  if (items.length === 0) return null;
  return items[hashSeed(seed) % items.length];
}

function getAvailableEngineers(
  engineers: AssignableEngineer[],
  unavailableEngineerNames: Set<string>,
): AssignableEngineer[] {
  return engineers.filter(
    (engineer) => !unavailableEngineerNames.has(engineer.name),
  );
}

function getEligibleEngineersForStep(
  step: string,
  engineers: AssignableEngineer[],
  unavailableEngineerNames: Set<string>,
): AssignableEngineer[] {
  return getAvailableEngineers(engineers, unavailableEngineerNames)
    .filter((engineer) => canPerformStep(engineer.restrictions, step))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function resolveAssignedEngineer(
  normalizedAssigned: string,
  engineers: AssignableEngineer[],
): AssignableEngineer | null {
  return (
    engineers.find((engineer) => engineer.name === normalizedAssigned) || null
  );
}

function resolveAutoAssignedName(
  currentAssignedPersonTeam: string | null | undefined,
  currentProcessStep: string | null | undefined,
  engineers: AssignableEngineer[],
  unavailableEngineerNames: Set<string>,
  picker: (eligible: AssignableEngineer[]) => AssignableEngineer | null,
): string {
  const normalizedAssigned = normalizeAssignedPersonTeam(currentAssignedPersonTeam);
  const step = currentProcessStep?.trim();

  if (!step) return normalizedAssigned;
  if (!getRestrictionForStep(step)) return normalizedAssigned;

  const eligibleEngineers = getEligibleEngineersForStep(
    step,
    engineers,
    unavailableEngineerNames,
  );

  if (eligibleEngineers.length === 0) {
    return normalizedAssigned;
  }

  if (normalizedAssigned === DEFAULT_ASSIGNED_PERSON_TEAM) {
    return picker(eligibleEngineers)?.name || normalizedAssigned;
  }

  const assignedEngineer = resolveAssignedEngineer(normalizedAssigned, engineers);
  const assignedEngineerUnavailable =
    assignedEngineer !== null &&
    unavailableEngineerNames.has(assignedEngineer.name);

  if (
    assignedEngineer &&
    !assignedEngineerUnavailable &&
    canPerformStep(assignedEngineer.restrictions, step)
  ) {
    return normalizedAssigned;
  }

  return picker(eligibleEngineers)?.name || normalizedAssigned;
}

export function autoAssignForStep(
  currentAssignedPersonTeam: string | null | undefined,
  currentProcessStep: string | null | undefined,
  engineers: AssignableEngineer[],
  unavailableEngineerNames: Set<string> = new Set(),
): string {
  return resolveAutoAssignedName(
    currentAssignedPersonTeam,
    currentProcessStep,
    engineers,
    unavailableEngineerNames,
    randomItem,
  );
}

export function applySuggestedAssignmentsForCurrentStep<
  T extends CurrentStepAssignableOrder,
>(
  orders: T[],
  engineers: AssignableEngineer[],
  unavailableEngineerNames: Set<string> = new Set(),
): T[] {
  return orders.map((order) => {
    const suggestedAssignment = resolveAutoAssignedName(
      order.assigned_person_team,
      order.current_process_step,
      engineers,
      unavailableEngineerNames,
      (eligible) => deterministicItem(
        eligible,
        `${order.work_order_id}:${order.current_process_step || ""}`,
      ),
    );

    return suggestedAssignment === order.assigned_person_team
      ? order
      : {
          ...order,
          assigned_person_team: suggestedAssignment,
        };
  });
}
