import { Router } from "express";
import * as c from "../controllers/activityController.js";
import { authRequired, attachUser } from "../middleware/auth.js";
import { requireRoles } from "../middleware/role.js";

const r = Router();
r.use(authRequired, attachUser);
r.get("/", requireRoles("admin", "faculty"), c.listActivity);
r.get("/export/csv", requireRoles("admin"), c.exportActivityCsv);
export default r;
