import React, { useEffect, useMemo, useState } from 'react';
import api from '../api/client.js';
import { PageHeader, Card, Badge, Modal, StatCard } from '../components/ui.jsx';
import {
  actionMeta, moduleLabel, entityLabel, humanize, formatValue, safeParse,
  computeDiff, summarizeDetails, detailsFieldCount, describeEvent, groupSummary,
  timeLabel, groupEvents, MODULE_LABELS,
} from '../auditMeta.js';
import { fmtDateTime, localDayKey, localDayStartUtc, localDayEndUtc } from '../datetime.js';

/* ------------------------------------------------------------------ *
 * Expanded row body — shows ONLY what changed / what matters.
 * Full payload and hash chain stay behind "View full record".
 * ------------------------------------------------------------------ */
function EventDetail({ log, onOpenFull }) {
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

      <div className="audit-detail-actions">
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
function EventRow({ log, expanded, onToggle, onOpenFull }) {
  const meta = actionMeta(log.action);
  return (
    <div className={'audit-event' + (expanded ? ' is-open' : '')}>
      <button type="button" className="audit-event-head" onClick={onToggle}>
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
      {expanded && <EventDetail log={log} onOpenFull={onOpenFull} />}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * A run of identical consecutive events, collapsed into one line.
 * ------------------------------------------------------------------ */
function EventGroup({ group, expandedId, onToggleEvent, onOpenFull }) {
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
      />
    );
  }

  const first = group.items[0];
  const last = group.items[group.items.length - 1];

  return (
    <div className={'audit-event audit-group' + (open ? ' is-open' : '')}>
      <button type="button" className="audit-event-head" onClick={() => setOpen((o) => !o)}>
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
function FullRecordModal({ log, onClose }) {
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
 * Page
 * ------------------------------------------------------------------ */
const EMPTY_FILTERS = { module: '', action_type: '', user: '', from_date: '', to_date: '' };

export default function AuditLogs() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState(null);
  const [fullRecord, setFullRecord] = useState(null);

  const [sodViolations, setSodViolations] = useState([]);
  const [integrityStatus, setIntegrityStatus] = useState(null);
  const [verifying, setVerifying] = useState(false);

  useEffect(() => { fetchLogs(); }, [filters.module, filters.action_type, filters.from_date, filters.to_date]);
  useEffect(() => { api.auditLogs.violationsSod().then(setSodViolations).catch(() => {}); }, []);

  function fetchLogs() {
    setLoading(true);
    const params = {};
    if (filters.module) params.module = filters.module;
    if (filters.action_type) params.action_type = filters.action_type;
    if (filters.from_date) params.from_date = localDayStartUtc(filters.from_date);
    if (filters.to_date) params.to_date = localDayEndUtc(filters.to_date);
    api.auditLogs.list(Object.keys(params).length ? params : undefined)
      .then(setRows)
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }

  async function handleVerifyIntegrity() {
    setVerifying(true);
    try {
      setIntegrityStatus(await api.auditLogs.verifyIntegrity());
      fetchLogs();
    } catch (_) {
      setIntegrityStatus({ isValid: false, message: 'Server error during verification.' });
    } finally {
      setVerifying(false);
    }
  }

  function handleExport() {
    api.auditLogs.logExport({ module: filters.module || 'ALL', count: visible.length })
      .then(() => { alert(`Export of ${visible.length} log(s) recorded in the audit trail.`); fetchLogs(); })
      .catch(() => alert('Failed to record export'));
  }

  // Action + user options are derived from what's actually present.
  const actionOptions = useMemo(
    () => [...new Set(rows.map((r) => r.action))].sort(),
    [rows]
  );
  const userOptions = useMemo(
    () => [...new Set(rows.map((r) => r.user_name).filter(Boolean))].sort(),
    [rows]
  );

  // Free-text search runs client-side across the fields an auditor would
  // actually type: person, action, entity ref, trace id.
  const visible = useMemo(() => {
    let out = rows;
    if (filters.user) out = out.filter((r) => r.user_name === filters.user);
    const q = search.trim().toLowerCase();
    if (q) {
      out = out.filter((r) =>
        [r.user_name, r.user_role, r.action, r.module, r.entity_type, r.entity_id, r.trace_id, r.reason, r.details]
          .filter(Boolean)
          .some((f) => String(f).toLowerCase().includes(q))
      );
    }
    return out;
  }, [rows, filters.user, search]);

  const days = useMemo(() => groupEvents(visible), [visible]);

  const stats = useMemo(() => {
    // Compare local calendar days — slicing the raw UTC string counts events
    // against the wrong day for anyone east or west of UTC.
    const today = localDayKey(new Date());
    return {
      total: visible.length,
      today: visible.filter((r) => localDayKey(r.created_at) === today).length,
      users: new Set(visible.map((r) => r.user_name).filter(Boolean)).size,
    };
  }, [visible]);

  const filtersActive = search.trim() !== '' || Object.values(filters).some(Boolean);

  return (
    <div>
      <PageHeader
        title="Activity Log"
        subtitle="A complete, tamper-proof history of every action taken on the platform"
        actions={<button className="btn btn-secondary" onClick={handleExport}>Export</button>}
      />

      <div className="kpi-grid">
        <StatCard label="Events shown" value={stats.total} tone="blue" />
        <StatCard label="Today" value={stats.today} />
        <StatCard label="Active users" value={stats.users} />
        <StatCard
          label="Duty conflicts"
          value={sodViolations.length}
          tone={sodViolations.length > 0 ? 'red' : 'green'}
          hint={sodViolations.length > 0 ? 'Same person approved their own action' : 'Approvals kept independent'}
        />
        <StatCard
          label="Record integrity"
          value={integrityStatus ? (integrityStatus.isValid ? 'Verified' : 'Tampered') : 'Not checked'}
          tone={integrityStatus ? (integrityStatus.isValid ? 'green' : 'red') : 'default'}
          hint={integrityStatus?.message}
        />
      </div>

      <Card>
        <div className="audit-toolbar">
          <input
            type="search"
            className="audit-search"
            placeholder="Search user, action, entity ID or trace…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select value={filters.module} onChange={(e) => setFilters({ ...filters, module: e.target.value })}>
            <option value="">All modules</option>
            {Object.entries(MODULE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <select value={filters.action_type} onChange={(e) => setFilters({ ...filters, action_type: e.target.value })}>
            <option value="">All actions</option>
            {actionOptions.map((a) => <option key={a} value={a}>{actionMeta(a).label}</option>)}
          </select>
          <select value={filters.user} onChange={(e) => setFilters({ ...filters, user: e.target.value })}>
            <option value="">All users</option>
            {userOptions.map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
          <input type="date" value={filters.from_date} title="From date"
            onChange={(e) => setFilters({ ...filters, from_date: e.target.value })} />
          <input type="date" value={filters.to_date} title="To date"
            onChange={(e) => setFilters({ ...filters, to_date: e.target.value })} />
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={!filtersActive}
            onClick={() => { setFilters(EMPTY_FILTERS); setSearch(''); }}
          >
            Clear
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={handleVerifyIntegrity} disabled={verifying}>
            {verifying ? 'Verifying…' : 'Verify integrity'}
          </button>
        </div>
      </Card>

      {integrityStatus && !integrityStatus.isValid && (
        <div className="audit-alert audit-alert-danger">
          <strong>Record integrity check failed.</strong> {integrityStatus.message}
        </div>
      )}
      {sodViolations.length > 0 && (
        <div className="audit-alert audit-alert-warn">
          <strong>{sodViolations.length} duty conflict(s).</strong> The same person both made and approved an action.
        </div>
      )}

      <Card>
        {loading ? (
          <div className="audit-placeholder">Loading audit trail…</div>
        ) : days.length === 0 ? (
          <div className="audit-placeholder">
            {filtersActive ? 'No events match these filters.' : 'No audit records yet.'}
          </div>
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
                      expandedId={expandedId}
                      onToggleEvent={(id) => setExpandedId((cur) => (cur === id ? null : id))}
                      onOpenFull={setFullRecord}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </Card>

      <FullRecordModal log={fullRecord} onClose={() => setFullRecord(null)} />
    </div>
  );
}
