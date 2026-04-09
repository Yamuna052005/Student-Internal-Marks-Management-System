export function clamp(n, min = 0, max = 100) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.max(min, Math.min(max, x));
}

/**
 * Internal-1 = Mid-1 + Assignment, Internal-2 = Mid-2 + Lab
 * final = best * 0.8 + other * 0.2
 */
export function computeMarksPayload({ mid1, mid2, assignment, lab }) {
  const m1 = clamp(mid1);
  const m2 = clamp(mid2);
  const a = clamp(assignment);
  const l = clamp(lab);
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
  return final < Number(threshold ?? 40);
}

/** Policy: combined internal marks (I1 + I2) below this value => At Risk (internal rule). */
export const INTERNAL_TOTAL_RISK_THRESHOLD = 16;

/**
 * True when rounded I1+I2 is below {@link INTERNAL_TOTAL_RISK_THRESHOLD} and at least one internal is non-zero
 * (avoids treating blank 0/0 rows as at-risk).
 */
export function computeInternalTotalAtRisk(internal1, internal2) {
  const i1 = Number(internal1) || 0;
  const i2 = Number(internal2) || 0;
  const sum = Math.round((i1 + i2) * 10) / 10;
  if (sum === 0) return false;
  return sum < INTERNAL_TOTAL_RISK_THRESHOLD;
}

/**
 * Marks collection `atRisk` flag: **final &lt; 16** OR {@link computeInternalTotalAtRisk}.
 * Settings `riskThreshold` (e.g. 40) is **not** used here — it is for analytics / insights only.
 */
export function computeCombinedAtRisk(final, _riskThresholdUnused, internal1, internal2) {
  const f = Number(final);
  const finalLow = Number.isFinite(f) && f < INTERNAL_TOTAL_RISK_THRESHOLD;
  return finalLow || computeInternalTotalAtRisk(internal1, internal2);
}
