import { api, getUser } from "./api.js";
import { requireAuth, refreshMe, requireRoles } from "./auth.js";
import { initShell, toast, qs, qsa } from "./app.js";

if (!requireAuth()) throw new Error("auth");
if (!requireRoles("admin")) throw new Error("role");

await refreshMe().catch(() => {});
initShell({ active: "faculty" });

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
  const params = new URLSearchParams({
    page: String(state.page),
    limit: String(state.limit),
  });

  if (state.search) params.set("search", state.search);

  // ✅ CHANGE API
  const data = await api(`/users/faculty?${params}`);
  const rows = data.faculty || [];

  qs("#tbody").innerHTML = rows.length
    ? rows.map(f => `
      <tr data-id="${f._id}">
        <td>
          <div class="table-user">
            <div class="table-avatar">${initialOf(f.full_name)}</div>
            <div class="table-user-copy">
              <strong>${esc(f.full_name)}</strong>
              <span>Faculty account</span>
            </div>
          </div>
        </td>
        <td><span class="code-pill">${esc(f.username)}</span></td>
        <td>
          <div class="table-actions">
            <button class="btn small" data-edit="${f._id}">Edit</button>
            <button class="btn small danger" data-del="${f._id}">Delete</button>
          </div>
        </td>
      </tr>
    `).join("")
    : `<tr><td colspan="3"><div class="empty">No faculty found.</div></td></tr>`;

  // EDIT
  qs("#tbody").querySelectorAll("[data-edit]").forEach(btn =>
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-edit");
      const f = rows.find(x => x._id === id);

      state.editId = id;
      qs("#fcName").value = f?.full_name || "";
      qs("#fcUsername").value = f?.username || "";
      qs("#fcPassword").value = ""; // don’t show password
      qs("#modalFc").classList.add("open");
    })
  );

  // DELETE
  qs("#tbody").querySelectorAll("[data-del]").forEach(btn =>
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-del");
      if (!confirm("Delete faculty?")) return;

      await api(`/users/${id}`, { method: "DELETE" });
      toast("good", "Deleted", "Faculty removed.");
      load();
    })
  );
}

// SEARCH
qs("#search").addEventListener(
  "input",
  debounce(() => {
    state.search = qs("#search").value.trim();
    state.page = 1;
    load();
  }, 300)
);

// ADD BUTTON
qs("#btnNew").addEventListener("click", () => {
  state.editId = null;
  qs("#fcName").value = "";
  qs("#fcUsername").value = "";
  qs("#fcPassword").value = "";
  qs("#modalFc").classList.add("open");
});

// CLOSE MODAL
qsa("#modalFc [data-close]").forEach(btn =>
  btn.addEventListener("click", () =>
    qs("#modalFc").classList.remove("open")
  )
);

// SAVE
qs("#fcSave").addEventListener("click", async () => {
  const body = {
    full_name: qs("#fcName").value.trim(),
    username: qs("#fcUsername").value.trim(),
    password: qs("#fcPassword").value.trim(),
  };

  try {
    if (state.editId) {
      await api(`/users/${state.editId}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
    } else {
      await api("/users/faculty", {
        method: "POST",
        body: JSON.stringify(body),
      });
    }

    qs("#modalFc").classList.remove("open");
    toast("good", "Saved", "Faculty saved.");
    load();

  } catch (e) {
    toast("bad", "Error", e.message);
  }
});

// debounce
function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

load().catch(e => toast("bad", "Error", e.message));