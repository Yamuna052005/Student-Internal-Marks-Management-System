import { api } from "./api.js";
import { requireAuth, refreshMe, requireRoles } from "./auth.js";
import { initShell, toast, qs, qsa } from "./app.js";

if (!requireAuth()) throw new Error("auth");
if (!requireRoles("admin")) throw new Error("role");

await refreshMe().catch(() => {});
initShell({ active: "faculty" });

let state = { search: "", editId: null };
let facultyRows = [];

function esc(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function initialOf(name) {
  return String(name || "?").trim().charAt(0).toUpperCase() || "?";
}

function filteredFaculty() {
  const q = state.search.trim().toLowerCase();
  if (!q) return facultyRows;
  return facultyRows.filter((row) =>
    [row.name, row.username, row.email]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(q))
  );
}

function render() {
  const rows = filteredFaculty();
  const tb = qs("#tbody");
  if (!tb) return;

  tb.innerHTML = rows.length
    ? rows.map((f) => `
      <tr data-id="${f._id}">
        <td>
          <div class="table-user">
            <div class="table-avatar">${initialOf(f.name)}</div>
            <div class="table-user-copy">
              <strong>${esc(f.name)}</strong>
              <span>${esc(f.email || "Faculty account")}</span>
            </div>
          </div>
        </td>
        <td><span class="code-pill">${esc(f.username)}</span></td>
        <td>
          <div class="table-actions">
            <button type="button" class="btn small" data-edit="${f._id}">Edit</button>
            <button type="button" class="btn small danger" data-del="${f._id}">Delete</button>
          </div>
        </td>
      </tr>
    `).join("")
    : `<tr><td colspan="3"><div class="empty">No faculty found.</div></td></tr>`;

  tb.querySelectorAll("[data-edit]").forEach((btn) =>
    btn.addEventListener("click", () => openEdit(btn.getAttribute("data-edit")))
  );
  tb.querySelectorAll("[data-del]").forEach((btn) =>
    btn.addEventListener("click", () => removeFaculty(btn.getAttribute("data-del")))
  );
}

async function load() {
  const data = await api("/users");
  facultyRows = (data.users || []).filter((user) => user.role === "faculty");
  render();
}

function openEdit(id) {
  const row = facultyRows.find((item) => String(item._id) === String(id));
  if (!row) return;
  state.editId = id;
  qs("#fcModalTitle").textContent = "Edit Faculty";
  qs("#fcName").value = row.name || "";
  qs("#fcUsername").value = row.username || "";
  qs("#fcEmail").value = row.email || "";
  qs("#fcPassword").value = "";
  qs("#modalFc").classList.add("open");
}

function openCreate() {
  state.editId = null;
  qs("#fcModalTitle").textContent = "Add Faculty";
  qs("#fcName").value = "";
  qs("#fcUsername").value = "";
  qs("#fcEmail").value = "";
  qs("#fcPassword").value = "";
  qs("#modalFc").classList.add("open");
}

async function removeFaculty(id) {
  if (!confirm("Delete faculty?")) return;
  try {
    await api(`/users/${id}`, { method: "DELETE" });
    toast("good", "Deleted", "Faculty removed.");
    await load();
  } catch (e) {
    toast("bad", "Error", e.message);
  }
}

async function saveFaculty() {
  const name = qs("#fcName").value.trim();
  const username = qs("#fcUsername").value.trim().toLowerCase();
  const email = qs("#fcEmail").value.trim().toLowerCase();
  const password = qs("#fcPassword").value.trim();

  if (!name || !username) {
    toast("bad", "Validation", "Name and username are required.");
    return;
  }
  if (!state.editId && !password) {
    toast("bad", "Validation", "Password is required for new faculty.");
    return;
  }

  const body = {
    name,
    username,
    email,
    role: "faculty",
    ...(password ? { password } : {}),
  };

  try {
    if (state.editId) {
      await api(`/users/${state.editId}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
    } else {
      await api("/users", {
        method: "POST",
        body: JSON.stringify(body),
      });
    }
    qs("#modalFc").classList.remove("open");
    toast("good", "Saved", "Faculty saved.");
    await load();
  } catch (e) {
    toast("bad", "Error", e.message);
  }
}

qs("#search")?.addEventListener("input", () => {
  state.search = qs("#search").value;
  render();
});

qs("#btnNew")?.addEventListener("click", openCreate);
qs("#fcSave")?.addEventListener("click", saveFaculty);
qsa("#modalFc [data-close]").forEach((btn) =>
  btn.addEventListener("click", () => qs("#modalFc").classList.remove("open"))
);

load().catch((e) => toast("bad", "Error", e.message));
