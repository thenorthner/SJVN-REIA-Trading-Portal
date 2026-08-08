/**
 * Invoice / notification email delivery via SMTP (nodemailer).
 * If SMTP is not configured, writes the PDF to backend/outbox/ so demos still work.
 */
import nodemailer from 'nodemailer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getParam } from '../mastersService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTBOX_DIR = path.join(process.cwd(), 'outbox');

function envOrParam(envKey, paramKey, fallback = '') {
  if (process.env[envKey]) return process.env[envKey];
  try {
    const v = getParam(paramKey, null);
    if (v != null && v !== '') return String(v);
  } catch { /* masters may not be ready */ }
  return fallback;
}

export function getMailConfig() {
  const host = envOrParam('SMTP_HOST', 'smtp_host', '');
  const port = Number(envOrParam('SMTP_PORT', 'smtp_port', '587')) || 587;
  const user = envOrParam('SMTP_USER', 'smtp_user', '');
  const pass = envOrParam('SMTP_PASS', 'smtp_pass', '');
  const from = envOrParam('SMTP_FROM', 'smtp_from', user || 'noreply@sjvn.local');
  const secure = String(envOrParam('SMTP_SECURE', 'smtp_secure', port === 465 ? 'true' : 'false')) === 'true';
  return {
    configured: !!host,
    host,
    port,
    user,
    pass,
    from,
    secure,
  };
}

function ensureOutbox() {
  if (!fs.existsSync(OUTBOX_DIR)) fs.mkdirSync(OUTBOX_DIR, { recursive: true });
  return OUTBOX_DIR;
}

/**
 * @param {{ to: string|string[], cc?: string|string[], subject: string, text: string, html?: string, attachments?: Array<{filename:string, content:Buffer, contentType?:string}> }} opts
 */
export async function sendMail(opts) {
  const cfg = getMailConfig();
  const toList = (Array.isArray(opts.to) ? opts.to : [opts.to]).filter(Boolean);
  if (!toList.length) {
    return { ok: false, mode: 'NONE', error: 'No recipient email address' };
  }

  // Real SMTP when host is set
  if (cfg.host) {
    const transport = nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.secure,
      auth: cfg.user ? { user: cfg.user, pass: cfg.pass } : undefined,
    });
    const info = await transport.sendMail({
      from: cfg.from,
      to: toList.join(', '),
      cc: opts.cc || undefined,
      subject: opts.subject,
      text: opts.text,
      html: opts.html || undefined,
      attachments: opts.attachments || [],
    });
    return {
      ok: true,
      mode: 'SMTP',
      messageId: info.messageId,
      accepted: info.accepted,
      rejected: info.rejected,
      to: toList,
    };
  }

  // Dev / demo fallback: write .eml-ish sidecar + PDF to outbox/
  const dir = ensureOutbox();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const safeSubject = String(opts.subject || 'mail').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 60);
  const base = path.join(dir, `${stamp}_${safeSubject}`);
  const metaPath = `${base}.json`;
  const pdfAtt = (opts.attachments || []).find((a) => a.content);
  let pdfPath = null;
  if (pdfAtt) {
    pdfPath = `${base}.pdf`;
    fs.writeFileSync(pdfPath, pdfAtt.content);
  }
  fs.writeFileSync(metaPath, JSON.stringify({
    at: new Date().toISOString(),
    mode: 'FILE_OUTBOX',
    from: cfg.from,
    to: toList,
    cc: opts.cc || null,
    subject: opts.subject,
    text: opts.text,
    pdf: pdfPath ? path.basename(pdfPath) : null,
  }, null, 2));

  return {
    ok: true,
    mode: 'FILE_OUTBOX',
    to: toList,
    outbox_dir: dir,
    meta_path: metaPath,
    pdf_path: pdfPath,
    note: 'SMTP not configured (set SMTP_HOST). PDF + metadata saved to backend/outbox/.',
  };
}

export function formatInvoiceEmail({ invoice, contract, recipientName, portalHint }) {
  const amt = Number(invoice.total_amount || 0).toLocaleString('en-IN');
  const due = invoice.due_date || 'as per payment terms';
  const subject = `Invoice ${invoice.invoice_no} — ${contract?.contract_no || ''} — ₹${amt}`;
  const text = [
    `Dear ${recipientName || 'Sir/Madam'},`,
    '',
    `Please find attached invoice ${invoice.invoice_no} for contract ${contract?.contract_no || 'N/A'}.`,
    `Billing period: ${invoice.billing_period}`,
    `Invoice type: ${invoice.invoice_type}`,
    `Amount payable: ₹${amt}`,
    `Due date: ${due}`,
    '',
    portalHint || 'You can also view and download this invoice from the SJVN Energy Platform portal.',
    '',
    'This is a system-generated email from the SJVN RE Commercial Billing Platform.',
    'Regards,',
    'SJVN Limited — Commercial & Billing',
  ].join('\n');

  const html = `
    <p>Dear ${recipientName || 'Sir/Madam'},</p>
    <p>Please find attached invoice <strong>${invoice.invoice_no}</strong> for contract <strong>${contract?.contract_no || 'N/A'}</strong>.</p>
    <ul>
      <li>Billing period: <strong>${invoice.billing_period}</strong></li>
      <li>Invoice type: <strong>${invoice.invoice_type}</strong></li>
      <li>Amount payable: <strong>₹${amt}</strong></li>
      <li>Due date: <strong>${due}</strong></li>
    </ul>
    <p>${portalHint || 'You can also view and download this invoice from the SJVN Energy Platform portal.'}</p>
    <p style="color:#64748b;font-size:12px">System-generated email — SJVN RE Commercial Billing Platform.</p>
  `;

  return { subject, text, html };
}
