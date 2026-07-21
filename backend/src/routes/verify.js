import { Router } from 'express';
import db from '../db/index.js';
import { verifyInvoiceToken } from '../util.js';

const router = Router();

const NAVY = '#1b3b6f';

function esc(v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function fmtMoney(n) {
  if (n == null || n === '' || Number.isNaN(Number(n))) return '-';
  return 'Rs. ' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(d) {
  if (!d) return '-';
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return String(d);
  const dd = String(dt.getDate()).padStart(2, '0');
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  return `${dd}.${mm}.${dt.getFullYear()}`;
}

function page({ title, bodyHtml }) {
  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${esc(title)}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin:0; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; background:#eef2f8; color:#1a1a1a; }
  .wrap { max-width:520px; margin:0 auto; padding:20px 16px 40px; }
  .card { background:#fff; border:1px solid #d7dfec; border-radius:14px; overflow:hidden; box-shadow:0 6px 24px rgba(27,59,111,.08); }
  .bar { background:${NAVY}; color:#fff; padding:18px 20px; }
  .bar h1 { margin:0; font-size:17px; letter-spacing:.3px; }
  .bar p { margin:4px 0 0; font-size:12px; opacity:.85; }
  .status { display:flex; align-items:center; gap:10px; padding:16px 20px; font-weight:700; font-size:15px; }
  .ok { background:#e9f7ef; color:#1e7d46; }
  .bad { background:#fdecec; color:#b3261e; }
  .dot { width:26px; height:26px; border-radius:50%; display:grid; place-items:center; color:#fff; font-size:15px; }
  .ok .dot { background:#1e7d46; } .bad .dot { background:#b3261e; }
  table { width:100%; border-collapse:collapse; }
  td { padding:11px 20px; font-size:13.5px; border-top:1px solid #eef1f6; vertical-align:top; }
  td.k { color:#64748b; width:42%; }
  td.v { font-weight:600; text-align:right; }
  .amt { font-size:18px; color:${NAVY}; }
  .foot { padding:16px 20px; font-size:11px; color:#8a97ab; text-align:center; }
  .badge { display:inline-block; padding:2px 9px; border-radius:20px; font-size:11px; font-weight:700; background:#eef2f8; color:${NAVY}; }
</style></head><body><div class="wrap">${bodyHtml}
<div class="foot">Verified against the live SJVN RE Commercial &amp; Trading Platform record.<br/>This page confirms authenticity of the printed / PDF bill via its QR code.</div>
</div></body></html>`;
}

function notGenuine(res, msg) {
  const body = `<div class="card">
    <div class="bar"><h1>Document Verification</h1><p>SJVN RE Commercial &amp; Trading Platform</p></div>
    <div class="status bad"><span class="dot">!</span><span>${esc(msg)}</span></div>
  </div>`;
  res.status(200).type('html').send(page({ title: 'Verification failed', bodyHtml: body }));
}

// GET /verify/:id?sig=<token>  — public authenticity page (no login)
router.get('/:id', (req, res) => {
  const { id } = req.params;
  const { sig } = req.query;

  if (!verifyInvoiceToken(id, sig)) {
    return notGenuine(res, 'This QR code could not be verified. The link may be altered or invalid.');
  }

  const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(id);
  if (!inv) {
    return notGenuine(res, 'No matching bill was found in the platform records.');
  }

  const contract = db.prepare('SELECT * FROM contracts WHERE id = ?').get(inv.contract_id) || {};
  const seller = contract.seller_id ? db.prepare('SELECT name FROM entities WHERE id = ?').get(contract.seller_id) : null;
  const buyer = contract.buyer_id ? db.prepare('SELECT name FROM entities WHERE id = ?').get(contract.buyer_id) : null;

  const issuer = inv.direction === 'SJVN_TO_BUYER' ? (seller?.name || 'SJVN Limited') : (seller?.name || '-');
  const recipient = inv.direction === 'SJVN_TO_BUYER' ? (buyer?.name || '-') : (buyer?.name || 'SJVN Limited');

  const rows = [
    ['Invoice No', esc(inv.invoice_no)],
    ['Status', `<span class="badge">${esc(inv.status || 'DRAFT')}</span>`],
    ['Billing Period', esc(inv.billing_period)],
    ['Issued By', esc(issuer)],
    ['Billed To', esc(recipient)],
    ['Contract', esc(contract.contract_no || '-')],
    ['Invoice Date', esc(fmtDate(inv.created_at))],
    ['Due Date', esc(fmtDate(inv.due_date))],
    ['Total Amount', `<span class="amt">${esc(fmtMoney(inv.total_amount))}</span>`],
  ];
  if (inv.billing_family_ref) rows.push(['Billing Family Ref', esc(inv.billing_family_ref)]);

  const body = `<div class="card">
    <div class="bar"><h1>Genuine Energy Bill</h1><p>SJVN RE Commercial &amp; Trading Platform</p></div>
    <div class="status ok"><span class="dot">&#10003;</span><span>Verified &mdash; this bill matches the platform record</span></div>
    <table><tbody>
      ${rows.map(([k, v]) => `<tr><td class="k">${esc(k)}</td><td class="v">${v}</td></tr>`).join('')}
    </tbody></table>
  </div>`;

  res.type('html').send(page({ title: `Verify ${inv.invoice_no}`, bodyHtml: body }));
});

export default router;
