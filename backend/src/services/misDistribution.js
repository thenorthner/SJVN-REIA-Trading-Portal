/**
 * The monthly MIS pack, generated and mailed to the people entitled to it.
 *
 * What ran before sent one line of text to a hard-coded management@sjvn.local —
 * with no report attached — and then logged that the distribution had
 * "completed successfully". The scope asks for scheduled generation and
 * distribution of reports to authorized users, so this renders the same two
 * PDFs the dashboards offer for download, sends them to every active user in
 * the EXECUTIVE group (the audience the MIS pack is already restricted to), and
 * reports what it actually did, including when it did nothing.
 */
import { PassThrough } from 'stream';
import db from '../db/index.js';
import { ROLE_GROUPS } from '../middleware/auth.js';
import { sendMail } from './mailService.js';
import { secureLogAudit } from '../auditEngine.js';
import { buildMisSummary, buildReiaDashboardSummary } from '../routes/reports.js';
import { generateMisReportPdf } from '../scripts/governanceReportsPdf.js';
import { generateReiaDashboardPdf } from '../scripts/reiaDashboardReportPdf.js';

/**
 * Render a report generator into memory rather than into an HTTP response.
 * The generators set download headers on the response they are given, which a
 * plain stream does not have, so those calls are absorbed here.
 */
export function renderPdf(render) {
  return new Promise((resolve, reject) => {
    const sink = new PassThrough();
    sink.setHeader = () => {};
    const chunks = [];
    sink.on('data', (c) => chunks.push(c));
    sink.on('end', () => resolve(Buffer.concat(chunks)));
    sink.on('error', reject);
    try { render(sink); } catch (err) { reject(err); }
  });
}

/** Active executive-group users with an email address, each once. */
export function misRecipients() {
  const roles = ROLE_GROUPS.EXECUTIVE;
  return db.prepare(`
    SELECT DISTINCT email FROM users
    WHERE is_active = 1 AND email IS NOT NULL AND TRIM(email) <> ''
      AND role IN (${roles.map(() => '?').join(',')})
    ORDER BY email
  `).all(...roles).map((r) => r.email);
}

/** The month that has just closed when the pack goes out on the 1st. */
function closedMonth(now) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return {
    ym: d.toISOString().slice(0, 7),
    label: d.toLocaleString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
  };
}

export async function distributeMonthlyMis({ now = new Date(), send = sendMail } = {}) {
  const { ym, label } = closedMonth(now);
  const to = misRecipients();
  if (!to.length) {
    return { sent: false, period: ym, reason: 'no active executive user has an email address' };
  }

  const meta = { generatedBy: 'Scheduled MIS distribution' };
  const attachments = [
    {
      filename: `SJVN_MIS_${ym}.pdf`,
      contentType: 'application/pdf',
      content: await renderPdf((out) => generateMisReportPdf(buildMisSummary(), meta, out)),
    },
    {
      filename: `SJVN_REIA_Dashboard_${ym}.pdf`,
      contentType: 'application/pdf',
      content: await renderPdf((out) => generateReiaDashboardPdf(buildReiaDashboardSummary(), meta, out)),
    },
  ];

  const result = await send({
    to,
    subject: `SJVN monthly MIS — ${label}`,
    text: `The monthly MIS pack as at the close of ${label} is attached: the internal MIS report `
      + '(REIA and Power Trading) and the REIA billing & settlement dashboard. The same figures are live '
      + 'on the Consolidated Dashboard.',
    attachments,
  });

  const names = attachments.map((a) => a.filename);
  secureLogAudit(null, {
    action: 'DISTRIBUTE_MIS',
    module: 'MIS',
    entityType: 'report',
    entityId: ym,
    details: { recipients: to.length, attachments: names, mode: result?.mode || null, ok: !!result?.ok },
  });

  return result?.ok
    ? { sent: true, period: ym, recipients: to.length, attachments: names, mode: result.mode }
    : { sent: false, period: ym, recipients: to.length, attachments: names, mode: result?.mode, error: result?.error || 'send failed' };
}
