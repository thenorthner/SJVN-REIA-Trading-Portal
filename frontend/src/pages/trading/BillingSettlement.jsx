import React, { useEffect, useMemo, useState } from 'react';
import { PortfolioSelect, usePortfolios } from '../../context/PortfolioContext.jsx';
import { api } from '../../api/client.js';
import { PageHeader, Card, Table, Badge, Modal, Field, fmtNumber } from '../../components/ui.jsx';
import { DocumentManager } from '../../components/DocumentManager.jsx';

const iso = (d) => d.toISOString().slice(0, 10);

/** Whole calendar month, `offset` months from the current one. */
function monthRange(offset) {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  const end = new Date(now.getFullYear(), now.getMonth() + offset + 1, 0);
  return { fromDate: iso(start), toDate: iso(end) };
}

/** Indian financial year: 1 April to 31 March. */
function financialYearRange() {
  const now = new Date();
  const startYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  return { fromDate: `${startYear}-04-01`, toDate: `${startYear + 1}-03-31` };
}
function financialYearLabel() {
  const now = new Date();
  const startYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  return `${String(startYear).slice(2)}-${String(startYear + 1).slice(2)}`;
}

export default function BillingSettlement() {
  const [tab, setTab] = useState('INVOICES');
  const [invoices, setInvoices] = useState([]);
  const [clients, setClients] = useState([]);
  const [selectedClient, setSelectedClient] = useState('');
  const [ledger, setLedger] = useState([]);
  const [soa, setSoa] = useState([]);
  
  // Trading Debit / Credit Notes state
  const [notes, setNotes] = useState([]);
  const [noteSummary, setNoteSummary] = useState(null);
  const [notesRef, setNotesRef] = useState({ reason_codes: [], note_types: [], statuses: [] });
  const [noteFilter, setNoteFilter] = useState({ client_id: '', billing_period: '', note_type: '', status: '', reason_code: '' });
  const [showCreateNote, setShowCreateNote] = useState(false);
  const [cancelNoteObj, setCancelNoteObj] = useState(null);
  const [cancelReason, setCancelReason] = useState('');
  const [noteForm, setNoteForm] = useState({
    client_id: '',
    note_type: 'DEBIT',
    billing_period: `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`,
    delivery_date: '',
    reason_code: 'SCHEDULE_SHORTFALL_PURCHASE',
    quantum_mwh: '',
    rate_per_unit: '',
    amount: '',
    broker_reference: '',
    reason: '',
  });

  const [invFilter, setInvFilter] = useState({ portfolio: '', fromDate: '', toDate: '' });

  const [showGenerate, setShowGenerate] = useState(false);
  const [showNetting, setShowNetting] = useState(false);
  
  const [invForm, setInvForm] = useState({
    client_id: '', invoice_kind: 'EXCHANGE', trade_type: 'CLIENT_ACCOUNT', trade_date: '', settlement_date: '',
    billing_period: '', quantum_mwh: '', exchange_fee: '', clearing_charges: '', sjvn_margin: '', 
    transmission_charges: '', dsm_charges: '', gst_applicable: true
  });
  
  const [netForm, setNetForm] = useState({ client_id: '', receivables_amount: '', payables_amount: '', period: '' });

  useEffect(() => {
    api.tradingClients.list({ status: 'ACTIVE' }).then(setClients).catch(() => {});
    loadInvoices();
    loadSoa();
    loadNotesReference();
  }, []);

  useEffect(() => {
    if (tab === 'LEDGER' && selectedClient) {
      api.billingSettlement.getLedger(selectedClient).then(setLedger).catch(() => {});
    }
    if (tab === 'NOTES') {
      loadNotes();
      loadNotesSummary();
    }
  }, [tab, selectedClient, noteFilter]);

  function loadInvoices() {
    api.billingSettlement.listInvoices().then(setInvoices).catch(() => {});
  }
  
  function loadSoa() {
    api.billingSettlement.getSoa().then(setSoa).catch(() => {});
  }

  function loadNotesReference() {
    api.tradingNotes.reference().then(setNotesRef).catch(() => {});
  }

  function loadNotes() {
    const params = {};
    if (noteFilter.client_id) params.client_id = noteFilter.client_id;
    if (noteFilter.billing_period) params.billing_period = noteFilter.billing_period;
    if (noteFilter.note_type) params.note_type = noteFilter.note_type;
    if (noteFilter.status) params.status = noteFilter.status;
    if (noteFilter.reason_code) params.reason_code = noteFilter.reason_code;
    api.tradingNotes.list(params).then(setNotes).catch(() => {});
  }

  function loadNotesSummary() {
    const params = {};
    if (noteFilter.client_id) params.client_id = noteFilter.client_id;
    if (noteFilter.billing_period) params.billing_period = noteFilter.billing_period;
    api.tradingNotes.summary(params).then(setNoteSummary).catch(() => {});
  }

  async function handleCreateNote(e) {
    e.preventDefault();
    try {
      await api.tradingNotes.create({
        ...noteForm,
        amount: Number(noteForm.amount),
        quantum_mwh: noteForm.quantum_mwh ? Number(noteForm.quantum_mwh) : null,
        rate_per_unit: noteForm.rate_per_unit ? Number(noteForm.rate_per_unit) : null,
      });
      setShowCreateNote(false);
      setNoteForm({
        client_id: '',
        note_type: 'DEBIT',
        billing_period: `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`,
        delivery_date: '',
        reason_code: 'SCHEDULE_SHORTFALL_PURCHASE',
        quantum_mwh: '',
        rate_per_unit: '',
        amount: '',
        broker_reference: '',
        reason: '',
      });
      loadNotes();
      loadNotesSummary();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to raise trading note');
    }
  }

  async function handleSettleNote(id) {
    if (!confirm('Mark this debit/credit note as settled in settlement reconciliation?')) return;
    try {
      await api.tradingNotes.settle(id, {});
      loadNotes();
      loadNotesSummary();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to settle note');
    }
  }

  async function handleCancelNote(e) {
    e.preventDefault();
    if (!cancelNoteObj) return;
    try {
      await api.tradingNotes.cancel(cancelNoteObj.id, { reason: cancelReason });
      setCancelNoteObj(null);
      setCancelReason('');
      loadNotes();
      loadNotesSummary();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to cancel note');
    }
  }

  async function handleGenerate(e) {
    e.preventDefault();
    try {
      await api.billingSettlement.generateInvoice(invForm);
      setShowGenerate(false);
      loadInvoices();
    } catch (err) {
      alert("Failed to generate invoice");
    }
  }

  async function handleNetting(e) {
    e.preventDefault();
    try {
      await api.billingSettlement.applyNetting(netForm);
      setShowNetting(false);
      setTab('LEDGER');
      setSelectedClient(netForm.client_id);
    } catch (err) {
      alert("Failed to apply netting");
    }
  }

  // trading_invoices has no trade_date column; created_at is the invoice date.
  const invoiceDate = (r) => (r.created_at || '').slice(0, 10);

  const visibleInvoices = useMemo(() => invoices.filter((r) => {
    if (invFilter.portfolio && r.client_id !== invFilter.portfolio) return false;
    const d = invoiceDate(r);
    if (invFilter.fromDate && (!d || d < invFilter.fromDate)) return false;
    if (invFilter.toDate && (!d || d > invFilter.toDate)) return false;
    return true;
  }), [invoices, invFilter]);

  const invoiceColumns = [
    { key: 'invoice_no', label: 'Invoice No' },
    { key: 'created_at', label: 'Invoice Date', render: r => invoiceDate(r) || '—' },
    // No placeholder period here — a fixed date range printed under every
    // invoice that lacks one reads as a real delivery period.
    { key: 'billing_period', label: 'Delivery Period', render: r => r.billing_period || '—' },
    { key: 'quantum_mwh', label: 'Billed Energy (kWh)', render: r => fmtNumber((r.quantum_mwh || 0) * 1000) },
    { key: 'rate_per_unit', label: 'Tariff (₹/kWh)', render: r => `₹${r.rate_per_unit || '0.00'}` },
    { key: 'taxable_value', label: 'Taxable Value', render: r => `₹${fmtNumber((r.total_amount || 0) - (r.gst_amount || 0))}` },
    { key: 'gst_amount', label: 'GST Amount', render: r => `₹${fmtNumber(r.gst_amount || 0)}` },
    { key: 'total_amount', label: 'Total Payable/Receivable', render: r => <span style={{fontWeight:'bold'}}>₹{fmtNumber(r.total_amount)}</span> },
    { key: 'sap_doc', label: 'SAP Doc', render: r => <a href="#" style={{color: '#0056b3'}}>SAP-{r.invoice_no.substring(0,6)}</a> },
    { key: 'status', label: 'Status', render: r => {
        let type = 'neutral';
        let label = r.status;
        if (r.status === 'PAID') { type = 'success'; label = 'Paid'; }
        else if (r.status === 'OVERDUE') { type = 'danger'; label = 'Overdue'; }
        else if (r.status === 'PARTIALLY_PAID') { type = 'warning'; label = 'Partially Paid'; }
        else if (r.status === 'DRAFT') { type = 'primary'; label = 'Draft / Unbilled'; }
        return <Badge type={type}>{label}</Badge>;
    }},
    { key: 'actions', label: 'Action', render: () => <button className="btn btn-sm" title="Download PDF" style={{padding: '2px 6px'}}>PDF</button> }
  ];

  const ledgerColumns = [
    { key: 'timestamp', label: 'Date/Time' },
    { key: 'transaction_type', label: 'Type', render: r => <Badge>{r.transaction_type}</Badge> },
    { key: 'reference_id', label: 'Ref ID' },
    { key: 'description', label: 'Description' },
    { key: 'debit', label: 'Debit (Dr)', render: r => r.debit ? `₹${fmtNumber(r.debit)}` : '-' },
    { key: 'credit', label: 'Credit (Cr)', render: r => r.credit ? `₹${fmtNumber(r.credit)}` : '-' },
    { key: 'running_balance', label: 'Balance', render: r => <span style={{fontWeight:'bold', color: r.running_balance < 0 ? 'var(--red)' : 'var(--green)'}}>₹{fmtNumber(r.running_balance)}</span> }
  ];

  const soaColumns = [
    { key: 'client_name', label: 'Client' },
    { key: 'period_start', label: 'From' },
    { key: 'period_end', label: 'To' },
    { key: 'opening_balance', label: 'Opening Balance', render: r => `₹${fmtNumber(r.opening_balance)}` },
    { key: 'closing_balance', label: 'Closing Balance', render: r => `₹${fmtNumber(r.closing_balance)}` },
    { key: 'status', label: 'Status', render: r => <Badge type={r.status === 'ACKNOWLEDGED' ? 'success' : 'neutral'}>{r.status}</Badge> },
  ];

  const noteColumns = [
    { key: 'note_no', label: 'Note No', render: (r) => <strong style={{ fontFamily: 'monospace' }}>{r.note_no}</strong> },
    {
      key: 'note_type',
      label: 'Type',
      render: (r) => (
        <Badge type={r.note_type === 'DEBIT' ? 'danger' : 'success'}>
          {r.note_type === 'DEBIT' ? 'DEBIT (+ve)' : 'CREDIT (-ve)'}
        </Badge>
      ),
    },
    { key: 'client_name', label: 'Client / Beneficiary', render: (r) => r.client_name || r.client_id },
    { key: 'billing_period', label: 'Period', render: (r) => <span style={{ fontWeight: 600 }}>{r.billing_period}</span> },
    { key: 'delivery_date', label: 'Delivery Date', render: (r) => r.delivery_date || '—' },
    {
      key: 'reason_code',
      label: 'Reason / Reconciled Item',
      render: (r) => (
        <div>
          <span style={{ fontSize: 12, fontWeight: 600, color: '#1e293b' }}>
            {r.reason_code ? r.reason_code.replace(/_/g, ' ') : '—'}
          </span>
          {r.reason && <div style={{ fontSize: 11, color: '#64748b', maxWidth: 260 }}>{r.reason}</div>}
        </div>
      ),
    },
    {
      key: 'quantum_mwh',
      label: 'Energy (MWh)',
      render: (r) => (r.quantum_mwh != null ? fmtNumber(r.quantum_mwh) : '—'),
    },
    {
      key: 'rate_per_unit',
      label: 'Rate (₹/kWh)',
      render: (r) => (r.rate_per_unit != null ? `₹${fmtNumber(r.rate_per_unit)}` : '—'),
    },
    {
      key: 'amount',
      label: 'Adjustment (₹)',
      render: (r) => (
        <span
          style={{
            fontWeight: 800,
            fontSize: 13,
            color: r.status === 'CANCELLED' ? '#94a3b8' : (r.note_type === 'DEBIT' ? '#dc2626' : '#16a34a'),
          }}
        >
          {r.note_type === 'DEBIT' ? '+' : '-'}₹{fmtNumber(r.amount)}
        </span>
      ),
    },
    { key: 'broker_reference', label: 'Broker / Manual Ref', render: (r) => r.broker_reference ? <span style={{ background: '#f1f5f9', padding: '2px 6px', borderRadius: 4, fontSize: 11 }}>{r.broker_reference}</span> : '—' },
    {
      key: 'status',
      label: 'Status',
      render: (r) => {
        let type = 'neutral';
        if (r.status === 'ISSUED') type = 'primary';
        else if (r.status === 'SETTLED') type = 'success';
        else if (r.status === 'CANCELLED') type = 'danger';
        return <Badge type={type}>{r.status}</Badge>;
      },
    },
    {
      key: 'actions',
      label: 'Actions',
      render: (r) => (
        <div style={{ display: 'flex', gap: 6 }}>
          {r.status === 'ISSUED' && (
            <>
              <button
                className="btn btn-sm"
                style={{ fontSize: 11, padding: '2px 8px', background: '#059669', color: '#fff', border: 'none' }}
                onClick={() => handleSettleNote(r.id)}
                title="Mark as Settled / Reconciled in Payment Report"
              >
                 Settle
              </button>
              <button
                className="btn btn-sm btn-danger"
                style={{ fontSize: 11, padding: '2px 8px' }}
                onClick={() => { setCancelNoteObj(r); setCancelReason(''); }}
                title="Cancel Note"
              >
                 Cancel
              </button>
            </>
          )}
        </div>
      ),
    },
  ];

  return (
    <div style={{ padding: 20 }}>
      <PageHeader 
        title="Trading Billing & Settlement" 
        actions={
          <div style={{ display: 'flex', gap: 10 }}>
            {tab === 'NOTES' ? (
              <button className="btn btn-primary" onClick={() => setShowCreateNote(true)}>+ Raise Debit / Credit Note</button>
            ) : (
              <>
                <button className="btn btn-outline" onClick={() => setShowNetting(true)}>Apply Netting</button>
                <button className="btn btn-primary" onClick={() => setShowGenerate(true)}>+ Generate Bill</button>
              </>
            )}
          </div>
        }
      />

      <div style={{ marginBottom: 20, borderBottom: '1px solid #ddd', display: 'flex', gap: 20 }}>
        {[
          { id: 'INVOICES', label: 'Invoices & Tax Statements' },
          { id: 'NOTES', label: 'Debit & Credit Notes (Reconciliation)' },
          { id: 'LEDGER', label: 'Bank & Pool Ledger' },
        ].map(t => (
          <button 
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              padding: '10px 0', border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 15,
              borderBottom: tab === t.id ? '2px solid #0052cc' : '2px solid transparent',
              color: tab === t.id ? '#0052cc' : '#555', fontWeight: tab === t.id ? 'bold' : 'normal'
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      <Card>
        {tab === 'INVOICES' && (
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 15, alignItems: 'end', marginBottom: 20, background: '#f5f7f9', padding: 15, borderRadius: 6 }}>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 'bold', marginBottom: 5 }} htmlFor="billingsettlement-portfolio-id">Portfolio Id:</label>
                <PortfolioSelect id="billingsettlement-portfolio-id"
                  includeAll
                  value={invFilter.portfolio}
                  onChange={(v) => setInvFilter({ ...invFilter, portfolio: v })}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 'bold', marginBottom: 5 }} htmlFor="billingsettlement-from-delivery-date">From Delivery Date:</label>
                <input id="billingsettlement-from-delivery-date" type="date" className="input" value={invFilter.fromDate} onChange={e => setInvFilter({...invFilter, fromDate: e.target.value})} />
                <div style={{ marginTop: 4, display: 'flex', gap: 5 }}>
                  <button type="button" className="btn btn-sm" style={{fontSize: 10, padding: '2px 4px'}} onClick={() => setInvFilter({...invFilter, ...monthRange(0)})}>This Month</button>
                  <button type="button" className="btn btn-sm" style={{fontSize: 10, padding: '2px 4px'}} onClick={() => setInvFilter({...invFilter, ...monthRange(-1)})}>Last Month</button>
                  <button type="button" className="btn btn-sm" style={{fontSize: 10, padding: '2px 4px'}} onClick={() => setInvFilter({...invFilter, ...financialYearRange()})}>FY {financialYearLabel()}</button>
                </div>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 'bold', marginBottom: 5 }} htmlFor="billingsettlement-to-delivery-date">To Delivery Date:</label>
                <input id="billingsettlement-to-delivery-date" type="date" className="input" value={invFilter.toDate} onChange={e => setInvFilter({...invFilter, toDate: e.target.value})} />
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <button className="btn btn-primary">[ Search ]</button>
                <button className="btn" style={{ background: '#28a745', color: '#fff' }}>[ EXCEL v ] Export File</button>
              </div>
            </div>
            {visibleInvoices.length !== invoices.length && (
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
                Showing {visibleInvoices.length} of {invoices.length} invoice(s) —{' '}
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => setInvFilter({ portfolio: '', fromDate: '', toDate: '' })}
                >clear filters</button>
              </div>
            )}
            <Table columns={invoiceColumns} data={visibleInvoices} emptyMessage="Nothing found to display." />
          </div>
        )}

        {tab === 'NOTES' && (
          <div>
            {noteSummary && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 20 }}>
                <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '12px 16px' }}>
                  <div style={{ fontSize: 11, color: '#991b1b', fontWeight: 600, textTransform: 'uppercase' }}>Total Debit Notes (+ve)</div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: '#dc2626', marginTop: 4 }}>+₹{fmtNumber(noteSummary.total_debit || 0)}</div>
                  <div style={{ fontSize: 11, color: '#b91c1c', marginTop: 2 }}>Shortfall market purchases / additions</div>
                </div>

                <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: '12px 16px' }}>
                  <div style={{ fontSize: 11, color: '#166534', fontWeight: 600, textTransform: 'uppercase' }}>Total Credit Notes (-ve)</div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: '#16a34a', marginTop: 4 }}>-₹{fmtNumber(noteSummary.total_credit || 0)}</div>
                  <div style={{ fontSize: 11, color: '#15803d', marginTop: 2 }}>Rebates / cheaper replacements</div>
                </div>

                <div style={{ background: '#f8fafc', border: '1px solid #cbd5e1', borderRadius: 8, padding: '12px 16px' }}>
                  <div style={{ fontSize: 11, color: '#475569', fontWeight: 600, textTransform: 'uppercase' }}>Net Reconciled Differential</div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: noteSummary.net_payable >= 0 ? '#dc2626' : '#16a34a', marginTop: 4 }}>
                    {noteSummary.net_payable >= 0 ? '+' : ''}₹{fmtNumber(noteSummary.net_payable || 0)}
                  </div>
                  <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>Obligation vs Payment Report gap</div>
                </div>

                <div style={{ background: '#f8fafc', border: '1px solid #cbd5e1', borderRadius: 8, padding: '12px 16px' }}>
                  <div style={{ fontSize: 11, color: '#475569', fontWeight: 600, textTransform: 'uppercase' }}>Total Active Notes</div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: '#0f172a', marginTop: 4 }}>{noteSummary.note_count || 0}</div>
                  <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>PTC & Exchange broker adjustments</div>
                </div>
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, alignItems: 'end', marginBottom: 16, background: '#f8fafc', padding: 14, borderRadius: 6, border: '1px solid #e2e8f0' }}>
              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#475569', marginBottom: 4 }}>Client / Beneficiary:</label>
                <select
                  className="input"
                  style={{ width: '100%', fontSize: 12 }}
                  value={noteFilter.client_id}
                  onChange={(e) => setNoteFilter({ ...noteFilter, client_id: e.target.value })}
                >
                  <option value="">All Clients</option>
                  {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#475569', marginBottom: 4 }}>Billing Period (YYYY-MM):</label>
                <input
                  type="month"
                  className="input"
                  style={{ width: '100%', fontSize: 12 }}
                  value={noteFilter.billing_period}
                  onChange={(e) => setNoteFilter({ ...noteFilter, billing_period: e.target.value })}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#475569', marginBottom: 4 }}>Note Type:</label>
                <select
                  className="input"
                  style={{ width: '100%', fontSize: 12 }}
                  value={noteFilter.note_type}
                  onChange={(e) => setNoteFilter({ ...noteFilter, note_type: e.target.value })}
                >
                  <option value="">All Types</option>
                  <option value="DEBIT">DEBIT (+ve)</option>
                  <option value="CREDIT">CREDIT (-ve)</option>
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#475569', marginBottom: 4 }}>Status:</label>
                <select
                  className="input"
                  style={{ width: '100%', fontSize: 12 }}
                  value={noteFilter.status}
                  onChange={(e) => setNoteFilter({ ...noteFilter, status: e.target.value })}
                >
                  <option value="">All Statuses</option>
                  <option value="ISSUED">ISSUED</option>
                  <option value="SETTLED">SETTLED</option>
                  <option value="CANCELLED">CANCELLED</option>
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#475569', marginBottom: 4 }}>Reason Category:</label>
                <select
                  className="input"
                  style={{ width: '100%', fontSize: 12 }}
                  value={noteFilter.reason_code}
                  onChange={(e) => setNoteFilter({ ...noteFilter, reason_code: e.target.value })}
                >
                  <option value="">All Reasons</option>
                  {(notesRef.reason_codes || []).map((r) => <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>)}
                </select>
              </div>
            </div>

            <Table columns={noteColumns} data={notes} emptyMessage="No trading debit/credit notes found." />
          </div>
        )}

        {tab === 'LEDGER' && (
          <div>
            <div style={{ display: 'flex', gap: 15, marginBottom: 20, alignItems: 'center' }}>
              <strong>Select Client:</strong>
              <select className="input" style={{ width: 300 }} value={selectedClient} onChange={e => setSelectedClient(e.target.value)}>
                <option value="">-- Choose Client --</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            {selectedClient ? (
              <Table columns={ledgerColumns} data={ledger} />
            ) : (
              <p style={{ color: '#777' }}>Please select a client to view their ledger.</p>
            )}
          </div>
        )}
        {tab === 'SOA' && (
          <Table columns={soaColumns} data={soa} />
        )}
      </Card>

      <div style={{ marginTop: 24 }}>
        <DocumentManager 
          moduleName="TRADING_BILLING"
          title="Global Trading Billing Documents (TDS, Obligations)" 
        />
      </div>

      {showGenerate && (
        <Modal open={true} onClose={() => setShowGenerate(false)} title="Generate Bill" width={800}>
          <form onSubmit={handleGenerate}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 15, marginBottom: 20 }}>
              <Field label="Client" required>
                <select className="input" value={invForm.client_id} onChange={e => setInvForm({...invForm, client_id: e.target.value})} required>
                  <option value="">Select Client</option>
                  {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </Field>
              <Field label="Invoice Kind" required>
                <select className="input" value={invForm.invoice_kind} onChange={e => setInvForm({...invForm, invoice_kind: e.target.value})}>
                  <option value="EXCHANGE">Exchange</option>
                  <option value="BILATERAL">Bilateral</option>
                </select>
              </Field>
              <Field label="Trade Date" required>
                <input type="date" className="input" value={invForm.trade_date} onChange={e => setInvForm({...invForm, trade_date: e.target.value})} required />
              </Field>
              <Field label="Settlement Date (T+x)" required>
                <input type="date" className="input" value={invForm.settlement_date} onChange={e => setInvForm({...invForm, settlement_date: e.target.value})} required />
              </Field>
            </div>

            <h4 style={{ marginBottom: 10 }}>Charges Breakdown</h4>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 15, marginBottom: 20 }}>
              <Field label="Quantum (MWh)" required>
                <input type="number" step="0.1" className="input" value={invForm.quantum_mwh} onChange={e => setInvForm({...invForm, quantum_mwh: e.target.value})} required />
              </Field>
              <Field label="SJVN Margin (₹)" required>
                <input type="number" step="0.01" className="input" value={invForm.sjvn_margin} onChange={e => setInvForm({...invForm, sjvn_margin: e.target.value})} required />
              </Field>
              
              {invForm.invoice_kind === 'EXCHANGE' ? (
                <>
                  <Field label="Exchange Fee (₹)">
                    <input type="number" step="0.01" className="input" value={invForm.exchange_fee} onChange={e => setInvForm({...invForm, exchange_fee: e.target.value})} />
                  </Field>
                  <Field label="Clearing Charges (₹)">
                    <input type="number" step="0.01" className="input" value={invForm.clearing_charges} onChange={e => setInvForm({...invForm, clearing_charges: e.target.value})} />
                  </Field>
                </>
              ) : (
                <>
                  <Field label="Transmission Charges (₹)">
                    <input type="number" step="0.01" className="input" value={invForm.transmission_charges} onChange={e => setInvForm({...invForm, transmission_charges: e.target.value})} />
                  </Field>
                  <Field label="DSM Charges (₹)">
                    <input type="number" step="0.01" className="input" value={invForm.dsm_charges} onChange={e => setInvForm({...invForm, dsm_charges: e.target.value})} />
                  </Field>
                </>
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button type="button" className="btn btn-outline" onClick={() => setShowGenerate(false)}>Cancel</button>
              <button type="submit" className="btn btn-primary">Generate</button>
            </div>
          </form>
        </Modal>
      )}

      {showNetting && (
        <Modal open={true} onClose={() => setShowNetting(false)} title="Apply Set-Off / Netting" width={500}>
          <form onSubmit={handleNetting}>
            <p style={{ marginBottom: 15, fontSize: 13, color: '#555' }}>Offset payables against receivables for a client to calculate net settlement.</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 15, marginBottom: 20 }}>
              <Field label="Client" required>
                <select className="input" value={netForm.client_id} onChange={e => setNetForm({...netForm, client_id: e.target.value})} required>
                  <option value="">Select Client</option>
                  {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </Field>
              <Field label="Period (e.g. 2025-06)" required>
                <input type="month" className="input" value={netForm.period} onChange={e => setNetForm({...netForm, period: e.target.value})} required />
              </Field>
              <Field label="Total Receivables (₹)" required>
                <input type="number" className="input" value={netForm.receivables_amount} onChange={e => setNetForm({...netForm, receivables_amount: e.target.value})} required />
              </Field>
              <Field label="Total Payables (₹)" required>
                <input type="number" className="input" value={netForm.payables_amount} onChange={e => setNetForm({...netForm, payables_amount: e.target.value})} required />
              </Field>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button type="button" className="btn btn-outline" onClick={() => setShowNetting(false)}>Cancel</button>
              <button type="submit" className="btn btn-primary">Execute Netting</button>
            </div>
          </form>
        </Modal>
      )}

      {/* Raise Trading Debit / Credit Note Modal */}
      {showCreateNote && (
        <Modal open={true} onClose={() => setShowCreateNote(false)} title="Raise Trading Debit / Credit Note" width={680}>
          <form onSubmit={handleCreateNote}>
            <div style={{ background: '#f8fafc', padding: 12, borderRadius: 6, marginBottom: 16, border: '1px solid #e2e8f0' }}>
              <div style={{ fontSize: 12, color: '#334155', lineHeight: 1.5 }}>
                <strong>Settlement Reconciler:</strong> Use this note to reconcile market borrowing differentials (e.g., shortfall replacement energy purchased via PTC / power exchange where broker raised a manual invoice in obligation report that was omitted in weekly payment report).
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
              <Field label="Client / Beneficiary" required>
                <select
                  className="input"
                  required
                  value={noteForm.client_id}
                  onChange={(e) => setNoteForm({ ...noteForm, client_id: e.target.value })}
                >
                  <option value="">Select Client...</option>
                  {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </Field>

              <Field label="Note Type" required>
                <select
                  className="input"
                  required
                  value={noteForm.note_type}
                  onChange={(e) => setNoteForm({ ...noteForm, note_type: e.target.value })}
                >
                  <option value="DEBIT">DEBIT NOTE (+ve Payable / Dearer Borrowing)</option>
                  <option value="CREDIT">CREDIT NOTE (-ve Rebate / Cheaper Borrowing)</option>
                </select>
              </Field>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
              <Field label="Billing Period (YYYY-MM)" required>
                <input
                  type="month"
                  className="input"
                  required
                  value={noteForm.billing_period}
                  onChange={(e) => setNoteForm({ ...noteForm, billing_period: e.target.value })}
                />
              </Field>

              <Field label="Delivery / Trade Date">
                <input
                  type="date"
                  className="input"
                  value={noteForm.delivery_date}
                  onChange={(e) => setNoteForm({ ...noteForm, delivery_date: e.target.value })}
                />
              </Field>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
              <Field label="Reason / Category" required>
                <select
                  className="input"
                  required
                  value={noteForm.reason_code}
                  onChange={(e) => setNoteForm({ ...noteForm, reason_code: e.target.value })}
                >
                  {(notesRef.reason_codes || []).map((r) => (
                    <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>
                  ))}
                </select>
              </Field>

              <Field label="Broker / Manual Invoice Ref">
                <input
                  className="input"
                  placeholder="e.g. PTC/MANUAL/2026/05/882"
                  value={noteForm.broker_reference}
                  onChange={(e) => setNoteForm({ ...noteForm, broker_reference: e.target.value })}
                />
              </Field>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14, marginBottom: 14 }}>
              <Field label="Energy Quantum (MWh)">
                <input
                  type="number"
                  step="0.01"
                  className="input"
                  placeholder="0.00"
                  value={noteForm.quantum_mwh}
                  onChange={(e) => setNoteForm({ ...noteForm, quantum_mwh: e.target.value })}
                />
              </Field>

              <Field label="Rate (₹/kWh)">
                <input
                  type="number"
                  step="0.01"
                  className="input"
                  placeholder="0.00"
                  value={noteForm.rate_per_unit}
                  onChange={(e) => setNoteForm({ ...noteForm, rate_per_unit: e.target.value })}
                />
              </Field>

              <Field label="Note Amount (₹)" required>
                <input
                  type="number"
                  step="0.01"
                  required
                  min="0.01"
                  className="input"
                  placeholder="₹ 0.00"
                  value={noteForm.amount}
                  onChange={(e) => setNoteForm({ ...noteForm, amount: e.target.value })}
                />
              </Field>
            </div>

            <Field label="Commercial Justification / Detail Remarks">
              <textarea
                rows={3}
                className="input"
                style={{ width: '100%' }}
                placeholder="Explain the differential: e.g. Promised 50 MW schedule fulfilled by borrowing from IEX RTM via PTC broker at ₹5.20/unit against PPA rate of ₹3.85/unit."
                value={noteForm.reason}
                onChange={(e) => setNoteForm({ ...noteForm, reason: e.target.value })}
              />
            </Field>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 18 }}>
              <button type="button" className="btn btn-outline" onClick={() => setShowCreateNote(false)}>Cancel</button>
              <button type="submit" className="btn btn-primary">Raise Note</button>
            </div>
          </form>
        </Modal>
      )}

      {/* Cancel Note Modal */}
      {cancelNoteObj && (
        <Modal open={true} onClose={() => setCancelNoteObj(null)} title="Cancel Trading Note" width={500}>
          <form onSubmit={handleCancelNote}>
            <p style={{ fontSize: 13, color: '#334155', marginTop: 0 }}>
              Are you sure you want to cancel note <strong>{cancelNoteObj.note_no}</strong> for <strong>₹{fmtNumber(cancelNoteObj.amount)}</strong>?
            </p>
            <Field label="Cancellation Justification" required>
              <textarea
                required
                rows={3}
                className="input"
                style={{ width: '100%' }}
                placeholder="Reason for cancellation (e.g. Broker superseded with revised settlement statement)"
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
              />
            </Field>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 18 }}>
              <button type="button" className="btn btn-outline" onClick={() => setCancelNoteObj(null)}>Back</button>
              <button type="submit" className="btn btn-danger">Confirm Cancellation</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}


