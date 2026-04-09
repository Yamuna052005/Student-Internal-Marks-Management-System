import { api } from "./api.js";
import { requireAuth, refreshMe, requireRoles } from "./auth.js";
import { initShell, toast } from "./app.js";

if (!requireAuth()) throw new Error("auth");
if (!requireRoles("admin", "faculty")) throw new Error("role");
await refreshMe().catch(() => {});
initShell({ active: "remedials" });

function esc(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/** API uses populated `marks`; mock layer used `mark`. */
function remedialMark(remedial) {
  return remedial.marks || remedial.mark;
}

function remedialStudentName(remedial) {
  const m = remedialMark(remedial);
  return remedial.student?.name || m?.student?.name || "Unknown student";
}

function remedialSubject(remedial) {
  const m = remedialMark(remedial);
  return m?.subject || "—";
}

function gainOf(remedial) {
  const before = remedial?.beforeFinal;
  const after = remedial?.afterFinal;
  return typeof before === "number" && typeof after === "number"
    ? after - before
    : null;
}

function trendTone(value) {
  if (value > 0) return "good";
  if (value < 0) return "bad";
  return "warn";
}

function setTrend(id, text, tone = "") {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text;
  el.className = `remedials-kpi-trend${tone ? ` ${tone}` : ""}`;
}

function formatSigned(value) {
  if (typeof value !== "number" || Number.isNaN(value)) return "-";
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}`;
}

function formatMetric(value) {
  if (typeof value !== "number" || Number.isNaN(value)) return "-";
  return value.toFixed(1);
}

function formatDate(value) {
  if (!value) return "-";
  return new Date(value).toLocaleDateString();
}

function buildRankRow(remedial, index, tone, summary) {
  const studentName = remedialStudentName(remedial);
  const subject = remedialSubject(remedial);
  const gain = gainOf(remedial);
  const metricClass = gain == null ? "" : gain > 0 ? "good" : gain < 0 ? "bad" : "";
  const metricText = gain == null ? "Pending" : `${gain > 0 ? "+" : ""}${gain.toFixed(1)}`;

  return `<div class="remedials-rank-row">
    <div class="remedials-rank-index">${index + 1}</div>
    <div class="remedials-rank-main">
      <strong>${esc(studentName)}</strong>
      <span>${esc(subject)}</span>
    </div>
    <div class="remedials-rank-metric">
      <span class="status-pill ${tone}">${summary}</span>
      <span class="remedials-rank-value ${metricClass}">${metricText}</span>
      <span class="remedials-rank-note">${formatDate(remedial.createdAt)}</span>
    </div>
  </div>`;
}

function renderKPIs(remedials) {
  const total = remedials.length;
  const gains = remedials.map(gainOf).filter(gain => typeof gain === "number");
  const improved = gains.filter(gain => gain > 0).length;
  const totalGain = gains.reduce((sum, gain) => sum + gain, 0);
  const avgGain = gains.length ? totalGain / gains.length : null;
  const coverage = new Set(
    remedials
      .map(remedial => remedial.student?._id || remedialStudentName(remedial))
      .filter(Boolean)
  ).size;

  document.getElementById("kpiTotal").textContent = String(total);
  document.getElementById("kpiImproved").textContent = total > 0 ? String(improved) : "0";
  document.getElementById("kpiAvgGain").textContent = avgGain != null ? formatMetric(avgGain) : "-";
  document.getElementById("heroCoverage").textContent = total > 0 ? String(coverage) : "0";
  document.getElementById("heroMomentum").textContent = avgGain != null ? `${formatSigned(avgGain)} marks` : "No signal";
  const tableMeta = document.getElementById("tableMeta");
  if (tableMeta) {
    tableMeta.textContent = total > 0
      ? `${total} sessions sorted by latest intervention date`
      : "Latest intervention log";
  }

  setTrend(
    "kpiTotalTrend",
    total > 0 ? `${coverage} students covered` : "No sessions logged yet",
    total > 0 ? "good" : "warn"
  );

  const improvementRate = total > 0 ? Math.round((improved / total) * 100) : 0;
  setTrend(
    "kpiImprovedTrend",
    total > 0 ? `${improvementRate}% improvement rate` : "Waiting for before / after data",
    total > 0 ? (improved > 0 ? "good" : "warn") : "warn"
  );

  setTrend(
    "kpiAvgGainTrend",
    avgGain != null ? `${formatSigned(avgGain)} marks vs baseline` : "No gain trend available",
    avgGain != null ? trendTone(avgGain) : "warn"
  );
}

function renderHighlights(remedials) {
  const topList = document.getElementById("topGainsList");
  const attentionList = document.getElementById("attentionList");
  const ranked = remedials
    .map(remedial => ({ remedial, gain: gainOf(remedial) }))
    .filter(item => item.gain != null);

  const topPerformers = ranked
    .filter(item => item.gain > 0)
    .sort((a, b) => b.gain - a.gain)
    .slice(0, 4);

  const attention = ranked
    .filter(item => item.gain <= 0)
    .sort((a, b) => a.gain - b.gain)
    .slice(0, 4);

  topList.innerHTML = topPerformers.length
    ? topPerformers
        .map((item, index) => buildRankRow(item.remedial, index, "good", "Improved"))
        .join("")
    : '<div class="remedials-list-empty">Positive gains will appear here once after-session marks improve.</div>';

  attentionList.innerHTML = attention.length
    ? attention
        .map((item, index) => buildRankRow(item.remedial, index, item.gain < 0 ? "bad" : "warn", item.gain < 0 ? "Declined" : "Flat"))
        .join("")
    : '<div class="remedials-list-empty">No stalled interventions right now. Students are trending in the right direction.</div>';
}

function renderTable(remedials) {
  const tbody = document.getElementById("tbody");
  const empty = document.getElementById("emptyState");

  if (!remedials.length) {
    tbody.innerHTML = "";
    empty.style.display = "";
    return;
  }

  empty.style.display = "none";

  const sorted = [...remedials].sort((a, b) =>
    new Date(b.createdAt || 0) - new Date(a.createdAt || 0)
  );

  tbody.innerHTML = sorted.map(remedial => {
    const mark = remedialMark(remedial);
    const studentName = remedial.student?.name || mark?.student?.name || "-";
    const subject = remedialSubject(remedial);
    const before = remedial.beforeFinal != null ? remedial.beforeFinal : (mark?.final ?? "-");
    const after = remedial.afterFinal != null ? remedial.afterFinal : "-";
    const gain = gainOf(remedial);

    let change = "-";
    let changeClass = "warn";
    let statusText = "Needs review";
    let statusClass = "warn";
    let rowClass = "remedial-row-flat";

    if (gain != null) {
      change = `${gain > 0 ? "+" : ""}${gain.toFixed(1)}`;
      if (gain > 0) {
        changeClass = "good";
        statusText = "Improved";
        statusClass = "good";
        rowClass = "remedial-row-good";
      } else if (gain < 0) {
        changeClass = "bad";
        statusText = "Declined";
        statusClass = "bad";
        rowClass = "remedial-row-bad";
      }
    }

    return `<tr class="${rowClass}">
      <td class="student-cell"><strong>${esc(studentName)}</strong><span>Remedial session</span></td>
      <td>${esc(subject)}</td>
      <td class="score-cell"><strong>${before}</strong><span>Final before</span></td>
      <td class="score-cell"><strong>${after}</strong><span>Latest after</span></td>
      <td><span class="badge ${changeClass}">${change}</span></td>
      <td><span class="status-pill ${statusClass}">${statusText}</span></td>
      <td class="notes-cell">${esc(remedial.notes || "No notes added")}</td>
      <td class="date-cell"><strong>${formatDate(remedial.createdAt)}</strong><span>Recorded</span></td>
    </tr>`;
  }).join("");
}

async function boot() {
  try {
    const remData = await api("/remedials");
    const remedials = remData.remedials || [];

    renderKPIs(remedials);
    renderHighlights(remedials);
    renderTable(remedials);
  } catch (e) {
    toast("bad", "Error", e.message || "Failed to load remedials");
  }
}

boot();

// Refetch when returning from Marks (another tab) or when the page is restored from bfcache.
window.addEventListener("pageshow", (e) => {
  if (e.persisted) boot();
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") boot();
});
