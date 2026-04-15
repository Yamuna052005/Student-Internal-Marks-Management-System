import { AppSettings } from "../models/AppSettings.js";

function clampSetting(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(30, n));
}

export async function ensureDefaultSettings() {
  await AppSettings.findOneAndUpdate(
    { singletonKey: "global" },
    { $setOnInsert: { singletonKey: "global", defaultTerm: "2025-T1", riskThreshold: 16, passMark: 16 } },
    { upsert: true, new: true }
  );
  await AppSettings.updateMany(
    {
      singletonKey: "global",
      $or: [{ defaultTerm: { $exists: false } }, { defaultTerm: null }, { defaultTerm: "" }],
    },
    { $set: { defaultTerm: "2025-T1" } }
  );
}

export async function getSettingsDoc() {
  let doc = await AppSettings.findOne({ singletonKey: "global" });
  if (!doc) doc = await AppSettings.create({ singletonKey: "global" });
  let changed = false;
  const nextRisk = clampSetting(doc.riskThreshold, 16);
  const nextPass = clampSetting(doc.passMark, 16);
  if (doc.riskThreshold !== nextRisk) {
    doc.riskThreshold = nextRisk;
    changed = true;
  }
  if (doc.passMark !== nextPass) {
    doc.passMark = nextPass;
    changed = true;
  }
  if (changed) await doc.save();
  return doc;
}
