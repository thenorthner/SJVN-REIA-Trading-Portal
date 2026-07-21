import { Router } from 'express';
import db from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { buildBillingFamilyRef, directionForContract } from '../util.js';

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

function energyContractIdsForInvoice(contract) {
  // Energy lives on PPA; PSA invoices resolve via allocations
  if (contract.contract_type === 'PSA') {
    const alloc = db.prepare('SELECT ppa_id FROM contract_allocations WHERE psa_id = ?').get(contract.id);
    return alloc?.ppa_id ? [alloc.ppa_id, contract.id] : [contract.id];
  }
  return [contract.id];
}

function buildTrail({ bfr, contract, period, direction }) {
  const contractIds = energyContractIdsForInvoice(contract);
  const energyPlaceholders = contractIds.map(() => '?').join(',');

  const provisionalEnergy = db.prepare(`
    SELECT * FROM energy_data
    WHERE contract_id IN (${energyPlaceholders}) AND period_month = ? AND data_type = 'PROVISIONAL'
    ORDER BY created_at ASC LIMIT 1
  `).get(...contractIds, period);

  const finalEnergy = db.prepare(`
    SELECT * FROM energy_data
    WHERE contract_id IN (${energyPlaceholders}) AND period_month = ? AND data_type = 'FINAL'
    ORDER BY created_at DESC LIMIT 1
  `).get(...contractIds, period);

  const provisionalInvoices = db.prepare(`
    SELECT * FROM invoices
    WHERE contract_id = ? AND billing_period = ? AND direction = ?
      AND invoice_type = 'PROVISIONAL' AND status != 'CANCELLED'
    ORDER BY created_at ASC
  `).all(contract.id, period, direction);

  const finalInvoices = db.prepare(`
    SELECT * FROM invoices
    WHERE contract_id = ? AND billing_period = ? AND direction = ?
      AND invoice_type IN ('FINAL', 'SUPPLEMENTARY') AND status != 'CANCELLED'
    ORDER BY created_at ASC
  `).all(contract.id, period, direction);

  const provIds = provisionalInvoices.map((i) => i.id);
  const alreadyPaid = paidOnInvoices(provIds);
  const provisionalBilled = provisionalInvoices.reduce((s, i) => s + (i.total_amount || 0), 0);

  const primaryFinal = finalInvoices[0] || null;

  const deltaMwh = (finalEnergy?.energy_mwh ?? null) != null && provisionalEnergy
    ? Math.round(((finalEnergy.energy_mwh || 0) - (provisionalEnergy.energy_mwh || 0)) * 100) / 100
    : null;

  return {
    billing_family_ref: bfr,
    contract_id: contract.id,
    contract_no: contract.contract_no,
    contract_type: contract.contract_type,
    billing_period: period,
    direction,
    provisional_energy: provisionalEnergy || null,
    final_energy: finalEnergy || null,
    delta_mwh: deltaMwh,
    provisional_invoices: provisionalInvoices,
    final_invoices: finalInvoices,
    provisional_billed: provisionalBilled,
    already_paid: alreadyPaid,
    final_billable_before_adjustment: primaryFinal
      ? (primaryFinal.total_amount || 0) - (primaryFinal.other_adjustments || 0)
      : null,
    other_adjustments: primaryFinal?.other_adjustments ?? null,
    net_due: primaryFinal ? primaryFinal.total_amount : null,
    summary: {
      has_provisional_energy: !!provisionalEnergy,
      has_final_energy: !!finalEnergy,
      provisional_invoice_count: provisionalInvoices.length,
      final_invoice_count: finalInvoices.length,
      already_paid: alreadyPaid,
      net_due: primaryFinal ? primaryFinal.total_amount : null,
      delta_mwh: deltaMwh,
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
    let period = req.query.period_month || null;
    let direction = req.query.direction || null;

    if (req.query.invoice_id) {
      const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.query.invoice_id);
      if (!inv) return res.status(404).json({ error: 'Invoice not found' });
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

    res.json(buildTrail({ bfr, contract, period, direction }));
  } catch (err) {
    console.error('Billing trail error:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
