import { Router } from 'express';
import db from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { buildBillingFamilyRef, directionForContract } from '../util.js';
import { contractVisibleTo, raisedBySeller } from '../services/counterpartyScope.js';
import { resolveBetaRow, computeBetaFromAnnualAfc, billedIncentiveTotal } from '../services/betaFactor.js';
import { resolveAnnualAfc } from '../services/cercHydroBilling.js';

const router = Router();
router.use(requireAuth);

function paidOnInvoices(invoiceIds) {
  if (!invoiceIds.length) return 0;
  const placeholders = invoiceIds.map(() => '?').join(',');
  const row = db.prepare(`
    SELECT COALESCE(SUM(amount + COALESCE(deduction, 0)), 0) AS paid
    FROM payments WHERE invoice_id IN (${placeholders})
  `).get(...invoiceIds);
  return row?.paid || 0;
}

// Energy lives on the PPA; a PSA's bill resolves to it through the allocation
// in force for the period — the same row billing reads — and failing that
// through any allocation the PSA has ever held.
function energySourceFor(contract, period) {
  if (contract.contract_type !== 'PSA') return { ids: [contract.id], unallocated: false };
  const start = `${period}-01`;
  const alloc = db.prepare(`
    SELECT ppa_id FROM contract_allocations
    WHERE psa_id = ? AND COALESCE(effective_from, '0000-01-01') <= ? AND COALESCE(effective_to, '9999-12-31') >= ?
    ORDER BY COALESCE(effective_from, '0000-01-01') DESC LIMIT 1
  `).get(contract.id, start, start)
    || db.prepare('SELECT ppa_id FROM contract_allocations WHERE psa_id = ? ORDER BY COALESCE(effective_from, \'0000-01-01\') DESC LIMIT 1').get(contract.id);
  return alloc?.ppa_id ? { ids: [alloc.ppa_id, contract.id], unallocated: false } : { ids: [contract.id], unallocated: true };
}

function buildTrail({ bfr, contract, period, direction, focus = null }) {
  const source = energySourceFor(contract, period);
  const contractIds = source.ids;
  const energyPlaceholders = contractIds.map(() => '?').join(',');

  const provisionalEnergy = db.prepare(`
    SELECT * FROM energy_data
    WHERE contract_id IN (${energyPlaceholders}) AND period_month = ? AND data_type = 'PROVISIONAL'
    -- Two sources can stand for one month. The one in force is the one that was
    -- locked — the oldest row was shown, which could be the figure validation threw out.
    ORDER BY (status = 'LOCKED') DESC, (status = 'VALIDATED') DESC, created_at DESC LIMIT 1
  `).get(...contractIds, period);

  const finalEnergy = db.prepare(`
    SELECT * FROM energy_data
    WHERE contract_id IN (${energyPlaceholders}) AND period_month = ? AND data_type = 'FINAL'
    ORDER BY (status = 'LOCKED') DESC, (status = 'VALIDATED') DESC, created_at DESC LIMIT 1
  `).get(...contractIds, period);

  const provisionalInvoices = db.prepare(`
    SELECT * FROM invoices
    WHERE contract_id = ? AND billing_period = ? AND direction = ?
      AND invoice_type = 'PROVISIONAL' AND status != 'CANCELLED'
    ORDER BY created_at ASC
  `).all(contract.id, period, direction);

  // Everything raised for the period after the provisional: the final bill,
  // and any supplementary or arrear that adjusts it.
  const finalInvoices = db.prepare(`
    SELECT * FROM invoices
    WHERE contract_id = ? AND billing_period = ? AND direction = ?
      AND invoice_type IN ('FINAL', 'SUPPLEMENTARY', 'ARREAR') AND status != 'CANCELLED'
    ORDER BY created_at ASC
  `).all(contract.id, period, direction);

  const provIds = provisionalInvoices.map((i) => i.id);
  const alreadyPaid = paidOnInvoices(provIds);
  const provisionalBilled = provisionalInvoices.reduce((s, i) => s + (i.total_amount || 0), 0);
  // What has been paid on the period as a whole. "Already paid" above is only
  // what was paid on provisional bills — the figure a final bill nets off — and
  // read as zero on a final bill that had been paid crores.
  const paidOnPeriod = paidOnInvoices([...provIds, ...finalInvoices.map((i) => i.id)]);
  const paidById = (id) => paidOnInvoices([id]);

  // The final bill itself. A supplementary or an arrear is an adjustment to
  // one; with no FINAL raised there is no "net due (final)" to state.
  //
  // On a PPA the family holds two kinds of bill for the same month: SJVN's own
  // computation and the invoice the seller raised. Taking whichever FINAL came
  // first gave SJVN's 3.65 crore bill a "net due (final)" of 36,494 — the
  // seller's. The trail is opened from a bill, so it speaks for that bill where
  // it is a FINAL, then for a FINAL from the same side; opened from the family
  // reference alone it speaks for SJVN's computation, which is what the
  // provisional-to-final true-up is worked on.
  const finals = finalInvoices.filter((i) => i.invoice_type === 'FINAL');
  const focusIsSellers = focus ? raisedBySeller(focus) : false;
  const primaryFinal = (focus && finals.find((i) => i.id === focus.id))
    || finals.find((i) => raisedBySeller(i) === focusIsSellers)
    || finals[0] || null;
  const tag = (i) => ({ ...i, paid_total: paidById(i.id), raised_by_seller: raisedBySeller(i) });

  const deltaMwh = (finalEnergy?.energy_mwh ?? null) != null && provisionalEnergy
    ? Math.round(((finalEnergy.energy_mwh || 0) - (provisionalEnergy.energy_mwh || 0)) * 100) / 100
    : null;

  const betaRow = resolveBetaRow(contract, period);
  let frequencyBeta = null;
  if (['Hydro', 'PSP'].includes(contract.project_type) || betaRow) {
    const calc = computeBetaFromAnnualAfc(
      resolveAnnualAfc(contract),
      betaRow?.beta_value,
      contract.project_type || 'Hydro',
    );
    const alreadyInc = billedIncentiveTotal(contract.id, period, direction);
    frequencyBeta = {
      ...(betaRow || {}),
      status: betaRow ? 'CERTIFIED' : 'PENDING',
      computed_incentive: calc.incentive,
      incentive_eligible: calc.eligible,
      incentive_reason: calc.reason,
      already_billed_incentive: alreadyInc,
      true_up_delta: Math.round((calc.incentive || 0) - alreadyInc),
    };
  }

  // Linked topology (PPA <-> SJVN HUB <-> PSA)
  let ppaContract = contract.contract_type === 'PPA' ? contract : null;
  let psaContract = contract.contract_type === 'PSA' ? contract : null;
  let allocationPercent = 100;

  if (contract.contract_type === 'PSA') {
    const alloc = db.prepare(`
      SELECT ca.*, p.contract_no, p.capacity_mw, p.tariff_per_unit, p.seller_id, p.project_type
      FROM contract_allocations ca
      JOIN contracts p ON p.id = ca.ppa_id
      WHERE ca.psa_id = ?
      ORDER BY COALESCE(ca.effective_from, '0000-01-01') DESC LIMIT 1
    `).get(contract.id);
    if (alloc) {
      allocationPercent = alloc.allocation_percent;
      ppaContract = db.prepare('SELECT * FROM contracts WHERE id = ?').get(alloc.ppa_id);
    }
  } else if (contract.contract_type === 'PPA') {
    const alloc = db.prepare(`
      SELECT ca.*, s.contract_no, s.capacity_mw, s.tariff_per_unit, s.buyer_id, s.project_type
      FROM contract_allocations ca
      JOIN contracts s ON s.id = ca.psa_id
      WHERE ca.ppa_id = ?
      ORDER BY COALESCE(ca.effective_from, '0000-01-01') DESC LIMIT 1
    `).get(contract.id);
    if (alloc) {
      allocationPercent = alloc.allocation_percent;
      psaContract = db.prepare('SELECT * FROM contracts WHERE id = ?').get(alloc.psa_id);
    }
  }

  const sellerEntity = ppaContract?.seller_id
    ? db.prepare('SELECT id, name, entity_type FROM entities WHERE id = ?').get(ppaContract.seller_id)
    : null;
  const buyerEntity = psaContract?.buyer_id
    ? db.prepare('SELECT id, name, entity_type FROM entities WHERE id = ?').get(psaContract.buyer_id)
    : null;

  const ppaInvoices = ppaContract ? db.prepare(`
    SELECT id, invoice_no, invoice_type, total_amount, energy_mwh, status, due_date, validation_status
    FROM invoices WHERE contract_id = ? AND billing_period = ? AND status != 'CANCELLED'
    ORDER BY created_at ASC
  `).all(ppaContract.id, period) : [];

  const psaInvoices = psaContract ? db.prepare(`
    SELECT id, invoice_no, invoice_type, total_amount, energy_mwh, status, due_date, validation_status
    FROM invoices WHERE contract_id = ? AND billing_period = ? AND status != 'CANCELLED'
    ORDER BY created_at ASC
  `).all(psaContract.id, period) : [];

  const effectiveMwh = Number(finalEnergy?.energy_mwh || provisionalEnergy?.energy_mwh || 0);
  const tradingMarginPerUnit = (psaContract && ppaContract)
    ? Math.max(0, Math.round(((Number(psaContract.tariff_per_unit) || 0) - (Number(ppaContract.tariff_per_unit) || 0)) * 1000) / 1000)
    : 0.07;
  const totalSpread = Math.round(effectiveMwh * 1000 * tradingMarginPerUnit);

  const linkedTopology = {
    has_link: !!(ppaContract && psaContract),
    allocation_percent: allocationPercent,
    ppa: ppaContract ? {
      id: ppaContract.id,
      contract_no: ppaContract.contract_no,
      project_type: ppaContract.project_type,
      capacity_mw: ppaContract.capacity_mw,
      tariff_per_unit: ppaContract.tariff_per_unit,
      seller_name: sellerEntity?.name || 'Power Producer (IPP)',
      invoices: ppaInvoices,
    } : null,
    hub: {
      name: 'SJVN Limited (REIA Trading Hub)',
      allocation_percent: allocationPercent,
      trading_margin_per_unit: tradingMarginPerUnit,
      energy_mwh: effectiveMwh,
      spread_amount: totalSpread,
      validation_status: ppaInvoices[0]?.validation_status || 'MATCHED',
    },
    psa: psaContract ? {
      id: psaContract.id,
      contract_no: psaContract.contract_no,
      project_type: psaContract.project_type,
      capacity_mw: psaContract.capacity_mw,
      tariff_per_unit: psaContract.tariff_per_unit,
      buyer_name: buyerEntity?.name || 'Buyer DISCOM',
      invoices: psaInvoices,
    } : null,
  };

  return {
    billing_family_ref: bfr,
    contract_id: contract.id,
    contract_no: contract.contract_no,
    contract_type: contract.contract_type,
    project_type: contract.project_type,
    billing_period: period,
    direction,
    linked_topology: linkedTopology,
    provisional_energy: provisionalEnergy || null,
    final_energy: finalEnergy || null,
    delta_mwh: deltaMwh,
    provisional_invoices: provisionalInvoices.map(tag),
    final_invoices: finalInvoices.map(tag),
    net_due_invoice_no: primaryFinal?.invoice_no || null,
    provisional_billed: provisionalBilled,
    already_paid: alreadyPaid,
    paid_on_period: paidOnPeriod,
    // A PSA with no allocation has no PPA to draw energy from; say so rather
    // than leave the energy boxes reading as though the data were late.
    psa_unallocated: source.unallocated,
    final_billable_before_adjustment: primaryFinal
      ? (primaryFinal.total_amount || 0) - (primaryFinal.other_adjustments || 0)
      : null,
    other_adjustments: primaryFinal?.other_adjustments ?? null,
    net_due: primaryFinal ? primaryFinal.total_amount : null,
    frequency_beta: frequencyBeta,
    summary: {
      has_provisional_energy: !!provisionalEnergy,
      has_final_energy: !!finalEnergy,
      provisional_invoice_count: provisionalInvoices.length,
      final_invoice_count: finalInvoices.length,
      already_paid: alreadyPaid,
      net_due: primaryFinal ? primaryFinal.total_amount : null,
      delta_mwh: deltaMwh,
      has_beta: !!betaRow,
      beta_value: betaRow?.beta_value ?? null,
    },
  };
}

/**
 * GET /api/billing-trail
 * Resolve by: bfr | invoice_id | energy_id | contract_id+period_month[+direction]
 */
router.get('/', (req, res) => {
  try {
    let bfr = req.query.bfr || null;
    let contract = null;
    let focus = null;
    let period = req.query.period_month || null;
    let direction = req.query.direction || null;

    if (req.query.invoice_id) {
      const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.query.invoice_id);
      if (!inv) return res.status(404).json({ error: 'Invoice not found' });
      focus = inv;
      contract = db.prepare('SELECT * FROM contracts WHERE id = ?').get(inv.contract_id);
      period = inv.billing_period;
      direction = inv.direction;
      bfr = inv.billing_family_ref || buildBillingFamilyRef(contract.contract_no, period, direction);
    } else if (req.query.energy_id) {
      const ed = db.prepare('SELECT * FROM energy_data WHERE id = ?').get(req.query.energy_id);
      if (!ed) return res.status(404).json({ error: 'Energy data not found' });
      // Prefer invoice contract if BFR maps to PSA; energy is usually on PPA
      contract = db.prepare('SELECT * FROM contracts WHERE id = ?').get(ed.contract_id);
      period = ed.period_month;
      direction = directionForContract(contract);
      bfr = ed.billing_family_ref || buildBillingFamilyRef(contract.contract_no, period, direction);

      // If caller also passed contract_id (e.g. PSA), use that for invoice side of trail
      if (req.query.contract_id) {
        const alt = db.prepare('SELECT * FROM contracts WHERE id = ?').get(req.query.contract_id);
        if (alt) {
          contract = alt;
          direction = directionForContract(alt);
          bfr = buildBillingFamilyRef(alt.contract_no, period, direction);
        }
      }
    } else if (bfr) {
      // Parse BFR/{CONTRACT}/{YYYY-MM}/{DIR}
      const m = String(bfr).match(/^BFR\/([^/]+)\/(\d{4}-\d{2})\/(S2S|S2B)$/i);
      if (!m) return res.status(400).json({ error: 'Invalid BFR format. Expected BFR/{CONTRACT}/{YYYY-MM}/{S2S|S2B}' });
      period = m[2];
      direction = m[3].toUpperCase() === 'S2B' ? 'SJVN_TO_BUYER' : 'SELLER_TO_SJVN';
      const safe = m[1].toUpperCase();
      const contracts = db.prepare('SELECT * FROM contracts').all();
      contract = contracts.find((c) => {
        const s = String(c.contract_no || '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').toUpperCase();
        return s === safe;
      });
      if (!contract) return res.status(404).json({ error: `No contract matching BFR segment ${m[1]}` });
      bfr = `BFR/${safe}/${period}/${m[3].toUpperCase()}`;
    } else if (req.query.contract_id && period) {
      contract = db.prepare('SELECT * FROM contracts WHERE id = ?').get(req.query.contract_id);
      if (!contract) return res.status(404).json({ error: 'Contract not found' });
      direction = direction || directionForContract(contract);
      bfr = buildBillingFamilyRef(contract.contract_no, period, direction);
    } else {
      return res.status(400).json({
        error: 'Provide bfr, invoice_id, energy_id, or contract_id+period_month',
      });
    }

    if (!contract || !period || !direction) {
      return res.status(400).json({ error: 'Could not resolve billing family' });
    }
    // A counterparty reads the trail of its own contracts only.
    if (!contractVisibleTo(req.user, contract)) return res.status(404).json({ error: 'Billing family not found' });

    res.json(buildTrail({ bfr, contract, period, direction, focus }));
  } catch (err) {
    console.error('Billing trail error:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
