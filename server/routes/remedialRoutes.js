import { Router } from "express";
import * as c from "../controllers/remedialController.js";
import { authRequired, attachUser } from "../middleware/auth.js";
import { requireRoles } from "../middleware/role.js";
import { marksEditGuard } from "../middleware/marksLock.js";

const r = Router();
r.use(authRequired, attachUser);
r.get("/", requireRoles("admin", "faculty"), c.listRemedials);
r.post("/", requireRoles("admin", "faculty"), marksEditGuard, c.createRemedial);
export default r;
