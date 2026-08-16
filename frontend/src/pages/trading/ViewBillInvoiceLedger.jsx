import React, { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { api } from '../../api/client.js';
import { Modal, Field, fmtNumber } from '../../components/ui.jsx';

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
 * @param {{ billType: string, title: string, showPaymentColumns?: boolean }} props
 */
export default function ViewBillInvoiceLedger({ billType, title, showPaymentColumns = false }) {
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

  function load() {
    setLoading(true);
    api.viewBillInvoices.list({ bill_type: billType })
      .then(setRows)
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }

  useEffect(load, [billType]);

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
    downloadBlob(`${billType.toLowerCase()}-${new Date().toISOString().slice(0, 10)}.csv`, new Blob([lines.join('\n')], { type: 'text/csv' }));
  }

  function exportExcel() {
    const data = rowsForExport();
    const sheet = XLSX.utils.json_to_sheet(data.length ? data : [{ '#': '', 'Client Name': '', 'Invoice No': '' }]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheet, 'Invoices');
    XLSX.writeFile(wb, `${billType.toLowerCase()}-${new Date().toISOString().slice(0, 10)}.xlsx`);
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
      table{width:100%;border-collapse:collapse} th{background:#66b2ff;color:#fff;padding:6px;text-align:left}
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
    setMessage('');
    try {
      await api.viewBillInvoices.cancel(r.id);
      setMessage(`Cancelled ${r.invoice_no}`);
      load();
    } catch (err) {
      setMessage(err.response?.data?.error || 'Cancel failed');
    }
  }

  const th = 'px-3 py-3 border-r border-white/20 font-semibold cursor-pointer hover:bg-blue-400 whitespace-nowrap';
  const td = 'px-3 py-2 border-r border-gray-100 whitespace-nowrap';
  const link = 'text-[#428bca] hover:underline bg-transparent border-0 cursor-pointer p-0 text-[13px]';

  function SortTh({ k, label }) {
    return (
      <th className={th} onClick={() => toggleSort(k)}>
        {label} {sortKey === k ? (sortDir === 'asc' ? '▲' : '▼') : '⇕'}
      </th>
    );
  }

  return (
    <div className="p-6 bg-[#f8f9fa] min-h-screen font-sans text-[13px]">
      <div className="bg-white border border-gray-200 shadow-sm max-w-[1600px] mx-auto rounded-sm">
        <div className="bg-[#66b2ff] text-white px-4 py-2 font-semibold flex items-center justify-center tracking-wide text-sm relative">
          {title}
          <span className="absolute right-4 text-xs">▼</span>
        </div>

        <div className="flex justify-between items-center p-3 border-b border-gray-200 bg-gray-50/50 flex-wrap gap-2">
          <div className="flex gap-2">
            <button type="button" className="bg-[#5bc0de] hover:bg-[#31b0d5] text-white px-4 py-1.5 rounded-full shadow-sm font-semibold" onClick={exportCsv}>CSV</button>
            <button type="button" className="bg-[#5bc0de] hover:bg-[#31b0d5] text-white px-4 py-1.5 rounded-full shadow-sm font-semibold" onClick={exportExcel}>Excel</button>
            <button type="button" className="bg-[#5bc0de] hover:bg-[#31b0d5] text-white px-4 py-1.5 rounded-full shadow-sm font-semibold" onClick={exportPdf}>PDF</button>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-gray-600 font-medium">Search:</label>
            <input type="search" className="border border-gray-300 px-2 py-1 rounded-sm w-48 outline-none focus:border-blue-400" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>

        {message && <div className="px-4 py-2 text-sm text-green-800 bg-green-50 border-b">{message}</div>}

        <div className="overflow-x-auto">
          {loading ? (
            <div className="p-8 text-center text-gray-500">Loading invoices…</div>
          ) : (
            <table className="w-full text-center border-collapse">
              <thead>
                <tr className="bg-[#66b2ff] text-white">
                  <SortTh k="invoice_no" label={showPaymentColumns ? 'S.No.' : '#'} />
                  <SortTh k="client_name" label="Client Name" />
                  <SortTh k="invoice_no" label="Invoice No" />
                  <SortTh k="invoice_amount" label="Invoice Amount(INR)" />
                  <SortTh k="invoice_date" label="Invoice Date" />
                  <SortTh k="invoice_due_date" label="Invoice Due Date" />
                  <SortTh k="supply_from_date" label="Supply From Date" />
                  <SortTh k="supply_to_date" label="Supply To Date" />
                  <SortTh k="invoice_generated_on" label="Invoice Generated On" />
                  {showPaymentColumns && (
                    <>
                      <th className={th}>Received Amount (Rs.)</th>
                      <th className={th}>Date of Payment</th>
                      <th className={th}>TDS Rate(%)</th>
                      <th className={th}>TDS Deducted (Rs)</th>
                      <th className={th}>Bank Name</th>
                      <th className={th}>Remarks</th>
                    </>
                  )}
                  <th className={th}>View</th>
                  {showPaymentColumns && <th className={th}>Payment Details</th>}
                  <th className={th}>{showPaymentColumns ? 'Edit' : 'EDIT'}</th>
                  <th className="px-3 py-3 font-semibold">Cancel</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={showPaymentColumns ? 19 : 12} className="px-3 py-6 text-center text-gray-500 bg-[#f9f9f9]">
                      No data available in table
                    </td>
                  </tr>
                ) : filtered.map((r, i) => (
                  <tr key={r.id} className="border-b border-gray-100 hover:bg-gray-50 text-gray-700">
                    <td className={td}>{i + 1}</td>
                    <td className={`${td} text-left font-medium`}>{r.client_name}</td>
                    <td className={`${td} text-left`}>{r.invoice_no}</td>
                    <td className={td}>{fmtNumber(r.invoice_amount, 2)}</td>
                    <td className={td}>{fmtDisplayDate(r.invoice_date)}</td>
                    <td className={td}>{fmtDisplayDate(r.invoice_due_date)}</td>
                    <td className={td}>{fmtDisplayDate(r.supply_from_date)}</td>
                    <td className={td}>{fmtDisplayDate(r.supply_to_date)}</td>
                    <td className={td}>{fmtGenerated(r.invoice_generated_on)}</td>
                    {showPaymentColumns && (
                      <>
                        <td className={td}>{r.received_amount != null ? fmtNumber(r.received_amount, 0) : ''}</td>
                        <td className={td}>{fmtDisplayDate(r.payment_date)}</td>
                        <td className={td}>{r.tds_rate != null ? r.tds_rate : ''}</td>
                        <td className={td}>{r.tds_deducted != null ? fmtNumber(r.tds_deducted, 1) : ''}</td>
                        <td className={td}>{r.bank_name || ''}</td>
                        <td className={`${td} text-left max-w-[160px] truncate`} title={r.remarks || ''}>{r.remarks || ''}</td>
                      </>
                    )}
                    <td className={td}>
                      <button type="button" className={link} onClick={() => setViewRow(r)} title="View">👁</button>
                    </td>
                    {showPaymentColumns && (
                      <td className={td}>
                        {r.received_amount != null ? (
                          <span className="text-gray-400">—</span>
                        ) : (
                          <button type="button" className={link} onClick={() => openPay(r)}>Payment Details</button>
                        )}
                      </td>
                    )}
                    <td className={td}>
                      <button type="button" className={link} onClick={() => openEdit(r)}>Edit</button>
                    </td>
                    <td className="px-3 py-2">
                      <button type="button" className={link} onClick={() => cancelInv(r)}>Cancel</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="bg-white px-4 py-2 text-gray-500 text-xs border-t border-gray-200">
          Showing {filtered.length === 0 ? 0 : 1} to {filtered.length} of {filtered.length} entries
          {search.trim() && rows.length !== filtered.length ? ` (filtered from ${rows.length})` : ''}
        </div>
      </div>

      {viewRow && (
        <Modal open onClose={() => setViewRow(null)} title={viewRow.invoice_no} width={560}>
          <div style={{ fontSize: 13, lineHeight: 1.7 }}>
            <div><strong>Client:</strong> {viewRow.client_name}</div>
            <div><strong>Amount:</strong> ₹{fmtNumber(viewRow.invoice_amount, 2)}</div>
            <div><strong>Invoice Date:</strong> {fmtDisplayDate(viewRow.invoice_date)}</div>
            <div><strong>Due Date:</strong> {fmtDisplayDate(viewRow.invoice_due_date)}</div>
            <div><strong>Supply:</strong> {fmtDisplayDate(viewRow.supply_from_date)} → {fmtDisplayDate(viewRow.supply_to_date)}</div>
            <div><strong>Generated:</strong> {fmtGenerated(viewRow.invoice_generated_on)}</div>
            {viewRow.received_amount != null && (
              <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid #e2e8f0' }}>
                <div><strong>Received:</strong> ₹{fmtNumber(viewRow.received_amount, 2)}</div>
                <div><strong>Payment Date:</strong> {fmtDisplayDate(viewRow.payment_date)}</div>
                <div><strong>TDS:</strong> {viewRow.tds_rate}% · ₹{fmtNumber(viewRow.tds_deducted, 2)}</div>
                <div><strong>Bank:</strong> {viewRow.bank_name}</div>
                <div><strong>Remarks:</strong> {viewRow.remarks || '—'}</div>
              </div>
            )}
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
