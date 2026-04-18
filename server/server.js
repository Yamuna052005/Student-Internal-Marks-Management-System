import "dotenv/config";
import path from "path";
import express from "express";
import cors from "cors";
import { fileURLToPath } from "url";
import { connectDb } from "./config/db.js";
import { errorHandler } from "./middleware/errorHandler.js";
import authRoutes from "./routes/authRoutes.js";
import userRoutes from "./routes/userRoutes.js";
import studentRoutes from "./routes/studentRoutes.js";
import marksRoutes from "./routes/marksRoutes.js";
import analyticsRoutes from "./routes/analyticsRoutes.js";
import settingsRoutes from "./routes/settingsRoutes.js";
import remedialRoutes from "./routes/remedialRoutes.js";
import activityRoutes from "./routes/activityRoutes.js";
import marksApprovalRoutes from "./routes/marksApprovalRoutes.js";
import grievanceRoutes from "./routes/grievanceRoutes.js";
import { MarksApproval } from "./models/MarksApproval.js";
import { Grievance } from "./models/Grievance.js";
import { ensureDefaultSettings } from "./utils/ensureSettings.js";
import { migrateMarksTermAndIndexes } from "./utils/migrateMarksTerm.js";
import { restoreDemoStudentUsername, seedAdminIfNeeded } from "./seed.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDir = path.join(__dirname, "../client");

const app = express();
const PORT = Number(process.env.PORT) || 5000;

app.use(
  cors({
    origin: process.env.CLIENT_URL || true,
    credentials: true,
  })
);
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/students", studentRoutes);
app.use("/api/marks", marksRoutes);
app.use("/api/analytics", analyticsRoutes);
app.use("/api/settings", settingsRoutes);
app.use("/api/remedials", remedialRoutes);
app.use("/api/activity", activityRoutes);
app.use("/api/marks-approvals", marksApprovalRoutes);
app.use("/api/grievances", grievanceRoutes);

app.use(express.static(clientDir));

app.use(errorHandler);

async function boot() {
  const uri = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/simms";
  await connectDb(uri);
  await ensureDefaultSettings();
  await migrateMarksTermAndIndexes().catch((err) => console.error("Marks term migration:", err));
  await MarksApproval.syncIndexes().catch((err) => console.error("MarksApproval index sync:", err.message || err));
  await Grievance.syncIndexes().catch((err) => console.error("Grievance index sync:", err.message || err));
  await restoreDemoStudentUsername().catch((err) => console.error("Demo student restore:", err.message || err));
  await seedAdminIfNeeded();
  app.listen(PORT, () => {
    console.log(`SIMMS API + client on http://localhost:${PORT}`);
  });
}

boot().catch((err) => {
  console.error(err);
  process.exit(1);
});
