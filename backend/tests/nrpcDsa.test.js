/**
 * Parser tests for the NRPC weekly Deviation Settlement Account.
 *
 * Fixtures are text rather than PDFs on purpose: parseDsaPdf only turns a
 * buffer into text and hands it here, and keeping several megabytes of
 * government PDFs in the repository to exercise a regex would not be worth it.
 * The shapes below are transcribed from real statements across the archive.
 */

import { describe, it, expect } from 'vitest';
import {
  parseDsaText, parseDsaHeader, settledLakh, luToMwh, settlementRupees,
} from '../src/services/nrpcDsa.js';

// Header as the current statements print it, with the week crossing a month.
const HEADER_2025 = `
Government of India
Northern Regional Power Committee
Dated:14th January, 2026
(Due Date of Payment: On or before:24.01.2026)
Subject: Statement of charges for deviation for the week 29th December, 2025 to 04th
January, 2026
(WEEK No. 40/ F.Y. 2025-26.)
Details of Deviation Amount (in Rs Lakh) to be Paid (+) / Received (-) by
`;

// Five figures: the shape in force since WK-40 of 2022-23.
const NJHPS_5COL = `Entity : NATHPA JHAKRI HEP
DATE SCHDL(LU) ACTUAL(LU) DEVI AMT ADJ ON A/C OF NUC.STN & IW NET DEVI
29/12/2025 74.30000 74.26546 -1.19868 0.00000 -1.19868
30/12/2025 73.10000 74.70873 -1.68593 0.00000 -1.68593
31/12/2025 74.98750 75.90364 -1.38234 0.00000 -1.38234
01/01/2026 70.70000 71.36546 -0.53580 0.00000 -0.53580
02/01/2026 74.35000 75.36254 -1.52326 0.00000 -1.52326
03/01/2026 74.63250 75.36000 -0.81732 0.00000 -0.81732
04/01/2026 69.00000 70.23891 -1.22979 0.00000 -1.22979
Total 511.07000 517.20474 -8.37312 0.00000 -8.37312`;

// Three figures, with the Total adding a week-level sustained-deviation count:
// the inter-regional exchanges of the older statements.
const ERNR_3COL = `Entity : ER-NR
DATE SCHDL(LU) ACTUAL(LU) DEVI AMT SUS DEVI
29/12/2025 845.82782 919.62217 -252.19235
30/12/2025 886.98530 1013.47021 -263.55928
31/12/2025 936.36210 1051.94590 -220.55919
01/01/2026 929.58605 916.01850 284.78973
02/01/2026 966.77172 900.06124 547.70215
03/01/2026 952.21458 798.15622 1020.84898
04/01/2026 931.59860 760.18157 617.40812
Total 6449.34617 6359.45581 1734.43816 0`;

describe('parseDsaHeader', () => {
  it('reads week, financial year, issue and due dates', () => {
    const h = parseDsaHeader(HEADER_2025);
    expect(h.week_no).toBe(40);
    expect(h.financial_year).toBe('2025-26');
    expect(h.issued_date).toBe('2026-01-14');
    expect(h.due_date).toBe('2026-01-24');
  });

  it('reads the reissue wording, where no slash follows the week number', () => {
    const h = parseDsaHeader('Deviation Settlement Account for the week 06th to 12th September 2021. Week No. 24\nF.Y. 2021-22.)');
    expect(h.week_no).toBe(24);
    expect(h.financial_year).toBe('2021-22');
  });

  it.each([
    ['both months spelled out', 'for the week 29th December, 2025 to 04th January, 2026', '2025-12-29', '2026-01-04'],
    ['year shared', 'for the week 28th December to 03rd January, 2026', '2026-12-28', '2026-01-03'],
    ['month and year shared', 'for the week 22nd to 28th December, 2025', '2025-12-22', '2025-12-28'],
  ])('reads the Subject span when %s', (_label, line, start, end) => {
    const h = parseDsaHeader(line);
    expect(h.subject_week_start).toBe(start);
    expect(h.subject_week_end).toBe(end);
  });
});

describe('parseDsaText — figure shapes', () => {
  it('parses the five-figure shape and reconciles it against the printed Total', () => {
    const r = parseDsaText(`${HEADER_2025}\n${NJHPS_5COL}`);
    expect(r.problems).toEqual([]);
    const e = r.entities[0];
    expect(e.entity_name).toBe('NATHPA JHAKRI HEP');
    expect(e.days).toHaveLength(7);
    expect(e.days[0]).toMatchObject({
      entry_date: '2025-12-29', schedule_lu: 74.3, actual_lu: 74.26546, net_devi_lakh: -1.19868,
    });
    // Columns this era does not publish are absent, not zero.
    expect(e.days[0].sus_devi).toBeNull();
    expect(e.days[0].add_devi_lakh).toBeNull();
    expect(e.total.net_devi_lakh).toBeCloseTo(-8.37312, 5);
  });

  it('parses the eight-figure shape used before the 2022 regulations', () => {
    const text = `${HEADER_2025}
Entity : CHANDIGARH
DATE SCHDL(LU) ACTUAL(LU) DEVI AMT SUS DEVI SUS AMOUNT ADD DEVI ADJ ON A/C OF NUC.STN & IW NET DEVI
29/12/2025 35.32857 35.04482 -2.35365 0 0.00000 1.66704 0.45798 -0.22863
30/12/2025 35.28823 36.09348 1.38116 1 0.04143 0.27373 0.59814 2.29446
Total 70.61680 71.13830 -0.97249 1 0.04143 1.94077 1.05612 2.06583`;
    const r = parseDsaText(text);
    expect(r.problems).toEqual([]);
    expect(r.entities[0].days[1]).toMatchObject({
      sus_devi: 1, sus_amount_lakh: 0.04143, add_devi_lakh: 0.27373, net_devi_lakh: 2.29446,
    });
  });

  it('parses the three-figure inter-regional shape, leaving ADJ and NET DEVI null', () => {
    const r = parseDsaText(`${HEADER_2025}\n${ERNR_3COL}`);
    expect(r.problems).toEqual([]);
    const e = r.entities[0];
    expect(e.days[0].devi_amt_lakh).toBeCloseTo(-252.19235, 5);
    expect(e.days[0].adj_lakh).toBeNull();
    expect(e.days[0].net_devi_lakh).toBeNull();
    // A column the statement publishes only at week level is kept, not
    // reconciled against rows that never carried it.
    expect(e.total.sus_devi).toBe(0);
  });
});

describe('settledLakh', () => {
  it('uses NET DEVI where the statement prints one', () => {
    const r = parseDsaText(`${HEADER_2025}\n${NJHPS_5COL}`);
    expect(settledLakh(r.entities[0].total)).toBeCloseTo(-8.37312, 5);
  });

  it('falls back to DEVI AMT for the inter-regional sections', () => {
    const r = parseDsaText(`${HEADER_2025}\n${ERNR_3COL}`);
    expect(settledLakh(r.entities[0].total)).toBeCloseTo(1734.43816, 5);
  });

  it('keeps the statement sign, where positive means payable to the pool', () => {
    // The document header reads "to be Paid (+) / Received (-)". Nathpa Jhakri
    // is negative for this week, so SJVN receives. Nothing in the parser flips
    // this to deviation_settlements' opposite convention.
    const r = parseDsaText(`${HEADER_2025}\n${NJHPS_5COL}`);
    expect(settledLakh(r.entities[0].total)).toBeLessThan(0);
  });
});

describe('parseDsaText — integrity checks', () => {
  it('refuses a section whose rows do not add up to its printed Total', () => {
    const broken = NJHPS_5COL.replace(
      'Total 511.07000 517.20474 -8.37312 0.00000 -8.37312',
      'Total 511.07000 517.20474 -9.99999 0.00000 -9.99999',
    );
    const r = parseDsaText(`${HEADER_2025}\n${broken}`);
    expect(r.problems.join(' ')).toMatch(/devi_amt_lakh daily rows sum to/);
  });

  it('takes the week from the dated rows, not from the Subject line', () => {
    const r = parseDsaText(`${HEADER_2025}\n${NJHPS_5COL}`);
    expect(r.header.week_start).toBe('2025-12-29');
    expect(r.header.week_end).toBe('2026-01-04');
  });

  it('warns, but does not refuse, when the Subject line misstates its own week', () => {
    // WK-11 of 2021-22 does exactly this: the prose says the week runs to the
    // 14th while the statement carries rows only to the 13th.
    const shifted = HEADER_2025.replace('04th\nJanuary, 2026', '05th\nJanuary, 2026');
    const r = parseDsaText(`${shifted}\n${NJHPS_5COL}`);
    expect(r.problems).toEqual([]);
    expect(r.warnings.join(' ')).toMatch(/Subject line says the week is/);
    expect(r.header.week_end).toBe('2026-01-04');
  });

  it('refuses rows carrying an unrecognised number of figures', () => {
    const r = parseDsaText(`${HEADER_2025}
Entity : ODD ONE
DATE SCHDL(LU) ACTUAL(LU)
29/12/2025 1.00000 2.00000
Total 1.00000 2.00000`);
    expect(r.problems.join(' ')).toMatch(/unrecognised/);
  });

  it('refuses a file covering more than one week', () => {
    const second = NJHPS_5COL
      .replace('Entity : NATHPA JHAKRI HEP', 'Entity : RAMPUR HEP')
      .replace(/(\d{2})\/12\/2025/g, '$1/11/2025')
      .replace(/(\d{2})\/01\/2026/g, '$1/12/2025');
    const r = parseDsaText(`${HEADER_2025}\n${NJHPS_5COL}\n${second}`);
    expect(r.problems.join(' ')).toMatch(/distinct dates/);
  });

  it('refuses a statement with no entity sections', () => {
    const r = parseDsaText(HEADER_2025);
    expect(r.problems.join(' ')).toMatch(/No "Entity :" sections found/);
  });

  it('refuses an entity whose rows are missing a column its Total carries', () => {
    const r = parseDsaText(`${HEADER_2025}
Entity : HALF READ
DATE SCHDL(LU) ACTUAL(LU) DEVI AMT ADJ ON A/C OF NUC.STN & IW NET DEVI
29/12/2025 1.00000 2.00000 3.00000 0.00000 3.00000
30/12/2025 1.00000 2.00000 3.00000
Total 2.00000 4.00000 6.00000 0.00000 6.00000`);
    expect(r.problems.join(' ')).toMatch(/but 1 of 2 daily rows do not/);
  });
});

describe('crossing into the platform units and sign', () => {
  it('converts Lakh Units to MWh', () => {
    expect(luToMwh(511.07)).toBe(51107);
    expect(luToMwh(74.26546)).toBe(7426.546);
    expect(luToMwh(null)).toBeNull();
  });

  it('flips the sign, because the two conventions are opposites', () => {
    // Nathpa Jhakri, WK-40 of 2025-26: the statement prints -8.37312 Rs Lakh,
    // and its header defines negative as money received. Under
    // deviation_settlements' convention that is positive — recoverable.
    expect(settlementRupees({ net_devi_lakh: -8.37312, devi_amt_lakh: -8.37312 })).toBe(837312);
  });

  it('turns a statement positive into a payable', () => {
    // SJVN Green Energy, same week: +28.56544 Rs Lakh, i.e. payable to the pool.
    expect(settlementRupees({ net_devi_lakh: 28.56544, devi_amt_lakh: 28.56544 })).toBe(-2856544);
  });

  it('settles on DEVI AMT where the statement prints no NET DEVI', () => {
    expect(settlementRupees({ net_devi_lakh: null, devi_amt_lakh: 1734.43816 })).toBe(-173443816);
  });

  it('agrees with what the parser read off a real week', () => {
    const r = parseDsaText(`${HEADER_2025}\n${NJHPS_5COL}`);
    expect(settlementRupees(r.entities[0].total)).toBe(837312);
    expect(luToMwh(r.entities[0].total.schedule_lu)).toBe(51107);
  });
});
