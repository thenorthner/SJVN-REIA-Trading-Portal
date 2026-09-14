import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LineChart, Line, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import api from '../../api/client.js';
import { PageHeader, StatCard, Card, fmtCurrency, fmtNumber, Modal, Table } from '../../components/ui.jsx';

const COLORS = ['var(--primary)', 'var(--green)', '#b3760a', 'var(--red)', '#1f5cd6', '#7a5bd6'];

export default function ReiaDashboard() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [showCapacityModal, setShowCapacityModal] = useState(false);

  useEffect(() => {
    api.dashboard.reia().then(setData).catch(() => {});
  }, []);

  async function downloadDashboardPdf() {
    setPdfLoading(true);
    try {
      await api.reports.reiaDashboardPdf();
    } catch (err) {
      alert(err.message || 'Failed to download REIA dashboard PDF');
    } finally {
      setPdfLoading(false);
    }
  }

  if (!data) return <div className="page-loading">Loading REIA dashboard...</div>;
  const { kpis, byStatus, byProjectType, monthlyBilling, lps, pendingSplit, ageing, formIv } = data;

  return (
    <div>
      <PageHeader
        title="REIA Billing & Settlement Dashboard"
        subtitle="Contracts, energy accounting, billing and receivables overview"
        actions={
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-primary" disabled={pdfLoading} onClick={downloadDashboardPdf}>
              {pdfLoading ? 'Preparing PDF…' : 'Download PDF Snapshot'}
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => navigate('/reia/reports')}>
              Billing Reports
            </button>
          </div>
        }
      />

      <div className="kpi-grid">
        <div style={{ cursor: 'pointer' }} onClick={() => navigate('/reia/contracts')}>
          <StatCard label="Active Contracts" value={kpis.activeContracts} tone="blue" />
        </div>
        <div style={{ cursor: 'pointer' }} onClick={() => setShowCapacityModal(true)}>
          <StatCard label="Contracted Capacity" value={`${fmtNumber(kpis.contractedCapacity)} MW`} tone="green" />
        </div>
        <div style={{ cursor: 'pointer' }} onClick={() => navigate('/reia/energy-data')}>
          <StatCard label="Energy Supplied" value={`${fmtNumber(kpis.energySupplied)} MWh`} />
        </div>
        <div style={{ cursor: 'pointer' }} onClick={() => navigate('/reia/invoices')}>
          <StatCard label="Total Invoices" value={kpis.totalInvoices} hint={fmtCurrency(kpis.totalInvoiceValue)} />
        </div>
        <div style={{ cursor: 'pointer' }} onClick={() => navigate('/reia/invoices')}>
          <StatCard label="Pending Approvals" value={kpis.pendingApprovals} tone={kpis.pendingApprovals > 0 ? 'amber' : 'default'} />
        </div>
        <div style={{ cursor: 'pointer' }} onClick={() => navigate('/reia/disputes')}>
          <StatCard label="Open Disputes" value={kpis.pendingDisputes} tone={kpis.pendingDisputes > 0 ? 'red' : 'default'} />
        </div>
        <div style={{ cursor: 'pointer' }} onClick={() => navigate('/reia/reconciliation')}>
          <StatCard label="Reconciliation Exceptions" value={kpis.reconciliationExceptions} tone={kpis.reconciliationExceptions > 0 ? 'red' : 'default'} />
        </div>
        <div style={{ cursor: 'pointer' }} onClick={() => navigate('/reia/payment-security')}>
          <StatCard label="Securities Expiring (60d)" value={kpis.expiringSecurities} tone={kpis.expiringSecurities > 0 ? 'amber' : 'default'} />
        </div>
        <div style={{ cursor: 'pointer' }} onClick={() => navigate('/reia/invoices')}>
          <StatCard label="Receivables (from Buyers)" value={fmtCurrency(kpis.receivables)} tone="amber" />
        </div>
        <div style={{ cursor: 'pointer' }} onClick={() => navigate('/reia/invoices')}>
          <StatCard label="Payables (to Sellers)" value={fmtCurrency(kpis.payables)} tone="amber" />
        </div>
        <div style={{ cursor: 'pointer' }} onClick={() => navigate('/reia/invoices')}>
          <StatCard label="Payments Received" value={fmtCurrency(kpis.paymentsReceived)} tone="green" />
        </div>
        <div style={{ cursor: 'pointer' }} onClick={() => navigate('/reia/invoices')}>
          <StatCard label="Payments Disbursed" value={fmtCurrency(kpis.paymentsDisbursed)} tone="green" />
        </div>
        <div style={{ cursor: 'pointer' }} onClick={() => navigate('/reia/invoices')}>
          <StatCard label="Overdue Invoices" value={kpis.overdue} tone={kpis.overdue > 0 ? 'red' : 'default'} />
        </div>
        {/* CP-58-61 asked this dashboard for the surcharge position, the split
            between what developers are owed and what buyers owe, and the age of
            that money. All four came from the same figures the cards above use. */}
        <div style={{ cursor: 'pointer' }} onClick={() => navigate('/reia/invoices')}>
          <StatCard
            label="LPS Recovered"
            value={fmtCurrency(kpis.lpsRecovered)}
            tone={kpis.lpsRecovered > 0 ? 'green' : 'default'}
            hint="Surcharge on bills since settled"
          />
        </div>
        <div style={{ cursor: 'pointer' }} onClick={() => navigate('/reia/invoices')}>
          <StatCard
            label="LPS Recoverable"
            value={fmtCurrency(kpis.lpsRecoverable)}
            tone={kpis.lpsRecoverable > 0 ? 'amber' : 'default'}
            hint={lps ? `${fmtCurrency(lps.receivable.accrued_unbilled + lps.payable.accrued_unbilled)} not yet billed` : undefined}
          />
        </div>
        <div style={{ cursor: 'pointer' }} onClick={() => navigate('/reia/invoices')}>
          <StatCard
            label="Pending to Developers"
            value={fmtCurrency(kpis.developerPending)}
            tone={kpis.developerPending > 0 ? 'amber' : 'default'}
            hint={pendingSplit ? `${pendingSplit.developer.invoices} bills · ${pendingSplit.developer.overdue_invoices} overdue` : undefined}
          />
        </div>
        <div style={{ cursor: 'pointer' }} onClick={() => navigate('/reia/invoices')}>
          <StatCard
            label="Pending from Buyers"
            value={fmtCurrency(kpis.buyerPending)}
            tone={kpis.buyerPending > 0 ? 'amber' : 'default'}
            hint={pendingSplit ? `${pendingSplit.buyer.invoices} bills · ${pendingSplit.buyer.overdue_invoices} overdue` : undefined}
          />
        </div>
        {/* The filing screen itself lives in the trading module and is guarded to
            it, so this card reports rather than navigates. */}
        <div>
          <StatCard
            label="CERC Form-IV"
            value={formIv?.latest_period ? `${formIv.latest_period} · ${formIv.latest_status}` : 'Nothing filed'}
            tone={kpis.formIvOverdue > 0 ? 'red' : kpis.formIvPending > 0 ? 'amber' : 'green'}
            hint={formIv
              ? `${kpis.formIvPending} pending${kpis.formIvOverdue ? `, ${kpis.formIvOverdue} past due` : ''}${formIv.open_breaches ? ` · ${formIv.open_breaches} margin breaches` : ''}`
              : undefined}
          />
        </div>
      </div>

      {ageing && (
        <Card title="Outstanding by age">
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Age</th>
                  <th scope="col" className="num">From buyers</th>
                  <th scope="col" className="num">Bills</th>
                  <th scope="col" className="num">To developers</th>
                  <th scope="col" className="num">Bills</th>
                </tr>
              </thead>
              <tbody>
                {ageing.receivable.map((row, i) => {
                  const pay = ageing.payable[i] || { amount: 0, invoices: 0 };
                  const late = row.bucket !== 'NOT_DUE';
                  return (
                    <tr key={row.bucket}>
                      <td style={late ? { fontWeight: 600 } : undefined}>{row.label}</td>
                      <td className="num">{fmtCurrency(row.amount)}</td>
                      <td className="num">{row.invoices}</td>
                      <td className="num">{fmtCurrency(pay.amount)}</td>
                      <td className="num">{pay.invoices}</td>
                    </tr>
                  );
                })}
                <tr className="totals-row">
                  <td>Total outstanding</td>
                  <td className="num">{fmtCurrency(kpis.receivables)}</td>
                  <td className="num">{pendingSplit?.buyer.invoices ?? ''}</td>
                  <td className="num">{fmtCurrency(kpis.payables)}</td>
                  <td className="num">{pendingSplit?.developer.invoices ?? ''}</td>
                </tr>
              </tbody>
            </table>
          </div>
          {lps && (lps.receivable.accrued_unbilled > 0 || lps.payable.accrued_unbilled > 0) && (
            <p className="report-count">
              Late payment surcharge of{' '}
              <strong>{fmtCurrency(lps.receivable.accrued_unbilled + lps.payable.accrued_unbilled)}</strong>{' '}
              has accrued on overdue bills at {lps.receivable.annual_pct}% a year and has not been raised on any
              invoice yet.
            </p>
          )}
        </Card>
      )}

      <div className="grid-2">
        <Card title="Monthly Billing Trend">
          <div className="chart-box">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={monthlyBilling}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="billing_period" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => `₹${(v / 1e7).toFixed(1)}Cr`} />
                <Tooltip formatter={(v) => fmtCurrency(v)} />
                <Legend />
                <Line type="monotone" dataKey="total" name="Billed Amount" stroke="var(--primary)" strokeWidth={2.5} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card title="Contracted Capacity by Project Type">
          <div className="chart-box">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={byProjectType} dataKey="capacity" nameKey="project_type" outerRadius={95} label={(e) => `${e.project_type} (${fmtNumber(e.capacity)} MW)`}>
                  {byProjectType.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip formatter={(v) => `${fmtNumber(v)} MW`} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <Card title="Invoices by Status">
        <div className="chart-box">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={byStatus}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="status" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="c" name="Invoice count" fill="#1f5cd6" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {showCapacityModal && (
        <Modal open={true} onClose={() => setShowCapacityModal(false)} title="Contracted Capacity Breakdown">
          <p style={{ marginBottom: 15, color: 'var(--slate-600)' }}>
            The total contracted capacity of <strong>{fmtNumber(kpis.contractedCapacity)} MW</strong> is aggregated from all active PPAs/PSAs currently managed by the REIA desk. Here is the breakdown by project type:
          </p>
          <Table 
            columns={[
              { key: 'project_type', label: 'Project Type' },
              { key: 'capacity', label: 'Capacity (MW)', format: (v) => fmtNumber(v) + ' MW', align: 'right' }
            ]} 
            data={byProjectType} 
          />
        </Modal>
      )}
    </div>
  );
}
