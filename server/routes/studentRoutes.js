import { Router } from "express";
import * as c from "../controllers/studentController.js";
import * as ar from "../controllers/academicReportController.js";
import { authRequired, attachUser } from "../middleware/auth.js";
import { requireRoles } from "../middleware/role.js";

const r = Router();
r.use(authRequired, attachUser);
r.get("/", requireRoles("admin", "faculty"), c.listStudents);
r.post("/", requireRoles("admin", "faculty"), c.createStudent);
r.get(
  "/:id/academic-report",
  requireRoles("admin", "faculty", "student"),
  ar.getStudentAcademicReport
);
r.patch("/:id", requireRoles("admin", "faculty"), c.updateStudent);
r.delete("/:id", requireRoles("admin", "faculty"), c.deleteStudent);
export default r;
