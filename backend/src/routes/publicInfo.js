import { Router } from 'express';
import db from '../db/index.js';
import { newId } from '../util.js';
import { getParam } from '../mastersService.js';
import { userFromToken } from '../middleware/auth.js';
import { DECLARATION_ENDPOINTS, declarationVersion } from '../services/statutoryDeclaration.js';

/**
 * Public (no sign-in) facts the GIGW pages need: the designated officers, the
 * office address, the "last updated" date, the session timeout and the list of
 * actions that need a statutory declaration. Plus the cookie-consent receipt.
 */
const router = Router();
const STARTED = new Date();

const ROLES = ['wim', 'grievance', 'dpo', 'rti_cpio', 'rti_appellate'];
const FIELDS = ['name', 'designation', 'email', 'phone'];

function contacts() {
  const out = {};
  for (const role of ROLES) {
    const c = {};
    for (const f of FIELDS) {
      const v = String(getParam(`gigw_${role}_${f}`, '') || '').trim();
      if (v) c[f] = v;
    }
    out[role] = c;
  }
  return out;
}

function istNow() {
  return new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Kolkata' }).replace(' ', 'T') + '+05:30';
}

router.get('/site-info', (req, res) => {
  const lastUpdated = String(getParam('gigw_last_updated', '') || '').trim() || STARTED.toISOString().slice(0, 10);
  res.json({
    organisation: 'SJVN Limited',
    ministry: 'Ministry of Power, Government of India',
    office_address: getParam('gigw_office_address', '') || null,
    working_hours: getParam('gigw_working_hours', '') || null,
    last_updated: lastUpdated,
    contacts: contacts(),
    session: { idle_timeout_minutes: Number(getParam('session_idle_timeout_minutes', 15)) || 15 },
    declaration: {
      version: declarationVersion(),
      enforced: Number(getParam('statutory_declaration_enforced', 1)) === 1,
      endpoints: DECLARATION_ENDPOINTS,
    },
    server_time_utc: new Date().toISOString(),
    server_time_ist: istNow(),
  });
});

const CHOICES = ['all', 'essential'];
let insertConsent = null;

// The cookie notice's answer, kept as evidence of consent (DPDP Act s.6). The
// visitor need not be signed in; when they are, the record names them.
// Anyone can call this without signing in, so a burst from one address is cut
// off rather than written row by row.
const recent = new Map();
const PER_HOUR = 30;
function tooMany(ip) {
  const now = Date.now();
  const hits = (recent.get(ip) || []).filter((t) => now - t < 3_600_000);
  hits.push(now);
  recent.set(ip, hits);
  if (recent.size > 5000) for (const [k, v] of recent) if (now - v[v.length - 1] > 3_600_000) recent.delete(k);
  return hits.length > PER_HOUR;
}

router.post('/consent', (req, res) => {
  if (tooMany(req.ip || 'unknown')) return res.status(429).json({ error: 'Too many requests; try again later.' });
  const { purpose = 'COOKIES', choice, version } = req.body || {};
  if (!CHOICES.includes(choice)) return res.status(400).json({ error: `choice must be one of ${CHOICES.join(', ')}` });
  if (purpose !== 'COOKIES') return res.status(400).json({ error: 'Unknown consent purpose' });
  const user = userFromToken(req);
  insertConsent = insertConsent || db.prepare(`
    INSERT INTO consent_records (id, user_id, purpose, choice, version, ip_address, user_agent)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const id = newId('CNS');
  insertConsent.run(id, user?.id || null, purpose, choice, String(version || '').slice(0, 20) || null, req.ip || null, String(req.get('User-Agent') || '').slice(0, 300));
  res.status(201).json({ id, recorded_at: new Date().toISOString() });
});

/**
 * Public Market Ticker: Latest Day-Ahead, Green Day-Ahead, and Real-Time
 * Market Clearing Prices (₹/kWh) and cleared volumes across IEX, PXIL, and HPX
 * from actual trading records in market_rates.
 */
router.get('/market-ticker', (req, res) => {
  try {
    const latestDateRow = db.prepare(`SELECT max(rate_date) as max_date FROM market_rates`).get();
    if (!latestDateRow || !latestDateRow.max_date) {
      return res.json({ latest_date: null, prev_date: null, total_volume_mw: 0, rates: [] });
    }
    const latestDate = latestDateRow.max_date;

    const prevDateRow = db.prepare(`SELECT max(rate_date) as prev_date FROM market_rates WHERE rate_date < ?`).get(latestDate);
    const prevDate = prevDateRow?.prev_date || null;

    const rows = db.prepare(`
      SELECT curr.exchange, curr.product, curr.rate_date, curr.mcp_rate,
             prev.mcp_rate as prev_rate,
             round(curr.mcp_rate - coalesce(prev.mcp_rate, curr.mcp_rate), 2) as diff,
             curr.volume_mw, curr.min_rate, curr.max_rate, curr.avg_rate,
             curr.data_source
      FROM market_rates curr
      LEFT JOIN market_rates prev ON prev.exchange = curr.exchange 
                                 AND prev.product = curr.product 
                                 AND prev.rate_date = ?
      WHERE curr.rate_date = ?
      ORDER BY curr.exchange, curr.product
    `).all(prevDate, latestDate);

    const totalVolume = rows.reduce((acc, r) => acc + (Number(r.volume_mw) || 0), 0);

    res.json({
      latest_date: latestDate,
      prev_date: prevDate,
      total_volume_mw: Math.round(totalVolume),
      rates: rows
    });
  } catch (err) {
    console.error('Error fetching market ticker:', err);
    res.status(500).json({ error: 'Failed to fetch market ticker data' });
  }
});

/**
 * Public Clean Energy & Carbon Offset Telemetry:
 * Real MUs generated by SJVN's clean energy portfolio (Hydro & Solar) from
 * energy_data, combined with the Central Electricity Authority (CEA) official
 * Grid Emission Factor (0.716 tCO2/MWh) to provide audited CO2 emissions avoided.
 */
router.get('/clean-energy', (req, res) => {
  try {
    const CEA_EMISSION_FACTOR_PER_MU = 716; // Metric Tonnes CO2 per MU (0.716 tCO2/MWh)

    const stats = db.prepare(`
      SELECT 
        round(sum(CASE WHEN c.project_type IN ('Hydro','Solar','Wind','Hybrid','REIA') THEN ed.energy_mwh ELSE 0 END) / 1000.0, 2) as all_time_clean_mu,
        round(sum(CASE WHEN c.project_type IN ('Hydro','Solar','Wind','Hybrid','REIA') AND ed.period_month >= '2026-04' THEN ed.energy_mwh ELSE 0 END) / 1000.0, 2) as fy_clean_mu,
        round(sum(CASE WHEN c.project_type = 'Hydro' THEN ed.energy_mwh ELSE 0 END) / 1000.0, 2) as hydro_clean_mu,
        round(sum(CASE WHEN c.project_type = 'Solar' THEN ed.energy_mwh ELSE 0 END) / 1000.0, 2) as solar_clean_mu,
        max(ed.period_month) as latest_month
      FROM energy_data ed
      JOIN contracts c ON c.id = ed.contract_id
    `).get();

    const allTimeMu = Number(stats?.all_time_clean_mu) || 0;
    const fyMu = Number(stats?.fy_clean_mu) || 0;
    const hydroMu = Number(stats?.hydro_clean_mu) || 0;
    const solarMu = Number(stats?.solar_clean_mu) || 0;

    const allTimeCo2Tonnes = Math.round(allTimeMu * CEA_EMISSION_FACTOR_PER_MU);
    const fyCo2Tonnes = Math.round(fyMu * CEA_EMISSION_FACTOR_PER_MU);

    res.json({
      as_of_month: stats?.latest_month || '2026-10',
      financial_year: 'FY 2026-27',
      cea_emission_factor_t_per_mu: CEA_EMISSION_FACTOR_PER_MU,
      emission_standard: 'Central Electricity Authority (CEA) CO2 Baseline Database Ver. 19/20 (0.716 tCO2/MWh)',
      clean_energy: {
        all_time_mu: allTimeMu,
        fy_mu: fyMu,
        hydro_mu: hydroMu,
        solar_mu: solarMu
      },
      co2_avoided_tonnes: {
        all_time: allTimeCo2Tonnes,
        fy: fyCo2Tonnes
      }
    });
  } catch (err) {
    console.error('Error fetching clean energy telemetry:', err);
    res.status(500).json({ error: 'Failed to fetch clean energy telemetry' });
  }
});

export default router;

