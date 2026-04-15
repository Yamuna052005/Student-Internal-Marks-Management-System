import { Marks } from "../models/Marks.js";
import { Student } from "../models/Student.js";
import { getSettingsDoc } from "../utils/ensureSettings.js";
import { computeCombinedAtRisk } from "../utils/calcMarks.js";
import {
  computeStudentRiskInsights,
  PREDICTIVE_RISK_THRESHOLD,
} from "../utils/studentRiskInsights.js";
import { resolveTermScope, applyTermMongoFilter, normalizeMarkTerms, resolveMarkTermForApi } from "../utils/termScope.js";
import { resolveRemedialActorIdStrict, syncAutoRemedialsFromDatabase } from "./remedialController.js";

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Student: always self. Faculty/admin: studentId query required. */
function resolveTrendStudentScope(req) {
  const q = String(req.query.studentId || "").trim();
  if (req.user.role === "student") {
    if (!req.user.studentRef) return { ok: false, status: 403, message: "No student profile linked" };
    if (q && String(q) !== String(req.user.studentRef)) {
      return { ok: false, status: 403, message: "Not allowed" };
    }
    return { ok: true, studentId: req.user.studentRef };
  }
  if (!q) return { ok: false, status: 400, message: "studentId required" };
  return { ok: true, studentId: q };
}

export async function summary(req, res, next) {
  try {
    const settings = await getSettingsDoc();
    const passMark = settings.passMark ?? 16;

    let match = {};
    if (req.user.role === "student") {
      if (!req.user.studentRef) {
        return res.json({
          settings: {
            passMark,
            riskThreshold: settings.riskThreshold,
            predictiveThreshold: PREDICTIVE_RISK_THRESHOLD,
          },
          total: 0,
          riskCount: 0,
          anomalyCount: 0,
          bySubject: [],
          passFail: { pass: 0, fail: 0 },
          top: [],
          low: [],
          trend: [],
          avgScore: 0,
          atRiskList: [],
          anomalyList: [],
          studentRiskInsights: [],
          predictedHighRiskCount: 0,
        });
      }
      match = { student: req.user.studentRef };
    }

    const scope = await resolveTermScope(req, settings);
    applyTermMongoFilter(match, scope, settings);

    try {
      const actorId = await resolveRemedialActorIdStrict(req);
      if (req.user.role === "student" && req.user.studentRef) {
        await syncAutoRemedialsFromDatabase(actorId, { studentId: req.user.studentRef });
      } else if (req.user.role === "admin" || req.user.role === "faculty") {
        await syncAutoRemedialsFromDatabase(actorId, {});
      }
    } catch (err) {
      console.warn("[analytics/summary] atRisk sync:", err?.message || err);
    }

    const scopedMarks = await Marks.find(match).populate("student", "name rollNumber").lean();

    const rowAtRisk = (m) => computeCombinedAtRisk(m.final, 0, m.internal1, m.internal2);
    const total = scopedMarks.length;
    const riskCount = scopedMarks.filter((m) => rowAtRisk(m)).length;
    const anomalyCount = scopedMarks.filter((m) => m.anomaly).length;

    const bySubject = await Marks.aggregate([
      { $match: match },
      {
        $group: {
          _id: "$subject",
          avgFinal: { $avg: "$final" },
          avgMid1: { $avg: "$mid1" },
          avgMid2: { $avg: "$mid2" },
          avgAssign: { $avg: "$assignment" },
          avgLab: { $avg: "$lab" },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    const passFail = await Marks.aggregate([
      { $match: match },
      {
        $group: {
          _id: { $cond: [{ $gte: ["$final", passMark] }, "pass", "fail"] },
          n: { $sum: 1 },
        },
      },
    ]);

    const pf = { pass: 0, fail: 0 };
    passFail.forEach((p) => {
      if (p._id === "pass") pf.pass = p.n;
      if (p._id === "fail") pf.fail = p.n;
    });

    const pm = Number(passMark);
    const top = [...scopedMarks]
      .filter((m) => Number(m.final) >= pm)
      .sort((a, b) => Number(b.final) - Number(a.final))
      .slice(0, 10);

    const low = [...scopedMarks]
      .sort((a, b) => Number(a.final) - Number(b.final))
      .slice(0, 10);

    const trend = [...scopedMarks]
      .sort((a, b) => {
        const ta = new Date(a.updatedAt || 0).getTime();
        const tb = new Date(b.updatedAt || 0).getTime();
        return ta - tb;
      })
      .slice(0, 40)
      .map((m) => ({
        term: m.term,
        final: m.final,
        subject: m.subject,
        updatedAt: m.updatedAt,
        internal1: m.internal1,
        internal2: m.internal2,
        name: m.subject,
      }));

    const avgScore =
      total > 0
        ? Number(
            (scopedMarks.reduce((acc, m) => acc + Number(m.final ?? 0), 0) / total).toFixed(1)
          )
        : 0;

    const atRiskList = scopedMarks
      .filter((m) => rowAtRisk(m))
      .sort((a, b) => Number(a.final) - Number(b.final))
      .slice(0, 30);

    const anomalyList = scopedMarks
      .filter((m) => m.anomaly)
      .sort((a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime())
      .slice(0, 30);

    const marksForInsights = req.user.role === "student" ? [] : scopedMarks;

    const studentRiskInsights = computeStudentRiskInsights(marksForInsights, {
      passMark,
      predictiveThreshold: PREDICTIVE_RISK_THRESHOLD,
    });
    const predictedHighRiskCount = studentRiskInsights.filter((r) => r.riskBand === "high").length;

    const bySubjectRounded = bySubject.map((b) => ({
      ...b,
      avgFinal: b.avgFinal != null ? Number(Number(b.avgFinal).toFixed(1)) : 0,
      avgMid1: b.avgMid1 != null ? Number(Number(b.avgMid1).toFixed(1)) : 0,
      avgMid2: b.avgMid2 != null ? Number(Number(b.avgMid2).toFixed(1)) : 0,
      avgAssign: b.avgAssign != null ? Number(Number(b.avgAssign).toFixed(1)) : 0,
      avgLab: b.avgLab != null ? Number(Number(b.avgLab).toFixed(1)) : 0,
    }));

    normalizeMarkTerms(trend, settings);
    normalizeMarkTerms(top, settings);
    normalizeMarkTerms(low, settings);
    normalizeMarkTerms(atRiskList, settings);
    normalizeMarkTerms(anomalyList, settings);
    normalizeMarkTerms(marksForInsights, settings);

    res.json({
      settings: {
        passMark,
        riskThreshold: settings.riskThreshold,
        predictiveThreshold: PREDICTIVE_RISK_THRESHOLD,
      },
      total,
      riskCount,
      anomalyCount,
      bySubject: bySubjectRounded,
      passFail: pf,
      top,
      low,
      trend,
      avgScore,
      atRiskList,
      anomalyList,
      studentRiskInsights,
      predictedHighRiskCount,
    });
  } catch (e) {
    next(e);
  }
}

/** Dropdown: students visible to current role (student → only self). */
export async function trendStudents(req, res, next) {
  try {
    if (req.user.role === "student") {
      if (!req.user.studentRef) return res.json({ students: [] });
      const st = await Student.findById(req.user.studentRef).select("name rollNumber").lean();
      return res.json({
        students: st
          ? [{ _id: st._id, name: st.name, rollNumber: st.rollNumber || "" }]
          : [],
      });
    }
    const students = await Student.find().select("name rollNumber").sort({ name: 1 }).limit(5000).lean();
    res.json({
      students: students.map((s) => ({
        _id: s._id,
        name: s.name,
        rollNumber: s.rollNumber || "",
      })),
    });
  } catch (e) {
    next(e);
  }
}

/** Distinct subjects for a student (scoped same as student list). */
export async function trendSubjects(req, res, next) {
  try {
    const scope = resolveTrendStudentScope(req);
    if (!scope.ok) return res.status(scope.status).json({ message: scope.message });
    const subjects = await Marks.distinct("subject", { student: scope.studentId });
    const sorted = [...new Set(subjects.filter(Boolean).map((s) => String(s).trim()).filter(Boolean))].sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" })
    );
    res.json({ subjects: sorted });
  } catch (e) {
    next(e);
  }
}

/** Time series for one student + subject across all terms (no term filter). */
export async function studentSubjectSeries(req, res, next) {
  try {
    const subject = String(req.query.subject || "").trim();
    if (!subject) return res.status(400).json({ message: "subject required" });

    const scope = resolveTrendStudentScope(req);
    if (!scope.ok) return res.status(scope.status).json({ message: scope.message });

    const re = new RegExp(`^${escapeRegex(subject)}$`, "i");
    const items = await Marks.find({ student: scope.studentId, subject: re })
      .sort({ term: 1, updatedAt: 1 })
      .select("term subject final internal1 internal2 updatedAt")
      .lean();

    const settings = await getSettingsDoc();
    const points = items.map((m) => {
      const norm = resolveMarkTermForApi(m, settings);
      return {
        term: norm.term,
        final: Number(norm.final),
        internal1: Number(norm.internal1 ?? 0),
        internal2: Number(norm.internal2 ?? 0),
        updatedAt: norm.updatedAt,
      };
    });

    const st = await Student.findById(scope.studentId).select("name rollNumber").lean();
    res.json({
      points,
      student: st ? { _id: st._id, name: st.name, rollNumber: st.rollNumber || "" } : null,
      subject,
    });
  } catch (e) {
    next(e);
  }
}
