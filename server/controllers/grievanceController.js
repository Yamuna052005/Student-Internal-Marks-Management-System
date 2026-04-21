import { Marks } from "../models/Marks.js";
import { Student } from "../models/Student.js";
import { Grievance } from "../models/Grievance.js";
import { logActivity } from "../utils/activity.js";

const GRIEVANCE_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;
const OPEN_STATUSES = ["pending", "under_review"];

function resolveMarkReleaseDate(mark) {
  const raw = mark?.releasedAt || mark?.createdAt || mark?.updatedAt;
  const date = raw ? new Date(raw) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
}

function grievanceDeadlineForMark(mark) {
  const releasedAt = resolveMarkReleaseDate(mark);
  if (!releasedAt) return null;
  return new Date(releasedAt.getTime() + GRIEVANCE_WINDOW_MS);
}

function normalizeGrievance(doc) {
  return {
    ...doc,
    deadlineExpired: doc.deadlineAt ? Date.now() > new Date(doc.deadlineAt).getTime() : true,
  };
}

export async function listGrievances(req, res, next) {
  try {
    const filter = {};
    let facultyGrievances = false;
    if (req.user.role === "student") {
      if (!req.user.studentRef) return res.json({ grievances: [] });
      filter.student = req.user.studentRef;
    } else if (req.user.role === "faculty") {
      facultyGrievances = true;
      filter.$or = [{ assignedTo: req.user._id }, { assignedTo: null }];
    } else {
      if (req.query.studentId) filter.student = req.query.studentId;
      if (req.query.marksId) filter.marks = req.query.marksId;
      if (req.query.status) filter.status = req.query.status;
    }

    const grievances = await Grievance.find(filter)
      .populate("student", "name rollNumber section")
      .populate("marks", "subject term final releasedAt createdAt updatedAt student updatedBy")
      .populate("submittedBy", "name username")
      .populate("assignedTo", "name username role")
      .populate("reviewedBy", "name username")
      .sort({ createdAt: -1 })
      .lean();

    const visibleGrievances = facultyGrievances
      ? grievances.filter((grievance) => {
          if (String(grievance.assignedTo?._id || grievance.assignedTo || "") === String(req.user._id)) {
            return true;
          }
          return String(grievance.marks?.updatedBy?._id || grievance.marks?.updatedBy || "") === String(req.user._id);
        })
      : grievances;

    res.json({
      grievances: visibleGrievances.map((g) => normalizeGrievance(g)),
    });
  } catch (e) {
    next(e);
  }
}

export async function createGrievance(req, res, next) {
  try {
    if (req.user.role !== "student") {
      return res.status(403).json({ message: "Only students can raise mark grievances." });
    }
    if (!req.user.studentRef) {
      return res.status(400).json({ message: "Student profile not linked." });
    }

    const body = req.body || {};
    const marksId = String(body.marksId || body.marks || "").trim();
    const justification = String(body.justification || "").trim();
    const supportingDetails = String(body.supportingDetails || "").trim();
    if (!marksId) return res.status(400).json({ message: "marksId required" });
    if (justification.length < 10) {
      return res.status(400).json({ message: "Justification must be at least 10 characters." });
    }

    const mark = await Marks.findById(marksId)
      .populate("student", "name rollNumber section")
      .populate("updatedBy", "name username role")
      .lean();
    if (!mark) return res.status(404).json({ message: "Marks not found" });
    if (!mark.student || String(mark.student._id) !== String(req.user.studentRef)) {
      return res.status(403).json({ message: "Not allowed" });
    }

    const deadlineAt = grievanceDeadlineForMark(mark);
    if (!deadlineAt) {
      return res.status(400).json({ message: "This mark does not have a valid release time yet." });
    }
    if (Date.now() > deadlineAt.getTime()) {
      return res.status(403).json({ message: "The 3-day grievance window for this mark has closed." });
    }

    const existingOpen = await Grievance.findOne({
      student: req.user.studentRef,
      marks: mark._id,
      status: { $in: OPEN_STATUSES },
    }).lean();
    if (existingOpen) {
      return res.status(409).json({
        message: "A grievance for this mark is already pending or under review.",
      });
    }

    const releaseDate = resolveMarkReleaseDate(mark);
    const assignedTo = mark.updatedBy?._id || null;
    const grievance = await Grievance.create({
      student: req.user.studentRef,
      marks: mark._id,
      subject: String(mark.subject || "").trim(),
      term: String(mark.term || "").trim(),
      releasedAt: releaseDate,
      deadlineAt,
      justification,
      supportingDetails,
      status: "pending",
      submittedBy: req.user._id,
      assignedTo,
    });

    await logActivity({
      actorId: req.user._id,
      actorName: req.user.name,
      action: "grievance.create",
      details: `Grievance for ${mark.subject} / ${mark.term || "default term"}`,
    });

    const populated = await Grievance.findById(grievance._id)
      .populate("student", "name rollNumber section")
      .populate("marks", "subject term final releasedAt createdAt updatedAt student")
      .populate("submittedBy", "name username")
      .populate("assignedTo", "name username role")
      .populate("reviewedBy", "name username")
      .lean();

    res.status(201).json({ grievance: normalizeGrievance(populated) });
  } catch (e) {
    if (e?.code === 11000) {
      return res.status(409).json({
        message: "A grievance for this mark is already pending or under review.",
      });
    }
    next(e);
  }
}

export async function updateGrievance(req, res, next) {
  try {
    const grievance = await Grievance.findById(req.params.id).populate("marks", "updatedBy");
    if (!grievance) return res.status(404).json({ message: "Grievance not found" });

    if (req.user.role === "student") {
      return res.status(403).json({ message: "Not allowed" });
    }
    const grievanceOwnerId = grievance.assignedTo?._id || grievance.assignedTo || grievance.marks?.updatedBy?._id || grievance.marks?.updatedBy;
    if (req.user.role === "faculty" && String(grievanceOwnerId || "") !== String(req.user._id)) {
      return res.status(403).json({ message: "Not allowed" });
    }

    const { status, resolutionNote } = req.body || {};
    const nextStatus = String(status || "").trim();
    if (!["pending", "under_review", "resolved", "rejected"].includes(nextStatus)) {
      return res.status(400).json({ message: "Invalid grievance status." });
    }

    grievance.status = nextStatus;
    if (resolutionNote != null) grievance.resolutionNote = String(resolutionNote).trim();
    grievance.reviewedBy = req.user._id;
    grievance.reviewedAt = new Date();
    await grievance.save();

    await logActivity({
      actorId: req.user._id,
      actorName: req.user.name,
      action: `grievance.${nextStatus}`,
      details: `Grievance ${grievance._id} set to ${nextStatus}`,
    });

    const populated = await Grievance.findById(grievance._id)
      .populate("student", "name rollNumber section")
      .populate("marks", "subject term final releasedAt createdAt updatedAt student")
      .populate("submittedBy", "name username")
      .populate("assignedTo", "name username role")
      .populate("reviewedBy", "name username")
      .lean();

    res.json({ grievance: normalizeGrievance(populated) });
  } catch (e) {
    next(e);
  }
}
