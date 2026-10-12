import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Settings } from 'lucide-react';
import api from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { ROLE_GROUPS } from '../roles.js';
import { PageHeader, Card, StatCard, Modal, Field } from '../components/ui.jsx';
import KYCBanner from '../components/KYCBanner.jsx';
import { fmtDateTime } from '../datetime.js';

const SEV = {
  CRITICAL: { label: 'Critical', cls: 'sev-critical', dot: 'var(--red-strong)' },
  WARNING: { label: 'Attention', cls: 'sev-warning', dot: '#d97706' },
  INFO: { label: 'For information', cls: 'sev-info', dot: '#2563eb' },
};

const EMPTY_BROADCAST = { title: '', message: '', severity: 'INFO', audience: 'ALL', expires_at: '' };
const EMPTY_HISTORY = { q: '', severity: '', group: '', status: '', from: '', to: '' };

// How many cards a severity group, and how many pinned messages, show before "Show more".
const GROUP_PAGE = 6;
const BROADCAST_PAGE = 3;
const HISTORY_PAGE = 25;

const LEVELS = [
  { value: 'NONE', label: 'Nothing — I will look at the board' },
  { value: 'CRITICAL', label: 'Critical alerts only' },
  { value: 'WARNING', label: 'Critical and Attention alerts' },
  { value: 'INFO', label: 'Every alert' },
];

const matches = (text, ...fields) => !text || fields.some((f) => String(f || '').toLowerCase().includes(text));

/** How long something was on the board, in the largest unit that reads sensibly. */
function lasted(from, to) {
  const parse = (v) => new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(v) ? v : `${v.replace(' ', 'T')}Z`);
  const mins = Math.max(0, Math.round((parse(to) - parse(from)) / 60000));
  if (mins < 60) return `${mins} min`;
  if (mins < 48 * 60) return `${Math.round(mins / 60)} h`;
  return `${Math.round(mins / 1440)} days`;
}

function Preferences({ onClose, onSaved }) {
  const [prefs, setPrefs] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.alerts.preferences().then(setPrefs).catch((e) => setError(e.response?.data?.error || e.message));
  }, []);

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.alerts.savePreferences({ email_min: prefs.email_min, sms_min: prefs.sms_min });
      onSaved();
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="Alert settings">
      {error && <div className="alert alert-error" role="alert">{error}</div>}
      {!prefs ? <p className="inline-note">Loading…</p> : (
        <form onSubmit={submit}>
          <p className="inline-note">
            Every alert is always on the board. Choose which ones should also be sent to you when they first appear.
          </p>
          <Field label="Email me">
            <select value={prefs.email_min} onChange={(e) => setPrefs({ ...prefs, email_min: e.target.value })}>
              {LEVELS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
            </select>
          </Field>
          <p className="inline-note">Sent to {prefs.email || 'the email on your login'}.</p>
          <Field label="SMS me">
            <select value={prefs.sms_min} onChange={(e) => setPrefs({ ...prefs, sms_min: e.target.value })}>
              {LEVELS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
            </select>
          </Field>
          <p className="inline-note">
            {!prefs.phone
              ? 'There is no mobile number on your login, so no SMS can reach you yet. Your choice is kept.'
              : !prefs.sms_ready
                ? `SMS for board alerts is not switched on yet. Your choice is kept and will apply to ${prefs.phone} once it is.`
                : `Sent to ${prefs.phone}.`}
          </p>
          <div className="form-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
          </div>
        </form>
      )}
    </Modal>
  );
}

function History({ groups }) {
  const [filters, setFilters] = useState(EMPTY_HISTORY);
  const [data, setData] = useState({ items: [], total: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchPage = useCallback((offset) => {
    setLoading(true);
    const params = Object.fromEntries(Object.entries(filters).filter(([, v]) => v));
    api.alerts.history({ ...params, limit: HISTORY_PAGE, offset })
      .then((r) => {
        setData((d) => ({ total: r.total, items: offset ? [...d.items, ...r.items] : r.items }));
        setError('');
      })
      .catch((e) => setError(e.response?.data?.error || e.message))
      .finally(() => setLoading(false));
  }, [filters]);

  useEffect(() => {
    const t = setTimeout(() => fetchPage(0), filters.q ? 250 : 0);
    return () => clearTimeout(t);
  }, [fetchPage, filters.q]);

  const set = (k) => (e) => setFilters({ ...filters, [k]: e.target.value });
  const filtered = Object.values(filters).some(Boolean);

  return (
    <div>
      <div className="nb-toolbar">
        <input type="search" placeholder="Search past alerts…" value={filters.q} onChange={set('q')} aria-label="Search history" />
        <select value={filters.severity} onChange={set('severity')} aria-label="Severity">
          <option value="">Any severity</option>
          {Object.entries(SEV).map(([k, s]) => <option key={k} value={k}>{s.label}</option>)}
        </select>
        <select value={filters.group} onChange={set('group')} aria-label="Category">
          <option value="">Any category</option>
          {Object.entries(groups).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </select>
        <select value={filters.status} onChange={set('status')} aria-label="Status">
          <option value="">Open and cleared</option>
          <option value="open">Still open</option>
          <option value="resolved">Cleared</option>
        </select>
        <input type="date" value={filters.from} onChange={set('from')} aria-label="From date" />
        <input type="date" value={filters.to} onChange={set('to')} aria-label="To date" />
        {filtered && <button type="button" className="nb-link-btn" onClick={() => setFilters(EMPTY_HISTORY)}>Clear</button>}
      </div>

      {error && <div className="alert alert-error" role="alert">{error}</div>}

      <Card>
        {!data.items.length ? (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-light)', fontSize: 13 }}>
            {loading ? 'Loading history…' : filtered
              ? 'Nothing in the history matches.'
              : 'Nothing has been recorded yet. Alerts are logged here from the moment they first appear on the board.'}
          </div>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>First shown</th>
                  <th>Severity</th>
                  <th>Category</th>
                  <th>Alert</th>
                  <th style={{ textAlign: 'right' }}>Peak</th>
                  <th>Cleared</th>
                  <th>Lasted</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((h) => {
                  const s = SEV[h.severity] || SEV.INFO;
                  return (
                    <tr key={`${h.kind}-${h.id}`}>
                      <td style={{ whiteSpace: 'nowrap' }}>{fmtDateTime(h.started_at)}</td>
                      <td><span className={`nb-sev-tag ${s.cls}`}>{s.label}</span></td>
                      <td>{h.kind === 'BROADCAST' ? 'Message' : h.category}</td>
                      <td>
                        <div style={{ fontWeight: 600 }}>{h.title}</div>
                        <div className="nb-history-detail">
                          {h.detail}{h.posted_by ? ` — posted by ${h.posted_by}` : ''}
                        </div>
                      </td>
                      <td style={{ textAlign: 'right' }}>{h.peak_count ?? '—'}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{h.ended_at ? fmtDateTime(h.ended_at) : 'Still open'}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{h.ended_at ? lasted(h.started_at, h.ended_at) : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <p className="inline-note" style={{ marginTop: 10 }}>
        Showing {data.items.length} of {data.total}.
      </p>
      {data.items.length < data.total && (
        <button type="button" className="btn nb-more" disabled={loading} onClick={() => fetchPage(data.items.length)}>
          {loading ? 'Loading…' : 'Load more'}
        </button>
      )}
    </div>
  );
}

export default function NotificationBoard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const canPost = ROLE_GROUPS.REIA_WRITE.includes(user?.role) || ROLE_GROUPS.HYDRO_THERMAL_WRITE?.includes(user?.role);

  const [tab, setTab] = useState('LIVE');
  const [board, setBoard] = useState({ broadcasts: [], alerts: [], summary: {}, groups: {} });
  const [loading, setLoading] = useState(true);
  const [showCompose, setShowCompose] = useState(false);
  const [showPrefs, setShowPrefs] = useState(false);
  const [form, setForm] = useState(EMPTY_BROADCAST);
  const [saving, setSaving] = useState(false);
  const [q, setQ] = useState('');
  const [group, setGroup] = useState('');
  const [expanded, setExpanded] = useState({});
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(() => {
    api.alerts.board()
      .then(setBoard)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [load]);

  async function postBroadcast(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.alerts.createBroadcast({
        ...form,
        expires_at: form.expires_at ? new Date(form.expires_at).toISOString() : null,
      });
      setShowCompose(false);
      setForm(EMPTY_BROADCAST);
      load();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to post message');
    } finally {
      setSaving(false);
    }
  }

  async function removeBroadcast(id) {
    if (!window.confirm('Remove this message from the board?')) return;
    try {
      await api.alerts.deleteBroadcast(id);
      load();
    } catch {
      alert('Failed to remove message');
    }
  }

  // The answer to an acknowledgement is the board as it now stands.
  async function acknowledge(kind, key, on = true) {
    try {
      setBoard(await (on ? api.alerts.acknowledge(kind, key) : api.alerts.unacknowledge(kind, key)));
      setError('');
    } catch (err) {
      setError(err.response?.data?.error || err.message);
      load();
    }
  }

  const { broadcasts = [], alerts = [], summary = {}, groups = {} } = board;
  const text = q.trim().toLowerCase();

  const view = useMemo(() => {
    const liveAlerts = alerts.filter((a) => !a.acknowledged);
    const liveBroadcasts = broadcasts.filter((b) => !b.acknowledged);
    const shownAlerts = liveAlerts.filter((a) => (!group || a.group === group) && matches(text, a.title, a.detail, a.category));
    const shownBroadcasts = liveBroadcasts.filter((b) => (!group || group === 'BROADCAST') && matches(text, b.title, b.message));
    // The chips say how many of each there are, whatever is being searched for.
    const counts = { BROADCAST: liveBroadcasts.length };
    for (const a of liveAlerts) counts[a.group] = (counts[a.group] || 0) + 1;
    return {
      counts,
      total: liveAlerts.length + liveBroadcasts.length,
      broadcasts: shownBroadcasts,
      grouped: Object.fromEntries(Object.keys(SEV).map((sev) => [sev, shownAlerts.filter((a) => a.severity === sev)])),
      shown: shownAlerts.length + shownBroadcasts.length,
      acked: [
        ...broadcasts.filter((b) => b.acknowledged).map((b) => ({ kind: 'BROADCAST', key: b.id, title: b.title, detail: b.message, severity: b.severity })),
        ...alerts.filter((a) => a.acknowledged).map((a) => ({ kind: 'ALERT', key: a.id, title: a.title, detail: a.detail, severity: a.severity })),
      ],
    };
  }, [alerts, broadcasts, group, text]);

  const filtering = !!text || !!group;
  const moreBroadcasts = view.broadcasts.length > BROADCAST_PAGE && !expanded.BROADCAST;

  return (
    <div>
      <KYCBanner />
      <PageHeader
        title="Notification Board"
        subtitle="Live alerts across billing, payments, security, disputes & reconciliation — all in one place"
        actions={(
          <>
            <button className="btn" onClick={() => setShowPrefs(true)} title="Choose which alerts are also sent to you by email or SMS">
              <Settings size={14} style={{ marginRight: 6, verticalAlign: -2 }} />Alert settings
            </button>
          </>
        )}
      />

      {error && <div className="alert alert-error" role="alert">{error}</div>}
      {notice && <div className="alert alert-success" role="status">{notice}</div>}

      <div className="nb-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'LIVE'} className={`nb-tab ${tab === 'LIVE' ? 'active' : ''}`} onClick={() => setTab('LIVE')}>Live board</button>
        <button type="button" role="tab" aria-selected={tab === 'HISTORY'} className={`nb-tab ${tab === 'HISTORY' ? 'active' : ''}`} onClick={() => setTab('HISTORY')}>History</button>
      </div>

      {tab === 'HISTORY' ? <History groups={groups} /> : (
        <>
          <div className="kpi-grid">
            <StatCard label="Critical" value={summary.critical ?? 0} tone={summary.critical ? 'red' : 'green'} hint="Need immediate action" />
            <StatCard label="Attention" value={summary.warning ?? 0} tone={summary.warning ? 'amber' : 'default'} hint="Due soon / review" />
            <StatCard label="For information" value={summary.info ?? 0} tone="blue" />
            <StatCard label="Items flagged" value={summary.total_items ?? 0} hint={summary.acknowledged ? `${summary.acknowledged} alert(s) acknowledged, not counted` : 'Across all modules'} />
          </div>

          <div className="nb-toolbar">
            <input type="search" placeholder="Search alerts…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search alerts" />
            <button type="button" className={`nb-chip ${group ? '' : 'active'}`} aria-pressed={!group} onClick={() => setGroup('')}>
              All<small>{view.total}</small>
            </button>
            {Object.entries(groups).map(([k, label]) => (
              <button key={k} type="button" className={`nb-chip ${group === k ? 'active' : ''}`} aria-pressed={group === k} onClick={() => setGroup(group === k ? '' : k)}>
                {label}<small>{view.counts[k] || 0}</small>
              </button>
            ))}
          </div>

          {/* Admin flash messages, pinned */}
          {view.broadcasts.length > 0 && (
            <div style={{ margin: '4px 0 18px' }}>
              {view.broadcasts.slice(0, expanded.BROADCAST ? undefined : BROADCAST_PAGE).map((b) => {
                const s = SEV[b.severity] || SEV.INFO;
                return (
                  <div key={b.id} className={`nb-broadcast ${s.cls}`}>
                    <span className="nb-pin" aria-hidden="true"></span>
                    <div className="nb-broadcast-body">
                      <div className="nb-broadcast-title">{b.title}</div>
                      <div className="nb-broadcast-msg">{b.message}</div>
                      <div className="nb-broadcast-meta">
                        Posted by {b.created_by_name || 'Admin'} · {fmtDateTime(b.created_at)}
                        {b.expires_at ? ` · until ${fmtDateTime(b.expires_at)}` : ''}
                      </div>
                    </div>
                    <button type="button" className="nb-link-btn" title="Take this off my board" onClick={() => acknowledge('BROADCAST', b.id)}>Acknowledge</button>
                    {canPost && (
                      <button type="button" className="nb-link-btn" title="Remove for everyone" onClick={() => removeBroadcast(b.id)}>Remove</button>
                    )}
                  </div>
                );
              })}
              {moreBroadcasts && (
                <button type="button" className="nb-link-btn" onClick={() => setExpanded({ ...expanded, BROADCAST: true })}>
                  Show all {view.broadcasts.length} messages
                </button>
              )}
            </div>
          )}

          {loading ? (
            <Card><div style={{ padding: 24, textAlign: 'center', color: 'var(--text-light)' }}>Loading alerts…</div></Card>
          ) : view.shown === 0 ? (
            <Card>
              <div style={{ padding: 40, textAlign: 'center' }}>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>{filtering ? 'Nothing matches' : 'All clear'}</div>
                <div style={{ color: 'var(--text-light)', fontSize: 13 }}>
                  {filtering
                    ? 'No alert on the board matches that search or category.'
                    : view.acked.length
                      ? 'Everything on the board has been acknowledged. It comes back here if it gets worse.'
                      : 'No urgent alerts right now. This board refreshes automatically.'}
                </div>
              </div>
            </Card>
          ) : (
            Object.keys(SEV).map((sev) => {
              const list = view.grouped[sev];
              if (!list.length) return null;
              const open = expanded[sev];
              return (
                <div key={sev} style={{ marginBottom: 18 }}>
                  <div className="nb-group-head">
                    <span className="nb-group-dot" style={{ background: SEV[sev].dot }} />
                    {SEV[sev].label}
                    <span className="nb-group-count">{list.length}</span>
                  </div>
                  <div className="nb-alert-grid">
                    {list.slice(0, open ? undefined : GROUP_PAGE).map((a) => (
                      <div key={a.id} className={`nb-alert ${SEV[sev].cls}`}>
                        <div className="nb-alert-top">
                          <span className="nb-alert-cat">{a.category}</span>
                          <span className="nb-alert-count">{a.count}</span>
                        </div>
                        <div className="nb-alert-title">{a.title}</div>
                        <div className="nb-alert-detail">{a.detail}</div>
                        {a.since && <div className="nb-alert-since">On the board since {fmtDateTime(a.since)}</div>}
                        <div className="nb-alert-actions">
                          {a.link && <button type="button" className="primary" onClick={() => navigate(a.link)}>View →</button>}
                          <button type="button" className="ack" title="Seen it — take it off my board until it gets worse" onClick={() => acknowledge('ALERT', a.id)}>Acknowledge</button>
                        </div>
                      </div>
                    ))}
                  </div>
                  {list.length > GROUP_PAGE && !open && (
                    <button type="button" className="btn nb-more" onClick={() => setExpanded({ ...expanded, [sev]: true })}>
                      Show {list.length - GROUP_PAGE} more
                    </button>
                  )}
                </div>
              );
            })
          )}

          {view.acked.length > 0 && (
            <details className="nb-acked">
              <summary>Acknowledged by you ({view.acked.length}) — still open, hidden from your board</summary>
              {view.acked.map((x) => (
                <div key={`${x.kind}-${x.key}`} className="nb-acked-row">
                  <span className={`nb-sev-tag ${(SEV[x.severity] || SEV.INFO).cls}`}>{(SEV[x.severity] || SEV.INFO).label}</span>
                  <div className="grow">
                    <div style={{ fontWeight: 600 }}>{x.title}</div>
                    <div className="muted">{x.detail}</div>
                  </div>
                  <button type="button" className="nb-link-btn" onClick={() => acknowledge(x.kind, x.key, false)}>Put back</button>
                </div>
              ))}
            </details>
          )}
        </>
      )}

      <Modal open={showCompose} onClose={() => setShowCompose(false)} title="Post a message to the board">
        <form onSubmit={postBroadcast}>
          <Field label="Title" required>
            <input required value={form.title} placeholder="e.g. Quarter-end billing freeze on 31st"
              onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </Field>
          <Field label="Message" required>
            <textarea required rows={3} value={form.message} placeholder="Details everyone should see…"
              onChange={(e) => setForm({ ...form, message: e.target.value })}
              style={{ width: '100%', resize: 'vertical' }} />
          </Field>
          <div className="form-grid">
            <Field label="Priority">
              <select value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value })}>
                <option value="INFO">For information</option>
                <option value="WARNING">Attention</option>
                <option value="CRITICAL">Critical</option>
              </select>
            </Field>
            <Field label="Who should see it">
              <select value={form.audience} onChange={(e) => setForm({ ...form, audience: e.target.value })}>
                <option value="ALL">Everyone</option>
                <option value="INTERNAL">SJVN internal team only</option>
                <option value="SELLERS">Sellers only</option>
                <option value="BUYERS">Buyers only</option>
              </select>
            </Field>
            <Field label="Show until (optional)">
              <input type="date" value={form.expires_at} onChange={(e) => setForm({ ...form, expires_at: e.target.value })} />
            </Field>
          </div>
          <p className="inline-note">The message is pinned at the top of the Notification Board for the chosen audience.</p>
          <div className="form-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setShowCompose(false)}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Posting…' : 'Post to Board'}</button>
          </div>
        </form>
      </Modal>

      {showPrefs && (
        <Preferences
          onClose={() => setShowPrefs(false)}
          onSaved={() => { setShowPrefs(false); setNotice('Alert settings saved.'); }}
        />
      )}
    </div>
  );
}
