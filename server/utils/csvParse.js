import { computeMarksPayload } from "./calcMarks.js";

function normalizeHeader(h) {
  return String(h || "")
    .trim()
    .toLowerCase()
    .replaceAll(" ", "")
    .replaceAll("-", "")
    .replaceAll("_", "");
}

function parseLine(line) {
  const out = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"' && line[i + 1] === '"') {
      cur += '"';
      i++;
      continue;
    }
    if (ch === '"') {
      inQ = !inQ;
      continue;
    }
    if (ch === "," && !inQ) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

export function parseMarksCsv(text) {
  const raw = String(text || "").replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  const lines = raw.split("\n").filter((l) => l.trim().length);
  if (lines.length < 2) {
    return { ok: false, reason: "CSV must include a header row and at least one data row." };
  }

  const header = parseLine(lines[0]).map(normalizeHeader);
  const idx = (key, aliases = []) => {
    const keys = [key, ...aliases].map(normalizeHeader);
    return header.findIndex((h) => keys.includes(h));
  };

  const cName = idx("name", ["studentname", "student"]);
  const cSubject = idx("subject", ["course", "paper"]);
  const cMid1 = idx("mid1", ["midone"]);
  const cMid2 = idx("mid2", ["midtwo"]);
  const cAssign = idx("assignment", ["assign", "assessment"]);
  const cLab = idx("lab", ["practical"]);
  const cTerm = idx("term", ["academicterm", "semester", "period"]);

  if (cName < 0) return { ok: false, reason: "CSV header must include a Name column." };
  if (cSubject < 0) return { ok: false, reason: "CSV header must include a Subject column." };

  const rows = [];
  const errors = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseLine(lines[i]);
    const name = String(cols[cName] || "").trim();
    const subject = String(cols[cSubject] || "").trim();
    if (!name || !subject) {
      errors.push(`Row ${i + 1}: Missing name or subject.`);
      continue;
    }
    const mid1 = cMid1 >= 0 ? Number(cols[cMid1]) : 0;
    const mid2 = cMid2 >= 0 ? Number(cols[cMid2]) : 0;
    const assignment = cAssign >= 0 ? Number(cols[cAssign]) : 0;
    const lab = cLab >= 0 ? Number(cols[cLab]) : 0;
    const computed = computeMarksPayload({ mid1, mid2, assignment, lab });
    const termCell = cTerm >= 0 ? String(cols[cTerm] || "").trim() : "";
    rows.push({
      name,
      subject,
      term: termCell || null,
      ...computed,
    });
  }

  if (!rows.length) return { ok: false, reason: errors[0] || "No valid rows found in CSV." };
  return { ok: true, rows, errors };
}
