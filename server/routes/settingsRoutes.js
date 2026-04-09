import { Router } from "express";
import * as c from "../controllers/settingsController.js";
import { authRequired, attachUser } from "../middleware/auth.js";
import { requireRoles } from "../middleware/role.js";

const r = Router();
r.get("/", authRequired, attachUser, c.getSettings);
r.patch("/", authRequired, attachUser, requireRoles("admin"), c.updateSettings);
export default r;
