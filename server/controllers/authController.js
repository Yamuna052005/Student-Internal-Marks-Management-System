import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { User } from "../models/User.js";
import { Student } from "../models/Student.js";
import { logActivity } from "../utils/activity.js";

async function buildAuthUser(userId) {
  const user = await User.findById(userId)
    .select("-passwordHash")
    .populate("studentRef", "name rollNumber section createdBy")
    .lean();
  if (!user) return null;
  const studentDoc = user.studentRef && typeof user.studentRef === "object" ? user.studentRef : null;
  return {
    ...user,
    id: user._id,
    studentRef: studentDoc?._id != null ? String(studentDoc._id) : user.studentRef != null ? String(user.studentRef) : undefined,
    ...(studentDoc ? { studentProfile: { ...studentDoc, _id: String(studentDoc._id) } } : {}),
  };
}

function signToken(userId, role) {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET not configured");
  const expires = process.env.JWT_EXPIRES || "7d";
  return jwt.sign({ sub: userId.toString(), role }, secret, { expiresIn: expires });
}

function escapeRegex(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function findLoginUser(loginId) {
  const normalized = String(loginId || "").trim();
  if (!normalized) return null;

  const byUsername = await User.findOne({ username: normalized.toLowerCase() });
  if (byUsername) return byUsername;

  const student = await Student.findOne({
    rollNumber: new RegExp(`^${escapeRegex(normalized)}$`, "i"),
  }).select("_id").lean();
  if (!student) return null;

  return User.findOne({ role: "student", studentRef: student._id });
}

export async function login(req, res, next) {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ message: "Username and password required" });
    }
    const loginId = String(username).trim();
    let user = await findLoginUser(loginId);
    if (!user) return res.status(401).json({ message: "Invalid credentials" });
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.status(401).json({ message: "Invalid credentials" });

    const token = signToken(user._id, user.role);
    await logActivity({
      actorId: user._id,
      actorName: user.name,
      action: "auth.login",
      details: `User ${user.username} logged in`,
    });

    const authUser = await buildAuthUser(user._id);
    res.json({
      token,
      user: authUser || {
        id: user._id,
        username: user.username,
        name: user.name,
        role: user.role,
        email: user.email,
        studentRef: user.studentRef != null ? String(user.studentRef) : undefined,
      },
    });
  } catch (e) {
    next(e);
  }
}

export async function me(req, res, next) {
  try {
    const user = await buildAuthUser(req.user?._id);
    res.json({ user: user || req.user });
  } catch (e) {
    next(e);
  }
}

export async function changePassword(req, res, next) {
  try {
    const { username, currentPassword, newPassword } = req.body || {};
    const loginId = String(username || "").trim();
    if (!loginId || !currentPassword || !newPassword) {
      return res.status(400).json({ message: "Username, current password, and new password are required" });
    }
    if (String(newPassword).trim().length < 6) {
      return res.status(400).json({ message: "New password must be at least 6 characters long" });
    }

    const user = await findLoginUser(loginId);
    if (!user) return res.status(401).json({ message: "Invalid credentials" });

    const ok = await bcrypt.compare(String(currentPassword), user.passwordHash);
    if (!ok) return res.status(400).json({ message: "Current password is incorrect" });

    user.passwordHash = await bcrypt.hash(String(newPassword), 12);
    await user.save();

    await logActivity({
      actorId: user._id,
      actorName: user.name,
      action: "auth.password.change",
      details: `Password changed for ${user.username}`,
    });

    const authUser = await buildAuthUser(user._id);
    res.json({ ok: true, user: authUser });
  } catch (e) {
    next(e);
  }
}
