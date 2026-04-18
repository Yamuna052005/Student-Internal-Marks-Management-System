import bcrypt from "bcryptjs";
import { User } from "./models/User.js";
import { Student } from "./models/Student.js";
import { Marks } from "./models/Marks.js";
import { logActivity } from "./utils/activity.js";
import {
  computeMarksPayload,
  computeCombinedAtRisk,
  detectInternalAnomaly,
  detectFinalSpike,
} from "./utils/calcMarks.js";
import { getSettingsDoc } from "./utils/ensureSettings.js";

export async function seedAdminIfNeeded() {
  const count = await User.countDocuments();
  if (count > 0) return;

  const adminUser = process.env.SEED_ADMIN_USERNAME || "admin";
  const adminPass = process.env.SEED_ADMIN_PASSWORD || "admin123";
  const facultyPass = process.env.SEED_FACULTY_PASSWORD || "faculty123";
  const demoStudentRoll = "2271126";

  const adminHash = await bcrypt.hash(adminPass, 12);
  const facultyHash = await bcrypt.hash(facultyPass, 12);
  const studentHash = await bcrypt.hash("student123", 12);

  const admin = await User.create({
    username: adminUser.toLowerCase(),
    name: "Administrator",
    email: "admin@simms.local",
    passwordHash: adminHash,
    role: "admin",
  });

  const faculty = await User.create({
    username: "faculty",
    name: "Demo Faculty",
    email: "faculty@simms.local",
    passwordHash: facultyHash,
    role: "faculty",
  });

  const demoStudent = await Student.create({
    name: "Alex Rivera",
    rollNumber: demoStudentRoll,
    section: "A",
    createdBy: faculty._id,
  });

  const studentUser = await User.create({
    username: "student",
    name: "Alex Rivera",
    email: "student@simms.local",
    passwordHash: studentHash,
    role: "student",
    studentRef: demoStudent._id,
  });

  const settings = await getSettingsDoc();
  const threshold = settings.riskThreshold ?? 40;

  const sampleMarks = [
    { subject: "Data Structures", mid1: 18, mid2: 14, assignment: 12, lab: 16 },
    { subject: "Operating Systems", mid1: 12, mid2: 10, assignment: 10, lab: 9 },
  ];

  const term =
    String(settings.defaultTerm || "2025-T1").trim() || "2025-T1";
  for (const sm of sampleMarks) {
    const c = computeMarksPayload(sm);
    const atRisk = computeCombinedAtRisk(c.final, threshold, c.internal1, c.internal2);
    const anomaly =
      detectInternalAnomaly(c.internal1, c.internal2) || detectFinalSpike(null, c.final);
    await Marks.create({
      student: demoStudent._id,
      subject: sm.subject,
      term,
      ...c,
      atRisk,
      anomaly,
      releasedAt: new Date(),
      priorFinal: null,
      updatedBy: faculty._id,
    });
  }

  await logActivity({
    actorId: admin._id,
    actorName: admin.name,
    action: "seed",
    details: `Seeded demo users (${adminUser}, faculty, student) and sample marks.`,
  });

  return { admin, faculty, studentUser, demoStudent };
}

export async function restoreDemoStudentUsername() {
  const demoRoll = "2271126";
  const demoStudent = await Student.findOne({ rollNumber: demoRoll }).select("_id").lean();
  if (!demoStudent) return;
  const studentUser = await User.findOne({ role: "student", studentRef: demoStudent._id }).select("_id").lean();
  if (!studentUser) return;
  const studentHash = await bcrypt.hash("student123", 12);
  await User.updateOne(
    { _id: studentUser._id },
    { $set: { username: "student", passwordHash: studentHash } }
  );
}
