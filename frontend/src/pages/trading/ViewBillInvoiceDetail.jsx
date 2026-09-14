import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../api/client.js';
import { PageHeader, Card, Badge, fmtNumber } from '../../components/ui.jsx';
import { fmtDate, fmtDateTime } from '../../datetime.js';

// One invoice from the View Bills register, read back to its line items.
//
// This page used to be a printed-invoice replica with three real invoices in the
// source — client names, GSTINs, portfolio codes — keyed on a slug, and it fell
// back to showing the first one whenever the id did not match. A page that draws
// a tax invoice from data it invented is worse than no page: the document it puts
// on screen is not the document that was issued. The invoice as issued is the PDF
// the register generates, which the button below downloads; what is shown here is
// what the platform actually holds.

const money = (v) => (v == null ? '—' : `₹${fmtNumber(v, 2)}`);

// Which ledger a row belongs to, so "back" goes where the reader came from.
const LEDGER_PATH = {
  TRADING_MARGIN: '/invoices/trading-margin',
  EXCHANGE_OA: '/invoices/open-access',
  EXCHANGE_ENERGY: '/invoices/exchange-energy-settlement',
  BILATERAL_ENERGY: '/invoices/bilateral-energy-settlement',
  BILATERAL_SLDC: '/invoices/bilateral-sldc-consent',
  BILATERAL_OA: '/invoices/bilateral-open-access',
};

function Facts({ rows }) {
  return (
    <div className="table-wrap">
      <table className="data-table">
        <tbody>
          {rows.map(([label, value]) => (
            <tr key={label}>
              <th scope="row" style={{ width: '34%', textAlign: 'left' }}>{label}</th>
              <td>{value == null || value === '' ? '—' : value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The itemised lines a generated bill carries, if it was generated. */
function breakupLines(invoice) {
  if (!invoice?.breakup_json) return [];
  try {
    const parsed = JSON.parse(invoice.breakup_json);
    return Array.isArray(parsed) ? parsed : parsed?.lines || [];
  } catch {
    return [];
  }
}

export default function ViewBillInvoiceDetail() {
  const { id } = useParams();
  const [invoice, setInvoice] = useState(null);
  const [notes, setNotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError('');
    api.viewBillInvoices.get(id)
      .then((inv) => {
        if (!live) return;
        setInvoice(inv);
        return api.tradingNotes.list({ view_bill_invoice_id: inv.id })
          .then((n) => { if (live) setNotes(Array.isArray(n) ? n : []); })
          .catch(() => { if (live) setNotes([]); });
      })
      .catch((err) => {
        if (!live) return;
        setInvoice(null);
        setError(err?.response?.status === 404
          ? `No invoice on record with reference ${id}.`
          : err?.response?.data?.error || 'Could not load this invoice.');
      })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [id]);

  async function downloadPdf() {
    setBusy(true);
    try {
      const blob = await api.viewBillInvoices.downloadPdf(invoice.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${invoice.invoice_no || invoice.id}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err?.response?.data?.error || 'PDF download failed.');
    } finally {
      setBusy(false);
    }
  }

  const lines = breakupLines(invoice);

  return (
    <div className="page">
      <PageHeader
        title={invoice?.invoice_no || 'Invoice'}
        subtitle="As the View Bills register holds it"
        actions={(
          <div style={{ display: 'flex', gap: 8 }}>
            <Link className="btn btn-outline" to={LEDGER_PATH[invoice?.bill_type] || '/billing/view-bills'}>
              Back to the ledger
            </Link>
            {invoice && (
              <button type="button" className="btn btn-primary" disabled={busy} onClick={downloadPdf}>
                {busy ? 'Preparing…' : 'Download the invoice PDF'}
              </button>
            )}
          </div>
        )}
      />

      {error && <div className="alert alert-error" role="alert">{error}</div>}

      {loading ? (
        <Card><div className="audit-placeholder">Loading the invoice…</div></Card>
      ) : !invoice ? null : (
        <>
          {invoice.status === 'CANCELLED' && (
            <div className="alert alert-warning" role="status">
              This invoice was cancelled{invoice.cancel_reason ? `: ${invoice.cancel_reason}` : '.'}
            </div>
          )}

          <Card title="Invoice">
            <Facts rows={[
              ['Client', invoice.client_name],
              ['Invoice No.', invoice.invoice_no],
              ['Bill Type', invoice.bill_type],
              ['Invoice Date', invoice.invoice_date ? fmtDate(invoice.invoice_date) : null],
              ['Due Date', invoice.invoice_due_date ? fmtDate(invoice.invoice_due_date) : null],
              ['Period of Supply', invoice.supply_from_date
                ? `${fmtDate(invoice.supply_from_date)} to ${fmtDate(invoice.supply_to_date || invoice.supply_from_date)}`
                : null],
              ['Generated On', invoice.invoice_generated_on ? fmtDateTime(invoice.invoice_generated_on) : null],
              ['Invoice Amount', money(invoice.invoice_amount)],
              ['Quantum', invoice.quantum_mwh != null ? `${fmtNumber(invoice.quantum_mwh, 3)} MWh` : null],
              ['Rate', invoice.rate_per_unit != null ? `₹${fmtNumber(invoice.rate_per_unit, 4)} / kWh` : null],
              ['GST', invoice.gst_amount != null ? money(invoice.gst_amount) : null],
              ['Settlement Basis', invoice.settlement_basis
                ? <Badge type={invoice.settlement_basis === 'FINAL' ? 'success' : 'warning'}>{invoice.settlement_basis}</Badge>
                : null],
              ['Status', <Badge status={invoice.status}>{invoice.status}</Badge>],
              ['Remarks', invoice.remarks],
            ]} />
          </Card>

          <Card title="What it is billed for">
            {lines.length === 0 ? (
              <div className="audit-placeholder">
                This invoice was entered by hand, so it carries no itemised breakup — only the amount above.
              </div>
            ) : (
              <div className="report-table-wrap">
                <table className="report-table">
                  <thead>
                    <tr>
                      <th scope="col">Description</th>
                      <th scope="col">Basis</th>
                      <th scope="col" className="num">Quantity</th>
                      <th scope="col" className="num">Rate</th>
                      <th scope="col" className="num">Amount (Rs.)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l, i) => (
                      <tr key={`${l.description}-${i}`}>
                        <td>{l.description}</td>
                        <td>{l.basis || '—'}</td>
                        <td className="num">{l.quantity != null ? fmtNumber(l.quantity, 3) : '—'}</td>
                        <td className="num">{l.rate != null ? fmtNumber(l.rate, 4) : '—'}</td>
                        <td className="num">{money(l.amount)}</td>
                      </tr>
                    ))}
                    <tr className="totals-row">
                      <td colSpan={4}>Invoice amount</td>
                      <td className="num">{money(invoice.invoice_amount)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {invoice.received_amount != null && (
            <Card title="Payment received">
              <Facts rows={[
                ['Received', money(invoice.received_amount)],
                ['Date of Payment', invoice.payment_date ? fmtDate(invoice.payment_date) : null],
                ['TDS', invoice.tds_rate != null ? `${fmtNumber(invoice.tds_rate, 2)}% · ${money(invoice.tds_deducted)}` : null],
                ['Bank', invoice.bank_name],
              ]} />
            </Card>
          )}

          {notes.length > 0 && (
            <Card title="Debit / credit notes">
              <div className="report-table-wrap">
                <table className="report-table">
                  <thead>
                    <tr>
                      <th scope="col">Note No.</th>
                      <th scope="col">Type</th>
                      <th scope="col" className="num">Amount (Rs.)</th>
                      <th scope="col">Reason</th>
                      <th scope="col">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {notes.map((n) => (
                      <tr key={n.id}>
                        <td>{n.note_no}</td>
                        <td>{n.note_type}</td>
                        <td className="num">{money(n.amount)}</td>
                        <td>{n.reason || '—'}</td>
                        <td><Badge status={n.status}>{n.status}</Badge></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
