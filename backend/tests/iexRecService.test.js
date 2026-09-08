/**
 * IEX REC & EC client.
 *
 * The two things most likely to be wrong here are invisible on inspection:
 * the header names differ from the FO API, and certificate prices must NOT go
 * through the Rs/MWh -> Rs/kWh conversion the rest of the platform applies.
 * Both are pinned below.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  getRecConfig,
  fetchProductMaster,
  fetchOrderBook,
  fetchTradeBook,
  checkRecConnectivity,
  placeRecOrder,
  clearRecProductCache,
} from '../src/services/iexRecService.js';

function jwtWithExp(expSeconds) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ unique_name: 'SJVA1', exp: expSeconds })}.sig`;
}
const FUTURE = Math.floor(Date.now() / 1000) + 3600;

const ENV_KEYS = [
  'IEX_ENABLED', 'IEX_BASE_URL', 'IEX_LOGIN_USER_ID', 'IEX_PARTICIPANT_ID',
  'IEX_PORTFOLIO_ID', 'IEX_API_TOKEN', 'IEX_REC_API_TOKEN', 'IEX_ENVIRONMENT',
  'IEX_ENFORCE_TOKEN_EXPIRY',
];

function liveConfig() {
  process.env.IEX_ENABLED = 'true';
  process.env.IEX_LOGIN_USER_ID = 'SJVA1';
  process.env.IEX_PARTICIPANT_ID = 'N2DL0SJV0000';
  process.env.IEX_PORTFOLIO_ID = 'ALL';
  process.env.IEX_API_TOKEN = jwtWithExp(FUTURE);
  process.env.IEX_ENVIRONMENT = 'UAT';
}

/** REC products quote to 2 decimals on both price and quantity. */
const PRODUCT_MASTER = {
  ProductDetails: [{
    Product: 'RECNONSOL', ProductDesc: 'REC Non-Solar', InstrumentName: 'REC',
    InstrumentType: 'CERT', Session: 1, QtyTick: 1, PriceTick: 100,
    BasePrice: 100000, MinQty: 100,
    PriceDecimalLocator: 100, QtyDecimalLocator: 100,
    TradingUnit: 'Certificate', QuoteUnit: 'INR',
  }],
};

function stubFetch(routes) {
  const calls = [];
  global.fetch = vi.fn(async (url, init) => {
    calls.push({ url: String(url), headers: init?.headers || {} });
    const key = Object.keys(routes).find((k) => String(url).includes(k));
    if (!key) return { ok: false, status: 404, text: async () => `no stub for ${url}` };
    return { ok: true, status: 200, text: async () => JSON.stringify(routes[key]) };
  });
  return calls;
}

beforeEach(() => {
  clearRecProductCache();
  ENV_KEYS.forEach((k) => delete process.env[k]);
});
afterEach(() => {
  vi.restoreAllMocks();
  ENV_KEYS.forEach((k) => delete process.env[k]);
});

describe('wire contract', () => {
  it('sends LoginUserId and Authorization — NOT the FO API\'s UserId/Authentication', async () => {
    // This is the whole reason REC is a separate module. Getting it wrong
    // returns 401 with nothing to explain why.
    liveConfig();
    const calls = stubFetch({ '/master/products/': PRODUCT_MASTER });
    await fetchProductMaster();
    const h = calls[0].headers;
    expect(h.LoginUserId).toBe('SJVA1');
    expect(h.Authorization).toBe(`Bearer ${process.env.IEX_API_TOKEN}`);
    expect(h.ParticipantId).toBe('N2DL0SJV0000');
    expect(h.UserId).toBeUndefined();
    expect(h.Authentication).toBeUndefined();
  });

  it('calls the REC host with the rec/api/v2 prefix', async () => {
    liveConfig();
    const calls = stubFetch({ '/master/products/': PRODUCT_MASTER });
    await fetchProductMaster();
    expect(calls[0].url).toBe('https://alpharecapi.iexindia.com/rec/api/v2/master/products/SJVA1,N2DL0SJV0000');
  });

  it('lets a REC-specific token override the shared one', () => {
    liveConfig();
    process.env.IEX_REC_API_TOKEN = 'rec-only-token';
    expect(getRecConfig().token).toBe('rec-only-token');
  });

  it('has no production host until IEX supplies one, and refuses rather than guessing', async () => {
    liveConfig();
    process.env.IEX_ENVIRONMENT = 'LIVE';
    const cfg = getRecConfig();
    expect(cfg.baseUrl).toBe('');
    expect(cfg.live).toBe(false);
    const res = await fetchOrderBook();
    expect(res.mode).toBe('STUB');
    expect(res.note).toMatch(/REC host for LIVE/);
  });
});

describe('product master', () => {
  it('keeps the decimal locators raw so the divisors stay inspectable', async () => {
    liveConfig();
    stubFetch({ '/master/products/': PRODUCT_MASTER });
    const res = await fetchProductMaster();
    expect(res.ok).toBe(true);
    expect(res.products[0]).toMatchObject({
      product: 'RECNONSOL',
      price_decimal_locator: 100,
      qty_decimal_locator: 100,
      base_price_rs: 1000, // 100000 / 100
      min_qty: 1,          // 100 / 100
    });
  });
});

describe('order book', () => {
  const ORDERS = {
    TotalRecord: 1,
    OrderDetails: [{
      OrderId: 9001, OrderTime: 1788912345, InstrumentName: 'REC', Product: 'RECNONSOL',
      Session: 1, BuySell: 'Sell', Price: 100000,
      TotalExecutedQuantity: 5000, PendingQuantity: 2500,
      Status: 'Partial', Validity: 'EOS', PortfolioId: 'SJVNP1', UserId: 'SJVA1', Error: '0',
    }],
  };

  it('scales price and quantity by the product locators', async () => {
    liveConfig();
    stubFetch({ '/master/products/': PRODUCT_MASTER, '/orders/': ORDERS });
    const res = await fetchOrderBook({ product: 'RECNONSOL' });
    expect(res.ok).toBe(true);
    expect(res.orders[0]).toMatchObject({
      order_id: 9001, side: 'SELL',
      price_rs: 1000,      // 100000 / 100
      executed_qty: 50,    // 5000 / 100
      pending_qty: 25,
      scaled: true,
    });
  });

  it('does NOT divide a certificate price by 1000 the way an Rs/MWh price is', async () => {
    // REC is priced per certificate. Reusing the FO conversion would report
    // Rs 1.00 for a Rs 1000 certificate.
    liveConfig();
    stubFetch({ '/master/products/': PRODUCT_MASTER, '/orders/': ORDERS });
    const res = await fetchOrderBook({ product: 'RECNONSOL' });
    expect(res.orders[0].price_rs).toBe(1000);
    expect(res.orders[0]).not.toHaveProperty('price_rs_per_kwh');
  });

  it('treats the spec\'s "0" success sentinel as no error', async () => {
    liveConfig();
    stubFetch({ '/master/products/': PRODUCT_MASTER, '/orders/': ORDERS });
    const res = await fetchOrderBook({ product: 'RECNONSOL' });
    expect(res.orders[0].error).toBeNull();
  });

  it('sends all thirteen path parameters, wildcarding what was not given', async () => {
    liveConfig();
    const calls = stubFetch({ '/master/products/': PRODUCT_MASTER, '/orders/': ORDERS });
    await fetchOrderBook({ product: 'RECNONSOL', buySell: 'Sell', fromTime: '10:00:00' });
    const url = calls.find((c) => c.url.includes('/orders/')).url;
    const segs = url.split('/orders/')[1].split(',');
    expect(segs).toHaveLength(13);
    expect(segs.slice(0, 6)).toEqual(['SJVA1', 'N2DL0SJV0000', 'ALL', 'Sell', 'RECNONSOL', 'ALL']);
    expect(segs[7]).toBe('10:00:00');
  });

  it('counts rows it could not scale instead of passing them off as certificates', async () => {
    liveConfig();
    // Book carries a product the master never described.
    stubFetch({
      '/master/products/': PRODUCT_MASTER,
      '/orders/': { OrderDetails: [{ OrderId: 1, Product: 'UNKNOWN', Price: 12345, BuySell: 'Buy' }] },
    });
    const res = await fetchOrderBook();
    expect(res.unscaled_rows).toBe(1);
    expect(res.orders[0].scaled).toBe(false);
  });
});

describe('trade book', () => {
  const TRADES = {
    TotalRecord: 1,
    TradeDetails: [{
      TradeId: 77, OrderId: 9001, TradeTime: 1788912999, InstrumentName: 'REC',
      Product: 'RECNONSOL', Session: 1, BuySell: 'Sell',
      Quantity: 5000, TradedPrice: 100000, PortfolioId: 'SJVNP1', UserId: 'SJVA1',
    }],
  };

  it('scales both sides and computes the trade value from the scaled pair', async () => {
    liveConfig();
    stubFetch({ '/master/products/': PRODUCT_MASTER, '/trades/': TRADES });
    const res = await fetchTradeBook({ product: 'RECNONSOL' });
    expect(res.trades[0]).toMatchObject({
      trade_id: 77, qty: 50, price_rs: 1000, value_rs: 50000,
    });
  });
});

describe('safety', () => {
  it('refuses to place a REC order', async () => {
    await expect(placeRecOrder()).rejects.toThrow(/not implemented/i);
  });

  it('reports an unreachable exchange as a bad answer, not a crash', async () => {
    liveConfig();
    global.fetch = vi.fn(async () => { throw new Error('ECONNREFUSED'); });
    const res = await checkRecConnectivity();
    expect(res.reachable).toBe(false);
    expect(res.error).toMatch(/ECONNREFUSED/);
  });

  it('stays in stub mode when the integration is off', async () => {
    const res = await fetchTradeBook();
    expect(res.mode).toBe('STUB');
    expect(res.trades).toBeNull();
  });
});
