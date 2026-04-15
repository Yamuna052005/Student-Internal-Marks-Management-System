/**
 * Aggregates per-student signals from mark rows (with populated `student`)
 * for elevated-risk insight beyond single-row `atRisk` flags.
 */
export const PREDICTIVE_RISK_THRESHOLD = 16;

export function computeStudentRiskInsights(
  markRows,
  { passMark = 40, predictiveThreshold = PREDICTIVE_RISK_THRESHOLD } = {}
) {
  const PT = Number(predictiveThreshold);
  const PM = Number(passMark);
  const byStudent = new Map();

  for (const m of markRows) {
    const st = m.student;
    const sid = st && typeof st === "object" && st._id != null ? String(st._id) : null;
    if (!sid) continue;
    if (!byStudent.has(sid)) byStudent.set(sid, { student: st, marks: [] });
    byStudent.get(sid).marks.push(m);
  }

  const out = [];

  for (const { student, marks: ms } of byStudent.values()) {
    if (!ms.length) continue;

    const finals = ms.map((m) => Number(m.final) || 0);
    const avg = finals.reduce((a, b) => a + b, 0) / finals.length;
    const minFinal = Math.min(...finals);
    if (!(avg < PT)) continue;

    let declineCount = 0;
    for (const m of ms) {
      const pf = m.priorFinal;
      const fn = Number(m.final);
      if (pf != null && Number.isFinite(Number(pf)) && Number.isFinite(fn)) {
        const pfv = Number(pf);
        if (fn < pfv - 5) declineCount++;
      }
    }

    let volatileInternals = 0;
    for (const m of ms) {
      const i1 = m.internal1 || 0;
      const i2 = m.internal2 || 0;
      if (Math.abs(i1 - i2) > 20) volatileInternals++;
    }

    let score = 0;
    const factors = [];

    score += 45;
    factors.push(`Course average ${avg.toFixed(1)} is below the predictive threshold (${PT}).`);

    if (declineCount > 0) {
      score += Math.min(20, 10 + declineCount * 5);
      factors.push(
        `Recorded decline vs prior final in ${declineCount} course(s) (historical within SIMMS).`
      );
    }

    if (minFinal < PM) {
      score += 15;
      factors.push(`Lowest subject final (${minFinal}) is under the pass mark (${PM}).`);
    }

    if (volatileInternals >= 2 && score < 70) {
      score += 8;
      factors.push(`Large internal split in several subjects — inconsistent performance.`);
    }

    score = Math.min(100, Math.round(score));
    if (score < 18) continue;

    out.push({
      student: {
        _id: student._id,
        name: student.name,
        rollNumber: student.rollNumber,
      },
      riskScore: score,
      subjectsTracked: ms.length,
      courseAvg: Math.round(avg * 10) / 10,
      minFinal,
      factors,
      riskBand: score >= 70 ? "high" : score >= 45 ? "elevated" : "watch",
    });
  }

  out.sort((a, b) => b.riskScore - a.riskScore);
  return out.slice(0, 30);
}
