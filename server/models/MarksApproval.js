import mongoose from "mongoose";

const marksApprovalSchema = new mongoose.Schema(
  {
    faculty: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
      index: true,
    },
    requestNote: { type: String, trim: true, default: "" },
    reviewNote: { type: String, trim: true, default: "" },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    reviewedAt: { type: Date, default: null },
    deadlineSnapshot: { type: Date, default: null },
  },
  { timestamps: true }
);

marksApprovalSchema.index({ faculty: 1, status: 1, createdAt: -1 });
marksApprovalSchema.index({ faculty: 1, deadlineSnapshot: 1 }, { unique: true });

export const MarksApproval = mongoose.model("MarksApproval", marksApprovalSchema);
