import React, { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { api } from '../../api/client.js';
import { Modal, Field, Card, fmtNumber } from '../../components/ui.jsx';

function fmtDisplayDate(iso) {
  if (!iso) return '';
  // Accept already-formatted ISET strings or YYYY-MM-DD
  if (/[A-Za-z]/.test(iso) && iso.includes('-')) return iso;
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${String(d.getDate()).padStart(2, '0')}-${months[d.getMonth()]}-${d.getFullYear()}`;
}

function fmtGenerated(s) {
  if (!s) return '';
  if (s.includes(' ') && /[A-Za-z]/.test(s)) return s;
  const [datePart, timePart] = String(s).split(/[ T]/);
  const date = fmtDisplayDate(datePart);
  if (!timePart) return date;
  const tm = timePart.slice(0, 5).replace(':', ' ');
  return `${date} ${tm}`;
}

function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

const BASE_EXPORT_KEYS = [
  ['#', '_row'],
  ['Client Name', 'client_name'],
  ['Invoice No', 'invoice_no'],
  ['Invoice Amount(INR)', 'invoice_amount'],
  ['Invoice Date', 'invoice_date'],
  ['Invoice Due Date', 'invoice_due_date'],
  ['Supply From Date', 'supply_from_date'],
  ['Supply To Date', 'supply_to_date'],
  ['Invoice Generated On', 'invoice_generated_on'],
];

const PAYMENT_EXPORT_KEYS = [
  ['Received Amount (Rs.)', 'received_amount'],
  ['Date of Payment', 'payment_date'],
  ['TDS Rate(%)', 'tds_rate'],
  ['TDS Deducted (Rs)', 'tds_deducted'],
  ['Bank Name', 'bank_name'],
  ['Remarks', 'remarks'],
];

/**
 * Shared ISET View Bills ledger (CSV / Excel / PDF + search + View/Edit/Cancel).
 * @param {{ billType?: string, title: string, showPaymentColumns?: boolean, product?: string, embedded?: boolean }} props
 */
export default function ViewBillInvoiceLedger({ billType, title, showPaymentColumns = false, product = null, embedded = false }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState('invoice_date');
  const [sortDir, setSortDir] = useState('desc');
  const [editRow, setEditRow] = useState(null);
  const [payRow, setPayRow] = useState(null);
  const [viewRow, setViewRow] = useState(null);
  const [form, setForm] = useState({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [notes, setNotes] = useState([]);

  function load() {
    setLoading(true);
    const params = {};
    if (billType) params.bill_type = billType;
    if (product) params.product = product;
    api.viewBillInvoices.list(params)
      .then(setRows)
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }

  useEffect(load, [billType, product]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = rows;
    if (q) {
      list = rows.filter((r) => [
        r.client_name, r.invoice_no, r.remarks, r.bank_name,
        fmtDisplayDate(r.invoice_date), String(r.invoice_amount),
      ].join(' ').toLowerCase().includes(q));
    }
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...list].sort((a, b) => {
      const av = a[sortKey] ?? '';
      const bv = b[sortKey] ?? '';
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
  }, [rows, search, sortKey, sortDir]);

  function toggleSort(key) {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('asc'); }
  }

  // Counter + nine invoice columns + five actions, plus the six payment columns
  // and the payment action when this ledger shows them.
  const colCount = showPaymentColumns ? 21 : 14;

  function exportKeys() {
    return showPaymentColumns ? [...BASE_EXPORT_KEYS, ...PAYMENT_EXPORT_KEYS] : BASE_EXPORT_KEYS;
  }

  function rowsForExport() {
    return filtered.map((r, i) => {
      const out = {};
      for (const [label, key] of exportKeys()) {
        if (key === '_row') out[label] = i + 1;
        else if (key.includes('date') || key === 'invoice_generated_on') {
          out[label] = key === 'invoice_generated_on' ? fmtGenerated(r[key]) : fmtDisplayDate(r[key]);
        } else if (key === 'invoice_amount' || key === 'received_amount' || key === 'tds_deducted') {
          out[label] = r[key] == null ? '' : Number(r[key]).toFixed(2);
        } else out[label] = r[key] ?? '';
      }
      return out;
    });
  }

  function exportCsv() {
    const data = rowsForExport();
    const header = Object.keys(data[0] || { '#': '', 'Client Name': '', 'Invoice No': '' });
    const lines = [
      header.join(','),
      ...data.map((row) => header.map((h) => `"${String(row[h] ?? '').replace(/"/g, '""')}"`).join(',')),
    ];
    downloadBlob(`${String(billType || 'invoices').toLowerCase()}-${new Date().toISOString().slice(0, 10)}.csv`, new Blob([lines.join('\n')], { type: 'text/csv' }));
  }

  function exportExcel() {
    const data = rowsForExport();
    const sheet = XLSX.utils.json_to_sheet(data.length ? data : [{ '#': '', 'Client Name': '', 'Invoice No': '' }]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheet, 'Invoices');
    XLSX.writeFile(wb, `${String(billType || 'invoices').toLowerCase()}-${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  function exportPdf() {
    const data = rowsForExport();
    const keys = exportKeys().map(([l]) => l);
    const w = window.open('', '_blank');
    if (!w) return;
    const head = keys.map((k) => `<th>${k}</th>`).join('');
    const body = data.map((r) => `<tr>${keys.map((k) => `<td>${r[k] ?? ''}</td>`).join('')}</tr>`).join('');
    w.document.write(`<!doctype html><html><head><title>${title}</title>
      <style>body{font-family:Arial,sans-serif;padding:20px;font-size:10px}
      table{width:100%;border-collapse:collapse} th{background:#101a2e;color:#fff;padding:6px;text-align:left}
      td{border-bottom:1px solid #ddd;padding:6px}</style></head><body>
      <h1>${title}</h1><table><thead><tr>${head}</tr></thead><tbody>${body || '<tr><td colspan="9">No data</td></tr>'}</tbody></table>
      </body></html>`);
    w.document.close();
    w.focus();
    w.print();
  }

  function openEdit(r) {
    setEditRow(r);
    setForm({
      client_name: r.client_name,
      invoice_amount: r.invoice_amount,
      invoice_date: r.invoice_date,
      invoice_due_date: r.invoice_due_date || '',
      supply_from_date: r.supply_from_date || '',
      supply_to_date: r.supply_to_date || '',
      remarks: r.remarks || '',
    });
  }

  function openPay(r) {
    setPayRow(r);
    setForm({
      received_amount: r.received_amount ?? '',
      payment_date: r.payment_date || '',
      tds_rate: r.tds_rate ?? '',
      tds_deducted: r.tds_deducted ?? '',
      bank_name: r.bank_name || 'SBI',
      remarks: r.remarks || '',
    });
  }

  async function openView(r) {
    setViewRow(r);
    try {
      const [full, rowNotes] = await Promise.all([
        api.viewBillInvoices.get(r.id),
        api.tradingNotes.list({ view_bill_invoice_id: r.id }),
      ]);
      setViewRow(full);
      setNotes(rowNotes);
    } catch {
      setNotes([]);
    }
  }

  async function downloadInvoicePdf(r) {
    try {
      const blob = await api.viewBillInvoices.downloadPdf(r.id);
      downloadBlob(`${r.invoice_no || r.id}.pdf`, blob);
    } catch (err) {
      setMessage(err.response?.data?.error || 'PDF download failed');
    }
  }

  async function raiseNote(r) {
    const note_type = window.prompt('Enter note type: DEBIT or CREDIT', 'DEBIT');
    if (!note_type || !['DEBIT', 'CREDIT'].includes(note_type.toUpperCase())) return;
    const amount = Number(window.prompt('Enter note amount', '0'));
    if (!Number.isFinite(amount) || amount <= 0) return;
    const reason = window.prompt('Enter reason / remarks', '') || '';
    try {
      await api.tradingNotes.create({
        note_type: note_type.toUpperCase(),
        amount,
        reason,
        reason_code: 'RATE_REVISION',
        client_id: r.client_id || r.clientId || null,
        billing_period: String(r.supply_from_date || r.invoice_date || '').slice(0, 7),
        delivery_date: r.supply_from_date || null,
        quantum_mwh: r.quantum_mwh ?? null,
        rate_per_unit: r.rate_per_unit ?? null,
        view_bill_invoice_id: r.id,
      });
      setMessage(`Note issued for ${r.invoice_no}`);
      if (viewRow?.id === r.id) openView(r);
    } catch (err) {
      setMessage(err.response?.data?.error || 'Failed to issue note');
    }
  }

  async function cancelNote(note) {
    const reason = window.prompt('Cancellation reason', 'Superseded / entered by mistake');
    if (!reason) return;
    try {
      await api.tradingNotes.cancel(note.id, { reason });
      if (viewRow) openView(viewRow);
    } catch (err) {
      setMessage(err.response?.data?.error || 'Failed to cancel note');
    }
  }

  async function saveEdit(e) {
    e.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      await api.viewBillInvoices.update(editRow.id, form);
      setEditRow(null);
      setMessage(`Updated ${editRow.invoice_no}`);
      load();
    } catch (err) {
      setMessage(err.response?.data?.error || 'Update failed');
    } finally {
      setBusy(false);
    }
  }

  async function savePay(e) {
    e.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      await api.viewBillInvoices.recordPayment(payRow.id, form);
      setPayRow(null);
      setMessage(`Payment saved for ${payRow.invoice_no}`);
      load();
    } catch (err) {
      setMessage(err.response?.data?.error || 'Payment save failed');
    } finally {
      setBusy(false);
    }
  }

  async function cancelInv(r) {
    if (!window.confirm(`Cancel invoice ${r.invoice_no}?`)) return;
    const reason = window.prompt('Cancellation reason', '');
    if (reason == null) return;
    setMessage('');
    try {
      await api.viewBillInvoices.cancel(r.id, { reason });
      setMessage(`Cancelled ${r.invoice_no}`);
      load();
    } catch (err) {
      setMessage(err.response?.data?.error || 'Cancel failed');
    }
  }

  // The grid, its navy header and its export strip are the shared .report-*
  // chrome every other report screen uses, so this ledger and an ERP format
  // report look like one system.
  // A function that returns a <th>, not a component declared in here: a nested
  // component is a new type on every render, so React would throw away and
  // rebuild the whole header row each time the sort or the search changed.
  const sortTh = (k, label, className = '') => {
    const on = sortKey === k;
    return (
      <th
        key={label}
        scope="col"
        className={`sortable${on ? ' sorted' : ''}${className ? ` ${className}` : ''}`}
        onClick={() => toggleSort(k)}
        aria-sort={on ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
      >
        {label}
        <span className="sort-arrow">{on && sortDir === 'desc' ? '▼' : '▲'}</span>
      </th>
    );
  };

  return (
    <div className={embedded ? undefined : 'report-shell'}>
      <div className="form-section-header" style={{ marginTop: 0 }}>{title}</div>
      <Card>
        <div className="report-toolbar">
          <div className="export-group">
            <button type="button" className="btn btn-sm btn-navy" onClick={exportCsv}>CSV</button>
            <button type="button" className="btn btn-sm btn-navy" onClick={exportExcel}>Excel</button>
            <button type="button" className="btn btn-sm btn-navy" onClick={exportPdf}>PDF</button>
          </div>
          <label className="report-search">
            Search:
            <input
              type="search"
              className="input"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter these invoices"
            />
          </label>
        </div>

        {message && <div className="alert alert-success" role="status">{message}</div>}

        <div className="report-table-wrap">
          <table className="report-table">
            <thead>
              <tr>
                {/* A row counter, not a column of the data: nothing to sort by. */}
                <th scope="col" style={{ width: 64 }}>{showPaymentColumns ? 'S.No.' : '#'}</th>
                {sortTh('client_name', 'Client Name')}
                {sortTh('invoice_no', 'Invoice No')}
                {sortTh('invoice_amount', 'Invoice Amount(INR)', 'num')}
                {sortTh('invoice_date', 'Invoice Date')}
                {sortTh('invoice_due_date', 'Invoice Due Date')}
                {sortTh('supply_from_date', 'Supply From Date')}
                {sortTh('supply_to_date', 'Supply To Date')}
                {sortTh('invoice_generated_on', 'Invoice Generated On')}
                {showPaymentColumns && (
                  <>
                    <th scope="col" className="num">Received Amount (Rs.)</th>
                    <th scope="col">Date of Payment</th>
                    <th scope="col" className="num">TDS Rate(%)</th>
                    <th scope="col" className="num">TDS Deducted (Rs)</th>
                    <th scope="col">Bank Name</th>
                    <th scope="col">Remarks</th>
                  </>
                )}
                <th scope="col">View</th>
                {showPaymentColumns && <th scope="col">Payment Details</th>}
                <th scope="col">Edit</th>
                <th scope="col">PDF</th>
                <th scope="col">Note</th>
                <th scope="col">Cancel</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td className="empty-cell" colSpan={colCount}>Loading invoices…</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td className="empty-cell" colSpan={colCount}>No data available in table</td></tr>
              ) : filtered.map((r, i) => (
                <tr key={r.id}>
                  <td>{i + 1}</td>
                  <td>{r.client_name}</td>
                  <td>{r.invoice_no}</td>
                  <td className="num">{fmtNumber(r.invoice_amount, 2)}</td>
                  <td>{fmtDisplayDate(r.invoice_date)}</td>
                  <td>{fmtDisplayDate(r.invoice_due_date)}</td>
                  <td>{fmtDisplayDate(r.supply_from_date)}</td>
                  <td>{fmtDisplayDate(r.supply_to_date)}</td>
                  <td>{fmtGenerated(r.invoice_generated_on)}</td>
                  {showPaymentColumns && (
                    <>
                      <td className="num">{r.received_amount != null ? fmtNumber(r.received_amount, 0) : ''}</td>
                      <td>{fmtDisplayDate(r.payment_date)}</td>
                      <td className="num">{r.tds_rate != null ? r.tds_rate : ''}</td>
                      <td className="num">{r.tds_deducted != null ? fmtNumber(r.tds_deducted, 1) : ''}</td>
                      <td>{r.bank_name || ''}</td>
                      <td title={r.remarks || ''}>{r.remarks || ''}</td>
                    </>
                  )}
                  <td>
                    <button type="button" className="btn-link" onClick={() => openView(r)} title={`View ${r.invoice_no}`}>View</button>
                  </td>
                  {showPaymentColumns && (
                    <td>
                      {r.received_amount != null ? '—' : (
                        <button type="button" className="btn-link" onClick={() => openPay(r)}>Payment Details</button>
                      )}
                    </td>
                  )}
                  <td>
                    <button type="button" className="btn-link" onClick={() => openEdit(r)}>Edit</button>
                  </td>
                  <td>
                    <button type="button" className="btn-link" onClick={() => downloadInvoicePdf(r)}>PDF</button>
                  </td>
                  <td>
                    <button type="button" className="btn-link" onClick={() => raiseNote(r)}>Note</button>
                  </td>
                  <td>
                    <button type="button" className="btn-link" onClick={() => cancelInv(r)}>Cancel</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="report-count">
          Showing {filtered.length} of {rows.length} {rows.length === 1 ? 'invoice' : 'invoices'}
          {search.trim() && rows.length !== filtered.length ? ' (filtered)' : ''}.
        </p>
      </Card>

      {viewRow && (
        <Modal open onClose={() => setViewRow(null)} title={viewRow.invoice_no} width={560}>
          <div style={{ fontSize: 13, lineHeight: 1.7 }}>
            <div><strong>Client:</strong> {viewRow.client_name}</div>
            <div><strong>Amount:</strong> ₹{fmtNumber(viewRow.invoice_amount, 2)}</div>
            <div><strong>Invoice Date:</strong> {fmtDisplayDate(viewRow.invoice_date)}</div>
            <div><strong>Due Date:</strong> {fmtDisplayDate(viewRow.invoice_due_date)}</div>
            <div><strong>Supply:</strong> {fmtDisplayDate(viewRow.supply_from_date)} → {fmtDisplayDate(viewRow.supply_to_date)}</div>
            <div><strong>Generated:</strong> {fmtGenerated(viewRow.invoice_generated_on)}</div>
            {viewRow.quantum_mwh != null && (
              <div><strong>Quantum:</strong> {fmtNumber(viewRow.quantum_mwh, 3)} MWh</div>
            )}
            {viewRow.rate_per_unit != null && (
              <div><strong>Rate:</strong> ₹{fmtNumber(viewRow.rate_per_unit, 4)}/kWh</div>
            )}
            {viewRow.gst_amount != null && Number(viewRow.gst_amount) !== 0 && (
              <div><strong>GST:</strong> ₹{fmtNumber(viewRow.gst_amount, 2)}</div>
            )}
            {viewRow.settlement_basis && (
              <div><strong>Settlement:</strong> {viewRow.settlement_basis}</div>
            )}
            <div><strong>Status:</strong> {viewRow.status}</div>
            {viewRow.supersedes_invoice_id && <div><strong>Replaces:</strong> {viewRow.supersedes_invoice_id}</div>}
            {viewRow.superseded_by_invoice_id && <div><strong>Replaced By:</strong> {viewRow.superseded_by_invoice_id}</div>}
            {viewRow.cancel_reason && <div><strong>Cancel Reason:</strong> {viewRow.cancel_reason}</div>}
            {viewRow.received_amount != null && (
              <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid #e2e8f0' }}>
                <div><strong>Received:</strong> ₹{fmtNumber(viewRow.received_amount, 2)}</div>
                <div><strong>Payment Date:</strong> {fmtDisplayDate(viewRow.payment_date)}</div>
                <div><strong>TDS:</strong> {viewRow.tds_rate}% · ₹{fmtNumber(viewRow.tds_deducted, 2)}</div>
                <div><strong>Bank:</strong> {viewRow.bank_name}</div>
                <div><strong>Remarks:</strong> {viewRow.remarks || '—'}</div>
              </div>
            )}
            <div style={{ marginTop: 12, paddingTop: 8, borderTop: '1px solid #e2e8f0' }}>
              <div><strong>Debit / Credit Notes</strong></div>
              {notes.length ? notes.map((n) => (
                <div key={n.id} style={{ marginTop: 6 }}>
                  {n.note_no} · {n.note_type} · ₹{fmtNumber(n.amount, 2)} · {n.status}
                  {n.status !== 'CANCELLED' && (
                    <>
                      {' '}<button type="button" className="btn-link" onClick={() => cancelNote(n)}>Cancel</button>
                    </>
                  )}
                </div>
              )) : <div style={{ color: '#64748b' }}>No notes raised.</div>}
            </div>
          </div>
        </Modal>
      )}

      {editRow && (
        <Modal open onClose={() => setEditRow(null)} title={`Edit · ${editRow.invoice_no}`} width={520}>
          <form onSubmit={saveEdit}>
            <div style={{ display: 'grid', gap: 12 }}>
              <Field label="Client Name"><input className="input" value={form.client_name} onChange={(e) => setForm({ ...form, client_name: e.target.value })} /></Field>
              <Field label="Invoice Amount"><input type="number" step="any" className="input" value={form.invoice_amount} onChange={(e) => setForm({ ...form, invoice_amount: e.target.value })} /></Field>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <Field label="Invoice Date"><input type="date" className="input" value={form.invoice_date} onChange={(e) => setForm({ ...form, invoice_date: e.target.value })} /></Field>
                <Field label="Due Date"><input type="date" className="input" value={form.invoice_due_date} onChange={(e) => setForm({ ...form, invoice_due_date: e.target.value })} /></Field>
                <Field label="Supply From"><input type="date" className="input" value={form.supply_from_date} onChange={(e) => setForm({ ...form, supply_from_date: e.target.value })} /></Field>
                <Field label="Supply To"><input type="date" className="input" value={form.supply_to_date} onChange={(e) => setForm({ ...form, supply_to_date: e.target.value })} /></Field>
              </div>
              <Field label="Remarks"><input className="input" value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} /></Field>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
              <button type="button" className="btn btn-outline" onClick={() => setEditRow(null)}>Close</button>
              <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
            </div>
          </form>
        </Modal>
      )}

      {payRow && (
        <Modal open onClose={() => setPayRow(null)} title={`Payment Details · ${payRow.invoice_no}`} width={480}>
          <form onSubmit={savePay}>
            <div style={{ display: 'grid', gap: 12 }}>
              <Field label="Received Amount (Rs.)"><input type="number" step="any" className="input" value={form.received_amount} onChange={(e) => setForm({ ...form, received_amount: e.target.value })} required /></Field>
              <Field label="Date of Payment"><input type="date" className="input" value={form.payment_date} onChange={(e) => setForm({ ...form, payment_date: e.target.value })} required /></Field>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <Field label="TDS Rate (%)"><input type="number" step="any" className="input" value={form.tds_rate} onChange={(e) => setForm({ ...form, tds_rate: e.target.value })} /></Field>
                <Field label="TDS Deducted (Rs)"><input type="number" step="any" className="input" value={form.tds_deducted} onChange={(e) => setForm({ ...form, tds_deducted: e.target.value })} /></Field>
              </div>
              <Field label="Bank Name"><input className="input" value={form.bank_name} onChange={(e) => setForm({ ...form, bank_name: e.target.value })} /></Field>
              <Field label="Remarks"><input className="input" value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} /></Field>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
              <button type="button" className="btn btn-outline" onClick={() => setPayRow(null)}>Close</button>
              <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save Payment'}</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
