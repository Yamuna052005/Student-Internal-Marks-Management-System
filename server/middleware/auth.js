import jwt from "jsonwebtoken";
import { User } from "../models/User.js";

export function authRequired(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ message: "Authentication required" });
  }
  try {
    const secret = process.env.JWT_SECRET;
    if (!secret) throw new Error("JWT_SECRET not configured");
    const payload = jwt.verify(token, secret);
    req.auth = payload;
    next();
  } catch {
    return res.status(401).json({ message: "Invalid or expired token" });
  }
}

export async function attachUser(req, res, next) {
  try {
    if (!req.auth?.sub) return res.status(401).json({ message: "Invalid token payload" });
    const user = await User.findById(req.auth.sub).select("-passwordHash").lean();
    if (!user) return res.status(401).json({ message: "User not found" });
    req.user = { ...user, _id: user._id, id: user._id };
    next();
  } catch (e) {
    next(e);
  }
}
