import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { User } from "../models/User.js";
import { logActivity } from "../utils/activity.js";

function signToken(userId, role) {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET not configured");
  const expires = process.env.JWT_EXPIRES || "7d";
  return jwt.sign({ sub: userId.toString(), role }, secret, { expiresIn: expires });
}

export async function login(req, res, next) {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ message: "Username and password required" });
    }
    const user = await User.findOne({ username: String(username).trim().toLowerCase() });
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

    res.json({
      token,
      user: {
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
    res.json({ user: req.user });
  } catch (e) {
    next(e);
  }
}
