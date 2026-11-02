import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import api from '../api/client.js';
import { PageHeader, Card, Badge, Modal, StatCard, scrollPageTop } from '../components/ui.jsx';
import {
  actionMeta, moduleLabel, entityLabel, humanize, formatValue, safeParse,
  computeDiff, summarizeDetails, detailsFieldCount, describeEvent, groupSummary,
  timeLabel, groupEvents, AUDIT_CATEGORIES, AUDIT_ACTIVITIES, activityMeta, roleLabel,
} from '../auditMeta.js';
import { fmtDateTime, fmtDate, localDayStartUtc, localDayEndUtc, parseTimestamp } from '../datetime.js';

const PAGE = 100;

// Every filter lives in the URL, so a view of the trail can be bookmarked,
// shared with a colleague, or left with the back button. `category` is the
// first version's slice, still read from old links.
const FILTER_KEYS = ['q', 'activity', 'category', 'module', 'action', 'user_id', 'role', 'entity_type', 'entity_id', 'trace_id', 'hours', 'from', 'to'];
// How the trail is shown, not which events: also in the URL, but not a filter.
const VIEWS = [
  { key: 'timeline', label: 'Timeline', hint: 'Day by day, repeats folded together' },
  { key: 'table', label: 'Table', hint: 'One line per event, choose the columns' },
  { key: 'people', label: 'People', hint: 'One card per person: how much, when, what kind' },
];

const fmtN = (n) => (n == null ? '…' : Number(n).toLocaleString('en-IN'));
const splitList = (v) => String(v || '').split(',').map((s) => s.trim()).filter(Boolean);

/** The local calendar date `n` days ago, as YYYY-MM-DD. */
function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  const pad = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const PRESETS = [
  { key: 'today', label: 'Today', days: 0 },
  { key: '7d', label: '7 days', days: 6 },
  { key: '30d', label: '30 days', days: 29 },
  { key: '90d', label: '90 days', days: 89 },
];

// One click to the questions an auditor asks most. Each is only a set of URL
// filters, so it lands on the same screen a hand-built filter would.
const QUICK_VIEWS = [
  { label: 'Security alerts', set: { activity: 'security' } },
  { label: 'Approvals this week', set: { activity: 'approvals', from: () => daysAgo(6) } },
  { label: 'Payments & postings', set: { activity: 'money' } },
  { label: 'Record changes today', set: { activity: 'changes', from: () => daysAgo(0) } },
  { label: 'Data that left the platform', set: { activity: 'exports' } },
  { label: 'Outside office hours', set: { hours: 'after' } },
];

// Office hours, as the API's `hours=after` counts them (routes/auditLogs.js).
const OFFICE_START = 9;
const OFFICE_END = 18;
function isAfterHours(ts) {
  const d = parseTimestamp(ts);
  if (!d) return false;
  const h = d.getHours();
  return h < OFFICE_START || h >= OFFICE_END || d.getDay() === 0 || d.getDay() === 6;
}

/** URL filters to API query. Dates become the UTC bounds of the viewer's local days. */
function toApiParams(f, order) {
  const p = {};
  for (const k of ['q', 'activity', 'category', 'module', 'action', 'user_id', 'role', 'entity_type', 'entity_id', 'trace_id', 'hours']) {
    if (f[k]) p[k] = f[k];
  }
  if (f.from) p.from_date = localDayStartUtc(f.from);
  if (f.to) p.to_date = localDayEndUtc(f.to);
  if (order === 'asc') p.order = 'asc';
  // Office hours and the chart's days are the viewer's, not UTC's.
  p.tz_offset = -new Date().getTimezoneOffset();
  return p;
}

function dateRangeLabel(from, to) {
  if (from && from === to) return fmtDate(from);
  return `${from ? fmtDate(from) : 'Start'} – ${to ? fmtDate(to) : 'now'}`;
}

// Per-viewer conveniences (saved views, table columns, folding). Storage may be
// missing or refuse (private window), and the page works the same without it.
function readStore(key, fallback) {
  try {
    const v = JSON.parse(window.localStorage.getItem(key) || 'null');
    return v ?? fallback;
  } catch {
    return fallback;
  }
}
function writeStore(key, value) {
  try { window.localStorage.setItem(key, JSON.stringify(value)); } catch { /* not kept; fine */ }
}
function useStored(key, fallback) {
  const [v, setV] = useState(() => readStore(key, fallback));
  const set = useCallback((next) => {
    setV((cur) => {
      const val = typeof next === 'function' ? next(cur) : next;
      writeStore(key, val);
      return val;
    });
  }, [key]);
  return [v, set];
}

/* ------------------------------------------------------------------ *
 * A dropdown that picks several values, with a search box for long
 * lists (people, actions). Nothing picked means "all".
 * ------------------------------------------------------------------ */
function MultiPicker({ label, allLabel, options, selected, onChange, searchable, buttonText, align = 'left' }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef(null);
  const searchRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    if (searchable) setTimeout(() => searchRef.current?.focus(), 0);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, searchable]);
  useEffect(() => { if (!open) setQ(''); }, [open]);

  const sel = new Set(selected);
  const needle = q.trim().toLowerCase();
  const shown = needle
    ? options.filter((o) => `${o.label} ${o.sub || ''} ${o.value}`.toLowerCase().includes(needle))
    : options;
  const toggle = (v) => {
    const next = new Set(sel);
    if (next.has(v)) next.delete(v); else next.add(v);
    onChange([...next]);
  };
  const text = buttonText
    || (selected.length === 0 ? allLabel
      : selected.length === 1 ? (options.find((o) => o.value === selected[0])?.label || selected[0])
        : `${selected.length} ${label.toLowerCase()}`);

  let lastGroup = null;
  return (
    <div className="audit-picker" ref={ref}>
      <button
        type="button"
        className={`audit-picker-btn${selected.length && !buttonText ? ' is-set' : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="audit-picker-text">{text}</span>
        <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className={`audit-picker-pop${align === 'right' ? ' is-right' : ''}`} role="listbox" aria-multiselectable="true" aria-label={label}>
          {searchable && (
            <input
              ref={searchRef}
              type="search"
              className="audit-picker-search"
              placeholder={`Find ${label.toLowerCase()}…`}
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          )}
          <div className="audit-picker-list">
            {shown.length === 0 && <div className="audit-picker-empty">Nothing matches “{q}”.</div>}
            {shown.map((o) => {
              const head = o.group && o.group !== lastGroup ? o.group : null;
              lastGroup = o.group;
              return (
                <React.Fragment key={o.value}>
                  {head && <div className="audit-picker-group">{head}</div>}
                  <label className="audit-picker-opt">
                    <input type="checkbox" checked={sel.has(o.value)} onChange={() => toggle(o.value)} />
                    <span className="audit-picker-label">
                      {o.label}
                      {o.sub && <span className="audit-picker-sub">{o.sub}</span>}
                    </span>
                    {o.n != null && <span className="audit-picker-n">{fmtN(o.n)}</span>}
                  </label>
                </React.Fragment>
              );
            })}
          </div>
          {!buttonText && (
            <div className="audit-picker-foot">
              <span>{selected.length ? `${selected.length} picked` : allLabel}</span>
              <button type="button" className="btn btn-ghost btn-sm" disabled={!selected.length} onClick={() => onChange([])}>Clear</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * "Show me more like this" — the three questions an auditor asks of an
 * event: what else happened to this record, what else did this person
 * do, and what else happened in the same request.
 * ------------------------------------------------------------------ */
function Pivots({ log, onPivot }) {
  const noun = entityLabel(log.entity_type) || 'record';
  const items = [
    log.entity_id && { key: 'entity_id', value: log.entity_id, label: `History of this ${noun}` },
    log.user_id && { key: 'user_id', value: log.user_id, label: `Everything by ${log.user_name || 'this user'}` },
    log.trace_id && { key: 'trace_id', value: log.trace_id, label: 'Same request' },
  ].filter(Boolean);
  if (!items.length) return null;
  return (
    <div className="audit-pivots">
      {items.map((i) => (
        <button key={i.key} type="button" className="audit-pivot" onClick={() => onPivot(i.key, i.value)}>
          {i.label} →
        </button>
      ))}
    </div>
  );
}

function ActivityTag({ kind }) {
  if (!kind) return null;
  const m = activityMeta(kind);
  return <span className={`audit-kind tone-${m.tone}`} title={m.hint}>{m.label}</span>;
}

/* ------------------------------------------------------------------ *
 * Expanded row body — shows ONLY what changed / what matters.
 * Full payload and hash chain stay behind "View full details".
 * ------------------------------------------------------------------ */
function EventDetail({ log, onOpenFull, onPivot }) {
  const diff = computeDiff(log.before_value, log.after_value);
  const summary = diff.length ? [] : summarizeDetails(log.details);
  const totalFields = detailsFieldCount(log.details);
  const hiddenCount = Math.max(0, totalFields - summary.length);

  return (
    <div className="audit-detail">
      <div className="audit-detail-meta">
        <span><span className="audit-k">Record</span> {entityLabel(log.entity_type)} {log.entity_id || '—'}</span>
        <span><span className="audit-k">At</span> {fmtDateTime(log.created_at)}</span>
        {log.reason && <span><span className="audit-k">Reason</span> {log.reason}</span>}
      </div>

      {diff.length > 0 && (
        <div className="audit-changes">
          <div className="audit-changes-title">{diff.length} field{diff.length > 1 ? 's' : ''} changed</div>
          {diff.map((d) => (
            <div className="audit-change-row" key={d.field}>
              <span className="audit-change-field">{d.label}</span>
              <span className="audit-val audit-val-before">{formatValue(d.from)}</span>
              <span className="audit-arrow">→</span>
              <span className="audit-val audit-val-after">{formatValue(d.to)}</span>
            </div>
          ))}
        </div>
      )}

      {summary.length > 0 && (
        <div className="audit-changes">
          <div className="audit-changes-title">Key details</div>
          <div className="audit-kv-grid">
            {summary.map((s) => (
              <div className="audit-kv" key={s.field}>
                <span className="audit-kv-label">{s.label}</span>
                <span className="audit-kv-value">{formatValue(s.value)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {diff.length === 0 && summary.length === 0 && (
        <div className="audit-empty-detail">No field-level payload recorded for this event.</div>
      )}

      <div className="audit-detail-foot">
        <Pivots log={log} onPivot={onPivot} />
        <button type="button" className="btn btn-ghost btn-sm" onClick={onOpenFull}>
          View full details{hiddenCount > 0 ? ` (+${hiddenCount} more)` : ''}
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * A single timeline entry.
 * ------------------------------------------------------------------ */
function EventRow({ log, expanded, onToggle, onOpenFull, onPivot }) {
  const meta = actionMeta(log.action);
  return (
    <div className={'audit-event' + (expanded ? ' is-open' : '')}>
      <button type="button" className="audit-event-head" onClick={onToggle} aria-expanded={expanded}>
        <span className="audit-time">{timeLabel(log.created_at)}</span>
        <span className={`audit-dot tone-${meta.tone}`} aria-hidden="true">{meta.icon}</span>
        <span className="audit-summary">
          <span className="audit-desc">{describeEvent(log)}</span>
          <span className="audit-actor">
            {log.user_name || 'System'}
            {log.user_role && <span className="audit-role"> · {roleLabel(log.user_role)}</span>}
            {isAfterHours(log.created_at) && <span className="audit-after"> · outside office hours</span>}
          </span>
        </span>
        <ActivityTag kind={log.activity} />
        <span className="audit-module-chip">{moduleLabel(log.module)}</span>
        <span className="audit-chevron">{expanded ? '▾' : '▸'}</span>
      </button>
      {expanded && <EventDetail log={log} onOpenFull={onOpenFull} onPivot={onPivot} />}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * A run of identical consecutive events, collapsed into one line.
 * ------------------------------------------------------------------ */
function EventGroup({ group, expandedId, onToggleEvent, onOpenFull, onPivot, ascending }) {
  const [open, setOpen] = useState(false);
  const meta = actionMeta(group.action);

  if (group.items.length === 1) {
    const log = group.items[0];
    return (
      <EventRow
        log={log}
        expanded={expandedId === log.id}
        onToggle={() => onToggleEvent(log.id)}
        onOpenFull={() => onOpenFull(log)}
        onPivot={onPivot}
      />
    );
  }

  const first = group.items[0];
  const last = group.items[group.items.length - 1];
  const [early, late] = ascending ? [first, last] : [last, first];

  return (
    <div className={'audit-event audit-group' + (open ? ' is-open' : '')}>
      <button type="button" className="audit-event-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="audit-time">
          {timeLabel(early.created_at)}–{timeLabel(late.created_at)}
        </span>
        <span className={`audit-dot tone-${meta.tone}`} aria-hidden="true">{meta.icon}</span>
        <span className="audit-summary">
          <span className="audit-desc">{groupSummary(group)}</span>
          <span className="audit-actor">
            {group.user_name || 'System'}
            {group.user_role && <span className="audit-role"> · {roleLabel(group.user_role)}</span>}
          </span>
        </span>
        <ActivityTag kind={first.activity} />
        <span className="audit-module-chip">{moduleLabel(group.module)}</span>
        <span className="audit-chevron">{open ? '▾' : '▸'}</span>
      </button>

      {open && (
        <div className="audit-group-items">
          {group.items.map((log) => (
            <EventRow
              key={log.id}
              log={log}
              expanded={expandedId === log.id}
              onToggle={() => onToggleEvent(log.id)}
              onOpenFull={() => onOpenFull(log)}
              onPivot={onPivot}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Table view: one line per event, columns of the viewer's choosing.
 * ------------------------------------------------------------------ */
const TABLE_COLUMNS = [
  { key: 'when', label: 'When', fixed: true, cell: (l) => fmtDateTime(l.created_at) },
  { key: 'who', label: 'Person', cell: (l) => l.user_name || 'System' },
  { key: 'role', label: 'Role', cell: (l) => roleLabel(l.user_role) || '—' },
  { key: 'activity', label: 'Activity', cell: (l) => <ActivityTag kind={l.activity} /> },
  { key: 'what', label: 'What happened', fixed: true, cell: (l) => describeEvent(l) },
  { key: 'record', label: 'Record', cell: (l) => (l.entity_id ? `${entityLabel(l.entity_type)} ${l.entity_id}` : '—') },
  { key: 'module', label: 'Module', cell: (l) => moduleLabel(l.module) },
  { key: 'reason', label: 'Reason', cell: (l) => (l.reason ? <span title={l.reason}>{l.reason}</span> : '—') },
  { key: 'ip', label: 'IP address', cell: (l) => l.ip_address || '—' },
  { key: 'action', label: 'Action code', cell: (l) => <code>{l.action}</code> },
];
const DEFAULT_COLUMNS = ['when', 'who', 'role', 'activity', 'what', 'module', 'reason'];

function EventTable({ rows, columns, order, onOrder, onOpen }) {
  const cols = TABLE_COLUMNS.filter((c) => c.fixed || columns.includes(c.key));
  return (
    <div className="audit-table-wrap">
      <table className="audit-table">
        <thead>
          <tr>
            {cols.map((c) => (
              <th key={c.key} scope="col">
                {c.key === 'when' ? (
                  <button type="button" className="audit-th-sort" onClick={onOrder} title="Change the order">
                    When {order === 'asc' ? '↑ oldest first' : '↓ newest first'}
                  </button>
                ) : c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((l) => (
            <tr
              key={l.id}
              tabIndex={0}
              className={isAfterHours(l.created_at) ? 'is-after' : ''}
              onClick={() => onOpen(l)}
              onKeyDown={(e) => { if (e.key === 'Enter') onOpen(l); }}
            >
              {cols.map((c) => <td key={c.key} data-col={c.key}>{c.cell(l)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * People view: who did how much, when, and of what kind.
 * ------------------------------------------------------------------ */
const PEOPLE_SORTS = [
  { key: 'n', label: 'Most active', fn: (a, b) => b.n - a.n },
  { key: 'last', label: 'Last active', fn: (a, b) => String(b.last_at).localeCompare(String(a.last_at)) },
  { key: 'name', label: 'Name', fn: (a, b) => String(a.user_name || '~').localeCompare(String(b.user_name || '~')) },
  { key: 'security', label: 'Most security alerts', fn: (a, b) => b.security - a.security || b.n - a.n },
  { key: 'after', label: 'Most after hours', fn: (a, b) => b.after_hours - a.after_hours || b.n - a.n },
];

// A bracket is a note and an email's domain is not a name: "Meera (REIA Admin)" is M, "reia@sjvn.in" is R.
const initials = (name) => String(name || 'System').replace(/\(.*$/, '').replace(/@.*$/, '')
  .split(/[^A-Za-z\u0900-\u097F]+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';

function PeopleView({ data, loading, sortKey, onSort, onOpenPerson, onOpenFlag }) {
  if (loading) return <div className="audit-placeholder">Loading people…</div>;
  const people = [...(data?.people || [])].sort((PEOPLE_SORTS.find((s) => s.key === sortKey) || PEOPLE_SORTS[0]).fn);
  if (!people.length) return <div className="audit-placeholder">Nobody did anything that matches these filters.</div>;
  return (
    <>
      <div className="audit-list-head">
        <span>{fmtN(people.length)} {people.length === 1 ? 'person' : 'people'}{data.truncated ? ' (the most active shown)' : ''}</span>
        <label className="audit-inline-select">
          Sort by
          <select value={sortKey} onChange={(e) => onSort(e.target.value)}>
            {PEOPLE_SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </label>
      </div>
      <div className="audit-people">
        {people.map((p) => {
          // Security alerts have their own red flag below, so they are not repeated as a kind.
          const kinds = p.activities.filter((a) => a.activity !== 'security');
          const top = kinds.slice(0, 4);
          const rest = kinds.slice(4).reduce((s, a) => s + a.n, 0);
          return (
            <div className="audit-person" key={p.user_id || 'system'}>
              <div className="audit-person-head">
                <span className="audit-avatar" aria-hidden="true">{initials(p.user_name)}</span>
                <div className="audit-person-id">
                  <div className="audit-person-name">{p.user_name || 'System'}</div>
                  <div className="audit-muted">{roleLabel(p.user_role) || 'Automatic jobs'}</div>
                </div>
                <div className="audit-person-n">
                  <strong>{fmtN(p.n)}</strong>
                  <span>event{p.n === 1 ? '' : 's'}</span>
                </div>
              </div>
              <div className="audit-person-when">
                Active on {fmtN(p.active_days)} day{p.active_days === 1 ? '' : 's'} · last {fmtDateTime(p.last_at)}
              </div>
              <div className="audit-person-kinds">
                {top.map((a) => {
                  const m = activityMeta(a.activity);
                  return (
                    <button
                      key={a.activity}
                      type="button"
                      className={`audit-kind tone-${m.tone} is-button`}
                      title={`See ${m.label.toLowerCase()} by ${p.user_name || 'the system'}`}
                      disabled={!p.user_id}
                      onClick={() => onOpenFlag(p, { activity: a.activity })}
                    >
                      {m.label} · {fmtN(a.n)}
                    </button>
                  );
                })}
                {rest > 0 && <span className="audit-muted">+{fmtN(rest)} other</span>}
              </div>
              {(p.security > 0 || p.after_hours > 0) && (
                <div className="audit-person-flags">
                  {p.security > 0 && (
                    <button type="button" className="audit-flag tone-red" disabled={!p.user_id} onClick={() => onOpenFlag(p, { activity: 'security' })}>
                      {fmtN(p.security)} security alert{p.security === 1 ? '' : 's'}
                    </button>
                  )}
                  {p.after_hours > 0 && (
                    <button type="button" className="audit-flag tone-amber" disabled={!p.user_id} onClick={() => onOpenFlag(p, { hours: 'after' })}>
                      {fmtN(p.after_hours)} outside office hours
                    </button>
                  )}
                </div>
              )}
              {p.user_id && (
                <button type="button" className="btn btn-outline btn-sm audit-person-open" onClick={() => onOpenPerson(p)}>
                  See all their activity →
                </button>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Full raw record — the "escape hatch" for auditors who need everything.
 * ------------------------------------------------------------------ */
function FullRecordModal({ log, onClose, onPivot }) {
  if (!log) return null;
  const details = safeParse(log.details);
  const before = safeParse(log.before_value);
  const after = safeParse(log.after_value);
  const meta = actionMeta(log.action);
  const diff = computeDiff(log.before_value, log.after_value);
  const summary = diff.length ? [] : summarizeDetails(log.details, 20);
  const hasRawTech = !!(details || before || after || log.prev_hash || log.curr_hash || log.trace_id || log.session_id);

  return (
    <Modal open={!!log} onClose={onClose} title="Activity details" width={720}>
      {/* Plain-English summary banner */}
      <div className="audit-banner">
        <span className={`audit-banner-dot tone-${meta.tone}`} aria-hidden="true">{meta.icon}</span>
        <div>
          <div className="audit-banner-title">{describeEvent(log)}</div>
          <div className="audit-banner-sub">
            by <strong>{log.user_name || 'System'}</strong>
            {log.user_role ? ` (${roleLabel(log.user_role)})` : ''} · {fmtDateTime(log.created_at)}
            {isAfterHours(log.created_at) ? ' · outside office hours' : ''}
          </div>
        </div>
      </div>

      {/* Friendly overview — no trace ids / hashes / IPs here */}
      <div className="detail-grid" style={{ marginTop: 8 }}>
        <div className="detail-item"><span className="detail-label">What happened</span><span className="detail-value"><Badge status={log.action} label={meta.label} /></span></div>
        {log.activity && <div className="detail-item"><span className="detail-label">Kind of activity</span><span className="detail-value"><ActivityTag kind={log.activity} /></span></div>}
        <div className="detail-item"><span className="detail-label">Area</span><span className="detail-value">{moduleLabel(log.module)}</span></div>
        <div className="detail-item"><span className="detail-label">Record</span><span className="detail-value">{entityLabel(log.entity_type)} {log.entity_id || ''}</span></div>
        <div className="detail-item"><span className="detail-label">Done by</span><span className="detail-value">{log.user_name || 'System'}{log.user_role ? ` · ${roleLabel(log.user_role)}` : ''}</span></div>
        <div className="detail-item"><span className="detail-label">When</span><span className="detail-value">{fmtDateTime(log.created_at)}</span></div>
        {log.reason && <div className="detail-item"><span className="detail-label">Reason</span><span className="detail-value">{log.reason}</span></div>}
      </div>

      <div style={{ marginTop: 12 }}>
        <Pivots log={log} onPivot={(k, v) => { onClose(); onPivot(k, v); }} />
      </div>

      {/* What changed — readable */}
      {diff.length > 0 && (
        <div className="audit-changes" style={{ marginTop: 16 }}>
          <div className="audit-changes-title">{diff.length} field{diff.length > 1 ? 's' : ''} changed</div>
          {diff.map((d) => (
            <div className="audit-change-row" key={d.field}>
              <span className="audit-change-field">{d.label}</span>
              <span className="audit-val audit-val-before">{formatValue(d.from)}</span>
              <span className="audit-arrow">→</span>
              <span className="audit-val audit-val-after">{formatValue(d.to)}</span>
            </div>
          ))}
        </div>
      )}

      {summary.length > 0 && (
        <div className="audit-changes" style={{ marginTop: 16 }}>
          <div className="audit-changes-title">Details</div>
          <div className="audit-kv-grid">
            {summary.map((s) => (
              <div className="audit-kv" key={s.field}>
                <span className="audit-kv-label">{s.label}</span>
                <span className="audit-kv-value">{formatValue(s.value)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {diff.length === 0 && summary.length === 0 && (
        <div className="audit-empty-detail" style={{ marginTop: 16 }}>No additional details were recorded for this activity.</div>
      )}

      {/* Everything technical tucked away for auditors / IT */}
      {hasRawTech && (
        <details className="audit-tech">
          <summary>Technical details (for auditors &amp; IT)</summary>
          <div className="audit-tech-body">
            <div className="detail-grid">
              <div className="detail-item"><span className="detail-label">Action code</span><span className="detail-value"><code>{log.action}</code></span></div>
              <div className="detail-item"><span className="detail-label">Trace / Session</span><span className="detail-value"><code>{log.trace_id || '—'}</code> / <code>{log.session_id || '—'}</code></span></div>
              <div className="detail-item"><span className="detail-label">IP address</span><span className="detail-value"><code>{log.ip_address || 'system'}</code></span></div>
            </div>

            {(before || after) && (
              <>
                <div className="section-title" style={{ marginTop: 14 }}>Before / after (raw)</div>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  {before && (
                    <div style={{ flex: 1, minWidth: 220 }}>
                      <div className="audit-pre-head audit-pre-head-before">Before</div>
                      <pre className="audit-pre">{JSON.stringify(before, null, 2)}</pre>
                    </div>
                  )}
                  {after && (
                    <div style={{ flex: 1, minWidth: 220 }}>
                      <div className="audit-pre-head audit-pre-head-after">After</div>
                      <pre className="audit-pre">{JSON.stringify(after, null, 2)}</pre>
                    </div>
                  )}
                </div>
              </>
            )}

            {details && (
              <>
                <div className="section-title" style={{ marginTop: 14 }}>Raw payload</div>
                <pre className="audit-pre">{JSON.stringify(details, null, 2)}</pre>
              </>
            )}

            <div className="section-title" style={{ marginTop: 14 }}>Tamper-proof fingerprint</div>
            <p className="audit-tech-note">Every action is linked to the one before it with a digital fingerprint. Auditors use these to confirm no record was altered or deleted.</p>
            <div className="audit-hash">
              <div><span className="audit-k">Previous</span> <code>{log.prev_hash || '—'}</code></div>
              <div><span className="audit-k">Current</span> <code>{log.curr_hash || '—'}</code></div>
            </div>
          </div>
        </details>
      )}
    </Modal>
  );
}

/* ------------------------------------------------------------------ *
 * Events per day for the current filters. A spike is usually the first
 * thing worth asking about; clicking a bar narrows the list to that day.
 * ------------------------------------------------------------------ */
function ActivityChart({ data, from, to, onPickDay }) {
  if (!data || data.length < 2) return null;
  return (
    <div className="audit-chart">
      <ResponsiveContainer width="100%" height={88}>
        <BarChart data={data} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
          <XAxis dataKey="day" hide />
          <YAxis hide allowDecimals={false} />
          <Tooltip
            cursor={{ fill: 'var(--primary-light)' }}
            formatter={(v) => [fmtN(v), 'events']}
            labelFormatter={(d) => fmtDate(d)}
          />
          <Bar dataKey="n" radius={[3, 3, 0, 0]} cursor="pointer" onClick={(e) => onPickDay(e?.payload?.day || e?.day)}>
            {data.map((d) => (
              <Cell key={d.day} fill={from === d.day && to === d.day ? 'var(--primary-dark, #0b3d91)' : 'var(--primary, #1f5cd6)'} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <div className="audit-chart-axis">
        <span>{fmtDate(data[0].day)}</span>
        <span>Events per day — click a bar to see that day</span>
        <span>{fmtDate(data[data.length - 1].day)}</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Saved views: a name for the current URL filters, kept in this browser.
 * ------------------------------------------------------------------ */
function SaveViewButton({ onSave }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);
  const save = (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    onSave(name.trim());
    setName('');
    setOpen(false);
  };
  return (
    <div className="audit-picker" ref={ref}>
      <button type="button" className="audit-preset" onClick={() => setOpen((o) => !o)}>☆ Save this view</button>
      {open && (
        <form className="audit-picker-pop audit-save-pop" onSubmit={save}>
          <label className="audit-muted" htmlFor="audit-save-name">Name this view</label>
          <input
            id="audit-save-name"
            autoFocus
            className="audit-picker-search"
            placeholder="e.g. Checker approvals in October"
            value={name}
            maxLength={60}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); }}
          />
          <div className="audit-picker-foot">
            <span>Kept in this browser</span>
            <button type="submit" className="btn btn-primary btn-sm" disabled={!name.trim()}>Save</button>
          </div>
        </form>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Page
 * ------------------------------------------------------------------ */
export default function AuditLogs() {
  const [params, setParams] = useSearchParams();
  const filters = useMemo(
    () => Object.fromEntries(FILTER_KEYS.map((k) => [k, params.get(k) || ''])),
    [params],
  );
  const view = VIEWS.some((v) => v.key === params.get('view')) ? params.get('view') : 'timeline';
  const order = params.get('order') === 'asc' ? 'asc' : 'desc';
  const apiParams = useMemo(() => toApiParams(filters, order), [filters, order]);
  const apiKey = JSON.stringify(apiParams);
  const filtersActive = FILTER_KEYS.some((k) => filters[k]);

  const setFilter = useCallback((patch, { replace = false } = {}) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      for (const [k, v] of Object.entries(patch)) {
        if (v) next.set(k, v); else next.delete(k);
      }
      return next;
    }, { replace });
  }, [setParams]);
  // Clearing the filters keeps how the trail is shown.
  const clearAll = () => setParams(() => {
    const next = new URLSearchParams();
    if (params.get('view')) next.set('view', params.get('view'));
    if (params.get('order')) next.set('order', params.get('order'));
    return next;
  });
  const setList = (key) => (values) => setFilter({ [key]: values.join(',') });

  // The search box types freely and settles into the URL a moment later, so
  // each keystroke is not its own query or its own history entry.
  const [searchText, setSearchText] = useState(filters.q);
  const searchRef = useRef(null);
  useEffect(() => { setSearchText(filters.q); }, [filters.q]);
  useEffect(() => {
    if (searchText.trim() === filters.q) return undefined;
    const t = setTimeout(() => setFilter({ q: searchText.trim() }, { replace: true }), 300);
    return () => clearTimeout(t);
  }, [searchText]); // eslint-disable-line react-hooks/exhaustive-deps

  // "/" jumps to search from anywhere on the page, as it does in most log tools.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
      const tag = (e.target?.tagName || '').toLowerCase();
      if (['input', 'textarea', 'select'].includes(tag) || e.target?.isContentEditable) return;
      e.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ── The trail itself ──
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(null);
  const [cursor, setCursor] = useState(null);
  const [summary, setSummary] = useState(null);
  const [people, setPeople] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const requestNo = useRef(0);

  // The People view needs the per-person summary, the other two the rows; only
  // the one on screen is fetched.
  const load = useCallback(() => {
    const mine = ++requestNo.current;
    setLoading(true);
    setError('');
    Promise.all([
      view === 'people' ? api.auditLogs.people(apiParams) : api.auditLogs.list({ ...apiParams, limit: PAGE }),
      api.auditLogs.summary(apiParams),
    ])
      .then(([main, sum]) => {
        if (mine !== requestNo.current) return; // a newer filter has been asked for since
        if (view === 'people') {
          setPeople(main);
        } else {
          setRows(main.rows || []);
          setTotal(main.total);
          setCursor(main.next_cursor);
        }
        setSummary(sum);
      })
      .catch((e) => {
        if (mine === requestNo.current) setError(e?.response?.data?.error || e?.message || 'Could not load the audit trail.');
      })
      .finally(() => { if (mine === requestNo.current) setLoading(false); });
  }, [apiKey, view]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);

  async function loadMore() {
    if (!cursor) return;
    const mine = requestNo.current;
    setLoadingMore(true);
    try {
      const page = await api.auditLogs.list({ ...apiParams, limit: PAGE, before: cursor });
      if (mine !== requestNo.current) return;
      setRows((r) => [...r, ...(page.rows || [])]);
      setCursor(page.next_cursor);
    } catch (e) {
      setError(e?.response?.data?.error || e?.message || 'Could not load older events.');
    } finally {
      setLoadingMore(false);
    }
  }

  // Dropdown options come from the whole period, not from the page on screen.
  const [facets, setFacets] = useState({ modules: [], actions: [], activities: [], roles: [], users: [], entity_types: [] });
  useEffect(() => {
    api.auditLogs.facets({ from_date: apiParams.from_date, to_date: apiParams.to_date })
      .then((f) => setFacets((cur) => ({ ...cur, ...f })))
      .catch(() => {});
  }, [apiParams.from_date, apiParams.to_date]);

  // ── Controls ──
  const [sod, setSod] = useState([]);
  const [showSod, setShowSod] = useState(false);
  const [integrity, setIntegrity] = useState(null);
  const [verifying, setVerifying] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [reportBusy, setReportBusy] = useState('');
  const [expandedId, setExpandedId] = useState(null);
  const [fullRecord, setFullRecord] = useState(null);
  const [moreFilters, setMoreFilters] = useStored('sjvn.audit.moreFilters', false);
  const [foldRepeats, setFoldRepeats] = useStored('sjvn.audit.foldRepeats', true);
  const [columns, setColumns] = useStored('sjvn.audit.tableColumns', DEFAULT_COLUMNS);
  const [peopleSort, setPeopleSort] = useStored('sjvn.audit.peopleSort', 'n');
  const [savedViews, setSavedViews] = useStored('sjvn.audit.savedViews', []);

  useEffect(() => {
    api.auditLogs.violationsSod().then(setSod).catch(() => {});
    api.auditLogs.integrity().then((r) => setIntegrity(r?.last || null)).catch(() => {});
  }, []);

  async function verify() {
    setVerifying(true);
    try {
      setIntegrity(await api.auditLogs.verifyIntegrity());
      load();
    } catch {
      setIntegrity({ isValid: false, message: 'The server could not complete the check.', at: new Date().toISOString() });
    } finally {
      setVerifying(false);
    }
  }

  async function openRecord(id) {
    try {
      setFullRecord(await api.auditLogs.get(id));
    } catch {
      setError('That record could not be opened.');
    }
  }

  async function exportCsv() {
    setExporting(true);
    setNotice('');
    try {
      const r = await api.auditLogs.exportCsv(apiParams);
      setNotice(r.truncated
        ? `Exported the first ${fmtN(r.rows)} events — narrow the filters to export the rest.`
        : `Exported ${fmtN(r.rows)} event${r.rows === 1 ? '' : 's'} to CSV. The export is itself now in the trail.`);
      load();
    } catch {
      setError('The export could not be prepared.');
    } finally {
      setExporting(false);
    }
  }

  // The PDF reports cover the same date range and module as the screen.
  async function downloadReport(kind) {
    setReportBusy(kind);
    try {
      const stamp = new Date().toISOString().slice(0, 10);
      if (kind === 'audit') {
        await api.reports.downloadPdf('/reports/audit/pdf', `SJVN_Audit_Report_${stamp}.pdf`, { from: filters.from, to: filters.to });
      } else {
        await api.reports.downloadPdf('/reports/activity/pdf', `SJVN_Activity_Report_${stamp}.pdf`, { from: filters.from, to: filters.to, module: filters.module });
      }
    } catch (err) {
      setError(err?.message || 'Could not generate the report.');
    } finally {
      setReportBusy('');
    }
  }

  const pivot = useCallback((key, value) => {
    setExpandedId(null);
    setFilter({ [key]: value, view: view === 'table' ? 'table' : '' });
    scrollPageTop('smooth');
  }, [setFilter, view]);

  // From a person's card to their events: all of them, or the slice a chip or flag names.
  const openPerson = useCallback((p, extra = {}) => {
    setFilter({ user_id: p.user_id, view: '', ...extra });
    scrollPageTop('smooth');
  }, [setFilter]);

  const toggleActivity = (key) => {
    const cur = splitList(filters.activity);
    setFilter({ activity: (cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key]).join(',') });
  };

  const applyQuick = (q) => {
    const next = new URLSearchParams();
    if (params.get('view')) next.set('view', params.get('view'));
    for (const [k, v] of Object.entries(q.set)) next.set(k, typeof v === 'function' ? v() : v);
    setParams(next);
  };
  const quickActive = (q) => FILTER_KEYS.every((k) => {
    const want = q.set[k];
    return (typeof want === 'function' ? want() : want || '') === filters[k];
  });

  // A saved view is the URL's filters, view and order; it opens as it was saved.
  const currentQs = params.toString();
  const saveView = (name) => setSavedViews((cur) => [...cur.filter((v) => v.name !== name), { name, qs: currentQs }].slice(-12));

  const days = useMemo(() => groupEvents(rows, { fold: foldRepeats }), [rows, foldRepeats]);

  const activePreset = !filters.to && PRESETS.find((p) => filters.from === daysAgo(p.days))?.key;
  const userName = (id) => facets.users.find((u) => u.user_id === id)?.user_name || id;
  const pickedActivities = splitList(filters.activity);
  const chips = [
    filters.q && { keys: ['q'], label: `“${filters.q}”` },
    filters.activity && { keys: ['activity'], label: pickedActivities.map((k) => activityMeta(k).label).join(' / ') },
    filters.category && { keys: ['category'], label: AUDIT_CATEGORIES.find((c) => c.key === filters.category)?.label || filters.category },
    filters.user_id && { keys: ['user_id'], label: `By ${splitList(filters.user_id).map(userName).join(', ')}` },
    filters.role && { keys: ['role'], label: `Role: ${splitList(filters.role).map(roleLabel).join(', ')}` },
    filters.module && { keys: ['module'], label: splitList(filters.module).map(moduleLabel).join(' / ') },
    filters.action && { keys: ['action'], label: splitList(filters.action).map((a) => actionMeta(a).label).join(' / ') },
    filters.entity_type && { keys: ['entity_type'], label: humanize(entityLabel(filters.entity_type)) },
    filters.entity_id && { keys: ['entity_id'], label: `Record ${filters.entity_id}` },
    filters.trace_id && { keys: ['trace_id'], label: `Request ${filters.trace_id}` },
    filters.hours && { keys: ['hours'], label: 'Outside office hours' },
    (filters.from || filters.to) && { keys: ['from', 'to'], label: dateRangeLabel(filters.from, filters.to) },
  ].filter(Boolean);

  // Picker options. People narrow to the roles picked, so "Checker" then a name
  // is a short list; actions are grouped under their kind of activity.
  const pickedRoles = splitList(filters.role);
  const userOptions = facets.users
    .filter((u) => !pickedRoles.length || pickedRoles.includes(u.user_role))
    .map((u) => ({ value: u.user_id, label: u.user_name || u.user_id, sub: roleLabel(u.user_role), n: u.n }));
  const roleOptions = facets.roles.map((r) => ({ value: r.user_role, label: roleLabel(r.user_role), n: r.n }));
  const moduleOptions = facets.modules.map((m) => ({ value: m.module, label: moduleLabel(m.module), n: m.n }));
  const kindOrder = AUDIT_ACTIVITIES.map((a) => a.key);
  const actionOptions = facets.actions
    .filter((a) => !pickedActivities.length || pickedActivities.includes(a.activity))
    .map((a) => ({ value: a.action, label: actionMeta(a.action).label, sub: a.action, n: a.n, group: activityMeta(a.activity).label, k: kindOrder.indexOf(a.activity) }))
    .sort((a, b) => a.k - b.k || b.n - a.n);
  const columnOptions = TABLE_COLUMNS.filter((c) => !c.fixed).map((c) => ({ value: c.key, label: c.label }));
  // Under the other filters once the summary is in; the period's counts until then.
  const activityCounts = Object.fromEntries((summary?.by_activity || facets.activities || []).map((a) => [a.activity, a.n]));
  const hiddenFilterCount = ['role', 'module', 'action', 'entity_type'].filter((k) => filters[k]).length;

  return (
    <div>
      <PageHeader
        title="Audit Trail"
        subtitle="A complete, tamper-proof history of every action taken on the platform"
        actions={
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn btn-outline" disabled={!!reportBusy} onClick={() => downloadReport('audit')}>
              {reportBusy === 'audit' ? 'Preparing…' : 'Audit Report (PDF)'}
            </button>
            <button className="btn btn-outline" disabled={!!reportBusy} onClick={() => downloadReport('activity')}>
              {reportBusy === 'activity' ? 'Preparing…' : 'Activity Report (PDF)'}
            </button>
            <button className="btn btn-secondary" disabled={exporting || !summary?.total} onClick={exportCsv}>
              {exporting ? 'Exporting…' : `Export CSV${summary?.total ? ` (${fmtN(summary.total)})` : ''}`}
            </button>
          </div>
        }
      />

      <div className="kpi-grid">
        <StatCard label="Events" value={fmtN(summary?.total)} tone="blue" hint={filtersActive ? 'matching these filters' : 'in the whole trail'} />
        <StatCard
          label="People"
          value={fmtN(summary?.users)}
          hint="distinct users acting — click for each one"
          onClick={() => setFilter({ view: view === 'people' ? '' : 'people' })}
        />
        <StatCard
          label="Security alerts"
          value={fmtN(summary?.security)}
          tone={summary?.security > 0 ? 'red' : 'green'}
          hint="failed sign-ins, denied access, overrides"
          onClick={() => setFilter({ activity: filters.activity === 'security' ? '' : 'security' })}
        />
        <StatCard
          label="Exports & downloads"
          value={fmtN(summary?.exports)}
          tone={summary?.exports > 0 ? 'amber' : 'default'}
          hint="data that left the platform"
          onClick={() => setFilter({ activity: filters.activity === 'exports' ? '' : 'exports' })}
        />
        <StatCard
          label="Outside office hours"
          value={fmtN(summary?.after_hours)}
          tone={summary?.after_hours > 0 ? 'amber' : 'default'}
          hint={`before ${OFFICE_START}:00, after ${OFFICE_END}:00 or at weekends`}
          onClick={() => setFilter({ hours: filters.hours ? '' : 'after' })}
        />
        <StatCard
          label="Duty conflicts"
          value={fmtN(sod.length)}
          tone={sod.length > 0 ? 'red' : 'green'}
          hint={sod.length > 0 ? 'same person made and approved — click to review' : 'approvals kept independent'}
          onClick={sod.length > 0 ? () => setShowSod((s) => !s) : undefined}
        />
        <StatCard
          label="Record integrity"
          value={integrity ? (integrity.isValid ? 'Verified' : 'Broken') : 'Not checked'}
          tone={integrity ? (integrity.isValid ? 'green' : 'red') : 'default'}
          hint={integrity?.at
            ? `${integrity.checked != null ? `${fmtN(integrity.checked)} records · ` : ''}${fmtDateTime(integrity.at)}`
            : 'run a full check below'}
        />
      </div>

      {error && <div className="alert alert-error" role="alert">{error}</div>}
      {notice && <div className="alert alert-success" role="status">{notice}</div>}

      {integrity && !integrity.isValid && (
        <div className="alert alert-danger" role="alert">
          <strong>Record integrity check failed.</strong> {integrity.message}
          {integrity.brokenLogId && (
            <button type="button" className="btn btn-ghost btn-sm" style={{ marginLeft: 8 }} onClick={() => openRecord(integrity.brokenLogId)}>
              Open the broken record
            </button>
          )}
        </div>
      )}
      {sod.length > 0 && !showSod && (
        <div className="alert alert-warning">
          <strong>{sod.length} duty conflict{sod.length === 1 ? '' : 's'}.</strong> The same person both made and approved an action.
          <button type="button" className="btn btn-ghost btn-sm" style={{ marginLeft: 8 }} onClick={() => setShowSod(true)}>
            Review them
          </button>
        </div>
      )}

      {showSod && sod.length > 0 && (
        <Card
          title={`Duty conflicts (${sod.length})`}
          actions={<button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowSod(false)}>Hide</button>}
        >
          <p className="audit-muted" style={{ marginTop: 0 }}>
            Each record below was created and approved by the same person — a segregation-of-duties breach to review.
          </p>
          {sod.map((v, i) => (
            <div className="audit-sod-row" key={`${v.entityId}-${i}`}>
              <div>
                <strong>{v.userName || v.userId}</strong> created and approved <code>{v.entityId}</code>
                <div className="audit-muted">{moduleLabel(v.module)} · {fmtDateTime(v.timestamp)}</div>
              </div>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setShowSod(false); pivot('entity_id', v.entityId); }}>
                Review record →
              </button>
            </div>
          ))}
        </Card>
      )}

      <Card>
        {/* 1. Search, and how to show the result */}
        <div className="audit-filter-row">
          <input
            ref={searchRef}
            type="search"
            className="audit-search"
            placeholder="Search people, actions, record IDs, reasons, details…"
            aria-label="Search the audit trail"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
          />
          <span className="audit-kbd">Press <kbd>/</kbd> to search</span>
          <div className="audit-segment" role="group" aria-label="How to show the trail">
            {VIEWS.map((v) => (
              <button
                key={v.key}
                type="button"
                title={v.hint}
                className={view === v.key ? 'is-active' : ''}
                aria-pressed={view === v.key}
                onClick={() => setFilter({ view: v.key === 'timeline' ? '' : v.key })}
              >
                {v.label}
              </button>
            ))}
          </div>
        </div>

        {/* 2. Who and when — the two questions asked most */}
        <div className="audit-filter-row audit-toolbar">
          <span className="audit-row-label">Who</span>
          <MultiPicker label="People" allLabel="Everyone" searchable options={userOptions} selected={splitList(filters.user_id)} onChange={setList('user_id')} />
          <MultiPicker label="Roles" allLabel="Any role" searchable={roleOptions.length > 8} options={roleOptions} selected={pickedRoles} onChange={setList('role')} />
          <span className="audit-row-label audit-row-gap">When</span>
          {PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              className={`audit-preset${activePreset === p.key ? ' is-active' : ''}`}
              onClick={() => setFilter({ from: activePreset === p.key ? '' : daysAgo(p.days), to: '' })}
            >
              {p.label}
            </button>
          ))}
          <input type="date" aria-label="From date" value={filters.from} max={filters.to || undefined} onChange={(e) => setFilter({ from: e.target.value })} />
          <input type="date" aria-label="To date" value={filters.to} min={filters.from || undefined} onChange={(e) => setFilter({ to: e.target.value })} />
          <label className="audit-check" title={`Before ${OFFICE_START}:00, after ${OFFICE_END}:00, or on a Saturday or Sunday`}>
            <input type="checkbox" checked={filters.hours === 'after'} onChange={(e) => setFilter({ hours: e.target.checked ? 'after' : '' })} />
            Outside office hours only
          </label>
        </div>

        {/* 3. What kind of activity */}
        <div className="audit-activity" role="group" aria-label="Kind of activity">
          <span className="audit-row-label">Activity</span>
          <button
            type="button"
            className={`audit-act${pickedActivities.length === 0 ? ' is-active' : ''}`}
            aria-pressed={pickedActivities.length === 0}
            onClick={() => setFilter({ activity: '' })}
          >
            All
          </button>
          {AUDIT_ACTIVITIES.filter((a) => activityCounts[a.key] || pickedActivities.includes(a.key)).map((a) => (
            <button
              key={a.key}
              type="button"
              title={a.hint}
              className={`audit-act tone-${a.tone}${pickedActivities.includes(a.key) ? ' is-active' : ''}`}
              aria-pressed={pickedActivities.includes(a.key)}
              onClick={() => toggleActivity(a.key)}
            >
              <span className="audit-act-dot" aria-hidden="true" />
              {a.label}
              <span className="audit-act-n">{fmtN(activityCounts[a.key] || 0)}</span>
            </button>
          ))}
        </div>

        {/* 4. Narrower filters, folded away until wanted */}
        <div className="audit-filter-row audit-toolbar">
          <button type="button" className="btn btn-ghost btn-sm" aria-expanded={moreFilters} onClick={() => setMoreFilters((o) => !o)}>
            {moreFilters ? '▾' : '▸'} More filters{hiddenFilterCount ? ` (${hiddenFilterCount} on)` : ''}
          </button>
          {moreFilters && (
            <>
              <MultiPicker label="Modules" allLabel="All modules" options={moduleOptions} selected={splitList(filters.module)} onChange={setList('module')} />
              <MultiPicker label="Actions" allLabel={pickedActivities.length ? 'Any of these actions' : 'All actions'} searchable options={actionOptions} selected={splitList(filters.action)} onChange={setList('action')} />
              <select aria-label="Record type" value={filters.entity_type} onChange={(e) => setFilter({ entity_type: e.target.value })}>
                <option value="">All record types</option>
                {facets.entity_types.map((t) => <option key={t.entity_type} value={t.entity_type}>{humanize(entityLabel(t.entity_type))} ({fmtN(t.n)})</option>)}
              </select>
            </>
          )}
          <button type="button" className="btn btn-ghost btn-sm" onClick={verify} disabled={verifying} style={{ marginLeft: 'auto' }}>
            {verifying ? 'Verifying…' : 'Verify full chain'}
          </button>
        </div>

        {/* 5. Ready-made and saved views */}
        <div className="audit-quick" aria-label="Quick views">
          <span className="audit-row-label">Quick views</span>
          {QUICK_VIEWS.map((q) => (
            <button key={q.label} type="button" className={`audit-preset${quickActive(q) ? ' is-active' : ''}`} onClick={() => applyQuick(q)}>
              {q.label}
            </button>
          ))}
          {savedViews.map((v) => (
            <span key={v.name} className={`audit-saved${v.qs === currentQs ? ' is-active' : ''}`}>
              <button type="button" onClick={() => setParams(new URLSearchParams(v.qs))}>★ {v.name}</button>
              <button type="button" aria-label={`Forget saved view ${v.name}`} onClick={() => setSavedViews((cur) => cur.filter((x) => x.name !== v.name))}>×</button>
            </span>
          ))}
          {filtersActive && <SaveViewButton onSave={saveView} />}
        </div>

        {chips.length > 0 && (
          <div className="audit-chips" aria-label="Active filters">
            {chips.map((c) => (
              <span className="audit-chip" key={c.keys.join('-')}>
                {c.label}
                <button type="button" aria-label={`Remove filter ${c.label}`} onClick={() => setFilter(Object.fromEntries(c.keys.map((k) => [k, ''])))}>×</button>
              </span>
            ))}
            <button type="button" className="btn btn-ghost btn-sm" onClick={clearAll}>Clear all</button>
          </div>
        )}

        <ActivityChart
          data={summary?.by_day}
          from={filters.from}
          to={filters.to}
          onPickDay={(day) => day && setFilter({ from: day, to: day })}
        />
      </Card>

      <Card>
        {view === 'people' ? (
          <PeopleView data={people} loading={loading} sortKey={peopleSort} onSort={setPeopleSort} onOpenPerson={(p) => openPerson(p)} onOpenFlag={openPerson} />
        ) : (
          <>
            {!loading && total != null && total > 0 && (
              <div className="audit-list-head">
                <span>Showing {fmtN(rows.length)} of {fmtN(total)} event{total === 1 ? '' : 's'}, {order === 'asc' ? 'oldest' : 'newest'} first</span>
                <div className="audit-list-tools">
                  <button type="button" className="audit-preset" onClick={() => setFilter({ order: order === 'asc' ? '' : 'asc' })}>
                    {order === 'asc' ? '↑ Oldest first' : '↓ Newest first'}
                  </button>
                  {view === 'timeline' && (
                    <label className="audit-check">
                      <input type="checkbox" checked={foldRepeats} onChange={(e) => setFoldRepeats(e.target.checked)} />
                      Fold repeated events
                    </label>
                  )}
                  {view === 'table' && (
                    <MultiPicker
                      label="Columns"
                      buttonText="Columns"
                      align="right"
                      options={columnOptions}
                      selected={columns}
                      onChange={(next) => setColumns(TABLE_COLUMNS.map((c) => c.key).filter((k) => next.includes(k)))}
                    />
                  )}
                </div>
              </div>
            )}
            {loading ? (
              <div className="audit-placeholder">Loading audit trail…</div>
            ) : rows.length === 0 ? (
              <div className="audit-placeholder">
                {filtersActive ? (
                  <>
                    <div>No events match these filters.</div>
                    <button type="button" className="btn btn-ghost btn-sm" style={{ marginTop: 8 }} onClick={clearAll}>Clear filters</button>
                  </>
                ) : 'No audit records yet.'}
              </div>
            ) : (
              <>
                {view === 'table' ? (
                  <EventTable
                    rows={rows}
                    columns={columns}
                    order={order}
                    onOrder={() => setFilter({ order: order === 'asc' ? '' : 'asc' })}
                    onOpen={setFullRecord}
                  />
                ) : (
                  <div className="audit-timeline">
                    {days.map((day) => (
                      <section className="audit-day" key={day.key}>
                        <header className="audit-day-head">
                          <span className="audit-day-label">{day.label}</span>
                          <span className="audit-day-count">
                            {day.groups.reduce((s, g) => s + g.items.length, 0)} events
                          </span>
                        </header>
                        <div className="audit-day-body">
                          {day.groups.map((group) => (
                            <EventGroup
                              key={group.id}
                              group={group}
                              ascending={order === 'asc'}
                              expandedId={expandedId}
                              onToggleEvent={(id) => setExpandedId((cur) => (cur === id ? null : id))}
                              onOpenFull={setFullRecord}
                              onPivot={pivot}
                            />
                          ))}
                        </div>
                      </section>
                    ))}
                  </div>
                )}
                {cursor && (
                  <div className="audit-more">
                    <button type="button" className="btn btn-outline" onClick={loadMore} disabled={loadingMore}>
                      {loadingMore ? 'Loading…' : `Load ${order === 'asc' ? 'later' : 'older'} events (${fmtN(total - rows.length)} more)`}
                    </button>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </Card>

      <FullRecordModal log={fullRecord} onClose={() => setFullRecord(null)} onPivot={pivot} />
    </div>
  );
}
