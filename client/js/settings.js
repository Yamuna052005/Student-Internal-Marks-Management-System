import { api, getUser } from "./api.js";
import { refreshMe } from "./auth.js";
import { initShell, toast, qs, qsa } from "./app.js";

let user = getUser();
if (!user) window.location.href = "/index.html";

await refreshMe().catch(() => {});
user = getUser();
if (!user) window.location.href = "/index.html";

initShell({ active: "settings" });

const isStudent = user?.role === "student";

let state = {
  settings: {},
  users: [],
  activity: [],
};

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function initialOf(name) {
  return String(name || "?").trim().charAt(0).toUpperCase() || "?";
}

async function boot() {
  try {
    // Non-admin users only see their profile (activity + policy are admin-only)
    if (user.role !== "admin") {
      state.settings = await api("/settings").catch(() => ({}));
      renderProfile();
      qs("#gradingSection")?.remove();
      qs("#activitySection")?.remove();
      qs("aside[data-role='admin']")?.remove();
      wireEvents();
      return;
    }

    const [settings, usersData, activityData] = await Promise.all([
      api("/settings"),
      api("/users"),
      api("/activity"),
    ]);

    state.settings = settings;
    state.users = usersData.users || [];
    state.activity = activityData.activity || [];

    renderProfile();
    renderSettings();
    renderUsers();
    renderActivity();
    wireEvents();
  } catch (err) {
    console.error("SIMMS Settings Error:", err);
    toast("bad", "Error", "Failed to load configuration.");
  }
}

function renderProfile() {
  const profile = qs("#profile");
  if (!profile) return;

  const roleBadgeClass = user.role === "admin" ? "admin" : user.role === "faculty" ? "warn" : "good";
  const roleLabel = user.role === "admin" ? "Administrator" : user.role === "faculty" ? "Faculty" : "Student";

  // Student-specific fields from studentRef
  const sr = user.studentRef && typeof user.studentRef === "object" ? user.studentRef : null;
  const rollNumber = sr?.rollNumber || user.rollNumber || "—";
  const section = sr?.section || user.section || "—";

  const studentMeta = isStudent ? `
    <div style="display:flex;gap:2rem;margin-top:1.25rem;padding-top:1.25rem;border-top:1px solid var(--border);">
      <div>
        <div class="kpi-label" style="margin-bottom:0.25rem">Roll Number</div>
        <span class="code-pill">${esc(rollNumber)}</span>
      </div>
      <div>
        <div class="kpi-label" style="margin-bottom:0.25rem">Section</div>
        <span class="code-pill">${esc(section)}</span>
      </div>
    </div>` : "";

  profile.innerHTML = `
    <div style="display:flex;align-items:center;gap:1.5rem;flex-wrap:wrap;">
      <div style="width:56px;height:56px;border-radius:14px;background:var(--bg-accent);color:var(--primary);
        display:flex;align-items:center;justify-content:center;font-size:1.5rem;font-weight:700;
        font-family:'Poppins',sans-serif;flex-shrink:0;border:2px solid var(--border-bright);">
        ${initialOf(user.name)}
      </div>
      <div style="flex:1;min-width:0;">
        <div style="display:flex;align-items:center;gap:0.75rem;flex-wrap:wrap;margin-bottom:0.25rem;">
          <strong style="font-size:1.1rem;font-family:'Poppins',sans-serif;">${esc(user.name)}</strong>
          <span class="badge ${roleBadgeClass}">${roleLabel}</span>
        </div>
        <span class="hint">@${esc(user.username)}</span>
      </div>
    </div>
    ${studentMeta}
  `;
}

function renderSettings() {
  // Students never reach this — grading section is removed before call
  const riskT = qs("#riskT");
  const passM = qs("#passM");
  const defaultTerm = qs("#defaultTerm");
  const deadline = qs("#deadline");
  const saveSet = qs("#saveSet");
  if (!riskT) return; // section removed from DOM

  if (user.role !== "admin") {
    riskT.disabled = true;
    passM.disabled = true;
    defaultTerm.disabled = true;
    deadline.disabled = true;
    if (saveSet) saveSet.style.display = "none";
  }

  riskT.value = state.settings.riskThreshold ?? 40;
  passM.value = state.settings.passMark ?? 40;
  defaultTerm.value = state.settings.defaultTerm || "2025-T1";
  deadline.value = state.settings.marksDeadline ? state.settings.marksDeadline.slice(0, 16) : "";
}

function refreshFacultyOptions() {
  const sel = qs("#uFaculty");
  if (!sel) return;
  const fac = (state.users || []).filter((u) => u.role === "faculty");
  sel.innerHTML =
    '<option value="">— Admin roster (only admin manages marks) —</option>' +
    fac.map((f) => `<option value="${String(f._id)}">${esc(f.name)} (@${esc(f.username)})</option>`).join("");
}

function syncStudentFields() {
  const wrap = qs("#uStudentFields");
  if (!wrap) return;
  wrap.style.display = qs("#uRole")?.value === "student" ? "flex" : "none";
}

function renderUsers() {
  const aside = qs("aside[data-role='admin']");
  if (user.role !== "admin") {
    aside?.remove();
    return;
  }

  const tbody = qs("#usersBody");
  if (!tbody) return;

  tbody.innerHTML = state.users.map(item => `
    <tr data-id="${item._id}">
      <td>
        <div class="table-user">
          <div class="table-avatar">${initialOf(item.name)}</div>
          <div class="table-user-copy">
            <strong>${esc(item.name)}</strong>
            <span>${item.role === "student" && item.studentRef
              ? esc(`${item.studentRef.rollNumber || "—"} · Sec ${item.studentRef.section || "—"}`)
              : "Active Account"}</span>
          </div>
        </div>
      </td>
      <td><span class="code-pill">${esc(item.username)}</span></td>
      <td><span class="badge ${item.role === 'admin' ? 'admin' : ''}">${esc(item.role)}</span></td>
      <td style="text-align: right;">
        <div class="table-actions" style="display: flex; gap: 0.5rem; justify-content: flex-end;">
          ${String(item._id) !== String(user._id || user.id)
            ? `<button class="btn small ghost btn-edit-user" data-id="${item._id}">Edit</button>
               <button class="btn small danger ghost btn-del-user" data-id="${item._id}">Delete</button>`
            : '<span class="hint" style="font-size: 0.75rem; color: var(--primary);">Current Admin</span>'}
        </div>
      </td>
    </tr>
  `).join("");

  qsa(".btn-del-user").forEach(button => {
    button.onclick = () => deleteUser(button.dataset.id);
  });

  qsa(".btn-edit-user").forEach(button => {
    button.onclick = () => openEditUser(button.dataset.id);
  });
}

function renderActivity() {
  const activityRoot = qs("#act");
  if (!activityRoot) return;

  if (state.activity.length === 0) {
    activityRoot.innerHTML = '<div class="empty">No recent activity logs.</div>';
    return;
  }

  activityRoot.innerHTML = state.activity.map(entry => `
    <div class="feed-row">
      <div class="feed-dot"></div>
      <div class="feed-main">
        <strong>${esc(entry.action)}</strong>
        <p>${esc(entry.details)}</p>
        <div class="activity-meta">${new Date(entry.createdAt).toLocaleString()} · ${esc(entry.actorName)}</div>
      </div>
    </div>
  `).join("");
}

async function deleteUser(id) {
  if (!confirm("Are you sure you want to remove this user? This action cannot be undone.")) return;

  try {
    await api(`/users/${id}`, { method: "DELETE" });
    state.users = state.users.filter(item => item._id !== id);
    renderUsers();
    toast("good", "Success", "User account removed.");
  } catch {
    toast("bad", "Error", "Failed to remove user.");
  }
}

function openEditUser(id) {
  const target = state.users.find(item => String(item._id) === String(id));
  if (!target) return;

  refreshFacultyOptions();
  qs("#muTitle").textContent = "Edit User";
  qs("#uName").value = target.name || "";
  qs("#uUser").value = target.username || "";
  qs("#uPass").value = "";
  qs("#uRole").value = target.role || "faculty";
  const sr = target.studentRef;
  qs("#uRoll").value = sr && typeof sr === "object" ? (sr.rollNumber || "") : "";
  qs("#uSection").value = sr && typeof sr === "object" ? (sr.section || "") : "";
  const owner = sr && typeof sr === "object" && sr.createdBy != null ? String(sr.createdBy) : "";
  qs("#uFaculty").value = owner;
  syncStudentFields();
  qs("#uSave").dataset.editId = id;
  qs("#modalUser").classList.add("open");
}

function wireEvents() {
  qs("#uRole")?.addEventListener("change", syncStudentFields);

  qs("#saveSet")?.addEventListener("click", async () => {
    const payload = {
      riskThreshold: Number(qs("#riskT").value),
      passMark: Number(qs("#passM").value),
      defaultTerm: qs("#defaultTerm").value.trim() || "2025-T1",
      marksDeadline: qs("#deadline").value ? new Date(qs("#deadline").value).toISOString() : null,
    };

    try {
      await api("/settings", { method: "PATCH", body: JSON.stringify(payload) });
      toast("good", "Success", "Institutional policies updated.");
    } catch {
      toast("bad", "Error", "Failed to save settings.");
    }
  });

  qs("#btnUser")?.addEventListener("click", () => {
    refreshFacultyOptions();
    qs("#muTitle").textContent = "Add New User";
    qs("#uName").value = "";
    qs("#uUser").value = "";
    qs("#uPass").value = "";
    qs("#uRoll").value = "";
    qs("#uSection").value = "";
    qs("#uFaculty").value = "";
    qs("#uRole").value = "faculty";
    syncStudentFields();
    delete qs("#uSave").dataset.editId;
    qs("#modalUser").classList.add("open");
  });

  qs("#uSave")?.addEventListener("click", async () => {
    const editId = qs("#uSave").dataset.editId;
    const role = qs("#uRole").value;
    const payload = {
      name: qs("#uName").value.trim(),
      username: qs("#uUser").value.trim(),
      role,
    };

    if (qs("#uPass").value) payload.password = qs("#uPass").value;

    if (role === "student") {
      payload.rollNumber = qs("#uRoll").value.trim();
      payload.section = qs("#uSection").value.trim();
      const fid = qs("#uFaculty").value.trim();
      if (fid) payload.facultyId = fid;
    }

    if (!payload.name || !payload.username) {
      toast("warn", "Missing Data", "Name and username are required.");
      return;
    }

    if (!editId && !payload.password) {
      toast("warn", "Missing Data", "Password is required for new users.");
      return;
    }

    try {
      if (editId) {
        const result = await api(`/users/${editId}`, { method: "PATCH", body: JSON.stringify(payload) });
        state.users = state.users.map((item) =>
          String(item._id) === String(editId) ? (result.user || { ...item, ...payload }) : item
        );
        delete qs("#uSave").dataset.editId;
        toast("good", "Updated", "User and linked student profile updated.");
      } else {
        const result = await api("/users", { method: "POST", body: JSON.stringify(payload) });
        state.users.push(result.user);
        toast(
          "good",
          "Created",
          role === "student" ? "Student login created with linked roster profile." : "Account created."
        );
      }

      refreshFacultyOptions();
      renderUsers();
      qs("#modalUser").classList.remove("open");
    } catch (e) {
      toast("bad", "Error", e.message || (editId ? "Failed to update user." : "Failed to create user account."));
    }
  });

  qsa("[data-close]").forEach(element => {
    element.onclick = () => qs(".modal-backdrop.open")?.classList.remove("open");
  });
}

boot();
