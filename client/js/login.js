import { login, refreshMe } from "./auth.js";
import { api } from "./api.js";
import { initThemeToggle, toast } from "./app.js";

const form = document.getElementById("loginForm");
const u = document.getElementById("username");
const p = document.getElementById("password");
const themeBtn = document.querySelector("[data-theme-toggle]");
const openPasswordChangeBtn = document.getElementById("openPasswordChange");
const passwordChangeModal = document.getElementById("passwordChangeModal");
const passwordChangeForm = document.getElementById("passwordChangeForm");
const pcUsername = document.getElementById("pcUsername");
const pcCurrent = document.getElementById("pcCurrent");
const pcNew = document.getElementById("pcNew");
const pcConfirm = document.getElementById("pcConfirm");

if (themeBtn) initThemeToggle(themeBtn);

function openPasswordModal() {
  passwordChangeModal?.classList.add("open");
  pcUsername?.focus();
}

function closePasswordModal() {
  passwordChangeModal?.classList.remove("open");
}

openPasswordChangeBtn?.addEventListener("click", openPasswordModal);
document.querySelectorAll("[data-close-password]").forEach((btn) => {
  btn.addEventListener("click", closePasswordModal);
});
passwordChangeModal?.addEventListener("click", (e) => {
  if (e.target === passwordChangeModal) closePasswordModal();
});

form?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = form.querySelector("[type=submit]");
  const prev = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Signing in…";
  try {
    const user = await login(u.value.trim(), p.value);
    await refreshMe().catch(() => {});
    window.location.href = "/pages/dashboard.html";
  } catch (err) {
    toast("bad", "Sign-in failed", err.message || "Check your credentials.");
  } finally {
    btn.disabled = false;
    btn.textContent = prev;
  }
});

passwordChangeForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = document.getElementById("pcSubmit");
  const username = pcUsername?.value.trim() || "";
  const currentPassword = pcCurrent?.value || "";
  const newPassword = pcNew?.value || "";
  const confirmPassword = pcConfirm?.value || "";

  if (!username || !currentPassword || !newPassword || !confirmPassword) {
    toast("warn", "Missing Data", "Please fill in all password fields.");
    return;
  }
  if (newPassword !== confirmPassword) {
    toast("warn", "Mismatch", "New password and confirmation do not match.");
    return;
  }

  const prev = btn?.textContent || "Update Password";
  try {
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Updating...";
    }

    await api("/auth/password", {
      method: "POST",
      body: JSON.stringify({ username, currentPassword, newPassword }),
    });

    closePasswordModal();
    passwordChangeForm.reset();
    toast("good", "Updated", "Password changed successfully. Signing you in...");
    await login(username, newPassword);
    await refreshMe().catch(() => {});
    window.location.href = "/pages/dashboard.html";
  } catch (err) {
    toast("bad", "Update failed", err.message || "Failed to change password.");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = prev;
    }
  }
});
