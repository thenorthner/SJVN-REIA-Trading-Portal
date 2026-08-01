import React, { useState, useEffect } from 'react';
import { PortfolioSelect, usePortfolios } from '../../context/PortfolioContext.jsx';
import { api } from '../../api/client.js';
import { PageHeader, Card, Badge } from '../../components/ui.jsx';

export default function BankTransactionsList() {
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(false);
  
  // Filter States
  const [portfolio, setPortfolio] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [van, setVan] = useState('');
  const [utr, setUtr] = useState('');

  // Portfolio options come from the shared trading-client list.

  const fetchTransactions = async () => {
    setLoading(true);
    try {
      const params = {};
      if (portfolio) params.portfolio = portfolio;
      if (fromDate) params.from_date = fromDate;
      if (toDate) params.to_date = toDate;
      if (van) params.van = van;
      if (utr) params.utr = utr;

      setTransactions(await api.tradingOps.bankTransactions(params));
    } catch (err) {
      console.error('Failed to fetch transactions', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTransactions();
  }, []);

  const getReconBadge = (status) => {
    switch (status) {
      case 'MATCHED': return <Badge variant="success">🟢 Matched & Applied</Badge>;
      case 'PENDING': return <Badge variant="warning">🟡 Pending Verification</Badge>;
      case 'UNRECONCILED': return <Badge variant="danger">🔴 Unreconciled / Amount Mismatch</Badge>;
      default: return <Badge>{status}</Badge>;
    }
  };

  const getSapBadge = (status, voucher) => {
    switch (status) {
      case 'SYNCED': return <Badge variant="info">Synced to SAP {voucher}</Badge>;
      case 'PENDING': return <Badge variant="secondary">Pending Sync</Badge>;
      case 'FAILED': return <Badge variant="danger">Sync Failed</Badge>;
      default: return null;
    }
  };

  return (
    <div style={{ padding: 20, maxWidth: 1400, margin: '0 auto' }}>
      <PageHeader title="BANK TRANSACTION LIST (Ledger)" />

      <Card style={{ marginBottom: 20, background: '#f5f7f9' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 15, alignItems: 'end' }}>
          
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 'bold', marginBottom: 5 }} htmlFor="banktransactionslist-portfolio-name">Portfolio Name:</label>
            <PortfolioSelect id="banktransactionslist-portfolio-name" includeAll value={portfolio} onChange={setPortfolio} />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 'bold', marginBottom: 5 }} htmlFor="banktransactionslist-from-date">From Date:</label>
            <input id="banktransactionslist-from-date" type="date" className="input" value={fromDate} onChange={e => setFromDate(e.target.value)} />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 'bold', marginBottom: 5 }} htmlFor="banktransactionslist-to-date">To Date:</label>
            <input id="banktransactionslist-to-date" type="date" className="input" value={toDate} onChange={e => setToDate(e.target.value)} />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 'bold', marginBottom: 5 }} htmlFor="banktransactionslist-virtual-account-number">Virtual Account Number:</label>
            <input id="banktransactionslist-virtual-account-number" type="text" className="input" value={van} onChange={e => setVan(e.target.value)} placeholder="VAN-SJVN-..." />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 'bold', marginBottom: 5 }} htmlFor="banktransactionslist-utr-no">UTR NO:</label>
            <input id="banktransactionslist-utr-no" type="text" className="input" value={utr} onChange={e => setUtr(e.target.value)} placeholder="Search by UTR" />
          </div>

        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 15, justifyContent: 'flex-end' }}>
          <button className="btn btn-primary" onClick={fetchTransactions} disabled={loading}>
            {loading ? 'Searching...' : '[ Search ]'}
          </button>
          <button className="btn" style={{ background: '#28a745', color: '#fff' }} onClick={() => alert('Not available yet — Excel export is not built for this screen.')}>
            [ EXCEL v ] Export File
          </button>
        </div>
      </Card>

      <Card>
        <table className="table" style={{ width: '100%' }}>
          <thead>
            <tr style={{ background: '#e9ecef' }}>
              <th scope="col">Date & Time</th>
              <th scope="col">Portfolio ID</th>
              <th scope="col">Virtual Account No</th>
              <th scope="col">UTR No</th>
              <th scope="col" style={{ textAlign: 'right' }}>Amount (₹)</th>
              <th scope="col">Reconciliation Status</th>
              <th scope="col">SAP Integration</th>
            </tr>
          </thead>
          <tbody>
            {transactions.length === 0 ? (
              <tr>
                <td colSpan="7" style={{ textAlign: 'center', padding: 40, color: '#888' }}>
                  Nothing found to display. Try adjusting your filters.
                </td>
              </tr>
            ) : (
              transactions.map(tx => (
                <tr key={tx.id}>
                  <td>{new Date(tx.transaction_date).toLocaleString()}</td>
                  <td style={{ fontWeight: 500 }}>{tx.portfolio_id}</td>
                  <td style={{ fontFamily: 'monospace' }}>{tx.van}</td>
                  <td style={{ fontFamily: 'monospace', color: '#0056b3' }}>{tx.utr_no}</td>
                  <td style={{ textAlign: 'right', fontWeight: 'bold' }}>
                    {tx.amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </td>
                  <td>{getReconBadge(tx.recon_status)}</td>
                  <td>{getSapBadge(tx.sap_sync_status, tx.sap_voucher_no)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
