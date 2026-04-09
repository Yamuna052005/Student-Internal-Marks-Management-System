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

async function load() {
  const params = new URLSearchParams({ page: String(state.page), limit: String(state.limit) });
  if (state.search) params.set("search", state.search);

  const data = await api(`/students?${params}`);
  const rows = data.students || [];

  const currentUser = getUser();
  const isAdmin = currentUser?.role === "admin";

  qs("#tbody").innerHTML = rows.length
    ? rows.map(student => `<tr data-id="${student._id}">
        <td>
          <div class="table-user">
            <div class="table-avatar">${initialOf(student.name)}</div>
            <div class="table-user-copy">
              <strong>${esc(student.name)}</strong>
              <span>Student profile</span>
            </div>
          </div>
        </td>
        <td><span class="code-pill">${esc(student.rollNumber)}</span></td>
        <td><span class="badge">${esc(student.section)}</span></td>
        <td>
          ${isAdmin ? `
          <div class="table-actions">
            <button type="button" class="btn small" data-edit="${student._id}">Edit</button>
            <button type="button" class="btn small danger" data-del="${student._id}">Delete</button>
          </div>
          ` : '<span class="hint">Read-only</span>'}
        </td>
      </tr>`).join("")
    : '<tr><td colspan="4"><div class="empty">No students found.</div></td></tr>';

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
