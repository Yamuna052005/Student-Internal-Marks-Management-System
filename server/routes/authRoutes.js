import { Router } from "express";
import { login, me } from "../controllers/authController.js";
import { authRequired, attachUser } from "../middleware/auth.js";

const r = Router();
r.post("/login", login);
r.get("/me", authRequired, attachUser, me);
export default r;
