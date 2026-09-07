/**
 * IEX Front Office client.
 *
 * These tests exist because every one of them corresponds to a way the numbers
 * can be wrong by a power of ten, by 5.5 hours, or by the size of a whole bid
 * area — mistakes that produce plausible-looking settlement figures rather than
 * an error anyone would notice.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  readTokenExpiry,
  unscale,
  istMidnightEpoch,
  epochToIstDate,
  mwhToKwhPrice,
  getIexConfig,
  getDecimals,
  clearDecimalsCache,
  fetchMarketPq,
  fetchClearedResults,
  checkConnectivity,
  fetchDeliveryDates,
} from '../src/services/iexService.js';

/** A JWT with a chosen exp. Unsigned — nothing here verifies signatures. */
function jwtWithExp(expSeconds) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ unique_name: 'SJVA1', exp: expSeconds })}.sig`;
}

const FUTURE = Math.floor(Date.now() / 1000) + 3600;

/** Point the module at a fake exchange and hand back the captured URLs. */
function liveConfig({ token = jwtWithExp(FUTURE), bidArea = 'ALL', portfolio = 'ALL' } = {}) {
  process.env.IEX_ENABLED = 'true';
  process.env.IEX_BASE_URL = 'https://iex.example/';
  process.env.IEX_LOGIN_USER_ID = 'SJVA1';
  process.env.IEX_PARTICIPANT_ID = 'N2DL0SJV0000';
  process.env.IEX_BID_AREA_ID = bidArea;
  process.env.IEX_PORTFOLIO_ID = portfolio;
  process.env.IEX_API_TOKEN = token;
}

const IEX_ENV_KEYS = [
  'IEX_ENABLED', 'IEX_BASE_URL', 'IEX_LOGIN_USER_ID', 'IEX_PARTICIPANT_ID',
  'IEX_BID_AREA_ID', 'IEX_PORTFOLIO_ID', 'IEX_API_TOKEN', 'IEX_ENVIRONMENT',
];

/** Asset Master: 2 decimal places on everything, expressed as the divisor 100. */
const ASSET_MASTER = {
  AssetDetails: [{
    AssetId: 'A1', AssetName: 'IEX-DAM',
    OrderQtyDecimal: 100, OrderPriceDecimal: 100,
    TradeQtyDecimal: 100, TradePriceDecimal: 100,
  }],
};

/**
 * Route fake responses by URL fragment, and record every URL requested so the
 * tests can assert on the shape of the path itself.
 */
function stubFetch(routes) {
  const calls = [];
  global.fetch = vi.fn(async (url) => {
    calls.push(String(url));
    const key = Object.keys(routes).find((k) => String(url).includes(k));
    if (!key) return { ok: false, status: 404, text: async () => `no stub for ${url}` };
    return { ok: true, status: 200, text: async () => JSON.stringify(routes[key]) };
  });
  return calls;
}

beforeEach(() => {
  clearDecimalsCache();
  IEX_ENV_KEYS.forEach((k) => delete process.env[k]);
});

afterEach(() => {
  vi.restoreAllMocks();
  IEX_ENV_KEYS.forEach((k) => delete process.env[k]);
});

describe('scaling', () => {
  it('treats the Asset Master decimal as the divisor, not an exponent', () => {
    // The spec's own worked example: display 10.0 with a decimal of 10 arrives
    // as 100. Read as an exponent this would divide by 10^10.
    expect(unscale(100, 10)).toBe(10);
    expect(unscale(1234, 100)).toBe(12.34);
    expect(unscale(7, 1)).toBe(7);
  });

  it('divides by one rather than by zero when the factor is missing', () => {
    expect(unscale(500, 0)).toBe(500);
    expect(unscale(500, undefined)).toBe(500);
    expect(unscale(500, -1)).toBe(500);
  });

  it('converts exchange Rs/MWh to platform Rs/kWh', () => {
    expect(mwhToKwhPrice(4100)).toBeCloseTo(4.1, 10);
  });
});

describe('token expiry', () => {
  it('reads the expiry out of the issued JWT', () => {
    expect(readTokenExpiry(jwtWithExp(1785059488))).toBe(1785059488);
  });

  it('treats an opaque token as valid but not introspectable', () => {
    expect(readTokenExpiry('not-a-jwt')).toBeNull();
    expect(readTokenExpiry('')).toBeNull();
  });

  it('flags the UAT token IEX issued as expired', () => {
    liveConfig({ token: jwtWithExp(1785059488) }); // 2026-07-26T09:51:28Z
    const cfg = getIexConfig();
    expect(cfg.tokenExpired).toBe(true);
    expect(cfg.tokenExpiresAtIso).toBe('2026-07-26T09:51:28.000Z');
  });

  it('refuses to send a request on an expired token instead of collecting a 401', async () => {
    liveConfig({ token: jwtWithExp(1785059488) });
    const calls = stubFetch({ '/master/assets': ASSET_MASTER });
    const res = await fetchMarketPq('DAM', '2026-09-08');
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/token expired at 2026-07-26/i);
    expect(calls).toHaveLength(0); // nothing left the process
  });
});

describe('delivery dates', () => {
  it('computes IST midnight, not UTC midnight, for the fallback', () => {
    // 2026-09-08 00:00 IST is 2026-09-07 18:30 UTC.
    expect(istMidnightEpoch('2026-09-08')).toBe(Date.parse('2026-09-07T18:30:00Z') / 1000);
    expect(epochToIstDate(istMidnightEpoch('2026-09-08'))).toBe('2026-09-08');
  });

  it('refuses a date it cannot parse rather than sending NaN to the exchange', () => {
    expect(() => istMidnightEpoch('08-09-2026')).toThrow(/YYYY-MM-DD/);
  });

  it("prefers the exchange's own epoch over our computed one", async () => {
    liveConfig();
    // Deliberately 6 hours off our computed value: if we compute rather than
    // ask, the assertion below fails.
    const exchangeEpoch = istMidnightEpoch('2026-09-08') + 6 * 3600;
    const calls = stubFetch({
      '/master/assets': ASSET_MASTER,
      '/deliverydates/': { DeliveryDates: [{ DeliveryDateId: 'T + 1', DeliveryDate: exchangeEpoch }] },
      '/pqresults/': { PQDetails: [] },
    });
    const res = await fetchMarketPq('DAM', '2026-09-08');
    expect(res.ok).toBe(true);
    expect(res.delivery_date_source).toBe('EXCHANGE');
    expect(calls.some((u) => u.includes(`/pqresults/SJVA1,N2DL0SJV0000,${exchangeEpoch}`))).toBe(true);
  });

  it('falls back to a computed date but says so, when the exchange does not list it', async () => {
    liveConfig();
    stubFetch({
      '/master/assets': ASSET_MASTER,
      '/deliverydates/': { DeliveryDates: [{ DeliveryDateId: 'T + 1', DeliveryDate: istMidnightEpoch('2026-09-09') }] },
      '/pqresults/': { PQDetails: [] },
    });
    const res = await fetchMarketPq('DAM', '2026-09-08');
    expect(res.delivery_date_source).toBe('COMPUTED');
    expect(res.warning).toMatch(/not in the exchange's open delivery dates/);
  });

  it('reports the delivery dates the exchange is trading', async () => {
    liveConfig();
    stubFetch({ '/deliverydates/': { DeliveryDates: [{ DeliveryDateId: 'T + 1', DeliveryDate: istMidnightEpoch('2026-09-08') }] } });
    const res = await fetchDeliveryDates('DAM');
    expect(res.ok).toBe(true);
    expect(res.dates).toEqual([{ delivery_date_id: 'T + 1', epoch_seconds: istMidnightEpoch('2026-09-08'), iso_date: '2026-09-08' }]);
  });
});

describe('asset master decimals', () => {
  it('reads the spec field names and remembers them', async () => {
    liveConfig();
    const calls = stubFetch({ '/master/assets': ASSET_MASTER });
    const first = await getDecimals('DAM');
    expect(first).toMatchObject({ orderQty: 100, orderPrice: 100, tradeQty: 100, tradePrice: 100, source: 'ASSET_MASTER' });
    await getDecimals('DAM');
    expect(calls).toHaveLength(1); // cached, not re-fetched
  });

  it('falls back to the order factors when the exchange omits trade factors', async () => {
    liveConfig();
    stubFetch({ '/master/assets': { AssetDetails: [{ OrderQtyDecimal: 10, OrderPriceDecimal: 100 }] } });
    const d = await getDecimals('DAM');
    expect(d.tradeQty).toBe(10);
    expect(d.tradePrice).toBe(100);
  });

  it('refuses to guess a scaling factor it could not read', async () => {
    liveConfig();
    stubFetch({ '/master/assets': { AssetDetails: [] } });
    await expect(getDecimals('DAM')).rejects.toThrow(/no assets/i);
  });
});

describe('PQ results', () => {
  const PQ = {
    LastUpdatedTime: 1757300000,
    PQDetails: [{
      FromPeriodId: '00:00',
      ToPeriodId: '00:15',
      BidAreaDetails: [
        { BidArea: 'A1', Price: 410000, BuyQty: 150000, SellQty: 120000 },
        { BidArea: 'N3', Price: 380000, BuyQty: 90000, SellQty: 80000 },
      ],
    }],
  };

  it('unnests BidAreaDetails and converts Rs/MWh to Rs/kWh', async () => {
    liveConfig({ bidArea: 'A1' });
    stubFetch({
      '/master/assets': ASSET_MASTER,
      '/deliverydates/': { DeliveryDates: [{ DeliveryDate: istMidnightEpoch('2026-09-08') }] },
      '/pqresults/': PQ,
    });
    const res = await fetchMarketPq('DAM', '2026-09-08');
    expect(res.ok).toBe(true);
    // 410000 / 100 = 4100 Rs/MWh = 4.10 Rs/kWh
    expect(res.periods[0].mcp_rs_per_kwh).toBeCloseTo(4.1, 10);
    expect(res.periods[0].buy_mw).toBe(1500);
    expect(res.periods[0].areas).toHaveLength(1);
  });

  it('takes the configured bid area rather than whichever the exchange lists first', async () => {
    liveConfig({ bidArea: 'N3' });
    stubFetch({
      '/master/assets': ASSET_MASTER,
      '/deliverydates/': { DeliveryDates: [{ DeliveryDate: istMidnightEpoch('2026-09-08') }] },
      '/pqresults/': PQ,
    });
    const res = await fetchMarketPq('DAM', '2026-09-08');
    expect(res.periods[0].areas.map((a) => a.bid_area)).toEqual(['N3']);
    expect(res.periods[0].mcp_rs_per_kwh).toBeCloseTo(3.8, 10);
  });

  it("keeps every area when the configured area is 'ALL'", async () => {
    liveConfig({ bidArea: 'ALL' });
    stubFetch({
      '/master/assets': ASSET_MASTER,
      '/deliverydates/': { DeliveryDates: [{ DeliveryDate: istMidnightEpoch('2026-09-08') }] },
      '/pqresults/': PQ,
    });
    const res = await fetchMarketPq('DAM', '2026-09-08');
    expect(res.periods[0].areas).toHaveLength(2);
    expect(res.periods[0].sell_mw).toBe(2000); // 1200 + 800
  });
});

describe('portfolio schedule report', () => {
  const REPORT = {
    ReportDetails: [{
      DeliveryDate: istMidnightEpoch('2026-09-08'),
      AssetId: 'A1',
      BidAreaId: 'A1',
      ParticipantId: 'N2DL0SJV0000',
      PeriodDetails: [{
        FromPeriodId: '00:00',
        ToPeriodId: '00:15',
        AreaPrice: 410000,
        AreaBuyQty: 15000000,
        AreaSellQty: 14000000,
        ScheduleDetails: [
          { PortfolioId: 'SJVNP1', Quantity: 5000, SingleBidQty: 3000, BlockBidQty: 2000 },
          { PortfolioId: 'SJVNP2', Quantity: 2500, SingleBidQty: 2500, BlockBidQty: 0 },
        ],
      }],
    }],
  };

  function stubReport() {
    return stubFetch({
      '/master/assets': ASSET_MASTER,
      '/deliverydates/': { DeliveryDates: [{ DeliveryDate: istMidnightEpoch('2026-09-08') }] },
      '/portfolioschedulereport/': REPORT,
    });
  }

  it("reports OUR scheduled quantity, not the whole bid area's volume", async () => {
    liveConfig();
    stubReport();
    const res = await fetchClearedResults('DAM', '2026-09-08');
    expect(res.ok).toBe(true);
    // (5000 + 2500) / 100 = 75 MW for us; the area traded 140000 MW.
    expect(res.blocks[0].cleared_mw).toBe(75);
    expect(res.blocks[0].area_sell_mw).toBe(140000);
  });

  it('converts the area price to Rs/kWh and keeps the portfolio split', async () => {
    liveConfig();
    stubReport();
    const res = await fetchClearedResults('DAM', '2026-09-08');
    expect(res.blocks[0].cleared_price_rs_per_kwh).toBeCloseTo(4.1, 10);
    expect(res.blocks[0].portfolios).toEqual([
      { portfolio_id: 'SJVNP1', mw: 50, single_bid_mw: 30, block_bid_mw: 20 },
      { portfolio_id: 'SJVNP2', mw: 25, single_bid_mw: 25, block_bid_mw: 0 },
    ]);
  });

  it('sends all five path parameters the spec requires', async () => {
    liveConfig({ bidArea: 'A1', portfolio: 'SJVNP1' });
    const calls = stubReport();
    await fetchClearedResults('DAM', '2026-09-08');
    const url = calls.find((u) => u.includes('/portfolioschedulereport/'));
    expect(url).toContain(`/portfolioschedulereport/SJVA1,N2DL0SJV0000,${istMidnightEpoch('2026-09-08')},A1,SJVNP1`);
  });

  it('reports the scaling factor it applied, so a wrong assumption is visible', async () => {
    liveConfig();
    stubReport();
    const res = await fetchClearedResults('DAM', '2026-09-08');
    expect(res.scaling).toEqual({ qty_factor: 100, price_factor: 100, source: 'ASSET_MASTER' });
  });
});

describe('configuration and connectivity', () => {
  it('stays in stub mode with no base URL, and names what is missing', async () => {
    process.env.IEX_ENABLED = 'true';
    process.env.IEX_API_TOKEN = jwtWithExp(FUTURE);
    process.env.IEX_LOGIN_USER_ID = 'SJVA1';
    const cfg = getIexConfig();
    expect(cfg.live).toBe(false);
    const res = await fetchMarketPq('DAM', '2026-09-08');
    expect(res.mode).toBe('STUB');
    expect(res.note).toMatch(/iex_base_url/);
  });

  it('rejects a product IEX has no FO API for', async () => {
    const res = await fetchMarketPq('ESCERTS', '2026-09-08');
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/ESCERTS/);
  });

  it('reports an unreachable exchange as a bad answer, not a crash', async () => {
    liveConfig();
    global.fetch = vi.fn(async () => { throw new Error('ECONNREFUSED'); });
    const res = await checkConnectivity('DAM');
    expect(res.ok).toBe(false);
    expect(res.reachable).toBe(false);
    expect(res.error).toMatch(/ECONNREFUSED/);
  });

  it('reads the business date back on a good round trip', async () => {
    liveConfig();
    stubFetch({ '/businessconfig/': { BusinessDate: istMidnightEpoch('2026-09-07'), MaxBlockBidEntries: 50 } });
    const res = await checkConnectivity('DAM');
    expect(res.reachable).toBe(true);
    expect(res.business_date_iso).toBe('2026-09-07');
  });

  it('surfaces an HTTP error body rather than swallowing it', async () => {
    liveConfig();
    global.fetch = vi.fn(async () => ({ ok: false, status: 403, text: async () => 'IP not whitelisted' }));
    const res = await checkConnectivity('DAM');
    expect(res.error).toMatch(/IEX HTTP 403.*IP not whitelisted/);
  });
});
