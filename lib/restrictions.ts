// Which restrictions block which process steps.
// An engineer with restriction "ndt" cannot perform steps listed under "ndt".
// An engineer with restriction "certification" cannot perform steps listed under "certification".
// If a step is not listed here, any engineer can perform it.

export const RESTRICTION_LABELS: Record<string, string> = {
  ndt: "Cannot do NDT",
  certification: "Cannot certify (EASA-Form 1)",
};

export const RESTRICTION_BLOCKED_STEPS: Record<string, string[]> = {
  ndt: ["Eddy Current", "Penetrant Testing", "Magnetic Test"],
  certification: ["EASA-Form 1"],
};

/**
 * Given a process step, return which restriction (if any) is required to be
 * absent for an engineer to perform it.  Returns null if no restriction applies.
 */
export function getRestrictionForStep(step: string): string | null {
  for (const [restriction, steps] of Object.entries(RESTRICTION_BLOCKED_STEPS)) {
    if (steps.includes(step)) return restriction;
  }
  return null;
}

/**
 * Check whether an engineer (given their restrictions array) can perform a step.
 */
export function canPerformStep(
  restrictions: string[] | null | undefined,
  step: string,
): boolean {
  if (!restrictions || restrictions.length === 0) return true;
  const needed = getRestrictionForStep(step);
  if (!needed) return true;
  return !restrictions.includes(needed);
}
