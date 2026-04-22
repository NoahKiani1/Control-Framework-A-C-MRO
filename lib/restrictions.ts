import { PROCESS_STEPS } from "@/lib/process-steps";

type RestrictionDefinition = {
  key: string;
  label: string;
  blockedSteps: string[];
};

function slugifyStep(step: string): string {
  return step
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function displayStepName(step: string): string {
  if (step === "EASA-Form 1") return "EASA Form 1";
  return step;
}

function uniqueProcessSteps(): string[] {
  return [...new Set(Object.values(PROCESS_STEPS).flat())];
}

export function getRestrictionKeyForStep(step: string): string {
  return slugifyStep(step);
}

const STEP_BASED_RESTRICTIONS: RestrictionDefinition[] = uniqueProcessSteps().map(
  (step) => ({
    key: getRestrictionKeyForStep(step),
    label: `Cannot perform ${displayStepName(step)}`,
    blockedSteps: [step],
  }),
);

const LEGACY_RESTRICTION_EXPANSIONS: Record<string, string[]> = {
  ndt: [
    getRestrictionKeyForStep("Magnetic Test"),
    getRestrictionKeyForStep("Penetrant Testing"),
    getRestrictionKeyForStep("Eddy Current"),
  ],
  certification: [getRestrictionKeyForStep("EASA-Form 1")],
};

const RESTRICTION_DEFINITION_MAP = new Map(
  STEP_BASED_RESTRICTIONS.map((restriction) => [restriction.key, restriction]),
);

export const RESTRICTION_OPTIONS = STEP_BASED_RESTRICTIONS;

export const RESTRICTION_LABELS: Record<string, string> = Object.fromEntries(
  RESTRICTION_OPTIONS.map((restriction) => [restriction.key, restriction.label]),
);

export const RESTRICTION_BLOCKED_STEPS: Record<string, string[]> = Object.fromEntries(
  RESTRICTION_OPTIONS.map((restriction) => [
    restriction.key,
    restriction.blockedSteps,
  ]),
);

export function normalizeRestrictionList(
  restrictions: string[] | null | undefined,
): string[] {
  if (!restrictions || restrictions.length === 0) return [];

  const normalized: string[] = [];

  for (const restriction of restrictions) {
    const key = restriction.trim();
    const expanded = LEGACY_RESTRICTION_EXPANSIONS[key];

    if (expanded) {
      normalized.push(...expanded);
      continue;
    }

    normalized.push(key);
  }

  return [...new Set(normalized)];
}

export function hasRestriction(
  restrictions: string[] | null | undefined,
  restriction: string,
): boolean {
  return normalizeRestrictionList(restrictions).includes(restriction);
}

export function getRestrictionLabel(restriction: string): string {
  return RESTRICTION_LABELS[restriction] || restriction;
}

export function getRestrictionLabels(
  restrictions: string[] | null | undefined,
): string[] {
  const normalized = normalizeRestrictionList(restrictions);
  const known = RESTRICTION_OPTIONS
    .filter((restriction) => normalized.includes(restriction.key))
    .map((restriction) => restriction.label);
  const unknown = normalized
    .filter((restriction) => !RESTRICTION_DEFINITION_MAP.has(restriction))
    .sort((left, right) => left.localeCompare(right))
    .map(getRestrictionLabel);

  return [...known, ...unknown];
}

/**
 * Given a process step, return which restriction (if any) is required to be
 * absent for an engineer to perform it. Returns null if no restriction applies.
 */
export function getRestrictionForStep(step: string): string | null {
  const restriction = RESTRICTION_DEFINITION_MAP.get(getRestrictionKeyForStep(step));
  return restriction ? restriction.key : null;
}

/**
 * Check whether an engineer (given their restrictions array) can perform a step.
 */
export function canPerformStep(
  restrictions: string[] | null | undefined,
  step: string,
): boolean {
  const needed = getRestrictionForStep(step);
  if (!needed) return true;
  return !hasRestriction(restrictions, needed);
}
