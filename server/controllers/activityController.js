import { ActivityLog } from "../models/ActivityLog.js";

export async function listActivity(req, res, next) {
  try {
    const { limit = 200 } = req.query;
    const l = Math.min(500, Math.max(1, Number(limit) || 200));
    const items = await ActivityLog.find().sort({ createdAt: -1 }).limit(l).lean();
    res.json({ activity: items });
  } catch (e) {
    next(e);
  }
}

export async function exportActivityCsv(req, res, next) {
  try {
    const items = await ActivityLog.find().sort({ createdAt: -1 }).limit(2000).lean();
    const esc = (v) => {
      const s = String(v ?? "");
      if (s.includes('"') || s.includes(",") || s.includes("\n")) return `"${s.replaceAll('"', '""')}"`;
      return s;
    };
    const head = ["At", "Action", "Actor", "Details"];
    const lines = [head.join(",")];
    for (const a of items) {
      lines.push(
        [a.createdAt, a.action, a.actorName || "", a.details || ""].map(esc).join(",")
      );
    }
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="simms_activity.csv"`);
    res.send(lines.join("\n"));
  } catch (e) {
    next(e);
  }
}
