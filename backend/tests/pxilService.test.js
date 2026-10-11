import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  parsePxilDate, parsePxilTimestamp, dayFirstConfirmed, normaliseEnvelope, pick,
  extractTamGtam, extractSlotWise, extractSlots, extractStoaBreakup, extractFormatD,
  extractDor, extractReverseAuction,
  fetchTamGtam, fetchSlotWise, fetchFormatD, fetchMemberDor, fetchReverseAuctionL1,
  getPxilConfig,
  extractTradeMargin,
  fetchTradeMargin,
  classifyProbe,
  ipNotAllowed,
  noDataAvailable,
  rangeRefused,
  rateLimitWait,
  pxilBlockedUntil,
  clearPxilBlock,
  splitDateRange,
  halveDateRange,
  DOR_WINDOW_DAYS,
  summariseSlotLabelling,
  summariseStoaBreakup,
  summariseDorReconciliation,
  summariseFormatDFields,
} from '../src/services/pxilService.js';

describe('date parsing', () => {
  it('reads both orders PXIL sends, by where the year sits', () => {
    expect(parsePxilDate('2026-01-11')).toBe('2026-01-11'); // Member DOR
    expect(parsePxilDate('06-11-2025')).toBe('2025-11-06'); // TAM-GTAM
    expect(parsePxilDate('01-02-2026')).toBe('2026-02-01'); // day first, not Jan 2nd
  });

  it('treats a blank as absent rather than an error', () => {
    // Format-D returns "" for every field in its own sample.
    expect(parsePxilDate('')).toBeNull();
    expect(parsePxilDate(null)).toBeNull();
    expect(parsePxilDate(undefined)).toBeNull();
  });

  it('refuses a date it cannot place', () => {
    expect(parsePxilDate('DD-MM-YYYY')).toBeNull();
    expect(parsePxilDate('35-01-2026')).toBeNull();
    expect(parsePxilDate('01-13-2026')).toBeNull();
  });

  it('splits a timestamp into date and time', () => {
    expect(parsePxilTimestamp('06-01-2026 16:44:59.529')).toBe('2026-01-06T16:44:59.529');
    expect(parsePxilTimestamp('07-01-2026 20:00')).toBe('2026-01-07T20:00');
    expect(parsePxilTimestamp('')).toBeNull();
  });
});

describe('day-first confirmation', () => {
  it('stays unconfirmed while every first component could be a month', () => {
    expect(dayFirstConfirmed(['01-02-2026', '06-11-2025'])).toBe(false);
  });

  it('is proven the moment a first component exceeds 12', () => {
    expect(dayFirstConfirmed(['01-02-2026', '28-02-2026'])).toBe(true);
  });

  it('ignores values that are not in that shape', () => {
    expect(dayFirstConfirmed(['2026-01-11', '', null])).toBe(false);
  });
});

describe('envelope normalisation', () => {
  it('reads the CNSAPI wrapper used by TAM-GTAM, Format-D and Trade Margin', () => {
    const env = normaliseEnvelope({
      ResponseStatus: { Code: 'CNSAPI-200', Message: 'Success' },
      ResponseBody: { Trades: [] },
    });
    expect(env.ok).toBe(true);
    expect(env.code).toBe('CNSAPI-200');
    expect(env.body).toEqual({ Trades: [] });
  });

  it('reads Member DOR StatusCode/StatusMessage', () => {
    const env = normaliseEnvelope({
      ResponseBody: { DOR: [] },
      ResponseStatus: { StatusCode: '200', StatusMessage: 'Success' },
    });
    expect(env.ok).toBe(true);
    expect(env.message).toBe('Success');
  });

  it('reads the flat reverse-auction shape that has no wrapper at all', () => {
    const env = normaliseEnvelope({
      message: 'success', statuscode: 200, data: [{ auctionID: 'A1' }], timestamp: '13-01-2026 12:54:07',
    });
    expect(env.ok).toBe(true);
    expect(env.body).toEqual([{ auctionID: 'A1' }]);
    expect(env.timestamp).toBe('2026-01-13T12:54:07');
  });

  it('does not pass off a non-200 as success', () => {
    expect(normaliseEnvelope({ ResponseStatus: { Code: 'CNSAPI-401' } }).ok).toBe(false);
    expect(normaliseEnvelope({ statuscode: 500, message: 'boom' }).ok).toBe(false);
    expect(normaliseEnvelope(null).ok).toBe(false);
  });

  // Verbatim from production and staging, 5 Oct 2026, on all four billing reports.
  const NO_DATA = { message: 'No data available', statuscode: 404, timestamp: '05-10-2026 00:18:13' };

  it('reads a 404 "No data available" as an empty report, not a failure', () => {
    const env = normaliseEnvelope(NO_DATA);
    expect(env.ok).toBe(true);
    expect(env.empty).toBe(true);
    expect(env.code).toBe(404);
    expect(extractTamGtam(env.body)).toEqual([]);
    expect(extractSlotWise(env.body)).toEqual([]);
    expect(extractFormatD(env.body)).toEqual([]);
    expect(extractTradeMargin(env.body).rows).toEqual([]);
  });

  it('does not take any other 404 for an empty report', () => {
    // A mistyped path must stay a failure, or a typo would read as a quiet month.
    expect(noDataAvailable({ message: 'Not Found', statuscode: 404 })).toBe(false);
    expect(noDataAvailable({ detail: 'Not found.' })).toBe(false);
    expect(noDataAvailable({ message: 'No data available', statuscode: 200 })).toBe(false);
    expect(noDataAvailable(null)).toBe(false);
    expect(normaliseEnvelope({ message: 'Not Found', statuscode: 404 }).ok).toBe(false);
  });

  it('an empty body on a 200 is success, not an error', () => {
    // A non-trading day legitimately returns nothing.
    const env = normaliseEnvelope({ ResponseStatus: { Code: 'CNSAPI-200' }, ResponseBody: { TAMGTAM: [] } });
    expect(env.ok).toBe(true);
    expect(extractTamGtam(env.body)).toEqual([]);
  });
});

describe('multi-spelling keys', () => {
  it('takes whichever spelling arrived', () => {
    expect(pick({ 'InitialMargin(PostTradeMargin)': 5 }, 'InitialMargin(PostTradeMargin)', 'InitialMargin(Post-Trade Margin)')).toBe(5);
    expect(pick({ 'InitialMargin(Post-Trade Margin)': 7 }, 'InitialMargin(PostTradeMargin)', 'InitialMargin(Post-Trade Margin)')).toBe(7);
    expect(pick({}, 'a', 'b')).toBeUndefined();
  });
});

describe('TAM-GTAM extraction', () => {
  const body = {
    TAMGTAM: [{
      Date: '06-11-2025',
      EntityId: 'P100',
      EntityName: 'MOCK',
      Applications: [
        {
          ApplicationNo: 'MO433-0WR5468',
          PortfolioId: 'MOCC10240001',
          BuySell: 'B',
          DeliveryDate: '01-02-2026',
          DeliveryEndDate: '28-02-2026',
          PriceRsMWh: 3500.5,
          TradedQtyMWh: 24,
          TradeValue: 84012,
          'InitialMargin(PostTradeMargin)': 50000,
        },
        {
          ApplicationNo: 'MO433-0WR5469',
          BuySell: 'S',
          'InitialMargin(Post-Trade Margin)': 25000,
        },
      ],
    }],
  };

  it('flattens entity/application nesting to one row per application', () => {
    const rows = extractTamGtam(body);
    expect(rows).toHaveLength(2);
    expect(rows[0].entity_id).toBe('P100');
    expect(rows[1].entity_id).toBe('P100');
  });

  it('converts every date to ISO', () => {
    const [row] = extractTamGtam(body);
    expect(row.trade_date).toBe('2025-11-06');
    expect(row.delivery_date).toBe('2026-02-01');
    expect(row.delivery_end_date).toBe('2026-02-28');
  });

  it('picks up the margin under either spelling', () => {
    const rows = extractTamGtam(body);
    expect(rows[0].initial_margin).toBe(50000);
    expect(rows[1].initial_margin).toBe(25000);
  });

  it('keeps buy and sell legs apart instead of netting them', () => {
    const rows = extractTamGtam(body);
    expect(rows.map((r) => r.side)).toEqual(['B', 'S']);
  });

  it('reads a missing numeric as zero, not NaN', () => {
    const [, second] = extractTamGtam(body);
    expect(second.trade_value).toBe(0);
    expect(Number.isNaN(second.trade_value)).toBe(false);
  });
});

describe('slot-wise extraction', () => {
  it('derives MWh agreement from MW without overwriting what PXIL sent', () => {
    const slots = extractSlots({ S: [{ fromTime: '00:15', toTime: '00:30', Mw: 40, Mwh: 10 }] }, 'S');
    expect(slots[0].mwh).toBe(10);
    expect(slots[0].mwh_matches_mw).toBe(true);
  });

  it('flags a slot where MWh is not MW/4 rather than silently correcting it', () => {
    const slots = extractSlots({ S: [{ fromTime: '00:15', toTime: '00:30', Mw: 40, Mwh: 40 }] }, 'S');
    expect(slots[0].mwh_matches_mw).toBe(false);
  });

  it('reports slot counts instead of assuming a 96-block day', () => {
    const rows = extractSlotWise({
      SlotWiseQuantityAndCharges: [{
        Date: '06-11-2025',
        Applications: [{
          ApplicationNo: 'A1',
          TradeSlotWiseDetails: [
            { fromTime: '00:15', toTime: '00:30', Mw: 40, Mwh: 10 },
            { fromTime: '00:30', toTime: '00:45', Mw: 40, Mwh: 12 },
          ],
          ScheduledSlotWiseDetails: [{ fromTime: '00:15', toTime: '00:30', Mw: 40, Mwh: 10 }],
        }],
      }],
    });
    expect(rows[0].trade_slot_count).toBe(2);
    expect(rows[0].scheduled_slot_count).toBe(1);
    expect(rows[0].slot_mwh_mismatches).toBe(1);
    // Times are echoed exactly as labelled — no renumbering onto a block index.
    expect(rows[0].trade_slots[0].from_time).toBe('00:15');
  });

  it('reads rows only from the renamed body key', () => {
    // PXIL discontinued the TAM-GTAM slot-wise endpoint on 30 Sep 2026; its
    // replacement answers under SlotWiseQuantityAndCharges.
    const app = { ApplicationNo: 'A1', ApprovalNo: 'NR/2026/00001/C' };
    expect(extractSlotWise({ TAMGTAM: [{ Applications: [app] }] })).toEqual([]);
    const [row] = extractSlotWise({ SlotWiseQuantityAndCharges: [{ Applications: [app] }] });
    expect(row.approval_no).toBe('NR/2026/00001/C');
  });
});

describe('STOA breakup', () => {
  const parts = {
    ApplicationNLDCCharges: 100, ApplicationRLDCCharges: 200, ApplicationSLDCCharges: 300,
    OperatingDECharges: 10, OperatingNLDCCharges: 20, OperatingRLDCCharges: 30, OperatingSLDCCharges: 40,
    TransmissionDETCharges: 1000, TransmissionStateTCharges: 2000, TransmissionZonalTCharges: 3000.55,
  };

  it('reconciles when the ten components are the whole of STOA', () => {
    const b = extractStoaBreakup({ STOACharges: 6700.55, ...parts });
    expect(b.component_sum).toBe(6700.55);
    expect(b.components.transmission_zonal).toBe(3000.55);
    expect(b.reconciles).toBe(true);
  });

  it('carries a gap to the paisa instead of absorbing it', () => {
    const b = extractStoaBreakup({ STOACharges: 7000, ...parts });
    expect(b.reconciles).toBe(false);
    expect(b.variance).toBe(299.45);
  });

  it('does not call a missing breakup a mismatch', () => {
    const b = extractStoaBreakup({ STOACharges: 500 });
    expect(b.present).toBe(false);
    expect(b.reconciles).toBeNull();
    expect(b.variance).toBeNull();
  });

  it('puts the breakup and the money on each slot-wise row', () => {
    const [row] = extractSlotWise({
      SlotWiseQuantityAndCharges: [{ Applications: [{ ApplicationNo: 'A1', STOACharges: 7000, PXILFees: 12, ...parts }] }],
    });
    expect(row.stoa_charges).toBe(7000);
    expect(row.pxil_fees).toBe(12);
    expect(row.stoa_breakup.reconciles).toBe(false);
  });

  it('says when every row had zero STOA and nothing was tested', () => {
    const zero = extractSlotWise({ SlotWiseQuantityAndCharges: [{ Applications: [{ STOACharges: 0, ApplicationNLDCCharges: 0 }] }] });
    expect(summariseStoaBreakup(zero).verdict).toBe('ALL_ZERO');
    // No rows at all is a quiet range, not a sign the old endpoint was called.
    expect(summariseStoaBreakup([]).verdict).toBe('NO_ROWS');
    const off = extractSlotWise({ SlotWiseQuantityAndCharges: [{ Applications: [{ STOACharges: 7000, ...parts }] }] });
    expect(summariseStoaBreakup(off)).toMatchObject({ verdict: 'GAP', unreconciled: 1, largest_variance: 299.45 });
  });
});

describe('Format-D extraction', () => {
  it('survives the all-blank sample the document ships', () => {
    const rows = extractFormatD({
      Trades: [{
        ApplicationNo: '', Product: '', StartDate: '', EndDate: '',
        StartTime: '', EndTime: '', ScheduledVolume: 0,
        SellerName: '', SellerState: '', BuyerName: '', BuyerState: '',
        TransactionPrice: 0, TransactionRate: 0,
      }],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].start_date).toBeNull();
    expect(rows[0].application_no).toBeNull();
  });

  it('maps a populated row', () => {
    const [row] = extractFormatD({
      Trades: [{
        ApplicationNo: 'FD-1', Product: 'Daily', StartDate: '01-02-2026', EndDate: '28-02-2026',
        StartTime: '00:00', EndTime: '24:00', ScheduledVolume: 240,
        SellerName: 'SJVN', SellerState: 'HP', BuyerName: 'Goa', BuyerState: 'GA',
        TransactionPrice: 4500, TransactionRate: 4.5,
      }],
    });
    expect(row.start_date).toBe('2026-02-01');
    expect(row.end_date).toBe('2026-02-28');
    expect(row.seller_state).toBe('HP');
    expect(row.scheduled_volume).toBe(240);
  });
});

describe('Member DOR reconciliation', () => {
  // The figures PXIL printed in their own sample.
  const documentSample = {
    DOR: [{
      ApplicationNo: 'MG320260101WR32983',
      PortfolioID: '524',
      BuySell: 'B',
      delivery_date_from: '2026-01-11',
      delivery_date_to: '2026-01-11',
      Category: { Charges: 0, Fees: 4760.35, IGST: 856.863, CGST: 0.0, SGST: 0.0, CP: 1320997.15 },
      Total: 1442000.683,
    }],
  };

  it("catches that the document's own Total does not add up", () => {
    const [row] = extractDor(documentSample);
    expect(row.component_sum).toBe(1326614.36);
    expect(row.total).toBe(1442000.683);
    expect(row.total_variance).toBe(115386.32);
    expect(row.total_reconciles).toBe(false);
  });

  it('accepts a row whose components do add up', () => {
    const [row] = extractDor({
      DOR: [{
        ApplicationNo: 'OK-1',
        Category: { Charges: 100, Fees: 50, IGST: 27, CGST: 0, SGST: 0, CP: 823 },
        Total: 1000,
      }],
    });
    expect(row.total_reconciles).toBe(true);
    expect(row.total_variance).toBe(0);
  });

  it('does not let sub-paise float noise read as a variance', () => {
    const [row] = extractDor({
      DOR: [{ Category: { Charges: 0.1, Fees: 0.2, IGST: 0, CGST: 0, SGST: 0, CP: 0 }, Total: 0.3 }],
    });
    expect(row.total_reconciles).toBe(true);
  });

  it('splits a wide range into windows PXIL will accept', () => {
    // "The difference between From Date and To Date cannot exceed 31 days."
    const windows = splitDateRange('2026-08-01', '2026-09-29', DOR_WINDOW_DAYS);
    expect(windows).toEqual([['2026-08-01', '2026-08-31'], ['2026-09-01', '2026-09-29']]);
    // Consecutive and non-overlapping, so no day is asked for twice or skipped.
    expect(splitDateRange('2026-01-01', '2026-03-10', 31)).toEqual([
      ['2026-01-01', '2026-01-31'], ['2026-02-01', '2026-03-03'], ['2026-03-04', '2026-03-10'],
    ]);
    expect(splitDateRange('2026-09-29', '2026-09-29', 31)).toEqual([['2026-09-29', '2026-09-29']]);
    expect(splitDateRange('2026-09-01', '2026-10-01', 31)).toEqual([['2026-09-01', '2026-10-01']]);
  });

  it('halves a range without losing or repeating a day', () => {
    expect(halveDateRange('2026-04-01', '2026-04-30')).toEqual([['2026-04-01', '2026-04-15'], ['2026-04-16', '2026-04-30']]);
    expect(halveDateRange('2026-04-01', '2026-04-03')).toEqual([['2026-04-01', '2026-04-02'], ['2026-04-03', '2026-04-03']]);
    expect(halveDateRange('2026-04-01', '2026-04-02')).toEqual([['2026-04-01', '2026-04-01'], ['2026-04-02', '2026-04-02']]);
  });

  it('surfaces unreconciled rows separately on the fetch result', async () => {
    // Stub mode replays the document sample, so the mismatch must show up here.
    const res = await fetchMemberDor('2026-01-11', '2026-01-12');
    expect(res.ok).toBe(true);
    expect(res.mode).toBe('STUB');
    expect(res.unreconciled_count).toBe(1);
    expect(res.unreconciled[0].variance).toBe(115386.32);
  });
});

describe('reverse auction extraction', () => {
  it('maps the auction and its seller bids', () => {
    const [a] = extractReverseAuction([{
      auctionID: 'AnydaySSC_R/05012026040244',
      buyer: 'omkar ftw limited',
      deliveryMonth: '07-01-2026',
      auctionQuantity: 20,
      type: 'Green',
      remainingTime: '07:39:34',
      L1: 5.5,
      lastUpdate: '06-01-2026 16:44:59.529',
      auctionCloseTime: '07-01-2026 20:00',
      sellerData: [
        { sellerId: 'S1042', sellerName: 'Hari Om enterprises', bidPrice: 89, bidQuantity: 30 },
        { sellerId: 'S1043', sellerName: 'Mahesh Chemicals', bidPrice: 41, bidQuantity: 32 },
      ],
    }]);
    expect(a.auction_id).toBe('AnydaySSC_R/05012026040244');
    expect(a.delivery_month).toBe('2026-01-07');
    expect(a.last_update).toBe('2026-01-06T16:44:59.529');
    expect(a.l1).toBe(5.5);
    expect(a.sellers).toHaveLength(2);
    expect(a.sellers[1].bid_price).toBe(41);
  });

  it('handles an auction with no bids yet', () => {
    const [a] = extractReverseAuction([{ auctionID: 'A2', L1: 0 }]);
    expect(a.sellers).toEqual([]);
  });
});

describe('stub mode', () => {
  it('is off until it is configured, so nothing calls PXIL by accident', () => {
    const cfg = getPxilConfig();
    expect(cfg.live).toBe(false);
  });

  it('returns the documented shape for every endpoint without a token', async () => {
    const results = await Promise.all([
      fetchTamGtam('2026-01-11', '2026-01-12'),
      fetchSlotWise('2026-01-11', '2026-01-12'),
      fetchFormatD('2026-01-11', '2026-01-12'),
      fetchMemberDor('2026-01-11', '2026-01-12'),
      fetchReverseAuctionL1(),
    ]);
    for (const res of results) {
      expect(res.ok).toBe(true);
      expect(res.mode).toBe('STUB');
      expect(res.note).toMatch(/documented response shape/);
    }
  });

  it('parses its own stub end to end, exercising the real mapping', async () => {
    const res = await fetchTamGtam('2026-01-11', '2026-01-12');
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].trade_date).toBe('2025-11-06');
    expect(res.rows[0].delivery_end_date).toBe('2026-02-28');
    // 28 > 12 in the sample's DeliveryEndDate, but Date itself stays ambiguous.
    expect(res.date_order_confirmed).toBe(false);
  });

  it('reads the hyphenated margin spelling in the slot-wise stub', async () => {
    const res = await fetchSlotWise('2026-01-11', '2026-01-12');
    expect(res.rows[0].trade_slot_count).toBe(1);
    expect(res.rows[0].trade_slots[0].from_time).toBe('00:15');
    // The document's sample is all zeroes, so its breakup trivially balances.
    expect(res.rows[0].stoa_breakup.present).toBe(true);
    expect(res.stoa_unreconciled_count).toBe(0);
  });

  it('checks Format-D against the count PXIL declares', async () => {
    const res = await fetchFormatD('2026-01-11', '2026-01-12');
    expect(res.total_count_declared).toBe(1);
    expect(res.total_count_matches).toBe(true);
  });

  it('stamps a poll time on the reverse auction from our clock, not PXIL\'s', async () => {
    // Production and staging stamped the same moment 10h30m apart on 5 Oct 2026,
    // so PXIL's timestamp is carried as sent and never used to place the snapshot.
    const before = Date.now();
    const res = await fetchReverseAuctionL1();
    expect(Date.parse(res.polled_at)).toBeGreaterThanOrEqual(before);
    expect(res.pxil_timestamp).toBe('2026-01-13T12:54:07');
    expect(res.auctions).toHaveLength(1);
  });
});

describe('live calls, as PXIL answered on 5 Oct 2026', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    clearPxilBlock();
  });

  const live = (handler) => {
    vi.stubEnv('PXIL_ENABLED', 'true');
    vi.stubEnv('PXIL_API_TOKEN', 'test-token');
    vi.stubEnv('PXIL_BASE_URL', 'https://pxil.test');
    const calls = [];
    vi.stubGlobal('fetch', async (url, init) => {
      const u = new URL(url);
      calls.push({ path: u.pathname, params: Object.fromEntries(u.searchParams), headers: init.headers });
      const { status, body } = handler(u);
      return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) };
    });
    return calls;
  };

  const noData = { status: 404, body: { message: 'No data available', statuscode: 404, timestamp: '05-10-2026 00:18:13' } };

  it('returns an empty report for each billing API instead of an error', async () => {
    const calls = live(() => noData);
    const results = await Promise.all([
      fetchTamGtam('2026-08-01', '2026-09-29'),
      fetchSlotWise('2026-08-01', '2026-09-29'),
      fetchFormatD('2026-08-01', '2026-09-29'),
      fetchTradeMargin('2026-08-01', '2026-09-29'),
    ]);
    for (const res of results) {
      expect(res.ok).toBe(true);
      expect(res.mode).toBe('PXIL');
      expect(res.code).toBe(404);
      expect(res.rows).toEqual([]);
    }
    expect(calls.map((c) => c.path)).toContain('/PXILPublish/api/slot-wise-quantity-and-charges/');
    expect(calls.every((c) => c.headers.Authorization === 'Bearer test-token')).toBe(true);
  });

  it('still fails on a 404 that is not an empty report', async () => {
    live(() => ({ status: 404, body: { detail: 'Not found.' } }));
    const res = await fetchTamGtam('2026-08-01', '2026-09-29');
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/HTTP 404/);
  });

  it('fetches Member DOR in 31-day windows and joins the rows', async () => {
    const row = (day) => ({
      ApplicationNo: `A-${day}`, BuySell: 'B', delivery_date_from: day, delivery_date_to: day,
      Category: { Charges: 0, Fees: 10, IGST: 0, CGST: 0, SGST: 0, CP: 90 }, Total: 100,
    });
    const calls = live((u) => {
      // PXIL's own rule, so a call wider than a window fails the test the way it failed live.
      const span = (Date.parse(u.searchParams.get('todate')) - Date.parse(u.searchParams.get('fromdate'))) / 86400000;
      if (span > 31) return { status: 400, body: { message: 'Validation error - The difference between From Date and To Date cannot exceed 31 days', statuscode: 400 } };
      return u.searchParams.get('fromdate') === '2026-08-01'
        ? { status: 200, body: { ResponseBody: { DOR: [row('2026-08-15')] }, ResponseStatus: { StatusCode: '200', StatusMessage: 'Success' } } }
        : noData;
    });
    const res = await fetchMemberDor('2026-08-01', '2026-09-29');
    expect(res.ok).toBe(true);
    expect(calls.map((c) => [c.params.fromdate, c.params.todate])).toEqual([
      ['2026-08-01', '2026-08-31'], ['2026-09-01', '2026-09-29'],
    ]);
    // Version 1 API: the token travels in the query string, never the header.
    expect(calls.every((c) => c.params.APITokenNo === 'test-token' && !c.headers.Authorization)).toBe(true);
    expect(res.windows).toBe(2);
    expect(res.rows.map((r) => r.application_no)).toEqual(['A-2026-08-15']);
    expect(res.code).toBe('200');
    expect(res.repeated_across_windows).toBe(0);
  });

  it('counts a DOR row PXIL sends in two windows, without dropping it', async () => {
    const same = {
      ApplicationNo: 'A-1', BuySell: 'B', delivery_date_from: '2026-08-25', delivery_date_to: '2026-09-05',
      Category: { Charges: 0, Fees: 10, IGST: 0, CGST: 0, SGST: 0, CP: 90 }, Total: 100,
    };
    live(() => ({ status: 200, body: { ResponseBody: { DOR: [same] }, ResponseStatus: { StatusCode: '200' } } }));
    const res = await fetchMemberDor('2026-08-01', '2026-09-29');
    expect(res.rows).toHaveLength(2);
    expect(res.repeated_across_windows).toBe(1);
  });

  it('names the window when one of several fails', async () => {
    live((u) => (u.searchParams.get('fromdate') === '2026-09-01'
      ? { status: 500, body: { message: 'boom' } }
      : noData));
    const res = await fetchMemberDor('2026-08-01', '2026-09-29');
    expect(res.ok).toBe(false);
    expect(res.error).toContain('(2026-09-01 to 2026-09-29)');
  });

  // Production, 5 Oct 2026, for 1 Apr → 5 Oct and for all of FY 2025-26, on all four billing reports.
  const TOO_MANY = 'Data limit exceeded: Rows are greater than or equal to 50,000. Please reduce the date range';

  it('recognises both ways PXIL refuses a range for its size', () => {
    expect(rangeRefused({ message: TOO_MANY, statuscode: 400 })).toBe(TOO_MANY);
    expect(rangeRefused({ message: 'Validation error - The difference between From Date and To Date cannot exceed 31 days' })).toMatch(/31 days/);
    expect(rangeRefused({ message: 'Validation error - API Token is mandatory.' })).toBeNull();
    expect(rangeRefused(null)).toBeNull();
  });

  /** A PXIL that serves at most `maxDays` per call, with one trade on `tradeDay`. */
  const limited = (maxDays, tradeDay) => (u) => {
    const [from, to] = [u.searchParams.get('fromdate'), u.searchParams.get('todate')];
    if ((Date.parse(to) - Date.parse(from)) / 86400000 + 1 > maxDays) {
      return { status: 400, body: { message: TOO_MANY, statuscode: 400 } };
    }
    if (!(from <= tradeDay && tradeDay <= to)) return noData;
    return {
      status: 200,
      body: {
        ResponseStatus: { Code: 'CNSAPI-200', Message: 'Success' },
        ResponseBody: { TAMGTAM: [{ Date: '15-06-2026', EntityId: 'P1', Applications: [{ ApplicationNo: 'A1', TradedQtyMWh: 24 }] }] },
      },
    };
  };

  it('narrows a range PXIL refuses for size until every piece is answered', async () => {
    const calls = live(limited(50, '2026-06-15'));
    const res = await fetchTamGtam('2026-04-01', '2026-10-05');
    expect(res.ok).toBe(true);
    expect(res.rows.map((r) => r.application_no)).toEqual(['A1']);
    expect(res.code).toBe('CNSAPI-200');
    // 15 June can only be a day, and it was found in a piece, not the whole range.
    expect(res.date_order_confirmed).toBe(true);
    expect(res.windows).toBeGreaterThan(1);

    // The pieces PXIL answered tile the range exactly: in order, no gap, no overlap.
    const answered = calls
      .map((c) => [c.params.fromdate, c.params.todate])
      .filter(([f, t]) => (Date.parse(t) - Date.parse(f)) / 86400000 + 1 <= 50);
    expect(answered).toHaveLength(res.windows);
    expect(answered[0][0]).toBe('2026-04-01');
    expect(answered[answered.length - 1][1]).toBe('2026-10-05');
    for (let i = 1; i < answered.length; i += 1) {
      expect(Date.parse(answered[i][0]) - Date.parse(answered[i - 1][1])).toBe(86400000);
    }
  });

  it('gives up plainly when PXIL refuses even a single day', async () => {
    live(() => ({ status: 400, body: { message: TOO_MANY, statuscode: 400 } }));
    const res = await fetchSlotWise('2026-09-01', '2026-09-02');
    expect(res.ok).toBe(false);
    expect(res.error).toContain('Data limit exceeded');
    expect(res.error).toContain('(2026-09-01 to 2026-09-01)');
  });

  it('adds up the counts PXIL declares on each piece of a Format-D range', async () => {
    live((u) => {
      const [from, to] = [u.searchParams.get('fromdate'), u.searchParams.get('todate')];
      if ((Date.parse(to) - Date.parse(from)) / 86400000 + 1 > 31) return { status: 400, body: { message: TOO_MANY, statuscode: 400 } };
      return { status: 200, body: { ResponseStatus: { Code: 'CNSAPI-200' }, ResponseBody: { TotalCount: 1, Trades: [{ ApplicationNo: `F-${from}` }] } } };
    });
    const res = await fetchFormatD('2026-08-01', '2026-09-29');
    expect(res.rows).toHaveLength(2);
    expect(res.total_count_declared).toBe(2);
    expect(res.total_count_matches).toBe(true);
    expect(res.repeated_across_windows).toBe(0);
  });

  it('stops rather than hammer PXIL when a range would need too many calls', async () => {
    const calls = live(limited(1, '2026-01-01'));
    const res = await fetchTamGtam('2025-04-01', '2026-03-31');
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/choose a shorter period/);
    // PXIL shut us out for a day after about sixty calls; one click may not spend that.
    expect(calls.length).toBeLessThanOrEqual(12);
  });

  // Production, 5 Oct 2026, after roughly sixty calls in the day — on every report at once.
  const LIMIT = { status: 429, body: { message: 'Request limit exceeded. Please wait for 68472 seconds and try again.', statuscode: 429 } };

  it('reads how long PXIL says to wait, when it says', () => {
    expect(rateLimitWait(429, JSON.stringify(LIMIT.body))).toBe(68472);
    // Member DOR answered a bare 429 with no message.
    expect(rateLimitWait(429, '')).toBeNull();
    expect(rateLimitWait(404, 'wait for 5 seconds')).toBeUndefined();
  });

  it('stops calling PXIL once it says the request limit is used up', async () => {
    vi.useFakeTimers({ now: new Date('2026-10-05T10:18:25Z') });
    const calls = live(() => LIMIT);

    const first = await fetchTamGtam('2026-09-01', '2026-09-30');
    expect(first.ok).toBe(false);
    expect(first.error).toMatch(/request limit is used up/);
    // 68472 seconds after 15:48 IST is 10:49 IST the next morning.
    expect(first.error).toContain('6 Oct 2026');
    expect(first.error).toMatch(/10:49/);
    expect(calls).toHaveLength(1);

    // Every report is shut out together, and none of them is asked again.
    for (const again of [await fetchSlotWise('2026-09-01', '2026-09-30'), await fetchMemberDor('2026-08-01', '2026-09-30'), await fetchReverseAuctionL1()]) {
      expect(again.ok).toBe(false);
      expect(again.error).toMatch(/request limit is used up/);
    }
    expect(calls).toHaveLength(1);
    expect(new Date(pxilBlockedUntil()).toISOString()).toBe('2026-10-06T05:19:37.000Z');

    // Once the wait is over, calls go out again.
    vi.setSystemTime(new Date('2026-10-06T05:20:00Z'));
    expect(pxilBlockedUntil()).toBeNull();
    await fetchTamGtam('2026-09-01', '2026-09-30');
    expect(calls).toHaveLength(2);
  });

  it('does not keep halving a range into a request limit', async () => {
    let n = 0;
    const calls = live((u) => {
      n += 1;
      if (n > 3) return LIMIT;
      return { status: 400, body: { message: TOO_MANY, statuscode: 400 } };
    });
    const res = await fetchTamGtam('2026-04-01', '2026-10-05');
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/request limit is used up/);
    expect(calls).toHaveLength(4);
  });

  it('reads an idle reverse auction as no auctions', async () => {
    live(() => ({ status: 200, body: { message: 'Auction data not found', statuscode: 200, data: [], error: '', timestamp: '05-10-2026 00:18:14' } }));
    const res = await fetchReverseAuctionL1();
    expect(res.ok).toBe(true);
    expect(res.auctions).toEqual([]);
    expect(res.pxil_timestamp).toBe('2026-10-05T00:18:14');
  });
});

/* ----------------------------------------------------------- Trade Margin */

describe('trade margin', () => {
  const entity = (over = {}) => ({
    EntityId: 'C9999',
    EntityName: 'Test Entity',
    TradeDate: '15-01-2026',
    NumberOfPortfolios: 1,
    TotalTrades: 2,
    TotalMargin: 500,
    'InitialMargin(PostTradeMargin)': 100,
    DeliveryMargin: 400,
    ApplicableMargin: 500,
    Portfolios: [{
      PortfolioId: 'PF1',
      PortfolioName: 'Portfolio One',
      Applications: [
        { ApplicationNo: 'A1', BuySell: 'S', TradeValue: 300, 'InitialMargin(PostTradeMargin)': 60, DeliveryMargin: 240, ApplicableMargin: 300 },
        { ApplicationNo: 'A2', BuySell: 'B', TradeValue: 200, 'InitialMargin(PostTradeMargin)': 40, DeliveryMargin: 160, ApplicableMargin: 200 },
      ],
      Sum: {
        SumofTradeValue: 500,
        'SumofInitialMargin(PostTradeMargin)': 100,
        SumofDeliveryMargin: 400,
        SumofApplicableMargin: 500,
      },
    }],
    ...over,
  });

  it('flattens applications across portfolios', () => {
    const { rows } = extractTradeMargin({ TradeMargin: [entity()] });
    expect(rows).toHaveLength(2);
    expect(rows[0].portfolio_id).toBe('PF1');
    expect(rows[0].entity_name).toBe('Test Entity');
    expect(rows[0].trade_date).toBe('2026-01-15');
  });

  it('accepts a Sum block that matches its own applications', () => {
    const { entities } = extractTradeMargin({ TradeMargin: [entity()] });
    expect(entities[0].portfolios[0].sums_reconcile).toBe(true);
    expect(entities[0].margins_reconcile).toBe(true);
    expect(entities[0].trade_count_matches).toBe(true);
  });

  // The declared sum is what a desk would post against, so a disagreement with
  // the rows underneath has to surface rather than be smoothed over.
  it('reports the gap when a Sum block disagrees with its applications', () => {
    const e = entity();
    e.Portfolios[0].Sum.SumofTradeValue = 750;
    const { entities } = extractTradeMargin({ TradeMargin: [e] });
    const pf = entities[0].portfolios[0];
    expect(pf.sums_reconcile).toBe(false);
    expect(pf.computed.trade_value).toBe(500);
    expect(pf.declared.trade_value).toBe(750);
    expect(pf.variance.trade_value).toBe(250);
  });

  it('reports a TotalTrades that does not equal the applications returned', () => {
    const { entities } = extractTradeMargin({ TradeMargin: [entity({ TotalTrades: 10 })] });
    expect(entities[0].trade_count_matches).toBe(false);
    expect(entities[0].applications_returned).toBe(2);
    expect(entities[0].trades_declared).toBe(10);
  });

  it('reports a NumberOfPortfolios that does not match', () => {
    const { entities } = extractTradeMargin({ TradeMargin: [entity({ NumberOfPortfolios: 3 })] });
    expect(entities[0].portfolio_count_matches).toBe(false);
  });

  it('reports entity margins that do not equal the sum of their applications', () => {
    const { entities } = extractTradeMargin({ TradeMargin: [entity({ ApplicableMargin: 900 })] });
    expect(entities[0].margins_reconcile).toBe(false);
    expect(entities[0].margin_variance.applicable_margin).toBe(400);
  });

  // A portfolio with no Sum block has declared nothing. Silence is not agreement,
  // but it is also not a disagreement to report.
  it('does not invent a disagreement when no Sum block was sent', () => {
    const e = entity();
    delete e.Portfolios[0].Sum;
    const { entities } = extractTradeMargin({ TradeMargin: [e] });
    expect(entities[0].portfolios[0].sum_declared).toBe(false);
    expect(entities[0].portfolios[0].sums_reconcile).toBe(true);
  });

  it('reads both spellings of the initial margin key', () => {
    const e = entity();
    const app = e.Portfolios[0].Applications[0];
    delete app['InitialMargin(PostTradeMargin)'];
    app['InitialMargin(Post-Trade Margin)'] = 60;
    const { rows } = extractTradeMargin({ TradeMargin: [e] });
    expect(rows[0].initial_margin).toBe(60);
  });

  it('serves the documented sample in stub mode, mismatch intact', async () => {
    const r = await fetchTradeMargin('2026-01-01', '2026-01-31');
    expect(r.ok).toBe(true);
    expect(r.mode).toBe('STUB');
    expect(r.rows).toHaveLength(1);
    // Their sample declares 10 trades over one application.
    expect(r.trade_count_mismatches).toBe(1);
    expect(r.unreconciled_portfolios).toBe(0);
    // TradeDate is 15-01-2026, and 15 can only be a day.
    expect(r.date_order_confirmed).toBe(true);
  });
});

/* ------------------------------------------------------------------ probe */

describe('probe classification', () => {
  it('separates unreachable, rejected, wrong-path and empty', () => {
    expect(classifyProbe({ error: 'timed out' }).verdict).toBe('UNREACHABLE');
    expect(classifyProbe({ status: 401 }).verdict).toBe('AUTH_REJECTED');
    expect(classifyProbe({ status: 404 }).verdict).toBe('NOT_FOUND');
    expect(classifyProbe({ status: 200, content_type: 'text/html' }).verdict).toBe('NOT_JSON');
  });

  // Captured from staging, 17 Sep 2026, from a machine PXIL had not whitelisted.
  // It is a 403, so without this it would read as a rejected token.
  it('tells an unlisted source IP apart from a rejected token', () => {
    const body = '{"status": "error", "message": "Access denied. Your IP is not allowed.", "your_ip": "203.0.113.7"}';
    expect(ipNotAllowed(403, body)).toBe('203.0.113.7');
    expect(ipNotAllowed(403, '{"message": "Forbidden"}')).toBeNull();
    expect(ipNotAllowed(401, body)).toBeNull();
    expect(ipNotAllowed(403, '<html>Forbidden</html>')).toBeNull();

    const c = classifyProbe({ status: 403, ip_not_allowed: '203.0.113.7' });
    expect(c.verdict).toBe('IP_NOT_WHITELISTED');
    expect(c.detail).toContain('203.0.113.7');
    expect(classifyProbe({ status: 403 }).verdict).toBe('AUTH_REJECTED');
  });

  // All three verbatim from the first calls PXIL answered, 5 Oct 2026.
  it('reads PXIL\'s 404 "No data available" as EMPTY, and its two 400s for what they are', () => {
    const noData = { message: 'No data available', statuscode: 404, timestamp: '05-10-2026 00:18:13' };
    const c = classifyProbe({ status: 404, json: noData }, 'TAMGTAM');
    expect(c.verdict).toBe('EMPTY');
    expect(c.detail).toContain('No data available');

    const noToken = { message: 'Validation error - API Token is mandatory.', statuscode: 400 };
    expect(classifyProbe({ status: 400, json: noToken }, 'DOR').verdict).toBe('AUTH_REJECTED');

    const tooLong = { message: 'Validation error - The difference between From Date and To Date cannot exceed 31 days', statuscode: 400 };
    expect(classifyProbe({ status: 400, json: tooLong }, 'DOR').verdict).toBe('RANGE_TOO_LONG');

    const tooMany = { message: 'Data limit exceeded: Rows are greater than or equal to 50,000. Please reduce the date range', statuscode: 400 };
    expect(classifyProbe({ status: 400, json: tooMany }, 'TAMGTAM').verdict).toBe('RANGE_TOO_LONG');

    const limit = { message: 'Request limit exceeded. Please wait for 68472 seconds and try again.', statuscode: 429 };
    const limited = classifyProbe({ status: 429, json: limit }, 'TAMGTAM');
    expect(limited.verdict).toBe('RATE_LIMITED');
    expect(limited.detail).toContain('68472');
    expect(classifyProbe({ status: 429, json: null, snippet: '' }, 'DOR').verdict).toBe('RATE_LIMITED');

    const idle = { message: 'Auction data not found', statuscode: 200, data: [], error: '' };
    expect(classifyProbe({ status: 200, json: idle }, null).verdict).toBe('EMPTY');
  });

  // A 200 with no rows is a non-trading day, not a failure. Collapsing the two
  // would make a quiet week look like a broken integration.
  it('calls an empty 200 EMPTY, not an error', () => {
    const payload = { ResponseStatus: { Code: 'CNSAPI-200' }, ResponseBody: { DOR: [] } };
    expect(classifyProbe({ status: 200, json: payload }, 'DOR').verdict).toBe('EMPTY');
  });

  it('calls a populated 200 DATA', () => {
    const payload = { ResponseStatus: { Code: 'CNSAPI-200' }, ResponseBody: { DOR: [{}, {}] } };
    const c = classifyProbe({ status: 200, json: payload }, 'DOR');
    expect(c.verdict).toBe('DATA');
    expect(c.detail).toBe('2 row(s)');
  });

  it('surfaces a non-200 envelope inside a 200 response', () => {
    const payload = { ResponseStatus: { Code: 'CNSAPI-401', Message: 'Invalid token' } };
    expect(classifyProbe({ status: 200, json: payload }, 'DOR').verdict).toBe('ERROR_ENVELOPE');
  });
});

describe('slot labelling analysis', () => {
  const slots = (times) => [{
    trade_slots: times.map(([f, t]) => ({ from_time: f, to_time: t, mw: 1, mwh: 0.25, mwh_matches_mw: true })),
    scheduled_slots: [],
    trade_slot_count: times.length,
  }];

  it('reads a day that opens at 00:00 as labelled by start time', () => {
    const s = summariseSlotLabelling(slots([['00:00', '00:15'], ['00:15', '00:30']]));
    expect(s.verdict).toBe('LABELLED_BY_START');
    expect(s.earliest_from).toBe('00:00');
  });

  it('reads a day that opens at 00:15 as labelled by end time', () => {
    expect(summariseSlotLabelling(slots([['00:15', '00:30']])).verdict).toBe('LABELLED_BY_END');
  });

  it('refuses to guess when the day opens somewhere else', () => {
    expect(summariseSlotLabelling(slots([['06:00', '06:15']])).verdict).toBe('INCONCLUSIVE');
  });

  it('says nothing when there are no slots at all', () => {
    expect(summariseSlotLabelling([]).verdict).toBe('NO_SLOTS');
  });
});

describe('DOR reconciliation summary', () => {
  const row = (over = {}) => ({
    category: { charges: 0, fees: 10, igst: 2, cgst: 0, sgst: 0, cp: 88 },
    component_sum: 100, total: 100, total_variance: 0, total_reconciles: true, ...over,
  });

  it('reports RECONCILES when every live row balances', () => {
    const s = summariseDorReconciliation([row(), row()]);
    expect(s.verdict).toBe('RECONCILES');
    expect(s.unreconciled).toBe(0);
  });

  it('reports GAP_CONFIRMED and the largest variance when they do not', () => {
    const s = summariseDorReconciliation([
      row(),
      row({ total: 250, total_variance: 150, total_reconciles: false }),
      row({ total: 90, total_variance: -10, total_reconciles: false }),
    ]);
    expect(s.verdict).toBe('GAP_CONFIRMED');
    expect(s.unreconciled).toBe(2);
    expect(s.largest_variance).toBe(150);
  });

  it('notices that Charges is zero on every row', () => {
    expect(summariseDorReconciliation([row(), row()]).charges_always_zero).toBe(true);
    const s = summariseDorReconciliation([row(), row({ category: { ...row().category, charges: 5 } })]);
    expect(s.charges_always_zero).toBe(false);
  });

  it('does not claim reconciliation from an empty range', () => {
    expect(summariseDorReconciliation([]).verdict).toBe('NO_ROWS');
  });
});

describe('Format-D field analysis', () => {
  it('separates the fields PXIL populates from the ones it never fills', () => {
    const s = summariseFormatDFields([
      { application_no: 'A1', product: '', seller_name: 'X', transaction_price: 4500, transaction_rate: 4.5 },
      { application_no: 'A2', product: '', seller_name: 'Y', transaction_price: 3000, transaction_rate: 3.0 },
    ]);
    expect(s.populated).toContain('application_no');
    expect(s.populated).toContain('seller_name');
    expect(s.blank).toContain('product');
    // A constant ratio of 1000 says one field is per MWh and the other per kWh.
    expect(s.price_rate_ratios).toEqual([1000]);
  });

  it('returns nothing to analyse for an empty range', () => {
    expect(summariseFormatDFields([]).rows).toBe(0);
  });
});
