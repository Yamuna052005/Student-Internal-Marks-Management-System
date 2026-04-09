import { api, getUser } from "./api.js";
import { requireAuth, refreshMe } from "./auth.js";
import { initShell, toast } from "./app.js";

if (!requireAuth()) throw new Error("auth");

try {
  await refreshMe();
} catch {
  toast("bad", "Session", "Please sign in again.");
}

initShell({ active: "dashboard" });

const user = getUser();
const isStudent = user?.role === "student";
const isAdmin = user?.role === "admin";

function esc(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function initialOf(name) {
  return String(name || "?").trim().charAt(0).toUpperCase() || "?";
}

function setEl(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function setTrend(id, text, tone = "") {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text;
  el.className = `trend-chip${tone ? ` ${tone}` : ""}`;
}

const INTERNAL_RISK_TH = 16;

function academicFlowArrow() {
  return `<span class="academic-flow-arrow" aria-hidden="true"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h12"/><path d="M13 6l6 6-6 6"/></svg></span>`;
}

function renderAcademicReportTree(el, report) {
  if (!el) return;
  const years = report?.years;
  if (!years || !years.length) {
    el.innerHTML = `<div class="empty">No marks recorded yet.</div>`;
    return;
  }

  const legend = `<div class="academic-flow-legend" role="group" aria-label="Report structure">
    <span class="academic-flow-legend-step">Year</span>${academicFlowArrow()}
    <span class="academic-flow-legend-step">Semester</span>${academicFlowArrow()}
    <span class="academic-flow-legend-step">Subjects</span>${academicFlowArrow()}
    <span class="academic-flow-legend-step">Marks</span>
  </div>`;

  const body = years
    .map((y, yi) => {
      const sems = (y.semesters || [])
        .map((sem) => {
          const subjectRows = (sem.subjects || [])
            .map((m) => {
              const i1 = Number(m.internal1 ?? 0);
              const i2 = Number(m.internal2 ?? 0);
              const sum =
                m.internalTotal != null ? Number(m.internalTotal) : Math.round((i1 + i2) * 10) / 10;
              const finNum = Number(m.final);
              const fin = Number.isFinite(finNum) ? finNum : 0;
              const finalLow = fin < INTERNAL_RISK_TH;
              const internalLow =
                m.internalAtRisk === true || (sum > 0 && sum < INTERNAL_RISK_TH);
              const rowAtRisk = finalLow || internalLow;
              const riskBadge = rowAtRisk
                ? `<span class="badge bad">At Risk</span>`
                : `<span class="badge good">OK</span>`;
              const mid1 = Number(m.mid1 ?? 0);
              const as = Number(m.assignment ?? 0);
              const mid2 = Number(m.mid2 ?? 0);
              const lab = Number(m.lab ?? 0);
              return `<li class="academic-flow-subject">
            <div class="academic-flow-subject-head">
              <span class="academic-flow-eyebrow">Subject</span>
              <strong class="academic-flow-subject-name">${esc(m.subject)}</strong>
              <div class="academic-flow-subject-side">${riskBadge}<div><strong>${fin}</strong> <span class="hint">final</span></div></div>
            </div>
            <div class="academic-flow-marks-block">
              <span class="academic-flow-eyebrow">Marks</span>
              <div class="academic-flow-marks-grid">
                <div><span class="hint">Components</span><br/>Mid-1 ${mid1} · Assign ${as} · Mid-2 ${mid2} · Lab ${lab}</div>
                <div><span class="hint">Internals</span><br/>I1 ${i1} · I2 ${i2} · Sum ${sum}</div>
              </div>
            </div>
          </li>`;
            })
            .join("");

          return `<div class="academic-flow-semester">
        <div class="academic-flow-step academic-flow-step--semester">
          <span class="academic-flow-eyebrow">Semester</span>
          <div class="academic-flow-step-body">${esc(sem.semester)} <span class="hint">(${esc(sem.term)})</span></div>
        </div>
        <div class="academic-flow-nest">
          <div class="academic-flow-step academic-flow-step--subjects">
            <span class="academic-flow-eyebrow">Subjects</span>
          </div>
          <ol class="academic-flow-subject-list">${subjectRows}</ol>
        </div>
      </div>`;
        })
        .join("");

      return `<section class="academic-flow-year" aria-labelledby="academic-year-${yi}">
      <div class="academic-flow-step academic-flow-step--year" id="academic-year-${yi}">
        <span class="academic-flow-eyebrow">Year</span>
        <div class="academic-flow-step-body academic-flow-year-value">${esc(y.year)}</div>
      </div>
      <div class="academic-flow-nest academic-flow-nest--under-year">${sems}</div>
    </section>`;
    })
    .join("");

  el.innerHTML = `${legend}<div class="academic-flow-body">${body}</div>`;
}

function renderLowFinalList(el, items, threshold = INTERNAL_RISK_TH) {
  if (!el) return;
  if (!items || !items.length) {
    el.innerHTML = `<div class="empty">No subjects with final mark under ${threshold}.</div>`;
    return;
  }
  el.innerHTML = items
    .map(
      (m) => `<div class="entity-row">
    <div class="entity-main"><strong>${esc(m.subject)}</strong><span class="entity-subtitle">${esc(m.term)} · final ${esc(String(m.final))}</span></div>
    <div class="entity-side"><span class="trend-chip bad">Below ${threshold}</span></div>
  </div>`
    )
    .join("");
}

function renderInternalRiskList(el, items, threshold = INTERNAL_RISK_TH) {
  if (!el) return;
  if (!items || !items.length) {
    el.innerHTML = `<div class="empty">No subjects below the internal threshold (I1 + I2 &lt; ${threshold}).</div>`;
    return;
  }
  el.innerHTML = items
    .map(
      (m) => `<div class="entity-row">
    <div class="entity-main"><strong>${esc(m.subject)}</strong><span class="entity-subtitle">${esc(m.term)} · internals total ${esc(String(m.internalTotal))}</span></div>
    <div class="entity-side"><span class="trend-chip bad">At Risk</span></div>
  </div>`
    )
    .join("");
}

function renderStudentRemedials(el, remedials) {
  if (!el) return;
  if (!remedials || !remedials.length) {
    el.innerHTML = `<div class="empty">No remedial sessions on record.</div>`;
    return;
  }
  el.innerHTML = remedials
    .map((r) => {
      const subj = r.marks?.subject || "Subject";
      const bf = r.beforeFinal != null ? r.beforeFinal : "—";
      const af = r.afterFinal != null ? r.afterFinal : "—";
      const when = r.createdAt ? new Date(r.createdAt).toLocaleString() : "";
      return `<div class="remedial-mini"><strong>${esc(subj)}</strong> · ${esc(String(bf))} to ${esc(String(af))}<div class="activity-meta">${esc(when)}</div>${
        r.notes ? `<p style="margin-top:0.35rem;color:var(--text-muted)">${esc(r.notes)}</p>` : ""
      }</div>`;
    })
    .join("");
}

/* ── Staff: render top/bottom across all students ── */
function renderRank(el, rows, kind, passMark) {
  if (!el) return;
  if (!rows || !rows.length) {
    const emptyMsg =
      kind === "risk"
        ? "No marks flagged at risk (final &lt; 16 or I1+I2 &lt; 16)."
        : kind === "top"
          ? passMark != null && Number.isFinite(Number(passMark))
            ? `No marks at or above the pass mark (${Number(passMark)}) in this view.`
            : "No passing marks in this view."
        : "No marks detected yet.";
    el.innerHTML = `<div class="empty">${emptyMsg}</div>`;
    return;
  }
  el.innerHTML = rows.map((mark, index) => {
    const name = mark.student?.name || "Unknown";
    const subject = mark.subject || "—";
    const final = typeof mark.final === "number" ? mark.final : 0;
    const tone = kind === "top" ? "good" : "bad";
    const label =
      kind === "top" ? "Passing" : kind === "risk" ? "At risk" : "Lowest final";
    return `<div class="entity-row">
      <div class="entity-avatar">${initialOf(name)}</div>
      <div class="entity-main">
        <div class="entity-title-row">
          <strong>${esc(name)}</strong>
          <span class="mini-rank">#${index + 1}</span>
        </div>
        <span class="entity-subtitle">${esc(subject)}</span>
      </div>
      <div class="entity-side">
        <span class="trend-chip ${tone}">${label}</span>
        <span class="metric-value ${tone}">${final}</span>
      </div>
    </div>`;
  }).join("");
}

function renderPredictive(el, insights, highCount) {
  if (!el) return;
  if (!insights || !insights.length) {
    el.innerHTML = `<div class="empty">No elevated multi-subject risk signals yet.</div>`;
    return;
  }
  const sub = highCount > 0 ? `${highCount} high band · ` : "";
  el.innerHTML =
    `<p class="hint" style="margin-bottom:1rem">${sub}${insights.length} student(s) on watchlist.</p>` +
    insights.slice(0, 6).map((row) => {
      const name = row.student?.name || "Student";
      const band = row.riskBand || "watch";
      const tone = band === "high" ? "bad" : band === "elevated" ? "warn" : "";
      const score = row.riskScore ?? "—";
      const avg = row.courseAvg != null ? row.courseAvg : "—";
      const facts = (row.factors || []).slice(0, 2).join(" ");
      return `<div class="entity-row entity-row-wide">
        <div class="entity-avatar">${initialOf(name)}</div>
        <div class="entity-main">
          <div class="entity-title-row"><strong>${esc(name)}</strong></div>
          <span class="entity-subtitle">${esc(facts || "Review recommended.")}</span>
        </div>
        <div class="entity-side">
          <span class="trend-chip ${tone}">Score ${score}</span>
          <span class="metric-value ${tone}">Avg ${avg}</span>
        </div>
      </div>`;
    }).join("");
}

function renderActivity(el, items) {
  if (!el) return;
  if (!items || !items.length) {
    el.innerHTML = `<div class="empty">No recent activity.</div>`;
    return;
  }
  el.innerHTML = items.map(a => {
    const action = a.action || "System Event";
    const details = a.details || "";
    const time = a.createdAt ? new Date(a.createdAt).toLocaleString() : "";
    return `<div class="feed-row">
      <div class="feed-dot"></div>
      <div class="feed-main">
        <strong>${esc(action)}</strong>
        <p>${esc(details)}</p>
        <div class="activity-meta">${time}</div>
      </div>
    </div>`;
  }).join("");
}

async function boot() {
  try {
    const me = getUser();
    const studentRef = me?.studentRef || me?.studentId;
    const requests = [
      api("/analytics/summary").catch(() => ({})),
      isAdmin ? api("/activity?limit=20").catch(() => ({ activity: [] })) : Promise.resolve({ activity: [] }),
      isStudent ? Promise.resolve({ total: 0 }) : api("/students?limit=1").catch(() => ({ total: 0 })),
      isStudent && studentRef
        ? api(`/students/${studentRef}/academic-report`).catch(() => null)
        : Promise.resolve(null),
    ];
    const [summary, activityData, studentsData, academicReport] = await Promise.all(requests);

    const studentName = me?.name || "Student";
    const recordsCount = Number(summary?.total ?? 0);
    const riskCount    = Number(summary?.riskCount ?? 0);
    const anomalyCount = Number(summary?.anomalyCount ?? 0);
    const avgScore     = Number(summary?.avgScore ?? 0);
    const studentCount = Number(studentsData?.total ?? 0);

    /* ── Greeting ── */
    setEl("heroGreeting", isStudent ? `Welcome back, ${studentName}` : "System Pulse Dashboard");

    const markTh = academicReport?.markAlertThreshold ?? INTERNAL_RISK_TH;
    const lowFinalN = academicReport?.lowFinalSubjects?.length ?? 0;

    if (isStudent) {
      /* ── KPI: student view ── */
      setEl("kpiStudentsLabel", "Your Average");
      setEl("kpiRecordsLabel", "Subjects Recorded");
      setEl("kpiRiskLabel", "Academic Status");
      setEl("kpiAnomLabel", "Flagged Issues");

      setEl("kpiStudents", avgScore ? avgScore.toFixed(1) : "—");
      setEl("kpiRecords", String(recordsCount));
      const internalRiskN = academicReport?.internalRiskSubjects?.length ?? 0;
      setEl("kpiRisk", riskCount > 0 || internalRiskN > 0 || lowFinalN > 0 ? "At Risk" : "On Track");
      setEl("kpiAnom", String(anomalyCount));

      const avgTone = avgScore >= 75 ? "good" : avgScore >= 40 ? "warn" : avgScore > 0 ? "bad" : "";
      setTrend("kpiStudentsTrend",
        avgScore > 0 ? (avgScore >= 75 ? "Strong performance" : avgScore >= 40 ? "Passing average" : "Below threshold") : "No marks yet",
        avgTone);
      setTrend("kpiRecordsTrend",
        recordsCount > 0 ? `${recordsCount} subject${recordsCount !== 1 ? "s" : ""} on file` : "No records yet",
        recordsCount > 0 ? "good" : "");
      {
        const rp = [];
        if (lowFinalN) rp.push(`${lowFinalN} final <${markTh}`);
        if (internalRiskN) rp.push(`${internalRiskN} low internals (<${markTh})`);
        if (riskCount) rp.push(`${riskCount} at-risk mark(s) (final or I1+I2 < ${INTERNAL_RISK_TH})`);
        setTrend("kpiRiskTrend", rp.length ? rp.join(" · ") : "All subjects healthy", rp.length ? "bad" : "good");
      }
      setTrend("kpiAnomTrend",
        anomalyCount > 0 ? `${anomalyCount} anomal${anomalyCount !== 1 ? "ies" : "y"} flagged` : "No anomalies",
        anomalyCount > 0 ? "warn" : "good");
      setTrend(
        "heroStatus",
        riskCount > 0 || internalRiskN > 0 || lowFinalN > 0 ? "Needs attention" : "Looking good",
        riskCount > 0 || internalRiskN > 0 || lowFinalN > 0 ? "warn" : "good"
      );

      // Swap first KPI icon for student (graduation cap)
      const kpiIconWrap = document.querySelector("#kpiStudentsCard .kpi-icon");
      if (kpiIconWrap) {
        kpiIconWrap.innerHTML =
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/></svg>';
      }

      renderAcademicReportTree(document.getElementById("academicReportTree"), academicReport);
      renderLowFinalList(document.getElementById("studentLowFinalList"), academicReport?.lowFinalSubjects, markTh);
      renderInternalRiskList(document.getElementById("studentInternalRiskList"), academicReport?.internalRiskSubjects, markTh);
      renderStudentRemedials(document.getElementById("studentRemedialList"), academicReport?.remedials);

      // Hide staff-only sections
      document.getElementById("staffHighlights")?.remove();
      document.getElementById("predictiveSection")?.remove();
      document.getElementById("activitySection")?.remove();

    } else {
      /* ── KPI: staff view ── */
      setEl("kpiStudentsLabel", "Students");
      setEl("kpiRecordsLabel", "Records");
      setEl("kpiRiskLabel", "At Risk");
      setEl("kpiAnomLabel", "Anomalies");

      setEl("kpiStudents", String(studentCount));
      setEl("kpiRecords", String(recordsCount));
      setEl("kpiRisk", String(riskCount));
      setEl("kpiAnom", String(anomalyCount));

      setTrend("kpiStudentsTrend", studentCount > 0 ? `${studentCount} active profiles` : "No students yet", studentCount > 0 ? "good" : "");
      setTrend("kpiRecordsTrend", recordsCount > 0 ? `${recordsCount} synced records` : "No records yet", recordsCount > 0 ? "good" : "");

      const ph = Number(summary?.predictedHighRiskCount ?? 0);
      setTrend("kpiRiskTrend",
        ph > 0 ? `${ph} predictive high-risk` : riskCount > 0 ? `${riskCount} need intervention` : "No immediate concern",
        riskCount > 0 || ph > 0 ? "bad" : "good");
      setTrend("kpiAnomTrend",
        anomalyCount > 0 ? `${anomalyCount} flagged` : "No outliers detected",
        anomalyCount > 0 ? "warn" : "good");
      setTrend("heroStatus",
        riskCount + anomalyCount > 0 ? "Action needed" : "Healthy",
        riskCount + anomalyCount > 0 ? "warn" : "good");

      renderRank(document.getElementById("topList"), summary.top || [], "top", summary.settings?.passMark);
      renderRank(document.getElementById("lowList"), summary.atRiskList || [], "risk");
      renderPredictive(document.getElementById("predictiveList"), summary.studentRiskInsights || [], ph);
      if (isAdmin) {
        renderActivity(document.getElementById("actList"), activityData.activity || []);
      } else {
        document.getElementById("activitySection")?.remove();
      }

      // Hide student-only section
      document.getElementById("studentSection")?.remove();
    }

  } catch (e) {
    console.error("Dashboard boot error:", e);
    toast("bad", "Dashboard", e.message || "Failed to load dashboard data.");
  }
}

boot();
