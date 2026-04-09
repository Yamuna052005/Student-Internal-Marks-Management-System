// SIMMS — Unified Mock Data Store (localStorage based)

/**
 * 80-20 Weighted Internal Marks Model
 * ─────────────────────────────────────
 * Internal-1 = Mid-1 + Assignment
 * Internal-2 = Mid-2 + Lab
 *
 * Final = max(I1, I2) × 0.80  +  min(I1, I2) × 0.20
 *
 * The better internal automatically receives 80% weight.
 * No manual selection needed.
 */

const STORAGE_KEY = "simms_db";

const INITIAL_DATA = {
  users: [
    { _id: "u1", username: "admin",   role: "admin",   name: "System Admin" },
    { _id: "u2", username: "faculty", role: "faculty", name: "Dr. Sarah Miller" },
    { _id: "u3", username: "student", role: "student", name: "Alice Johnson", studentRef: "s1" },
  ],
  students: [
    { _id: "s1", name: "Alice Johnson", email: "alice@univ.edu", rollNumber: "2024001", section: "A", createdBy: "u2" },
    { _id: "s2", name: "Bob Smith",     email: "bob@univ.edu",   rollNumber: "2024002", section: "B", createdBy: "u2" },
  ],
  // Finals pre-computed: best(I1,I2)×0.8 + other×0.2
  marks: [
    // Alice: I1=85+15=100, I2=70+25=95 → 100×0.8+95×0.2 = 99.0
    { _id: "m1", studentId: "s1", term: "2025-T1", subject: "Mathematics",     mid1: 85, assignment: 15, mid2: 70, lab: 25, internal1: 100, internal2: 95,  final: 99.0,  bestKey: "internal1", atRisk: false, anomaly: false },
    // Alice: I1=72+18=90, I2=78+22=100 → 100×0.8+90×0.2 = 98.0
    { _id: "m2", studentId: "s1", term: "2025-T1", subject: "Data Structures", mid1: 72, assignment: 18, mid2: 78, lab: 22, internal1: 90,  internal2: 100, final: 98.0,  bestKey: "internal2", atRisk: false, anomaly: false },
    // Bob:   I1=35+10=45, I2=38+12=50 → 50×0.8+45×0.2 = 49.0
    { _id: "m3", studentId: "s2", term: "2025-T1", subject: "Physics",         mid1: 35, assignment: 10, mid2: 38, lab: 12, internal1: 45,  internal2: 50,  final: 49.0,  bestKey: "internal2", atRisk: false, anomaly: false },
    // Bob:   I1=90+20=110, I2=50+20=70 → 110×0.8+70×0.2 = 102.0 (anomaly: |110-70|=40>30)
    { _id: "m4", studentId: "s2", term: "2025-T1", subject: "Mathematics",     mid1: 90, assignment: 20, mid2: 50, lab: 20, internal1: 110, internal2: 70,  final: 102.0, bestKey: "internal1", atRisk: false, anomaly: true  },
  ],
  settings: {
    riskThreshold: 40,
    passMark: 40,
    defaultTerm: "2025-T1",
    marksDeadline: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    institutionName: "Antigravity University",
  },
  activity: [
    { _id: "a1", action: "LOGIN", details: "Admin accessed the system", actorName: "System Admin", createdAt: new Date().toISOString() },
  ],
  remedials: [],
};

const DB_VERSION = 7;

export const INTERNAL_TOTAL_RISK_THRESHOLD = 16;

const NOTE_AUTO_INTERNAL = "Auto-assigned: combined internals (I1+I2) below 16.";
const NOTE_AUTO_FINAL = "Auto-assigned: final mark below 16.";

function mockEnrichMarkForRemedial(markRow) {
  const i1 =
    markRow.internal1 != null && markRow.internal1 !== ""
      ? Number(markRow.internal1)
      : Number(markRow.mid1 || 0) + Number(markRow.assignment || 0);
  const i2 =
    markRow.internal2 != null && markRow.internal2 !== ""
      ? Number(markRow.internal2)
      : Number(markRow.mid2 || 0) + Number(markRow.lab || 0);
  let finalNum = Number(markRow.final);
  if (!Number.isFinite(finalNum)) {
    finalNum = calculateFinal(markRow).final;
  }
  const internalTotal = Math.round((i1 + i2) * 10) / 10;
  return { internalTotal, finalNum };
}

function mockMarkEligibleForAutoRemedial(markRow) {
  const { internalTotal, finalNum } = mockEnrichMarkForRemedial(markRow);
  if (
    (!Number.isFinite(internalTotal) || internalTotal === 0) &&
    (!Number.isFinite(finalNum) || finalNum === 0)
  ) {
    return { eligible: false, notes: "" };
  }
  const internalLow = internalTotal > 0 && internalTotal < INTERNAL_TOTAL_RISK_THRESHOLD;
  const finalLow = Number.isFinite(finalNum) && finalNum < INTERNAL_TOTAL_RISK_THRESHOLD;
  if (internalLow) return { eligible: true, notes: NOTE_AUTO_INTERNAL };
  if (finalLow) return { eligible: true, notes: NOTE_AUTO_FINAL };
  return { eligible: false, notes: "" };
}

/** Mutates `db`; call `saveDb(db)` after if needed. Mirrors server auto-remedial rules. */
export function ensureMockAutoRemedial(db, markRow, actorUserId) {
  if (!markRow?._id) return;
  const { eligible, notes } = mockMarkEligibleForAutoRemedial(markRow);
  if (!eligible) return;
  const { finalNum } = mockEnrichMarkForRemedial(markRow);
  const bf = Number.isFinite(finalNum) ? finalNum : Number(markRow.final ?? 0);
  db.remedials = db.remedials || [];
  const mid = String(markRow._id);
  if (db.remedials.some((r) => String(r.marksId) === mid)) return;
  db.remedials.push({
    _id: `r${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    marksId: markRow._id,
    student: markRow.studentId,
    beforeFinal: bf,
    afterFinal: bf,
    notes,
    createdAt: new Date().toISOString(),
    ...(actorUserId ? { createdBy: actorUserId } : {}),
  });
}

/** Ensures mock remedials list matches internal-risk policy (for GET /remedials). */
export function syncMockAutoRemedials(db, actorUserId) {
  const before = (db.remedials || []).length;
  for (const m of db.marks || []) {
    ensureMockAutoRemedial(db, m, actorUserId);
  }
  if ((db.remedials || []).length !== before) saveDb(db);
}

export function getDb() {
  const raw = localStorage.getItem(STORAGE_KEY);
  let db;
  if (!raw) {
    db = { ...INITIAL_DATA, _v: DB_VERSION };
  } else {
    try {
      db = JSON.parse(raw);
      if (db._v !== DB_VERSION) {
        db = { ...INITIAL_DATA, _v: DB_VERSION };
      } else {
        Object.keys(INITIAL_DATA).forEach(key => {
          if (db[key] === undefined) db[key] = INITIAL_DATA[key];
        });
      }
    } catch (e) {
      db = { ...INITIAL_DATA, _v: DB_VERSION };
    }
  }
  db.settings = db.settings || {};
  const dt = db.settings.defaultTerm || "2025-T1";
  db.settings.defaultTerm = dt;
  (db.marks || []).forEach((m) => {
    if (m.term == null || m.term === "") m.term = dt;
  });
  saveDb(db);
  return db;
}

export function saveDb(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

/**
 * calculateFinal — 80-20 Weighted Model
 *
 * internal1 = mid1 + assignment   (Internal Assessment 1)
 * internal2 = mid2 + lab          (Internal Assessment 2)
 * final     = best × 0.80 + other × 0.20
 *
 * Returns: { internal1, internal2, final, bestKey }
 */
export function calculateFinal(m) {
  const internal1 = (m.mid1 || 0) + (m.assignment || 0);
  const internal2 = (m.mid2 || 0) + (m.lab || 0);
  const best  = Math.max(internal1, internal2);
  const other = Math.min(internal1, internal2);
  const final = Number(((best * 0.8) + (other * 0.2)).toFixed(1));
  const bestKey = internal1 >= internal2 ? "internal1" : "internal2";
  return { internal1, internal2, final, bestKey };
}

/**
 * Mirrors server/utils/calcMarks.js — internal spike OR jump vs prior final on update.
 */
function detectInternalAnomaly(internal1, internal2) {
  const best = Math.max(internal1, internal2);
  const other = best === internal1 ? internal2 : internal1;
  const base = Math.max(1, other);
  const jumpPct = (best - other) / base;
  return jumpPct > 0.3 && best - other >= 10;
}

function detectFinalSpike(priorFinal, newFinal) {
  if (priorFinal == null || !Number.isFinite(Number(priorFinal))) return false;
  const p = Number(priorFinal);
  const n = Number(newFinal);
  if (!Number.isFinite(n)) return false;
  const base = Math.max(1, p);
  const jump = (n - p) / base;
  return jump > 0.3 && n - p >= 8;
}

/** @param priorFinal - previous stored final (mock PATCH passes this; create/import omit) */
export function checkAnomaly(m, priorFinal = null) {
  const internal1 = (m.mid1 || 0) + (m.assignment || 0);
  const internal2 = (m.mid2 || 0) + (m.lab || 0);
  const final =
    m.final != null && Number.isFinite(Number(m.final))
      ? Number(m.final)
      : calculateFinal(m).final;
  return detectInternalAnomaly(internal1, internal2) || detectFinalSpike(priorFinal, final);
}

/** Mirrors server `computeCombinedAtRisk`: final &lt; 16 or internal total rule (ignores settings riskThreshold). */
export function checkRisk(final, _thresholdIgnored = 40, internal1, internal2) {
  const f = Number(final);
  if (Number.isFinite(f) && f < INTERNAL_TOTAL_RISK_THRESHOLD) return true;
  const i1 = Number(internal1) || 0;
  const i2 = Number(internal2) || 0;
  const sum = Math.round((i1 + i2) * 10) / 10;
  if (sum > 0 && sum < INTERNAL_TOTAL_RISK_THRESHOLD) return true;
  return false;
}

function parseTermYearSemMock(termRaw, defaultTerm) {
  const term = String(termRaw ?? "").trim() || String(defaultTerm ?? "").trim() || "Unknown";
  const m = term.match(/^(\d{4})[-_/]?(T|S|SEM)?[._-]?(\d+)$/i);
  if (m) {
    const year = m[1];
    const semType = (m[2] || "T").toUpperCase();
    const semNum = m[3];
    const semesterKey = `${semType}${semNum}`;
    return {
      yearKey: year,
      yearLabel: year,
      semesterKey,
      semesterLabel: `${semType === "S" ? "Semester" : "Term"} ${semNum}`,
      term,
    };
  }
  return {
    yearKey: "other",
    yearLabel: "Other",
    semesterKey: term,
    semesterLabel: term,
    term,
  };
}

function groupMarksMock(enriched, defaultTerm) {
  const yearBuckets = new Map();
  for (const m of enriched) {
    const meta = parseTermYearSemMock(m.term, defaultTerm);
    const yk = meta.yearKey;
    if (!yearBuckets.has(yk)) {
      yearBuckets.set(yk, { year: meta.yearLabel, yearKey: yk, semesters: new Map() });
    }
    const yb = yearBuckets.get(yk);
    const semKey = `${meta.term}::${meta.semesterKey}`;
    if (!yb.semesters.has(semKey)) {
      yb.semesters.set(semKey, {
        semester: meta.semesterLabel,
        semesterKey: meta.semesterKey,
        term: meta.term,
        subjects: [],
      });
    }
    yb.semesters.get(semKey).subjects.push(m);
  }
  const yearSort = (a, b) => {
    if (a.yearKey === "other") return 1;
    if (b.yearKey === "other") return -1;
    return String(b.yearKey).localeCompare(String(a.yearKey), undefined, { numeric: true });
  };
  const semSort = (a, b) =>
    String(a.term).localeCompare(String(b.term), undefined, { sensitivity: "base", numeric: true });
  return [...yearBuckets.values()]
    .sort(yearSort)
    .map((yb) => ({
      year: yb.year,
      yearKey: yb.yearKey,
      semesters: [...yb.semesters.values()].sort(semSort),
    }));
}

export function mockAcademicReport(db, studentId) {
  const st = (db.students || []).find((s) => String(s._id) === String(studentId));
  if (!st) return null;
  const defaultTerm = db.settings?.defaultTerm || "2025-T1";
  const raw = (db.marks || []).filter((m) => String(m.studentId) === String(studentId));
  const enriched = raw.map((m) => {
    const term = m.term != null && String(m.term).trim() !== "" ? String(m.term).trim() : defaultTerm;
    const i1 = Number(m.internal1 ?? (m.mid1 || 0) + (m.assignment || 0));
    const i2 = Number(m.internal2 ?? (m.mid2 || 0) + (m.lab || 0));
    const internalTotal = Math.round((i1 + i2) * 10) / 10;
    const internalAtRisk =
      internalTotal > 0 && internalTotal < INTERNAL_TOTAL_RISK_THRESHOLD;
    return {
      _id: m._id,
      subject: m.subject,
      term,
      mid1: m.mid1,
      mid2: m.mid2,
      assignment: m.assignment,
      lab: m.lab,
      internal1: i1,
      internal2: i2,
      internalTotal,
      internalAtRisk,
      final: m.final,
      bestKey: m.bestKey,
      atRisk: m.atRisk,
      anomaly: m.anomaly,
      updatedAt: m.updatedAt,
    };
  });
  const years = groupMarksMock(enriched, defaultTerm);
  const internalRiskSubjects = enriched
    .filter((m) => m.internalAtRisk)
    .map((m) => ({
      subject: m.subject,
      term: m.term,
      internalTotal: m.internalTotal,
      internal1: m.internal1,
      internal2: m.internal2,
      final: m.final,
    }));
  const markAlertThreshold = INTERNAL_TOTAL_RISK_THRESHOLD;
  const lowFinalSubjects = enriched
    .filter((m) => Number(m.final) < markAlertThreshold)
    .map((m) => ({
      subject: m.subject,
      term: m.term,
      final: m.final,
      internalTotal: m.internalTotal,
    }));
  const remedials = (db.remedials || [])
    .filter((r) => String(r.student ?? r.studentId) === String(studentId))
    .map((r) => {
      const mark = (db.marks || []).find((x) => String(x._id) === String(r.marksId));
      return { ...r, marks: mark || null };
    })
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  return {
    student: st,
    internalRiskThreshold: INTERNAL_TOTAL_RISK_THRESHOLD,
    markAlertThreshold,
    years,
    internalRiskSubjects,
    lowFinalSubjects,
    remedials,
  };
}

/** Mirrors server/utils/studentRiskInsights.js for mock analytics. */
export function computeStudentRiskInsights(markRows, { passMark = 40, riskThreshold = 40 } = {}) {
  const RT = Number(riskThreshold);
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
    const lowSubj = ms.filter((m) => (Number(m.final) || 0) < RT).length;
    let declineCount = 0;
    for (const m of ms) {
      const pf = m.priorFinal;
      const fn = Number(m.final);
      if (pf != null && Number.isFinite(Number(pf)) && Number.isFinite(fn) && fn < Number(pf) - 5) {
        declineCount++;
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
    if (avg < RT) {
      score += 35;
      factors.push(`Course average ${avg.toFixed(1)} is below the risk threshold (${RT}).`);
    } else if (avg < RT + 8) {
      score += 18;
      factors.push(`Course average ${avg.toFixed(1)} is borderline (within 8 marks of threshold).`);
    }
    if (lowSubj >= 2) {
      score += 25;
      factors.push(`${lowSubj} subjects are below the risk threshold — weak pattern across courses.`);
    } else if (lowSubj === 1 && ms.length >= 2) {
      score += 12;
      factors.push(`One subject below threshold with multiple courses on record — check breadth of performance.`);
    }
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
    if (volatileInternals >= 2 && score < 40) {
      score += 8;
      factors.push(`Large internal split in several subjects — inconsistent performance.`);
    }
    score = Math.min(100, Math.round(score));
    if (score < 18) continue;
    out.push({
      student: { _id: student._id, name: student.name, rollNumber: student.rollNumber },
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
