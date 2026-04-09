import { AppSettings } from "../models/AppSettings.js";

export async function ensureDefaultSettings() {
  await AppSettings.findOneAndUpdate(
    { singletonKey: "global" },
    { $setOnInsert: { singletonKey: "global", defaultTerm: "2025-T1" } },
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
  return doc;
}
