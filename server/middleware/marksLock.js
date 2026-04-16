import { getSettingsDoc } from "../utils/ensureSettings.js";
import { MarksApproval } from "../models/MarksApproval.js";

/**
 * After marksDeadline, faculty cannot mutate marks. Admin always can.
 */
export async function marksEditGuard(req, res, next) {
  try {
    if (req.user?.role === "admin") return next();
    const settings = await getSettingsDoc();
    const deadline = settings.marksDeadline ? new Date(settings.marksDeadline) : null;
    if (!deadline || Number.isNaN(deadline.getTime())) return next();
    if (Date.now() > deadline.getTime()) {
      const approved = await MarksApproval.findOne({
        faculty: req.user?._id,
        status: "approved",
        deadlineSnapshot: deadline,
      })
        .sort({ reviewedAt: -1, createdAt: -1 })
        .lean();
      if (approved) return next();

      return res.status(403).json({
        message: "Marks entry is locked after the deadline. Request admin approval to continue.",
        code: "MARKS_LOCKED",
        deadline: deadline.toISOString(),
      });
    }
    next();
  } catch (e) {
    next(e);
  }
}
