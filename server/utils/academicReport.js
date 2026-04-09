/**
 * Group academic terms into year / semester buckets for reports.
 * Supports common patterns: 2025-T1, 2024-S2, 2025_1, AY2025-T1; fallback uses full term as semester under "Other".
 */

export function parseTermYearSemester(termRaw, defaultTerm = "2025-T1") {
  const term = String(termRaw ?? "").trim() || String(defaultTerm ?? "").trim() || "Unknown";

  const m = term.match(/^(\d{4})[-_/]?(T|S|SEM)?[._-]?(\d+)$/i);
  if (m) {
    const year = m[1];
    const semType = (m[2] || "T").toUpperCase();
    const semNum = m[3];
    const semesterKey = `${semType}${semNum}`;
    return {
      yearKey: year,
      yearLabel: year,
      semesterKey,
      semesterLabel: `${semType === "S" ? "Semester" : "Term"} ${semNum}`,
      term,
    };
  }

  const yearOnly = term.match(/^(\d{4})$/);
  if (yearOnly) {
    return {
      yearKey: yearOnly[1],
      yearLabel: yearOnly[1],
      semesterKey: "Y",
      semesterLabel: "Year",
      term,
    };
  }

  const ay = term.match(/(?:AY|20)(\d{2,4})[-_/]?([TS]\d+|S\d+)/i);
  if (ay) {
    const y = ay[1].length === 2 ? `20${ay[1]}` : ay[1];
    return {
      yearKey: y,
      yearLabel: y,
      semesterKey: ay[2].toUpperCase(),
      semesterLabel: ay[2].toUpperCase(),
      term,
    };
  }

  return {
    yearKey: "other",
    yearLabel: "Other",
    semesterKey: term,
    semesterLabel: term,
    term,
  };
}

/**
 * @param {Array<object>} enrichedMarks - marks with term, internalTotal, internalAtRisk, etc.
 */
export function groupMarksByYearSemester(enrichedMarks, defaultTerm) {
  const yearBuckets = new Map();

  for (const m of enrichedMarks) {
    const meta = parseTermYearSemester(m.term, defaultTerm);
    const yk = meta.yearKey;
    if (!yearBuckets.has(yk)) {
      yearBuckets.set(yk, {
        year: meta.yearLabel,
        yearKey: yk,
        semesters: new Map(),
      });
    }
    const yb = yearBuckets.get(yk);
    const semKey = `${meta.term}::${meta.semesterKey}`;
    if (!yb.semesters.has(semKey)) {
      yb.semesters.set(semKey, {
        semester: meta.semesterLabel,
        semesterKey: meta.semesterKey,
        term: meta.term,
        subjects: [],
      });
    }
    yb.semesters.get(semKey).subjects.push(m);
  }

  const yearSort = (a, b) => {
    if (a.yearKey === "other") return 1;
    if (b.yearKey === "other") return -1;
    return String(b.yearKey).localeCompare(String(a.yearKey), undefined, { numeric: true });
  };

  const semSort = (a, b) => {
    return String(a.term).localeCompare(String(b.term), undefined, { sensitivity: "base", numeric: true });
  };

  const years = [...yearBuckets.values()]
    .sort(yearSort)
    .map((yb) => ({
      year: yb.year,
      yearKey: yb.yearKey,
      semesters: [...yb.semesters.values()].sort(semSort),
    }));

  return { years };
}
