import bcrypt from "bcryptjs";
import { User } from "../models/User.js";
import { Student } from "../models/Student.js";
import { Marks } from "../models/Marks.js";
import { logActivity } from "../utils/activity.js";

async function userJson(id) {
  return User.findById(id)
    .select("-passwordHash")
    .populate({ path: "studentRef", select: "name rollNumber section createdBy" })
    .lean();
}

export async function listUsers(req, res, next) {
  try {
    const users = await User.find()
      .select("-passwordHash")
      .populate({ path: "studentRef", select: "name rollNumber section createdBy" })
      .sort({ createdAt: -1 })
      .lean();
    res.json({ users });
  } catch (e) {
    next(e);
  }
}

export async function createUser(req, res, next) {
  try {
    const { username, name, email, password, role, rollNumber, section, facultyId } = req.body || {};
    if (!username || !name || !role) {
      return res.status(400).json({ message: "username, name, role required" });
    }
    if (!["admin", "faculty", "student"].includes(role)) {
      return res.status(400).json({ message: "Invalid role" });
    }
    const exists = await User.findOne({ username: String(username).trim().toLowerCase() });
    if (exists) return res.status(409).json({ message: "Username already exists" });

    const finalPassword = password || (role === "student" ? "student123" : null);
    if (!finalPassword) {
      return res.status(400).json({ message: "password required" });
    }
    const passwordHash = await bcrypt.hash(String(finalPassword), 12);

    let studentRef;
    if (role === "student") {
      let rosterOwner = req.user._id;
      if (facultyId) {
        const fac = await User.findById(facultyId).select("role").lean();
        if (!fac || fac.role !== "faculty") {
          return res.status(400).json({ message: "facultyId must reference a faculty account" });
        }
        rosterOwner = fac._id;
      }
        const st = await Student.create({
          name: String(name).trim(),
          rollNumber: rollNumber != null ? String(rollNumber).trim() : "",
          section: section != null ? String(section).trim() : "",
          createdBy: rosterOwner,
        });
      studentRef = st._id;
    }

    const user = await User.create({
      username: String(username).trim().toLowerCase(),
      name: String(name).trim(),
      email: email ? String(email).trim().toLowerCase() : undefined,
      passwordHash,
      role,
      ...(studentRef ? { studentRef } : {}),
    });

    await logActivity({
      actorId: req.user._id,
      actorName: req.user.name,
      action: "user.create",
      details: `Created user ${user.username} (${user.role})`,
    });

    const out = await userJson(user._id);
    res.status(201).json({ user: out });
  } catch (e) {
    next(e);
  }
}

export async function updateUser(req, res, next) {
  try {
    const { id } = req.params;
    const { username, name, email, password, role, rollNumber, section, facultyId } = req.body || {};
    const user = await User.findById(id);
    if (!user) return res.status(404).json({ message: "User not found" });

    const prevRole = user.role;

    if (username != null) user.username = String(username).trim().toLowerCase();
    if (name != null) user.name = String(name).trim();
    if (email !== undefined) user.email = email ? String(email).trim().toLowerCase() : "";
    if (password) user.passwordHash = await bcrypt.hash(String(password), 12);

    if (role != null) {
      if (!["admin", "faculty", "student"].includes(role)) {
        return res.status(400).json({ message: "Invalid role" });
      }
      if (role !== prevRole) {
        if (prevRole === "student" && role !== "student") {
          user.studentRef = null;
        }
        user.role = role;
      }
    }

    if (user.role === "student") {
      if (!user.studentRef) {
        let rosterOwner = req.user._id;
        if (facultyId) {
          const fac = await User.findById(facultyId).select("role").lean();
          if (!fac || fac.role !== "faculty") {
            return res.status(400).json({ message: "facultyId must reference a faculty account" });
          }
          rosterOwner = fac._id;
        }
        const st = await Student.create({
          name: String(name ?? user.name).trim(),
          rollNumber: rollNumber != null ? String(rollNumber).trim() : "",
          section: section != null ? String(section).trim() : "",
          createdBy: rosterOwner,
        });
        user.studentRef = st._id;
      } else {
        const st = await Student.findById(user.studentRef);
        if (st) {
          st.name = String(name != null ? name : user.name).trim();
          if (rollNumber !== undefined) st.rollNumber = rollNumber != null ? String(rollNumber).trim() : "";
          if (section !== undefined) st.section = section != null ? String(section).trim() : "";
          if (facultyId) {
            const fac = await User.findById(facultyId).select("role").lean();
            if (!fac || fac.role !== "faculty") {
              return res.status(400).json({ message: "facultyId must reference a faculty account" });
            }
            st.createdBy = fac._id;
          }
          await st.save();
        }
      }
    }

    await user.save();
    await logActivity({
      actorId: req.user._id,
      actorName: req.user.name,
      action: "user.update",
      details: `Updated user ${user.username}`,
    });

    const out = await userJson(user._id);
    res.json({ user: out });
  } catch (e) {
    next(e);
  }
}

export async function deleteUser(req, res, next) {
  try {
    const { id } = req.params;
    if (String(id) === String(req.user._id)) {
      return res.status(400).json({ message: "Cannot delete your own account" });
    }
    const user = await User.findById(id);
    if (!user) return res.status(404).json({ message: "User not found" });

    if (user.role === "student" && user.studentRef) {
      const n = await Marks.countDocuments({ student: user.studentRef });
      if (n > 0) {
        return res.status(400).json({
          message: "Cannot delete this student account while marks exist. Remove marks for the student first.",
        });
      }
      await Student.findByIdAndDelete(user.studentRef);
    }

    await User.findByIdAndDelete(id);

    await logActivity({
      actorId: req.user._id,
      actorName: req.user.name,
      action: "user.delete",
      details: `Deleted user ${user.username}`,
    });

    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
}
