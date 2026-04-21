/**
 * API smoke tests — run with server up: npm run smoke
 * Uses admin creds from env/defaults, then ensures smoke faculty/student accounts exist.
 */
const BASE = process.env.SIMMS_SMOKE_URL || "http://127.0.0.1:5000";
const ADMIN_USER = process.env.SEED_ADMIN_USERNAME || "admin";
const ADMIN_PASS = process.env.SEED_ADMIN_PASSWORD || "admin123";
const SMOKE_FACULTY_USER = process.env.SIMMS_SMOKE_FACULTY_USER || "faculty";
const SMOKE_FACULTY_PASS = process.env.SIMMS_SMOKE_FACULTY_PASS || "faculty123";
const SMOKE_STUDENT_USER = process.env.SIMMS_SMOKE_STUDENT_USER || "student";
const SMOKE_STUDENT_PASS = process.env.SIMMS_SMOKE_STUDENT_PASS || "student123";
const OPEN_DEADLINE = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

let passed = 0;
let failed = 0;

function fail(name, detail) {
  failed++;
  console.error(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
}

function ok(name) {
  passed++;
  console.log(`OK: ${name}`);
}

async function req(path, opts = {}) {
  const url = `${BASE}${path}`;
  const headers = { ...(opts.headers || {}) };
  if (opts.json !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  const r = await fetch(url, {
    ...opts,
    headers,
    body: opts.json !== undefined ? JSON.stringify(opts.json) : opts.body,
  });
  let data = null;
  const ct = r.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    try {
      data = await r.json();
    } catch {
      data = null;
    }
  } else {
    const t = await r.text();
    data = t;
  }
  return { status: r.status, data, raw: data };
}

async function login(username, password) {
  const { status, data } = await req("/api/auth/login", {
    method: "POST",
    json: { username, password },
  });
  if (status !== 200 || !data?.token) {
    throw new Error(`login ${username}: ${status} ${JSON.stringify(data)}`);
  }
  return data.token;
}

function authHeader(token) {
  return { Authorization: `Bearer ${token}` };
}

async function ensureUserByUsername(adminToken, { username, name, password, role, rollNumber, section, facultyId }) {
  const normalized = String(username).trim().toLowerCase();
  const list = await req("/api/users", { headers: authHeader(adminToken) });
  if (list.status !== 200 || !Array.isArray(list.data?.users)) {
    throw new Error(`list users failed: ${list.status}`);
  }

  const existing = list.data.users.find((u) => String(u.username).trim().toLowerCase() === normalized);
  const payload = {
    username: normalized,
    name,
    password,
    role,
    ...(rollNumber ? { rollNumber } : {}),
    ...(section ? { section } : {}),
    ...(facultyId ? { facultyId } : {}),
  };

  if (!existing) {
    const created = await req("/api/users", {
      method: "POST",
      headers: authHeader(adminToken),
      json: payload,
    });
    if (created.status !== 201 || !created.data?.user?._id) {
      throw new Error(`create user ${normalized} failed: ${created.status} ${JSON.stringify(created.data)}`);
    }
    return created.data.user;
  }

  const updated = await req(`/api/users/${existing._id}`, {
    method: "PATCH",
    headers: authHeader(adminToken),
    json: {
      name,
      password,
      ...(role && role !== existing.role ? { role } : {}),
      ...(role === "student" ? { rollNumber: rollNumber || "", section: section || "", ...(facultyId ? { facultyId } : {}) } : {}),
    },
  });
  if (updated.status !== 200 || !updated.data?.user?._id) {
    throw new Error(`update user ${normalized} failed: ${updated.status} ${JSON.stringify(updated.data)}`);
  }
  return updated.data.user;
}

async function main() {
  console.log(`SIMMS API smoke — ${BASE}\n`);

  const adminT = await login(ADMIN_USER, ADMIN_PASS);
  const facultyUser = await ensureUserByUsername(adminT, {
    username: SMOKE_FACULTY_USER,
    name: "Smoke Faculty",
    password: SMOKE_FACULTY_PASS,
    role: "faculty",
  });
  const studentUser = await ensureUserByUsername(adminT, {
    username: SMOKE_STUDENT_USER,
    name: "Smoke Student",
    password: SMOKE_STUDENT_PASS,
    role: "student",
    rollNumber: "SMOKE-STUDENT-001",
    section: "Smoke",
    facultyId: facultyUser._id,
  });

  const facultyT = await login(SMOKE_FACULTY_USER, SMOKE_FACULTY_PASS);
  const studentT = await login(SMOKE_STUDENT_USER, SMOKE_STUDENT_PASS);

  // Keep the workspace testable regardless of the persisted deadline state.
  let originalDeadline = null;
  {
    const { data: s } = await req("/api/settings", { headers: authHeader(adminT) });
    originalDeadline = s?.marksDeadline ?? null;
  }
  {
    const { status } = await req("/api/settings", {
      method: "PATCH",
      headers: authHeader(adminT),
      json: { marksDeadline: OPEN_DEADLINE },
    });
    if (status === 200) ok("admin PATCH settings (open test window) -> 200");
    else fail("admin PATCH open window", `${status}`);
  }

  // Role: student cannot list students
  {
    const { status } = await req("/api/students", { headers: authHeader(studentT) });
    if (status === 403) ok("student GET /api/students -> 403");
    else fail("student GET /api/students -> 403", `got ${status}`);
  }

  // Role: faculty can list students
  {
    const { status, data } = await req("/api/students", { headers: authHeader(facultyT) });
    if (status === 200 && Array.isArray(data?.students)) ok("faculty GET /api/students -> 200");
    else fail("faculty GET /api/students", `${status}`);
  }

  // Role: users route admin-only
  {
    const { status } = await req("/api/users", { headers: authHeader(studentT) });
    if (status === 403) ok("student GET /api/users -> 403");
    else fail("student GET /api/users", `${status}`);
  }
  {
    const { status } = await req("/api/users", { headers: authHeader(facultyT) });
    if (status === 403) ok("faculty GET /api/users -> 403");
    else fail("faculty GET /api/users", `${status}`);
  }
  {
    const { status, data } = await req("/api/users", { headers: authHeader(adminT) });
    if (status === 200 && Array.isArray(data.users)) ok("admin GET /api/users -> 200");
    else fail("admin GET /api/users", `${status}`);
  }

  // Student marks scoped + explicit peer isolation (must not read other student's mark by id)
  const peerIso = `iso_${Date.now()}`;
  let peerStudentId = null;
  let peerMarkId = null;
  {
    const { status, data } = await req("/api/marks?limit=5", { headers: authHeader(studentT) });
    if (status === 200 && Array.isArray(data?.marks)) {
      ok("student GET /api/marks -> 200 (own)");
    } else fail("student GET /api/marks", `${status}`);
  }
  {
    const { status, data } = await req("/api/students", {
      method: "POST",
      headers: authHeader(facultyT),
      json: { name: `Peer ${peerIso}`, rollNumber: `P-${peerIso}`, section: "Iso" },
    });
    if (status === 201 && data?.student?._id) {
      peerStudentId = data.student._id;
      ok("isolation: faculty POST peer student -> 201");
    } else fail("peer student", `${status} ${JSON.stringify(data)}`);
  }
  {
    const { status, data } = await req("/api/marks", {
      method: "POST",
      headers: authHeader(facultyT),
      json: {
        student: peerStudentId,
        subject: `PeerSubj_${peerIso}`,
        term: "2025-T1",
        mid1: 10,
        mid2: 10,
        assignment: 10,
        lab: 10,
      },
    });
    if (status === 201 && data?.mark?._id) {
      peerMarkId = data.mark._id;
      ok("isolation: faculty POST peer mark -> 201");
    } else fail("peer mark", `${status} ${JSON.stringify(data)}`);
  }
  {
    const { status } = await req(`/api/marks/${peerMarkId}`, { headers: authHeader(studentT) });
    if (status === 403) ok("student GET other student's mark -> 403");
    else fail("student mark isolation", `${status}`);
  }

  // Faculty cannot POST marks without body
  {
    const { status } = await req("/api/marks", {
      method: "POST",
      headers: authHeader(facultyT),
      json: {},
    });
    if (status === 400) ok("faculty POST /api/marks invalid -> 400");
    else fail("faculty POST invalid", `${status}`);
  }

  // CRUD: create student + mark + patch + delete mark; delete student
  const tag = `smoke_${Date.now()}`;
  const studentName = `Smoke ${tag}`;
  let newStudentId = null;
  let newMarkId = null;
  {
    const { status, data } = await req("/api/students", {
      method: "POST",
      headers: authHeader(facultyT),
      json: { name: studentName, rollNumber: `R-${tag}`, section: "Z" },
    });
    if (status === 201 && data?.student?._id) {
      newStudentId = data.student._id;
      ok("faculty POST /api/students -> 201");
    } else fail("faculty POST student", `${status} ${JSON.stringify(data)}`);
  }
  {
    const { status, data } = await req("/api/marks", {
      method: "POST",
      headers: authHeader(facultyT),
      json: {
        student: newStudentId,
        subject: `SmokeSubject_${tag}`,
        term: "2025-T1",
        mid1: 20,
        mid2: 18,
        assignment: 15,
        lab: 14,
      },
    });
    if (status === 201 && data?.mark?._id) {
      newMarkId = data.mark._id;
      ok("faculty POST /api/marks -> 201");
    } else fail("faculty POST mark", `${status} ${JSON.stringify(data)}`);
  }
  {
    const { status, data } = await req(`/api/marks/${newMarkId}`, {
      method: "PATCH",
      headers: authHeader(facultyT),
      json: { mid1: 22 },
    });
    if (status === 200 && data?.mark) ok("faculty PATCH /api/marks/:id -> 200");
    else fail("faculty PATCH mark", `${status}`);
  }

  // CSV export
  {
    const { status, data } = await req("/api/marks/export/csv", { headers: authHeader(facultyT) });
    if (status === 200 && typeof data === "string" && data.includes("Student Name")) {
      ok("GET /api/marks/export/csv -> 200");
    } else fail("marks export csv", `${status}`);
  }

  // CSV import (multipart)
  const importName = `CsvImport ${tag}`;
  const csv = `Name,Subject,Mid-1,Mid-2,Assignment,Lab,Term\n${importName},CsvSubj,16,14,12,11,2025-T1\n`;
  {
    const fd = new FormData();
    fd.append("file", new Blob([csv], { type: "text/csv" }), "smoke.csv");
    const r = await fetch(`${BASE}/api/marks/import/csv`, {
      method: "POST",
      headers: authHeader(facultyT),
      body: fd,
    });
    const j = await r.json();
    if (r.status === 201 && j.imported >= 1) ok("POST /api/marks/import/csv -> 201");
    else fail("CSV import", `${r.status} ${JSON.stringify(j)}`);
  }

  // Atomic CSV: one bad row -> 400, no import
  const badCsv = `Name,Subject,Mid-1\nGoodRow ${tag},SubA,10\n,SubB,10\n`;
  {
    const fd = new FormData();
    fd.append("file", new Blob([badCsv], { type: "text/csv" }), "bad.csv");
    fd.append("atomic", "1");
    const r = await fetch(`${BASE}/api/marks/import/csv?atomic=1`, {
      method: "POST",
      headers: authHeader(facultyT),
      body: fd,
    });
    const j = await r.json();
    if (r.status === 400 && j.atomicAborted === true && j.imported === 0) {
      ok("POST /api/marks/import/csv atomic -> 400 aborted");
    } else fail("atomic CSV", `${r.status} ${JSON.stringify(j)}`);
  }

  // Remedials
  {
    const { status, data } = await req("/api/remedials", { headers: authHeader(facultyT) });
    if (status === 200 && Array.isArray(data?.remedials)) ok("GET /api/remedials -> 200");
    else fail("GET remedials", `${status}`);
  }
  {
    const { status, data } = await req("/api/remedials", {
      method: "POST",
      headers: authHeader(facultyT),
      json: { marksId: newMarkId, afterFinal: 25, notes: "smoke remedial" },
    });
    if (status === 201 && data?.remedial) ok("POST /api/remedials -> 201");
    else fail("POST remedial", `${status} ${JSON.stringify(data)}`);
  }
  {
    const { status, data } = await req("/api/remedials", {
      method: "POST",
      headers: authHeader(facultyT),
      json: { marksId: newMarkId, afterFinal: 55, notes: "invalid remedial" },
    });
    if (status === 400) ok("POST /api/remedials invalid -> 400");
    else fail("POST remedial invalid", `${status} ${JSON.stringify(data)}`);
  }

  // Activity
  {
    const { status, data } = await req("/api/activity", { headers: authHeader(facultyT) });
    if (status === 200 && Array.isArray(data?.activity)) {
      ok("GET /api/activity (faculty) -> 200");
    } else {
      const keys = data && typeof data === "object" ? Object.keys(data) : [];
      fail("GET activity faculty", `${status} keys=${keys.join(",")}`);
    }
  }
  {
    const { status, data } = await req("/api/activity/export/csv", { headers: authHeader(studentT) });
    if (status === 403) ok("student GET /api/activity/export/csv -> 403");
    else fail("student activity export -> 403", `${status}`);
  }
  {
    const { status, data } = await req("/api/activity/export/csv", { headers: authHeader(adminT) });
    if (status === 200 && typeof data === "string" && data.length > 0) {
      ok("admin GET /api/activity/export/csv -> 200");
    } else fail("admin activity export", `${status}`);
  }

  // Analytics (student)
  {
    const { status, data } = await req("/api/analytics/summary", { headers: authHeader(studentT) });
    if (status === 200 && typeof data?.total === "number") ok("student GET /api/analytics/summary -> 200");
    else fail("student analytics summary", `${status}`);
  }
  {
    const { status, data } = await req("/api/analytics/trend/subjects", { headers: authHeader(studentT) });
    if (status === 200 && Array.isArray(data?.subjects)) ok("student GET /api/analytics/trend/subjects -> 200");
    else fail("student trend/subjects", `${status}`);
  }
  {
    const { status } = await req("/api/analytics/trend/subjects", { headers: authHeader(facultyT) });
    if (status === 400) ok("faculty trend/subjects without studentId -> 400");
    else fail("faculty trend/subjects scope", `${status}`);
  }

  {
    const { status, data } = await req("/api/auth/me", { headers: authHeader(studentT) });
    const sid = data?.user?.studentRef;
    if (status === 200 && sid) {
      const r = await req(`/api/students/${sid}/academic-report`, { headers: authHeader(studentT) });
      if (r.status === 200 && r.data?.student && Array.isArray(r.data.years)) {
        ok("GET /students/:id/academic-report (self)");
      } else fail("academic-report", `${r.status}`);
    } else fail("auth/me studentRef", `${status}`);
  }

  {
    const bs = `Bulks_${Date.now()}`;
    const cr = await req("/api/students", {
      method: "POST",
      headers: authHeader(facultyT),
      json: { name: `Bulk Child ${bs}`, rollNumber: `B-${bs}`, section: "B" },
    });
    const bulkStu = cr.data?.student?._id;
    if (cr.status === 201 && bulkStu) {
      const r = await req("/api/marks/bulk", {
        method: "POST",
        headers: authHeader(facultyT),
        json: {
          marks: [
            { student: bulkStu, subject: `Z1_${bs}`, term: "2025-T2", mid1: 5, assignment: 2, mid2: 5, lab: 2 },
            { student: bulkStu, subject: `Z2_${bs}`, term: "2025-T2", mid1: 6, assignment: 2, mid2: 6, lab: 2 },
          ],
        },
      });
      if (r.status === 201 && r.data.imported === 2) ok("POST /api/marks/bulk");
      else fail("marks/bulk", `${r.status} ${JSON.stringify(r.data)}`);
      const lst = await req(`/api/marks?search=${encodeURIComponent("Bulk Child")}&limit=20`, {
        headers: authHeader(adminT),
      });
      for (const m of lst.data?.marks || []) {
        await req(`/api/marks/${m._id}`, { method: "DELETE", headers: authHeader(adminT) });
      }
      const del = await req(`/api/students/${bulkStu}`, { method: "DELETE", headers: authHeader(facultyT) });
      if (del.status === 200) ok("cleanup bulk JSON student");
      else fail("cleanup bulk", `${del.status}`);
    } else fail("bulk setup student", `${cr.status}`);
  }

  // Marks deadline lock (faculty blocked, admin not)
  {
    const { status } = await req("/api/settings", {
      method: "PATCH",
      headers: authHeader(adminT),
      json: { marksDeadline: "2000-01-01T00:00:00.000Z" },
    });
    if (status === 200) ok("admin PATCH settings (past deadline) -> 200");
    else fail("admin PATCH deadline", `${status}`);
  }
  {
    const { status, data } = await req("/api/marks", {
      method: "POST",
      headers: authHeader(facultyT),
      json: {
        student: newStudentId,
        subject: `LockedFaculty_${tag}`,
        term: `T-${tag}`,
        mid1: 10,
        mid2: 10,
        assignment: 10,
        lab: 10,
      },
    });
    if (status === 403 && data?.code === "MARKS_LOCKED") ok("faculty POST marks after deadline -> 403 MARKS_LOCKED");
    else fail("faculty locked", `${status} ${JSON.stringify(data)}`);
  }
  {
    const { status, data } = await req("/api/marks", {
      method: "POST",
      headers: authHeader(adminT),
      json: {
        student: newStudentId,
        subject: `AdminBypass_${tag}`,
        term: `T-${tag}`,
        mid1: 12,
        mid2: 12,
        assignment: 11,
        lab: 11,
      },
    });
    let adminBypassId = null;
    if (status === 201 && data?.mark?._id) {
      adminBypassId = data.mark._id;
      ok("admin POST marks after deadline -> 201 (bypass)");
    } else fail("admin bypass lock", `${status} ${JSON.stringify(data)}`);
    if (adminBypassId) {
      await req(`/api/marks/${adminBypassId}`, { method: "DELETE", headers: authHeader(adminT) });
    }
  }
  {
    await req("/api/settings", {
      method: "PATCH",
      headers: authHeader(adminT),
      json: { marksDeadline: OPEN_DEADLINE },
    });
    ok("restored marksDeadline");
  }

  // Cleanup: delete mark + student (admin can delete mark after restore)
  {
    const { status } = await req(`/api/marks/${newMarkId}`, { method: "DELETE", headers: authHeader(facultyT) });
    if (status === 200) ok("faculty DELETE mark (cleanup) -> 200");
    else fail("DELETE mark cleanup", `${status}`);
  }
  {
    const { status } = await req(`/api/students/${newStudentId}`, { method: "DELETE", headers: authHeader(facultyT) });
    if (status === 200) ok("faculty DELETE student (cleanup) -> 200");
    else fail("DELETE student cleanup", `${status}`);
  }

  // CSV-import student: delete marks first, then student
  {
    const { data: mdata } = await req(`/api/marks?search=${encodeURIComponent(importName)}&limit=20`, {
      headers: authHeader(adminT),
    });
    for (const m of mdata?.marks || []) {
      await req(`/api/marks/${m._id}`, { method: "DELETE", headers: authHeader(adminT) });
    }
    const { status, data } = await req(`/api/students?search=${encodeURIComponent(importName)}`, {
      headers: authHeader(adminT),
    });
    const sid = data?.students?.[0]?._id;
    if (sid) {
      const d = await req(`/api/students/${sid}`, { method: "DELETE", headers: authHeader(adminT) });
      if (d.status === 200) ok("cleanup CSV-import student");
      else fail("cleanup csv student", `${d.status}`);
    } else {
      ok("cleanup CSV-import student (none found)");
    }
  }

  if (peerMarkId) {
    const d = await req(`/api/marks/${peerMarkId}`, { method: "DELETE", headers: authHeader(facultyT) });
    if (d.status === 200) ok("cleanup peer mark");
    else fail("cleanup peer mark", `${d.status}`);
  }
  if (peerStudentId) {
    const d = await req(`/api/students/${peerStudentId}`, { method: "DELETE", headers: authHeader(facultyT) });
    if (d.status === 200) ok("cleanup peer student");
    else fail("cleanup peer student", `${d.status}`);
  }

  {
    await req("/api/settings", {
      method: "PATCH",
      headers: authHeader(adminT),
      json: { marksDeadline: originalDeadline },
    });
    ok("restored original marksDeadline");
  }

  console.log(`\nDone: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
