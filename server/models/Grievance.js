import mongoose from "mongoose";

const grievanceSchema = new mongoose.Schema(
  {
    student: { type: mongoose.Schema.Types.ObjectId, ref: "Student", required: true, index: true },
    marks: { type: mongoose.Schema.Types.ObjectId, ref: "Marks", required: true, index: true },
    subject: { type: String, required: true, trim: true, index: true },
    term: { type: String, required: true, trim: true, index: true },
    releasedAt: { type: Date, required: true, index: true },
    deadlineAt: { type: Date, required: true, index: true },
    justification: { type: String, required: true, trim: true, minlength: 10, maxlength: 2000 },
    supportingDetails: { type: String, default: "", trim: true, maxlength: 4000 },
    status: {
      type: String,
      enum: ["pending", "under_review", "resolved", "rejected"],
      default: "pending",
      index: true,
    },
    submittedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    reviewedAt: { type: Date, default: null },
    resolutionNote: { type: String, default: "", trim: true, maxlength: 2000 },
  },
  { timestamps: true }
);

grievanceSchema.index(
  { student: 1, marks: 1 },
  {
    unique: true,
    partialFilterExpression: { status: { $in: ["pending", "under_review"] } },
  }
);
grievanceSchema.index({ student: 1, createdAt: -1 });
grievanceSchema.index({ marks: 1, createdAt: -1 });
grievanceSchema.index({ status: 1, updatedAt: -1 });

export const Grievance = mongoose.model("Grievance", grievanceSchema);
