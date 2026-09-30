/**
 * Parser for NRPC's weekly Deviation Settlement Account (DSA).
 *
 * Pure text → structure; no network, no database. The fetching and storing
 * live in nrpcDsaIngest.js so this can be tested against a fixture.
 *
 * The document is the authority on its own numbers. This parser therefore
 * extracts and checks, and never computes a settlement figure: `DEVI AMT` and
 * `NET DEVI` are read straight off the page. That is deliberate — a day can
 * carry a receivable while under-injecting, because each 15-minute block is
 * priced against the grid frequency in that block, so nothing of the form
 * (actual − scheduled) × rate reproduces the published amount.
 *
 * Units and signs are the document's, kept unconverted all the way into the
 * database so that what we store can be diffed against the PDF line by line:
 *
 *   SCHDL / ACTUAL   Lakh Units (LU). 1 LU = 100 MWh.
 *   DEVI AMT etc.    Rs Lakh.
 *   sign             the header reads "to be Paid (+) / Received (−)", so a
 *                    positive figure is money the entity owes the pool. Note
 *                    this is the opposite of deviation_settlements, where
 *                    positive means recoverable. Converting is the importer's
 *                    job, and it is not done here.
 */

const MONTHS = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

const pad = (n) => String(n).padStart(2, '0');

/** "29th December, 2025" → "2025-12-29" */
function parseLongDate(day, monthWord, year) {
  const m = MONTHS[String(monthWord).toLowerCase()];
  if (!m) return null;
  return `${year}-${pad(m)}-${pad(Number(day))}`;
}

/** "24.01.2026" → "2026-01-24" */
function parseDottedDate(s) {
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(String(s).trim());
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

/** "29/12/2025" or "07-10-2024" → ISO. Both separators occur in the archive. */
function parseRowDate(s) {
  const m = /^(\d{2})[/-](\d{2})[/-](\d{4})$/.exec(String(s).trim());
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

/**
 * The Subject line's date range, in the three shapes the statements use:
 *
 *   "for the week 29th December, 2025 to 04th January, 2026"   both spelled out
 *   "for the week 28th December to 03rd January, 2026"         year shared
 *   "for the week 22nd to 28th December, 2025"                 month and year shared
 *
 * Returns null when none of them match. That is not fatal — the week is taken
 * from the dated rows, and this only ever contradicts them or agrees.
 */
function parseSubjectSpan(text) {
  const d = String.raw`(\d{1,2})(?:st|nd|rd|th)?`;
  const shapes = [
    // 29th December, 2025 to 04th January, 2026
    [new RegExp(`for the week\\s+${d}\\s+([A-Za-z]+),?\\s+(\\d{4})\\s+to\\s+${d}\\s+([A-Za-z]+),?\\s+(\\d{4})`, 'i'),
      (m) => ({ start: parseLongDate(m[1], m[2], m[3]), end: parseLongDate(m[4], m[5], m[6]) })],
    // 28th December to 03rd January, 2026
    [new RegExp(`for the week\\s+${d}\\s+([A-Za-z]+)\\s+to\\s+${d}\\s+([A-Za-z]+),?\\s+(\\d{4})`, 'i'),
      (m) => ({ start: parseLongDate(m[1], m[2], m[5]), end: parseLongDate(m[3], m[4], m[5]) })],
    // 22nd to 28th December, 2025
    [new RegExp(`for the week\\s+${d}\\s+to\\s+${d}\\s+([A-Za-z]+),?\\s+(\\d{4})`, 'i'),
      (m) => ({ start: parseLongDate(m[1], m[3], m[4]), end: parseLongDate(m[2], m[3], m[4]) })],
  ];
  for (const [re, build] of shapes) {
    const m = re.exec(text);
    if (m) {
      const span = build(m);
      if (span.start && span.end) return span;
    }
  }
  return null;
}

/**
 * Header fields. The Devanagari in this document comes through the font
 * encoding mangled, so every pattern here keys off the English text beside it.
 */
export function parseDsaHeader(text) {
  // "WEEK No. 40/ ...F.Y. 2025-26" on the originals, "Week No. 24 F.Y. 2021-22"
  // on the reissues — so no trailing punctuation can be relied on.
  const week = /WEEK\s*No\.?\s*(\d{1,2})\b/i.exec(text);
  const fy = /F\.?Y\.?\s*(\d{4})-(\d{2,4})/i.exec(text);
  const span = parseSubjectSpan(text);
  const issued = /Dated\s*:\s*(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+),?\s+(\d{4})/i.exec(text);
  const due = /Due Date of Payment[^:]*:\s*(?:On or before\s*:?\s*)?(\d{2}\.\d{2}\.\d{4})/i.exec(text);

  return {
    week_no: week ? Number(week[1]) : null,
    // "2025-26" — the financial year the week belongs to, not a calendar year.
    financial_year: fy ? `${fy[1]}-${fy[2].slice(-2)}` : null,
    // What the Subject line claims. Only a cross-check: the authority on the
    // week is the dated rows themselves, and parseDsaText uses those.
    subject_week_start: span?.start ?? null,
    subject_week_end: span?.end ?? null,
    issued_date: issued ? parseLongDate(issued[1], issued[2], issued[3]) : null,
    due_date: due ? parseDottedDate(due[1]) : null,
  };
}

// A daily row is a date followed by its figures; a Total row is the same
// without the date. Three shapes occur across the archive, and they are not
// interchangeable:
//
//   8 figures  SCHDL, ACTUAL, DEVI AMT, SUS DEVI, SUS AMOUNT, ADD DEVI,
//              ADJ ON A/C OF NUC.STN & IW, NET DEVI
//              — statements up to WK-27 of 2022-23, when the deviation
//                framework still carried sustained-deviation and additional
//                deviation charges.
//   5 figures  SCHDL, ACTUAL, DEVI AMT, ADJ ON A/C OF NUC.STN & IW, NET DEVI
//              — from WK-40 of 2022-23 onward, after those charges went. This
//                is the shape SJVN's stations are billed under today.
//   3 figures  SCHDL, ACTUAL, DEVI AMT
//              — the inter-regional exchanges (ER-NR, NER-NR, WR-NR) in every
//                era; they carry no nuclear-station adjustment and so print no
//                NET DEVI.
//
// Columns a shape does not carry are recorded as null rather than as zero.
// They are absent from the document, and a null says that, where a zero would
// claim the statement published one.
// Statements are inconsistent about the date separator — 29/12/2025 in most
// eras, 07-10-2024 in others — so both are accepted.
const DAY_ROW = /^(\d{2}[/-]\d{2}[/-]\d{4})((?:\s+-?[\d.]+)+)$/;
const TOTAL_ROW = /^Total((?:\s+-?[\d.]+)+)$/i;
const ENTITY_LINE = /^Entity\s*:\s*(.+?)\s*$/;

export const FIGURE_FIELDS = ['schedule_lu', 'actual_lu', 'devi_amt_lakh', 'sus_devi',
  'sus_amount_lakh', 'add_devi_lakh', 'adj_lakh', 'net_devi_lakh'];

const numberOf = (s) => {
  const n = Number(s);
  if (!Number.isFinite(n)) throw new Error(`Not a number in a DSA row: ${JSON.stringify(s)}`);
  return n;
};

/**
 * Turn the trailing run of figures into named columns, or return null if the
 * count is one this statement is not known to use — an unrecognised shape must
 * not be guessed at.
 */
function cols(figuresText) {
  const f = figuresText.trim().split(/\s+/).map(numberOf);
  const row = (o) => ({
    schedule_lu: null, actual_lu: null, devi_amt_lakh: null, sus_devi: null,
    sus_amount_lakh: null, add_devi_lakh: null, adj_lakh: null, net_devi_lakh: null, ...o,
  });
  if (f.length === 8) {
    return row({
      schedule_lu: f[0], actual_lu: f[1], devi_amt_lakh: f[2], sus_devi: f[3],
      sus_amount_lakh: f[4], add_devi_lakh: f[5], adj_lakh: f[6], net_devi_lakh: f[7],
    });
  }
  if (f.length === 5) {
    return row({
      schedule_lu: f[0], actual_lu: f[1], devi_amt_lakh: f[2], adj_lakh: f[3], net_devi_lakh: f[4],
    });
  }
  if (f.length === 4) {
    // The inter-regional sections of the older statements: their daily rows
    // print three figures, but the Total adds the week's sustained-deviation
    // count beside them.
    return row({ schedule_lu: f[0], actual_lu: f[1], devi_amt_lakh: f[2], sus_devi: f[3] });
  }
  if (f.length === 3) {
    return row({ schedule_lu: f[0], actual_lu: f[1], devi_amt_lakh: f[2] });
  }
  return null;
}

/**
 * The figure that actually settles for a row: NET DEVI where the statement
 * prints one, otherwise DEVI AMT. Still in Rs Lakh, still the document's sign
 * (positive = payable to the pool).
 */
export function settledLakh(row) {
  return row.net_devi_lakh ?? row.devi_amt_lakh;
}

/**
 * Rounding tolerance when checking a section's daily rows against the Total
 * the document prints for it. The figures carry five decimals and a week is
 * seven of them, so anything past the sixth decimal is the document's own
 * rounding; a real parse error is orders of magnitude larger than this.
 */
const TOTAL_TOLERANCE = 1e-5;

/**
 * Split the statement into per-entity sections.
 *
 * Each section's daily rows are checked against the Total line the document
 * prints beneath them. A section whose rows do not add up is reported rather
 * than returned, because a silently half-parsed entity is exactly the kind of
 * thing that reaches a bill.
 */
export function parseDsaEntities(text) {
  const lines = String(text).split('\n').map((l) => l.trim()).filter(Boolean);
  const entities = [];
  const problems = [];
  let current = null;

  const closeCurrent = () => {
    if (!current) return;
    if (!current.days.length) {
      problems.push(`Entity "${current.entity_name}" has no daily rows`);
    } else if (!current.total) {
      problems.push(`Entity "${current.entity_name}" has no Total line`);
    } else {
      for (const field of FIGURE_FIELDS) {
        const printed = current.total[field];
        // A column the statement does not publish for this entity is checked
        // only for agreement about its absence.
        if (printed == null) {
          if (current.days.some((d) => d[field] != null)) {
            problems.push(
              `Entity "${current.entity_name}": daily rows carry ${field} but the Total line does not`,
            );
          }
          continue;
        }
        const missing = current.days.filter((d) => d[field] == null).length;
        if (missing === current.days.length) {
          // Published only at week level — the sustained-deviation count of the
          // older inter-regional sections does this. Nothing to reconcile
          // against, so the Total stands as the statement gives it.
          continue;
        }
        if (missing) {
          problems.push(
            `Entity "${current.entity_name}": the Total line carries ${field} but ${missing} of `
            + `${current.days.length} daily rows do not`,
          );
          continue;
        }
        const summed = current.days.reduce((a, d) => a + d[field], 0);
        if (Math.abs(summed - printed) > TOTAL_TOLERANCE) {
          problems.push(
            `Entity "${current.entity_name}": ${field} daily rows sum to ${summed.toFixed(5)} `
            + `but the statement's Total says ${printed.toFixed(5)}`,
          );
        }
      }
    }
    entities.push(current);
    current = null;
  };

  for (const line of lines) {
    const ent = ENTITY_LINE.exec(line);
    if (ent) {
      closeCurrent();
      current = { entity_name: ent[1], days: [], total: null };
      continue;
    }
    if (!current) continue;

    const day = DAY_ROW.exec(line);
    if (day) {
      const c = cols(day[2]);
      if (!c) {
        problems.push(
          `Entity "${current.entity_name}": row dated ${day[1]} has an unrecognised `
          + `number of figures — the statement layout may have changed`,
        );
        continue;
      }
      current.days.push({ entry_date: parseRowDate(day[1]), ...c });
      continue;
    }
    const tot = TOTAL_ROW.exec(line);
    if (tot) {
      const c = cols(tot[1]);
      if (!c) {
        problems.push(
          `Entity "${current.entity_name}": Total line has an unrecognised number of figures`,
        );
        continue;
      }
      current.total = c;
      closeCurrent();
    }
  }
  closeCurrent();

  return { entities, problems };
}

/**
 * Parse a full statement.
 *
 * Returns `{ header, entities, problems }`. `problems` being non-empty does not
 * throw — the caller decides, and the importer refuses to store a statement
 * that has any.
 */
export function parseDsaText(text) {
  const header = parseDsaHeader(text);
  const { entities, problems } = parseDsaEntities(text);

  const headerProblems = [];
  const headerWarnings = [];
  // Reissues are often published as data only — the tables and a per-page
  // banner, with no covering letter — and a covering letter is the only place
  // the week number and financial year appear. Their absence is therefore
  // normal for a revision, and the importer supplies them from the week code
  // or from the original statement for the same span.
  if (header.week_no == null) headerWarnings.push('The statement does not state a week number');
  if (!header.financial_year) headerWarnings.push('The statement does not state a financial year');
  if (!entities.length) headerProblems.push('No "Entity :" sections found — is this a DSA statement?');

  // The week is taken from the dated rows, not from the Subject line. The rows
  // are the data; the Subject line is prose, and it comes in three different
  // shapes depending on whether the week crosses a month or a year boundary.
  const dates = entities.flatMap((e) => e.days.map((d) => d.entry_date)).filter(Boolean).sort();
  const week_start = dates[0] ?? null;
  const week_end = dates[dates.length - 1] ?? null;
  if (!week_start) headerProblems.push('No dated rows found, so the statement week cannot be established');

  // A deviation statement covers exactly one week. More than seven distinct
  // dates means two statements have been read as one.
  const distinctDates = new Set(dates);
  if (distinctDates.size > 7) {
    headerProblems.push(
      `Rows span ${distinctDates.size} distinct dates (${week_start}..${week_end}); a weekly statement should cover at most 7`,
    );
  }

  // Every entity should report the same days. One that does not has either been
  // half-read or genuinely differs, and both are worth stopping for.
  for (const e of entities) {
    if (e.days.length && e.days.length !== distinctDates.size) {
      headerProblems.push(
        `Entity "${e.entity_name}" has ${e.days.length} dated rows where the statement covers ${distinctDates.size} days`,
      );
    }
  }

  // Cross-check against the Subject line where it could be read at all.
  //
  // A disagreement here is a warning, not a problem. Some statements genuinely
  // misdescribe their own week in the Subject prose — WK-11 of 2021-22 says it
  // runs to the 14th of June while carrying rows only to the 13th — and since
  // every figure we store is keyed to a dated row, a wrong Subject line changes
  // nothing we keep. Worth surfacing, not worth refusing the week over.
  const warnings = [...headerWarnings];
  if (header.subject_week_start && week_start
      && (header.subject_week_start !== week_start || header.subject_week_end !== week_end)) {
    warnings.push(
      `The Subject line says the week is ${header.subject_week_start}..${header.subject_week_end}, `
      + `but the dated rows run ${week_start}..${week_end}; the rows have been taken as authoritative`,
    );
  }

  return {
    header: { ...header, week_start, week_end },
    entities,
    problems: [...headerProblems, ...problems],
    warnings,
  };
}

/** Parse a DSA PDF buffer. Kept separate so the text parser stays testable. */
export async function parseDsaPdf(buffer) {
  const { PDFParse } = await import('pdf-parse');
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    const { text } = await parser.getText();
    return parseDsaText(text);
  } finally {
    await parser.destroy?.();
  }
}

// ── Crossing into the platform's own units and sign ─────────────────────────
//
// Everything above keeps the statement's figures as published. These three are
// the only place that changes, and they exist so that the conversion happens
// once, in the open, with a test on it — rather than being spread through a
// route as a couple of unremarked multiplications.

/** 1 Lakh Unit = 100,000 kWh = 100 MWh. */
export const MWH_PER_LU = 100;

/** 1 Rs Lakh = 100,000 rupees. */
export const RUPEES_PER_LAKH = 100_000;

export function luToMwh(lu) {
  return lu == null ? null : Math.round(Number(lu) * MWH_PER_LU * 1000) / 1000;
}

/**
 * The statement's settled figure, in rupees, under the sign convention that
 * `deviation_settlements` uses.
 *
 * The two conventions are opposites, and this is the line that reconciles them:
 *
 *   NRPC statement           "Deviation Amount ... to be Paid (+) / Received (-)"
 *   deviation_settlements    "+ recoverable / − payable"
 *
 * So a statement figure of −8.37312 Rs Lakh for Nathpa Jhakri — money SJVN
 * receives — becomes +837,312 rupees recoverable. Getting this backwards turns
 * every receipt into a payable and vice versa, which on one week of one station
 * is a ₹16.7 lakh error in the wrong direction, so it is negated exactly here
 * and nowhere else.
 */
export function settlementRupees(row) {
  const lakh = settledLakh(row);
  return lakh == null ? null : -Math.round(Number(lakh) * RUPEES_PER_LAKH);
}
