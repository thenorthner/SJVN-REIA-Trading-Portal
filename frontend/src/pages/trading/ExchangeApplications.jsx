import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client.js';
import { Card, Modal, Field, Badge } from '../../components/ui.jsx';

function fmtAppDate(s) {
  if (!s) return '—';
  const d = new Date(String(s).includes('T') ? s : `${String(s).replace(' ', 'T')}`);
  if (Number.isNaN(d.getTime())) return s;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${dd}-${months[d.getMonth()]}-${d.getFullYear()} ${hh}:${mm}`;
}

const COLUMNS = [
  { key: 'application_date', label: 'Application Date' },
  { key: 'application_id', label: 'Application Id' },
  { key: 'portfolio_id', label: 'Portfolio Id' },
  { key: 'exchange', label: 'Exchange' },
  { key: 'product', label: 'Product' },
  { key: 'bid_type', label: 'Bid Type' },
];

export default function ExchangeApplications() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState('application_date');
  const [sortDir, setSortDir] = useState('desc');
  const [actionRow, setActionRow] = useState(null);
  const [decision, setDecision] = useState('APPROVED');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  function load() {
    setLoading(true);
    api.exchangeApplications.list()
      .then(setRows)
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = rows;
    if (q) {
      list = rows.filter((r) => [
        r.application_id, r.portfolio_id, r.exchange, r.product, r.bid_type,
        fmtAppDate(r.application_date), r.approval_status, r.contract_label,
        ...(r.bid_ids || []),
      ].join(' ').toLowerCase().includes(q));
    }
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...list].sort((a, b) => {
      const av = a[sortKey] ?? '';
      const bv = b[sortKey] ?? '';
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
  }, [rows, search, sortKey, sortDir]);

  function toggleSort(key) {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('asc'); }
  }

  async function submitDecision(e) {
    e.preventDefault();
    if (!actionRow) return;
    setBusy(true);
    setMessage('');
    try {
      await api.exchangeApplications.approve(actionRow.id, { decision, notes });
      setActionRow(null);
      setNotes('');
      setMessage(`${actionRow.application_id} marked ${decision}.`);
      load();
    } catch (err) {
      setMessage(err.response?.data?.error || 'Failed to update application.');
    } finally {
      setBusy(false);
    }
  }

  async function runStep(row, step) {
    setMessage('');
    try {
      await api.exchangeApplications.step(row.id, { step, status: 'DONE' });
      setMessage(`${row.application_id} · ${step.replace('_', ' ')} marked DONE.`);
      load();
    } catch (err) {
      setMessage(err.response?.data?.error || 'Step update failed.');
    }
  }

  const thStyle = {
    background: '#1e4b7a',
    color: '#fff',
    padding: '10px 12px',
    fontSize: 12,
    fontWeight: 600,
    whiteSpace: 'nowrap',
    cursor: 'pointer',
    userSelect: 'none',
  };

  const linkAction = {
    color: '#1d4ed8',
    background: 'none',
    border: 'none',
    padding: 0,
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 600,
    textDecoration: 'underline',
  };

  return (
    <div style={{ padding: 20 }}>
      <div className="form-section-header" style={{ marginTop: 0, background: '#1e4b7a' }}>
        Power Exchange Applications
      </div>

      <Card>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 14 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
            Search:
            <input
              className="input"
              style={{ width: 220 }}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Application Id, portfolio…"
            />
          </label>
        </div>

        {message && (
          <div style={{ marginBottom: 12, fontSize: 13, color: '#1e3a8a', background: '#eff6ff', padding: '8px 12px', borderRadius: 4 }}>
            {message}
          </div>
        )}

        {loading ? (
          <div className="page-loading">Loading applications…</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr>
                  {COLUMNS.map((c) => (
                    <th key={c.key} style={thStyle} onClick={() => toggleSort(c.key)}>
                      {c.label}{' '}
                      <span style={{ opacity: sortKey === c.key ? 1 : 0.4 }}>
                        {sortKey === c.key && sortDir === 'asc' ? '▲' : '▼'}
                      </span>
                    </th>
                  ))}
                  <th style={thStyle}>Approve/Reject</th>
                  <th style={thStyle}>Linked bid</th>
                  <th style={thStyle}>PX1</th>
                  <th style={thStyle}>PX2</th>
                  <th style={thStyle}>Exchange Request</th>
                  <th style={thStyle}>Exchange Approval</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={12} style={{ padding: 24, textAlign: 'center', color: '#64748b' }}>
                      No applications found.
                    </td>
                  </tr>
                ) : filtered.map((r) => (
                  <tr key={r.id} style={{ borderBottom: '1px solid #e2e8f0' }}>
                    <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>{fmtAppDate(r.application_date)}</td>
                    <td style={{ padding: '10px 12px' }}>
                      <Link to={`/trading/exchange/bidding-detail?q=${encodeURIComponent(r.portfolio_id)}`} style={{ color: '#1d4ed8', fontWeight: 600 }}>
                        {r.application_id}
                      </Link>
                    </td>
                    <td style={{ padding: '10px 12px' }}>{r.portfolio_id}</td>
                    <td style={{ padding: '10px 12px' }}>{r.exchange}</td>
                    <td style={{ padding: '10px 12px' }}>{r.product}</td>
                    <td style={{ padding: '10px 12px' }}>{r.bid_type}</td>
                    <td style={{ padding: '10px 12px' }}>
                      <button
                        type="button"
                        className="btn btn-sm"
                        style={{ background: '#1e4b7a', color: '#fff', border: 'none', borderRadius: 4, padding: '4px 12px' }}
                        onClick={() => { setActionRow(r); setDecision(r.approval_status === 'REJECTED' ? 'REJECTED' : 'APPROVED'); setNotes(r.notes || ''); }}
                      >
                        Action
                      </button>
                      {r.approval_status !== 'PENDING' && (
                        <div style={{ fontSize: 11, marginTop: 4, color: r.approval_status === 'APPROVED' ? '#166534' : '#991b1b' }}>
                          {r.approval_status}
                        </div>
                      )}
                    </td>
                    <td style={{ padding: '10px 12px' }}>
                      {(r.bids || []).length === 0 ? (
                        <span style={{ color: '#94a3b8', fontSize: 12 }}>—</span>
                      ) : r.bids.map((b) => (
                        <div key={b.id} style={{ fontSize: 12, marginBottom: 2 }}>
                          <span style={{ fontFamily: 'ui-monospace, monospace' }}>{b.id}</span>
                          {' '}
                          <Badge type={b.status === 'CLEARED' ? 'success' : b.status === 'REJECTED' ? 'danger' : 'warning'}>
                            {b.status}
                          </Badge>
                        </div>
                      ))}
                      {r.contract_label && (
                        <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>{r.contract_label}</div>
                      )}
                    </td>
                    <td style={{ padding: '10px 12px' }}>
                      <button type="button" style={linkAction} onClick={() => runStep(r, 'px1')}>
                        Action{r.px1_status === 'DONE' ? ' ✓' : ''}
                      </button>
                    </td>
                    <td style={{ padding: '10px 12px' }}>
                      <button type="button" style={linkAction} onClick={() => runStep(r, 'px2')}>
                        Action{r.px2_status === 'DONE' ? ' ✓' : ''}
                      </button>
                    </td>
                    <td style={{ padding: '10px 12px' }}>
                      <button type="button" style={linkAction} onClick={() => runStep(r, 'exchange_request')}>
                        Action{r.exchange_request_status === 'DONE' ? ' ✓' : ''}
                      </button>
                    </td>
                    <td style={{ padding: '10px 12px' }}>
                      <button type="button" style={linkAction} onClick={() => runStep(r, 'exchange_approval')}>
                        Action{r.exchange_approval_status === 'DONE' ? ' ✓' : ''}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {actionRow && (
        <Modal open onClose={() => setActionRow(null)} title={`Approve / Reject — ${actionRow.application_id}`} width={480}>
          <form onSubmit={submitDecision}>
            <p style={{ fontSize: 13, color: '#475569', marginTop: 0 }}>
              {actionRow.exchange} · {actionRow.product} · {actionRow.bid_type} · {actionRow.portfolio_id}
            </p>
            <Field label="Decision" required>
              <select className="input" value={decision} onChange={(e) => setDecision(e.target.value)}>
                <option value="APPROVED">Approve</option>
                <option value="REJECTED">Reject</option>
              </select>
            </Field>
            <Field label="Notes">
              <textarea className="input" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional note" />
            </Field>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 16 }}>
              <button type="button" className="btn btn-outline" onClick={() => setActionRow(null)}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
