export function clamp(n, min = 0, max = 30) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.max(min, Math.min(max, x));
}

/**
 * Internal-1 = Mid-1 + Assignment, Internal-2 = Mid-2 + Lab/Assignment-2
 * final = best * 0.8 + other * 0.2
 */
export function computeMarksPayload({ mid1, mid2, assignment, lab }) {
  const m1 = clamp(mid1, 0, 20);
  const m2 = clamp(mid2, 0, 20);
  const a = clamp(assignment, 0, 5);
  const l = clamp(lab, 0, 5);
  const internal1 = m1 + a;
  const internal2 = m2 + l;
  const best = Math.max(internal1, internal2);
  const other = best === internal1 ? internal2 : internal1;
  const final = Math.round((best * 0.8 + other * 0.2) * 10) / 10;
  const bestKey = best === internal1 ? "internal1" : "internal2";
  return { mid1: m1, mid2: m2, assignment: a, lab: l, internal1, internal2, final, bestKey };
}

/** Relative spike between two internals (same rule as product spec) */
export function detectInternalAnomaly(internal1, internal2) {
  const best = Math.max(internal1, internal2);
  const other = best === internal1 ? internal2 : internal1;
  const base = Math.max(1, other);
  const jumpPct = (best - other) / base;
  return jumpPct > 0.3 && best - other >= 10;
}

/** Detect spike vs previous final (e.g. >30% jump) */
export function detectFinalSpike(priorFinal, newFinal) {
  if (priorFinal == null || !Number.isFinite(priorFinal)) return false;
  const base = Math.max(1, priorFinal);
  const jump = (newFinal - priorFinal) / base;
  return jump > 0.3 && newFinal - priorFinal >= 8;
}

/** For analytics / pass-fail style checks (settings `riskThreshold`), not for the marks `atRisk` boolean. */
export function computeAtRisk(final, threshold) {
  return final < Number(threshold ?? 16);
}

/** Policy: any internal below this value requires remedial support. */
export const INTERNAL_REMEDIAL_THRESHOLD = 9;

/** Policy: final below this value is a fail condition and requires remedial support. */
export const FINAL_FAIL_THRESHOLD = 16;

/**
 * True when any entered internal is below {@link INTERNAL_REMEDIAL_THRESHOLD}.
 * Blank 0/0 rows are ignored to avoid treating untouched records as at-risk.
 */
export function computeInternalAtRisk(internal1, internal2) {
  const i1 = Number(internal1) || 0;
  const i2 = Number(internal2) || 0;
  if (i1 === 0 && i2 === 0) return false;
  return (i1 > 0 && i1 < INTERNAL_REMEDIAL_THRESHOLD) || (i2 > 0 && i2 < INTERNAL_REMEDIAL_THRESHOLD);
}

/**
 * Marks collection `atRisk` flag: final below fail threshold OR any internal below remedial threshold.
 * Settings `riskThreshold` (e.g. 40) is not used here; it is for analytics / insights only.
 */
export function computeCombinedAtRisk(final, _riskThresholdUnused, internal1, internal2) {
  const f = Number(final);
  const finalLow = Number.isFinite(f) && f < FINAL_FAIL_THRESHOLD;
  return finalLow || computeInternalAtRisk(internal1, internal2);
}
