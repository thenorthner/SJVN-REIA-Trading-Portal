import React, { useEffect, useMemo, useState } from 'react';
import api from '../../api/client.js';

/**
 * The holiday calendar read state by state.
 *
 * A bill falls due on the payer's working calendar: the weekly offs, the
 * national holidays, and the holidays of the payer's own state. The register
 * lists every entry in one table, which answers "what is on the calendar" but
 * not "which days is Punjab shut". This answers that — one state as a year of
 * month grids, or every state side by side.
 *
 * Restricted (optional) holidays are shown but not counted: an office and its
 * bank stay open on them, so no due date or rebate window moves for one.
 */

/** The 28 states and 8 union territories, for pickers that must not take free text. */
export const INDIAN_STATES = [
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa', 'Gujarat',
  'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh',
  'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab', 'Rajasthan',
  'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
  'Andaman and Nicobar Islands', 'Chandigarh', 'Dadra and Nagar Haveli and Daman and Diu', 'Delhi',
  'Jammu and Kashmir', 'Ladakh', 'Lakshadweep', 'Puducherry',
];

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const dayOfWeek = (iso) => new Date(`${iso}T00:00:00Z`).getUTCDay();
const pad = (n) => String(n).padStart(2, '0');
const sameState = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

// Tints by kind of day. Tokens only, so the grid reads in the dark theme too.
const KIND = {
  NATIONAL: { bg: 'var(--t-blue-100)', fg: 'var(--on-blue)', line: 'var(--t-blue-line)', label: 'National holiday' },
  STATE: { bg: 'var(--t-amber-100)', fg: 'var(--on-amber)', line: 'var(--t-amber-line)', label: 'State holiday' },
  WEEKLY_OFF: { bg: 'var(--slate-100)', fg: 'var(--slate-500)', line: 'var(--slate-200)', label: 'Weekly off' },
  RESTRICTED: { bg: 'var(--surface)', fg: 'var(--on-green)', line: 'var(--t-green-line)', label: 'Restricted (optional) — office open' },
};

/** The holidays that close a state's offices: national ones plus its own. */
function closingFor(rows, state) {
  return rows.filter((h) => h.scope === 'NATIONAL' || (h.scope === 'STATE' && sameState(h.state, state)));
}

const closes = (h) => h.holiday_type !== 'RESTRICTED';
const ALL = '__ALL__';
// Not .badge: that class is pinned at 14px for short status labels, and these
// are sentences.
const CHIP = { display: 'inline-flex', alignItems: 'center', padding: '4px 12px', borderRadius: 999, fontSize: 15, fontWeight: 700 };

function MonthGrid({ year, month, byDate, weeklyOffs }) {
  const first = new Date(Date.UTC(year, month, 1));
  const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const cells = [];
  for (let i = 0; i < first.getUTCDay(); i += 1) cells.push(null);
  for (let d = 1; d <= days; d += 1) cells.push(d);

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 10, background: 'var(--surface)' }}>
      <div style={{ fontWeight: 700, fontSize: 15.5, color: 'var(--slate-800)', marginBottom: 6 }}>{MONTHS[month]}</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 3 }}>
        {DOW.map((d, i) => (
          <div key={d} style={{ fontSize: 15, textAlign: 'center', fontWeight: 600, color: weeklyOffs.includes(i) ? 'var(--slate-400)' : 'var(--slate-500)' }}>
            {d.slice(0, 2)}
          </div>
        ))}
        {cells.map((d, i) => {
          if (d === null) return <div key={`b${i}`} />;
          const iso = `${year}-${pad(month + 1)}-${pad(d)}`;
          const hols = byDate.get(iso) || [];
          const shut = hols.filter(closes);
          const off = weeklyOffs.includes(dayOfWeek(iso));
          let kind = null;
          if (shut.some((h) => h.scope === 'STATE')) kind = 'STATE';
          else if (shut.length) kind = 'NATIONAL';
          else if (off) kind = 'WEEKLY_OFF';
          else if (hols.length) kind = 'RESTRICTED';
          const k = kind ? KIND[kind] : null;
          const title = hols.length
            ? `${iso}: ${hols.map((h) => `${h.name}${h.holiday_type === 'RESTRICTED' ? ' (optional)' : ''}`).join(', ')}${off ? ' — also a weekly off' : ''}`
            : (off ? `${iso}: weekly off` : iso);
          return (
            <div
              key={iso}
              title={title}
              aria-label={title}
              style={{
                fontSize: 15,
                textAlign: 'center',
                padding: '3px 0',
                borderRadius: 5,
                background: k ? k.bg : 'transparent',
                color: k ? k.fg : 'var(--slate-700)',
                border: k ? `1px ${kind === 'RESTRICTED' ? 'dashed' : 'solid'} ${k.line}` : '1px solid transparent',
                fontWeight: kind === 'STATE' || kind === 'NATIONAL' ? 700 : 400,
              }}
            >
              {d}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Legend() {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, fontSize: 15, color: 'var(--slate-600)' }}>
      {Object.entries(KIND).map(([key, k]) => (
        <span key={key} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 16, height: 16, borderRadius: 4, background: k.bg, border: `1px ${key === 'RESTRICTED' ? 'dashed' : 'solid'} ${k.line}` }} />
          {k.label}
        </span>
      ))}
    </div>
  );
}

const fmtDay = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short', timeZone: 'UTC' });

export default function HolidayStateView({ year, states, weeklyOffs = [0, 6], refreshKey }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  // A state's name, or ALL for every state side by side.
  const [picked, setPicked] = useState('');
  const all = picked === ALL;
  const yr = Number(year) || new Date().getFullYear();

  useEffect(() => {
    setLoading(true);
    api.holidays.list({ year: String(yr) })
      .then((r) => setRows(Array.isArray(r) ? r : []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [yr, refreshKey]);

  // States worth offering: those with a calendar or a counterparty on record.
  const stateList = useMemo(() => {
    const seen = new Map();
    for (const s of [...(states || []), ...rows.filter((h) => h.state).map((h) => h.state)]) {
      const key = String(s).trim().toLowerCase();
      if (key && !seen.has(key)) seen.set(key, String(s).trim());
    }
    return [...seen.values()].sort((a, b) => a.localeCompare(b));
  }, [states, rows]);

  useEffect(() => {
    if (!picked && stateList.length) {
      // SJVN's own state first: it is the calendar SJVN pays its sellers on.
      const home = stateList.find((s) => sameState(s, 'Himachal Pradesh'));
      const withOwn = stateList.find((s) => rows.some((h) => h.scope === 'STATE' && sameState(h.state, s)));
      setPicked(home || withOwn || stateList[0]);
    }
  }, [stateList, rows, picked]);

  const national = rows.filter((h) => h.scope === 'NATIONAL');
  const stateRows = picked && !all ? closingFor(rows, picked) : national;
  const byDate = useMemo(() => {
    const m = new Map();
    for (const h of stateRows) m.set(h.holiday_date, [...(m.get(h.holiday_date) || []), h]);
    return m;
  }, [stateRows]);

  // Closed weekdays: what actually moves a due date. A holiday on a weekly off
  // closes nothing that was open.
  const closedWeekdays = (list) => new Set(list.filter(closes).map((h) => h.holiday_date)
    .filter((d) => !weeklyOffs.includes(dayOfWeek(d)))).size;

  const ownCount = stateRows.filter((h) => h.scope === 'STATE' && closes(h)).length;
  const nationalCount = national.filter(closes).length;

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 15, fontWeight: 700 }}>
          State:
          <select
            aria-label="State whose calendar to show"
            value={picked}
            onChange={(e) => setPicked(e.target.value)}
            style={{ fontSize: 15, padding: '4px 8px', minWidth: 240 }}
          >
            <option value={ALL}>All states — side by side</option>
            {stateList.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <span style={{ fontSize: 15, color: 'var(--slate-500)' }}>Year {yr}</span>
      </div>

      <p style={{ fontSize: 15, color: 'var(--slate-600)', margin: '0 0 12px' }}>
        A bill falls due on the <strong>payer&apos;s</strong> calendar: weekly offs, national holidays and the payer&apos;s state holidays.
        When the last day of a payment period or a rebate window is a closed day, it moves to the next working day.
        Restricted (optional) holidays do not move it — offices and banks stay open.
      </p>

      {loading && <div style={{ fontSize: 15, color: 'var(--slate-500)' }}>Loading calendar…</div>}

      {!loading && !all && (
        <>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
            <span style={{ ...CHIP, background: 'var(--t-blue-50)', color: 'var(--on-blue)' }}>
              {nationalCount} national holidays
            </span>
            <span style={{ ...CHIP, background: 'var(--t-amber-50)', color: 'var(--on-amber)' }}>
              {ownCount} {picked} holidays
            </span>
            <span style={{ ...CHIP, background: 'var(--slate-100)', color: 'var(--slate-700)' }}>
              {closedWeekdays(stateRows)} weekdays closed in {yr}
            </span>
          </div>
          <Legend />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 12, marginTop: 12 }}>
            {MONTHS.map((_, m) => <MonthGrid key={m} year={yr} month={m} byDate={byDate} weeklyOffs={weeklyOffs} />)}
          </div>

          <h4 style={{ fontSize: 16, margin: '18px 0 8px', color: 'var(--slate-800)' }}>
            {picked} — closed days in {yr}
          </h4>
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table" style={{ fontSize: 15 }}>
              <thead>
                <tr><th scope="col">Date</th><th scope="col">Holiday</th><th scope="col">Applies as</th><th scope="col">Type</th><th scope="col">Moves a due date?</th></tr>
              </thead>
              <tbody>
                {stateRows.length === 0 && (
                  <tr><td colSpan={5} style={{ color: 'var(--slate-500)' }}>No holidays on record for {yr}.</td></tr>
                )}
                {stateRows.map((h) => {
                  const off = weeklyOffs.includes(dayOfWeek(h.holiday_date));
                  return (
                    <tr key={h.id}>
                      <td style={{ whiteSpace: 'nowrap' }}><strong>{fmtDay(h.holiday_date)}</strong></td>
                      <td>{h.name}</td>
                      <td>
                        <span style={{ color: h.scope === 'STATE' ? 'var(--on-amber)' : 'var(--on-blue)', fontWeight: 600 }}>
                          {h.scope === 'STATE' ? `${h.state} only` : 'All India'}
                        </span>
                      </td>
                      <td>{h.holiday_type}</td>
                      <td style={{ color: 'var(--slate-600)' }}>
                        {!closes(h) ? 'No — optional holiday' : off ? 'No — already a weekly off' : 'Yes'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {!loading && all && <CompareStates rows={rows} states={stateList} weeklyOffs={weeklyOffs} closedWeekdays={closedWeekdays} />}
    </div>
  );
}

/** Every holiday date of the year down the side, every state across. */
function CompareStates({ rows, states, weeklyOffs, closedWeekdays }) {
  const dates = [...new Set(rows.map((h) => h.holiday_date))].sort();
  if (!dates.length) return <div style={{ fontSize: 15, color: 'var(--slate-500)' }}>No holidays on record for this year.</div>;

  const cell = (date, state) => {
    const here = rows.filter((h) => h.holiday_date === date
      && (h.scope === 'NATIONAL' || (h.scope === 'STATE' && sameState(h.state, state))));
    if (!here.length) return null;
    const shut = here.filter(closes);
    if (!shut.length) return { kind: 'RESTRICTED', names: here.map((h) => h.name) };
    return { kind: shut.some((h) => h.scope === 'STATE') ? 'STATE' : 'NATIONAL', names: shut.map((h) => h.name) };
  };

  return (
    <>
      <Legend />
      <div style={{ overflowX: 'auto', marginTop: 12, border: '1px solid var(--border)', borderRadius: 8 }}>
        <table className="data-table" style={{ fontSize: 15, minWidth: 260 + states.length * 120 }}>
          <thead>
            <tr>
              <th scope="col" style={{ position: 'sticky', left: 0, background: 'var(--surface)', zIndex: 1 }}>Date</th>
              <th scope="col">Holiday</th>
              {states.map((s) => <th key={s} scope="col" style={{ textAlign: 'center' }}>{s}</th>)}
            </tr>
          </thead>
          <tbody>
            {dates.map((date) => {
              const names = [...new Set(rows.filter((h) => h.holiday_date === date).map((h) => h.name))];
              const off = weeklyOffs.includes(dayOfWeek(date));
              return (
                <tr key={date}>
                  <td style={{ whiteSpace: 'nowrap', position: 'sticky', left: 0, background: 'var(--surface)' }}>
                    <strong>{fmtDay(date)}</strong>
                    {off && <div style={{ fontSize: 15, color: 'var(--slate-500)' }}>weekly off</div>}
                  </td>
                  <td>{names.join(' / ')}</td>
                  {states.map((s) => {
                    const c = cell(date, s);
                    if (!c) return <td key={s} style={{ textAlign: 'center', color: 'var(--slate-400)' }} aria-label={`${s}: open`}>—</td>;
                    const k = KIND[c.kind];
                    return (
                      <td key={s} title={`${s}: ${c.names.join(', ')}`} style={{ textAlign: 'center' }}>
                        <span style={{
                          display: 'inline-block', padding: '2px 8px', borderRadius: 5, fontWeight: 600,
                          background: k.bg, color: k.fg, border: `1px ${c.kind === 'RESTRICTED' ? 'dashed' : 'solid'} ${k.line}`,
                        }}
                        >
                          {c.kind === 'NATIONAL' ? 'National' : c.kind === 'STATE' ? 'State' : 'Optional'}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            <tr>
              <td style={{ position: 'sticky', left: 0, background: 'var(--surface)' }}><strong>Weekdays closed</strong></td>
              <td style={{ color: 'var(--slate-500)' }}>holidays not on a weekly off</td>
              {states.map((s) => <td key={s} style={{ textAlign: 'center', fontWeight: 700 }}>{closedWeekdays(closingFor(rows, s))}</td>)}
            </tr>
          </tbody>
        </table>
      </div>
    </>
  );
}
