import mongoose from "mongoose";
import { RemedialSession } from "../models/RemedialSession.js";
import { Marks } from "../models/Marks.js";
import { Student } from "../models/Student.js";
import { User } from "../models/User.js";
import { logActivity } from "../utils/activity.js";
import { getSettingsDoc } from "../utils/ensureSettings.js";
import {
  computeCombinedAtRisk,
  computeMarksPayload,
  detectInternalAnomaly,
  detectFinalSpike,
  FINAL_FAIL_THRESHOLD,
  INTERNAL_REMEDIAL_THRESHOLD,
  computeInternalAtRisk,
} from "../utils/calcMarks.js";

const NOTE_AUTO_INTERNAL = `Auto-assigned: Internal-1 or Internal-2 is below ${INTERNAL_REMEDIAL_THRESHOLD}.`;
const NOTE_AUTO_FINAL = `Auto-assigned: final mark below ${FINAL_FAIL_THRESHOLD}.`;

function toCoercedNumber(v) {
  if (v == null || v === "") return NaN;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const n = Number(v);
  if (Number.isFinite(n)) return n;
  if (typeof v === "object" && v != null && typeof v.valueOf === "function") {
    const x = Number(v.valueOf());
    if (Number.isFinite(x)) return x;
  }
  if (typeof v === "object" && v != null && typeof v.toString === "function") {
    const x = Number(v.toString());
    if (Number.isFinite(x)) return x;
  }
  return NaN;
}

/** Match Marks UI: use stored internals, else Mid+Assign / Mid+Lab; derive final from components when stored final is missing. */
export function enrichMarkNumbersForRemedial(mark) {
  const i1 =
    mark?.internal1 != null && mark.internal1 !== ""
      ? toCoercedNumber(mark.internal1)
      : Number(mark?.mid1 || 0) + Number(mark?.assignment || 0);
  const i2 =
    mark?.internal2 != null && mark.internal2 !== ""
      ? toCoercedNumber(mark.internal2)
      : Number(mark?.mid2 || 0) + Number(mark?.lab || 0);

  let finalNum = toCoercedNumber(mark?.final);
  if (!Number.isFinite(finalNum)) {
    const p = computeMarksPayload({
      mid1: mark.mid1,
      mid2: mark.mid2,
      assignment: mark.assignment,
      lab: mark.lab,
    });
    finalNum = p.final;
  }

  const internalTotal = Math.round((i1 + i2) * 10) / 10;
  return { i1, i2, internalTotal, finalNum };
}

export function resolveRemedialActorId(user) {
  if (!user) return null;
  return user._id ?? user.id ?? null;
}

/**
 * ObjectId for `createdBy` on remedial rows. Uses req.user, then JWT sub, then any admin/faculty user.
 * Plain `resolveRemedialActorId(req.user)` can be null if the loaded user shape omits `_id`, which silently
 * skipped all auto-remedial backfills before.
 */
export async function resolveRemedialActorIdStrict(req) {
  const fromUser = resolveRemedialActorId(req?.user);
  if (fromUser) return fromUser;
  const sub = req?.auth?.sub;
  if (sub) {
    try {
      return new mongoose.Types.ObjectId(String(sub));
    } catch {
      /* ignore */
    }
  }
  const fallback = await User.findOne({ role: { $in: ["admin", "faculty"] } })
    .sort({ createdAt: 1 })
    .select("_id")
    .lean();
  return fallback?._id ?? null;
}

/**
 * Same idea as Marks table + dashboard: any entered internal below 9, or final below 16.
 */
export function markEligibleForAutoRemedial(mark) {
  const { i1, i2, internalTotal, finalNum } = enrichMarkNumbersForRemedial(mark);

  if (
    (!Number.isFinite(internalTotal) || internalTotal === 0) &&
    (!Number.isFinite(finalNum) || finalNum === 0)
  ) {
    return { eligible: false, notes: "" };
  }

  const internalLow = computeInternalAtRisk(i1, i2);
  const finalLow = Number.isFinite(finalNum) && finalNum < FINAL_FAIL_THRESHOLD;
  if (internalLow) return { eligible: true, notes: NOTE_AUTO_INTERNAL };
  if (finalLow) return { eligible: true, notes: NOTE_AUTO_FINAL };
  return { eligible: false, notes: "" };
}

/**
 * When a marks row is internally or finally below the policy thresholds, ensure one remedial session exists
 * (before/after final equal until faculty records an intervention).
 */
export async function ensureAutoRemedialIfEligible(mark, actorId) {
  if (!mark?._id || !actorId) return;
  const { eligible, notes } = markEligibleForAutoRemedial(mark);
  if (!eligible) return;

  const existing = await RemedialSession.countDocuments({ marks: mark._id });
  if (existing > 0) return;

  const studentId = mark.student?._id ?? mark.student;
  if (!studentId) return;

  const { finalNum } = enrichMarkNumbersForRemedial(mark);
  const beforeFinal = Number.isFinite(finalNum) ? finalNum : Number(mark.final ?? 0);
  await RemedialSession.create({
    student: studentId,
    marks: mark._id,
    beforeFinal,
    afterFinal: beforeFinal,
    improvement: 0,
    notes,
    createdBy: actorId,
  });
}

/** @deprecated use ensureAutoRemedialIfEligible */
export async function ensureAutoRemedialForInternalRisk(mark, actorId) {
  return ensureAutoRemedialIfEligible(mark, actorId);
}

/**
 * Create auto-remedial rows for marks that qualify (low internal or low final) but have no session yet.
 * Idempotent. Used by GET /remedials and by GET /marks (staff) so data syncs without opening Remedials first.
 */
export async function syncAutoRemedialsFromDatabase(actorId, query = {}) {
  if (!actorId) return;
  const { studentId, marksId } = query;
  const markFilter = {};
  if (studentId) markFilter.student = studentId;
  if (marksId) markFilter._id = marksId;

  const candidates = await Marks.find(markFilter)
    .select("_id student internal1 internal2 final mid1 mid2 assignment lab atRisk")
    .lean();

  for (const m of candidates) {
    try {
      const nextAtRisk = computeCombinedAtRisk(
        Number(m.final),
        0,
        m.internal1,
        m.internal2
      );
      if (Boolean(m.atRisk) !== Boolean(nextAtRisk)) {
        await Marks.updateOne({ _id: m._id }, { $set: { atRisk: nextAtRisk } });
      }
    } catch (err) {
      console.warn("[atRisk reconcile]", String(m._id), err?.message || err);
    }

    const { eligible } = markEligibleForAutoRemedial(m);
    if (!eligible) continue;
    try {
      await ensureAutoRemedialIfEligible(m, actorId);
    } catch (err) {
      console.warn("[remedial backfill] skip mark", String(m._id), err?.message || err);
    }
  }
}

export async function listRemedials(req, res, next) {
  try {
    const { studentId, marksId } = req.query;
    const filter = {};
    if (studentId) filter.student = studentId;
    if (marksId) filter.marks = marksId;

    const actorId = await resolveRemedialActorIdStrict(req);
    await syncAutoRemedialsFromDatabase(actorId, req.query);

    const items = await RemedialSession.find(filter)
      .populate("student", "name rollNumber")
      .populate("marks", "subject final")
      .populate("createdBy", "name username")
      .sort({ createdAt: -1 })
      .limit(200)
      .lean();

    res.json({ remedials: items });
  } catch (e) {
    next(e);
  }
}

export async function createRemedial(req, res, next) {
  try {
    const { marksId, afterFinal, notes } = req.body || {};
    if (!marksId || afterFinal == null) {
      return res.status(400).json({ message: "marksId and afterFinal required" });
    }

    const mark = await Marks.findById(marksId);
    if (!mark) return res.status(404).json({ message: "Marks not found" });

    const studentDocId = mark.student?._id ?? mark.student;
    const st = await Student.findById(studentDocId);
    if (!st) return res.status(404).json({ message: "Student not found" });

    const beforeFinal = mark.final;
    const after = Number(afterFinal);
    const improvement = Math.round((after - beforeFinal) * 10) / 10;

    const actorId = await resolveRemedialActorIdStrict(req);
    if (!actorId) return res.status(500).json({ message: "Could not resolve staff user for remedial" });
    const doc = await RemedialSession.create({
      student: st._id,
      marks: mark._id,
      beforeFinal,
      afterFinal: after,
      improvement,
      notes: notes != null ? String(notes).slice(0, 2000) : "",
      createdBy: actorId,
    });

    const settings = await getSettingsDoc();
    mark.final = after;
    mark.priorFinal = beforeFinal;
    mark.atRisk = computeCombinedAtRisk(after, settings.riskThreshold, mark.internal1, mark.internal2);
    mark.anomaly =
      detectInternalAnomaly(mark.internal1, mark.internal2) ||
      detectFinalSpike(beforeFinal, after);
    mark.updatedBy = actorId;
    await mark.save();

    await logActivity({
      actorId,
      actorName: req.user.name,
      action: "remedial.create",
      details: `Remedial for ${st.name} / ${mark.subject}`,
    });

    const out = await RemedialSession.findById(doc._id)
      .populate("student", "name rollNumber")
      .populate("marks", "subject final")
      .lean();

    res.status(201).json({ remedial: out });
  } catch (e) {
    next(e);
  }
}
