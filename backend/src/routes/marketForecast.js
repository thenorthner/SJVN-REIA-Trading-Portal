import { Router } from 'express';
import multer from 'multer';
import { requireAuth, requireRole, ROLE_GROUPS } from '../middleware/auth.js';
import { secureLogAudit } from '../auditEngine.js';
import {
  ForecastError, listSeries, actualsFor, createForecastRun, getForecastRun, listForecastRuns,
  forecastAccuracy, importExchangePriceFile,
} from '../services/marketForecast.js';

const router = Router();
router.use(requireAuth);
// Internal to the desk. Market Rates & Analytics is open to trading clients
// because a clearing price belongs to the market; a forecast is SJVN's own
// reading of it, and the desk bids on that reading.
router.use(requireRole(...ROLE_GROUPS.TRADING_ALL));

// A day's block-wise file is a few kilobytes; a month of them is well under one.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

const handle = (fn) => (req, res) => {
  try {
    fn(req, res);
  } catch (err) {
    if (err instanceof ForecastError) return res.status(err.status).json({ error: err.message, ...err.extra });
    console.error('[FORECAST]', err);
    res.status(500).json({ error: 'Forecasting failed' });
  }
};

router.get('/series', handle((_req, res) => res.json(listSeries())));

router.get('/actuals', handle((req, res) => res.json(actualsFor(req.query))));

router.get('/runs', handle((req, res) => res.json({ runs: listForecastRuns(req.query) })));

router.get('/runs/:id', handle((req, res) => {
  const result = getForecastRun(req.params.id, { blockDate: req.query.block_date });
  if (!result) return res.status(404).json({ error: 'Forecast run not found' });
  res.json(result);
}));

router.post('/runs', requireRole(...ROLE_GROUPS.TRADING_WRITE), handle((req, res) => {
  const { exchange, product, horizon_days: horizon = 7, model = 'AUTO', cutoff_date: cutoff = null } = req.body || {};
  const result = createForecastRun({ exchange, product, horizon, model, cutoff: cutoff || null, user: req.user });
  const { run } = result;
  secureLogAudit(req, {
    action: 'CREATE_PRICE_FORECAST',
    module: 'TRADING',
    entityType: 'price_forecast_run',
    entityId: run.id,
    afterValue: {
      exchange: run.exchange, product: run.product, requested_model: run.requested_model, model: run.model,
      cutoff_date: run.cutoff_date, horizon_days: run.horizon_days, backtest_mape: run.backtest_mape,
    },
  });
  res.status(201).json(result);
}));

router.get('/accuracy', handle((req, res) => res.json(forecastAccuracy(req.query))));

router.post(
  '/actuals/upload',
  requireRole(...ROLE_GROUPS.TRADING_WRITE),
  (req, res, next) => upload.single('file')(req, res, (err) => {
    if (!err) return next();
    res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'The file is larger than 5 MB.' : err.message });
  }),
  handle((req, res) => {
    const result = importExchangePriceFile({
      buffer: req.file?.buffer,
      filename: req.file?.originalname,
      exchange: req.body?.exchange,
      product: req.body?.product,
      date: req.body?.date || null,
    });
    secureLogAudit(req, {
      action: 'UPLOAD_MARKET_PRICES',
      module: 'TRADING',
      entityType: 'market_rate',
      entityId: `${result.exchange}:${result.product}`,
      details: {
        filename: result.filename, rows: result.rows, replaced_rows: result.replaced_rows,
        price_unit: result.price_unit, dates: result.days.map((d) => d.date),
      },
    });
    res.status(201).json(result);
  }),
);

export default router;
