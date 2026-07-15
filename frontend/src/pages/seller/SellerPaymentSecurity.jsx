import React, { useEffect, useState } from 'react';
import api from '../../api/client.js';
import { PageHeader, Card, Table, Badge, Modal, Field, fmtCurrency } from '../../components/ui.jsx';

export default function SellerPaymentSecurity() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState(null);
  const [note, setNote] = useState('');

  function load() {
    setLoading(true);
    api.paymentSecurity.list().then(setRows).finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function openDetail(row) {
    setDetail(await api.paymentSecurity.get(row.id));
    setNote('');
  }

  async function requestRelease() {
    await api.paymentSecurity.releaseRequest(detail.id, note || 'Seller release request after COD / contract milestone');
    setDetail(await api.paymentSecurity.get(detail.id));
    load();
  }

  return (
    <div>
      <PageHeader
        title="My Bank Guarantees"
        subtitle="EMD / PBG instruments linked to your PPAs — validity, verification and release"
      />

      <Card>
        <Table
          columns={[
            { key: 'instrument_no', header: 'Instrument' },
            { key: 'contract_no', header: 'PPA' },
            {
              key: 'type',
              header: 'Type',
              render: (r) => `${r.mechanism_type}${r.bg_subtype ? ` / ${r.bg_subtype}` : ''}`,
            },
            { key: 'limit_amount', header: 'Amount', render: (r) => fmtCurrency(r.limit_amount ?? r.amount) },
            { key: 'issuing_bank', header: 'Bank' },
            { key: 'validity_end', header: 'Expiry' },
            {
              key: 'verified',
              header: 'Verified',
              render: (r) => (r.bank_confirmation_ref ? 'Yes' : 'Pending'),
            },
            { key: 'status', header: 'Status', render: (r) => <Badge status={r.status} /> },
          ]}
          rows={loading ? [] : rows}
          onRowClick={openDetail}
          emptyMessage={loading ? 'Loading...' : 'No security instruments on your PPAs.'}
        />
      </Card>

      <Modal open={!!detail} onClose={() => setDetail(null)} title={detail?.instrument_no} width={560}>
        {detail && (
          <div>
            <div className="detail-grid">
              <div className="detail-item"><span className="detail-label">Contract</span><span className="detail-value">{detail.contract_no}</span></div>
              <div className="detail-item"><span className="detail-label">Subtype</span><span className="detail-value">{detail.bg_subtype || '—'}</span></div>
              <div className="detail-item"><span className="detail-label">Amount</span><span className="detail-value">{fmtCurrency(detail.limit_amount)}</span></div>
              <div className="detail-item"><span className="detail-label">Bank</span><span className="detail-value">{detail.issuing_bank || '—'}</span></div>
              <div className="detail-item"><span className="detail-label">Confirmation</span><span className="detail-value">{detail.bank_confirmation_ref || 'Pending'}</span></div>
              <div className="detail-item"><span className="detail-label">Expiry</span><span className="detail-value">{detail.validity_end}</span></div>
              <div className="detail-item"><span className="detail-label">Status</span><span className="detail-value"><Badge status={detail.status} /></span></div>
            </div>
            {detail.status !== 'RELEASE_PENDING' && detail.status !== 'RELEASED' && (
              <div style={{ marginTop: 14 }}>
                <Field label="Release note">
                  <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reason / milestone reference" />
                </Field>
                <button type="button" className="btn btn-secondary" onClick={requestRelease}>Request release</button>
              </div>
            )}
            {detail.releases?.length > 0 && (
              <>
                <div className="section-title" style={{ marginTop: 14 }}>Release status</div>
                {detail.releases.map((r) => (
                  <div key={r.id} style={{ fontSize: 13, marginBottom: 4 }}>
                    <Badge status={r.status} /> — {r.reason}
                    {r.acted_by && <span style={{ opacity: 0.7 }}> · {r.acted_by}</span>}
                  </div>
                ))}
              </>
            )}
            {detail.events?.length > 0 && (
              <>
                <div className="section-title" style={{ marginTop: 14 }}>History</div>
                <div className="timeline">
                  {detail.events.slice().reverse().slice(0, 8).map((ev) => (
                    <div className="timeline-item" key={ev.id}>
                      {ev.event_type} — {ev.actor_name}
                      <div className="t-meta">{ev.created_at}</div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
