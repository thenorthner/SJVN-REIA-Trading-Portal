import { Router } from 'express';
import db from '../db/index.js';
import { requireAuth, requireRole, ROLE_GROUPS } from '../middleware/auth.js';
import { newId, logAudit } from '../util.js';
import { seedDsmSlabs, getEffectiveSlab, computeDsmCharge, deviationSide } from '../services/dsmCharges.js';

const router = Router();
router.use(requireAuth);

const DSM_READ = [...ROLE_GROUPS.TRADING_ALL];
const DSM_WRITE = [...ROLE_GROUPS.TRADING_WRITE];

seedDsmSlabs();

const SIDES = ['OVER', 'UNDER', 'BOTH'];
const BASES = ['FLAT', 'PCT_OF_REFERENCE'];

// The slab register, banded low frequency to high within each side.
router.get('/slabs', requireRole(...DSM_READ), (req, res) => {
  const { side, active } = req.query;
  let sql = 'SELECT * FROM dsm_charge_slabs WHERE 1=1';
  const params = [];
  if (side) { sql += ' AND deviation_side = ?'; params.push(String(side).toUpperCase()); }
  if (active !== '0') sql += ' AND is_active = 1';
  sql += ' ORDER BY deviation_side, effective_from DESC, freq_from_hz';
  res.json(db.prepare(sql).all(...params));
});

// Which slab prices a given side and frequency on a date.
router.get('/slabs/effective', requireRole(...DSM_READ), (req, res) => {
  const { side, frequency_hz, date } = req.query;
  if (!side || frequency_hz == null) {
    return res.status(400).json({ error: 'side and frequency_hz are required' });
  }
  const slab = getEffectiveSlab({ side: String(side).toUpperCase(), frequencyHz: Number(frequency_hz), onDate: date });
  if (!slab) return res.status(404).json({ error: `No slab covers ${side} deviation at ${frequency_hz} Hz on ${date || 'today'}` });
  res.json(slab);
});

// Add a slab — a finer band from the notification, or a revision of an existing
// one under a later effective_from.
router.post('/slabs', requireRole(...DSM_WRITE), (req, res) => {
  const {
    slab_name, deviation_side, freq_from_hz, freq_to_hz, charge_basis, charge_value,
    reference_price_key, cap_paise_per_kwh, settlement_sign, effective_from, effective_to,
    is_verified, source_note,
  } = req.body;

  if (!slab_name || !deviation_side || !charge_basis || !effective_from) {
    return res.status(400).json({ error: 'slab_name, deviation_side, charge_basis and effective_from are required' });
  }
  const side = String(deviation_side).toUpperCase();
  if (!SIDES.includes(side)) return res.status(400).json({ error: `deviation_side must be one of: ${SIDES.join(', ')}` });
  const basis = String(charge_basis).toUpperCase();
  if (!BASES.includes(basis)) return res.status(400).json({ error: `charge_basis must be one of: ${BASES.join(', ')}` });
  if (basis === 'PCT_OF_REFERENCE' && !reference_price_key) {
    return res.status(400).json({ error: 'reference_price_key is required for a PCT_OF_REFERENCE slab' });
  }
  if (freq_from_hz != null && freq_to_hz != null && Number(freq_to_hz) <= Number(freq_from_hz)) {
    return res.status(400).json({ error: 'freq_to_hz must be above freq_from_hz' });
  }
  // A slab is what puts money on a bill, so it cannot be marked verified while
  // it still has no rate in it.
  if (Number(is_verified) === 1 && charge_value == null) {
    return res.status(400).json({ error: 'A slab cannot be marked verified without a charge_value' });
  }

  const id = newId('DSMS');
  db.prepare(`
    INSERT INTO dsm_charge_slabs
      (id, slab_name, deviation_side, freq_from_hz, freq_to_hz, charge_basis, charge_value,
       reference_price_key, cap_paise_per_kwh, settlement_sign, effective_from, effective_to,
       is_verified, source_note, is_active, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
  `).run(
    id, slab_name, side,
    freq_from_hz == null ? null : Number(freq_from_hz),
    freq_to_hz == null ? null : Number(freq_to_hz),
    basis,
    charge_value == null ? null : Number(charge_value),
    reference_price_key || null,
    cap_paise_per_kwh == null ? null : Number(cap_paise_per_kwh),
    Number(settlement_sign) === -1 ? -1 : 1,
    effective_from, effective_to || null,
    Number(is_verified) === 1 ? 1 : 0,
    source_note || null,
    req.user?.id || null,
  );
  logAudit({ req, user: req.user, action: 'CREATE_DSM_SLAB', module: 'TRADING', entityType: 'dsm_charge_slabs', entityId: id, details: req.body });
  res.status(201).json(db.prepare('SELECT * FROM dsm_charge_slabs WHERE id = ?').get(id));
});

// Enter or correct a slab's rate. Verifying is the step that lets it price a
// bill, so it is audited separately from the rest of the edit.
router.patch('/slabs/:id', requireRole(...DSM_WRITE), (req, res) => {
  const row = db.prepare('SELECT * FROM dsm_charge_slabs WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });

  const b = req.body || {};
  const chargeValue = b.charge_value === undefined ? row.charge_value : (b.charge_value == null ? null : Number(b.charge_value));
  const verified = b.is_verified === undefined ? row.is_verified : (Number(b.is_verified) === 1 ? 1 : 0);
  if (verified === 1 && chargeValue == null) {
    return res.status(400).json({ error: 'A slab cannot be marked verified without a charge_value' });
  }

  db.prepare(`
    UPDATE dsm_charge_slabs SET
      charge_value = ?, cap_paise_per_kwh = ?, reference_price_key = ?, settlement_sign = ?,
      effective_to = ?, is_verified = ?, source_note = ?, is_active = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(
    chargeValue,
    b.cap_paise_per_kwh === undefined ? row.cap_paise_per_kwh : (b.cap_paise_per_kwh == null ? null : Number(b.cap_paise_per_kwh)),
    b.reference_price_key === undefined ? row.reference_price_key : (b.reference_price_key || null),
    b.settlement_sign === undefined ? row.settlement_sign : (Number(b.settlement_sign) === -1 ? -1 : 1),
    b.effective_to === undefined ? row.effective_to : (b.effective_to || null),
    verified,
    b.source_note === undefined ? row.source_note : (b.source_note || null),
    b.is_active === undefined ? row.is_active : (Number(b.is_active) === 0 ? 0 : 1),
    row.id,
  );
  logAudit({
    req, user: req.user,
    action: verified === 1 && !row.is_verified ? 'VERIFY_DSM_SLAB' : 'UPDATE_DSM_SLAB',
    module: 'TRADING', entityType: 'dsm_charge_slabs', entityId: row.id, details: b,
  });
  res.json(db.prepare('SELECT * FROM dsm_charge_slabs WHERE id = ?').get(row.id));
});

// Price a deviation without recording anything — what the desk sees before it
// accepts a block's actuals, and how an unpriced block explains itself.
router.post('/preview', requireRole(...DSM_READ), (req, res) => {
  const { deviation_mwh, deviation_mw, frequency_hz, date, reference_price_paise_per_kwh } = req.body || {};
  if (deviation_mwh == null && deviation_mw == null) {
    return res.status(400).json({ error: 'deviation_mwh or deviation_mw is required' });
  }
  const mwh = deviation_mwh != null ? Number(deviation_mwh) : Number(deviation_mw) * 0.25;
  const result = computeDsmCharge({
    deviationMwh: mwh,
    frequencyHz: frequency_hz == null ? null : Number(frequency_hz),
    onDate: date || null,
    referencePricePaisePerKwh: reference_price_paise_per_kwh == null ? null : Number(reference_price_paise_per_kwh),
  });
  res.json({ ...result, deviation_side: deviationSide(mwh) });
});

// How much of the register is actually usable: the desk needs to know which
// bands still have no notified rate against them before it bills a period.
router.get('/readiness', requireRole(...DSM_READ), (req, res) => {
  const rows = db.prepare('SELECT * FROM dsm_charge_slabs WHERE is_active = 1').all();
  const unverified = rows.filter((r) => !r.is_verified || r.charge_value == null);
  res.json({
    slabs: rows.length,
    verified: rows.length - unverified.length,
    unverified: unverified.length,
    can_price: rows.length > 0 && unverified.length < rows.length,
    pending: unverified.map((r) => ({ id: r.id, slab_name: r.slab_name, deviation_side: r.deviation_side, freq_from_hz: r.freq_from_hz, freq_to_hz: r.freq_to_hz })),
  });
});

export default router;
