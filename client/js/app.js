import { getUser } from "./api.js";

export function qs(sel, root = document) {
  return root.querySelector(sel);
}

export function qsa(sel, root = document) {
  return Array.from(root.querySelectorAll(sel));
}

export function toast(type, title, msg, ms = 3200) {
  let wrap = qs(".toast-wrap");
  if (!wrap) {
    wrap = document.createElement("div");
    wrap.className = "toast-wrap";
    document.body.appendChild(wrap);
  }
  const el = document.createElement("div");
  el.className = `toast ${type || ""}`.trim();
  el.innerHTML = `<div class="dot"></div><div class="t"><b>${escape(title)}</b><span>${escape(msg || "")}</span></div>`;
  wrap.appendChild(el);
  setTimeout(() => {
    el.style.opacity = "0";
    setTimeout(() => el.remove(), 200);
  }, ms);
}

function escape(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function applyTheme(theme) {
  const t = theme === "light" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", t);
  localStorage.setItem("simms_theme", t);
  const meta = document.querySelector('meta[name="color-scheme"]');
  if (meta) meta.setAttribute("content", t);
  qsa("[data-theme-toggle]").forEach(syncThemeToggleLabel);
}

/** Apply saved preference before paint on inner pages + landing. */
export function hydrateTheme() {
  try {
    const saved = localStorage.getItem("simms_theme");
    const t = saved === "light" || saved === "dark" ? saved : "dark";
    document.documentElement.setAttribute("data-theme", t);
  } catch (_) {
    document.documentElement.setAttribute("data-theme", "dark");
  }
  const meta = document.querySelector('meta[name="color-scheme"]');
  if (meta) {
    const t = document.documentElement.getAttribute("data-theme") || "dark";
    meta.setAttribute("content", t);
  }
}

function syncThemeToggleLabel(btn) {
  const isLight = document.documentElement.getAttribute("data-theme") === "light";
  const label = isLight ? "Dark" : "Light";
  btn.setAttribute("aria-label", `${label} mode`);
  btn.setAttribute("aria-pressed", isLight ? "true" : "false");
  if (btn.dataset.themeKeepText !== "1") btn.textContent = label;
}

export function initThemeToggle(btn) {
  if (!btn) return;
  syncThemeToggleLabel(btn);
  btn.addEventListener("click", () => {
    const isLight = document.documentElement.getAttribute("data-theme") === "light";
    applyTheme(isLight ? "dark" : "light");
  });
}

function initMobileDrawer(shell) {
  if (!shell || shell.dataset.mobileDrawerInit === "1") return;
  shell.dataset.mobileDrawerInit = "1";

  let backdrop = qs(".sidebar-backdrop");
  if (!backdrop) {
    backdrop = document.createElement("div");
    backdrop.className = "sidebar-backdrop";
    backdrop.setAttribute("aria-hidden", "true");
    document.body.appendChild(backdrop);
  }

  const mqMobile = () => window.matchMedia("(max-width: 1024px)").matches;

  const setBackdrop = (open) => {
    if (open && mqMobile()) backdrop.classList.add("is-visible");
    else backdrop.classList.remove("is-visible");
  };

  const setToggleState = (open) => {
    qsa("[data-mobile-sidebar-toggle]").forEach((btn) => {
      btn.setAttribute("aria-expanded", open ? "true" : "false");
      btn.setAttribute("aria-label", open ? "Close menu" : "Open menu");
    });
  };

  qsa("[data-mobile-sidebar-toggle]").forEach((btn) => {
    btn.setAttribute("aria-expanded", "false");
    btn.setAttribute("aria-label", "Open menu");
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      shell.classList.toggle("sidebar-open");
      const open = shell.classList.contains("sidebar-open");
      setBackdrop(open);
      setToggleState(open);
    });
  });

  backdrop.addEventListener("click", () => {
    shell.classList.remove("sidebar-open");
    setBackdrop(false);
    setToggleState(false);
  });

  qsa(".sidebar .nav-link").forEach((a) => {
    a.addEventListener("click", () => {
      if (!mqMobile()) return;
      shell.classList.remove("sidebar-open");
      setBackdrop(false);
      setToggleState(false);
    });
  });

  window.addEventListener("resize", () => {
    if (!mqMobile()) {
      shell.classList.remove("sidebar-open");
      setBackdrop(false);
      setToggleState(false);
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!shell.classList.contains("sidebar-open")) return;
    shell.classList.remove("sidebar-open");
    setBackdrop(false);
    setToggleState(false);
  });
}

export function initShell({ active }) {
  const u = getUser();
  qsa("[data-who]").forEach((el) => {
    el.textContent = u ? `${u.name} • ${u.role}` : "—";
  });
  qsa("[data-nav]").forEach((a) => {
    a.classList.toggle("active", a.getAttribute("data-nav") === active);
  });
  qsa("[data-role]").forEach((el) => {
    const allow = (el.getAttribute("data-role") || "").split(",").map((s) => s.trim());
    el.style.display = !u || allow.includes(u.role) ? "" : "none";
  });

  qs("[data-logout]")?.addEventListener("click", () => {
    import("./auth.js").then((m) => m.logout());
  });

  const shell = qs(".app-shell");
  qs("[data-sidebar-toggle]")?.addEventListener("click", () => {
    shell?.classList.toggle("sidebar-collapsed");
    localStorage.setItem("simms_sb", shell?.classList.contains("sidebar-collapsed") ? "1" : "0");
  });
  initMobileDrawer(shell);
  if (localStorage.getItem("simms_sb") === "1") shell?.classList.add("sidebar-collapsed");

  qsa("[data-theme-toggle]").forEach((btn) => initThemeToggle(btn));

  initGlobalUI();
}

// --- High-End UI Logic ---

export function initGlobalUI() {
  // Navbar Scroll Logic
  const nav = qs(".landing-nav");
  if (nav) {
    window.addEventListener("scroll", () => {
      nav.classList.toggle("scrolled", window.scrollY > 20);
    });
  }

  // Intersection Observer for Reveal & Count-Up
  const observerOptions = {
    threshold: 0.15,
    rootMargin: "0px 0px -50px 0px"
  };

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        // Reveal Logic
        entry.target.classList.add("reveal-visible");
        
        // Count-Up Logic
        const countEl = entry.target.querySelector(".count-up");
        if (countEl && !countEl.dataset.started) {
          animateCount(entry.target);
          countEl.dataset.started = "true";
        }
        
        observer.unobserve(entry.target);
      }
    });
  }, observerOptions);

  qsa(".ui-reveal").forEach(el => {
    observer.observe(el);
    
    // Initial check for items already in viewport
    const rect = el.getBoundingClientRect();
    if (rect.top < window.innerHeight && rect.bottom > 0) {
      el.classList.add("reveal-visible");
      const countEl = el.querySelector(".count-up");
      if (countEl && !countEl.dataset.started) {
        animateCount(el);
        countEl.dataset.started = "true";
      }
    }
  });
}

function animateCount(wrapper) {
  const target = parseInt(wrapper.dataset.target);
  const el = wrapper.querySelector(".count-up");
  if (!el || isNaN(target)) return;
  
  let current = 0;
  const duration = 2000; // 2s
  const steps = 60;
  const increment = target / steps;
  const stepTime = duration / steps;
  
  const timer = setInterval(() => {
    current += increment;
    if (current >= target) {
      el.childNodes[0].nodeValue = target; // Update only text, preserve suffix spans
      clearInterval(timer);
    } else {
      el.childNodes[0].nodeValue = Math.floor(current);
    }
  }, stepTime);
}

// Global reveal fallback
const safeInit = () => {
  if (!window.simms_ui_inited) {
    initGlobalUI();
    window.simms_ui_inited = true;
  }
};

hydrateTheme();

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", safeInit);
} else {
  safeInit();
}