import { ActivityLog } from "../models/ActivityLog.js";

export async function logActivity({ actorId, actorName, action, details, meta }) {
  await ActivityLog.create({
    actor: actorId || null,
    actorName: actorName || "",
    action,
    details: details || "",
    meta: meta || {},
  });
}
