import { api, getUser } from "./api.js";
import { requireAuth, refreshMe, requireRoles } from "./auth.js";
import { initShell, toast, qs, qsa } from "./app.js";

if (!requireAuth()) throw new Error("auth");
if (!requireRoles("admin", "faculty")) throw new Error("role");
await refreshMe().catch(() => {});
initShell({ active: "students" });

let state = { page: 1, limit: 20, search: "", editId: null };

function esc(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function initialOf(name) {
  return String(name || "?").trim().charAt(0).toUpperCase() || "?";
}

function escapeRegex(value) {
  return String(value ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function highlightMatch(value, query) {
  const text = String(value ?? "");
  const q = String(query ?? "").trim();
  if (!q) return esc(text);
  const re = new RegExp(`(${escapeRegex(q)})`, "ig");
  return esc(text).replace(re, '<mark class="search-hit">$1</mark>');
}

function renderHistory(report) {
  const body = qs("#historyBody");
  if (!body) return;
  const years = report?.years || [];
  if (!years.length) {
    body.innerHTML = '<div class="empty">No marks found for this student.</div>';
    return;
  }

  body.innerHTML = years.map((year) => `
    <section class="card" style="margin-bottom:1rem;">
      <h3 style="margin-bottom:1rem;">Year ${esc(year.year)}</h3>
      ${(year.semesters || []).map((sem) => `
        <div style="margin-bottom:1rem;padding:1rem;border:1px solid var(--border);border-radius:12px;">
          <div style="display:flex;justify-content:space-between;gap:1rem;flex-wrap:wrap;margin-bottom:0.75rem;">
            <strong>${esc(sem.semester)}</strong>
            <span class="code-pill">${esc(sem.term)}</span>
          </div>
          <div style="display:flex;flex-direction:column;gap:0.75rem;">
            ${(sem.subjects || []).map((subj) => `
              <div style="padding:0.85rem 1rem;border:1px solid var(--border);border-radius:10px;background:rgba(255,255,255,0.02);">
                <div style="display:flex;justify-content:space-between;gap:1rem;flex-wrap:wrap;">
                  <strong>${esc(subj.subject)}</strong>
                  <span class="badge ${Number(subj.final) < 16 ? "bad" : "good"}">${Number(subj.final) < 16 ? "Fail" : "Pass"}</span>
                </div>
                <div class="hint" style="margin-top:0.4rem;">
                  Term ${esc(subj.term)} · I1 ${esc(subj.internal1)} · I2 ${esc(subj.internal2)} · Final ${esc(subj.final)}
                </div>
              </div>
            `).join("")}
          </div>
        </div>
      `).join("")}
    </section>
  `).join("");
}

async function openHistory(student) {
  try {
    const data = await api(`/students/${student._id}/academic-report`);
    qs("#historyTitle").textContent = `${student.name} - Full Academic History`;
    renderHistory(data);
    qs("#modalHistory").classList.add("open");
  } catch (e) {
    toast("bad", "Error", e.message || "Failed to load student history.");
  }
}

async function load() {
  const params = new URLSearchParams({ page: String(state.page), limit: String(state.limit) });
  if (state.search) params.set("search", state.search);

  const data = await api(`/students?${params}`);
  const rows = data.students || [];

  const currentUser = getUser();
  const isAdmin = currentUser?.role === "admin";
  const query = state.search.trim();

  qs("#tbody").innerHTML = rows.length
    ? rows.map(student => {
        const matched =
          query &&
          [student.name, student.rollNumber, student.section]
            .filter(Boolean)
            .some((value) => String(value).toLowerCase().includes(query.toLowerCase()));
        return `<tr data-id="${student._id}" class="${matched ? "student-search-match" : ""}">
        <td>
          <div class="table-user">
            <div class="table-avatar">${initialOf(student.name)}</div>
            <div class="table-user-copy">
              <strong>${highlightMatch(student.name, query)}</strong>
              <span>Student profile</span>
            </div>
          </div>
        </td>
        <td><span class="code-pill">${highlightMatch(student.rollNumber, query)}</span></td>
        <td><span class="badge">${highlightMatch(student.section, query)}</span></td>
        <td>
          <div class="table-actions">
            <button type="button" class="btn small ghost" data-history="${student._id}">History</button>
            ${isAdmin ? `
            <button type="button" class="btn small" data-edit="${student._id}">Edit</button>
            <button type="button" class="btn small danger" data-del="${student._id}">Delete</button>
            ` : ""}
          </div>
        </td>
      </tr>`;
      }).join("")
    : '<tr><td colspan="4"><div class="empty">No students found.</div></td></tr>';

  qs("#tbody").querySelectorAll("[data-history]").forEach(button =>
    button.addEventListener("click", () => {
      const id = button.getAttribute("data-history");
      const student = rows.find(item => item._id === id);
      if (student) openHistory(student);
    })
  );

  qs("#tbody").querySelectorAll("[data-edit]").forEach(button =>
    button.addEventListener("click", () => {
      const id = button.getAttribute("data-edit");
      const student = rows.find(item => item._id === id);
      state.editId = id;
      qs("#mt").textContent = "Edit student";
      qs("#stName").value = student?.name || "";
      qs("#stRoll").value = student?.rollNumber || "";
      qs("#stSec").value = student?.section || "";
      qs("#modalSt").classList.add("open");
    })
  );

  qs("#tbody").querySelectorAll("[data-del]").forEach(button =>
    button.addEventListener("click", async () => {
      const id = button.getAttribute("data-del");
      if (!confirm("Delete student?")) return;
      await api(`/students/${id}`, { method: "DELETE" });
      toast("good", "Deleted", "Student removed.");
      await load();
    })
  );

  const pages = Math.max(1, Math.ceil((data.total || 0) / (data.limit || state.limit)));
  qs("#pager").innerHTML = `
    <button class="btn small" ${state.page <= 1 ? "disabled" : ""} data-p="${state.page - 1}">Prev</button>
    <span class="hint">${state.page} / ${pages}</span>
    <button class="btn small" ${state.page >= pages ? "disabled" : ""} data-p="${state.page + 1}">Next</button>`;

  qs("#pager").onclick = event => {
    const button = event.target.closest("button[data-p]");
    if (!button) return;
    state.page = Number(button.getAttribute("data-p"));
    load();
  };
}

qs("#search").addEventListener(
  "input",
  debounce(() => {
    state.search = qs("#search").value.trim();
    state.page = 1;
    load();
  }, 250)
);

qs("#btnNew").addEventListener("click", () => {
  state.editId = null;
  qs("#mt").textContent = "Add student";
  qs("#stName").value = "";
  qs("#stRoll").value = "";
  qs("#stSec").value = "";
  qs("#modalSt").classList.add("open");
});

qsa("#modalSt [data-close]").forEach(button => button.addEventListener("click", () => qs("#modalSt").classList.remove("open")));
qsa("#modalHistory [data-close]").forEach(button => button.addEventListener("click", () => qs("#modalHistory").classList.remove("open")));

qs("#stSave").addEventListener("click", async () => {
  const body = {
    name: qs("#stName").value.trim(),
    rollNumber: qs("#stRoll").value.trim(),
    section: qs("#stSec").value.trim(),
  };

  try {
    if (state.editId) await api(`/students/${state.editId}`, { method: "PATCH", body: JSON.stringify(body) });
    else await api("/students", { method: "POST", body: JSON.stringify(body) });
    qs("#modalSt").classList.remove("open");
    toast("good", "Saved", "Student saved.");
    await load();
  } catch (e) {
    toast("bad", "Error", e.message);
  }
});

function debounce(fn, ms) {
  let timeout;
  return (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => fn(...args), ms);
  };
}

load().catch(e => toast("bad", "Error", e.message));
