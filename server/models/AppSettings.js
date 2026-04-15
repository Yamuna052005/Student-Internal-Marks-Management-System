import mongoose from "mongoose";

const appSettingsSchema = new mongoose.Schema(
  {
    singletonKey: { type: String, default: "global", unique: true },
    marksDeadline: { type: Date, default: null },
    riskThreshold: { type: Number, default: 16, min: 0, max: 30 },
    passMark: { type: Number, default: 16, min: 0, max: 30 },
    rowsPerPage: { type: Number, default: 15 },
    /** Default academic term for new marks and list/analytics filters (e.g. 2025-T1). */
    defaultTerm: { type: String, default: "2025-T1", trim: true },
  },
  { timestamps: true }
);

export const AppSettings = mongoose.model("AppSettings", appSettingsSchema);
