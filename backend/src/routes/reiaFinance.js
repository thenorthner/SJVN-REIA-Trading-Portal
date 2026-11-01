import { Router } from 'express';
import { requireAuth, requireRole, ROLE_GROUPS } from '../middleware/auth.js';
import { secureLogAudit } from '../auditEngine.js';
import { postingChecklist } from '../services/monthClose.js';
import {
  CATEGORIES, CATEGORY_LABELS, bookableDocuments, totalsOf,
  preparePosting, postToFinance, reversePosting, getPosting, listPostings,
} from '../services/reiaFiPosting.js';
import { ping as sapPing } from '../services/sapOdata.js';
import { pushPosting, checkPosting, listPushes } from '../services/reiaSapPush.js';

// REIA's month-end handover to corporate Finance. The hydro equivalent lives at
// /hydro-billing/fi; the rules are the same, see services/reiaFiPosting.js.

const router = Router();
router.use(requireAuth);

const READ = [...new Set([...ROLE_GROUPS.REIA_ALL, ...ROLE_GROUPS.FINANCE, 'COMPLIANCE_AUDITOR'])];
// REIA hands the month over and records the voucher Finance returns; Finance
// reads (tests/reiaFiPosting.test.js holds this as the design).
// Phase B.2: the maker prepares a posting; posting it to the ledger, or reversing it, is the checker's.
const WRITE = [...ROLE_GROUPS.REIA_MAKE];
const POST = [...ROLE_GROUPS.REIA_CHECK];
// Reading back from SAP: the REIA desk, maker or checker.
const SAP_DESK = [...ROLE_GROUPS.REIA_WRITE];

const month = (v) => (/^\d{4}-\d{2}$/.test(String(v || '')) ? String(v) : null);
const fail = (res, err) => res.status(err.status || 400).json({ error: err.message });

// GET /reia-fi?period_month=&category=&status=
router.get('/', requireRole(...READ), (req, res) => {
  const { period_month, category, status } = req.query;
  res.json({
    categories: CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABELS[c] })),
    postings: listPostings({
      periodMonth: month(period_month),
      category: category || null,
      status: status || null,
    }),
  });
});

// GET /reia-fi/bookable — what a month would post, before preparing it.
router.get('/bookable', requireRole(...READ), (req, res) => {
  const m = month(req.query.period_month);
  if (!m) return res.status(400).json({ error: 'period_month must be YYYY-MM' });
  const category = req.query.category || 'SALE';
  try {
    const docs = bookableDocuments(m, category);
    res.json({ period_month: m, category, documents: docs, totals: totalsOf(docs) });
  } catch (err) {
    fail(res, err);
  }
});

// GET /reia-fi/:postingId
// L2: the open items for a month, to see before it is booked.
router.get('/checklist', requireRole(...READ), (req, res) => {
  const period = String(req.query.period_month || '');
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) return res.status(400).json({ error: 'period_month must be YYYY-MM' });
  res.json(postingChecklist(period));
});

// GET /reia-fi/sap/health — can this server reach the SAP service? Reads only.
router.get('/sap/health', requireRole(...READ), async (req, res) => {
  try {
    res.json(await sapPing());
  } catch (err) {
    fail(res, err);
  }
});

// GET /reia-fi/:postingId/sap — what was sent to SAP, as last recorded here.
router.get('/:postingId/sap', requireRole(...READ), (req, res) => {
  res.json({ pushes: listPushes(req.params.postingId) });
});

// POST /reia-fi/:postingId/sap-push — send the posting's invoices to SAP.
// The checker's step, in place of typing Finance's voucher (see reiaSapPush.js).
router.post('/:postingId/sap-push', requireRole(...POST), async (req, res) => {
  try {
    const result = await pushPosting(req.params.postingId, {
      pushedBy: req.user?.name || req.user?.email || null,
      pushedById: req.user?.id || null,
    });
    secureLogAudit(req, {
      action: 'REIA_FI_SAP_PUSH',
      module: 'REIA',
      entityType: 'reia_fi_postings',
      entityId: req.params.postingId,
      afterValue: {
        posting_no: result.posting_no, timestamp: result.timestamp,
        sent: result.sent, failed: result.failed, unknown: result.unknown,
        belnr: result.results.map((r) => `${r.doc_no}=${r.belnr}:${r.status}`),
      },
    });
    res.json(result);
  } catch (err) {
    fail(res, err);
  }
});

// POST /reia-fi/:postingId/sap-check — ask SAP what became of what was sent.
// It records SAP's answer and decides nothing, so maker and checker both may.
router.post('/:postingId/sap-check', requireRole(...SAP_DESK), async (req, res) => {
  try {
    res.json({ pushes: await checkPosting(req.params.postingId) });
  } catch (err) {
    fail(res, err);
  }
});

router.get('/:postingId', requireRole(...READ), (req, res) => {
  const p = getPosting(req.params.postingId);
  if (!p) return res.status(404).json({ error: 'Posting not found' });
  res.json(p);
});

// POST /reia-fi/prepare — gather the month, change nothing yet.
router.post('/prepare', requireRole(...WRITE), (req, res) => {
  const m = month(req.body.period_month);
  if (!m) return res.status(400).json({ error: 'period_month must be YYYY-MM' });
  try {
    const posting = preparePosting({
      periodMonth: m,
      category: req.body.category || 'SALE',
      notes: req.body.notes || null,
      createdBy: req.user?.id || null,
    });
    secureLogAudit(req, {
      action: 'REIA_FI_POSTING_PREPARED',
      module: 'REIA',
      entityType: 'reia_fi_postings',
      entityId: posting.id,
      afterValue: {
        posting_no: posting.posting_no, period_month: m, category: posting.category,
        docs: posting.docs_count, total_amount: posting.total_amount,
      },
    });
    res.json(posting);
  } catch (err) {
    fail(res, err);
  }
});

// POST /reia-fi/:postingId/post — book it in Finance.
router.post('/:postingId/post', requireRole(...POST), (req, res) => {
  try {
    const posting = postToFinance(req.params.postingId, {
      fiDocumentNo: req.body.fi_document_no || null,
      postedBy: req.user?.name || req.user?.email || null,
      postedById: req.user?.id || null,
    });
    secureLogAudit(req, {
      action: 'REIA_FI_POSTING_POSTED',
      module: 'REIA',
      entityType: 'reia_fi_postings',
      entityId: posting.id,
      afterValue: {
        posting_no: posting.posting_no, fi_document_no: posting.fi_document_no,
        total_amount: posting.total_amount,
      },
    });
    res.json(posting);
  } catch (err) {
    fail(res, err);
  }
});

// POST /reia-fi/:postingId/reverse — back a booked entry out.
router.post('/:postingId/reverse', requireRole(...POST), (req, res) => {
  try {
    const result = reversePosting(req.params.postingId, {
      reason: req.body.reason,
      reversedBy: req.user?.name || req.user?.email || null,
    });
    secureLogAudit(req, {
      action: 'REIA_FI_POSTING_REVERSED',
      module: 'REIA',
      entityType: 'reia_fi_postings',
      entityId: req.params.postingId,
      afterValue: result,
      reason: req.body.reason,
    });
    res.json(result);
  } catch (err) {
    fail(res, err);
  }
});

export default router;
