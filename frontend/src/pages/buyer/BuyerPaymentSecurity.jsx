import React, { useEffect, useState } from 'react';
import api from '../../api/client.js';
import { PageHeader, Card, Table, Badge, Modal, Field, fmtCurrency } from '../../components/ui.jsx';

export default function BuyerPaymentSecurity() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState(null);
  const [replenishAmt, setReplenishAmt] = useState('');
  const [error, setError] = useState('');

  function load() {
    setLoading(true);
    api.paymentSecurity.list().then(setRows).finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function openDetail(row) {
    setDetail(await api.paymentSecurity.get(row.id));
    setReplenishAmt('');
    setError('');
  }

  async function handleReplenish(e) {
    e.preventDefault();
    setError('');
    try {
      await api.paymentSecurity.replenish(detail.id, Number(replenishAmt));
      setDetail(await api.paymentSecurity.get(detail.id));
      setReplenishAmt('');
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Replenish failed');
    }
  }

  async function requestRelease() {
    await api.paymentSecurity.releaseRequest(detail.id, 'Buyer release request');
    setDetail(await api.paymentSecurity.get(detail.id));
    load();
  }

  return (
    <div>
      <PageHeader
        title="My Payment Security"
        subtitle="PSA LCs, corpus cover, coverage ratio and replenishment"
      />

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 14 }}>
        {rows.slice(0, 4).map((r) => (
          <div key={r.id} style={{ padding: '12px 14px', background: 'var(--surface-2, #f6f7f9)', borderRadius: 8, minWidth: 140 }}>
            <div style={{ fontSize: 11, opacity: 0.7 }}>{r.instrument_no}</div>
            <div style={{ fontWeight: 700 }}>{fmtCurrency(r.available_amount)}</div>
            <div style={{ fontSize: 12 }}>Coverage {r.coverage_ratio != null ? r.coverage_ratio.toFixed(2) : '—'}</div>
          </div>
        ))}
      </div>

      <Card>
        <Table
          columns={[
            { key: 'instrument_no', header: 'Instrument' },
            { key: 'contract_no', header: 'PSA' },
            { key: 'mechanism_type', header: 'Type' },
            { key: 'available_amount', header: 'Available', render: (r) => fmtCurrency(r.available_amount) },
            { key: 'required_amount', header: 'Required', render: (r) => fmtCurrency(r.required_amount) },
            {
              key: 'coverage_ratio',
              header: 'Coverage',
              render: (r) => (
                <span style={{ color: (r.coverage_ratio || 0) < 1 ? '#b91c1c' : undefined }}>
                  {r.coverage_ratio != null ? r.coverage_ratio.toFixed(2) : '—'}
                </span>
              ),
            },
            { key: 'validity_end', header: 'Expiry' },
            { key: 'status', header: 'Status', render: (r) => <Badge status={r.status} /> },
          ]}
          rows={loading ? [] : rows}
          onRowClick={openDetail}
          emptyMessage={loading ? 'Loading...' : 'No payment security on your PSAs.'}
        />
      </Card>

      <Modal open={!!detail} onClose={() => setDetail(null)} title={detail?.instrument_no} width={560}>
        {detail && (
          <div>
            <div className="detail-grid">
              <div className="detail-item"><span className="detail-label">Contract</span><span className="detail-value">{detail.contract_no}</span></div>
              <div className="detail-item"><span className="detail-label">Available</span><span className="detail-value">{fmtCurrency(detail.available_amount)}</span></div>
              <div className="detail-item"><span className="detail-label">Utilized</span><span className="detail-value">{fmtCurrency(detail.utilized_amount)}</span></div>
              <div className="detail-item"><span className="detail-label">Coverage</span><span className="detail-value">{detail.coverage?.coverage_ratio?.toFixed(3)}</span></div>
              <div className="detail-item"><span className="detail-label">Expiry</span><span className="detail-value">{detail.validity_end}</span></div>
              <div className="detail-item"><span className="detail-label">Status</span><span className="detail-value"><Badge status={detail.status} /></span></div>
            </div>
            {error && <div className="form-error">{error}</div>}
            {!!detail.is_revolving && detail.status !== 'RELEASED' && (
              <form onSubmit={handleReplenish} style={{ marginTop: 12 }}>
                <Field label="Replenish amount (₹)">
                  <input required type="number" value={replenishAmt} onChange={(e) => setReplenishAmt(e.target.value)} />
                </Field>
                <p style={{ fontSize: 12, opacity: 0.7 }}>Restores revolving LC available balance (utilization decrease).</p>
                <button type="submit" className="btn btn-primary">Submit replenish</button>
              </form>
            )}
            {detail.status !== 'RELEASE_PENDING' && detail.status !== 'RELEASED' && (
              <button type="button" className="btn btn-ghost" style={{ marginTop: 12 }} onClick={requestRelease}>Request release</button>
            )}
            {detail.releases?.length > 0 && (
              <>
                <div className="section-title" style={{ marginTop: 14 }}>Release status</div>
                {detail.releases.map((r) => (
                  <div key={r.id} style={{ fontSize: 13 }}><Badge status={r.status} /> — {r.reason}</div>
                ))}
              </>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
