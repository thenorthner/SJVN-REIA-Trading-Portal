import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../api/client.js';
import { PageHeader, Card, Table, Badge, Modal, Field, StatCard, fmtNumber } from '../../components/ui.jsx';
import { fmtDate } from '../../datetime.js';

// What the NOAR registry itself says about SJVN's open-access applications,
// pulled from the Trader API, set against what the desk has recorded.
//
// The platform's noar_status is keyed in by hand, so an approval granted days
// ago and never entered looks exactly like one still pending. This screen is
// the second opinion: it shows where the registry and our books disagree, and
// leaves the correcting to the desk. It never moves a status by itself — NOAR's
// numeric status codes are undocumented, so a screen that acted on them would
// be guessing at a live approval workflow.

const KIND_LABEL = {
  APPROVAL_NOT_RECORDED: 'Approval not recorded here',
  APPROVAL_NO_MISMATCH: 'Approval number disagrees',
  STATUS_BEHIND: 'Approved at NOAR, still open here',
  REJECTED_AT_NOAR: 'Rejected at NOAR, still open here',
  PARTIAL_APPROVAL: 'Approved short of the quantum applied for',
  NOT_ON_PLATFORM: 'Not on our books at all',
};

const KIND_TONE = {
  APPROVAL_NOT_RECORDED: 'warning',
  APPROVAL_NO_MISMATCH: 'danger',
  STATUS_BEHIND: 'warning',
  REJECTED_AT_NOAR: 'danger',
  PARTIAL_APPROVAL: 'warning',
  NOT_ON_PLATFORM: 'neutral',
};

/** Default window: this month to date, which is how the desk reviews it. */
function defaultRange() {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { from: iso(first), to: iso(now) };
}

export default function NOARApiReconciliation() {
  const [status, setStatus] = useState(null);
  const [rows, setRows] = useState([]);
  const [recon, setRecon] = useState(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');
  const [lastSync, setLastSync] = useState(null);
  const [range, setRange] = useState(defaultRange);
  const [includeRejected, setIncludeRejected] = useState(true);
  const [viewing, setViewing] = useState(null);
  const [detail, setDetail] = useState(null);

  const load = useCallback(() => {
    setError('');
    return Promise.all([
      api.noarApi.status(),
      api.noarApi.applications(),
      api.noarApi.reconciliation(),
    ])
      .then(([s, a, r]) => {
        setStatus(s);
        setRows(Array.isArray(a) ? a : []);
        setRecon(r);
      })
      .catch((err) => setError(err?.response?.data?.error || 'Could not load what has been pulled from NOAR.'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!viewing) { setDetail(null); return undefined; }
    let live = true;
    api.noarApi.application(viewing.application_no)
      .then((d) => { if (live) setDetail(d); })
      .catch(() => { if (live) setDetail(null); });
    return () => { live = false; };
  }, [viewing]);

  const runSync = async () => {
    setSyncing(true);
    setError('');
    try {
      const result = await api.noarApi.sync({
        from_date: range.from,
        to_date: range.to,
        include_rejected: includeRejected,
      });
      setLastSync(result);
      await load();
    } catch (err) {
      setError(err?.response?.data?.error || 'The pull from NOAR failed.');
    } finally {
      setSyncing(false);
    }
  };

  // Differences are indexed by application so a row can carry its own findings
  // without the table asking the server again per row.
  const diffsByApp = useMemo(() => {
    const map = new Map();
    for (const item of recon?.items || []) map.set(item.application_no, item.differences);
    return map;
  }, [recon]);

  // Only the newest revision of each application is listed: an older revision
  // has been superseded at NOAR and disagreeing with it means nothing.
  const latest = useMemo(() => {
    const byApp = new Map();
    for (const r of rows) {
      const held = byApp.get(r.application_no);
      if (!held || r.revision_no > held.revision_no) byApp.set(r.application_no, r);
    }
    return [...byApp.values()].sort((a, b) => String(b.from_date).localeCompare(String(a.from_date)));
  }, [rows]);

  const columns = [
    { key: 'application_no', header: 'Application No.', render: (r) => <strong>{r.application_no}</strong> },
    {
      key: 'revision_no',
      header: 'Rev.',
      render: (r) => (r.revision_no ? <Badge type="info">{`Rev ${r.revision_no}`}</Badge> : '0'),
    },
    { key: 'buyer_name', header: 'Counterparty', render: (r) => r.buyer_name || r.seller_name || '—' },
    {
      key: 'window',
      header: 'Delivery',
      render: (r) => (r.from_date === r.to_date ? fmtDate(r.from_date) : `${fmtDate(r.from_date)} – ${fmtDate(r.to_date)}`),
    },
    { key: 'applied_mwh', header: 'Applied (MWh)', render: (r) => fmtNumber(r.applied_mwh) },
    { key: 'approved_mwh', header: 'Approved (MWh)', render: (r) => fmtNumber(r.approved_mwh) },
    { key: 'approval_no', header: 'Approval No. (NOAR)', render: (r) => r.approval_no || <span className="muted">—</span> },
    {
      key: 'agreement',
      header: 'Against our record',
      render: (r) => {
        const diffs = diffsByApp.get(r.application_no) || [];
        if (r.is_rejected && !diffs.length) return <Badge type="neutral">Rejected, and recorded</Badge>;
        if (!diffs.length) return <Badge type="success">Agrees</Badge>;
        return (
          <Badge type={KIND_TONE[diffs[0].kind] || 'warning'}>
            {KIND_LABEL[diffs[0].kind] || diffs[0].kind}
            {diffs.length > 1 ? ` +${diffs.length - 1}` : ''}
          </Badge>
        );
      },
    },
    {
      key: 'actions',
      header: 'Actions',
      render: (r) => <button type="button" className="btn btn-xs btn-outline" onClick={() => setViewing(r)}>View</button>,
    },
  ];

  const stub = status && !status.live;

  return (
    <div>
      <PageHeader
        title="NOAR Registry Pull"
        subtitle="SJVN's bilateral open-access applications as the NOAR registry holds them, set against what the desk has recorded"
      />

      {error && <div className="alert alert-error" role="alert">{error}</div>}

      {stub && (
        <div className="alert alert-warning" role="alert">
          <strong>Sample data, not the registry. </strong>
          The NOAR Trader API is not configured, so a pull returns a sample in the documented
          response shape. Set <code>noar_api_enabled</code> in Masters and supply
          <code> NOAR_API_KEY</code> / <code>NOAR_API_SECRET</code> (generated on the NOAR portal
          under API Integration) to read the registry. NOAR also has to whitelist SJVN&apos;s
          outbound IP.
        </div>
      )}

      <div className="kpi-grid">
        <StatCard
          label="Applications pulled"
          value={fmtNumber(latest.length, 0)}
          tone="blue"
          hint={status?.last_synced_at ? `Last pull ${fmtDate(status.last_synced_at)}` : 'Nothing pulled yet'}
        />
        <StatCard
          label="Disagreeing with our record"
          value={fmtNumber(recon?.applications_with_differences || 0, 0)}
          tone={recon?.applications_with_differences ? 'amber' : 'green'}
          hint={recon?.applications_with_differences ? 'Each needs the desk to correct one side' : 'Registry and platform agree'}
        />
        <StatCard
          label="Source"
          value={status ? (status.live ? status.environment : 'Stub') : '—'}
          tone={status?.live && status.environment === 'PRODUCTION' ? 'green' : 'default'}
          hint={status?.base_url || ''}
        />
      </div>

      <Card title="Pull a date range from NOAR" style={{ marginBottom: 20 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1.2fr auto', gap: 16, alignItems: 'end' }}>
          <Field label="From (delivery)">
            <input type="date" className="input" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} />
          </Field>
          <Field label="To (delivery)">
            <input type="date" className="input" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} />
          </Field>
          <Field label="Rejected applications">
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
              <input type="checkbox" checked={includeRejected} onChange={(e) => setIncludeRejected(e.target.checked)} />
              Ask for them too (NOAR returns them only on a second call)
            </label>
          </Field>
          <button type="button" className="btn btn-primary" onClick={runSync} disabled={syncing || !range.from || !range.to}>
            {syncing ? 'Pulling…' : 'Pull from NOAR'}
          </button>
        </div>
        <p className="muted" style={{ marginTop: 12, fontSize: 12 }}>
          Read-only against NOAR. Nothing here changes a transaction&apos;s open-access status —
          it reports what the registry says so the desk can correct whichever side is wrong.
        </p>
      </Card>

      {lastSync && (
        <div className={`alert alert-${lastSync.differences.length ? 'warning' : 'success'}`} role="status">
          <strong>{lastSync.mode === 'STUB' ? 'Sample pull: ' : `Pulled from ${lastSync.mode}: `}</strong>
          {fmtNumber(lastSync.applications_received, 0)} application(s) for {fmtDate(lastSync.from_date)} – {fmtDate(lastSync.to_date)}
          {` · ${fmtNumber(lastSync.matched, 0)} matched to a transaction`}
          {lastSync.unmatched ? `, ${fmtNumber(lastSync.unmatched, 0)} with no match` : ''}
          {lastSync.differences.length
            ? ` · ${fmtNumber(lastSync.differences.length, 0)} disagree with our record.`
            : ' · everything agrees with our record.'}
        </div>
      )}

      <Card style={{ padding: 0 }}>
        <Table
          columns={columns}
          data={latest}
          loading={loading}
          emptyMessage="Nothing has been pulled from NOAR yet. Choose a date range and pull."
        />
      </Card>

      {viewing && (
        <Modal open onClose={() => setViewing(null)} title={`NOAR application ${viewing.application_no}`} width={900}>
          <div style={{ display: 'grid', gap: 20 }}>
            <div>
              <h4 style={{ margin: '0 0 12px' }}>As NOAR holds it</h4>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, fontSize: 13 }}>
                <div><strong>Applicant:</strong> {viewing.applicant_name || '—'}</div>
                <div><strong>Approval No.:</strong> {viewing.approval_no || 'None yet'}</div>
                <div><strong>Seller:</strong> {viewing.seller_name || '—'}</div>
                <div><strong>Buyer:</strong> {viewing.buyer_name || '—'}</div>
                <div><strong>Delivery:</strong> {fmtDate(viewing.from_date)} – {fmtDate(viewing.to_date)}</div>
                <div><strong>Route:</strong> {viewing.primary_route || '—'}{viewing.alternate_route ? ` (alt: ${viewing.alternate_route})` : ''}</div>
                <div><strong>Applied:</strong> {fmtNumber(viewing.applied_mwh)} MWh</div>
                <div><strong>Approved:</strong> {fmtNumber(viewing.approved_mwh)} MWh</div>
                <div><strong>Scheduled:</strong> {fmtNumber(viewing.scheduled_mwh)} MWh</div>
                <div><strong>Revision:</strong> {viewing.revision_no}</div>
              </div>
              <p className="muted" style={{ marginTop: 10, fontSize: 12 }}>
                NOAR also returns Status {viewing.status_code ?? '—'}, Bid {viewing.bid_status ?? '—'},
                Congestion {viewing.congestion_status ?? '—'} and Payment {viewing.payment_status ?? '—'}
                as bare numbers. The trader API guide defines no meaning for them, so they are shown
                as received and nothing is decided from them.
              </p>
            </div>

            <div>
              <h4 style={{ margin: '0 0 12px' }}>Against our record</h4>
              {detail?.transaction ? (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, fontSize: 13 }}>
                  <div><strong>Transaction:</strong> {detail.transaction.id}</div>
                  <div><strong>Counterparty:</strong> {detail.transaction.counterparty}</div>
                  <div><strong>Our status:</strong> {detail.transaction.noar_status}</div>
                  <div><strong>Our approval No.:</strong> {detail.transaction.noar_contract_no || 'Not recorded'}</div>
                </div>
              ) : (
                <p className="muted" style={{ fontSize: 13 }}>
                  No bilateral transaction carries this application number. Either it was filed
                  outside the platform, or the number was never recorded against the deal.
                </p>
              )}

              {(detail?.differences || []).length > 0 && (
                <ul style={{ marginTop: 12, fontSize: 13 }}>
                  {detail.differences.map((d) => (
                    <li key={d.kind} style={{ marginBottom: 6 }}>
                      <Badge type={KIND_TONE[d.kind] || 'warning'}>{KIND_LABEL[d.kind] || d.kind}</Badge>
                      <span style={{ marginLeft: 8 }}>{d.detail}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {(viewing.applied_summary || []).length > 0 && (
              <div>
                <h4 style={{ margin: '0 0 12px' }}>Block-wise quantum</h4>
                <Table
                  columns={[
                    { key: 'from_date', header: 'From', render: (r) => fmtDate(r.from_date) },
                    { key: 'to_date', header: 'To', render: (r) => fmtDate(r.to_date) },
                    { key: 'from_block', header: 'From Block' },
                    { key: 'to_block', header: 'To Block' },
                    { key: 'mw', header: 'MW', render: (r) => fmtNumber(r.mw) },
                    { key: 'mwh', header: 'MWh', render: (r) => fmtNumber(r.mwh) },
                  ]}
                  data={(viewing.approved_summary?.length ? viewing.approved_summary : viewing.applied_summary).map((s, i) => ({ id: `blk-${i}`, ...s }))}
                  emptyMessage="No block-wise summary was returned."
                />
                <p className="muted" style={{ marginTop: 8, fontSize: 12 }}>
                  {viewing.approved_summary?.length ? 'Approved' : 'Applied'} quantum, as returned by NOAR.
                </p>
              </div>
            )}

            {(detail?.revisions || []).length > 1 && (
              <div>
                <h4 style={{ margin: '0 0 12px' }}>Revisions NOAR has issued</h4>
                <Table
                  columns={[
                    { key: 'revision_no', header: 'Rev.' },
                    { key: 'approval_no', header: 'Approval No.', render: (r) => r.approval_no || '—' },
                    { key: 'applied_mwh', header: 'Applied (MWh)', render: (r) => fmtNumber(r.applied_mwh) },
                    { key: 'approved_mwh', header: 'Approved (MWh)', render: (r) => fmtNumber(r.approved_mwh) },
                    { key: 'synced_at', header: 'Pulled', render: (r) => fmtDate(r.synced_at) },
                  ]}
                  data={detail.revisions}
                  emptyMessage=""
                />
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
