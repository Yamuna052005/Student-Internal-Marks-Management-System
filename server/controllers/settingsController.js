import { getSettingsDoc } from "../utils/ensureSettings.js";
import { logActivity } from "../utils/activity.js";

function clampSetting(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(30, n));
}

export async function getSettings(req, res, next) {
  try {
    const doc = await getSettingsDoc();
    res.json({
      marksDeadline: doc.marksDeadline,
      riskThreshold: doc.riskThreshold,
      passMark: doc.passMark,
      rowsPerPage: doc.rowsPerPage,
      defaultTerm: doc.defaultTerm ?? "2025-T1",
    });
  } catch (e) {
    next(e);
  }
}

export async function updateSettings(req, res, next) {
  try {
    const { marksDeadline, riskThreshold, passMark, rowsPerPage, defaultTerm } = req.body || {};
    const doc = await getSettingsDoc();

    if (marksDeadline !== undefined) {
      doc.marksDeadline = marksDeadline ? new Date(marksDeadline) : null;
    }
    if (riskThreshold !== undefined) doc.riskThreshold = clampSetting(riskThreshold, 16);
    if (passMark !== undefined) doc.passMark = clampSetting(passMark, 16);
    if (rowsPerPage !== undefined) doc.rowsPerPage = Number(rowsPerPage);
    if (defaultTerm !== undefined) doc.defaultTerm = String(defaultTerm || "").trim() || "2025-T1";

    await doc.save();

    await logActivity({
      actorId: req.user._id,
      actorName: req.user.name,
      action: "settings.update",
      details: "Updated application settings",
    });

    res.json({
      marksDeadline: doc.marksDeadline,
      riskThreshold: doc.riskThreshold,
      passMark: doc.passMark,
      rowsPerPage: doc.rowsPerPage,
      defaultTerm: doc.defaultTerm ?? "2025-T1",
    });
  } catch (e) {
    next(e);
  }
}
