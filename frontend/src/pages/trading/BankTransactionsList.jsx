import React, { useState, useEffect } from 'react';
import { PortfolioSelect, usePortfolios } from '../../context/PortfolioContext.jsx';
import { api } from '../../api/client.js';
import { PageHeader, Card, Badge } from '../../components/ui.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { ROLE_GROUPS } from '../../roles.js';
import { showAlert } from '../../lib/dialogs.js';

const RECEIPT_COLUMNS = ['utr_no', 'van', 'amount', 'transaction_date', 'portfolio_id'];

/** Pasted statement lines (tab or comma separated, header optional) -> receipt rows. */
export function parseReceipts(text) {
  const lines = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const rows = lines.map((l) => l.split(l.includes('\t') ? '\t' : ',').map((c) => c.trim()));
  if (rows.length && /^utr/i.test(rows[0][0] || '')) rows.shift();
  return rows.map((cells) => Object.fromEntries(RECEIPT_COLUMNS.map((k, i) => [k, cells[i] ?? ''])));
}

export default function BankTransactionsList() {
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(false);
  const { user } = useAuth();
  const canWrite = ROLE_GROUPS.TRADING_WRITE.includes(user?.role);

  // Receipts: paste a statement, each line is credited to the client its VAN names.
  const [receiptText, setReceiptText] = useState('');
  const [receiptResults, setReceiptResults] = useState(null);
  const [receiptBusy, setReceiptBusy] = useState(false);
  const [receiptError, setReceiptError] = useState('');
  const [clients, setClients] = useState([]);
  const [matchTo, setMatchTo] = useState({});
  
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
  useEffect(() => {
    if (canWrite) api.tradingClients.list({ status: 'ACTIVE' }).then(setClients).catch(() => {});
  }, [canWrite]);

  async function submitReceipts() {
    setReceiptError('');
    const rows = parseReceipts(receiptText);
    if (!rows.length) { setReceiptError('Paste at least one line: UTR, virtual account no., amount, date, portfolio (optional).'); return; }
    setReceiptBusy(true);
    try {
      const res = await api.tradingOps.recordReceipts({ rows });
      setReceiptResults(res.results);
      setReceiptText('');
      fetchTransactions();
    } catch (err) {
      setReceiptError(err.response?.data?.error || 'Could not record the receipts.');
    } finally {
      setReceiptBusy(false);
    }
  }

  async function creditToClient(tx) {
    const clientId = matchTo[tx.id];
    if (!clientId) return;
    try {
      await api.tradingOps.applyReceipt(tx.id, clientId);
      fetchTransactions();
    } catch (err) {
      showAlert(err.response?.data?.error || 'Could not credit this receipt.');
    }
  }

  const getReconBadge = (status) => {
    switch (status) {
      case 'MATCHED': return <Badge variant="success">Matched & Applied</Badge>;
      case 'PENDING': return <Badge variant="warning">Pending Verification</Badge>;
      case 'UNRECONCILED': return <Badge variant="danger">Unreconciled / Amount Mismatch</Badge>;
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
    <div style={{ padding: 20 }}>
      <PageHeader title="BANK TRANSACTION LIST (Ledger)" />

      <Card style={{ marginBottom: 20, background: 'var(--slate-50)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 15, alignItems: 'end' }}>
          
          <div>
            <label style={{ display: 'block', fontSize: 15, fontWeight: 'bold', marginBottom: 5 }} htmlFor="banktransactionslist-portfolio-name">Portfolio Name:</label>
            <PortfolioSelect id="banktransactionslist-portfolio-name" includeAll value={portfolio} onChange={setPortfolio} />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 15, fontWeight: 'bold', marginBottom: 5 }} htmlFor="banktransactionslist-from-date">From Date:</label>
            <input id="banktransactionslist-from-date" type="date" className="input" value={fromDate} onChange={e => setFromDate(e.target.value)} />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 15, fontWeight: 'bold', marginBottom: 5 }} htmlFor="banktransactionslist-to-date">To Date:</label>
            <input id="banktransactionslist-to-date" type="date" className="input" value={toDate} onChange={e => setToDate(e.target.value)} />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 15, fontWeight: 'bold', marginBottom: 5 }} htmlFor="banktransactionslist-virtual-account-number">Virtual Account Number:</label>
            <input id="banktransactionslist-virtual-account-number" type="text" className="input" value={van} onChange={e => setVan(e.target.value)} placeholder="VAN-SJVN-..." />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 15, fontWeight: 'bold', marginBottom: 5 }} htmlFor="banktransactionslist-utr-no">UTR NO:</label>
            <input id="banktransactionslist-utr-no" type="text" className="input" value={utr} onChange={e => setUtr(e.target.value)} placeholder="Search by UTR" />
          </div>

        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 15, justifyContent: 'flex-end' }}>
          <button className="btn btn-primary" onClick={fetchTransactions} disabled={loading}>
            {loading ? 'Searching...' : '[ Search ]'}
          </button>
          <button className="btn" style={{ background: '#28a745', color: '#fff' }} onClick={() => showAlert('Not available yet — Excel export is not built for this screen.')}>
            [ EXCEL v ] Export File
          </button>
        </div>
      </Card>

      {canWrite && (
        <Card style={{ marginBottom: 20 }} title="Record bank receipts">
          <p style={{ fontSize: 14.5, color: 'var(--slate-600)', marginTop: 0 }}>
            Paste lines from the bank statement as <code>UTR, virtual account no., amount, date, portfolio (optional)</code>.
            A receipt whose virtual account belongs to a client is credited to that client's pre-payment straight away;
            the same UTR is never credited twice. Anything unmatched is kept below until you credit it to a client.
          </p>
          <label htmlFor="banktransactionslist-receipts" className="sr-only">Receipts to record</label>
          <textarea id="banktransactionslist-receipts" className="input" rows={4} style={{ width: '100%', fontFamily: 'monospace' }}
            value={receiptText} onChange={(e) => setReceiptText(e.target.value)}
            placeholder={'SBIN2610180001, VAN0001234, 250000, 2026-10-18'} />
          {receiptError && <div role="alert" style={{ color: 'var(--red-strong)', marginTop: 8, fontSize: 14.5 }}>{receiptError}</div>}
          <div style={{ marginTop: 10 }}>
            <button type="button" className="btn btn-primary" onClick={submitReceipts} disabled={receiptBusy || !receiptText.trim()}>
              {receiptBusy ? 'Recording...' : 'Record receipts'}
            </button>
          </div>
          {receiptResults && (
            <table className="table" style={{ width: '100%', marginTop: 12 }}>
              <thead><tr><th scope="col">Row</th><th scope="col">UTR</th><th scope="col">Result</th></tr></thead>
              <tbody>
                {receiptResults.map((r) => (
                  <tr key={r.row}>
                    <td>{r.row}</td>
                    <td style={{ fontFamily: 'monospace' }}>{r.utr_no || '-'}</td>
                    <td>
                      {r.outcome === 'APPLIED' && <Badge variant="success">{`Credited to ${r.client?.name}`}</Badge>}
                      {r.outcome === 'UNMATCHED' && <Badge variant="warning">No client matched — kept for matching</Badge>}
                      {r.outcome === 'DUPLICATE' && <Badge variant="secondary">Already recorded — not credited again</Badge>}
                      {r.outcome === 'REJECTED' && <Badge variant="danger">{r.error}</Badge>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}

      <Card>
        <table className="table" style={{ width: '100%' }}>
          <thead>
            <tr style={{ background: 'var(--slate-100)' }}>
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
                <td colSpan="7" style={{ textAlign: 'center', padding: 40, color: 'var(--slate-500)' }}>
                  Nothing found to display. Try adjusting your filters.
                </td>
              </tr>
            ) : (
              transactions.map(tx => (
                <tr key={tx.id}>
                  <td>{new Date(tx.transaction_date).toLocaleString()}</td>
                  <td style={{ fontWeight: 500 }}>{tx.portfolio_id}</td>
                  <td style={{ fontFamily: 'monospace' }}>{tx.van}</td>
                  <td style={{ fontFamily: 'monospace', color: 'var(--on-blue)' }}>{tx.utr_no}</td>
                  <td style={{ textAlign: 'right', fontWeight: 'bold' }}>
                    {tx.amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </td>
                  <td>
                    {getReconBadge(tx.recon_status)}
                    {canWrite && !tx.applied_at && (
                      <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                        <select className="input" aria-label={`Client for receipt ${tx.utr_no}`} value={matchTo[tx.id] || ''}
                          onChange={(e) => setMatchTo({ ...matchTo, [tx.id]: e.target.value })}>
                          <option value="">Credit to client…</option>
                          {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                        <button type="button" className="btn btn-outline" disabled={!matchTo[tx.id]} onClick={() => creditToClient(tx)}>Credit</button>
                      </div>
                    )}
                  </td>
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
