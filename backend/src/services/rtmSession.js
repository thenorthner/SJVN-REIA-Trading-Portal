/**
 * RTM bidding session clock.
 *
 * RTM trades in half-hour delivery sessions, numbered 1..48 from midnight IST
 * (session 27 delivers 13:00-13:30). A session takes bids until its gate closes,
 * a fixed lead before delivery starts, so the "active" session is the first one
 * whose gate is still ahead. The lead and slot length are settings
 * (rtm_gate_closure_minutes, rtm_session_minutes) because the exchange has
 * changed them before; the defaults are 60 and 30.
 *
 * Pure function of the instant passed in, so the server clock is the only clock
 * the screen needs to trust.
 */
const IST_OFFSET_MS = 330 * 60000;
const DAY_MS = 86400000;
const pad = (n) => String(n).padStart(2, '0');

export function rtmSessionAt(now = new Date(), { gateMinutes = 60, slotMinutes = 30 } = {}) {
  const gateMs = gateMinutes * 60000;
  const slotMs = slotMinutes * 60000;
  const nowMs = now.getTime();
  const shifted = nowMs + IST_OFFSET_MS; // IST wall clock expressed as a UTC instant
  const k = Math.floor((shifted + gateMs) / slotMs) + 1; // first slot whose gate is strictly ahead
  const startShifted = k * slotMs;
  const endShifted = startShifted + slotMs;
  const dayStart = Math.floor(startShifted / DAY_MS) * DAY_MS;
  const hhmm = (ms) => { const d = new Date(ms); return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`; };
  const gateCloseMs = startShifted - gateMs - IST_OFFSET_MS;
  return {
    session_no: Math.round((startShifted - dayStart) / slotMs) + 1,
    delivery_date: new Date(startShifted).toISOString().slice(0, 10),
    delivery_from: hhmm(startShifted),
    delivery_to: hhmm(endShifted),
    gate_closes_at: new Date(gateCloseMs).toISOString(),
    seconds_left: Math.max(0, Math.ceil((gateCloseMs - nowMs) / 1000)),
    server_time: new Date(nowMs).toISOString(),
    gate_minutes: gateMinutes,
    slot_minutes: slotMinutes,
  };
}

/**
 * Next day-ahead bidding gate (DAM, HP-DAM, GDAM): bids placed today for
 * tomorrow's delivery close at a fixed time of day IST. Past that time the next
 * gate is tomorrow's, for the day after. `gateTime` is "HH:MM" IST from settings;
 * anything unreadable falls back to 12:00 rather than showing no clock.
 */
export function dayAheadGateAt(now = new Date(), gateTime = '12:00') {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(gateTime).trim());
  const hh = m ? Number(m[1]) : 12;
  const mm = m ? Number(m[2]) : 0;
  const valid = m && hh < 24 && mm < 60;
  const gateMinutes = valid ? hh * 60 + mm : 12 * 60;
  const nowMs = now.getTime();
  const shifted = nowMs + IST_OFFSET_MS;
  const dayStart = Math.floor(shifted / DAY_MS) * DAY_MS;
  let gateShifted = dayStart + gateMinutes * 60000;
  if (gateShifted <= shifted) gateShifted += DAY_MS;
  const gateDay = Math.floor(gateShifted / DAY_MS) * DAY_MS;
  const gateCloseMs = gateShifted - IST_OFFSET_MS;
  return {
    gate_time: `${pad(Math.floor(gateMinutes / 60))}:${pad(gateMinutes % 60)}`,
    gate_closes_at: new Date(gateCloseMs).toISOString(),
    delivery_date: new Date(gateDay + DAY_MS).toISOString().slice(0, 10),
    seconds_left: Math.max(0, Math.ceil((gateCloseMs - nowMs) / 1000)),
    server_time: new Date(nowMs).toISOString(),
  };
}
