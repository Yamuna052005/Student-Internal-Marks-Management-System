import mongoose from "mongoose";

const studentSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    rollNumber: { type: String, trim: true, default: "" },
    section: { type: String, trim: true, default: "" },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  },
  { timestamps: true }
);

studentSchema.index({ name: 1 });
studentSchema.index({ createdAt: -1 });

export const Student = mongoose.model("Student", studentSchema);
