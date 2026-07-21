import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { ROLE_GROUPS } from '../roles.js';
import { PageHeader, Card, StatCard, Modal, Field } from '../components/ui.jsx';
import { fmtDateTime } from '../datetime.js';

const SEV = {
  CRITICAL: { label: 'Critical', cls: 'sev-critical', dot: '#dc2626' },
  WARNING: { label: 'Attention', cls: 'sev-warning', dot: '#d97706' },
  INFO: { label: 'For information', cls: 'sev-info', dot: '#2563eb' },
};

const EMPTY_BROADCAST = { title: '', message: '', severity: 'INFO', expires_at: '' };

export default function NotificationBoard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const canPost = ROLE_GROUPS.REIA_WRITE.includes(user?.role);

  const [board, setBoard] = useState({ broadcasts: [], alerts: [], summary: {} });
  const [loading, setLoading] = useState(true);
  const [showCompose, setShowCompose] = useState(false);
  const [form, setForm] = useState(EMPTY_BROADCAST);
  const [saving, setSaving] = useState(false);

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

  const { broadcasts = [], alerts = [], summary = {} } = board;
  const grouped = {
    CRITICAL: alerts.filter((a) => a.severity === 'CRITICAL'),
    WARNING: alerts.filter((a) => a.severity === 'WARNING'),
    INFO: alerts.filter((a) => a.severity === 'INFO'),
  };
  const nothing = !loading && broadcasts.length === 0 && alerts.length === 0;

  return (
    <div>
      <PageHeader
        title="Notification Board"
        subtitle="Live alerts across billing, payments, security, disputes & reconciliation — all in one place"
        actions={canPost && <button className="btn btn-primary" onClick={() => { setForm(EMPTY_BROADCAST); setShowCompose(true); }}>+ Post Message</button>}
      />

      <div className="kpi-grid">
        <StatCard label="Critical" value={summary.critical ?? 0} tone={summary.critical ? 'red' : 'green'} hint="Need immediate action" />
        <StatCard label="Attention" value={summary.warning ?? 0} tone={summary.warning ? 'amber' : 'default'} hint="Due soon / review" />
        <StatCard label="For information" value={summary.info ?? 0} tone="blue" />
        <StatCard label="Items flagged" value={summary.total_items ?? 0} hint="Across all modules" />
      </div>

      {/* Admin flash messages, pinned */}
      {broadcasts.length > 0 && (
        <div style={{ margin: '4px 0 18px' }}>
          {broadcasts.map((b) => {
            const s = SEV[b.severity] || SEV.INFO;
            return (
              <div key={b.id} className={`nb-broadcast ${s.cls}`}>
                <span className="nb-pin" aria-hidden="true">📌</span>
                <div className="nb-broadcast-body">
                  <div className="nb-broadcast-title">{b.title}</div>
                  <div className="nb-broadcast-msg">{b.message}</div>
                  <div className="nb-broadcast-meta">
                    Posted by {b.created_by_name || 'Admin'} · {fmtDateTime(b.created_at)}
                    {b.expires_at ? ` · until ${fmtDateTime(b.expires_at)}` : ''}
                  </div>
                </div>
                {canPost && (
                  <button className="nb-broadcast-x" title="Remove" onClick={() => removeBroadcast(b.id)}>✕</button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {loading ? (
        <Card><div style={{ padding: 24, textAlign: 'center', color: 'var(--text-light)' }}>Loading alerts…</div></Card>
      ) : nothing ? (
        <Card>
          <div style={{ padding: 40, textAlign: 'center' }}>
            <div style={{ fontSize: 34, marginBottom: 8 }}>✅</div>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>All clear</div>
            <div style={{ color: 'var(--text-light)', fontSize: 13 }}>No urgent alerts right now. This board refreshes automatically.</div>
          </div>
        </Card>
      ) : (
        ['CRITICAL', 'WARNING', 'INFO'].map((sev) => (
          grouped[sev].length > 0 && (
            <div key={sev} style={{ marginBottom: 18 }}>
              <div className="nb-group-head">
                <span className="nb-group-dot" style={{ background: SEV[sev].dot }} />
                {SEV[sev].label}
                <span className="nb-group-count">{grouped[sev].length}</span>
              </div>
              <div className="nb-alert-grid">
                {grouped[sev].map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    className={`nb-alert ${SEV[sev].cls}`}
                    onClick={() => a.link && navigate(a.link)}
                  >
                    <div className="nb-alert-top">
                      <span className="nb-alert-cat">{a.category}</span>
                      <span className="nb-alert-count">{a.count}</span>
                    </div>
                    <div className="nb-alert-title">{a.title}</div>
                    <div className="nb-alert-detail">{a.detail}</div>
                    {a.link && <div className="nb-alert-link">View →</div>}
                  </button>
                ))}
              </div>
            </div>
          )
        ))
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
            <Field label="Show until (optional)">
              <input type="date" value={form.expires_at} onChange={(e) => setForm({ ...form, expires_at: e.target.value })} />
            </Field>
          </div>
          <p className="inline-note">This message will be pinned at the top of everyone's Notification Board.</p>
          <div className="form-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setShowCompose(false)}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Posting…' : 'Post to Board'}</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
