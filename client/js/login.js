import { login, refreshMe } from "./auth.js";
import { initThemeToggle, toast } from "./app.js";

const form = document.getElementById("loginForm");
const u = document.getElementById("username");
const p = document.getElementById("password");
const themeBtn = document.querySelector("[data-theme-toggle]");

if (themeBtn) initThemeToggle(themeBtn);

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
