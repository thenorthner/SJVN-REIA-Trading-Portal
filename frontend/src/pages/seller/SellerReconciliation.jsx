import React, { useEffect, useState } from 'react';
import api from '../../api/client.js';
import { PageHeader, Card, Table, Badge, Modal, fmtCurrency, StatementViewer } from '../../components/ui.jsx';

export default function SellerReconciliation() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState(null);
  const [note, setNote] = useState('');

  function load() {
    setLoading(true);
    api.reconciliation.list().then(setRows).finally(() => setLoading(false));
  }
  useEffect(load, []);

  async function openDetail(row) {
    setDetail(await api.reconciliation.get(row.id));
    setNote('');
  }

  async function ack(decision) {
    await api.reconciliation.acknowledge(detail.id, decision, note || undefined);
    setDetail(null);
    load();
  }

  const columns = [
    { key: 'recon_no', header: 'Statement #' },
    { key: 'contract_no', header: 'PPA' },
    { key: 'period', header: 'Period' },
    { key: 'auto_match_pct', header: 'Match %', render: (r) => `${r.auto_match_pct ?? 0}%` },
    { key: 'unreconciled_amount', header: 'Open ₹', render: (r) => fmtCurrency(r.unreconciled_amount || 0) },
    { key: 'status', header: 'Status', render: (r) => <Badge status={r.status} /> },
  ];

  return (
    <div>
      <PageHeader
        title="Reconciliation Statements"
        subtitle="Joint validation — meter vs bill vs payment, then digital acknowledgment with SJVN"
      />
      <Card>
        <Table columns={columns} rows={loading ? [] : rows} onRowClick={openDetail} emptyMessage={loading ? 'Loading...' : 'No statements yet.'} />
      </Card>

      <Modal open={!!detail} onClose={() => setDetail(null)} title={detail?.recon_no || 'Statement'} width={720}>
        {detail && (
          <div>
            <div className="detail-grid">
              <div className="detail-item"><span className="detail-label">Status</span><span className="detail-value"><Badge status={detail.status} /></span></div>
              <div className="detail-item"><span className="detail-label">Period / Basis</span><span className="detail-value">{detail.period} / {detail.data_basis}</span></div>
              <div className="detail-item"><span className="detail-label">Auto-match</span><span className="detail-value">{detail.auto_match_pct}%</span></div>
              <div className="detail-item"><span className="detail-label">Your ack</span><span className="detail-value">{detail.counterparty_ack_by || 'Pending'}</span></div>
            </div>
            <ul style={{ paddingLeft: 18, marginTop: 12 }}>
              {(detail.items || []).map((it) => (
                <li key={it.id}>
                  <Badge status={['EXACT', 'AUTO_MATCHED', 'OVERRIDDEN'].includes(it.match_status) ? 'AUTO_MATCHED' : 'NEEDS_REVIEW'} />{' '}
                  {it.label} {it.pattern_flag ? '(pattern flag)' : ''}
                </li>
              ))}
            </ul>
            <StatementViewer statement={detail.statement} />
            {['PENDING_SIGN_OFF', 'AUTO_MATCHED'].includes(detail.status) && (
              <>
                <textarea rows={2} placeholder="Optional note" value={note} onChange={(e) => setNote(e.target.value)} style={{ width: '100%' }} />
                <div className="form-actions">
                  <button type="button" className="btn btn-success" onClick={() => ack('AGREE')}>I Agree</button>
                  <button type="button" className="btn btn-danger" onClick={() => ack('DISAGREE')}>Disagree</button>
                </div>
              </>
            )}
            {['CLOSED', 'AGREED'].includes(detail.status) && (
              <div className="form-actions">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={async () => {
                    const reason = prompt('Why reopen this closed period?');
                    if (!reason) return;
                    await api.reconciliation.reopenRequest(detail.id, reason);
                    await openDetail(detail);
                  }}
                >
                  Request period reopen
                </button>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
