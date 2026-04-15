import mongoose from "mongoose";

const marksSchema = new mongoose.Schema(
  {
    student: { type: mongoose.Schema.Types.ObjectId, ref: "Student", required: true, index: true },
    subject: { type: String, required: true, trim: true, index: true },
    term: { type: String, required: true, trim: true, index: true },
    mid1: { type: Number, default: 0, min: 0, max: 20 },
    mid2: { type: Number, default: 0, min: 0, max: 20 },
    assignment: { type: Number, default: 0, min: 0, max: 5 },
    lab: { type: Number, default: 0, min: 0, max: 5 },
    internal1: { type: Number, default: 0, min: 0, max: 25 },
    internal2: { type: Number, default: 0, min: 0, max: 25 },
    final: { type: Number, default: 0, min: 0, max: 25, index: true },
    bestKey: { type: String, enum: ["internal1", "internal2"], default: "internal1" },
    atRisk: { type: Boolean, default: false, index: true },
    anomaly: { type: Boolean, default: false, index: true },
    priorFinal: { type: Number, default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

marksSchema.index({ student: 1, subject: 1, term: 1 }, { unique: true });
marksSchema.index({ final: -1 });
marksSchema.index({ createdAt: -1 });
marksSchema.index({ student: 1, atRisk: 1 });
marksSchema.index({ atRisk: 1, final: 1 });
marksSchema.index({ anomaly: 1, updatedAt: -1 });

export const Marks = mongoose.model("Marks", marksSchema);
