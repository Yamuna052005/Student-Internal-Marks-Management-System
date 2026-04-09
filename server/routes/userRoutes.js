import { Router } from "express";
import * as c from "../controllers/userController.js";
import { authRequired, attachUser } from "../middleware/auth.js";
import { requireRoles } from "../middleware/role.js";

const r = Router();
r.use(authRequired, attachUser, requireRoles("admin"));
r.get("/", c.listUsers);
r.post("/", c.createUser);
r.patch("/:id", c.updateUser);
r.delete("/:id", c.deleteUser);
export default r;
