import { getSettingsDoc } from "./ensureSettings.js";

/**
 * @param {import("express").Request} req
 * @param {object | null} settingsPreloaded — optional doc from getSettingsDoc() to avoid a second query
 * @returns {Promise<{ mode: "all" } | { mode: "one", term: string }>}
 */
export async function resolveTermScope(req, settingsPreloaded = null) {
  const raw = req.query?.term;
  if (raw === "all" || raw === "*") return { mode: "all" };
  const settings = settingsPreloaded ?? (await getSettingsDoc());
  const term = String(raw || "").trim() || String(settings.defaultTerm || "2025-T1").trim() || "2025-T1";
  return { mode: "one", term };
}

/**
 * When viewing the **default** academic term, include legacy marks with no `term` field yet.
 */
export function applyTermMongoFilter(filter, scope, settings) {
  if (scope.mode === "all") return;
  const def = String(settings?.defaultTerm || "2025-T1").trim();
  // Use case-insensitive regex so "2025-t1" and "2025-T1" both match
  const termRegex = new RegExp(`^${scope.term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i");
  if (scope.term.toLowerCase() === def.toLowerCase()) {
    filter.$or = [
      { term: termRegex },
      { term: { $exists: false } },
      { term: null },
      { term: "" },
    ];
  } else {
    filter.term = termRegex;
  }
}

function settingsPlain(settings) {
  if (!settings) return {};
  return typeof settings.toObject === "function" ? settings.toObject() : settings;
}

function fallbackTerm(settings) {
  const s = settingsPlain(settings);
  return String(s.defaultTerm ?? "2025-T1").trim() || "2025-T1";
}

/** Mutates in place (legacy helpers, exports, CSV). */
export function normalizeMarkTerms(items, settings) {
  const fb = fallbackTerm(settings);
  const list = Array.isArray(items) ? items : items ? [items] : [];
  for (const m of list) {
    if (!m) continue;
    const raw = m.term;
    if (raw == null || String(raw).trim() === "") m.term = fb;
    else m.term = String(raw).trim();
  }
}

/**
 * Return a plain mark object guaranteed to include a non-empty string `term`
 * (new object — safe for JSON even if lean docs are odd).
 */
export function resolveMarkTermForApi(m, settings) {
  if (!m) return m;
  const fb = fallbackTerm(settings);
  const raw = m.term;
  const term = raw != null && String(raw).trim() !== "" ? String(raw).trim() : fb;
  return { ...m, term };
}

export function resolveMarksTermsForApiArray(items, settings) {
  return (items || []).map((m) => resolveMarkTermForApi(m, settings));
}
