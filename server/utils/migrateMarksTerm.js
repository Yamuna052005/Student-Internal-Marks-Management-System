import { Marks } from "../models/Marks.js";
import { getSettingsDoc } from "./ensureSettings.js";

/**
 * Backfill `term` for legacy documents and sync indexes after schema change
 * (unique on student + subject + term).
 */
export async function migrateMarksTermAndIndexes() {
  const settings = await getSettingsDoc();
  const fallback = String(settings.defaultTerm || "legacy").trim() || "legacy";
  await Marks.updateMany(
    { $or: [{ term: { $exists: false } }, { term: null }, { term: "" }] },
    { $set: { term: fallback } }
  );
  try {
    await Marks.syncIndexes();
  } catch (e) {
    console.warn(
      "Marks.syncIndexes() failed (try restarting Mongo or dropping old index student_1_subject_1):",
      e.message
    );
  }
}
