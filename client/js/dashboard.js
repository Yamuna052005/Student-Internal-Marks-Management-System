import { api, getUser } from "./api.js";
import { requireAuth, refreshMe } from "./auth.js";
import { initShell, toast } from "./app.js";

if (!requireAuth()) throw new Error("auth");

document.documentElement.classList.add("auth-loading");

try {
  await refreshMe();
} catch {
  toast("bad", "Session", "Please sign in again.");
}

initShell({ active: "dashboard" });
document.documentElement.classList.remove("auth-loading");

const user = getUser();
const isAdmin = user?.role === "admin";
const isFaculty = user?.role === "faculty";
const isStudent = user?.role === "student";

const INTERNAL_RISK_TH = 9;
const FINAL_FAIL_TH = 16;

let dashboardSettings = {};
let dashboardApproval = null;
let dashboardApprovals = [];
let studentReport = null;
let summary = {
  total: 0,
  riskCount: 0,
  anomalyCount: 0,
  top: [],
  low: [],
  bySubject: [],
  passFail: { pass: 0, fail: 0 },
  avgScore: 0,
  studentRiskInsights: [],
  predictedHighRiskCount: 0,
};
let marks = [];
let students = [];
let remedials = [];
let grievances = [];
let activity = [];
let grievanceFilters = {
  status: "all",
  search: "",
};
let grievanceRefreshTimer = null;

function esc(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function initialOf(name) {
  return String(name || "?").trim().charAt(0).toUpperCase() || "?";
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function setTrend(id, value, tone = "") {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = value;
  el.className = `trend-chip${tone ? ` ${tone}` : ""}`;
}

function currentName() {
  return isAdmin ? "Administrator Dashboard" : isFaculty ? "Faculty Dashboard" : "Student Dashboard";
}

function getFinal(mark) {
  const n = Number(mark?.final);
  return Number.isFinite(n) ? n : 0;
}

function getCurrentStudentId() {
  const ref = user?.studentRef ?? user?.studentId;
  if (ref && typeof ref === "object" && ref._id != null) return String(ref._id);
  return ref != null ? String(ref) : "";
}

function resolveMarkReleaseDate(mark) {
  const raw = mark?.releasedAt || mark?.createdAt || mark?.updatedAt;
  const date = raw ? new Date(raw) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
}

function resolveGrievanceDeadline(mark) {
  const release = resolveMarkReleaseDate(mark);
  if (!release) return null;
  return new Date(release.getTime() + 3 * 24 * 60 * 60 * 1000);
}

function grievanceForMark(markId) {
  return (grievances || []).find((item) => String(item.marks?._id || item.marks || item.marksId || "") === String(markId));
}

function grievanceStatusLabel(status) {
  if (status === "resolved") return "Resolved";
  if (status === "rejected") return "Rejected";
  if (status === "under_review") return "Under review";
  return "Pending";
}

function grievanceStatusTone(status) {
  if (status === "resolved") return "good";
  if (status === "rejected") return "bad";
  if (status === "under_review") return "warn";
  return "";
}

function grievanceStudentLabel(grievance) {
  const student = grievance?.student || {};
  const roll = student.rollNumber ? ` · ${student.rollNumber}` : "";
  const section = student.section ? ` · Sec ${student.section}` : "";
  return `${student.name || "Unknown student"}${roll}${section}`;
}

function isOpenGrievance(grievance) {
  return grievance && ["pending", "under_review"].includes(String(grievance.status || ""));
}

function selectedGrievanceMark() {
  const select = document.getElementById("grievanceMarkSelect");
  if (!select) return "";
  return String(select.value || "");
}

function isStudentGrievanceOpen(mark) {
  const deadline = resolveGrievanceDeadline(mark);
  return !!deadline && Date.now() <= deadline.getTime();
}

function userDisplayName(userLike) {
  if (typeof userLike === "string") return userLike;
  return userLike?.name || userLike?.username || "";
}

function assignedFacultyForMark(mark, grievance = null) {
  return userDisplayName(grievance?.assignedTo || mark?.updatedBy || grievance?.marks?.updatedBy);
}

function formatDateTime(dateLike) {
  if (!dateLike) return "—";
  const d = new Date(dateLike);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
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
  if (!dashboardApprovals.length) {
    historyEl.innerHTML = `<div class="empty">No approval requests have been submitted yet.</div>`;
    return;
  }

  historyEl.innerHTML = dashboardApprovals
    .map((item) => {
      const tone = approvalStatusTone(item.status);
      const label = approvalStatusLabel(item.status);
      const createdAt = formatDateTime(item.createdAt);
      const reviewedAt = item.reviewedAt ? formatDateTime(item.reviewedAt) : "—";
      const reviewedBy = item.reviewedBy?.name || item.reviewedBy?.username || "—";
      const requestNote = item.requestNote ? esc(item.requestNote) : "";
      const reviewNote = item.reviewNote ? esc(item.reviewNote) : "";
      return `<article class="entity-row entity-row-wide" style="margin-bottom:0.75rem">
        <div class="entity-main">
          <div class="entity-title-row">
            <strong>${label}</strong>
            <span class="trend-chip ${tone}">${label}</span>
          </div>
          <span class="entity-subtitle">Submitted ${createdAt}${item.deadlineSnapshot ? ` · deadline ${formatDateTime(item.deadlineSnapshot)}` : ""}</span>
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

function markGrievanceLabel(mark) {
  const deadline = resolveGrievanceDeadline(mark);
  const status = grievanceForMark(mark?._id);
  const final = getFinal(mark);
  const parts = [mark?.subject || "Subject", mark?.term || ""].filter(Boolean).join(" · ");
  return `${parts} · final ${final}${deadline ? ` · closes ${deadline.toLocaleDateString()}` : ""}${status ? ` · ${grievanceStatusLabel(status.status)}` : ""}`;
}

function getSubjectAvgRows() {
  return [...(summary.bySubject || [])].sort((a, b) => Number(b.avgFinal || 0) - Number(a.avgFinal || 0));
}

function academicYearLabel(index) {
  return ["First Year", "Second Year", "Third Year", "Final Year"][index] || `Year ${index + 1}`;
}

function normalizeStudentAcademicFlow() {
  const years = studentReport?.years || [];
  const orderedYears = [...years].sort((a, b) => String(a.yearKey || "").localeCompare(String(b.yearKey || ""), undefined, { numeric: true }));
  const namedYears = orderedYears.slice(0, 4).map((year, index) => {
    const semesters = [...(year.semesters || [])].sort((a, b) =>
      String(a.term || "").localeCompare(String(b.term || ""), undefined, { numeric: true, sensitivity: "base" })
    );
    const semesterSlots = [0, 1].map((slotIndex) => {
      const semester = semesters[slotIndex] || null;
      return semester
        ? {
            ...semester,
            displayName: `Semester ${slotIndex + 1}`,
          }
        : {
            semester: `Semester ${slotIndex + 1}`,
            displayName: `Semester ${slotIndex + 1}`,
            term: "",
            subjects: [],
          };
    });

    return {
      title: academicYearLabel(index),
      sourceYear: year.year || "",
      semesters: semesterSlots,
    };
  });

  while (namedYears.length < 4) {
    namedYears.push({
      title: academicYearLabel(namedYears.length),
      sourceYear: "",
      semesters: [
        { semester: "Semester 1", displayName: "Semester 1", term: "", subjects: [] },
        { semester: "Semester 2", displayName: "Semester 2", term: "", subjects: [] },
      ],
    });
  }

  return namedYears;
}

function renderListRoot(el, rows, emptyMsg, mapFn) {
  if (!el) return;
  if (!rows || !rows.length) {
    el.innerHTML = `<div class="empty">${esc(emptyMsg)}</div>`;
    return;
  }
  el.innerHTML = rows.map(mapFn).join("");
}

function renderTopPerformers(el, rows) {
  renderListRoot(
    el,
    rows,
    "No marks recorded yet.",
    (mark, index) => {
      const name = mark.student?.name || "Unknown";
      return `<div class="entity-row">
        <div class="entity-avatar">${initialOf(name)}</div>
        <div class="entity-main">
          <div class="entity-title-row">
            <strong>${esc(name)}</strong>
            <span class="mini-rank">#${index + 1}</span>
          </div>
          <span class="entity-subtitle">${esc(mark.subject || "-")} - ${esc(mark.term || "")}</span>
        </div>
        <div class="entity-side">
          <span class="trend-chip good">Passing</span>
          <span class="metric-value good">${getFinal(mark)}</span>
        </div>
      </div>`;
    }
  );
}

function renderLowList(el, rows) {
  renderListRoot(
    el,
    rows,
    "No low-score records detected.",
    (mark) => {
      const name = mark.student?.name || "Unknown";
      return `<div class="entity-row">
        <div class="entity-avatar">${initialOf(name)}</div>
        <div class="entity-main">
          <strong>${esc(name)}</strong>
          <span class="entity-subtitle">${esc(mark.subject || "-")} - final ${esc(String(getFinal(mark)))}</span>
        </div>
        <div class="entity-side">
          <span class="trend-chip bad">At risk</span>
        </div>
      </div>`;
    }
  );
}

function renderResults(el, passFail, passMark) {
  if (!el) return;
  const pass = Number(passFail?.pass ?? 0);
  const fail = Number(passFail?.fail ?? 0);
  const total = pass + fail;
  if (!total) {
    el.innerHTML = `<div class="empty">No result data available yet.</div>`;
    return;
  }
  const passPct = Math.round((pass / total) * 100);
  const failPct = Math.round((fail / total) * 100);
  el.innerHTML = `
    <div class="entity-row entity-row-wide">
      <div class="entity-main">
        <div class="entity-title-row"><strong>Pass Results</strong></div>
        <span class="entity-subtitle">${pass} records at or above ${passMark}</span>
      </div>
      <div class="entity-side">
        <span class="trend-chip good">${passPct}%</span>
        <span class="metric-value good">${pass}</span>
      </div>
    </div>
    <div class="entity-row entity-row-wide">
      <div class="entity-main">
        <div class="entity-title-row"><strong>Fail Results</strong></div>
        <span class="entity-subtitle">${fail} records below ${passMark}</span>
      </div>
      <div class="entity-side">
        <span class="trend-chip bad">${failPct}%</span>
        <span class="metric-value bad">${fail}</span>
      </div>
    </div>`;
}

function renderActivityFeed(el, rows) {
  renderListRoot(
    el,
    rows,
    "No recent activity.",
    (row) => {
      const time = row.createdAt ? new Date(row.createdAt).toLocaleString() : "";
      return `<div class="feed-row">
        <div class="feed-dot"></div>
        <div class="feed-main">
          <strong>${esc(row.action || "System Event")}</strong>
          <p>${esc(row.details || "")}</p>
          <div class="activity-meta">${esc(time)}</div>
        </div>
      </div>`;
    }
  );
}

function renderSubjectSummary() {
  const root = document.getElementById("academicReportTree");
  if (!root) return;
  if (isStudent && studentReport) {
    const years = normalizeStudentAcademicFlow();
    if (!years.length) {
      root.innerHTML = `<div class="empty">No academic records are available yet.</div>`;
      return;
    }
    root.innerHTML = `
      <div class="academic-flow-legend">
        <span class="academic-flow-legend-step">Year</span>
        <span class="academic-flow-arrow">-></span>
        <span class="academic-flow-legend-step">Semester</span>
        <span class="academic-flow-arrow">-></span>
        <span class="academic-flow-legend-step">Subjects</span>
        <span class="academic-flow-arrow">-></span>
        <span class="academic-flow-legend-step">Marks</span>
      </div>
      <div class="academic-flow-body">
        ${years
          .map((year) => {
            const semesters = year.semesters || [];
            return `<article class="academic-flow-year">
              <div class="academic-flow-step academic-flow-step--year">
                <span class="academic-flow-eyebrow">Year</span>
                <div class="academic-flow-year-value">${esc(year.title || "Year")}</div>
                ${year.sourceYear ? `<div class="hint" style="margin-top:0.2rem">${esc(year.sourceYear)}</div>` : ""}
              </div>
              <div class="academic-flow-nest academic-flow-nest--under-year">
                ${semesters
                  .map((semester) => {
                    const subjects = semester.subjects || [];
                    const semesterLabel = semester.displayName || semester.semester || "Semester";
                    return `<section class="academic-flow-semester">
                      <div class="academic-flow-step academic-flow-step--semester">
                        <span class="academic-flow-eyebrow">Semester</span>
                        <div class="academic-flow-step-body">${esc(semesterLabel)}</div>
                        <div class="hint" style="margin-top:0.2rem">${esc(semester.term || "")}</div>
                      </div>
                      <div class="academic-flow-nest">
                        <ul class="academic-flow-subject-list">
                          ${subjects
                            .map((mark) => {
                              const final = getFinal(mark);
                              const internalTotal = Number(mark.internalTotal ?? (Number(mark.internal1 || 0) + Number(mark.internal2 || 0)));
                              const passed = final >= (dashboardSettings.passMark ?? 16);
                              const grievance = grievanceForMark(mark._id);
                              const deadline = resolveGrievanceDeadline(mark);
                              const withinWindow = isStudentGrievanceOpen(mark);
                              const openGrievance = isOpenGrievance(grievance);
                              const grievanceTone = grievance ? grievanceStatusTone(grievance.status) : withinWindow ? "good" : "bad";
                              const grievanceLabel = grievance
                                ? grievanceStatusLabel(grievance.status)
                                : withinWindow
                                  ? "Raise grievance"
                                  : "Window closed";
                              return `<li class="academic-flow-subject">
                                <div class="academic-flow-subject-head">
                                  <span class="academic-flow-eyebrow">Subject</span>
                                  <div class="academic-flow-subject-name"><strong>${esc(mark.subject || "-")}</strong></div>
                                  <div class="academic-flow-subject-side">
                                    <span class="trend-chip ${passed ? "good" : "warn"}">Final ${esc(String(final))}</span>
                                    <span class="badge ${passed ? "good" : "warn"}">${passed ? "Pass" : "Below pass mark"}</span>
                                  </div>
                                </div>
                                <div class="academic-flow-marks-block">
                                  <div class="academic-flow-marks-grid">
                                    <div><span class="entity-subtitle">Mid-1 (25)</span><div>${esc(String(mark.mid1 ?? "-"))}</div></div>
                                    <div><span class="entity-subtitle">Assignment-1 (5)</span><div>${esc(String((mark.assignment ?? mark.assignment1) ?? "-"))}</div></div>
                                    <div><span class="entity-subtitle">Mid-2 (25)</span><div>${esc(String(mark.mid2 ?? "-"))}</div></div>
                                    <div><span class="entity-subtitle">Assignment-2 (5)</span><div>${esc(String((mark.lab ?? mark.assignment2) ?? "-"))}</div></div>
                                    <div><span class="entity-subtitle">Internal-1 total</span><div>${esc(String(Number(mark.internal1 ?? 0) || "-"))}</div></div>
                                    <div><span class="entity-subtitle">Internal-2 total</span><div>${esc(String(Number(mark.internal2 ?? 0) || "-"))}</div></div>
                                  <div><span class="entity-subtitle">Updated</span><div>${esc(mark.updatedAt ? new Date(mark.updatedAt).toLocaleDateString() : "-")}</div></div>
                                  </div>
                                </div>
                                <div class="academic-flow-subject-foot" style="margin-top:0.9rem;display:flex;gap:0.75rem;flex-wrap:wrap;align-items:center;justify-content:space-between;">
                                  <div class="hint" style="font-size:0.85rem">
                                    ${grievance
                                      ? `Complaint submitted ${esc(formatDateTime(grievance.createdAt))}${grievance.reviewedAt ? ` · reviewed ${esc(formatDateTime(grievance.reviewedAt))}` : ""}`
                                      : deadline
                                        ? `Complaint window closes ${esc(deadline.toLocaleString())}`
                                        : "Complaint window unavailable."}
                                  </div>
                                  <div style="display:flex;gap:0.5rem;align-items:center;flex-wrap:wrap;">
                                    <span class="trend-chip ${grievanceTone}">${esc(grievanceLabel)}</span>
                                    <button type="button" class="btn small ${(openGrievance || !withinWindow) ? "ghost" : "primary"}" data-grievance-mark="${esc(mark._id)}" ${openGrievance || !withinWindow ? "disabled" : ""}>
                                      ${openGrievance ? "Already filed" : withinWindow && grievance ? "Raise grievance again" : withinWindow ? "Raise grievance" : "Closed"}
                                    </button>
                                  </div>
                                </div>
                              </li>`;
                            })
                            .join("")}
                          ${!subjects.length ? `<li class="empty" style="text-align:left">No marks recorded for this semester yet.</li>` : ""}
                        </ul>
                      </div>
                    </section>`;
                  })
                  .join("")}
              </div>
            </article>`;
          })
          .join("")}
      </div>`;
    return;
  }

  const rows = getSubjectAvgRows();
  if (!rows.length) {
    root.innerHTML = `<div class="empty">No subject averages available yet.</div>`;
    return;
  }
  root.innerHTML = `
    <div class="list-stack">
      ${rows
        .map((row) => {
          const avg = Number(row.avgFinal || 0);
          const pct = Math.max(0, Math.min(100, Math.round((avg / 25) * 100)));
          return `<div class="entity-row entity-row-wide">
            <div class="entity-main">
              <div class="entity-title-row"><strong>${esc(row._id)}</strong></div>
              <span class="entity-subtitle">Average final across synced records</span>
            </div>
            <div class="entity-side" style="min-width:140px;">
              <span class="trend-chip ${avg >= (dashboardSettings.passMark ?? 16) ? "good" : "warn"}">${avg}</span>
              <div style="width:120px;height:8px;border-radius:999px;background:rgba(255,255,255,0.08);overflow:hidden;">
                <div style="width:${pct}%;height:100%;background:linear-gradient(90deg, var(--primary), #7c8cff);"></div>
              </div>
            </div>
          </div>`;
        })
        .join("")}
    </div>`;
}

function renderStudentGrievanceForm() {
  const select = document.getElementById("grievanceMarkSelect");
  const deadlineHint = document.getElementById("grievanceDeadlineHint");
  const alertBox = document.getElementById("studentGrievanceAlert");
  const facultyHint = document.getElementById("grievanceAssignedFaculty");
  if (!select || !deadlineHint || !alertBox) return;

  const studentMarks = (marks || []).slice().sort((a, b) => String(a.subject || "").localeCompare(String(b.subject || ""), undefined, { sensitivity: "base" }));
  const options = studentMarks.map((mark) => {
    const grievance = grievanceForMark(mark._id);
    const deadline = resolveGrievanceDeadline(mark);
    const closed = !deadline || Date.now() > deadline.getTime();
    const label = `${mark.subject || "Subject"} · ${mark.term || "Term"} · final ${getFinal(mark)}${closed ? " · closed" : ""}${grievance ? ` · ${grievanceStatusLabel(grievance.status)}` : ""}`;
    return `<option value="${esc(mark._id)}">${esc(label)}</option>`;
  });

  if (!options.length) {
    select.innerHTML = `<option value="">No marks available</option>`;
    select.disabled = true;
    deadlineHint.textContent = "No mark entries are available for grievance submission.";
    alertBox.textContent = "Your complaint form will appear here once marks are available.";
    if (facultyHint) facultyHint.textContent = "Assigned faculty: â€”";
    return;
  }

  const previous = select.value;
  select.innerHTML = options.join("");
  select.disabled = false;
  if (previous && studentMarks.some((mark) => String(mark._id) === String(previous))) {
    select.value = previous;
  } else if (!select.value) {
    select.value = studentMarks[0]?._id || "";
  }

  const current = studentMarks.find((mark) => String(mark._id) === String(select.value)) || null;
  if (!current) return;
  const deadline = resolveGrievanceDeadline(current);
  const grievance = grievanceForMark(current._id);
  const openGrievance = isOpenGrievance(grievance);
  const facultyName = assignedFacultyForMark(current, grievance);
  if (facultyHint) {
    facultyHint.textContent = facultyName ? `Assigned faculty: ${facultyName}` : "Assigned faculty: not available yet";
  }
  deadlineHint.textContent = deadline
    ? `Window closes ${deadline.toLocaleString()}`
    : "This mark does not have a valid release date yet.";
  alertBox.textContent = openGrievance
    ? `Selected mark already has a ${grievanceStatusLabel(grievance.status).toLowerCase()} complaint.`
    : grievance
      ? `A previous complaint exists for this mark, but a new one can still be raised while the window is open.`
      : isStudentGrievanceOpen(current)
      ? "You can submit a complaint for the selected mark."
      : "The 3-day grievance window has already closed for the selected mark.";
}

function renderStudentGrievanceHistory() {
  const list = document.getElementById("studentGrievanceList");
  if (!list) return;
  const rows = [...(grievances || [])].sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  if (!rows.length) {
    list.innerHTML = `<div class="empty">No grievances submitted yet.</div>`;
    return;
  }
  list.innerHTML = rows
    .map((grievance) => {
      const mark = grievance.marks || {};
      const tone = grievanceStatusTone(grievance.status);
      const reviewer = grievance.reviewedBy?.name || grievance.reviewedBy?.username || "";
      const reviewedAt = grievance.reviewedAt ? formatDateTime(grievance.reviewedAt) : "";
      const assignedFaculty = assignedFacultyForMark(mark, grievance);
      return `<div class="entity-row entity-row-wide">
        <div class="entity-main">
          <div class="entity-title-row">
            <strong>${esc(mark.subject || grievance.subject || "Subject")}</strong>
            <span class="trend-chip ${tone}">${esc(grievanceStatusLabel(grievance.status))}</span>
          </div>
          <span class="entity-subtitle">${esc(mark.term || grievance.term || "")} · submitted ${esc(formatDateTime(grievance.createdAt))}</span>
          ${assignedFaculty ? `<p class="hint" style="margin-top:0.35rem">Assigned faculty: ${esc(assignedFaculty)}</p>` : ""}
          <p class="hint" style="margin-top:0.35rem">${esc(grievance.justification || "")}</p>
          ${grievance.supportingDetails ? `<p class="hint" style="margin-top:0.35rem">Supporting: ${esc(grievance.supportingDetails)}</p>` : ""}
          ${grievance.resolutionNote ? `<p class="hint" style="margin-top:0.35rem">Resolution: ${esc(grievance.resolutionNote)}</p>` : ""}
          ${reviewer || reviewedAt ? `<p class="hint" style="margin-top:0.35rem">Reviewed ${esc(reviewedAt || "—")}${reviewer ? ` by ${esc(reviewer)}` : ""}</p>` : ""}
        </div>
        <div class="entity-side">
          <span class="metric-value">${esc(String(grievance.deadlineExpired ? "Closed" : "Open"))}</span>
        </div>
      </div>`;
    })
    .join("");
}

function renderStaffGrievancePanel() {
  const section = document.getElementById("staffGrievanceSection");
  const list = document.getElementById("staffGrievanceList");
  const statusFilter = document.getElementById("staffGrievanceStatus");
  const searchInput = document.getElementById("staffGrievanceSearch");
  const message = document.getElementById("staffGrievanceMessage");
  const openCount = document.getElementById("grievanceOpenCount");
  const resolvedCount = document.getElementById("grievanceResolvedCount");
  const rejectedCount = document.getElementById("grievanceRejectedCount");

  if (!section || !list || !statusFilter || !searchInput) return;
  if (isStudent) {
    section.remove();
    return;
  }

  statusFilter.value = grievanceFilters.status;
  searchInput.value = grievanceFilters.search;

  const search = String(grievanceFilters.search || "").trim().toLowerCase();
  const filtered = [...(grievances || [])]
    .filter((item) => {
      if (grievanceFilters.status !== "all" && String(item.status || "") !== grievanceFilters.status) return false;
      if (!search) return true;
      const student = item.student || {};
      const haystack = [
        student.name,
        student.rollNumber,
        student.section,
        item.subject,
        item.term,
        item.justification,
        item.supportingDetails,
        item.status,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(search);
    })
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));

  const counts = (grievances || []).reduce(
    (acc, item) => {
      const status = String(item.status || "pending");
      if (status === "resolved") acc.resolved += 1;
      else if (status === "rejected") acc.rejected += 1;
      else acc.open += 1;
      return acc;
    },
    { open: 0, resolved: 0, rejected: 0 }
  );

  if (openCount) openCount.textContent = String(counts.open);
  if (resolvedCount) resolvedCount.textContent = String(counts.resolved);
  if (rejectedCount) rejectedCount.textContent = String(counts.rejected);
  if (message) {
    message.textContent = filtered.length
      ? `Showing ${filtered.length} grievance${filtered.length === 1 ? "" : "s"} from ${grievances.length} total records.`
      : "No grievances match the current filter.";
  }

  if (!grievances.length) {
    list.innerHTML = `<div class="empty">No student grievances have been submitted yet.</div>`;
    return;
  }
  if (!filtered.length) {
    list.innerHTML = `<div class="empty">No grievances match the selected filter.</div>`;
    return;
  }

  list.innerHTML = filtered
    .map((item) => {
      const student = item.student || {};
      const mark = item.marks || {};
      const tone = grievanceStatusTone(item.status);
      const isOpen = item.status === "pending" || item.status === "under_review";
      const statusText = grievanceStatusLabel(item.status);
      const submittedAt = formatDateTime(item.createdAt);
      const reviewedAt = item.reviewedAt ? formatDateTime(item.reviewedAt) : "—";
      const deadlineText = item.deadlineAt ? formatDateTime(item.deadlineAt) : "—";
      const actionLabel = item.status === "resolved" ? "Mark as resolved" : item.status === "rejected" ? "Mark as rejected" : "Update status";
      return `<article class="entity-row entity-row-wide">
        <div class="entity-main">
          <div class="entity-title-row">
            <strong>${esc(grievanceStudentLabel(item))}</strong>
            <span class="trend-chip ${tone}">${esc(statusText)}</span>
          </div>
          <span class="entity-subtitle">${esc(mark.subject || item.subject || "Subject")} · ${esc(mark.term || item.term || "")} · submitted ${esc(submittedAt)}</span>
          <p class="hint" style="margin-top:0.35rem"><strong>Justification:</strong> ${esc(item.justification || "")}</p>
          ${item.supportingDetails ? `<p class="hint" style="margin-top:0.35rem"><strong>Supporting:</strong> ${esc(item.supportingDetails)}</p>` : ""}
          ${item.resolutionNote ? `<p class="hint" style="margin-top:0.35rem"><strong>Resolution:</strong> ${esc(item.resolutionNote)}</p>` : ""}
          <div class="hint" style="margin-top:0.35rem;font-size:0.85rem">
            Deadline: ${esc(deadlineText)} · Reviewed: ${esc(reviewedAt)}
          </div>
        </div>
        <div class="entity-side" style="min-width:220px;align-items:flex-end;">
          <span class="metric-value">${esc(mark.final != null ? String(mark.final) : "—")}</span>
          <span class="hint" style="text-align:right">${esc(student.rollNumber ? `Roll ${student.rollNumber}` : "No roll number")}</span>
          <div class="table-actions" style="display:flex;gap:0.5rem;flex-wrap:wrap;justify-content:flex-end;margin-top:0.5rem;">
            <button type="button" class="btn small" data-grievance-status="under_review" data-grievance-id="${esc(item._id)}" ${item.status === "under_review" ? "disabled" : ""}>Under review</button>
            <button type="button" class="btn small" data-grievance-status="resolved" data-grievance-id="${esc(item._id)}">Resolve</button>
            <button type="button" class="btn small danger" data-grievance-status="rejected" data-grievance-id="${esc(item._id)}">Reject</button>
          </div>
          <span class="hint" style="font-size:0.8rem;text-align:right;margin-top:0.25rem">${isOpen ? "Open complaint" : "Closed complaint"}</span>
        </div>
      </article>`;
    })
    .join("");
}

async function updateGrievanceStatus(id, status) {
  let resolutionNote = "";
  if (status === "resolved" || status === "rejected") {
    const note = window.prompt(
      status === "resolved"
        ? "Enter a resolution note for this grievance:"
        : "Enter a rejection note for this grievance:",
      ""
    );
    if (note === null) return;
    resolutionNote = note.trim();
  }
  try {
    await api(`/grievances/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ status, resolutionNote }),
    });
    toast("good", "Updated", `Grievance marked as ${status.replace("_", " ")}.`);
    await refreshGrievances();
  } catch (e) {
    toast("bad", "Update failed", e.message || "Unable to update grievance.");
  }
}

async function submitStudentGrievance(event) {
  event.preventDefault();
  const marksId = selectedGrievanceMark();
  const justification = String(document.getElementById("grievanceJustification")?.value || "").trim();
  const supportingDetails = String(document.getElementById("grievanceSupport")?.value || "").trim();
  const btn = document.getElementById("grievanceSubmitBtn");
  if (!marksId) {
    toast("bad", "Validation", "Select the mark entry first.");
    return;
  }
  if (justification.length < 10) {
    toast("bad", "Validation", "Add a clear justification of at least 10 characters.");
    return;
  }

  const current = marks.find((mark) => String(mark._id) === String(marksId));
  if (!current) {
    toast("bad", "Validation", "Selected mark was not found.");
    return;
  }
  if (!isStudentGrievanceOpen(current)) {
    toast("warn", "Window closed", "This mark is past the 3-day grievance deadline.");
    renderStudentGrievanceForm();
    return;
  }
  if (isOpenGrievance(grievanceForMark(marksId))) {
    toast("warn", "Duplicate", "A complaint already exists for this mark.");
    renderStudentGrievanceForm();
    return;
  }

  try {
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Submitting...";
    }
    await api("/grievances", {
      method: "POST",
      body: JSON.stringify({ marksId, justification, supportingDetails }),
    });
    toast("good", "Submitted", "Your grievance has been sent for review.");
    document.getElementById("grievanceJustification").value = "";
    document.getElementById("grievanceSupport").value = "";
    await refreshStudentGrievances();
  } catch (e) {
    toast("bad", "Submission failed", e.message || "Unable to submit grievance.");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Submit grievance";
    }
    renderStudentGrievanceForm();
  }
}

async function refreshStudentGrievances() {
  if (!isStudent) return;
  const data = await api("/grievances").catch(() => ({ grievances: [] }));
  grievances = data.grievances || [];
  renderStudentGrievanceForm();
  renderStudentGrievanceHistory();
  renderDashboardLists();
}

async function refreshStaffGrievances() {
  if (isStudent) return;
  const data = await api("/grievances").catch(() => ({ grievances: [] }));
  grievances = data.grievances || [];
  renderDashboardLists();
}

async function refreshGrievances() {
  if (isStudent) {
    await refreshStudentGrievances();
    return;
  }
  await refreshStaffGrievances();
}

function renderRiskLists() {
  if (isStudent) {
    document.getElementById("studentLowFinalList")?.closest(".card")?.remove();
    return;
  }
  const lowFinalSource = isStudent && studentReport ? studentReport.lowFinalSubjects || [] : marks;
  const internalRiskSource = isStudent && studentReport ? studentReport.internalRiskSubjects || [] : marks;
  const remedialSource = isStudent && studentReport ? studentReport.remedials || [] : remedials;
  const studentName = studentReport?.student?.name || user?.name || "Unknown";

  const lowFinal = [...lowFinalSource]
    .filter((m) => Number(m.final ?? m.finalNum ?? m.finalScore ?? getFinal(m)) < FINAL_FAIL_TH)
    .sort((a, b) => Number(a.final ?? 0) - Number(b.final ?? 0));
  const internalRisk = [...internalRiskSource].filter((m) => {
    const i1 = Number(m.internal1 || 0);
    const i2 = Number(m.internal2 || 0);
    return (i1 > 0 && i1 < INTERNAL_RISK_TH) || (i2 > 0 && i2 < INTERNAL_RISK_TH);
  });
  renderListRoot(
    document.getElementById("studentLowFinalList"),
    lowFinal,
    `No subjects with final mark under ${FINAL_FAIL_TH}.`,
    (mark) => `<div class="entity-row">
      <div class="entity-main"><strong>${esc(mark.subject || "-")}</strong><span class="entity-subtitle">${esc(mark.student?.name || studentName)} - final ${esc(String(getFinal(mark)))}</span></div>
      <div class="entity-side"><span class="trend-chip bad">Below ${FINAL_FAIL_TH}</span></div>
    </div>`
  );
  renderListRoot(
    document.getElementById("studentInternalRiskList"),
    internalRisk,
    `No subjects with Internal-1 or Internal-2 below ${INTERNAL_RISK_TH}.`,
    (mark) => `<div class="entity-row">
      <div class="entity-main"><strong>${esc(mark.subject || "-")}</strong><span class="entity-subtitle">${esc(mark.student?.name || studentName)} - I1 ${esc(String(mark.internal1 ?? "-"))} - I2 ${esc(String(mark.internal2 ?? "-"))}</span></div>
      <div class="entity-side"><span class="trend-chip bad">At Risk</span></div>
    </div>`
  );

  renderListRoot(
    document.getElementById("studentRemedialList"),
    remedialSource,
    "No remedial sessions on record.",
    (r) => {
      const subj = r.marks?.subject || "Subject";
      const when = r.createdAt ? new Date(r.createdAt).toLocaleString() : "";
      return `<div class="remedial-mini">
        <strong>${esc(subj)}</strong> - ${esc(String(r.beforeFinal ?? "-"))} to ${esc(String(r.afterFinal ?? "-"))}
        <div class="activity-meta">${esc(when)}</div>
        ${r.notes ? `<p style="margin-top:0.35rem;color:var(--text-muted)">${esc(r.notes)}</p>` : ""}
      </div>`;
    }
  );
}

function updateDashboardStats() {
  const studentCount = isStudent ? 1 : students.length;
  const recordCount = summary.total || marks.length;
  const sections = isStudent
    ? (studentReport?.years || []).length
    : new Set(students.map((s) => String(s.section || "").trim()).filter(Boolean)).size;
  const avgScore = Number(summary.avgScore || 0);
  const subjectCount = isStudent
    ? (studentReport?.years || [])
        .flatMap((year) => year.semesters || [])
        .flatMap((semester) => semester.subjects || []).length
    : students.length;

  setText("heroGreeting", currentName());
  setText("heroStatus", isFaculty ? "Faculty mode" : isStudent ? "Academic report" : "Operational");
  setText("kpiStudentsLabel", isStudent ? "Student profile" : "Students");
  setText("kpiRecordsLabel", isStudent ? "Subjects" : "Synced records");
  setText("kpiRiskLabel", isStudent ? "Semesters" : "At Risk");
  setText("kpiAnomLabel", isStudent ? "Average" : "Anomalies");
  setText("kpiStudents", String(studentCount));
  setText("kpiRecords", String(isStudent ? subjectCount : recordCount));
  setText("kpiRisk", String(isStudent ? sections : summary.riskCount || 0));
  setText("kpiAnom", String(isStudent ? avgScore.toFixed(1) : summary.anomalyCount || 0));

  setTrend("kpiStudentsTrend", isStudent ? `${studentCount} student` : `${sections || 0} sections`, "good");
  setTrend("kpiRecordsTrend", isStudent ? `${sections || 0} year${sections === 1 ? "" : "s"}` : `${avgScore.toFixed(1)} avg`, "warn");
  setTrend("kpiRiskTrend", isStudent ? `Report summary` : `Threshold < ${dashboardSettings.riskThreshold ?? FINAL_FAIL_TH}`, "good");
  setTrend("kpiAnomTrend", isStudent ? `Final average` : `${summary.predictedHighRiskCount || 0} watch`, "warn");
  setTrend("heroStatus", isFaculty ? "Faculty dashboard" : isStudent ? "Academic report" : "Operational", "good");
}

function renderFacultyApprovalPanel() {
  const section = document.getElementById("facultyApprovalSection");
  const message = document.getElementById("facultyApprovalMessage");
  const status = document.getElementById("facultyApprovalStatus");
  const meta = document.getElementById("facultyApprovalMeta");
  const button = document.getElementById("facultyApprovalBtn");
  const marksLink = document.getElementById("facultyApprovalMarksLink");
  const history = document.getElementById("facultyApprovalHistory");
  if (!section || !message || !status || !meta || !button || !marksLink) return;

  if (!isFaculty) {
    section.remove();
    return;
  }

  renderFacultyApprovalHistory(history);

  meta.textContent = dashboardSettings?.marksDeadline
    ? `Current marks deadline: ${new Date(dashboardSettings.marksDeadline).toLocaleString()}`
    : "No deadline configured.";

  const deadline = dashboardSettings?.marksDeadline ? new Date(dashboardSettings.marksDeadline) : null;
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

  if (dashboardApproval?.status === "approved") {
    message.textContent = "Your post-deadline marks request is approved.";
    status.textContent = "Approved";
    status.className = "trend-chip good";
    button.disabled = true;
    button.textContent = "Approved";
    return;
  }

  if (dashboardApproval?.status === "pending") {
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
  if (!isFaculty) return;

  const deadline = dashboardSettings?.marksDeadline ? new Date(dashboardSettings.marksDeadline) : null;
  const pastDeadline = deadline && !Number.isNaN(deadline.getTime()) && Date.now() > deadline.getTime();
  if (!pastDeadline) {
    toast("warn", "Not available", "Approval requests are only available after the marks deadline passes.");
    return;
  }
  if (dashboardApproval?.status === "approved") {
    toast("good", "Already approved", "Admin has already approved post-deadline marks entry.");
    return;
  }
  if (dashboardApproval?.status === "pending") {
    toast("warn", "Already pending", "A request is already waiting for admin review.");
    return;
  }

  const button = document.getElementById("facultyApprovalBtn");
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

    dashboardApproval = data.approval || null;
    dashboardApprovals = dashboardApproval
      ? [dashboardApproval, ...dashboardApprovals.filter((item) => String(item._id) !== String(dashboardApproval._id))]
      : dashboardApprovals;
    renderFacultyApprovalPanel();
    toast("good", "Requested", "Approval request sent to admin.");
  } catch (e) {
    toast("bad", "Request failed", e.message || "Unable to send approval request.");
    await loadDashboardData().catch(() => {});
  } finally {
    renderFacultyApprovalPanel();
  }
}

function renderDashboardLists() {
  const topRows = (summary.top || []).slice(0, 6);
  const lowRows = (summary.low || []).slice(0, 6);
  renderTopPerformers(document.getElementById("topList"), topRows);
  renderLowList(document.getElementById("lowList"), lowRows);
  renderResults(document.getElementById("resultsList"), summary.passFail, dashboardSettings.passMark ?? 16);
  if (!isStudent) {
    renderActivityFeed(document.getElementById("actList"), activity.slice(0, 8));
  }
  renderSubjectSummary();
  if (isStudent) {
    renderStudentGrievanceForm();
    renderStudentGrievanceHistory();
  } else {
    renderStaffGrievancePanel();
  }
  if (!isStudent) renderRiskLists();

  const studentSectionTitle = document.querySelector("#studentSection h2");
  const studentSectionHint = document.querySelector("#studentSection .hint");
  if (studentSectionTitle) studentSectionTitle.textContent = isStudent ? "Academic Report" : "Subject Summary and Risks";
  if (studentSectionHint) {
    studentSectionHint.textContent = isStudent
      ? "Year, semester, subject, and mark breakdown."
      : "Subject averages, low finals, internal risks, and recent remedial sessions.";
  }
  if (!isStudent) {
    document.getElementById("studentGrievanceCard")?.remove();
  }
}

async function loadDashboardData() {
  const studentId = getCurrentStudentId();
  const settingsPromise = api("/settings");
  const summaryPromise = api("/analytics/summary?term=all");
  const studentsPromise = api("/students?limit=5000").catch(() => ({ students: [] }));
  const marksPromise = api("/marks?page=1&limit=5000&term=all").catch(() => ({ marks: [] }));
  let reportPromise = Promise.resolve(null);
  let remedialsPromise = Promise.resolve({ remedials: [] });
  let grievancesPromise = Promise.resolve({ grievances: [] });
  let activityPromise = Promise.resolve({ activity: [] });

  if (isStudent && studentId) {
    reportPromise = api(`/students/${encodeURIComponent(studentId)}/academic-report`).catch(() => null);
    grievancesPromise = api("/grievances").catch(() => ({ grievances: [] }));
  } else {
    remedialsPromise = api("/remedials").catch(() => ({ remedials: [] }));
    activityPromise = api("/activity").catch(() => ({ activity: [] }));
    grievancesPromise = api("/grievances").catch(() => ({ grievances: [] }));
  }

  const [settings, summaryData, studentsData, marksData, reportData, remedialsData, grievancesData, activityData] = await Promise.all([
    settingsPromise,
    summaryPromise,
    studentsPromise,
    marksPromise,
    reportPromise,
    remedialsPromise,
    grievancesPromise,
    activityPromise,
  ]);

  dashboardSettings = settings || {};
  summary = summaryData || summary;
  students = studentsData.students || [];
  marks = marksData.marks || [];
  studentReport = isStudent ? reportData || null : null;
  remedials = remedialsData?.remedials || [];
  grievances = grievancesData?.grievances || [];
  activity = activityData?.activity || [];
  if (isFaculty) {
    const approvalData = await api("/marks-approvals").catch(() => ({ approvals: [] }));
    dashboardApprovals = approvalData.approvals || [];
    dashboardApproval = dashboardApprovals[0] || null;
  } else {
    dashboardApproval = null;
    dashboardApprovals = [];
  }

  if (isStudent && studentReport) {
    summary = {
      ...summary,
      total: studentReport.years?.reduce((acc, year) => acc + (year.semesters || []).reduce((semAcc, sem) => semAcc + (sem.subjects || []).length, 0), 0) || summary.total,
      low: studentReport.lowFinalSubjects || [],
      atRiskList: studentReport.internalRiskSubjects || [],
      remedials: studentReport.remedials || [],
    };
    marks = (studentReport.years || [])
      .flatMap((year) => year.semesters || [])
      .flatMap((semester) => semester.subjects || []);
  }

  updateDashboardStats();
  renderFacultyApprovalPanel();
  renderDashboardLists();

  if (isStudent) {
    document.getElementById("staffHighlights")?.remove();
    document.getElementById("activitySection")?.remove();
    document.getElementById("facultyApprovalSection")?.remove();
    document.getElementById("staffGrievanceSection")?.remove();
    document.getElementById("kpiRiskCard")?.remove();
    document.getElementById("kpiAnomCard")?.remove();
  }

  if (!grievanceRefreshTimer && (isStudent || isFaculty || isAdmin)) {
    grievanceRefreshTimer = window.setInterval(() => {
      refreshGrievances().catch(() => {});
    }, 30000);
  }
}

function initStudentGrievanceInteractions() {
  if (!isStudent) return;
  document.getElementById("studentGrievanceForm")?.addEventListener("submit", submitStudentGrievance);
  document.getElementById("grievanceResetBtn")?.addEventListener("click", () => {
    const form = document.getElementById("studentGrievanceForm");
    form?.reset();
    renderStudentGrievanceForm();
  });
  document.getElementById("grievanceMarkSelect")?.addEventListener("change", renderStudentGrievanceForm);
  document.getElementById("academicReportTree")?.addEventListener("click", (event) => {
    const trigger = event.target.closest("[data-grievance-mark]");
    if (!trigger) return;
    const markId = String(trigger.getAttribute("data-grievance-mark") || "");
    const select = document.getElementById("grievanceMarkSelect");
    if (select && markId) {
      select.value = markId;
      renderStudentGrievanceForm();
      document.getElementById("studentGrievanceCard")?.scrollIntoView({ behavior: "smooth", block: "start" });
      document.getElementById("grievanceJustification")?.focus();
    }
  });
}

function initStaffGrievanceInteractions() {
  if (isStudent) return;
  document.getElementById("staffGrievanceStatus")?.addEventListener("change", (event) => {
    grievanceFilters.status = String(event.target.value || "all");
    renderStaffGrievancePanel();
  });
  document.getElementById("staffGrievanceSearch")?.addEventListener("input", (event) => {
    grievanceFilters.search = String(event.target.value || "");
    renderStaffGrievancePanel();
  });
  document.getElementById("staffGrievanceRefresh")?.addEventListener("click", () => {
    refreshStaffGrievances();
  });
  document.getElementById("staffGrievanceList")?.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-grievance-status][data-grievance-id]");
    if (!btn) return;
    const id = String(btn.getAttribute("data-grievance-id") || "");
    const status = String(btn.getAttribute("data-grievance-status") || "");
    if (!id || !status) return;
    updateGrievanceStatus(id, status);
  });
}

initStudentGrievanceInteractions();
initStaffGrievanceInteractions();
document.getElementById("facultyApprovalBtn")?.addEventListener("click", submitFacultyApprovalRequest);

loadDashboardData().catch((err) => {
  console.error(err);
  toast("bad", "Dashboard", err.message || "Failed to load dashboard data.");
});
