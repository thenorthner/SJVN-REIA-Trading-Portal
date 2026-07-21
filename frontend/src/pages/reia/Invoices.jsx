import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { PageHeader, Card, Table, Badge, Modal, Field, fmtCurrency, fmtNumber } from '../../components/ui.jsx';
import { DocumentManager } from '../../components/DocumentManager.jsx';
import { SettlementTrailPanel, BfrChip } from '../../components/SettlementTrail.jsx';

const CAN_WRITE = ['SJVN_ADMIN', 'REIA_USER'];
const CAN_APPROVE = ['SJVN_ADMIN', 'REIA_USER', 'FINANCE_USER'];
const CAN_RECORD_PAYMENT = ['SJVN_ADMIN', 'FINANCE_USER', 'REIA_USER'];

const GEN_FORM = { contract_id: '', period_month: '', invoice_type: 'PROVISIONAL' };
const PAY_FORM = { amount: '', payment_date: '', mode: 'NEFT', reference: '', deduction: '' };

export default function Invoices() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [contracts, setContracts] = useState([]);
  const [filters, setFilters] = useState({ status: '', direction: '', billing_period: '' });
  const [loading, setLoading] = useState(true);
  const [showGenerate, setShowGenerate] = useState(false);
  const [genForm, setGenForm] = useState(GEN_FORM);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null);
  const [payForm, setPayForm] = useState(PAY_FORM);
  const [approveComments, setApproveComments] = useState({}); // changed to object
  const [trailBfr, setTrailBfr] = useState(null);
  const [contractDetail, setContractDetail] = useState(null);
  const [contractLoading, setContractLoading] = useState(false);

  function openContract(contractId) {
    if (!contractId) return;
    setContractLoading(true);
    setContractDetail({ id: contractId }); // open modal immediately with a loading state
    api.contracts.get(contractId)
      .then(setContractDetail)
      .catch(() => alert('Failed to load contract details'))
      .finally(() => setContractLoading(false));
  }

  function load() {
    setLoading(true);
    const params = {};
    Object.entries(filters).forEach(([k, v]) => { if (v) params[k] = v; });
    api.invoices.list(params).then(setRows).finally(() => setLoading(false));
  }

  useEffect(load, [filters.status, filters.direction, filters.billing_period]);
  useEffect(() => { api.contracts.list().then(setContracts).catch(() => {}); }, []);

  function openDetail(row) {
    api.invoices.get(row.id).then(setSelected);
    setPayForm(PAY_FORM);
    setApproveComments('');
  }

  async function refreshSelected(id) {
    const fresh = await api.invoices.get(id);
    setSelected(fresh);
    load();
  }

  async function handleGenerate(e) {
    e.preventDefault();
    setError('');
    try {
      await api.invoices.generate(genForm);
      setShowGenerate(false);
      setGenForm(GEN_FORM);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to generate invoice.');
    }
  }

  async function handleSubmitForApproval() {
    try {
      await refreshSelected((await api.invoices.submitForApproval(selected.id)).id);
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to submit invoice for approval.');
    }
  }

  async function handleSubmitL2() {
    await api.invoices.submitL2(selected.id);
    refreshSelected(selected.id);
  }

  async function handleApproveL2() {
    await api.invoices.approveL2(selected.id, 'Approved by L2');
    refreshSelected(selected.id);
  }

  async function handleAct(level, decision) {
    await api.invoices.act(selected.id, level, decision, approveComments[level] || '');
    setApproveComments({ ...approveComments, [level]: '' });
    refreshSelected(selected.id);
  }

  async function handleSend() {
    await api.invoices.send(selected.id);
    refreshSelected(selected.id);
  }

  async function handleDownloadPdf() {
    try {
      const blob = await api.invoices.downloadPdf(selected.id);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Invoice_${selected.invoice_no}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
      alert('Failed to download PDF: ' + (err.message || err));
    }
  }

  async function handlePayment(e) {
    e.preventDefault();
    await api.invoices.recordPayment(selected.id, { ...payForm, amount: Number(payForm.amount), deduction: payForm.deduction ? Number(payForm.deduction) : 0 });
    setPayForm(PAY_FORM);
    refreshSelected(selected.id);
  }

  const columns = [
    { key: 'invoice_no', header: 'Invoice No.' },
    { key: 'billing_family_ref', header: 'BFR', render: (r) => (
      <BfrChip bfr={r.billing_family_ref} onClick={(ref) => setTrailBfr(ref)} />
    )},
    { key: 'contract_no', header: 'Contract', render: (r) => (
      r.contract_id ? (
        <button
          type="button"
          className="btn-link"
          onClick={(e) => { e.stopPropagation(); openContract(r.contract_id); }}
          title="View contract details"
        >
          {r.contract_no}
        </button>
      ) : (r.contract_no || '-')
    )},
    { key: 'direction', header: 'Direction', render: (r) => r.direction === 'SJVN_TO_BUYER' ? 'SJVN → Buyer' : 'Seller → SJVN' },
    { key: 'billing_period', header: 'Period' },
    { key: 'energy_mwh', header: 'Energy (MWh)', render: (r) => fmtNumber(r.energy_mwh) },
    { key: 'total_amount', header: 'Amount', render: (r) => fmtCurrency(r.total_amount) },
    { key: 'status', header: 'Status', render: (r) => (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
        <Badge status={r.status} />
        {r.days_overdue > 0 && (
          <span
            title={`Overdue ${r.days_overdue} day(s) · accruing LPS`}
            style={{ fontSize: 11, fontWeight: 600, color: '#b91c1c', background: '#fee2e2', border: '1px solid #fecaca', borderRadius: 4, padding: '1px 6px', whiteSpace: 'nowrap' }}
          >
            Overdue {r.days_overdue}d · LPS {fmtCurrency(r.accrued_lps)}
          </span>
        )}
      </div>
    )},
    { key: 'due_date', header: 'Due Date', render: (r) => r.due_date || '-' },
  ];

  return (
    <div>
      <PageHeader
        title="Billing &amp; Invoicing"
        subtitle="Generate provisional/final invoices, route through approvals and track payments"
        actions={
          <>
            <button className="btn btn-secondary" onClick={() => navigate('/reia/reports')}>Billing Report</button>
            {CAN_WRITE.includes(user?.role) && (
              <button className="btn btn-primary" onClick={() => setShowGenerate(true)}>+ Generate Invoice</button>
            )}
          </>
        }
      />

      <div className="filters-bar">
        <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
          <option value="">All statuses</option>
          {['DRAFT', 'SUBMITTED', 'UNDER_APPROVAL', 'APPROVED', 'REJECTED', 'SENT', 'DISPUTED', 'PARTIALLY_PAID', 'PAID', 'CANCELLED'].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={filters.direction} onChange={(e) => setFilters({ ...filters, direction: e.target.value })}>
          <option value="">All directions</option>
          <option value="SELLER_TO_SJVN">Seller → SJVN</option>
          <option value="SJVN_TO_BUYER">SJVN → Buyer</option>
        </select>
        <input type="month" value={filters.billing_period} onChange={(e) => setFilters({ ...filters, billing_period: e.target.value })} />
      </div>

      <Card>
        <Table columns={columns} rows={loading ? [] : rows} onRowClick={openDetail} emptyMessage={loading ? 'Loading...' : 'No invoices found.'} />
      </Card>

      <Modal open={showGenerate} onClose={() => setShowGenerate(false)} title="Generate Invoice" width={480}>
        {error && <div className="form-error">{error}</div>}
        <form onSubmit={handleGenerate}>
          <Field label="Contract">
            <select required value={genForm.contract_id} onChange={(e) => setGenForm({ ...genForm, contract_id: e.target.value })}>
              <option value="">Select contract...</option>
              {contracts.map((c) => <option key={c.id} value={c.id}>{c.contract_no} ({c.project_type})</option>)}
            </select>
          </Field>
          <div className="form-grid">
            <Field label="Billing Period">
              <input required type="month" value={genForm.period_month} onChange={(e) => setGenForm({ ...genForm, period_month: e.target.value })} />
            </Field>
            <Field label="Invoice Type">
              <select value={genForm.invoice_type} onChange={(e) => setGenForm({ ...genForm, invoice_type: e.target.value })}>
                <option value="PROVISIONAL">Provisional</option>
                <option value="FINAL">Final</option>
                <option value="SUPPLEMENTARY">Supplementary</option>
              </select>
            </Field>
          </div>
          
          {contracts.find(c => c.id === genForm.contract_id)?.contract_type === 'PSA' && (
            <Field label="Map to Seller Invoices (Many-to-Many)">
              <select multiple value={genForm.seller_invoice_ids || []} onChange={(e) => {
                const vals = Array.from(e.target.selectedOptions).map(o => o.value);
                setGenForm({ ...genForm, seller_invoice_ids: vals });
              }} style={{ height: 80 }}>
                {rows.filter(r => r.direction === 'SELLER_TO_SJVN' && ['APPROVED', 'PAID', 'PARTIALLY_PAID'].includes(r.status)).map(r => (
                  <option key={r.id} value={r.id}>{r.invoice_no} ({r.billing_period})</option>
                ))}
              </select>
              <p className="inline-note" style={{marginTop: 4}}>Hold Cmd/Ctrl to select multiple. These link the developer bills to this DISCOM bill.</p>
            </Field>
          )}
          
          <p className="inline-note">Invoice amount is auto-computed from locked/final energy data and the contract tariff. FINAL invoices require LOCKED energy data.</p>
          <div className="form-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setShowGenerate(false)}>Cancel</button>
            <button type="submit" className="btn btn-primary">Generate</button>
          </div>
        </form>
      </Modal>

      <Modal open={!!selected} onClose={() => setSelected(null)} title={selected?.invoice_no} width={720}>
        {selected && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
              <button onClick={handleDownloadPdf} className="btn btn-sm btn-outline">
                Download PDF Bill
              </button>
            </div>
            <div className="detail-grid mb-0">
              <div className="detail-item"><span className="detail-label">Status</span><span className="detail-value"><Badge status={selected.status} /></span></div>
              <div className="detail-item"><span className="detail-label">Contract</span><span className="detail-value">
                {selected.contract_id ? (
                  <button type="button" className="btn-link" onClick={() => openContract(selected.contract_id)} title="View contract details">
                    {selected.contract_no} &rsaquo;
                  </button>
                ) : (selected.contract_no || '-')}
              </span></div>
              <div className="detail-item"><span className="detail-label">Direction</span><span className="detail-value">{selected.direction === 'SJVN_TO_BUYER' ? 'SJVN → Buyer' : 'Seller → SJVN'}</span></div>
              <div className="detail-item"><span className="detail-label">Billing Period</span><span className="detail-value">{selected.billing_period}</span></div>
              <div className="detail-item"><span className="detail-label">Due Date</span><span className="detail-value">{selected.due_date || 'Not set'}</span></div>
              {selected.days_overdue > 0 && (
                <div className="detail-item">
                  <span className="detail-label">Overdue / Accrued LPS</span>
                  <span className="detail-value" style={{ color: 'var(--error)', fontWeight: 600 }}>
                    {selected.days_overdue} day(s) · {fmtCurrency(selected.accrued_lps)}
                    <span style={{ fontWeight: 400, color: '#64748b', fontSize: 12 }}> (accruing until paid)</span>
                  </span>
                </div>
              )}
              <div className="detail-item"><span className="detail-label">Tariff</span><span className="detail-value">₹{selected.tariff_per_unit}/unit</span></div>
              <div className="detail-item">
                <span className="detail-label">Billing Family Ref</span>
                <span className="detail-value">
                  <BfrChip bfr={selected.billing_family_ref} onClick={() => setTrailBfr(selected.billing_family_ref)} />
                </span>
              </div>
              {selected.parent_invoice_id && (
                <div className="detail-item"><span className="detail-label">Parent Invoice</span><span className="detail-value" style={{ fontFamily: 'monospace', fontSize: 12 }}>{selected.parent_invoice_id}</span></div>
              )}
            </div>

            <SettlementTrailPanel invoiceId={selected.id} />

            {/* ── CERC-style Breakdown Table ── */}
            {selected.invoice_breakdown_json ? (() => {
              let items = [];
              try { items = JSON.parse(selected.invoice_breakdown_json); } catch(e) {}
              return items.length > 0 && (
                <div style={{ marginTop: 20, marginBottom: 20 }}>
                  <h4 style={{ margin: '0 0 12px 0', borderBottom: '1px solid #eee', paddingBottom: 8 }}>Invoice Breakdown (CERC Format)</h4>
                  <table className="detail-table" style={{ width: '100%' }}>
                    <thead>
                      <tr style={{ background: '#f8fafc' }}>
                        <th style={{ padding: '8px 12px', textAlign: 'left', fontSize: 12, color: '#64748b' }}>Code</th>
                        <th style={{ padding: '8px 12px', textAlign: 'left', fontSize: 12, color: '#64748b' }}>Description</th>
                        <th style={{ padding: '8px 12px', textAlign: 'right', fontSize: 12, color: '#64748b' }}>Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((item, i) => (
                        <tr key={i} style={item.code === 'TOTAL' ? { fontWeight: 700, background: '#eef2ff', borderTop: '2px solid #4f46e5' } : {}}>
                          <td style={{ padding: '6px 12px', fontFamily: 'monospace', fontSize: 12, color: '#4f46e5' }}>{item.code}</td>
                          <td style={{ padding: '6px 12px', fontSize: 13 }}>{item.label}</td>
                          <td style={{ padding: '6px 12px', textAlign: 'right', fontSize: 13, fontFamily: 'monospace' }}>
                            {['E1','E2','E3','E4','E5'].includes(item.code) 
                              ? `${fmtNumber(item.value)} MWh` 
                              : fmtCurrency(item.value)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            })() : (
              /* Fallback: simple summary for older invoices without breakdown */
              <div className="detail-grid mb-0" style={{ marginTop: 16 }}>
                <div className="detail-item"><span className="detail-label">Energy</span><span className="detail-value">{fmtNumber(selected.energy_mwh)} MWh</span></div>
                <div className="detail-item"><span className="detail-label">Energy Charges</span><span className="detail-value">{fmtCurrency(selected.energy_charges)}</span></div>
                {selected.capacity_charges > 0 && <div className="detail-item"><span className="detail-label">Capacity Charges</span><span className="detail-value">{fmtCurrency(selected.capacity_charges)}</span></div>}
                <div className="detail-item"><span className="detail-label">Transmission</span><span className="detail-value">{fmtCurrency(selected.transmission_charges)}</span></div>
                <div className="detail-item"><span className="detail-label">Trading Margin</span><span className="detail-value">{fmtCurrency(selected.trading_margin)}</span></div>
                <div className="detail-item"><span className="detail-label">Penalty (CUF)</span><span className="detail-value" style={{color: 'var(--error)'}}>-{fmtCurrency(selected.penalty)}</span></div>
                <div className="detail-item"><span className="detail-label">Taxes</span><span className="detail-value">{fmtCurrency(selected.taxes)}</span></div>
              </div>
            )}

            <div className="detail-grid mb-0">
              <div className="detail-item"><span className="detail-label" style={{fontWeight: 600}}>Total Base Amount</span><span className="detail-value" style={{fontWeight: 600}}>{fmtCurrency(selected.total_amount)}</span></div>
              
              <div className="detail-item">
                <span className="detail-label">
                  Disputed | Payable Now
                  <div style={{fontSize: 11, color: 'var(--text-light)', fontWeight: 'normal'}}>
                    Disputed: {fmtCurrency(selected.disputed_amount || 0)} | Payable Now: {fmtCurrency(selected.payable_now ?? (
                      selected.direction === 'SELLER_TO_SJVN'
                        ? selected.total_amount - selected.rebate + selected.lps - selected.disputed_amount
                        : selected.total_amount + selected.lps - selected.disputed_amount
                    ))}
                  </div>
                </span>
                <span className="detail-value" style={{color: 'var(--error)'}}>-{fmtCurrency(selected.disputed_amount)}</span>
              </div>
              {selected.direction === 'SELLER_TO_SJVN' && (
                <div className="detail-item">
                  <span className="detail-label">
                    Early Pay Rebate
                    <div style={{fontSize: 11, color: 'var(--text-light)', fontWeight: 'normal'}}>Formula: 2% of Energy Charges if SJVN pays Seller early</div>
                  </span>
                  <span className="detail-value" style={{color: 'var(--success)'}}>-{fmtCurrency(selected.rebate)}</span>
                </div>
              )}
              <div className="detail-item">
                <span className="detail-label">
                  Late Pay Surcharge (LPS)
                  <div style={{fontSize: 11, color: 'var(--text-light)', fontWeight: 'normal'}}>15% p.a. on undisputed amount only while dispute is open</div>
                </span>
                <span className="detail-value" style={{color: 'var(--error)'}}>+{fmtCurrency(selected.lps)}</span>
              </div>
              
              <div className="detail-item">
                <span className="detail-label">
                  Payable Now
                  <div style={{fontSize: 11, color: 'var(--text-light)', fontWeight: 'normal'}}>
                    Undisputed balance due by due date
                  </div>
                </span>
                <span className="detail-value" style={{ fontSize: 16, fontWeight: 'bold' }}>
                  {fmtCurrency(selected.payable_now ?? (
                    selected.direction === 'SELLER_TO_SJVN'
                      ? selected.total_amount - selected.rebate + selected.lps - selected.disputed_amount
                      : selected.total_amount + selected.lps - selected.disputed_amount
                  ))}
                </span>
              </div>
            </div>

            {selected.approvals?.length > 0 && (
              <>
                <div className="section-title" style={{ marginTop: 18 }}>Approval Workflow</div>
                <div className="timeline">
                  {selected.approvals.map((a) => (
                    <div className="timeline-item" key={a.id}>
                      Level {a.level}: <Badge status={a.status} /> {a.approver_name ? `by ${a.approver_name}` : ''}
                      {a.comments && <div className="t-meta">{a.comments}</div>}
                      {CAN_APPROVE.includes(user?.role) && a.status === 'PENDING' && (
                        <div style={{ marginTop: 8 }}>
                          <input placeholder="Comments (optional)" value={approveComments[a.level] || ''} onChange={(e) => setApproveComments({ ...approveComments, [a.level]: e.target.value })} style={{ marginBottom: 6, width: '100%', border: '1px solid var(--border)', borderRadius: 6, padding: '5px 8px' }} />
                          <div className="cell-actions">
                            <button className="btn btn-danger btn-sm" onClick={() => handleAct(a.level, 'REJECTED')}>Reject</button>
                            <button className="btn btn-success btn-sm" onClick={() => handleAct(a.level, 'APPROVED')}>Approve</button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}

            {selected.disputes?.length > 0 && (
              <>
                <div className="section-title" style={{ marginTop: 18 }}>Disputes</div>
                <div className="timeline">
                  {selected.disputes.map((d) => (
                    <div className="timeline-item" key={d.id}>
                      <Badge status={d.status} /> {d.dispute_no || ''} {d.reason_code || ''} — {fmtCurrency(d.disputed_amount)}
                      {d.issue_description && <div className="t-meta">{d.issue_description}</div>}
                    </div>
                  ))}
                </div>
              </>
            )}

            {selected.payments?.length > 0 && (
              <>
                <div className="section-title" style={{ marginTop: 18 }}>Payment History</div>
                <div className="timeline">
                  {selected.payments.map((p) => (
                    <div className="timeline-item" key={p.id}>
                      {fmtCurrency(p.amount)} via {p.mode || '-'} on {p.payment_date}
                      <div className="t-meta">Ref: {p.reference || '-'}</div>
                    </div>
                  ))}
                </div>
              </>
            )}

            <div style={{ marginTop: 24, marginBottom: 24 }}>
              <DocumentManager 
                moduleName="REIA_BILLING"
                contractId={selected.contract_id} 
                title="Invoice Documents & Calculations" 
              />
            </div>

            <div className="form-actions" style={{ flexWrap: 'wrap' }}>
              {['SELLER_L1', 'BUYER_L1'].includes(user?.role) && selected.status === 'DRAFT' && (
                <button className="btn btn-secondary" onClick={handleSubmitL2}>Submit to L2 (Checker)</button>
              )}
              {['SELLER_L2', 'SELLER_L3', 'BUYER_L2', 'BUYER_L3'].includes(user?.role) && selected.status === 'PENDING_L2' && (
                <button className="btn btn-primary" onClick={handleApproveL2}>Approve & Submit to SJVN</button>
              )}
              {CAN_WRITE.includes(user?.role) && ['DRAFT', 'SUBMITTED', 'REJECTED'].includes(selected.status) && (
                <button className="btn btn-secondary" onClick={handleSubmitForApproval}>Submit for SJVN Approval</button>
              )}
              {CAN_WRITE.includes(user?.role) && selected.status === 'APPROVED' && selected.direction === 'SJVN_TO_BUYER' && (
                <button className="btn btn-primary" onClick={handleSend}>Send to Buyer</button>
              )}
            </div>

            {CAN_RECORD_PAYMENT.includes(user?.role) && !['PAID', 'CANCELLED', 'DRAFT'].includes(selected.status) && (
              <>
                <div className="section-title" style={{ marginTop: 18 }}>
                  {selected.direction === 'SELLER_TO_SJVN' ? 'Record Payment (Outgoing to Seller)' : 'Record Payment (Incoming from Buyer)'}
                </div>
                <form onSubmit={handlePayment}>
                  <div className="form-grid">
                    <Field label="Amount (₹)">
                      <input required type="number" value={payForm.amount} onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })} />
                    </Field>
                    <Field label="Payment Date">
                      <input required type="date" value={payForm.payment_date} onChange={(e) => setPayForm({ ...payForm, payment_date: e.target.value })} />
                    </Field>
                    <Field label="Mode">
                      <select value={payForm.mode} onChange={(e) => setPayForm({ ...payForm, mode: e.target.value })}>
                        {['NEFT', 'RTGS', 'UPI', 'CHEQUE', 'OTHER'].map((m) => <option key={m} value={m}>{m}</option>)}
                      </select>
                    </Field>
                    <Field label="Reference">
                      <input value={payForm.reference} onChange={(e) => setPayForm({ ...payForm, reference: e.target.value })} />
                    </Field>
                    <Field label="Deduction (₹)">
                      <input type="number" value={payForm.deduction} onChange={(e) => setPayForm({ ...payForm, deduction: e.target.value })} />
                    </Field>
                  </div>
                  <p className="inline-note">Note: Rebate (early payment) and LPS (late payment) will be automatically calculated based on the Payment Date vs Due Date.</p>
                  <div className="form-actions">
                    <button type="submit" className="btn btn-primary">Record Payment</button>
                  </div>
                </form>
              </>
            )}
          </div>
        )}
      </Modal>

      <Modal open={!!trailBfr} onClose={() => setTrailBfr(null)} title="Settlement Trail" width={720}>
        {trailBfr && <SettlementTrailPanel bfr={trailBfr} />}
      </Modal>

      <Modal open={!!contractDetail} onClose={() => setContractDetail(null)} title={contractDetail?.contract_no ? `Contract: ${contractDetail.contract_no}` : 'Contract Details'} width={720}>
        {contractLoading && !contractDetail?.contract_no ? (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-light)' }}>Loading contract details...</div>
        ) : contractDetail && contractDetail.contract_no ? (
          <div>
            <div className="section-title">Contract Overview</div>
            <div className="detail-grid mb-0">
              <div className="detail-item"><span className="detail-label">Contract No</span><span className="detail-value">{contractDetail.contract_no}</span></div>
              <div className="detail-item"><span className="detail-label">Type</span><span className="detail-value"><Badge status={contractDetail.contract_type} /></span></div>
              <div className="detail-item"><span className="detail-label">Status</span><span className="detail-value"><Badge status={contractDetail.status} /></span></div>
              <div className="detail-item"><span className="detail-label">Counterparty</span><span className="detail-value">{contractDetail.seller_name || contractDetail.buyer_name || '-'}</span></div>
              <div className="detail-item"><span className="detail-label">Project Type</span><span className="detail-value">{contractDetail.project_type || '-'}</span></div>
              <div className="detail-item"><span className="detail-label">Total Capacity</span><span className="detail-value">{fmtNumber(contractDetail.capacity_mw)} MW</span></div>
              <div className="detail-item">
                <span className="detail-label">Commissioned (COD)</span>
                <span className="detail-value">
                  {contractDetail.commissioned_capacity_mw > 0
                    ? <span style={{ color: 'var(--success)', fontWeight: 600 }}>{fmtNumber(contractDetail.commissioned_capacity_mw)} MW{contractDetail.cod_date ? ` (COD: ${contractDetail.cod_date})` : ''}</span>
                    : 'Not yet commissioned'}
                </span>
              </div>
              {contractDetail.billing_cycle && (
                <div className="detail-item"><span className="detail-label">Billing Cycle</span><span className="detail-value">{contractDetail.billing_cycle}</span></div>
              )}
            </div>

            <div className="section-title" style={{ marginTop: 18 }}>Commercial Terms</div>
            <div className="detail-grid mb-0">
              <div className="detail-item"><span className="detail-label">Tariff Type</span><span className="detail-value">{contractDetail.tariff_type || '-'}</span></div>
              <div className="detail-item"><span className="detail-label">Tariff / Unit</span><span className="detail-value">₹{contractDetail.tariff_per_unit}</span></div>
              <div className="detail-item"><span className="detail-label">Tenure</span><span className="detail-value">{contractDetail.tenure_start || '?'} to {contractDetail.tenure_end || '?'}</span></div>
              <div className="detail-item"><span className="detail-label">PBG / EMD</span><span className="detail-value">{fmtCurrency(contractDetail.pbg_amount)}{contractDetail.pbg_type ? ` (${contractDetail.pbg_type})` : ''}</span></div>
              <div className="detail-item"><span className="detail-label">Rebate Rule</span><span className="detail-value">{contractDetail.rebate_rule || '-'}</span></div>
              <div className="detail-item"><span className="detail-label">LPS Rule</span><span className="detail-value">{contractDetail.lps_rule || '-'}</span></div>
              {contractDetail.payment_terms && (
                <div className="detail-item"><span className="detail-label">Payment Terms</span><span className="detail-value">{contractDetail.payment_terms}</span></div>
              )}
            </div>

            {contractDetail.status === 'TERMINATED' && (
              <div className="detail-grid mb-0" style={{ marginTop: 12 }}>
                <div className="detail-item"><span className="detail-label">Termination Date</span><span className="detail-value">{contractDetail.termination_date || '-'}</span></div>
                <div className="detail-item"><span className="detail-label">Termination Reason</span><span className="detail-value">{contractDetail.termination_reason || '-'}</span></div>
              </div>
            )}

            {contractDetail.amendments?.length > 0 && (
              <>
                <div className="section-title" style={{ marginTop: 18 }}>Amendments</div>
                <div className="timeline">
                  {contractDetail.amendments.map((a) => (
                    <div className="timeline-item" key={a.id}>
                      v{a.version}: {a.change_summary || a.reason || 'Amendment'}
                      {a.created_at && <div className="t-meta">{a.created_at}</div>}
                    </div>
                  ))}
                </div>
              </>
            )}

            <div style={{ marginTop: 20, marginBottom: 8 }}>
              <DocumentManager
                moduleName="CONTRACTS"
                contractId={contractDetail.id}
                title="Contract Documents (PPA / PSA, Amendments)"
              />
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
