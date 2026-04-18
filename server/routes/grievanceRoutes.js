import { Router } from "express";
import * as c from "../controllers/grievanceController.js";
import { authRequired, attachUser } from "../middleware/auth.js";
import { requireRoles } from "../middleware/role.js";

const r = Router();

r.use(authRequired, attachUser);
r.get("/", requireRoles("admin", "faculty", "student"), c.listGrievances);
r.post("/", requireRoles("student"), c.createGrievance);
r.patch("/:id", requireRoles("admin", "faculty"), c.updateGrievance);

export default r;
