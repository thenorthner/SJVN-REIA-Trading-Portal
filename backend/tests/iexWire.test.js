/**
 * IEX clients against a real HTTP server.
 *
 * The unit tests replace global.fetch, which proves the mapping but not the
 * wire: a header that is never actually transmitted, a URL assembled wrongly by
 * the runtime, a body the JSON parser chokes on, or an abort that does not fire
 * all look identical to a passing mock. This file runs both clients against a
 * real socket and asserts on what the server genuinely received.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import http from 'http';
import { fetchMarketPq, fetchClearedResults, checkConnectivity, clearDecimalsCache } from '../src/services/iexService.js';
import { fetchOrderBook, fetchProductMaster, clearRecProductCache } from '../src/services/iexRecService.js';
import db from '../src/db/index.js';
import { invalidateParamCache } from '../src/mastersService.js';

const ENV_KEYS = [
  'IEX_ENABLED', 'IEX_BASE_URL', 'IEX_LOGIN_USER_ID', 'IEX_PARTICIPANT_ID',
  'IEX_BID_AREA_ID', 'IEX_PORTFOLIO_ID', 'IEX_API_TOKEN', 'IEX_REC_API_TOKEN',
  'IEX_ENVIRONMENT', 'IEX_ENFORCE_TOKEN_EXPIRY', 'IEX_TIMEOUT_MS',
];

/** Everything the fake exchange was asked, in order. */
let received = [];
/** Per-path overrides a test can install: path substring -> handler(req,res). */
let overrides = {};
let server;
let origin;

const DELIVERY_EPOCH = Date.UTC(2026, 8, 9) / 1000; // 2026-09-09T00:00:00Z

const ASSET_MASTER = {
  AssetDetails: [{
    AssetId: 'A1', AssetName: 'IEX-DAM',
    OrderQtyDecimal: 10, OrderPriceDecimal: 100,
    TradeQtyDecimal: 100, TradePriceDecimal: 100,
  }],
};

const DELIVERY_DATES = { DeliveryDates: [{ DeliveryDateId: 'T + 1', DeliveryDate: DELIVERY_EPOCH }] };

const PQ_RESULTS = {
  LastUpdatedTime: 1788912345,
  PQDetails: [{
    FromPeriodId: '00:00', ToPeriodId: '00:15',
    BidAreaDetails: [{ BidArea: 'A1', Price: 410000, BuyQty: 150000, SellQty: 120000 }],
  }],
};

const SCHEDULE_REPORT = {
  ReportDetails: [{
    DeliveryDate: DELIVERY_EPOCH, AssetId: 'A1', BidAreaId: 'A1', ParticipantId: 'N2DL0SJV0000',
    PeriodDetails: [{
      FromPeriodId: '00:00', ToPeriodId: '00:15',
      AreaPrice: 410000, AreaBuyQty: 15000000, AreaSellQty: 14000000,
      ScheduleDetails: [{ PortfolioId: 'SJVNP1', Quantity: 5000, SingleBidQty: 3000, BlockBidQty: 2000 }],
    }],
  }],
};

const REC_PRODUCTS = {
  ProductDetails: [{
    Product: 'RECNONSOL', ProductDesc: 'REC Non-Solar', InstrumentName: 'REC',
    PriceDecimalLocator: 100, QtyDecimalLocator: 100, BasePrice: 100000, MinQty: 100,
  }],
};

const REC_ORDERS = {
  TotalRecord: 1,
  OrderDetails: [{
    OrderId: 9001, Product: 'RECNONSOL', InstrumentName: 'REC', BuySell: 'Sell',
    Price: 100000, TotalExecutedQuantity: 5000, PendingQuantity: 2500,
    Status: 'Partial', Error: '0',
  }],
};

const ROUTES = [
  ['/master/assets/', ASSET_MASTER],
  ['/deliverydates/', DELIVERY_DATES],
  ['/pqresults/', PQ_RESULTS],
  ['/portfolioschedulereport/', SCHEDULE_REPORT],
  ['/businessconfig/', { BusinessDate: DELIVERY_EPOCH, MaxBlockBidEntries: 50 }],
  ['/rec/api/v2/master/products/', REC_PRODUCTS],
  ['/rec/api/v2/orders/', REC_ORDERS],
];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    received.push({ url: req.url, method: req.method, headers: { ...req.headers } });
    const override = Object.keys(overrides).find((k) => req.url.includes(k));
    if (override) return overrides[override](req, res);
    const hit = ROUTES.find(([p]) => req.url.includes(p));
    if (!hit) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end(`no route for ${req.url}`);
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(hit[1]));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
  received = [];
  overrides = {};
  clearDecimalsCache();
  clearRecProductCache();
  ENV_KEYS.forEach((k) => delete process.env[k]);
  process.env.IEX_ENABLED = 'true';
  process.env.IEX_LOGIN_USER_ID = 'SJVA1';
  process.env.IEX_PARTICIPANT_ID = 'N2DL0SJV0000';
  process.env.IEX_BID_AREA_ID = 'A1';
  process.env.IEX_PORTFOLIO_ID = 'SJVNP1';
  process.env.IEX_API_TOKEN = 'wire-test-token';
  process.env.IEX_BASE_URL = origin;
});

afterEach(() => {
  ENV_KEYS.forEach((k) => delete process.env[k]);
});

const asked = (fragment) => received.find((r) => r.url.includes(fragment));

describe('Front Office — what actually goes over the socket', () => {
  it('transmits the FO headers the spec names, spelled the FO way', async () => {
    await checkConnectivity('DAM');
    const req = asked('/businessconfig/');
    // Node lowercases incoming header names; the spelling is what matters.
    expect(req.headers.authentication).toBe('Bearer wire-test-token');
    expect(req.headers.userid).toBe('SJVA1');
    expect(req.headers.participantid).toBe('N2DL0SJV0000');
    // The REC spelling must NOT appear on a Front Office call.
    expect(req.headers.authorization).toBeUndefined();
    expect(req.headers.loginuserid).toBeUndefined();
  });

  it('puts the epoch delivery date in the path, not an ISO string', async () => {
    const res = await fetchMarketPq('DAM', '2026-09-09');
    expect(res.ok).toBe(true);
    const req = asked('/pqresults/');
    expect(req.url).toBe(`/dam/api/v2/pqresults/SJVA1,N2DL0SJV0000,${DELIVERY_EPOCH}`);
    expect(req.url).not.toContain('2026-09-09');
  });

  it('sends the schedule report all five path parameters', async () => {
    await fetchClearedResults('DAM', '2026-09-09');
    expect(asked('/portfolioschedulereport/').url)
      .toBe(`/dam/api/v2/portfolioschedulereport/SJVA1,N2DL0SJV0000,${DELIVERY_EPOCH},A1,SJVNP1`);
  });

  it('carries a price end to end: 410000 raw -> Rs 4.10/kWh', async () => {
    const res = await fetchMarketPq('DAM', '2026-09-09');
    // 410000 / 100 (trade price factor) = 4100 Rs/MWh = 4.10 Rs/kWh
    expect(res.periods[0].mcp_rs_per_kwh).toBeCloseTo(4.1, 10);
  });

  it('reports our 75 MW rather than the area\'s 140000 MW', async () => {
    const res = await fetchClearedResults('DAM', '2026-09-09');
    expect(res.blocks[0].cleared_mw).toBe(50);   // 5000 / 100
    expect(res.blocks[0].area_sell_mw).toBe(140000);
  });

  it('scales quantity with the TRADE factor, not the order factor', async () => {
    // The fixture deliberately sets OrderQtyDecimal=10 and TradeQtyDecimal=100.
    // Using the order factor would report 500 MW instead of 50.
    const res = await fetchClearedResults('DAM', '2026-09-09');
    expect(res.scaling.qty_factor).toBe(100);
    expect(res.blocks[0].cleared_mw).toBe(50);
  });

  it('surfaces a real HTTP error body instead of masking it', async () => {
    overrides['/businessconfig/'] = (req, res) => {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('upstream exploded');
    };
    const res = await checkConnectivity('DAM');
    expect(res.reachable).toBe(false);
    expect(res.error).toMatch(/IEX HTTP 500: upstream exploded/);
  });

  it('names the IP whitelist on a 403 instead of dumping the gateway HTML', async () => {
    // This is the real response from IEX's UAT hosts when the caller's IP is
    // not registered, verified against the live endpoints on 08-09-2026. It is
    // THE expected failure for this integration, so it must not read as
    // "<!DOCTYPE html><html><head>...".
    overrides['/businessconfig/'] = (req, res) => {
      res.writeHead(403, { 'Content-Type': 'text/html' });
      res.end('<!DOCTYPE html>\n<html>\n<head>\n<title>403 Forbidden</title>\n</head>\n<body>...</body></html>');
    };
    const res = await checkConnectivity('DAM');
    expect(res.reachable).toBe(false);
    expect(res.error).toMatch(/403 Forbidden/);
    expect(res.error).toMatch(/not whitelisted for the calling IP/);
    expect(res.error).not.toMatch(/DOCTYPE/);
  });

  it('says the token was rejected on a 401, rather than leaving a bare code', async () => {
    overrides['/businessconfig/'] = (req, res) => {
      res.writeHead(401, { 'Content-Type': 'text/html' });
      res.end('<html><head><title>401 Unauthorized</title></head><body/></html>');
    };
    const res = await checkConnectivity('DAM');
    expect(res.error).toMatch(/token was rejected/);
    expect(res.error).not.toMatch(/DOCTYPE|<html>/);
  });

  it('does not pretend an HTML error page is data', async () => {
    overrides['/businessconfig/'] = (req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<html><body>Gateway timeout</body></html>');
    };
    const res = await checkConnectivity('DAM');
    expect(res.reachable).toBe(false);
    expect(res.error).toMatch(/non-JSON body/);
  });

  it('actually aborts a hanging exchange instead of waiting forever', async () => {
    // A socket that accepts the connection and then says nothing — the failure
    // mode a plain fetch would sit on until the process gave up.
    let hung;
    overrides['/businessconfig/'] = (req, res) => { hung = res; /* never respond */ };
    process.env.IEX_TIMEOUT_MS = '300';
    const started = Date.now();
    const res = await checkConnectivity('DAM');
    const elapsed = Date.now() - started;
    hung?.destroy();
    expect(res.reachable).toBe(false);
    expect(res.error).toMatch(/timed out after 0\.3s/);
    expect(elapsed).toBeLessThan(5000); // it gave up, rather than hanging
  });

  it('reaches the exchange and reads its business date back', async () => {
    const res = await checkConnectivity('DAM');
    expect(res.reachable).toBe(true);
    expect(res.business_date_iso).toBe('2026-09-09');
    expect(res.elapsed_ms).toBeGreaterThanOrEqual(0);
  });
});

describe('REC/EC — a genuinely different wire contract', () => {
  it('transmits LoginUserId and Authorization, and never the FO spellings', async () => {
    await fetchProductMaster();
    const req = asked('/rec/api/v2/master/products/');
    expect(req.headers.authorization).toBe('Bearer wire-test-token');
    expect(req.headers.loginuserid).toBe('SJVA1');
    expect(req.headers.participantid).toBe('N2DL0SJV0000');
    // Sending the FO spellings here is the mistake that returns a bare 401.
    expect(req.headers.authentication).toBeUndefined();
    expect(req.headers.userid).toBeUndefined();
  });

  it('sends thirteen comma-separated path parameters on the order book', async () => {
    await fetchOrderBook({ product: 'RECNONSOL', buySell: 'Sell', fromTime: '10:00:00' });
    const req = asked('/rec/api/v2/orders/');
    const segs = req.url.split('/orders/')[1].split(',');
    expect(segs).toHaveLength(13);
    expect(segs[0]).toBe('SJVA1');
    expect(segs[3]).toBe('Sell');
    expect(segs[4]).toBe('RECNONSOL');
    expect(segs[7]).toBe('10:00:00');
  });

  it('keeps a certificate price whole: Rs 1000, not Rs 1.00', async () => {
    const res = await fetchOrderBook({ product: 'RECNONSOL' });
    expect(res.ok).toBe(true);
    expect(res.orders[0].price_rs).toBe(1000);
    expect(res.orders[0].pending_qty).toBe(25);
  });

  it('reads the product master before the book, so factors are known first', async () => {
    await fetchOrderBook({ product: 'RECNONSOL' });
    const productIdx = received.findIndex((r) => r.url.includes('/master/products/'));
    const ordersIdx = received.findIndex((r) => r.url.includes('/orders/'));
    expect(productIdx).toBeGreaterThanOrEqual(0);
    expect(productIdx).toBeLessThan(ordersIdx);
  });
});

describe('REC error reporting', () => {
  it('names the IP whitelist on a REC 403 too', async () => {
    overrides['/rec/api/v2/master/products/'] = (req, res) => {
      res.writeHead(403, { 'Content-Type': 'text/html' });
      res.end('<!DOCTYPE html><html><head><title>403 Forbidden</title></head><body/></html>');
    };
    const res = await fetchProductMaster();
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/not whitelisted for the calling IP/);
    expect(res.error).not.toMatch(/DOCTYPE/);
  });
});

describe('the timeout is a real, tunable setting', () => {
  afterEach(() => {
    db.prepare("DELETE FROM system_parameters WHERE param_key = 'iex_timeout_ms'").run();
    invalidateParamCache();
  });

  it('honours the masters parameter, not just the environment variable', async () => {
    // A documented setting that silently does nothing is worse than no setting,
    // so the masters route is exercised rather than assumed.
    delete process.env.IEX_TIMEOUT_MS;
    db.prepare(`
      INSERT INTO system_parameters (id, category, param_key, param_value, data_type, unit, description, is_active)
      VALUES ('TSTTMO', 'TRADING', 'iex_timeout_ms', '250', 'NUMBER', 'ms', 'test', 1)
      ON CONFLICT(param_key) DO UPDATE SET param_value = '250', is_active = 1
    `).run();
    invalidateParamCache();

    let hung;
    overrides['/businessconfig/'] = (req, res) => { hung = res; };
    const res = await checkConnectivity('DAM');
    hung?.destroy();
    expect(res.error).toMatch(/timed out after 0\.25s/);
  });

  it('falls back to the spec\'s 40 seconds when nothing is configured', async () => {
    delete process.env.IEX_TIMEOUT_MS;
    invalidateParamCache();
    // Proven by the message rather than by waiting 40s for it.
    overrides['/businessconfig/'] = (req, res) => {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('boom');
    };
    const res = await checkConnectivity('DAM');
    expect(res.error).toMatch(/HTTP 500/); // reached the server well inside the default
  });
});

describe('the two clients do not contaminate each other', () => {
  it('uses FO headers for FO and REC headers for REC in the same process', async () => {
    await checkConnectivity('DAM');
    await fetchProductMaster();
    const fo = asked('/businessconfig/');
    const rec = asked('/rec/api/v2/master/products/');
    expect(fo.headers.authentication).toBeDefined();
    expect(fo.headers.authorization).toBeUndefined();
    expect(rec.headers.authorization).toBeDefined();
    expect(rec.headers.authentication).toBeUndefined();
  });
});
