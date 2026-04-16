import { MarksApproval } from "../models/MarksApproval.js";
import { getSettingsDoc } from "../utils/ensureSettings.js";
import { logActivity } from "../utils/activity.js";

function approvalQueryForUser(user) {
  if (user?.role === "admin") return {};
  return { faculty: user?._id };
}

export async function listApprovals(req, res, next) {
  try {
    const approvals = await MarksApproval.find(approvalQueryForUser(req.user))
      .populate("faculty", "name username")
      .populate("reviewedBy", "name username")
      .sort({ createdAt: -1 })
      .lean();

    res.json({ approvals });
  } catch (e) {
    next(e);
  }
}

export async function createApproval(req, res, next) {
  try {
    const settings = await getSettingsDoc();
    const deadline = settings.marksDeadline ? new Date(settings.marksDeadline) : null;
    if (!deadline || Number.isNaN(deadline.getTime()) || Date.now() <= deadline.getTime()) {
      return res.status(400).json({ message: "Approval requests open only after the marks deadline." });
    }

    const active = await MarksApproval.findOne({
      faculty: req.user._id,
      deadlineSnapshot: deadline,
    }).sort({ createdAt: -1 });

    if (active) {
      return res.status(409).json({
        message:
          active.status === "approved"
            ? "An approved admin override already exists for this deadline."
            : active.status === "pending"
              ? "An approval request is already pending for this deadline."
              : "An approval request already exists for this deadline.",
      });
    }

    let doc;
    try {
      doc = await MarksApproval.create({
        faculty: req.user._id,
        requestNote: String(req.body?.requestNote || "").trim(),
        deadlineSnapshot: deadline,
      });
    } catch (e) {
      if (e?.code === 11000) {
        const existing = await MarksApproval.findOne({
          faculty: req.user._id,
          deadlineSnapshot: deadline,
        }).lean();
        return res.status(409).json({
          message:
            existing?.status === "approved"
              ? "An approved admin override already exists for this deadline."
              : existing?.status === "pending"
                ? "An approval request is already pending for this deadline."
                : "An approval request already exists for this deadline.",
        });
      }
      throw e;
    }

    await logActivity({
      actorId: req.user._id,
      actorName: req.user.name,
      action: "marks.approval.request",
      details: `Requested post-deadline marks access`,
      meta: { approvalId: String(doc._id) },
    });

    const populated = await MarksApproval.findById(doc._id)
      .populate("faculty", "name username")
      .populate("reviewedBy", "name username")
      .lean();

    res.status(201).json({ approval: populated });
  } catch (e) {
    next(e);
  }
}

export async function reviewApproval(req, res, next) {
  try {
    const { status, reviewNote } = req.body || {};
    if (!["approved", "rejected"].includes(String(status || ""))) {
      return res.status(400).json({ message: "status must be approved or rejected" });
    }

    const doc = await MarksApproval.findById(req.params.id);
    if (!doc) return res.status(404).json({ message: "Approval request not found" });

    if (!doc.deadlineSnapshot || Number.isNaN(new Date(doc.deadlineSnapshot).getTime())) {
      return res.status(400).json({ message: "Approval request is missing a valid deadline snapshot." });
    }

    doc.status = status;
    doc.reviewNote = String(reviewNote || "").trim();
    doc.reviewedBy = req.user._id;
    doc.reviewedAt = new Date();
    await doc.save();

    await logActivity({
      actorId: req.user._id,
      actorName: req.user.name,
      action: `marks.approval.${status}`,
      details: `${status === "approved" ? "Approved" : "Rejected"} post-deadline access for faculty request`,
      meta: { approvalId: String(doc._id), facultyId: String(doc.faculty) },
    });

    const populated = await MarksApproval.findById(doc._id)
      .populate("faculty", "name username")
      .populate("reviewedBy", "name username")
      .lean();

    res.json({ approval: populated });
  } catch (e) {
    next(e);
  }
}
