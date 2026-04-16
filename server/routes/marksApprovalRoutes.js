import { Router } from "express";
import * as c from "../controllers/marksApprovalController.js";
import { authRequired, attachUser } from "../middleware/auth.js";
import { requireRoles } from "../middleware/role.js";

const r = Router();

r.use(authRequired, attachUser);
r.get("/", requireRoles("admin", "faculty"), c.listApprovals);
r.post("/", requireRoles("faculty"), c.createApproval);
r.patch("/:id", requireRoles("admin"), c.reviewApproval);

export default r;
