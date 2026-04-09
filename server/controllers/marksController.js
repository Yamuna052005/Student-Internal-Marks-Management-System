import { Marks } from "../models/Marks.js";
import { Student } from "../models/Student.js";
import { getSettingsDoc } from "../utils/ensureSettings.js";
import {
  computeMarksPayload,
  detectInternalAnomaly,
  detectFinalSpike,
  computeCombinedAtRisk,
} from "../utils/calcMarks.js";
import { logActivity } from "../utils/activity.js";
import { parseMarksCsv } from "../utils/csvParse.js";
import {
  resolveTermScope,
  applyTermMongoFilter,
  normalizeMarkTerms,
  resolveMarkTermForApi,
  resolveMarksTermsForApiArray,
} from "../utils/termScope.js";
import {
  ensureAutoRemedialIfEligible,
  resolveRemedialActorIdStrict,
  syncAutoRemedialsFromDatabase,
} from "./remedialController.js";

async function enrichMarks(doc) {
  const populated = await Marks.findById(doc._id)
    .populate("student", "name rollNumber section")
    .populate("updatedBy", "name username")
    .lean();
  if (populated) return resolveMarkTermForApi(populated, await getSettingsDoc());
  return populated;
}

function applyRiskAndAnomaly(computed, priorFinal, threshold) {
  const atRisk = computeCombinedAtRisk(computed.final, threshold, computed.internal1, computed.internal2);
  const internalSpike = detectInternalAnomaly(computed.internal1, computed.internal2);
  const finalSpike = detectFinalSpike(priorFinal, computed.final);
  const anomaly = internalSpike || finalSpike;
  return { atRisk, anomaly };
}

/** API body: prefer `student` (ObjectId); `studentId` accepted for backward compatibility. */
export function resolveStudentRef(body) {
  const v = body?.student ?? body?.studentId;
  if (v == null) return "";
  return String(v).trim();
}

export async function listMarks(req, res, next) {
  try {
    const {
      search = "",
      subject = "",
      atRisk,
      anomaly,
      page = 1,
      limit = 15,
    } = req.query;
    const p = Math.max(1, Number(page) || 1);
    const l = Math.min(100, Math.max(1, Number(limit) || 15));

    const filter = {};
    if (atRisk === "true") filter.atRisk = true;
    if (anomaly === "true") filter.anomaly = true;
    if (subject) filter.subject = new RegExp(String(subject).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");

    if (req.user.role === "student") {
      if (!req.user.studentRef) {
        filter.student = { $in: [] };
      } else {
        filter.student = req.user.studentRef;
      }
    }

    const q = String(search).trim();
    if (req.user.role !== "student") {
      if (q) {
        const students = await Student.find({
          $or: [
            { name: new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") },
            { rollNumber: new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") },
          ],
        })
          .select("_id")
          .lean();
        filter.student = { $in: students.map((s) => s._id) };
      }
    }

    const settings = await getSettingsDoc();
    const scope = await resolveTermScope(req, settings);
    applyTermMongoFilter(filter, scope, settings);

    const [items, total] = await Promise.all([
      Marks.find(filter)
        .populate("student", "name rollNumber section createdBy")
        .populate("updatedBy", "name username")
        .sort({ updatedAt: -1 })
        .skip((p - 1) * l)
        .limit(l)
        .lean(),
      Marks.countDocuments(filter),
    ]);

    if (req.user.role === "admin" || req.user.role === "faculty") {
      const actorId = await resolveRemedialActorIdStrict(req);
      await syncAutoRemedialsFromDatabase(actorId, {});
    }

    res.json({
      marks: resolveMarksTermsForApiArray(items, settings),
      page: p,
      limit: l,
      total,
    });
  } catch (e) {
    next(e);
  }
}

export async function getMark(req, res, next) {
  try {
    const doc = await Marks.findById(req.params.id)
      .populate("student", "name rollNumber section createdBy")
      .populate("updatedBy", "name username")
      .lean();
    if (!doc) return res.status(404).json({ message: "Not found" });
    if (req.user.role === "student") {
      if (!req.user.studentRef || String(doc.student?._id) !== String(req.user.studentRef)) {
        return res.status(403).json({ message: "Not allowed" });
      }
    }
    const settingsOne = await getSettingsDoc();
    res.json({ mark: resolveMarkTermForApi(doc, settingsOne) });
  } catch (e) {
    next(e);
  }
}

export async function createMark(req, res, next) {
  try {
    const body = req.body || {};
    const studentRef = resolveStudentRef(body);
    const subject = String(body.subject ?? "").trim();
    const { term: termBody, mid1, mid2, assignment, lab } = body;
    if (!studentRef || !subject) return res.status(400).json({ message: "student and subject required" });

    const st = await Student.findById(studentRef);
    if (!st) return res.status(404).json({ message: "Student not found" });

    const settings = await getSettingsDoc();
    const term =
      String(termBody || "").trim() || String(settings.defaultTerm || "2025-T1").trim() || "2025-T1";
    const computed = computeMarksPayload({ mid1, mid2, assignment, lab });
    const { atRisk, anomaly } = applyRiskAndAnomaly(computed, null, settings.riskThreshold);

    const doc = await Marks.create({
      student: st._id,
      subject,
      term,
      ...computed,
      atRisk,
      anomaly,
      priorFinal: null,
      updatedBy: req.user._id,
    });

    await logActivity({
      actorId: req.user._id,
      actorName: req.user.name,
      action: "marks.create",
      details: `Marks for ${st.name} / ${subject}`,
    });

    await ensureAutoRemedialIfEligible(doc, await resolveRemedialActorIdStrict(req));

    res.status(201).json({ mark: await enrichMarks(doc) });
  } catch (e) {
    if (e.code === 11000) {
      return res.status(409).json({
        message: "Marks already exist for this student, subject, and term.",
      });
    }
    next(e);
  }
}

const BULK_MAX = 200;

export async function bulkCreateMarks(req, res, next) {
  try {
    const items = req.body?.marks;
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: "Body must include non-empty marks array" });
    }
    if (items.length > BULK_MAX) {
      return res.status(400).json({ message: `Maximum ${BULK_MAX} marks per request` });
    }

    const settings = await getSettingsDoc();
    const defaultTerm = String(settings.defaultTerm || "2025-T1").trim() || "2025-T1";
    const imported = [];
    const errors = [];
    const remedialActorId = await resolveRemedialActorIdStrict(req);

    for (let i = 0; i < items.length; i++) {
      const body = items[i] || {};
      try {
        const studentRef = resolveStudentRef(body);
        const subject = String(body.subject ?? "").trim();
        if (!studentRef || !subject) {
          errors.push(`Row ${i + 1}: student and subject required`);
          continue;
        }
        const st = await Student.findById(studentRef);
        if (!st) {
          errors.push(`Row ${i + 1}: student not found`);
          continue;
        }
        const { term: termBody, mid1, mid2, assignment, lab } = body;
        const term =
          String(termBody || "").trim() || defaultTerm;
        const prior = await Marks.findOne({ student: st._id, subject, term }).lean();
        const priorFinal = prior ? prior.final : null;
        const computed = computeMarksPayload({ mid1, mid2, assignment, lab });
        const { atRisk, anomaly } = applyRiskAndAnomaly(computed, priorFinal, settings.riskThreshold);

        const doc = await Marks.findOneAndUpdate(
          { student: st._id, subject, term },
          {
            $set: {
              term,
              ...computed,
              atRisk,
              anomaly,
              priorFinal,
              updatedBy: req.user._id,
            },
          },
          { upsert: true, new: true, setDefaultsOnInsert: true }
        );
        await ensureAutoRemedialIfEligible(doc, remedialActorId);
        imported.push(doc._id);
      } catch (err) {
        errors.push(`Row ${i + 1}: ${err.message}`);
      }
    }

    await logActivity({
      actorId: req.user._id,
      actorName: req.user.name,
      action: "marks.bulk",
      details: `Bulk JSON: ${imported.length} marks upserted`,
    });

    res.status(201).json({ imported: imported.length, ids: imported, errors });
  } catch (e) {
    next(e);
  }
}

export async function updateMark(req, res, next) {
  try {
    const { id } = req.params;
    const doc = await Marks.findById(id);
    if (!doc) return res.status(404).json({ message: "Not found" });

    const st = await Student.findById(doc.student);
    if (!st) return res.status(404).json({ message: "Student missing" });

    const settings = await getSettingsDoc();
    const priorFinal = doc.final;
    const { mid1, mid2, assignment, lab, subject } = req.body || {};

    if (subject != null) doc.subject = String(subject).trim();
    const payload = computeMarksPayload({
      mid1: mid1 ?? doc.mid1,
      mid2: mid2 ?? doc.mid2,
      assignment: assignment ?? doc.assignment,
      lab: lab ?? doc.lab,
    });

    doc.mid1 = payload.mid1;
    doc.mid2 = payload.mid2;
    doc.assignment = payload.assignment;
    doc.lab = payload.lab;
    doc.internal1 = payload.internal1;
    doc.internal2 = payload.internal2;
    doc.final = payload.final;
    doc.bestKey = payload.bestKey;
    doc.priorFinal = priorFinal;

    const { atRisk, anomaly } = applyRiskAndAnomaly(payload, priorFinal, settings.riskThreshold);
    doc.atRisk = atRisk;
    doc.anomaly = anomaly;
    doc.updatedBy = req.user._id;

    await doc.save();

    await ensureAutoRemedialIfEligible(doc, await resolveRemedialActorIdStrict(req));

    await logActivity({
      actorId: req.user._id,
      actorName: req.user.name,
      action: "marks.update",
      details: `Updated marks ${st.name} / ${doc.subject}`,
    });

    res.json({ mark: await enrichMarks(doc) });
  } catch (e) {
    next(e);
  }
}

export async function deleteMark(req, res, next) {
  try {
    const doc = await Marks.findById(req.params.id);
    if (!doc) return res.status(404).json({ message: "Not found" });
    await Marks.findByIdAndDelete(req.params.id);
    await logActivity({
      actorId: req.user._id,
      actorName: req.user.name,
      action: "marks.delete",
      details: `Deleted marks record`,
    });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
}

export async function listDistinctTerms(req, res, next) {
  try {
    const base = {};
    if (req.user.role === "student") {
      if (!req.user.studentRef) {
        const doc = await getSettingsDoc();
        return res.json({ terms: [], defaultTerm: doc.defaultTerm ?? "2025-T1" });
      }
      base.student = req.user.studentRef;
    }
    let terms = await Marks.distinct("term", base);
    terms = [...new Set(terms.filter((t) => t != null && String(t).trim() !== "").map((t) => String(t).trim()))];
    terms.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base", numeric: true }));
    const doc = await getSettingsDoc();
    res.json({ terms, defaultTerm: doc.defaultTerm ?? "2025-T1" });
  } catch (e) {
    next(e);
  }
}

export async function bulkCsv(req, res, next) {
  try {
    const text = req.file?.buffer ? req.file.buffer.toString("utf8") : String(req.body?.csv || "");
    if (!text) return res.status(400).json({ message: "Empty CSV" });

    const parsed = parseMarksCsv(text);
    if (!parsed.ok) return res.status(400).json({ message: parsed.reason, errors: parsed.errors });

    const atomic =
      req.query.atomic === "1" ||
      req.body?.atomic === "1" ||
      req.body?.atomic === true;

    if (atomic && (parsed.errors?.length || 0) > 0) {
      return res.status(400).json({
        message: "Strict import: fix every row error before any marks are saved.",
        errors: parsed.errors,
        imported: 0,
        atomicAborted: true,
      });
    }

    const settings = await getSettingsDoc();
    const defaultTerm =
      String(settings.defaultTerm || "2025-T1").trim() || "2025-T1";
    const created = [];
    const errors = [...(parsed.errors || [])];
    const remedialActorId = await resolveRemedialActorIdStrict(req);

    for (const row of parsed.rows) {
      try {
        let st = await Student.findOne({ name: row.name });
        if (!st) {
          st = await Student.create({
            name: row.name,
            rollNumber: "",
            section: "",
            createdBy: req.user._id,
          });
        }

        const term = String(row.term || "").trim() || defaultTerm;

        const prior = await Marks.findOne({ student: st._id, subject: row.subject, term });
        const priorFinal = prior ? prior.final : null;

        const computed = computeMarksPayload({
          mid1: row.mid1,
          mid2: row.mid2,
          assignment: row.assignment,
          lab: row.lab,
        });
        const { atRisk, anomaly } = applyRiskAndAnomaly(computed, priorFinal, settings.riskThreshold);

        const doc = await Marks.findOneAndUpdate(
          { student: st._id, subject: row.subject, term },
          {
            $set: {
              term,
              ...computed,
              atRisk,
              anomaly,
              priorFinal,
              updatedBy: req.user._id,
            },
          },
          { upsert: true, new: true, setDefaultsOnInsert: true }
        );

        await ensureAutoRemedialIfEligible(doc, remedialActorId);

        created.push(doc._id);
      } catch (err) {
        errors.push(`${row.name} / ${row.subject}: ${err.message}`);
      }
    }

    await logActivity({
      actorId: req.user._id,
      actorName: req.user.name,
      action: "marks.csv",
      details: `Bulk CSV import: ${created.length} rows`,
    });

    res.status(201).json({ imported: created.length, errors });
  } catch (e) {
    next(e);
  }
}

export async function exportMarksCsv(req, res, next) {
  try {
    const settingsEx = await getSettingsDoc();
    const rows = await Marks.find({}).populate("student", "name").lean();
    normalizeMarkTerms(rows, settingsEx);

    const esc = (v) => {
      const s = String(v ?? "");
      if (s.includes('"') || s.includes(",") || s.includes("\n")) return `"${s.replaceAll('"', '""')}"`;
      return s;
    };
    const head = ["Student Name", "Subject", "Term", "Mid-1", "Mid-2", "Assignment", "Lab", "Final Marks"];
    const lines = [head.join(",")];
    for (const r of rows) {
      lines.push(
        [r.student?.name || "", r.subject, r.term ?? "", r.mid1, r.mid2, r.assignment, r.lab, r.final]
          .map(esc)
          .join(",")
      );
    }
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="simms_marks_export.csv"`);
    res.send(lines.join("\n"));
  } catch (e) {
    next(e);
  }
}
