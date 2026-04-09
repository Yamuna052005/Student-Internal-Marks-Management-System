import { Student } from "../models/Student.js";
import { User } from "../models/User.js";
import { Marks } from "../models/Marks.js";
import { RemedialSession } from "../models/RemedialSession.js";
import bcrypt from "bcryptjs";
import { logActivity } from "../utils/activity.js";

export async function listStudents(req, res, next) {
  try {
    const { search = "", page = 1, limit = 20 } = req.query;
    const q = String(search).trim();
    const filter = q
      ? {
          $or: [
            { name: new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") },
            { rollNumber: new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") },
          ],
        }
      : {};

    const p = Math.max(1, Number(page) || 1);
    const l = Math.min(100, Math.max(1, Number(limit) || 20));
    const [items, total] = await Promise.all([
      Student.find(filter).sort({ createdAt: -1 }).skip((p - 1) * l).limit(l).lean(),
      Student.countDocuments(filter),
    ]);

    res.json({ students: items, page: p, limit: l, total });
  } catch (e) {
    next(e);
  }
}

export async function createStudent(req, res, next) {
  try {
    const { name, rollNumber, section } = req.body || {};
    if (!name) return res.status(400).json({ message: "name required" });
    if (!rollNumber) return res.status(400).json({ message: "rollNumber required for account" });

    const normalizedName = String(name).trim().toLowerCase().replace(/\s+/g, "");
    const existing = await User.findOne({ username: normalizedName });
    if (existing) return res.status(409).json({ message: "User with this name-based username already exists. Try adding a unique identifier or middle name." });

    const st = await Student.create({
      name: String(name).trim(),
      rollNumber: String(rollNumber).trim(),
      section: section != null ? String(section).trim() : "",
      createdBy: req.user._id,
    });

    const passwordHash = await bcrypt.hash("student123", 12);
    await User.create({
      username: normalizedName,
      name: st.name,
      passwordHash,
      role: "student",
      studentRef: st._id,
    });

    await logActivity({
      actorId: req.user._id,
      actorName: req.user.name,
      action: "student.create",
      details: `Created student ${st.name} and user account ${normalizedName}`,
    });
    res.status(201).json({ student: st });
  } catch (e) {
    next(e);
  }
}

export async function updateStudent(req, res, next) {
  try {
    const { id } = req.params;
    const { name, rollNumber, section } = req.body || {};
    const st = await Student.findById(id);
    if (!st) return res.status(404).json({ message: "Student not found" });

    const oldRoll = st.rollNumber;
    if (name != null) st.name = String(name).trim();
    if (rollNumber != null) st.rollNumber = String(rollNumber).trim();
    if (section != null) st.section = String(section).trim();
    await st.save();

    // Sync to User
    const user = await User.findOne({ studentRef: st._id });
    if (user) {
      if (name != null) {
        user.name = st.name;
        user.username = st.name.toLowerCase().replace(/\s+/g, "");
      }
      await user.save();
    }

    await logActivity({
      actorId: req.user._id,
      actorName: req.user.name,
      action: "student.update",
      details: `Updated student ${st.name}`,
    });
    res.json({ student: st });
  } catch (e) {
    next(e);
  }
}

export async function deleteStudent(req, res, next) {
  try {
    const { id } = req.params;
    const st = await Student.findById(id);
    if (!st) return res.status(404).json({ message: "Student not found" });
    
    // Remove all associated records
    await Promise.all([
      User.findOneAndDelete({ studentRef: st._id }),
      Marks.deleteMany({ student: st._id }),
      RemedialSession.deleteMany({ student: st._id }),
    ]);
    
    await Student.findByIdAndDelete(id);
    await logActivity({
      actorId: req.user._id,
      actorName: req.user.name,
      action: "student.delete",
      details: `Deleted student ${st.name}`,
    });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
}
