// Forecasting models for exchange clearing prices — pure functions, no database.
//
// The scope leaves the modelling approach to be settled during design, so what
// is here is deliberately the plain, explainable end of the field: a model a
// trader can check by hand is worth more on a bidding desk than one nobody can
// argue with. Every model is tested against the series' own recent past before
// it is trusted (see backtest), and AUTO publishes whichever one was closest.
//
// Two facts about the data shape everything below:
//
//   - The history has holes. CERC's monthly market report is the deepest source
//     and some months never arrived, so a model that assumes a gapless calendar
//     would silently line Sunday up with Wednesday. Days are integers here and
//     every model works on the calendar, not on array position.
//   - Prices are weekly. Across two years of IEX DAM, Sunday clears about a
//     fifth below the rest of the week; a model with no weekday in it is wrong
//     one day in seven by construction.

const DAY_MS = 86400000;

export const toDay = (iso) => Math.round(Date.parse(`${iso}T00:00:00Z`) / DAY_MS);
export const fromDay = (day) => new Date(day * DAY_MS).toISOString().slice(0, 10);
/** 0 = Sunday, as Date#getUTCDay. Epoch day 0 was a Thursday. */
export const dayOfWeek = (day) => (((day + 4) % 7) + 7) % 7;

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const round4 = (v) => Math.round(v * 10000) / 10000;

export const MODEL_LABELS = {
  WEEKDAY_PROFILE: 'Weekday profile',
  HOLT_WINTERS: 'Holt-Winters (weekly)',
  SEASONAL_NAIVE: 'Same day last week',
  MOVING_AVERAGE: '7-day average',
  // The mean of the weekday profile, Holt-Winters and same-day-last-week.
  ENSEMBLE: 'Ensemble of the weekly models',
};
export const MODELS = Object.keys(MODEL_LABELS);

/** [{date, value}] → [{day, value}] ascending, one per date, finite positives only. */
export function normaliseSeries(series) {
  const byDay = new Map();
  for (const p of series || []) {
    const value = Number(p.value);
    if (!p.date || !Number.isFinite(value) || value < 0) continue;
    byDay.set(toDay(p.date), value);
  }
  return [...byDay.entries()].sort((a, b) => a[0] - b[0]).map(([day, value]) => ({ day, value }));
}

// ── Models ───────────────────────────────────────────────────────────────────
// Each takes observations up to and including the cutoff and the target days
// after it, and returns one value per target — or null when the history cannot
// support the model, which is an answer, not an error.

/** The same weekday's latest price, looking back at most four weeks. */
function seasonalNaive(obs, targets) {
  const byDay = new Map(obs.map((o) => [o.day, o.value]));
  const last = obs[obs.length - 1].day;
  const out = [];
  for (const t of targets) {
    let d = last - ((((last - t) % 7) + 7) % 7);
    let found = null;
    for (let k = 0; k < 4 && found == null; k += 1, d -= 7) if (byDay.has(d)) found = byDay.get(d);
    if (found == null) return null;
    out.push(found);
  }
  return out;
}

/** Flat: the mean of the last seven prices, if they are recent. */
function movingAverage(obs, targets) {
  const last = obs[obs.length - 1].day;
  const recent = obs.filter((o) => o.day > last - 14).slice(-7);
  if (recent.length < 4) return null;
  const m = mean(recent.map((o) => o.value));
  return targets.map(() => m);
}

/**
 * How each weekday runs against the week, from the last eight weeks: Sunday at
 * 0.8 means Sunday clears at four-fifths of the average day. A weekday seen
 * fewer than twice keeps a neutral 1.
 */
export function weekdayFactors(obs, windowDays = 56) {
  const last = obs[obs.length - 1].day;
  const win = obs.filter((o) => o.day > last - windowDays);
  if (win.length < 28) return null;
  const overall = mean(win.map((o) => o.value));
  if (!(overall > 0)) return null;
  const sums = Array(7).fill(0);
  const counts = Array(7).fill(0);
  for (const o of win) {
    const w = dayOfWeek(o.day);
    sums[w] += o.value;
    counts[w] += 1;
  }
  return sums.map((s, w) => (counts[w] >= 2 ? s / counts[w] / overall : 1));
}

/** The last fortnight's level with the weekday taken out, put back per target. */
function weekdayProfile(obs, targets) {
  const f = weekdayFactors(obs);
  if (!f) return null;
  const last = obs[obs.length - 1].day;
  const recent = obs.filter((o) => o.day > last - 14);
  if (recent.length < 7) return null;
  const level = mean(recent.map((o) => o.value / f[dayOfWeek(o.day)]));
  return targets.map((t) => level * f[dayOfWeek(t)]);
}

/**
 * The newest unbroken run of days, at most a year of it. A gap of a day or two
 * is bridged by a straight line; anything longer ends the run, because the
 * recursion below has to step through every day in order.
 */
export function contiguousTail(obs, { maxGap = 2, maxLen = 364 } = {}) {
  const out = [obs[obs.length - 1]];
  for (let i = obs.length - 2; i >= 0 && out.length < maxLen; i -= 1) {
    const next = out[0];
    const cur = obs[i];
    const gap = next.day - cur.day - 1;
    if (gap > maxGap) break;
    for (let k = gap; k >= 1; k -= 1) {
      out.unshift({ day: cur.day + k, value: cur.value + ((next.value - cur.value) * k) / (gap + 1) });
    }
    out.unshift(cur);
  }
  return out.slice(-maxLen);
}

function holtWintersFit(y, m, alpha, beta, gamma, phi) {
  let level = mean(y.slice(0, m));
  let trend = (mean(y.slice(m, 2 * m)) - level) / m;
  const season = y.slice(0, m).map((v) => v - level);
  let sse = 0;
  for (let t = m; t < y.length; t += 1) {
    const s = season[t % m];
    const err = y[t] - (level + phi * trend + s);
    sse += err * err;
    const prev = level;
    level = alpha * (y[t] - s) + (1 - alpha) * (prev + phi * trend);
    trend = beta * (level - prev) + (1 - beta) * phi * trend;
    season[t % m] = gamma * (y[t] - level) + (1 - gamma) * s;
  }
  return { level, trend, season, sse };
}

const HW_GRID = (() => {
  const grid = [];
  for (const alpha of [0.1, 0.2, 0.35, 0.5, 0.7]) {
    for (const beta of [0, 0.05, 0.15]) {
      for (const gamma of [0.05, 0.15, 0.3]) {
        for (const phi of [0.8, 0.9, 0.98]) grid.push({ alpha, beta, gamma, phi });
      }
    }
  }
  return grid;
})();

/**
 * Additive weekly season, damped trend, smoothing constants picked by one-step
 * error over the fitting run. Damped because an undamped trend fitted on a
 * rising fortnight walks a month-ahead forecast off the top of the price band.
 */
function holtWinters(obs, targets, detail) {
  const run = contiguousTail(obs);
  const m = 7;
  if (run.length < 4 * m) return null;
  const y = run.map((o) => o.value);
  let best = null;
  for (const p of HW_GRID) {
    const fit = holtWintersFit(y, m, p.alpha, p.beta, p.gamma, p.phi);
    if (!best || fit.sse < best.fit.sse) best = { p, fit };
  }
  const lastDay = run[run.length - 1].day;
  const n = y.length;
  const { level, trend, season } = best.fit;
  const { phi } = best.p;
  if (detail) Object.assign(detail, { params: best.p, fitted_days: n });
  return targets.map((t) => {
    const h = t - lastDay;
    let damp = 0;
    for (let i = 1; i <= h; i += 1) damp += phi ** i;
    return level + damp * trend + season[(n - 1 + h) % m];
  });
}

function ensemble(obs, targets) {
  const parts = [weekdayProfile, holtWinters, seasonalNaive]
    .map((fn) => fn(obs, targets))
    .filter(Boolean);
  if (parts.length < 2) return null;
  return targets.map((_, i) => mean(parts.map((p) => p[i])));
}

const IMPLEMENTATIONS = {
  WEEKDAY_PROFILE: weekdayProfile,
  HOLT_WINTERS: holtWinters,
  SEASONAL_NAIVE: seasonalNaive,
  MOVING_AVERAGE: movingAverage,
  ENSEMBLE: ensemble,
};

/**
 * One model's forecast for `horizon` days after the last observation, clipped
 * to the exchange's price band. Null when the history cannot carry the model.
 */
export function forecastWith(model, obs, horizon, { floor = 0, cap = Infinity, detail } = {}) {
  const fn = IMPLEMENTATIONS[model];
  if (!fn || !obs.length) return null;
  const last = obs[obs.length - 1].day;
  const targets = Array.from({ length: horizon }, (_, i) => last + i + 1);
  const values = fn(obs, targets, detail);
  if (!values || values.some((v) => !Number.isFinite(v))) return null;
  return targets.map((day, i) => ({ day, horizon: i + 1, value: Math.min(cap, Math.max(floor, values[i])) }));
}

// ── Testing a model against the series' own past ─────────────────────────────

const MIN_TRAINING_DAYS = 56;

/**
 * Rolling-origin backtest: stand at each of the last `origins` cutoffs, forecast
 * the next `horizon` days from only what was known then, and compare with what
 * cleared. Nothing the model is scored on was visible to it.
 *
 * A week-ahead forecast is tested from every one of the last ninety days; a
 * month-ahead one from a cutoff a week apart over half a year. On two years of
 * IEX prices, twelve weekly cutoffs picked a different "best" model from one
 * fortnight to the next — the ranking was noise, not skill.
 */
export function backtest(model, obs, {
  horizon, floor = 0, cap = Infinity,
  step = horizon <= 7 ? 1 : 7,
  origins = horizon <= 7 ? 90 : 26,
} = {}) {
  const errors = [];
  let tested = 0;
  if (obs.length > MIN_TRAINING_DAYS) {
    const lastDay = obs[obs.length - 1].day;
    for (let k = 1; tested < origins; k += 1) {
      const cutoff = lastDay - k * step;
      if (cutoff < obs[0].day) break;
      const training = obs.filter((o) => o.day <= cutoff);
      if (training.length < MIN_TRAINING_DAYS) break;
      // A cutoff must be a day that was actually observed, or the model is
      // standing inside a gap it cannot see across.
      if (training[training.length - 1].day !== cutoff) continue;
      const actual = new Map(obs.filter((o) => o.day > cutoff && o.day <= cutoff + horizon).map((o) => [o.day, o.value]));
      if (!actual.size) continue;
      const fc = forecastWith(model, training, horizon, { floor, cap });
      if (!fc) continue;
      tested += 1;
      for (const p of fc) {
        if (actual.has(p.day)) errors.push({ horizon: p.horizon, actual: actual.get(p.day), forecast: p.value });
      }
    }
  }
  return { model, origins: tested, observations: errors.length, ...scoreErrors(errors), errors };
}

/** MAPE and friends over [{actual, forecast}]. Zero-price days are left out of MAPE only. */
export function scoreErrors(errors) {
  if (!errors.length) return { mape: null, mae: null, rmse: null, bias: null };
  const pct = errors.filter((e) => e.actual > 0).map((e) => Math.abs(e.actual - e.forecast) / e.actual);
  return {
    mape: pct.length ? round4(mean(pct) * 100) : null,
    mae: round4(mean(errors.map((e) => Math.abs(e.actual - e.forecast)))),
    rmse: round4(Math.sqrt(mean(errors.map((e) => (e.actual - e.forecast) ** 2)))),
    bias: round4(mean(errors.map((e) => e.forecast - e.actual))),
  };
}

function quantile(sorted, q) {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

const HORIZON_BUCKETS = [[1, 1], [2, 7], [8, 14], [15, Infinity]];
const bucketOf = (h) => HORIZON_BUCKETS.findIndex(([a, b]) => h >= a && h <= b);
export const bucketLabel = (h) => {
  const [a, b] = HORIZON_BUCKETS[bucketOf(h)];
  if (a === b) return `Day ${a}`;
  return b === Infinity ? `Day ${a}+` : `Days ${a}–${b}`;
};

/**
 * An 80% band from how wrong the model has actually been at each distance: the
 * 10th and 90th percentile of actual ÷ forecast in the backtest. A distance
 * with too few misses to say borrows the pooled figure; with too few overall
 * there is no band, rather than one drawn from nothing.
 */
export function intervalFactors(errors, { minPooled = 10, minBucket = 15 } = {}) {
  const ratios = errors.filter((e) => e.forecast > 0).map((e) => ({ h: e.horizon, r: e.actual / e.forecast }));
  if (ratios.length < minPooled) return null;
  const pooled = ratios.map((x) => x.r).sort((a, b) => a - b);
  const pooledBand = { lower: quantile(pooled, 0.1), upper: quantile(pooled, 0.9), n: pooled.length };
  const buckets = HORIZON_BUCKETS.map((_, i) => {
    const rs = ratios.filter((x) => bucketOf(x.h) === i).map((x) => x.r).sort((a, b) => a - b);
    return rs.length >= minBucket ? { lower: quantile(rs, 0.1), upper: quantile(rs, 0.9), n: rs.length } : pooledBand;
  });
  return { forHorizon: (h) => buckets[bucketOf(h)], pooled: pooledBand };
}

// Preferred order when nothing could be backtested: the simplest model the
// history can still carry.
const FALLBACK_ORDER = ['WEEKDAY_PROFILE', 'SEASONAL_NAIVE', 'MOVING_AVERAGE'];
const MIN_ORIGINS_TO_RANK = 3;

/**
 * The forecast a run publishes. `model` is a named model or AUTO; AUTO
 * backtests every model on the requested horizon and publishes the one with
 * the lowest MAPE (MAE breaks a tie). A named model is still backtested, so its
 * band and its track record are the same kind of figure AUTO's would be.
 */
export function buildForecast(series, { horizon, model = 'AUTO', floor = 0, cap = Infinity } = {}) {
  const obs = normaliseSeries(series);
  if (!obs.length) return { ok: false, reason: 'NO_HISTORY' };

  const candidates = model === 'AUTO' ? MODELS : [model];
  const tests = candidates.map((m) => backtest(m, obs, { horizon, floor, cap }));
  const ranked = tests
    .filter((t) => t.origins >= MIN_ORIGINS_TO_RANK && t.mape != null)
    .sort((a, b) => a.mape - b.mape || a.mae - b.mae);

  let chosen;
  let selection;
  if (model !== 'AUTO') {
    chosen = model;
    selection = 'REQUESTED';
  } else if (ranked.length) {
    chosen = ranked[0].model;
    selection = 'BEST_BACKTEST';
  } else {
    chosen = FALLBACK_ORDER.find((m) => forecastWith(m, obs, horizon));
    selection = 'FALLBACK';
  }

  const detail = {};
  const points = chosen ? forecastWith(chosen, obs, horizon, { floor, cap, detail }) : null;
  if (!points) return { ok: false, reason: 'MODEL_CANNOT_FIT', model: chosen || model, history_days: obs.length };

  const chosenTest = tests.find((t) => t.model === chosen) || backtest(chosen, obs, { horizon, floor, cap });
  const band = intervalFactors(chosenTest.errors);
  const clip = (v) => Math.min(cap, Math.max(floor, v));

  // Share of backtest actuals that fell inside the band they would have had.
  let coverage = null;
  if (band) {
    const inside = chosenTest.errors.filter((e) => {
      const f = band.forHorizon(e.horizon);
      return e.actual >= e.forecast * f.lower && e.actual <= e.forecast * f.upper;
    }).length;
    coverage = round4((inside / chosenTest.errors.length) * 100);
  }

  return {
    ok: true,
    model: chosen,
    selection,
    params: detail.params || null,
    cutoff_date: fromDay(obs[obs.length - 1].day),
    history_from: fromDay(obs[0].day),
    history_days: obs.length,
    backtest: tests.map(({ errors, ...t }) => t),
    chosen_backtest: (({ errors, ...t }) => t)(chosenTest),
    interval_coverage: coverage,
    points: points.map((p) => {
      const f = band?.forHorizon(p.horizon);
      return {
        date: fromDay(p.day),
        horizon: p.horizon,
        forecast: round4(p.value),
        lower: f ? round4(clip(p.value * f.lower)) : null,
        upper: f ? round4(clip(p.value * f.upper)) : null,
      };
    }),
  };
}

// ── Intraday shape ───────────────────────────────────────────────────────────

const BLOCKS_PER_DAY = 96;
const isWeekend = (day) => [0, 6].includes(dayOfWeek(day));

/**
 * How the day's price is spread over its 96 blocks, as a multiple of the
 * day's (volume-weighted) average, from recent days that were loaded block by
 * block. Weekends and weekdays are shaped separately when both have days.
 * `days` is [{date, blocks: [{block: 1..96, price, volume}]}]; a day missing
 * more than a handful of blocks says little about shape and is left out.
 */
export function intradayShape(days, { lookbackDays = 28, minBlocks = 90 } = {}) {
  const usable = (days || []).filter((d) => d.blocks?.length >= minBlocks);
  if (!usable.length) return null;
  const newest = Math.max(...usable.map((d) => toDay(d.date)));
  const recent = usable.filter((d) => toDay(d.date) > newest - lookbackDays);

  const shapeOf = (group) => {
    if (!group.length) return null;
    const sums = Array(BLOCKS_PER_DAY).fill(0);
    const counts = Array(BLOCKS_PER_DAY).fill(0);
    for (const d of group) {
      const avg = dailyPrice(d.blocks);
      if (!(avg > 0)) continue;
      for (const b of d.blocks) {
        if (b.block < 1 || b.block > BLOCKS_PER_DAY) continue;
        sums[b.block - 1] += b.price / avg;
        counts[b.block - 1] += 1;
      }
    }
    // A block no day covered takes its neighbours' mean rather than a hole.
    const shape = sums.map((s, i) => (counts[i] ? s / counts[i] : null));
    for (let i = 0; i < BLOCKS_PER_DAY; i += 1) {
      if (shape[i] != null) continue;
      const prev = shape.slice(0, i).reverse().find((v) => v != null);
      const next = shape.slice(i + 1).find((v) => v != null);
      shape[i] = prev != null && next != null ? (prev + next) / 2 : (prev ?? next ?? 1);
    }
    return { shape, days: group.length };
  };

  const weekend = shapeOf(recent.filter((d) => isWeekend(toDay(d.date))));
  const weekday = shapeOf(recent.filter((d) => !isWeekend(toDay(d.date))));
  const pooled = shapeOf(recent);
  return {
    days: recent.length,
    from: fromDay(Math.min(...recent.map((d) => toDay(d.date)))),
    to: fromDay(newest),
    forDate: (iso) => (isWeekend(toDay(iso)) ? weekend : weekday) || pooled,
  };
}

/** A day's price from its blocks: weighted by cleared volume when there is any. */
export function dailyPrice(blocks) {
  const priced = (blocks || []).filter((b) => Number.isFinite(b.price));
  if (!priced.length) return null;
  const vol = priced.reduce((a, b) => a + (b.volume > 0 ? b.volume : 0), 0);
  return vol > 0
    ? priced.reduce((a, b) => a + b.price * (b.volume > 0 ? b.volume : 0), 0) / vol
    : mean(priced.map((b) => b.price));
}

/** The 96 block prices for one forecast day: the day's forecast laid over the shape. */
export function blockForecast(dailyForecast, shape, { floor = 0, cap = Infinity } = {}) {
  return shape.map((s, i) => ({
    block: i + 1,
    forecast: round4(Math.min(cap, Math.max(floor, dailyForecast * s))),
  }));
}

export const blockLabel = (block) => {
  const mins = (block - 1) * 15;
  return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
};
