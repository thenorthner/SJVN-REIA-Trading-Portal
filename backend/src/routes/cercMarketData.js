import { Router } from 'express';
import { db } from '../db/index.js';
import { requireAuth, requireRole, ROLE_GROUPS } from '../middleware/auth.js';
import { cercScraper } from '../services/cercScraper.js';

const router = Router();
router.use(requireAuth);
router.use(requireRole(...ROLE_GROUPS.TRADING_ALL, 'TRADING_CLIENT'));

function formatSummary(row) {
  if (!row) return null;
  return {
    ...row,
    period: row.report_period,
    iexDamAvg: row.dam_iex_avg_price,
    gdamAvg: row.gdam_iex_avg_price,
    rtmAvg: row.rtm_iex_avg_price,
    totalVolume: row.total_short_term_volume_mu,
    dsmAvg: row.dsm_avg_charge,
    dsmMin: row.dsm_min_charge,
    dsmMax: row.dsm_max_charge,
    recAvg: row.rec_iex_avg_price,
    recVolume: row.rec_iex_volume,
    bilateralVolume: row.bilateral_volume_mu,
  };
}

router.get('/summary', (req, res) => {
  const row = db.prepare(`SELECT * FROM cerc_monthly_summary ORDER BY report_period DESC LIMIT 1`).get();
  res.json(formatSummary(row));
});

router.get('/summary/:period', (req, res) => {
  const { period } = req.params;
  const row = db.prepare(`SELECT * FROM cerc_monthly_summary WHERE report_period = ?`).get(period);
  res.json(formatSummary(row));
});

router.get('/prices', (req, res) => {
  const period = req.query.period || db.prepare(`SELECT report_period FROM cerc_monthly_summary ORDER BY report_period DESC LIMIT 1`).get()?.report_period || '2026-01';
  
  const priceRows = db.prepare(`
    SELECT product, exchange, metric_name, metric_value 
    FROM cerc_market_data 
    WHERE report_period = ? AND data_category = 'PRICE' AND metric_name = 'Weighted Average'
  `).all(period);

  const volRows = db.prepare(`
    SELECT product, exchange, metric_value 
    FROM cerc_market_data 
    WHERE report_period = ? AND data_category = 'VOLUME'
  `).all(period);

  const products = ['DAM', 'GDAM', 'RTM', 'HP-DAM'];
  const comparison = products.map(prod => {
    const iexP = priceRows.find(r => r.product === prod && r.exchange === 'IEX')?.metric_value ?? null;
    const pxilP = priceRows.find(r => r.product === prod && r.exchange === 'PXIL')?.metric_value ?? null;
    const hpxP = priceRows.find(r => r.product === prod && r.exchange === 'HPX')?.metric_value ?? null;

    const iexV = volRows.find(r => r.product === prod && r.exchange === 'IEX')?.metric_value ?? 0;
    const pxilV = volRows.find(r => r.product === prod && r.exchange === 'PXIL')?.metric_value ?? 0;
    const hpxV = volRows.find(r => r.product === prod && r.exchange === 'HPX')?.metric_value ?? 0;

    return {
      product: prod,
      iexAvg: iexP,
      pxilAvg: pxilP,
      hpxAvg: hpxP,
      iexVol: iexV,
      pxilVol: pxilV,
      hpxVol: hpxV,
    };
  });

  res.json(comparison);
});

router.get('/volumes', (req, res) => {
  const period = req.query.period || db.prepare(`SELECT report_period FROM cerc_monthly_summary ORDER BY report_period DESC LIMIT 1`).get()?.report_period || '2026-01';
  
  const rows = db.prepare(`
    SELECT product, exchange, metric_value 
    FROM cerc_market_data 
    WHERE report_period = ? AND data_category = 'VOLUME'
  `).all(period);

  const result = [];
  const bilateral = rows.find(r => r.product === 'BILATERAL');
  if (bilateral) result.push({ product: 'Bilateral', volume: bilateral.metric_value });

  const damIex = rows.find(r => r.product === 'DAM' && r.exchange === 'IEX');
  if (damIex) result.push({ product: 'DAM (IEX)', volume: damIex.metric_value });

  const rtmIex = rows.find(r => r.product === 'RTM' && r.exchange === 'IEX');
  if (rtmIex) result.push({ product: 'RTM (IEX)', volume: rtmIex.metric_value });

  const gdamIex = rows.find(r => r.product === 'GDAM' && r.exchange === 'IEX');
  if (gdamIex) result.push({ product: 'GDAM (IEX)', volume: gdamIex.metric_value });

  const dsm = rows.find(r => r.product === 'DSM');
  if (dsm) result.push({ product: 'DSM', volume: dsm.metric_value });

  res.json(result);
});

router.get('/daily-trend', (req, res) => {
  const period = req.query.period || db.prepare(`SELECT report_period FROM cerc_monthly_summary ORDER BY report_period DESC LIMIT 1`).get()?.report_period || '2026-01';

  const rows = db.prepare(`
    SELECT product, exchange, day_of_month, metric_name, metric_value 
    FROM cerc_market_data 
    WHERE report_period = ? AND day_of_month IS NOT NULL
    ORDER BY day_of_month ASC
  `).all(period);

  const daysMap = {};
  for (const r of rows) {
    const d = r.day_of_month;
    if (!daysMap[d]) daysMap[d] = { day: `Day ${d}`, dayNum: d, damPrice: null, gdamPrice: null, rtmPrice: null, totalVolume: 0 };

    if (r.product === 'DAM' && r.exchange === 'IEX' && r.metric_name === 'Daily Price') {
      daysMap[d].damPrice = r.metric_value;
    } else if (r.product === 'GDAM' && r.exchange === 'IEX' && r.metric_name === 'Daily Price') {
      daysMap[d].gdamPrice = r.metric_value;
    } else if (r.product === 'RTM' && r.exchange === 'IEX' && r.metric_name === 'Daily Price') {
      daysMap[d].rtmPrice = r.metric_value;
    } else if (r.product === 'DSM' && r.metric_name === 'Daily Volume') {
      daysMap[d].totalVolume = r.metric_value;
    }
  }

  res.json(Object.values(daysMap));
});

router.get('/dsm', (req, res) => {
  const period = req.query.period || db.prepare(`SELECT report_period FROM cerc_monthly_summary ORDER BY report_period DESC LIMIT 1`).get()?.report_period || '2026-01';

  const summary = db.prepare(`SELECT dsm_avg_charge, dsm_min_charge, dsm_max_charge FROM cerc_monthly_summary WHERE report_period = ?`).get(period);

  const daily = db.prepare(`
    SELECT day_of_month, metric_value 
    FROM cerc_market_data 
    WHERE report_period = ? AND data_category = 'DSM' AND metric_name = 'Daily Avg Charge'
    ORDER BY day_of_month ASC
  `).all(period);

  res.json({
    avgCharge: summary?.dsm_avg_charge ?? null,
    minCharge: summary?.dsm_min_charge ?? null,
    maxCharge: summary?.dsm_max_charge ?? null,
    dailyTrend: daily.map(d => ({ day: `Day ${d.day_of_month}`, charge: d.metric_value })),
  });
});

router.get('/rec', (req, res) => {
  const period = req.query.period || db.prepare(`SELECT report_period FROM cerc_monthly_summary ORDER BY report_period DESC LIMIT 1`).get()?.report_period || '2026-01';

  const rows = db.prepare(`
    SELECT exchange, metric_name, metric_value 
    FROM cerc_market_data 
    WHERE report_period = ? AND data_category = 'REC'
  `).all(period);

  const exchanges = ['IEX', 'PXIL', 'HPX'];
  const result = exchanges.map(ex => {
    const vol = rows.find(r => r.exchange === ex && r.metric_name === 'Traded Volume')?.metric_value || 0;
    const price = rows.find(r => r.exchange === ex && r.metric_name === 'Weighted Avg Price')?.metric_value || 0;
    const valueCr = vol && price ? +((vol * price) / 10000000).toFixed(2) : 0;
    return {
      exchange: ex,
      volume: vol,
      price: price,
      value: valueCr,
    };
  });

  res.json(result);
});

// ── One month of the report, as every market widget needs it ────────────────
//
// The Collective Market, Macro, MMR and Power Market widgets each carried their
// own hardcoded copy of this report — some of it impossible (an IEX RTM minimum
// of ₹10 above a maximum of ₹5.92, a weighted average of ₹11 over a ₹10 ceiling),
// some of it synthesised (the MMR dashboard divided an annual figure across the
// months by a "seasonal weight"). This is the month as parsed from the report.

const REPORT_EXCHANGES = ['IEX', 'PXIL', 'HPX'];
const REPORT_PRODUCTS = ['DAM', 'GDAM', 'HP-DAM', 'RTM'];

function reportPeriods() {
  return db.prepare('SELECT report_period AS period FROM cerc_monthly_summary ORDER BY report_period DESC').all().map((r) => r.period);
}

function monthOf(period) {
  const rows = db.prepare(`
    SELECT data_category, product, exchange, metric_name, metric_value FROM cerc_market_data
    WHERE report_period = ? AND day_of_month IS NULL
  `).all(period);
  const val = (category, product, exchange, metric) => rows.find((r) => r.data_category === category && r.product === product
    && r.exchange === exchange && r.metric_name === metric)?.metric_value ?? null;
  const summary = db.prepare('SELECT * FROM cerc_monthly_summary WHERE report_period = ?').get(period);

  const segments = REPORT_EXCHANGES.flatMap((exchange) => REPORT_PRODUCTS.map((product) => ({
    exchange,
    product,
    min: val('PRICE', product, exchange, 'Minimum'),
    max: val('PRICE', product, exchange, 'Maximum'),
    weighted_avg: val('PRICE', product, exchange, 'Weighted Average'),
    volume_mu: val('VOLUME', product, exchange, 'Volume'),
  })));

  return {
    period,
    segments,
    exchanges: REPORT_EXCHANGES.map((exchange) => {
      const volumes = REPORT_PRODUCTS.map((product) => ({ product, volume_mu: val('VOLUME', product, exchange, 'Volume') }));
      return { exchange, volumes, total_mu: volumes.reduce((a, v) => a + (v.volume_mu || 0), 0) };
    }),
    rec: REPORT_EXCHANGES.map((exchange) => ({
      exchange,
      volume_mwh: val('REC', 'REC', exchange, 'Traded Volume'),
      price_rs_mwh: val('REC', 'REC', exchange, 'Weighted Avg Price'),
    })),
    short_term: {
      bilateral_mu: val('VOLUME', 'BILATERAL', 'ALL', 'Volume'),
      exchanges_mu: val('VOLUME', 'PX_TOTAL', 'ALL', 'Volume'),
      dsm_mu: val('VOLUME', 'DSM', 'GRID', 'Volume'),
      total_mu: summary?.total_short_term_volume_mu ?? null,
    },
    not_in_report: [
      'Shares of the trading licensees',
      'REC buy and sell bid volumes (only what traded)',
      'GTAM and TAM contract-wise volumes and prices',
    ],
  };
}

router.get('/market-month', (req, res) => {
  const periods = reportPeriods();
  const period = req.query.period && periods.includes(req.query.period) ? req.query.period : periods[0];
  if (!period) return res.json({ period: null, periods: [] });
  res.json({ ...monthOf(period), periods });
});

// Month by month: bilateral, collective market and DSM volumes, oldest first.
router.get('/volume-history', (_req, res) => {
  res.json(reportPeriods().reverse().map((period) => {
    const m = monthOf(period);
    return { period, ...m.short_term };
  }));
});

router.get('/periods', (req, res) => {
  const rows = db.prepare(`SELECT report_period as period FROM cerc_monthly_summary ORDER BY report_period DESC`).all();
  if (rows.length === 0) {
    const logs = db.prepare(`SELECT DISTINCT report_period as period FROM cerc_fetch_log ORDER BY report_period DESC`).all();
    if (logs.length > 0) return res.json(logs);
    return res.json([{ period: '2026-01' }]);
  }
  res.json(rows);
});

router.get('/fetch-log', (req, res) => {
  const rows = cercScraper.getCercFetchLog(req.query);
  res.json(rows);
});

router.post('/trigger', async (req, res) => {
  try {
    const period = req.body?.period || '2026-01';
    const result = await cercScraper.fetchCercReport(period);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/scan', async (req, res) => {
  try {
    const result = await cercScraper.scanForNewReports();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
