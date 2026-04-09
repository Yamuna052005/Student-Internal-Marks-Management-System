import { Router } from "express";
import multer from "multer";
import * as c from "../controllers/marksController.js";
import { authRequired, attachUser } from "../middleware/auth.js";
import { requireRoles } from "../middleware/role.js";
import { marksEditGuard } from "../middleware/marksLock.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
});

const r = Router();
r.use(authRequired, attachUser);

r.get("/export/csv", requireRoles("admin", "faculty"), c.exportMarksCsv);
r.get("/meta/terms", requireRoles("admin", "faculty", "student"), c.listDistinctTerms);
r.get("/", requireRoles("admin", "faculty", "student"), c.listMarks);

r.post("/bulk", requireRoles("admin", "faculty"), marksEditGuard, c.bulkCreateMarks);
r.post("/", requireRoles("admin", "faculty"), marksEditGuard, c.createMark);
r.post("/import/csv", requireRoles("admin", "faculty"), marksEditGuard, upload.single("file"), c.bulkCsv);
r.patch("/:id", requireRoles("admin", "faculty"), marksEditGuard, c.updateMark);
r.delete("/:id", requireRoles("admin", "faculty"), marksEditGuard, c.deleteMark);
r.get("/:id", requireRoles("admin", "faculty", "student"), c.getMark);

export default r;
