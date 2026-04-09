import mongoose from "mongoose";

const remedialSchema = new mongoose.Schema(
  {
    student: { type: mongoose.Schema.Types.ObjectId, ref: "Student", required: true, index: true },
    marks: { type: mongoose.Schema.Types.ObjectId, ref: "Marks", required: true },
    beforeFinal: { type: Number, required: true },
    afterFinal: { type: Number, required: true },
    improvement: { type: Number, default: 0 },
    notes: { type: String, default: "", maxlength: 2000 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true }
);

remedialSchema.index({ createdAt: -1 });

export const RemedialSession = mongoose.model("RemedialSession", remedialSchema);
