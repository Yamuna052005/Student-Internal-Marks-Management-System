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
const roleCopy = {
  admin: {
    kicker: "Admin Control",
    title: "Settings",
    description: "Manage grading policy, users, and approval requests.",
  },
  faculty: {
    kicker: "Faculty Workspace",
    title: "Settings",
    description: "Review your profile, keep your teaching preferences current, and track faculty-related requests.",
  },
  student: {
    kicker: "Student Settings",
    title: "Settings",
    description: "Update your profile and keep your account details current.",
  },
};

let state = {
  settings: {},
  users: [],
  activity: [],
  approvals: [],
};

let facultyApproval = null;
let facultyApprovals = [];

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function initialOf(name) {
  return String(name || "?").trim().charAt(0).toUpperCase() || "?";
}

function applyHeaderCopy() {
  const copy = roleCopy[user?.role] || roleCopy.student;
  const kicker = qs("#settingsKicker");
  const title = qs("#settingsTitle");
  const description = qs("#settingsDescription");
  if (kicker) kicker.textContent = copy.kicker;
  if (title) title.textContent = copy.title;
  if (description) description.textContent = copy.description;
}

async function loadFacultyApprovalData() {
  const approvalData = await api("/marks-approvals").catch(() => ({ approvals: [] }));
  facultyApprovals = approvalData.approvals || [];
  facultyApproval = facultyApprovals[0] || null;
}

async function boot() {
  try {
    applyHeaderCopy();
    if (user.role !== "admin") {
      state.settings = await api("/settings").catch(() => ({}));
      if (user.role === "faculty") {
        await loadFacultyApprovalData();
      } else {
        facultyApproval = null;
        facultyApprovals = [];
      }
      renderProfile();
      renderFacultyApprovalPanel();
      qs("#gradingSection")?.remove();
      qs("#activitySection")?.remove();
      qs("#approvalSection")?.remove();
      qs("aside[data-role='admin']")?.remove();
      wireEvents();
      return;
    }

    const [settings, usersData, activityData, approvalsData] = await Promise.all([
      api("/settings"),
      api("/users"),
      api("/activity"),
      api("/marks-approvals"),
    ]);

    state.settings = settings;
    state.users = usersData.users || [];
    state.activity = activityData.activity || [];
    state.approvals = approvalsData.approvals || [];

    renderProfile();
    renderSettings();
    renderUsers();
    renderActivity();
    renderApprovals();
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

function approvalStatusLabel(status) {
  if (status === "approved") return "Approved";
  if (status === "rejected") return "Rejected";
  return "Pending";
}

function approvalStatusTone(status) {
  if (status === "approved") return "good";
  if (status === "rejected") return "bad";
  return "warn";
}

function renderFacultyApprovalHistory(historyEl) {
  if (!historyEl) return;
  if (!facultyApprovals.length) {
    historyEl.innerHTML = `<div class="empty">No approval requests have been submitted yet.</div>`;
    return;
  }

  historyEl.innerHTML = facultyApprovals
    .map((item) => {
      const tone = approvalStatusTone(item.status);
      const label = approvalStatusLabel(item.status);
      const createdAt = item.createdAt ? new Date(item.createdAt).toLocaleString() : "—";
      const reviewedAt = item.reviewedAt ? new Date(item.reviewedAt).toLocaleString() : "—";
      const reviewedBy = item.reviewedBy?.name || item.reviewedBy?.username || "—";
      const requestNote = item.requestNote ? esc(item.requestNote) : "";
      const reviewNote = item.reviewNote ? esc(item.reviewNote) : "";
      return `<article class="entity-row entity-row-wide" style="margin-bottom:0.75rem">
        <div class="entity-main">
          <div class="entity-title-row">
            <strong>${label}</strong>
            <span class="trend-chip ${tone}">${label}</span>
          </div>
          <span class="entity-subtitle">Submitted ${createdAt}${item.deadlineSnapshot ? ` · deadline ${new Date(item.deadlineSnapshot).toLocaleString()}` : ""}</span>
          ${requestNote ? `<p class="hint" style="margin-top:0.35rem"><strong>Request:</strong> ${requestNote}</p>` : ""}
          ${reviewNote ? `<p class="hint" style="margin-top:0.35rem"><strong>Admin note:</strong> ${reviewNote}</p>` : ""}
        </div>
        <div class="entity-side" style="min-width:220px;align-items:flex-end;">
          <span class="hint" style="text-align:right">Reviewed by ${esc(reviewedBy)}</span>
          <span class="hint" style="text-align:right">Reviewed ${reviewedAt}</span>
        </div>
      </article>`;
    })
    .join("");
}

function renderFacultyApprovalPanel() {
  const section = qs("#facultyApprovalSection");
  const message = qs("#facultyApprovalMessage");
  const status = qs("#facultyApprovalStatus");
  const meta = qs("#facultyApprovalMeta");
  const button = qs("#facultyApprovalBtn");
  const marksLink = qs("#facultyApprovalMarksLink");
  const history = qs("#facultyApprovalHistory");
  if (!section || !message || !status || !meta || !button || !marksLink) return;

  if (user.role !== "faculty") {
    section.remove();
    return;
  }

  renderFacultyApprovalHistory(history);
  meta.textContent = state.settings?.marksDeadline
    ? `Current marks deadline: ${new Date(state.settings.marksDeadline).toLocaleString()}`
    : "No deadline configured.";

  const deadline = state.settings?.marksDeadline ? new Date(state.settings.marksDeadline) : null;
  const pastDeadline = deadline && !Number.isNaN(deadline.getTime()) && Date.now() > deadline.getTime();

  if (!deadline) {
    message.textContent = "Admin has not set a marks deadline yet.";
    status.textContent = "Open";
    status.className = "trend-chip good";
    button.disabled = true;
    button.textContent = "Deadline Not Set";
    return;
  }

  if (!pastDeadline) {
    message.textContent = "Marks entry is open. Approval is only needed after the deadline passes.";
    status.textContent = "Open";
    status.className = "trend-chip good";
    button.disabled = true;
    button.textContent = "Available After Deadline";
    return;
  }

  if (facultyApproval?.status === "approved") {
    message.textContent = "Your post-deadline marks request is approved.";
    status.textContent = "Approved";
    status.className = "trend-chip good";
    button.disabled = true;
    button.textContent = "Approved";
    return;
  }

  if (facultyApproval?.status === "pending") {
    message.textContent = "Your request is waiting for admin review.";
    status.textContent = "Pending";
    status.className = "trend-chip warn";
    button.disabled = true;
    button.textContent = "Request Pending";
    return;
  }

  message.textContent = "Deadline passed. Request admin approval to continue entering marks.";
  status.textContent = "Required";
  status.className = "trend-chip warn";
  button.disabled = false;
  button.textContent = "Send Request";
}

async function submitFacultyApprovalRequest() {
  if (user.role !== "faculty") return;

  const deadline = state.settings?.marksDeadline ? new Date(state.settings.marksDeadline) : null;
  const pastDeadline = deadline && !Number.isNaN(deadline.getTime()) && Date.now() > deadline.getTime();
  if (!pastDeadline) {
    toast("warn", "Not available", "Approval requests are only available after the marks deadline passes.");
    return;
  }
  if (facultyApproval?.status === "approved") {
    toast("good", "Already approved", "Admin has already approved post-deadline marks entry.");
    return;
  }
  if (facultyApproval?.status === "pending") {
    toast("warn", "Already pending", "A request is already waiting for admin review.");
    return;
  }

  const button = qs("#facultyApprovalBtn");
  try {
    if (button) {
      button.disabled = true;
      button.textContent = "Sending...";
    }

    const requestNote = window.prompt("Reason for admin approval:", "Need to enter marks after deadline.") || "";
    const data = await api("/marks-approvals", {
      method: "POST",
      body: JSON.stringify({ requestNote }),
    });

    facultyApproval = data.approval || null;
    facultyApprovals = facultyApproval
      ? [facultyApproval, ...facultyApprovals.filter((item) => String(item._id) !== String(facultyApproval._id))]
      : facultyApprovals;
    renderFacultyApprovalPanel();
    toast("good", "Requested", "Approval request sent to admin.");
  } catch (e) {
    toast("bad", "Request failed", e.message || "Unable to send approval request.");
    await loadFacultyApprovalData().catch(() => {});
  } finally {
    renderFacultyApprovalPanel();
  }
}

function renderSettings() {
  const riskT = qs("#riskT");
  const passM = qs("#passM");
  const defaultTerm = qs("#defaultTerm");
  const deadline = qs("#deadline");
  const saveSet = qs("#saveSet");
  if (!riskT) return;

  if (user.role !== "admin") {
    riskT.disabled = true;
    passM.disabled = true;
    defaultTerm.disabled = true;
    deadline.disabled = true;
    if (saveSet) saveSet.style.display = "none";
  }

  riskT.value = state.settings.riskThreshold ?? 16;
  passM.value = state.settings.passMark ?? 16;
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

  tbody.innerHTML = state.users.map((item) => `
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
      <td><span class="badge ${item.role === "admin" ? "admin" : ""}">${esc(item.role)}</span></td>
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

  qsa(".btn-del-user").forEach((button) => {
    button.onclick = () => deleteUser(button.dataset.id);
  });

  qsa(".btn-edit-user").forEach((button) => {
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

  activityRoot.innerHTML = state.activity.map((entry) => `
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

function renderApprovals() {
  const root = qs("#approvalList");
  if (!root) return;

  if (!state.approvals.length) {
    root.innerHTML = '<div class="empty">No approval requests yet.</div>';
    return;
  }

  root.innerHTML = state.approvals.map((item) => {
    const facultyName = item.faculty?.name || "Faculty";
    const reviewMeta =
      item.reviewedBy?.name && item.reviewedAt
        ? `<div class="hint" style="margin-top:0.35rem;">Reviewed by ${esc(item.reviewedBy.name)} on ${new Date(item.reviewedAt).toLocaleString()}</div>`
        : "";
    const actions = item.status === "pending"
      ? `<div class="table-actions" style="margin-top:0.75rem;">
           <button type="button" class="btn small" data-approve="${item._id}">Approve</button>
           <button type="button" class="btn small danger" data-reject="${item._id}">Reject</button>
         </div>`
      : "";

    return `
      <div class="card" style="margin-bottom:1rem;">
        <div style="display:flex;justify-content:space-between;gap:1rem;flex-wrap:wrap;">
          <div>
            <strong>${esc(facultyName)}</strong>
            <div class="hint">@${esc(item.faculty?.username || "")}</div>
          </div>
          <span class="badge ${item.status === "approved" ? "good" : item.status === "rejected" ? "bad" : "warn"}">${esc(item.status)}</span>
        </div>
        <div class="hint" style="margin-top:0.75rem;">${esc(item.requestNote || "No note provided.")}</div>
        ${item.reviewNote ? `<div class="hint" style="margin-top:0.35rem;">Admin note: ${esc(item.reviewNote)}</div>` : ""}
        ${reviewMeta}
        ${actions}
      </div>
    `;
  }).join("");

  qsa("[data-approve]").forEach((button) => {
    button.onclick = () => reviewApproval(button.dataset.approve, "approved");
  });
  qsa("[data-reject]").forEach((button) => {
    button.onclick = () => reviewApproval(button.dataset.reject, "rejected");
  });
}

async function reviewApproval(id, status) {
  const reviewNote = window.prompt(
    status === "approved" ? "Admin note for approval:" : "Reason for rejection:",
    ""
  ) || "";
  try {
    const result = await api(`/marks-approvals/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ status, reviewNote }),
    });
    state.approvals = state.approvals.map((item) =>
      String(item._id) === String(id) ? result.approval : item
    );
    renderApprovals();
    toast("good", "Updated", `Request ${status}.`);
  } catch (e) {
    toast("bad", "Error", e.message || "Failed to update request.");
  }
}

async function deleteUser(id) {
  if (!confirm("Are you sure you want to remove this user? This action cannot be undone.")) return;

  try {
    await api(`/users/${id}`, { method: "DELETE" });
    state.users = state.users.filter((item) => item._id !== id);
    renderUsers();
    toast("good", "Success", "User account removed.");
  } catch {
    toast("bad", "Error", "Failed to remove user.");
  }
}

function openEditUser(id) {
  const target = state.users.find((item) => String(item._id) === String(id));
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
  qs("#facultyApprovalBtn")?.addEventListener("click", submitFacultyApprovalRequest);
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
      payload.username = payload.rollNumber;
      const fid = qs("#uFaculty").value.trim();
      if (fid) payload.facultyId = fid;
    }

    if (!payload.name || (role !== "student" && !payload.username)) {
      toast("warn", "Missing Data", role === "student" ? "Name and roll number are required." : "Name and username are required.");
      return;
    }

    if (role === "student" && !payload.rollNumber) {
      toast("warn", "Missing Data", "Roll number is required for students.");
      return;
    }

    if (!editId && role !== "student" && !payload.password) {
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

  qsa("[data-close]").forEach((element) => {
    element.onclick = () => qs(".modal-backdrop.open")?.classList.remove("open");
  });
}

boot();
