import { api, getUser } from "./api.js";
import { requireAuth, refreshMe } from "./auth.js";
import { initShell, toast } from "./app.js";

if (!requireAuth()) throw new Error("auth");
await refreshMe().catch(() => {});
initShell({ active: "analytics" });

const user = getUser();
const role = user?.role;

if (role === "student") {
  document.querySelectorAll("[data-role-analytics]").forEach(el => {
    el.style.display = "none";
  });
}

function esc(x) {
  return String(x ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function initialOf(name) {
  return String(name || "?").trim().charAt(0).toUpperCase() || "?";
}

function buildEntityRow(mark, options = {}) {
  const name = mark.student?.name || "Unknown student";
  const subject = mark.subject || "Unknown subject";
  const badgeTone = options.badgeTone || "good";
  const badgeText = options.badgeText ?? mark.final;
  const meta = options.meta || "";

  return `<div class="entity-row">
    <div class="entity-avatar">${initialOf(name)}</div>
    <div class="entity-main">
      <div class="entity-title-row">
        <strong>${esc(name)}</strong>
      </div>
      <span class="entity-subtitle">${esc(subject)}${meta ? ` · ${meta}` : ""}</span>
    </div>
    <div class="entity-side">
      <span class="trend-chip ${badgeTone}">${badgeText}</span>
    </div>
  </div>`;
}

function buildRichSignalRow(mark, primaryTone, primaryText, secondaryText, tertiaryText = "") {
  const name = mark.student?.name || "Unknown student";
  const subject = mark.subject || "Unknown subject";

  return `<div class="entity-row entity-row-wide">
    <div class="entity-avatar">${initialOf(name)}</div>
    <div class="entity-main">
      <div class="entity-title-row">
        <strong>${esc(name)}</strong>
      </div>
      <span class="entity-subtitle">${esc(subject)}</span>
      <div class="entity-meta-row">
        ${secondaryText ? `<span class="tiny-meta">${secondaryText}</span>` : ""}
        ${tertiaryText ? `<span class="tiny-meta">${tertiaryText}</span>` : ""}
      </div>
    </div>
    <div class="entity-side">
      <span class="trend-chip ${primaryTone}">${primaryText}</span>
    </div>
  </div>`;
}

function trendLabel(mark) {
  const i1 = mark.internal1 || 0;
  const i2 = mark.internal2 || 0;
  if (i1 === 0 && i2 === 0) return { tone: "warn", text: "No baseline" };
  if (i2 < i1) return { tone: "bad", text: "Declining" };
  if (i2 > i1) return { tone: "good", text: "Improving" };
  return { tone: "warn", text: "Stable" };
}

/** X-axis label for analytics trend — uses real academic term, not ordinal T1/T2. */
function trendPointLabel(item, index) {
  const term = item?.term != null && String(item.term).trim() !== "" ? String(item.term).trim() : "";
  const sub = item?.subject != null && String(item.subject).trim() !== "" ? String(item.subject).trim() : "";
  if (term && sub) return `${term} · ${sub}`;
  if (term) return term;
  if (sub) return sub;
  return `#${index + 1}`;
}

function escAttr(x) {
  return String(x ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;");
}

function studentOptionId(s) {
  if (!s) return "";
  const raw = s._id ?? s.id;
  if (raw && typeof raw === "object" && raw.toString) return String(raw.toString());
  return String(raw ?? "");
}

/** Trend list: dedicated route, with faculty/admin fallback to /students if needed. */
async function fetchStudentsForTrend() {
  try {
    const { students = [] } = await api("/analytics/trend/students");
    if (students.length > 0 || role === "student") return students;
  } catch (_) {
    /* try fallback below for staff */
  }
  if (role === "student") return [];
  const data = await api("/students?limit=3000");
  return (data.students || []).map((s) => ({
    _id: s._id,
    name: s.name,
    rollNumber: s.rollNumber || "",
  }));
}

let studentSubjectChart = null;

function destroyStudentSubjectChart() {
  if (studentSubjectChart) {
    studentSubjectChart.destroy();
    studentSubjectChart = null;
  }
}

async function initStudentSubjectTrend(tick, grid) {
  const studentSel = document.getElementById("trendStudentSelect");
  const subjectSel = document.getElementById("trendSubjectSelect");
  const canvas = document.getElementById("studentSubjectChart");
  const hintEl = document.getElementById("trendStudentHint");
  if (!studentSel || !subjectSel || !canvas) return;

  if (role === "student") {
    studentSel.disabled = true;
    if (hintEl) hintEl.style.display = "block";
  }

  try {
    const students = await fetchStudentsForTrend();
    if (role !== "student") {
      studentSel.innerHTML =
        `<option value="">Select student</option>` +
        students.map((s) => `<option value="${escAttr(studentOptionId(s))}">${esc(s.name)}</option>`).join("");
    } else {
      studentSel.innerHTML = students
        .map((s) => `<option value="${escAttr(studentOptionId(s))}">${esc(s.name)}</option>`)
        .join("");
    }
  } catch (e) {
    toast("bad", "Analytics trend", e.message || "Failed to load students");
    if (role !== "student") {
      studentSel.innerHTML = `<option value="">Select student</option>`;
    }
    return;
  }

  async function loadSubjects() {
    const sid = studentSel.value;
    subjectSel.innerHTML = `<option value="">Select subject</option>`;
    if (!sid) return;
    try {
      const q =
        role === "student"
          ? "/analytics/trend/subjects"
          : `/analytics/trend/subjects?studentId=${encodeURIComponent(sid)}`;
      const { subjects = [] } = await api(q);
      subjectSel.innerHTML =
        `<option value="">Select subject</option>` +
        subjects.map((su) => `<option value="${escAttr(su)}">${esc(su)}</option>`).join("");
    } catch (e) {
      toast("bad", "Subjects", e.message || "Failed");
    }
  }

  async function loadSeries() {
    destroyStudentSubjectChart();
    const sid = studentSel.value;
    const subj = subjectSel.value;
    if (!sid || !subj) return;
    if (!window.Chart) return;
    try {
      const q =
        role === "student"
          ? `/analytics/trend/series?subject=${encodeURIComponent(subj)}`
          : `/analytics/trend/series?studentId=${encodeURIComponent(sid)}&subject=${encodeURIComponent(subj)}`;
      const data = await api(q);
      const pts = data.points || [];
      if (!pts.length) return;

      const labels = pts.map((p) => p.term);
      const n = pts.length;
      // One category: Chart.js squeezes everything on the left unless the axis is offset + padded.
      const lineOpts = {
        tension: n < 2 ? 0 : 0.35,
        borderWidth: n < 2 ? 2.5 : 2,
        pointRadius: n < 2 ? 7 : 4,
        pointHoverRadius: n < 2 ? 9 : 5,
        pointBorderWidth: 2,
        spanGaps: true,
      };
      studentSubjectChart = new Chart(canvas, {
        type: "line",
        data: {
          labels,
          datasets: [
            {
              label: "Final",
              data: pts.map((p) => p.final),
              borderColor: "rgba(99, 102, 241, 0.96)",
              backgroundColor: "rgba(99, 102, 241, 0.12)",
              fill: false,
              ...lineOpts,
            },
            {
              label: "Internal 1",
              data: pts.map((p) => p.internal1),
              borderColor: "rgba(34, 197, 94, 0.92)",
              backgroundColor: "rgba(34, 197, 94, 0.08)",
              fill: false,
              ...lineOpts,
            },
            {
              label: "Internal 2",
              data: pts.map((p) => p.internal2),
              borderColor: "rgba(244, 114, 182, 0.92)",
              backgroundColor: "rgba(244, 114, 182, 0.08)",
              fill: false,
              ...lineOpts,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: "index", intersect: false },
          layout: {
            padding: { left: 8, right: 16, top: 8, bottom: 4 },
          },
          plugins: {
            legend: {
              labels: { color: tick, boxWidth: 12, boxHeight: 12 },
              position: "top",
            },
            tooltip: {
              callbacks: {
                title(items) {
                  const i = items[0]?.dataIndex ?? 0;
                  const p = pts[i];
                  const t = p?.term != null && String(p.term).trim() !== "" ? String(p.term).trim() : labels[i] || "";
                  return t || "Term";
                },
              },
            },
          },
          scales: {
            x: {
              type: "category",
              offset: true,
              grid: { color: grid, offset: true },
              ticks: {
                color: tick,
                maxRotation: 45,
                minRotation: 0,
                autoSkip: false,
              },
              border: { color: grid },
            },
            y: {
              beginAtZero: true,
              max: 100,
              grace: "5%",
              ticks: { color: tick, stepSize: 10 },
              grid: { color: grid },
              border: { color: grid },
            },
          },
        },
      });
    } catch (e) {
      toast("bad", "Trend series", e.message || "Failed");
    }
  }

  studentSel.addEventListener("change", async () => {
    await loadSubjects();
    await loadSeries();
  });
  subjectSel.addEventListener("change", () => {
    loadSeries();
  });

  if (studentSel.value) await loadSubjects();
}

try {
  const summary = await api("/analytics/summary");
  const isDark = document.documentElement.getAttribute("data-theme") !== "light";
  const tick = isDark ? "rgba(226,232,240,.72)" : "rgba(15,23,42,.62)";
  const grid = isDark ? "rgba(148,163,184,.12)" : "rgba(148,163,184,.18)";

  const labels = (summary.bySubject || []).map(item => item._id);
  const bar = (summary.bySubject || []).map(item => item.avgFinal ?? 0);

  if (window.Chart) {
    new Chart(document.getElementById("barChart"), {
      type: "bar",
      data: {
        labels,
        datasets: [{
          label: "Avg final",
          data: bar,
          backgroundColor: "rgba(99, 102, 241, 0.42)",
          borderColor: "rgba(129, 140, 248, 0.96)",
          borderWidth: 1,
          borderRadius: 12,
        }],
      },
      options: {
        responsive: true,
        scales: {
          x: { ticks: { color: tick }, grid: { color: grid } },
          y: { beginAtZero: true, ticks: { color: tick }, grid: { color: grid } },
        },
        plugins: { legend: { labels: { color: tick } } },
      },
    });

    new Chart(document.getElementById("pieChart"), {
      type: "doughnut",
      data: {
        labels: ["Pass", "Fail"],
        datasets: [{
          data: [summary.passFail?.pass || 0, summary.passFail?.fail || 0],
          backgroundColor: ["rgba(34,197,94,.7)", "rgba(239,68,68,.68)"],
          borderColor: isDark ? "rgba(10,14,26,1)" : "rgba(248,250,252,1)",
          borderWidth: 4,
        }],
      },
      options: {
        cutout: "62%",
        plugins: { legend: { labels: { color: tick } } },
      },
    });

    const trend = summary.trend || [];
    new Chart(document.getElementById("lineChart"), {
      type: "line",
      data: {
        labels: trend.map((item, index) => trendPointLabel(item, index)),
        datasets: [{
          label: "Final (by term · subject)",
          data: trend.map(item => item.final),
          borderColor: "rgba(99, 102, 241, 0.96)",
          backgroundColor: "rgba(99, 102, 241, 0.16)",
          fill: true,
          tension: 0.35,
        }],
      },
      options: {
        responsive: true,
        plugins: { legend: { labels: { color: tick } } },
        scales: {
          x: {
            ticks: { color: tick, maxRotation: 50, minRotation: 0, autoSkip: true },
            grid: { color: grid },
          },
          y: { ticks: { color: tick }, grid: { color: grid } },
        },
      },
    });

  }

  await initStudentSubjectTrend(tick, grid);

  if (role !== "student") {
    const topList = document.getElementById("topList");
    const lowList = document.getElementById("lowList");
    const riskList = document.getElementById("riskList");
    const anomalyList = document.getElementById("anomalyList");

    const pm = summary.settings?.passMark ?? 40;
    if (topList) {
      topList.innerHTML = (summary.top || []).length
        ? (summary.top || []).map(mark => buildEntityRow(mark, { badgeTone: "good", badgeText: `${mark.final}` })).join("")
        : `<div class="empty">No marks at or above the pass mark (${pm}) in this view.</div>`;
    }

    if (lowList) {
      lowList.innerHTML = (summary.low || []).length
        ? (summary.low || []).map(mark => buildEntityRow(mark, { badgeTone: "bad", badgeText: `${mark.final}` })).join("")
        : '<div class="empty">No underperformers yet.</div>';
    }

    const predictiveList = document.getElementById("predictiveList");
    const insights = summary.studentRiskInsights || [];
    if (predictiveList) {
      predictiveList.innerHTML = insights.length
        ? insights.map((row) => {
            const band = row.riskBand || "watch";
            const tone = band === "high" ? "bad" : band === "elevated" ? "warn" : "";
            const facts = (row.factors || []).slice(0, 2).join(" · ");
            return buildRichSignalRow(
              { student: row.student, subject: `Avg ${row.courseAvg} · ${row.subjectsTracked} courses` },
              tone || "warn",
              `${band} · ${row.riskScore}`,
              facts,
              `Min final ${row.minFinal}`
            );
          }).join("")
        : '<div class="empty">No predictive signals. Record marks for the same students across subjects to enable breadth and trend scoring.</div>';
    }

    const riskItems = summary.atRiskList || [];
    if (riskList) {
      riskList.innerHTML = riskItems.length
        ? riskItems.map(mark => {
            const trend = trendLabel(mark);
            return buildRichSignalRow(
              mark,
              "bad",
              `Final ${mark.final}`,
              `I1 ${mark.internal1} · I2 ${mark.internal2}`,
              trend.text
            );
          }).join("")
        : '<div class="empty">No students currently at risk.</div>';
    }

    const anomalies = summary.anomalyList || [];
    if (anomalyList) {
      anomalyList.innerHTML = anomalies.length
        ? anomalies.map(mark => {
            const gap = Math.abs((mark.internal1 || 0) - (mark.internal2 || 0));
            return buildRichSignalRow(mark, "warn", "Anomaly", `Gap ${gap}`, `Final ${mark.final}`);
          }).join("")
        : '<div class="empty">No anomalies detected.</div>';
    }
  }
} catch (e) {
  toast("bad", "Analytics", e.message || "Failed to load");
}
