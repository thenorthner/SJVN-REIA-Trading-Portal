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
  }, []);

  useEffect(() => {
    if (tab === 'LEDGER' && selectedClient) {
      api.billingSettlement.getLedger(selectedClient).then(setLedger).catch(() => {});
    }
  }, [tab, selectedClient]);

  function loadInvoices() {
    api.billingSettlement.listInvoices().then(setInvoices).catch(() => {});
  }
  
  function loadSoa() {
    api.billingSettlement.getSoa().then(setSoa).catch(() => {});
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
        if (r.status === 'PAID') { type = 'success'; label = '🟢 Paid'; }
        else if (r.status === 'OVERDUE') { type = 'danger'; label = '🔴 Overdue'; }
        else if (r.status === 'PARTIALLY_PAID') { type = 'warning'; label = '🟡 Partially Paid'; }
        else if (r.status === 'DRAFT') { type = 'primary'; label = '🔵 Draft / Unbilled'; }
        return <Badge type={type}>{label}</Badge>;
    }},
    { key: 'actions', label: 'Action', render: () => <button className="btn btn-sm" title="Download PDF" style={{padding: '2px 6px'}}>📄 PDF</button> }
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

  return (
    <div style={{ padding: 20 }}>
      <PageHeader 
        title="Trading Billing & Settlement" 
        actions={
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn btn-outline" onClick={() => setShowNetting(true)}>Apply Netting</button>
            <button className="btn btn-primary" onClick={() => setShowGenerate(true)}>+ Generate Bill</button>
          </div>
        }
      />

      <div style={{ marginBottom: 20, borderBottom: '1px solid #ddd', display: 'flex', gap: 20 }}>
        {['INVOICES', 'LEDGER'].map(t => (
          <button 
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: '10px 0', border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 16,
              borderBottom: tab === t ? '2px solid #0052cc' : '2px solid transparent',
              color: tab === t ? '#0052cc' : '#555', fontWeight: tab === t ? 'bold' : 'normal'
            }}
          >
            {t === 'INVOICES' ? '📑 Invoices & Tax Statements' : '💳 Bank & Pool Ledger'}
          </button>
        ))}
      </div>

      <Card>
        {tab === 'INVOICES' && (
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 15, alignItems: 'end', marginBottom: 20, background: '#f5f7f9', padding: 15, borderRadius: 6 }}>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 'bold', marginBottom: 5 }}>Portfolio Id:</label>
                <PortfolioSelect
                  includeAll
                  value={invFilter.portfolio}
                  onChange={(v) => setInvFilter({ ...invFilter, portfolio: v })}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 'bold', marginBottom: 5 }}>From Delivery Date:</label>
                <input type="date" className="input" value={invFilter.fromDate} onChange={e => setInvFilter({...invFilter, fromDate: e.target.value})} />
                <div style={{ marginTop: 4, display: 'flex', gap: 5 }}>
                  <button type="button" className="btn btn-sm" style={{fontSize: 10, padding: '2px 4px'}} onClick={() => setInvFilter({...invFilter, ...monthRange(0)})}>This Month</button>
                  <button type="button" className="btn btn-sm" style={{fontSize: 10, padding: '2px 4px'}} onClick={() => setInvFilter({...invFilter, ...monthRange(-1)})}>Last Month</button>
                  <button type="button" className="btn btn-sm" style={{fontSize: 10, padding: '2px 4px'}} onClick={() => setInvFilter({...invFilter, ...financialYearRange()})}>FY {financialYearLabel()}</button>
                </div>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 'bold', marginBottom: 5 }}>To Delivery Date:</label>
                <input type="date" className="input" value={invFilter.toDate} onChange={e => setInvFilter({...invFilter, toDate: e.target.value})} />
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
    </div>
  );
}
