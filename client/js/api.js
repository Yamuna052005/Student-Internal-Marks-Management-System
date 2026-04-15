import {
  getDb,
  saveDb,
  calculateFinal,
  checkAnomaly,
  checkRisk,
  computeStudentRiskInsights,
  mockAcademicReport,
  ensureMockAutoRemedial,
  syncMockAutoRemedials,
} from "./mock-data.js";

const API_BASE = "/api";

/** Offline demo: set localStorage simms_use_mock=1 or append ?mock=1 to the URL. */
function useMockApi() {
  if (typeof window === "undefined") return false;
  try {
    if (new URLSearchParams(window.location.search).get("mock") === "1") return true;
    if (localStorage.getItem("simms_use_mock") === "1") return true;
  } catch (_) {
    /* ignore */
  }
  return false;
}

async function readErrorBody(res) {
  try {
    const j = await res.json();
    if (j.message) return j.message;
    if (j.error) return String(j.error);
  } catch (_) {
    /* ignore */
  }
  return `Request failed (${res.status})`;
}

export function getToken() {
  return localStorage.getItem("wsimms_token");
}

export function setToken(t) {
  if (t) localStorage.setItem("wsimms_token", t);
  else localStorage.removeItem("wsimms_token");
}

export function getUser() {
  const raw = localStorage.getItem("wsimms_user");
  return raw ? JSON.parse(raw) : null;
}

export function setUser(u) {
  if (u) localStorage.setItem("wsimms_user", JSON.stringify(u));
  else localStorage.removeItem("wsimms_user");
}

async function mockApi(path, options = {}) {
  const db = getDb();
  const [cleanPath, queryStr] = path.split("?");
  const params = new URLSearchParams(queryStr || "");

  const reconcileFacultyMockAtRisk = () => {
    const mu = getUser();
    if (mu && (mu.role === "admin" || mu.role === "faculty")) {
      syncMockAutoRemedials(db, mu._id || mu.id);
      (db.marks || []).forEach((m) => {
        m.atRisk = checkRisk(m.final, null, m.internal1, m.internal2);
      });
      saveDb(db);
    }
  };

  const enrichUserRow = (u) => {
    if (!u) return u;
    const plain = { ...u };
    delete plain.password;
    if (!u.studentRef) return plain;
    const st = (db.students || []).find((s) => s._id === u.studentRef);
    return { ...plain, studentRef: st ? { ...st } : null };
  };

  // ── AUTH ──────────────────────────────────────────────────────────────────
  if (cleanPath === "/auth/login") {
    const { username, password } = JSON.parse(options.body);
    const user = db.users.find(u => u.username === username);
    if (!user) throw new Error("Invalid credentials");
    
    // Check against custom password or a legacy fallback
    const validPass = user.password || `${username}123`;
    if (password === validPass) {
      return { ok: true, user: enrichUserRow(user), token: "mock_jwt_token" };
    }
    throw new Error("Invalid credentials");
  }

  if (cleanPath === "/auth/me") {
    const currentUser = getUser();
    if (!currentUser) throw new Error("Not authenticated");
    // Return fresh copy from db
    const dbUser = (db.users || []).find(u => u._id === currentUser._id) || currentUser;
    return { user: enrichUserRow(dbUser) };
  }

  // ── SETTINGS ──────────────────────────────────────────────────────────────
  if (cleanPath === "/settings") {
    if (options.method === "PATCH") {
      const payload = JSON.parse(options.body);
      db.settings = { ...db.settings, ...payload };
      saveDb(db);
    }
    return db.settings;
  }

  // ── USERS ─────────────────────────────────────────────────────────────────
  if (cleanPath.startsWith("/users")) {
    if (options.method === "POST") {
      const payload = JSON.parse(options.body || "{}");
      const uid = "u" + Date.now();
      const newUser = {
        _id: uid,
        username: String(payload.username || "").trim().toLowerCase(),
        name: payload.name,
        role: payload.role,
        email: payload.email,
      };
      if (payload.password) newUser.password = String(payload.password);
      db.users = db.users || [];
      if (payload.role === "student") {
        const sid = "s" + Date.now();
        let createdBy = getUser()?._id || db.users.find((x) => x.role === "admin")?._id || uid;
        if (payload.facultyId) {
          const fac = db.users.find((x) => x._id === payload.facultyId && x.role === "faculty");
          if (fac) createdBy = fac._id;
        }
        db.students = db.students || [];
        db.students.push({
          _id: sid,
          name: payload.name || payload.username,
          rollNumber: payload.rollNumber != null ? String(payload.rollNumber) : "",
          section: payload.section != null ? String(payload.section) : "",
          createdBy,
        });
        newUser.studentRef = sid;
      }
      db.users.push(newUser);
      saveDb(db);
      return { user: enrichUserRow(newUser) };
    }
    if (options.method === "PATCH") {
      const id = cleanPath.split("/").pop();
      if (id && id !== "users") {
        const payload = JSON.parse(options.body || "{}");
        const idx = (db.users || []).findIndex((u) => u._id === id);
        if (idx < 0) throw new Error("User not found");
        const prev = db.users[idx];
        const { rollNumber: _r, section: _s, facultyId: _f, password: pwdPatch, ...userPatch } = payload;
        const merged = { ...prev, ...userPatch };
        if (pwdPatch) merged.password = String(pwdPatch);
        if (payload.role != null && payload.role !== "student" && prev.role === "student") {
          merged.studentRef = undefined;
        }
        if (payload.role != null) merged.role = payload.role;
        if (merged.role === "student" && !merged.studentRef) {
          const sid = "s" + Date.now();
          let createdBy = getUser()?._id || db.users.find((x) => x.role === "admin")?._id;
          if (payload.facultyId) {
            const fac = db.users.find((x) => x._id === payload.facultyId && x.role === "faculty");
            if (fac) createdBy = fac._id;
          }
          db.students = db.students || [];
          db.students.push({
            _id: sid,
            name: merged.name,
            rollNumber: payload.rollNumber != null ? String(payload.rollNumber) : "",
            section: payload.section != null ? String(payload.section) : "",
            createdBy,
          });
          merged.studentRef = sid;
        }
        if (merged.role === "student" && merged.studentRef) {
          const si = (db.students || []).findIndex((s) => s._id === merged.studentRef);
          if (si >= 0) {
            const st = { ...db.students[si] };
            st.name = merged.name;
            if (payload.rollNumber !== undefined) st.rollNumber = payload.rollNumber != null ? String(payload.rollNumber) : "";
            if (payload.section !== undefined) st.section = payload.section != null ? String(payload.section) : "";
            if (payload.facultyId) {
              const fac = db.users.find((x) => x._id === payload.facultyId && x.role === "faculty");
              if (fac) st.createdBy = fac._id;
            }
            db.students[si] = st;
          }
        }
        db.users[idx] = merged;
        saveDb(db);
        return { user: enrichUserRow(merged) };
      }
    }
    if (options.method === "DELETE") {
      const id = cleanPath.split("/").pop();
      const user = (db.users || []).find((u) => u._id === id);
      if (user?.role === "student" && user.studentRef) {
        const hasMarks = (db.marks || []).some((m) => m.studentId === user.studentRef);
        if (hasMarks) throw new Error("Cannot delete: student has marks. Remove marks first.");
        db.students = (db.students || []).filter((s) => s._id !== user.studentRef);
      }
      db.users = (db.users || []).filter((u) => u._id !== id);
      saveDb(db);
      return { ok: true };
    }
    return { users: (db.users || []).map((u) => enrichUserRow(u)) };
  }

  // ── STUDENTS ──────────────────────────────────────────────────────────────
  if (cleanPath.startsWith("/students")) {
    const parts = cleanPath.split("/").filter(Boolean);
    const id = parts[1];
    const sub = parts[2];

    if (sub === "academic-report" && id && String(options.method || "GET").toUpperCase() === "GET") {
      const user = getUser();
      const selfRef = user?.studentId || user?.studentRef;
      const selfId = selfRef && typeof selfRef === "object" ? selfRef._id : selfRef;
      if (user?.role === "student" && String(selfId) !== String(id)) {
        throw new Error("Not allowed");
      }
      const rep = mockAcademicReport(db, id);
      if (!rep) throw new Error("Student not found");
      return rep;
    }

    if (options.method === "POST") {
      const payload = JSON.parse(options.body || "{}");
      const newSt = { _id: "s" + Date.now(), ...payload, createdAt: new Date().toISOString() };
      db.students = db.students || [];
      db.students.push(newSt);
      saveDb(db);
      return { student: newSt };
    }

    if (options.method === "PATCH" && id && sub !== "academic-report") {
      const payload = JSON.parse(options.body || "{}");
      db.students = (db.students || []).map(s =>
        s._id === id ? { ...s, ...payload } : s
      );
      saveDb(db);
      const updated = db.students.find(s => s._id === id);
      return { student: updated };
    }

    if (options.method === "DELETE" && id && sub !== "academic-report") {
      db.students = (db.students || []).filter(s => s._id !== id);
      db.users = (db.users || []).filter(u => u.studentRef !== id);
      saveDb(db);
      return { ok: true };
    }

    // GET list
    let students = db.students || [];
    const search = params.get("search")?.toLowerCase();
    if (search) {
      students = students.filter(s =>
        s.name?.toLowerCase().includes(search) ||
        s.rollNumber?.toLowerCase().includes(search) ||
        s.section?.toLowerCase().includes(search)
      );
    }
    return { students, total: students.length, limit: 100 };
  }

  // ── REMEDIALS ─────────────────────────────────────────────────────────────
  if (cleanPath === "/remedials") {
    if (options.method === "POST") {
      const payload = JSON.parse(options.body || "{}");
      const { marksId, afterFinal } = payload;
      if (marksId != null && afterFinal != null) {
        db.marks = db.marks || [];
        const idx = db.marks.findIndex((m) => String(m._id) === String(marksId));
        if (idx >= 0) {
          const m = db.marks[idx];
          const priorFinal = Number.isFinite(Number(m.final)) ? Number(m.final) : null;
          const after = Number(afterFinal);
          const settings = db.settings || {};
          db.marks[idx] = {
            ...m,
            final: after,
            priorFinal,
            atRisk: checkRisk(after, settings.riskThreshold || 16, m.internal1, m.internal2),
            anomaly: checkAnomaly({ ...m, final: after }, priorFinal),
          };
        }
      }
      const markRow = (db.marks || []).find((m) => String(m._id) === String(payload.marksId));
      const newRem = {
        _id: "r" + Date.now(),
        ...payload,
        student: markRow?.studentId,
        createdAt: new Date().toISOString(),
      };
      db.remedials = db.remedials || [];
      db.remedials.push(newRem);
      saveDb(db);
      return { remedial: newRem };
    }
    syncMockAutoRemedials(db, getUser()?._id);
    const remedials = (db.remedials || []).map(r => {
      const mark = (db.marks || []).find(m => m._id === r.marksId);
      const student = mark ? (db.students || []).find(s => s._id === mark.studentId) : null;
      return {
        ...r,
        student: student || null,
        marks: mark ? { ...mark, student } : null,
      };
    });
    return { remedials };
  }

  // ── MARKS ─────────────────────────────────────────────────────────────────
  if (cleanPath.startsWith("/marks")) {
    const markId = cleanPath.split("/")[2]; // /marks/:id

    if (cleanPath === "/marks/meta/terms") {
      const user = getUser();
      let list = db.marks || [];
      const studentScope = user?.studentId || user?.studentRef;
      if (user?.role === "student" && studentScope) {
        list = list.filter((m) => m.studentId === studentScope);
      }
      const terms = [...new Set(list.map((m) => m.term).filter(Boolean))].sort();
      return { terms, defaultTerm: db.settings?.defaultTerm || "2025-T1" };
    }

    if (cleanPath === "/marks/bulk" && options.method === "POST") {
      const payload = JSON.parse(options.body || "{}");
      const items = payload.marks || [];
      if (!Array.isArray(items) || !items.length) throw new Error("marks array required");
      const settings = db.settings || {};
      const defaultTerm = settings.defaultTerm || "2025-T1";
      const imported = [];
      const errors = [];
      db.marks = db.marks || [];
      let nid = Date.now();
      items.forEach((body, i) => {
        try {
          const sid = String(body.student ?? body.studentId ?? "").trim();
          const subject = String(body.subject ?? "").trim();
          if (!sid || !subject) {
            errors.push(`Row ${i + 1}: student and subject required`);
            return;
          }
          const st = (db.students || []).find((s) => String(s._id) === sid);
          if (!st) {
            errors.push(`Row ${i + 1}: student not found`);
            return;
          }
          const term = String(body.term || "").trim() || defaultTerm;
          const calc = calculateFinal(body);
          const j = db.marks.findIndex(
            (m) =>
              String(m.studentId) === sid &&
              m.subject === subject &&
              String(m.term || defaultTerm).trim() === term
          );
          const priorFinal =
            j >= 0 && db.marks[j].final != null ? Number(db.marks[j].final) : null;
          const now = new Date().toISOString();
          const row = {
            ...(j >= 0 ? db.marks[j] : {}),
            _id: j >= 0 ? db.marks[j]._id : `m${nid++}`,
            studentId: sid,
            subject,
            term,
            mid1: Number(body.mid1) || 0,
            mid2: Number(body.mid2) || 0,
            assignment: Number(body.assignment) || 0,
            lab: Number(body.lab) || 0,
            internal1: calc.internal1,
            internal2: calc.internal2,
            final: calc.final,
            bestKey: calc.bestKey,
            atRisk: checkRisk(calc.final, settings.riskThreshold || 16, calc.internal1, calc.internal2),
            anomaly: checkAnomaly({ ...body, final: calc.final }, priorFinal),
            updatedAt: now,
          };
          if (j < 0) {
            row.createdAt = now;
            db.marks.push(row);
          } else {
            db.marks[j] = row;
          }
          ensureMockAutoRemedial(db, row, getUser()?._id);
          imported.push(row._id);
        } catch (e) {
          errors.push(`Row ${i + 1}: ${e.message}`);
        }
      });
      saveDb(db);
      return { imported: imported.length, ids: imported, errors };
    }

    if (cleanPath === "/marks" && options.method === "POST") {
      const payload = JSON.parse(options.body || "{}");
      const calc = calculateFinal(payload);
      const settings = db.settings || {};
      const term = String(payload.term || "").trim() || settings.defaultTerm || "2025-T1";
      const sid = String(payload.student ?? payload.studentId ?? "").trim();
      const { term: _t, student: _st, studentId: _si, ...restPayload } = payload;
      const now = new Date().toISOString();
      const newMark = {
        _id: "m" + Date.now(),
        ...restPayload,
        studentId: sid,
        term,
        internal1: calc.internal1,
        internal2: calc.internal2,
        final: calc.final,
        bestKey: calc.bestKey,
        atRisk: checkRisk(calc.final, settings.riskThreshold || 16, calc.internal1, calc.internal2),
        anomaly: checkAnomaly(payload),
        createdAt: now,
        updatedAt: now,
      };
      db.marks = db.marks || [];
      db.marks.push(newMark);
      ensureMockAutoRemedial(db, newMark, getUser()?._id);
      saveDb(db);
      return { mark: newMark };
    }

    if (options.method === "PATCH" && markId) {
      const payload = JSON.parse(options.body || "{}");
      let patched = null;
      db.marks = (db.marks || []).map(m => {
        if (m._id !== markId) return m;
        const priorFinal = Number.isFinite(Number(m.final)) ? Number(m.final) : null;
        const updated = { ...m, ...payload, updatedAt: new Date().toISOString() };
        const calc = calculateFinal(updated);
        updated.internal1 = calc.internal1;
        updated.internal2 = calc.internal2;
        updated.final     = calc.final;
        updated.bestKey   = calc.bestKey;
        updated.atRisk    = checkRisk(calc.final, (db.settings || {}).riskThreshold || 16, calc.internal1, calc.internal2);
        updated.anomaly   = checkAnomaly(updated, priorFinal);
        patched = updated;
        return updated;
      });
      if (patched) ensureMockAutoRemedial(db, patched, getUser()?._id);
      saveDb(db);
      const mark = db.marks.find(m => m._id === markId);
      return { mark };
    }

    if (options.method === "DELETE" && markId) {
      db.marks = (db.marks || []).filter(m => m._id !== markId);
      saveDb(db);
      return { ok: true };
    }

    // GET /marks/:id (same shape as server)
    const httpMethod = String(options.method || "GET").toUpperCase();
    if (markId && cleanPath !== "/marks" && httpMethod === "GET") {
      reconcileFacultyMockAtRisk();
      const m = (db.marks || []).find(x => String(x._id) === String(markId));
      if (!m) throw new Error("Not found");
      return {
        mark: {
          ...m,
          student: (db.students || []).find(s => s._id === m.studentId) || null,
        },
      };
    }

    reconcileFacultyMockAtRisk();

    // GET list with filters
    let marks = (db.marks || []).map(m => ({
      ...m,
      student: (db.students || []).find(s => s._id === m.studentId)
    }));

    const studentId = params.get("studentId");
    if (studentId) {
      marks = marks.filter(m => m.studentId === studentId);
    }
    const termQ = params.get("term");
    if (termQ === "all" || termQ === "*") {
      /* no term filter */
    } else {
      const def = db.settings?.defaultTerm || "2025-T1";
      const t = ((termQ && termQ.trim()) || def).toLowerCase();
      const defLow = def.toLowerCase();
      marks = marks.filter((m) => {
        const mt = m.term;
        const has = mt != null && String(mt).trim() !== "";
        if (has) return String(mt).trim().toLowerCase() === t;
        // Legacy rows with no term: treat as defaultTerm
        return t === defLow;
      });
    }
    const search = params.get("search")?.toLowerCase();
    if (search) {
      marks = marks.filter(m =>
        m.student?.name?.toLowerCase().includes(search) ||
        m.subject?.toLowerCase().includes(search)
      );
    }
    if (params.get("atRisk") === "true") marks = marks.filter(m => m.atRisk);
    if (params.get("anomaly") === "true") marks = marks.filter(m => m.anomaly);

    const fbTermList = db.settings?.defaultTerm || "2025-T1";
    marks.forEach((m) => {
      if (m.term == null || String(m.term).trim() === "") m.term = fbTermList;
    });

    // Sort newest first so newly saved records appear on page 1
    marks.sort((a, b) => {
      const ta = a.updatedAt || a.createdAt || "";
      const tb = b.updatedAt || b.createdAt || "";
      return String(tb).localeCompare(String(ta));
    });

    // Pagination
    const page = Number(params.get("page") || 1);
    const limit = Number(params.get("limit") || 15);
    const total = marks.length;
    const paged = marks.slice((page - 1) * limit, page * limit);

    return { marks: paged, page, limit, total };
  }

  // ── ANALYTICS (trend picker — RBAC mirrors server) ─────────────────────────
  const mockTrendStudentId = (user) => {
    if (!user) return "";
    const r = user.studentRef;
    if (r && typeof r === "object" && r._id) return String(r._id);
    return r ? String(r) : "";
  };

  if (cleanPath === "/analytics/trend/students") {
    const user = getUser();
    const studs = db.students || [];
    if (user?.role === "student") {
      const sid = mockTrendStudentId(user);
      const st = studs.find((s) => String(s._id) === String(sid));
      return {
        students: st ? [{ _id: st._id, name: st.name, rollNumber: st.rollNumber || "" }] : [],
      };
    }
    const sorted = [...studs].sort((a, b) => String(a.name).localeCompare(String(b.name), undefined, { sensitivity: "base" }));
    return {
      students: sorted.map((s) => ({ _id: s._id, name: s.name, rollNumber: s.rollNumber || "" })),
    };
  }

  if (cleanPath === "/analytics/trend/subjects") {
    const user = getUser();
    let sid = params.get("studentId") || "";
    if (user?.role === "student") {
      const self = mockTrendStudentId(user);
      if (sid && String(sid) !== String(self)) throw new Error("Not allowed");
      sid = self;
    }
    if (!sid) throw new Error("studentId required");
    const set = new Set();
    (db.marks || [])
      .filter((m) => String(m.studentId) === String(sid))
      .forEach((m) => {
        if (m.subject) set.add(String(m.subject).trim());
      });
    return { subjects: [...set].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" })) };
  }

  if (cleanPath === "/analytics/trend/series") {
    const user = getUser();
    const subject = String(params.get("subject") || "").trim();
    if (!subject) throw new Error("subject required");
    let sid = params.get("studentId") || "";
    if (user?.role === "student") {
      const self = mockTrendStudentId(user);
      if (sid && String(sid) !== String(self)) throw new Error("Not allowed");
      sid = self;
    }
    if (!sid) throw new Error("studentId required");
    const subjLow = subject.toLowerCase();
    const items = (db.marks || []).filter(
      (m) => String(m.studentId) === String(sid) && String(m.subject || "").toLowerCase() === subjLow
    );
    const fb = db.settings?.defaultTerm || "2025-T1";
    const points = [...items]
      .sort((a, b) => {
        const ta = String(a.term || fb);
        const tb = String(b.term || fb);
        if (ta !== tb) return ta.localeCompare(tb);
        return String(a.updatedAt || "").localeCompare(String(b.updatedAt || ""));
      })
      .map((m) => ({
        term: m.term != null && String(m.term).trim() !== "" ? String(m.term).trim() : fb,
        final: Number(m.final),
        internal1: Number(m.internal1 ?? 0),
        internal2: Number(m.internal2 ?? 0),
        updatedAt: m.updatedAt,
      }));
    const st = (db.students || []).find((s) => String(s._id) === String(sid));
    return {
      points,
      student: st ? { _id: st._id, name: st.name, rollNumber: st.rollNumber || "" } : null,
      subject,
    };
  }

  // ── ANALYTICS ─────────────────────────────────────────────────────────────
  if (cleanPath.startsWith("/analytics/summary")) {
    const user = getUser();
    reconcileFacultyMockAtRisk();
    let marks = (db.marks || []).map(m => ({
      ...m,
      student: (db.students || []).find(s => s._id === m.studentId)
    }));

    // Student Focus Filter
    const studentScope = user?.studentId || user?.studentRef;
    if (user && user.role === "student" && studentScope) {
      marks = marks.filter(m => m.studentId === studentScope);
    }

    const termQ = params.get("term");
    if (termQ === "all" || termQ === "*") {
      /* all terms */
    } else {
      const def = db.settings?.defaultTerm || "2025-T1";
      const t = ((termQ && termQ.trim()) || def).toLowerCase();
      const defLow = def.toLowerCase();
      marks = marks.filter((m) => {
        const mt = m.term;
        const has = mt != null && String(mt).trim() !== "";
        if (has) return String(mt).trim().toLowerCase() === t;
        return t === defLow;
      });
    }

    const fbTermAn = db.settings?.defaultTerm || "2025-T1";
    marks.forEach((m) => {
      if (m.term == null || m.term === "") m.term = fbTermAn;
    });

    const total = marks.length;
    const avgScore = total > 0 ? Number((marks.reduce((acc, m) => acc + m.final, 0) / total).toFixed(1)) : 0;
    const riskCount = marks.filter(m => m.atRisk).length;
    const anomalyCount = marks.filter(m => m.anomaly).length;

    const passMark = (db.settings || {}).passMark ?? 16;
    const sortedPassing = [...marks]
      .filter((m) => Number(m.final) >= passMark)
      .sort((a, b) => b.final - a.final);
    const top = sortedPassing.slice(0, 10);
    const sortedDesc = [...marks].sort((a, b) => b.final - a.final);
    const low = sortedDesc.slice(-10).reverse();

    const bySubjectMap = {};
    const passFail = { pass: 0, fail: 0 };

    marks.forEach(m => {
      if (!bySubjectMap[m.subject]) bySubjectMap[m.subject] = { total: 0, count: 0 };
      bySubjectMap[m.subject].total += m.final;
      bySubjectMap[m.subject].count++;
      if (m.final >= passMark) passFail.pass++;
      else passFail.fail++;
    });

    const bySubject = Object.entries(bySubjectMap).map(([name, data]) => ({
      _id: name,
      avgFinal: Number((data.total / data.count).toFixed(1))
    }));

    const riskTh = (db.settings || {}).riskThreshold ?? 16;
    const studentRiskInsights =
      user?.role === "student"
        ? []
        : computeStudentRiskInsights(marks, { passMark, predictiveThreshold: 16 });
    const predictedHighRiskCount = studentRiskInsights.filter((r) => r.riskBand === "high").length;

    return {
      settings: { passMark, riskThreshold: riskTh, predictiveThreshold: 16 },
      total, riskCount, anomalyCount, top, low, bySubject, passFail, avgScore,
      trend: marks.slice(0, 10),
      atRiskList: marks.filter(m => m.atRisk),
      anomalyList: marks.filter(m => m.anomaly),
      studentRiskInsights,
      predictedHighRiskCount,
    };
  }

  // ── ACTIVITY ──────────────────────────────────────────────────────────────
  if (cleanPath.startsWith("/activity")) {
    return { activity: db.activity || [] };
  }

  return { error: "Not found", marks: [], students: [], remedials: [], users: [] };
}

export async function api(path, options = {}) {
  if (useMockApi()) {
    try {
      return await mockApi(path, options);
    } catch (e) {
      console.error("Mock API Internal Error:", e);
      throw e;
    }
  }

  const headers = { ...(options.headers || {}) };
  if (!headers["Content-Type"] && options.body && typeof options.body === "string") {
    headers["Content-Type"] = "application/json";
  }
  const t = getToken();
  if (t) headers.Authorization = `Bearer ${t}`;

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  if (res.status === 401 && !String(path).includes("/auth/login")) {
    setToken(null);
    setUser(null);
    window.location.href = "/index.html";
  }
  if (!res.ok) {
    const msg = await readErrorBody(res);
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

export async function uploadCsv(file, { atomic = false } = {}) {
  if (!useMockApi()) {
    const t = getToken();
    const fd = new FormData();
    fd.append("file", file);
    if (atomic) fd.append("atomic", "1");
    const headers = {};
    if (t) headers.Authorization = `Bearer ${t}`;
    const q = atomic ? "?atomic=1" : "";
    const res = await fetch(`${API_BASE}/marks/import/csv${q}`, { method: "POST", headers, body: fd });
    if (res.status === 401) {
      setToken(null);
      setUser(null);
      window.location.href = "/index.html";
    }
    if (!res.ok) throw new Error(await readErrorBody(res));
    return res.json();
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const text = e.target.result;
        const lines = text.trim().split("\n");
        if (lines.length < 2) {
          reject(new Error("CSV needs a header and at least one row."));
          return;
        }
        const fileHeaders = lines[0].split(",").map(h => h.trim().toLowerCase());
        const db = getDb();
        const pending = [];
        const rowErrors = [];
        for (let i = 1; i < lines.length; i++) {
          const values = lines[i].split(",").map(v => v.trim());
          const row = {};
          fileHeaders.forEach((h, idx) => { row[h] = values[idx]; });
          if (!row.studentid || !row.subject) {
            rowErrors.push(`Row ${i + 1}: missing studentId or subject.`);
            continue;
          }
          const payload = {
            studentId: row.studentid,
            subject: row.subject,
            mid1: Number(row.mid1 || 0),
            mid2: Number(row.mid2 || 0),
            assignment1: Number(row.assignment1 || 0),
            assignment2: Number(row.assignment2 || 0),
          };
          const calc = calculateFinal(payload);
          const termCell = row.term != null && row.term !== "" ? String(row.term).trim() : "";
          pending.push({
            payload,
            calc,
            term: termCell,
            line: i + 1,
          });
        }
        if (atomic && rowErrors.length) {
          reject(new Error(rowErrors.slice(0, 8).join(" ") + (rowErrors.length > 8 ? " …" : "")));
          return;
        }
        if (atomic && !pending.length) {
          reject(new Error("Strict import: no valid data rows."));
          return;
        }
        let imported = 0;
        db.marks = db.marks || [];
        const ts = Date.now();
        const defaultTerm = db.settings?.defaultTerm || "2025-T1";
        for (let j = 0; j < pending.length; j++) {
          const { payload, calc, term: termCell } = pending[j];
          db.marks.push({
            _id: "m" + ts + j,
            ...payload,
            term: termCell || defaultTerm,
            internal1: calc.internal1,
            internal2: calc.internal2,
            final: calc.final,
            bestKey: calc.bestKey,
            atRisk: checkRisk(calc.final, (db.settings || {}).riskThreshold || 16, calc.internal1, calc.internal2),
            anomaly: checkAnomaly(payload),
            createdAt: new Date().toISOString()
          });
          imported++;
        }
        saveDb(db);
        resolve({ imported, errors: rowErrors.length && !atomic ? rowErrors : undefined });
      } catch (err) { reject(err); }
    };
    reader.onerror = reject;
    reader.readAsText(file);
  });
}

export async function apiCsv() {
  if (!useMockApi()) {
    const headers = {};
    const t = getToken();
    if (t) headers.Authorization = `Bearer ${t}`;
    const res = await fetch(`${API_BASE}/marks/export/csv`, { headers });
    if (res.status === 401) {
      setToken(null);
      setUser(null);
      window.location.href = "/index.html";
    }
    if (!res.ok) throw new Error(await readErrorBody(res));
    return res.blob();
  }

  const db = getDb();
  const marks = (db.marks || []).map(m => ({
    ...m,
    student: (db.students || []).find(s => s._id === m.studentId)
  }));
  const header = "studentName,subject,term,mid1,mid2,assignment1,assignment2,final,atRisk,anomaly";
  const rows = marks.map(m =>
    [m.student?.name || "", m.subject, m.term ?? "", m.mid1, m.mid2, m.assignment1, m.assignment2, m.final, m.atRisk, m.anomaly].join(",")
  );
  return new Blob([header + "\n" + rows.join("\n")], { type: "text/csv" });
}
