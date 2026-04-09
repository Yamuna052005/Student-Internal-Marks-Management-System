import { Router } from "express";
import {
  summary,
  trendStudents,
  trendSubjects,
  studentSubjectSeries,
} from "../controllers/analyticsController.js";
import { authRequired, attachUser } from "../middleware/auth.js";
import { requireRoles } from "../middleware/role.js";

const r = Router();
const analyticsRoles = requireRoles("admin", "faculty", "student");
r.get("/summary", authRequired, attachUser, analyticsRoles, summary);
r.get("/trend/students", authRequired, attachUser, analyticsRoles, trendStudents);
r.get("/trend/subjects", authRequired, attachUser, analyticsRoles, trendSubjects);
r.get("/trend/series", authRequired, attachUser, analyticsRoles, studentSubjectSeries);
export default r;
