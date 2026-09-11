import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import api from '../api/client.js';
import { PageHeader, Card, Badge, Modal, StatCard } from '../components/ui.jsx';
import {
  actionMeta, moduleLabel, entityLabel, humanize, formatValue, safeParse,
  computeDiff, summarizeDetails, detailsFieldCount, describeEvent, groupSummary,
  timeLabel, groupEvents, AUDIT_CATEGORIES,
} from '../auditMeta.js';
import { fmtDateTime, fmtDate, localDayStartUtc, localDayEndUtc } from '../datetime.js';

const PAGE = 100;

// Every filter lives in the URL, so a view of the trail can be bookmarked,
// shared with a colleague, or left with the back button.
const FILTER_KEYS = ['q', 'category', 'module', 'action', 'user_id', 'entity_type', 'entity_id', 'trace_id', 'from', 'to'];

const fmtN = (n) => (n == null ? '…' : Number(n).toLocaleString('en-IN'));

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

/** URL filters to API query. Dates become the UTC bounds of the viewer's local days. */
function toApiParams(f) {
  const p = {};
  for (const k of ['q', 'category', 'module', 'action', 'user_id', 'entity_type', 'entity_id', 'trace_id']) {
    if (f[k]) p[k] = f[k];
  }
  if (f.from) p.from_date = localDayStartUtc(f.from);
  if (f.to) p.to_date = localDayEndUtc(f.to);
  return p;
}

function dateRangeLabel(from, to) {
  if (from && from === to) return fmtDate(from);
  return `${from ? fmtDate(from) : 'Start'} – ${to ? fmtDate(to) : 'now'}`;
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
            {log.user_role && <span className="audit-role"> · {humanize(log.user_role)}</span>}
          </span>
        </span>
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
function EventGroup({ group, expandedId, onToggleEvent, onOpenFull, onPivot }) {
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

  return (
    <div className={'audit-event audit-group' + (open ? ' is-open' : '')}>
      <button type="button" className="audit-event-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="audit-time">
          {timeLabel(last.created_at)}–{timeLabel(first.created_at)}
        </span>
        <span className={`audit-dot tone-${meta.tone}`} aria-hidden="true">{meta.icon}</span>
        <span className="audit-summary">
          <span className="audit-desc">{groupSummary(group)}</span>
          <span className="audit-actor">
            {group.user_name || 'System'}
            {group.user_role && <span className="audit-role"> · {humanize(group.user_role)}</span>}
          </span>
        </span>
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
            {log.user_role ? ` (${humanize(log.user_role)})` : ''} · {fmtDateTime(log.created_at)}
          </div>
        </div>
      </div>

      {/* Friendly overview — no trace ids / hashes / IPs here */}
      <div className="detail-grid" style={{ marginTop: 8 }}>
        <div className="detail-item"><span className="detail-label">What happened</span><span className="detail-value"><Badge status={log.action} label={meta.label} /></span></div>
        <div className="detail-item"><span className="detail-label">Area</span><span className="detail-value">{moduleLabel(log.module)}</span></div>
        <div className="detail-item"><span className="detail-label">Record</span><span className="detail-value">{entityLabel(log.entity_type)} {log.entity_id || ''}</span></div>
        <div className="detail-item"><span className="detail-label">Done by</span><span className="detail-value">{log.user_name || 'System'}{log.user_role ? ` · ${humanize(log.user_role)}` : ''}</span></div>
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
            cursor={{ fill: 'rgba(31, 92, 214, 0.08)' }}
            formatter={(v) => [fmtN(v), 'events']}
            labelFormatter={(d) => fmtDate(d)}
          />
          <Bar dataKey="n" radius={[3, 3, 0, 0]} cursor="pointer" onClick={(e) => onPickDay(e?.payload?.day || e?.day)}>
            {data.map((d) => (
              <Cell key={d.day} fill={from === d.day && to === d.day ? '#0b3d91' : '#1f5cd6'} />
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
 * Page
 * ------------------------------------------------------------------ */
export default function AuditLogs() {
  const [params, setParams] = useSearchParams();
  const filters = useMemo(
    () => Object.fromEntries(FILTER_KEYS.map((k) => [k, params.get(k) || ''])),
    [params],
  );
  const apiParams = useMemo(() => toApiParams(filters), [filters]);
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
  const clearAll = () => setParams(new URLSearchParams());

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
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const requestNo = useRef(0);

  const load = useCallback(() => {
    const mine = ++requestNo.current;
    setLoading(true);
    setError('');
    Promise.all([
      api.auditLogs.list({ ...apiParams, limit: PAGE }),
      api.auditLogs.summary({ ...apiParams, tz_offset: -new Date().getTimezoneOffset() }),
    ])
      .then(([page, sum]) => {
        if (mine !== requestNo.current) return; // a newer filter has been asked for since
        setRows(page.rows || []);
        setTotal(page.total);
        setCursor(page.next_cursor);
        setSummary(sum);
      })
      .catch((e) => {
        if (mine === requestNo.current) setError(e?.response?.data?.error || e?.message || 'Could not load the audit trail.');
      })
      .finally(() => { if (mine === requestNo.current) setLoading(false); });
  }, [apiKey]); // eslint-disable-line react-hooks/exhaustive-deps

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
  const [facets, setFacets] = useState({ modules: [], actions: [], users: [], entity_types: [] });
  useEffect(() => {
    api.auditLogs.facets({ from_date: apiParams.from_date, to_date: apiParams.to_date })
      .then(setFacets)
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
        ? `Exported the newest ${fmtN(r.rows)} events — narrow the filters to export the rest.`
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
    setFilter({ [key]: value });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [setFilter]);

  const days = useMemo(() => groupEvents(rows), [rows]);

  const activePreset = !filters.to && PRESETS.find((p) => filters.from === daysAgo(p.days))?.key;
  const userName = (id) => facets.users.find((u) => u.user_id === id)?.user_name || id;
  const chips = [
    filters.q && { keys: ['q'], label: `“${filters.q}”` },
    filters.category && { keys: ['category'], label: AUDIT_CATEGORIES.find((c) => c.key === filters.category)?.label || filters.category },
    filters.module && { keys: ['module'], label: moduleLabel(filters.module) },
    filters.action && { keys: ['action'], label: filters.action.split(',').map((a) => actionMeta(a).label).join(' / ') },
    filters.user_id && { keys: ['user_id'], label: `By ${userName(filters.user_id)}` },
    filters.entity_type && { keys: ['entity_type'], label: humanize(entityLabel(filters.entity_type)) },
    filters.entity_id && { keys: ['entity_id'], label: `Record ${filters.entity_id}` },
    filters.trace_id && { keys: ['trace_id'], label: `Request ${filters.trace_id}` },
    (filters.from || filters.to) && { keys: ['from', 'to'], label: dateRangeLabel(filters.from, filters.to) },
  ].filter(Boolean);

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
            <button className="btn btn-secondary" disabled={exporting || !total} onClick={exportCsv}>
              {exporting ? 'Exporting…' : `Export CSV${total ? ` (${fmtN(total)})` : ''}`}
            </button>
          </div>
        }
      />

      <div className="kpi-grid">
        <StatCard label="Events" value={fmtN(summary?.total)} tone="blue" hint={filtersActive ? 'matching these filters' : 'in the whole trail'} />
        <StatCard label="People" value={fmtN(summary?.users)} hint="distinct users acting" />
        <StatCard
          label="Security events"
          value={fmtN(summary?.security)}
          tone={summary?.security > 0 ? 'red' : 'green'}
          hint="failed / blocked sign-ins, denied access"
          onClick={() => setFilter({ category: filters.category === 'security' ? '' : 'security' })}
        />
        <StatCard
          label="Exports & downloads"
          value={fmtN(summary?.exports)}
          tone={summary?.exports > 0 ? 'amber' : 'default'}
          hint="data that left the platform"
          onClick={() => setFilter({ category: filters.category === 'exports' ? '' : 'exports' })}
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
          <div className="audit-segment" role="group" aria-label="Kind of activity">
            {AUDIT_CATEGORIES.map((c) => (
              <button
                key={c.key || 'all'}
                type="button"
                className={filters.category === c.key ? 'is-active' : ''}
                aria-pressed={filters.category === c.key}
                onClick={() => setFilter({ category: c.key })}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>

        <div className="audit-filter-row audit-toolbar">
          <select aria-label="Module" value={filters.module} onChange={(e) => setFilter({ module: e.target.value })}>
            <option value="">All modules</option>
            {facets.modules.map((m) => <option key={m.module} value={m.module}>{moduleLabel(m.module)} ({fmtN(m.n)})</option>)}
          </select>
          <select aria-label="Action" value={filters.action} onChange={(e) => setFilter({ action: e.target.value })}>
            <option value="">All actions</option>
            {facets.actions.map((a) => <option key={a.action} value={a.action}>{actionMeta(a.action).label} ({fmtN(a.n)})</option>)}
          </select>
          <select aria-label="User" value={filters.user_id} onChange={(e) => setFilter({ user_id: e.target.value })}>
            <option value="">All users</option>
            {facets.users.map((u) => (
              <option key={u.user_id} value={u.user_id}>
                {u.user_name || u.user_id}{u.user_role ? ` · ${humanize(u.user_role)}` : ''} ({fmtN(u.n)})
              </option>
            ))}
          </select>
          <select aria-label="Record type" value={filters.entity_type} onChange={(e) => setFilter({ entity_type: e.target.value })}>
            <option value="">All record types</option>
            {facets.entity_types.map((t) => <option key={t.entity_type} value={t.entity_type}>{humanize(entityLabel(t.entity_type))} ({fmtN(t.n)})</option>)}
          </select>
          {PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              className={`audit-preset${activePreset === p.key ? ' is-active' : ''}`}
              onClick={() => setFilter({ from: daysAgo(p.days), to: '' })}
            >
              {p.label}
            </button>
          ))}
          <input type="date" aria-label="From date" value={filters.from} max={filters.to || undefined} onChange={(e) => setFilter({ from: e.target.value })} />
          <input type="date" aria-label="To date" value={filters.to} min={filters.from || undefined} onChange={(e) => setFilter({ to: e.target.value })} />
          <button type="button" className="btn btn-ghost btn-sm" onClick={verify} disabled={verifying} style={{ marginLeft: 'auto' }}>
            {verifying ? 'Verifying…' : 'Verify full chain'}
          </button>
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
        {!loading && total != null && total > 0 && (
          <div className="audit-list-head">
            <span>Showing {fmtN(rows.length)} of {fmtN(total)} event{total === 1 ? '' : 's'}, newest first</span>
            <span>Click an event for what changed; follow its links to trace a record, a person or a request.</span>
          </div>
        )}
        {loading ? (
          <div className="audit-placeholder">Loading audit trail…</div>
        ) : days.length === 0 ? (
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
            {cursor && (
              <div className="audit-more">
                <button type="button" className="btn btn-outline" onClick={loadMore} disabled={loadingMore}>
                  {loadingMore ? 'Loading…' : `Load older events (${fmtN(total - rows.length)} more)`}
                </button>
              </div>
            )}
          </>
        )}
      </Card>

      <FullRecordModal log={fullRecord} onClose={() => setFullRecord(null)} onPivot={pivot} />
    </div>
  );
}
