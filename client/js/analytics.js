import { api, getUser } from "./api.js";
import { requireAuth, refreshMe, requireRoles } from "./auth.js";
import { initShell, toast, qs } from "./app.js";

if (!requireAuth()) throw new Error("auth");
if (!requireRoles("admin", "faculty")) throw new Error("role");

await refreshMe().catch(() => {});
initShell({ active: "analytics" });

const user = getUser();
const ChartCtor = window.Chart;

let summary = null;
let trendStudents = [];
let trendSubjects = [];
let trendSeries = [];
let trendStudentId = "";
let trendSubject = "";
let activity = [];

const charts = {
  bar: null,
  pie: null,
  line: null,
  trend: null,
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

function renderList(el, rows, emptyMessage, renderRow) {
  if (!el) return;
  if (!rows || !rows.length) {
    el.innerHTML = `<div class="empty">${esc(emptyMessage)}</div>`;
    return;
  }
  el.innerHTML = rows.map(renderRow).join("");
}

function destroyChart(key) {
  if (charts[key]) {
    charts[key].destroy();
    charts[key] = null;
  }
}

function safeChart(canvasId, config, key) {
  const canvas = document.getElementById(canvasId);
  if (!canvas || !ChartCtor) return;
  destroyChart(key);
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  charts[key] = new ChartCtor(ctx, config);
}

function renderBarChart() {
  const rows = [...(summary?.bySubject || [])].sort((a, b) => Number(b.avgFinal || 0) - Number(a.avgFinal || 0));
  const values = rows.map((row) => Number(row.avgFinal || 0));
  const passMark = Number(summary?.settings?.passMark ?? 16);
  const axisMax = Math.max(20, Math.ceil(Math.max(passMark, ...values, 0) / 5) * 5);
  safeChart(
    "barChart",
    {
      type: "bar",
      data: {
        labels: rows.map((row) => row._id),
        datasets: [{
          label: "Average final",
          data: values,
          backgroundColor: values.map((value) => value >= passMark ? "rgba(34, 197, 94, 0.82)" : "rgba(99, 102, 241, 0.82)"),
          borderColor: values.map((value) => value >= passMark ? "rgba(34, 197, 94, 1)" : "rgba(129, 140, 248, 1)"),
          borderWidth: 1,
          borderRadius: 12,
          borderSkipped: false,
          barThickness: 18,
          maxBarThickness: 22,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        indexAxis: "y",
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => ` Average final: ${Number(ctx.raw || 0).toFixed(1)}`,
            },
          },
        },
        layout: {
          padding: { left: 12, right: 16, top: 4, bottom: 4 },
        },
        scales: {
          x: {
            beginAtZero: true,
            suggestedMax: axisMax,
            grid: { color: "rgba(148, 163, 184, 0.16)" },
            ticks: { color: "#94a3b8" },
          },
          y: {
            grid: { display: false },
            ticks: {
              color: "#cbd5e1",
              autoSkip: false,
              font: { size: 11 },
            },
          },
        },
      },
    },
    "bar"
  );
}

function renderPieChart() {
  safeChart(
    "pieChart",
    {
      type: "doughnut",
      data: {
        labels: ["Pass", "Fail"],
        datasets: [{
          data: [Number(summary?.passFail?.pass || 0), Number(summary?.passFail?.fail || 0)],
          backgroundColor: ["rgba(34, 197, 94, 0.8)", "rgba(239, 68, 68, 0.8)"],
          borderColor: ["rgba(34, 197, 94, 1)", "rgba(239, 68, 68, 1)"],
          borderWidth: 1,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: "68%",
        plugins: { legend: { position: "bottom" } },
      },
    },
    "pie"
  );
}

function renderLineChart() {
  const rows = summary?.trend || [];
  safeChart(
    "lineChart",
    {
      type: "line",
      data: {
        labels: rows.map((row) => row.term || row.subject || ""),
        datasets: [{
          label: "Final marks",
          data: rows.map((row) => Number(row.final || 0)),
          borderColor: "rgba(99, 102, 241, 1)",
          backgroundColor: "rgba(99, 102, 241, 0.12)",
          tension: 0.35,
          fill: true,
          pointRadius: 4,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          y: { beginAtZero: true, suggestedMax: 25 },
          x: { ticks: { color: "#94a3b8" } },
        },
      },
    },
    "line"
  );
}

function renderTrendChart() {
  const rows = trendSeries || [];
  safeChart(
    "studentSubjectChart",
    {
      type: "line",
      data: {
        labels: rows.map((row) => row.term),
        datasets: [
          {
            label: "Internal 1",
            data: rows.map((row) => Number(row.internal1 || 0)),
            borderColor: "rgba(59, 130, 246, 1)",
            backgroundColor: "rgba(59, 130, 246, 0.12)",
            tension: 0.35,
            fill: false,
            pointRadius: 4,
          },
          {
            label: "Internal 2",
            data: rows.map((row) => Number(row.internal2 || 0)),
            borderColor: "rgba(168, 85, 247, 1)",
            backgroundColor: "rgba(168, 85, 247, 0.12)",
            tension: 0.35,
            fill: false,
            pointRadius: 4,
          },
          {
            label: "Final",
            data: rows.map((row) => Number(row.final || 0)),
            borderColor: "rgba(34, 197, 94, 1)",
            backgroundColor: "rgba(34, 197, 94, 0.12)",
            tension: 0.35,
            fill: true,
            pointRadius: 4,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: true,
            position: "bottom",
            labels: { color: "#cbd5e1", usePointStyle: true, pointStyle: "line" },
          },
          tooltip: {
            callbacks: {
              title: (items) => {
                const item = items?.[0];
                return item?.label || "Term";
              },
              label: (ctx) => `${ctx.dataset.label}: ${Number(ctx.raw || 0).toFixed(1)}`,
            },
          },
        },
        scales: {
          y: {
            beginAtZero: true,
            suggestedMax: 25,
            grid: { color: "rgba(148, 163, 184, 0.16)" },
            ticks: { color: "#94a3b8" },
          },
          x: { ticks: { color: "#94a3b8" } },
        },
      },
    },
    "trend"
  );
}

function renderKpis() {
  const total = Number(summary?.total || 0);
  const pass = Number(summary?.passFail?.pass || 0);
  const fail = Number(summary?.passFail?.fail || 0);
  const passRate = total > 0 ? Math.round((pass / total) * 100) : 0;
  const risk = Number(summary?.riskCount || 0);
  const anomaly = Number(summary?.anomalyCount || 0);
  const average = Number(summary?.avgScore || 0);

  const scope = qs("#analyticsScope");
  if (scope) {
    scope.textContent = user?.role === "faculty" ? "Faculty View" : "Admin View";
  }

  const note = qs("#analyticsNote");
  if (note) {
    note.textContent = `All terms loaded • ${total} synced records • average final ${average.toFixed(1)}`;
  }

  const totalEl = qs("#analyticsTotal");
  const totalMeta = qs("#analyticsTotalMeta");
  const passEl = qs("#analyticsPass");
  const passMeta = qs("#analyticsPassMeta");
  const riskEl = qs("#analyticsRisk");
  const riskMeta = qs("#analyticsRiskMeta");
  const anomalyEl = qs("#analyticsAnomaly");
  const anomalyMeta = qs("#analyticsAnomalyMeta");

  if (totalEl) totalEl.textContent = String(total);
  if (totalMeta) totalMeta.textContent = `${summary?.bySubject?.length || 0} subjects tracked`;
  if (passEl) passEl.textContent = `${passRate}%`;
  if (passMeta) passMeta.textContent = `${pass} pass / ${fail} fail`;
  if (riskEl) riskEl.textContent = String(risk);
  if (riskMeta) riskMeta.textContent = `${summary?.settings?.riskThreshold ?? 16} threshold`;
  if (anomalyEl) anomalyEl.textContent = String(anomaly);
  if (anomalyMeta) anomalyMeta.textContent = `${summary?.predictedHighRiskCount || 0} predictive high-risk`;
}

function renderSummaryPanels() {
  const topRows = summary?.top || [];
  const lowRows = summary?.low || [];
  const riskRows = summary?.atRiskList || [];
  const anomalyRows = summary?.anomalyList || [];
  const predictiveRows = summary?.studentRiskInsights || [];

  renderList(
    qs("#topList"),
    topRows,
    "No passing marks in this view.",
    (mark, index) => {
      const name = mark.student?.name || "Unknown";
      return `<div class="entity-row">
        <div class="entity-avatar">${initialOf(name)}</div>
        <div class="entity-main">
          <div class="entity-title-row">
            <strong>${esc(name)}</strong>
            <span class="mini-rank">#${index + 1}</span>
          </div>
          <span class="entity-subtitle">${esc(mark.subject || "-")}</span>
        </div>
        <div class="entity-side">
          <span class="trend-chip good">Passing</span>
          <span class="metric-value good">${Number(mark.final || 0)}</span>
        </div>
      </div>`;
    }
  );

  renderList(
    qs("#lowList"),
    lowRows,
    "No low-score records detected.",
    (mark) => {
      const name = mark.student?.name || "Unknown";
      return `<div class="entity-row">
        <div class="entity-avatar">${initialOf(name)}</div>
        <div class="entity-main">
          <strong>${esc(name)}</strong>
          <span class="entity-subtitle">${esc(mark.subject || "-")} - final ${esc(String(mark.final || 0))}</span>
        </div>
        <div class="entity-side">
          <span class="trend-chip bad">At risk</span>
        </div>
      </div>`;
    }
  );

  renderList(
    qs("#predictiveList"),
    predictiveRows,
    "No elevated multi-subject risk signals yet.",
    (row) => {
      const name = row.student?.name || "Student";
      const tone = row.riskBand === "high" ? "bad" : row.riskBand === "elevated" ? "warn" : "";
      return `<div class="entity-row entity-row-wide">
        <div class="entity-avatar">${initialOf(name)}</div>
        <div class="entity-main">
          <div class="entity-title-row"><strong>${esc(name)}</strong></div>
          <span class="entity-subtitle">${esc((row.factors || []).slice(0, 2).join(" ") || "Review recommended.")}</span>
        </div>
        <div class="entity-side">
          <span class="trend-chip ${tone}">Score ${esc(String(row.riskScore ?? "—"))}</span>
          <span class="metric-value ${tone}">Avg ${esc(String(row.courseAvg ?? "—"))}</span>
        </div>
      </div>`;
    }
  );

  renderList(
    qs("#riskList"),
    riskRows,
    "No at-risk students.",
    (mark) => {
      const name = mark.student?.name || "Unknown";
      return `<div class="entity-row">
        <div class="entity-avatar">${initialOf(name)}</div>
        <div class="entity-main">
          <strong>${esc(name)}</strong>
          <span class="entity-subtitle">${esc(mark.subject || "-")} - final ${esc(String(mark.final || 0))}</span>
        </div>
        <div class="entity-side">
          <span class="trend-chip bad">Risk</span>
        </div>
      </div>`;
    }
  );

  renderList(
    qs("#anomalyList"),
    anomalyRows,
    "No anomalies detected.",
    (mark) => {
      const name = mark.student?.name || "Unknown";
      return `<div class="entity-row">
        <div class="entity-avatar">${initialOf(name)}</div>
        <div class="entity-main">
          <strong>${esc(name)}</strong>
          <span class="entity-subtitle">${esc(mark.subject || "-")} - anomaly detected</span>
        </div>
        <div class="entity-side">
          <span class="trend-chip warn">Anomaly</span>
        </div>
      </div>`;
    }
  );
}

function renderTrendPickers() {
  const studentSel = qs("#trendStudentSelect");
  const subjectSel = qs("#trendSubjectSelect");
  if (studentSel) {
    studentSel.innerHTML = trendStudents
      .map((s) => {
        return `<option value="${esc(String(s._id))}">${esc(s.name)}${s.rollNumber ? ` - ${esc(s.rollNumber)}` : ""}</option>`;
      })
      .join("");
    if (trendStudentId) studentSel.value = trendStudentId;
  }
  if (subjectSel) {
    subjectSel.innerHTML = trendSubjects
      .map((s) => `<option value="${esc(s)}">${esc(s)}</option>`)
      .join("");
    if (trendSubject) subjectSel.value = trendSubject;
  }
}

async function loadTrendData() {
  trendStudents = await api("/analytics/trend/students").then((r) => r.students || []).catch(() => []);
  if (!trendStudentId) {
    trendStudentId = trendStudents[0]?._id ? String(trendStudents[0]._id) : "";
  }
  if (trendStudentId) {
    trendSubjects = await api(`/analytics/trend/subjects?studentId=${encodeURIComponent(trendStudentId)}`).then((r) => r.subjects || []).catch(() => []);
    if (!trendSubject) {
      trendSubject = trendSubjects[0] || "";
    }
  } else {
    trendSubjects = [];
  }
  if (trendStudentId && trendSubject) {
    trendSeries = await api(`/analytics/trend/series?studentId=${encodeURIComponent(trendStudentId)}&subject=${encodeURIComponent(trendSubject)}`).then((r) => r.points || []).catch(() => []);
  } else {
    trendSeries = [];
  }
  renderTrendPickers();
  renderTrendChart();
}

function wireTrendPickers() {
  qs("#trendStudentSelect")?.addEventListener("change", async (e) => {
    trendStudentId = e.target.value;
    trendSubjects = await api(`/analytics/trend/subjects?studentId=${encodeURIComponent(trendStudentId)}`).then((r) => r.subjects || []).catch(() => []);
    trendSubject = trendSubjects[0] || "";
    await loadTrendSeries();
  });

  qs("#trendSubjectSelect")?.addEventListener("change", async (e) => {
    trendSubject = e.target.value;
    await loadTrendSeries();
  });
}

async function loadTrendSeries() {
  if (!trendStudentId || !trendSubject) {
    trendSeries = [];
    renderTrendChart();
    return;
  }
  trendSeries = await api(`/analytics/trend/series?studentId=${encodeURIComponent(trendStudentId)}&subject=${encodeURIComponent(trendSubject)}`).then((r) => r.points || []).catch(() => []);
  renderTrendPickers();
  renderTrendChart();
}

async function loadAnalytics() {
  try {
    const [sum, act] = await Promise.all([
      api("/analytics/summary?term=all"),
      api("/activity").catch(() => ({ activity: [] })),
    ]);
    summary = sum || {};
    summary.trend = summary.trend || [];
    summary.top = summary.top || [];
    summary.low = summary.low || [];
    summary.bySubject = summary.bySubject || [];
    summary.passFail = summary.passFail || { pass: 0, fail: 0 };
    summary.atRiskList = summary.atRiskList || [];
    summary.anomalyList = summary.anomalyList || [];
    summary.studentRiskInsights = summary.studentRiskInsights || [];
    activity = act.activity || [];
    renderKpis();
    renderBarChart();
    renderPieChart();
    renderLineChart();
    renderSummaryPanels();
    renderList(qs("#actList"), activity, "No recent activity.", (row) => `<div class="feed-row">
      <div class="feed-dot"></div>
      <div class="feed-main">
        <strong>${esc(row.action || "System Event")}</strong>
        <p>${esc(row.details || "")}</p>
        <div class="activity-meta">${esc(row.createdAt ? new Date(row.createdAt).toLocaleString() : "")}</div>
      </div>
    </div>`);
    await loadTrendData();
    wireTrendPickers();
  } catch (err) {
    console.error(err);
    toast("bad", "Analytics", err.message || "Failed to load analytics.");
    renderList(qs("#topList"), [], "No data available.", () => "");
    renderList(qs("#lowList"), [], "No data available.", () => "");
    renderList(qs("#predictiveList"), [], "No data available.", () => "");
    renderList(qs("#riskList"), [], "No data available.", () => "");
    renderList(qs("#anomalyList"), [], "No data available.", () => "");
  }
}

loadAnalytics();
