import { Student } from "../models/Student.js";
import { Marks } from "../models/Marks.js";
import { RemedialSession } from "../models/RemedialSession.js";
import { getSettingsDoc } from "../utils/ensureSettings.js";
import { groupMarksByYearSemester } from "../utils/academicReport.js";
import { resolveMarkTermForApi } from "../utils/termScope.js";
import {
  FINAL_FAIL_THRESHOLD,
  INTERNAL_REMEDIAL_THRESHOLD,
  computeInternalAtRisk,
} from "../utils/calcMarks.js";

function enrichMark(m, settings) {
  const norm = resolveMarkTermForApi({ ...m }, settings);
  const i1 = Number(norm.internal1 ?? 0);
  const i2 = Number(norm.internal2 ?? 0);
  const internalTotal = Math.round((i1 + i2) * 10) / 10;
  const internalAtRisk = computeInternalAtRisk(i1, i2);
  return {
    _id: norm._id,
    subject: norm.subject,
    term: norm.term,
    mid1: norm.mid1,
    mid2: norm.mid2,
    assignment: norm.assignment,
    lab: norm.lab,
    internal1: i1,
    internal2: i2,
    internalTotal,
    internalAtRisk,
    final: norm.final,
    bestKey: norm.bestKey,
    atRisk: norm.atRisk,
    anomaly: norm.anomaly,
    releasedAt: norm.releasedAt,
    createdAt: norm.createdAt,
    updatedAt: norm.updatedAt,
  };
}

export async function getStudentAcademicReport(req, res, next) {
  try {
    const id = req.params.id;
    if (req.user.role === "student") {
      if (!req.user.studentRef || String(req.user.studentRef) !== String(id)) {
        return res.status(403).json({ message: "Not allowed" });
      }
    }

    const st = await Student.findById(id).lean();
    if (!st) return res.status(404).json({ message: "Student not found" });

    const settings = await getSettingsDoc();
    const defaultTerm = String(settings.defaultTerm || "2025-T1").trim() || "2025-T1";

    const raw = await Marks.find({ student: id })
      .populate("updatedBy", "name username")
      .sort({ term: 1, subject: 1 })
      .lean();

    const enriched = raw.map((m) => enrichMark(m, settings));
    const { years } = groupMarksByYearSemester(enriched, defaultTerm);

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

    const markAlertThreshold = FINAL_FAIL_THRESHOLD;
    const internalRiskThreshold = INTERNAL_REMEDIAL_THRESHOLD;
    const lowFinalSubjects = enriched
      .filter((m) => Number(m.final) < markAlertThreshold)
      .map((m) => ({
        subject: m.subject,
        term: m.term,
        final: m.final,
        internalTotal: m.internalTotal,
      }));

    const remedials = await RemedialSession.find({ student: id })
      .populate("marks", "subject term final internal1 internal2")
      .populate("createdBy", "name username")
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();

    res.json({
      student: st,
      internalRiskThreshold,
      markAlertThreshold,
      years,
      internalRiskSubjects,
      lowFinalSubjects,
      remedials,
    });
  } catch (e) {
    next(e);
  }
}
