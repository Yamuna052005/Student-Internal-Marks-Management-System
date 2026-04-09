import { api, getUser, uploadCsv, apiCsv } from "./api.js";
import { requireAuth, refreshMe } from "./auth.js";
import { initShell, toast, qs, qsa } from "./app.js";

if (!requireAuth()) throw new Error("auth");
await refreshMe().catch(() => {});
initShell({ active: "marks" });

const user = getUser();
const role = user?.role;
let settings = {};
let students = [];
let state = { page: 1, limit: 15, search: "", onlyRisk: false, onlyAnomaly: false, term: "" };
let remTargetId = null;
let termFilterLocked = false;
const INTERNAL_SUM_RISK = 16;

function isPastDeadline() {
  if (!settings.marksDeadline) return false;
  return Date.now() > new Date(settings.marksDeadline).getTime();
}

function canEditMarks() {
  if (role === "admin") return true;
  if (role === "faculty") return !isPastDeadline();
  return false;
}

function displayTerm(m) {
  const raw = m?.term;
  if (raw != null && String(raw).trim() !== "") return String(raw).trim();
  return settings?.defaultTerm || "2025-T1";
}

function esc(s) {
  return String(s ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function initialOf(name) {
  return String(name || "?").trim().charAt(0).toUpperCase() || "?";
}

/* ───── Boot ───── */

async function boot() {
  try {
    settings = await api("/settings");
    if (role === "faculty" && isPastDeadline()) {
      const lb = qs("#lockBanner");
      if (lb) { lb.hidden = false; lb.textContent = "Deadline passed — faculty locked"; }
      qs("#marksCard")?.classList.add("locked");
    }
    if (role === "student") qs("#marksCard")?.classList.remove("locked");

    if (role === "admin" || role === "faculty") {
      const st = await api("/students?limit=500");
      students = st.students || [];
      fillStudentSelect();
    }
    state.term = String(settings.defaultTerm || "2025-T1").trim() || "2025-T1";
    await refreshTermFilter();
  } catch (e) {
    toast("bad", "Error", e.message);
    // Ensure state.term always has a valid fallback even if settings failed
    if (!state.term) state.term = "2025-T1";
  }
  wire();
  await load();
}

/* ───── Term filter ───── */

async function refreshTermFilter() {
  const sel = qs("#termFilter");
  if (!sel) return;
  const def = String(settings.defaultTerm || "2025-T1").trim() || "2025-T1";
  termFilterLocked = true;
  try {
    const data = await api("/marks/meta/terms").catch(() => null);
    const raw = data ? (data.terms || []).map((t) => String(t).trim()).filter(Boolean) : [];
    const remoteDef = data ? (String(data.defaultTerm || def).trim() || def) : def;

    // Always include: remote terms + default + current state.term (so new terms appear immediately)
    const termSet = new Set(raw);
    termSet.add(remoteDef);
    if (state.term && state.term !== "all") termSet.add(String(state.term).trim());

    const terms = [...termSet]
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base", numeric: true }));

    sel.innerHTML =
      `<option value="all">All terms</option>` +
      terms.map((t) => `<option value="${esc(t)}">${esc(t)}</option>`).join("");

    if (state.term === "all") {
      sel.value = "all";
    } else {
      // Find exact match (case-insensitive trim)
      const cur = String(state.term || "").trim().toLowerCase();
      const match = terms.find((t) => t.trim().toLowerCase() === cur);
      if (match) {
        state.term = match; // normalize to whatever casing is stored
        sel.value = match;
      } else {
        state.term = remoteDef;
        sel.value = remoteDef;
      }
    }
  } finally {
    termFilterLocked = false;
  }
}

function fillStudentSelect() {
  const sel = qs("#mStudent");
  if (!sel) return;
  if (!students.length) {
    sel.innerHTML = `<option value="">— Add students first —</option>`;
    return;
  }
  sel.innerHTML = students
    .map((s) => `<option value="${esc(String(s._id ?? s.id ?? ""))}">${esc(s.name)}</option>`)
    .join("");
}

/* ───── Event wiring ───── */

function wire() {
  qs("#termFilter")?.addEventListener("change", () => {
    if (termFilterLocked) return;
    state.term = qs("#termFilter").value;
    state.page = 1;
    load();
  });
  qs("#search")?.addEventListener("input", () => {
    state.search = qs("#search").value.trim();
    state.page = 1;
    load();
  });
  qs("#onlyRisk")?.addEventListener("change", () => {
    state.onlyRisk = qs("#onlyRisk").checked;
    state.page = 1;
    load();
  });
  qs("#onlyAnomaly")?.addEventListener("change", () => {
    state.onlyAnomaly = qs("#onlyAnomaly").checked;
    state.page = 1;
    load();
  });

  qsa(".calc-input").forEach((inp) => inp.addEventListener("input", livePreview));

  qs("#btnExport")?.addEventListener("click", async () => {
    try {
      const csv = await apiCsv();
      downloadBlob("simms_marks.csv", csv, "text/csv");
      toast("good", "Exported", "CSV downloaded.");
    } catch (e) {
      toast("bad", "Export failed", e.message);
    }
  });

  qs("#csvFile")?.addEventListener("change", async (e) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    const atomic = qs("#csvStrict")?.checked ?? false;
    try {
      const data = await uploadCsv(f, { atomic });
      let msg = `Rows: ${data.imported || 0}`;
      if (data.errors?.length) msg += `. Skipped: ${data.errors.length}`;
      toast("good", "Imported", msg);
      await refreshTermFilter().catch(() => {});
      await load();
    } catch (err) {
      toast("bad", "CSV", err.message);
    }
  });

  qs("#jsonBulkFile")?.addEventListener("change", async (e) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    if (!canEditMarks()) return toast("warn", "Locked", "Cannot import marks.");
    try {
      const text = await f.text();
      const parsed = JSON.parse(text);
      const marks = parsed.marks ?? parsed;
      if (!Array.isArray(marks) || !marks.length) {
        toast("bad", "JSON", "File must be a JSON array or { \"marks\": [...] }.");
        return;
      }
      const data = await api("/marks/bulk", { method: "POST", body: JSON.stringify({ marks }) });
      let msg = `Upserted: ${data.imported || 0}`;
      if (data.errors?.length) msg += `. Issues: ${data.errors.length}`;
      toast("good", "Bulk JSON", msg);
      await refreshTermFilter().catch(() => {});
      await load();
    } catch (err) {
      toast("bad", "JSON bulk", err.message || "Invalid JSON");
    }
  });

  qs("#btnAdd")?.addEventListener("click", () => {
    if (!canEditMarks()) return toast("warn", "Locked", "Cannot add marks.");
    openMarkModal();
  });

  qs("#mSave")?.addEventListener("click", saveNewMark);

  qsa("#modalMark [data-close]").forEach((b) =>
    b.addEventListener("click", () => qs("#modalMark").classList.remove("open"))
  );
  qsa("#modalRem [data-close]").forEach((b) =>
    b.addEventListener("click", () => qs("#modalRem").classList.remove("open"))
  );

  qs("#remSave")?.addEventListener("click", saveRemedial);
}

/* ───── Live preview ───── */

function livePreview() {
  const mid1 = Number(qs("#m1")?.value || 0);
  const assign = Number(qs("#as")?.value || 0);
  const mid2 = Number(qs("#m2")?.value || 0);
  const lab = Number(qs("#lb")?.value || 0);
  const i1 = mid1 + assign;
  const i2 = mid2 + lab;

  const p1 = qs("#previewI1"), p2 = qs("#previewI2");
  if (p1) p1.textContent = i1;
  if (p2) p2.textContent = i2;

  if (!mid1 && !assign && !mid2 && !lab) {
    const pc = qs("#previewCalc"); if (pc) pc.textContent = "Enter scores above to see the automatic calculation.";
    const pf = qs("#previewFinal"); if (pf) pf.textContent = "—";
    const b1 = qs("#previewI1Badge"); if (b1) b1.textContent = "";
    const b2 = qs("#previewI2Badge"); if (b2) b2.textContent = "";
    return;
  }

  const best = Math.max(i1, i2);
  const other = Math.min(i1, i2);
  const final = ((best * 0.8) + (other * 0.2)).toFixed(1);
  const bestIs = i1 >= i2 ? 1 : 2;

  const b1 = qs("#previewI1Badge"); if (b1) b1.textContent = bestIs === 1 ? "★ Best (×0.80)" : "×0.20";
  const b2 = qs("#previewI2Badge"); if (b2) b2.textContent = bestIs === 2 ? "★ Best (×0.80)" : "×0.20";
  const pc = qs("#previewCalc");
  if (pc) pc.innerHTML =
    `Internal-${bestIs} = <strong>${best}</strong> × 0.80 = <strong>${(best * 0.8).toFixed(1)}</strong><br>` +
    `Internal-${bestIs === 1 ? 2 : 1} = <strong>${other}</strong> × 0.20 = <strong>${(other * 0.2).toFixed(1)}</strong>`;
  const pf = qs("#previewFinal"); if (pf) pf.textContent = final;
}

/* ───── Add / Edit modal ───── */

function openMarkModal() {
  if ((role === "admin" || role === "faculty") && !students.length) {
    toast("warn", "Students needed", "Add at least one student on the Students page before entering marks.");
    return;
  }
  const saveBtn = qs("#mSave");
  if (saveBtn) { delete saveBtn.dataset.editId; saveBtn.disabled = false; delete saveBtn.dataset.saving; }
  qs("#modalTitle").textContent = "Add Marks";
  qs("#mSubject").value = "";
  const mTerm = qs("#mTerm");
  if (mTerm) {
    const defT = String(settings.defaultTerm || "2025-T1").trim() || "2025-T1";
    mTerm.value = (state.term && state.term !== "all") ? state.term : defT;
    mTerm.disabled = false;
  }
  ["#m1", "#as", "#m2", "#lb"].forEach((id) => { const el = qs(id); if (el) el.value = ""; });
  livePreview();
  qs("#modalMark").classList.add("open");
}

function openEditMarkModal(id, rows) {
  const m = rows.find((x) => String(x._id) === String(id));
  if (!m) return;
  qs("#modalTitle").textContent = "Edit Marks";
  const sid = m.student?._id ?? m.student ?? m.studentId ?? "";
  const mStu = qs("#mStudent"); if (mStu) mStu.value = sid != null ? String(sid) : "";
  const mSub = qs("#mSubject"); if (mSub) mSub.value = m.subject || "";
  const mTerm = qs("#mTerm");
  if (mTerm) { mTerm.value = displayTerm(m); mTerm.disabled = true; }
  const m1 = qs("#m1"); if (m1) m1.value = m.mid1 || 0;
  const as = qs("#as"); if (as) as.value = m.assignment || 0;
  const m2 = qs("#m2"); if (m2) m2.value = m.mid2 || 0;
  const lb = qs("#lb"); if (lb) lb.value = m.lab || 0;
  livePreview();
  qs("#modalMark").classList.add("open");
  qs("#mSave").dataset.editId = id;
}

/* ───── Save mark ───── */

async function saveNewMark() {
  const saveBtn = qs("#mSave");
  if (!saveBtn || saveBtn.dataset.saving === "1") return;

  const student = String(qs("#mStudent")?.value ?? "").trim();
  const subject = String(qs("#mSubject")?.value ?? "").trim();

  if (!subject) { toast("bad", "Validation", "Subject required"); return; }
  if (!student) { toast("bad", "Validation", "Select a student."); return; }

  saveBtn.dataset.saving = "1";
  saveBtn.disabled = true;
  try {
    const payload = {
      student,
      subject,
      mid1: Number(qs("#m1")?.value || 0),
      assignment: Number(qs("#as")?.value || 0),
      mid2: Number(qs("#m2")?.value || 0),
      lab: Number(qs("#lb")?.value || 0),
    };

    const editId = saveBtn.dataset.editId;
    if (editId) {
      await api(`/marks/${editId}`, { method: "PATCH", body: JSON.stringify(payload) });
      delete saveBtn.dataset.editId;
      if (qs("#mTerm")) qs("#mTerm").disabled = false;
      toast("good", "Updated", "Marks updated.");
    } else {
      const defT = String(settings.defaultTerm || "2025-T1").trim() || "2025-T1";
      const term = String(qs("#mTerm")?.value ?? "").trim() || defT;
      await api("/marks", { method: "POST", body: JSON.stringify({ ...payload, term }) });
      // Always sync state.term to the saved term (except if user deliberately chose "all")
      if (state.term !== "all") state.term = term;
      // Refresh dropdown — adds the new term if it wasn't listed, selects it
      await refreshTermFilter().catch(() => {});
      toast("good", "Saved", `Marks saved under term "${term}".`);
    }

    state.page = 1;
    qs("#modalMark").classList.remove("open");
    await load();
  } catch (e) {
    const msg = e?.message || "Save failed";
    if (e?.status === 409 || /already exist/i.test(msg)) {
      toast("bad", "Duplicate", "Row already exists for this student + subject + term.");
    } else if (e?.status === 403 || /locked|deadline/i.test(msg)) {
      toast("bad", "Locked", msg);
    } else {
      toast("bad", "Error", msg);
    }
  } finally {
    delete saveBtn.dataset.saving;
    saveBtn.disabled = false;
  }
}

/* ───── Load & render ───── */

async function load() {
  const params = new URLSearchParams();
  params.set("page", String(state.page));
  params.set("limit", String(state.limit));
  if (state.search) params.set("search", state.search);
  if (state.onlyRisk) params.set("atRisk", "true");
  if (state.onlyAnomaly) params.set("anomaly", "true");
  if (state.term === "all") params.set("term", "all");
  else if (state.term) params.set("term", state.term);
  if (role === "student" && (user?.studentId || user?.studentRef)) {
    params.set("studentId", user.studentId || user.studentRef);
  }

  try {
    const data = await api(`/marks?${params}`);
    const rows = data.marks || [];
    const pi = qs("#pageInfo");
    if (pi) pi.textContent = `Page ${data.page} · ${data.total} total`;
    renderRows(rows);
    renderPager(data.page, data.limit, data.total);
  } catch (e) {
    toast("bad", "Load failed", e.message);
  }
}

function renderRows(rows) {
  const tb = qs("#tbody");
  if (!tb) return;
  const dis = !canEditMarks() || role === "student" ? "disabled" : "";

  tb.innerHTML = rows.map((m) => {
    const name = m.student?.name || "—";
    const anom = m.anomaly ? `<span class="badge warn">Anomaly</span>` : "";
    const i1 = m.internal1 != null ? m.internal1 : (m.mid1 || 0) + (m.assignment || 0);
    const i2 = m.internal2 != null ? m.internal2 : (m.mid2 || 0) + (m.lab || 0);
    const internalSum = Math.round((Number(i1) + Number(i2)) * 10) / 10;
    const internalLow = internalSum > 0 && internalSum < INTERNAL_SUM_RISK;
    const finalNum = Number(m.final);
    const finalLow = Number.isFinite(finalNum) && finalNum < INTERNAL_SUM_RISK;
    const risk =
      m.atRisk || internalLow || finalLow
        ? `<span class="badge bad">At risk</span>${
            finalLow
              ? ` <span class="hint">final &lt; ${INTERNAL_SUM_RISK}</span>`
              : internalLow
                ? ` <span class="hint">I1+I2 ${internalSum} &lt; ${INTERNAL_SUM_RISK}</span>`
                : ""
          }`
        : `<span class="badge good">OK</span>`;
    const best1 = m.bestKey === "internal1";
    const i1Cell = `<span title="Mid-1: ${m.mid1} + Assign: ${m.assignment}"
      style="${best1 ? "font-weight:700;color:var(--success,#22c55e)" : ""}">${i1}${best1 ? " ★" : ""}</span>`;
    const i2Cell = `<span title="Mid-2: ${m.mid2} + Lab: ${m.lab}"
      style="${!best1 ? "font-weight:700;color:var(--success,#22c55e)" : ""}">${i2}${!best1 ? " ★" : ""}</span>`;

    return `<tr class="${m.anomaly ? "row-anomaly" : ""}" data-id="${m._id}">
      <td><div class="table-user"><div class="table-avatar">${initialOf(name)}</div>
        <div class="table-user-copy"><strong>${esc(name)}</strong><span>Marks record</span></div></div></td>
      <td><span class="code-pill">${esc(m.subject)}</span></td>
      <td><span class="code-pill">${esc(displayTerm(m))}</span></td>
      <td>${i1Cell}</td>
      <td>${i2Cell}</td>
      <td><strong data-final>${m.final}</strong></td>
      <td><div class="row">${risk} ${anom}</div></td>
      <td data-role="admin,faculty"><div class="table-actions">
        <button type="button" class="btn small" data-edit="${m._id}" ${dis}>Edit</button>
        <button type="button" class="btn small" data-rem="${m._id}" ${dis}>Remedial</button>
        <button type="button" class="btn small danger" data-del="${m._id}" ${dis}>Delete</button>
      </div></td>
    </tr>`;
  }).join("");

  tb.querySelectorAll("button[data-edit]").forEach((b) =>
    b.addEventListener("click", () => openEditMarkModal(b.getAttribute("data-edit"), rows))
  );
  tb.querySelectorAll("button[data-del]").forEach((b) =>
    b.addEventListener("click", () => deleteMark(b.getAttribute("data-del")))
  );
  tb.querySelectorAll("button[data-rem]").forEach((b) =>
    b.addEventListener("click", () => openRem(b.getAttribute("data-rem"), rows))
  );
}

async function deleteMark(id) {
  if (!confirm("Delete this record?")) return;
  try {
    await api(`/marks/${id}`, { method: "DELETE" });
    toast("good", "Deleted", "Record removed.");
    await load();
  } catch (e) {
    toast("bad", "Error", e.message);
  }
}

/* ───── Remedial modal ───── */

function openRem(id, rows) {
  const m = rows.find((x) => String(x._id) === String(id));
  remTargetId = id;
  const info = qs("#remInfo");
  if (info) info.textContent = m ? `${m.student?.name || ""} · ${m.subject} · ${displayTerm(m)} — final ${m.final}` : "";
  const ra = qs("#remAfter"); if (ra) ra.value = "";
  const rn = qs("#remNotes"); if (rn) rn.value = "";
  qs("#modalRem").classList.add("open");
}

async function saveRemedial() {
  if (!remTargetId) return;
  try {
    const mark = (await api(`/marks/${remTargetId}`)).mark;
    await api("/remedials", {
      method: "POST",
      body: JSON.stringify({
        marksId: remTargetId,
        beforeFinal: mark?.final || 0,
        afterFinal: Number(qs("#remAfter")?.value || 0),
        notes: qs("#remNotes")?.value || "",
      }),
    });
    qs("#modalRem").classList.remove("open");
    toast("good", "Saved", "Remedial recorded; marks updated.");
    await load();
  } catch (e) {
    toast("bad", "Error", e.message);
  }
}

/* ───── Pager ───── */

function renderPager(page, limit, total) {
  const pg = qs("#pager");
  if (!pg) return;
  const pages = Math.max(1, Math.ceil(total / limit));
  pg.innerHTML = [
    `<button class="btn small" ${page <= 1 ? "disabled" : ""} data-p="${page - 1}">Prev</button>`,
    `<span class="hint">${page} / ${pages}</span>`,
    `<button class="btn small" ${page >= pages ? "disabled" : ""} data-p="${page + 1}">Next</button>`,
  ].join("");
  pg.onclick = (e) => {
    const b = e.target.closest("button[data-p]");
    if (!b) return;
    state.page = Number(b.getAttribute("data-p"));
    load();
  };
}

/* ───── Helpers ───── */

function downloadBlob(name, data, mime) {
  const blob = data instanceof Blob ? data : new Blob([data], { type: mime || "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

boot();
