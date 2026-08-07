import React, { useEffect, useState } from 'react';
import { api } from '../../api/client.js';
import { PageHeader, Card, Table, Badge, Modal, Field, StatCard, fmtCurrency } from '../../components/ui.jsx';

const SECTIONS = ['194C', '194Q', '194J', 'NONE'];
const EMPTY_ENTRY = { vendor_name: '', section: '', rate: '', taxable_amount: '', reference_type: 'OA_APPLICATION', reference_no: '', period: '', deducted_date: '', note: '' };
const EMPTY_CHALLAN = { challan_no: '', challan_date: '', paid_to_govt_date: '' };

export default function TDSRegister() {
  const [entries, setEntries] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [pending, setPending] = useState(null);
  const [summary, setSummary] = useState([]);
  const [panGaps, setPanGaps] = useState(null);
  const [filters, setFilters] = useState({ status: '', vendor: '', period: '' });
  const [loading, setLoading] = useState(true);

  const [showRecord, setShowRecord] = useState(false);
  const [entry, setEntry] = useState(EMPTY_ENTRY);
  const [challanFor, setChallanFor] = useState(null);
  const [challan, setChallan] = useState(EMPTY_CHALLAN);

  async function load() {
    setLoading(true);
    try {
      const params = {};
      if (filters.status) params.status = filters.status;
      if (filters.vendor) params.vendor = filters.vendor;
      if (filters.period) params.period = filters.period;
      const [list, v, p, s, pan] = await Promise.all([
        api.tds.list(params),
        api.tds.vendors(),
        api.tds.pending(),
        api.tds.summary(filters.period || undefined),
        api.tds.panCompliance(),
      ]);
      setEntries(list); setVendors(v); setPending(p); setSummary(s); setPanGaps(pan);
    } catch (err) {
      alert(err.response?.data?.error || err.message || 'Failed to load TDS register');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [filters]);

  async function submitEntry(e) {
    e.preventDefault();
    try {
      const body = { ...entry, taxable_amount: Number(entry.taxable_amount) };
      if (entry.rate !== '') body.rate = Number(entry.rate);
      if (!entry.section) delete body.section;
      await api.tds.record(body);
      setShowRecord(false); setEntry(EMPTY_ENTRY); load();
    } catch (err) {
      alert(err.response?.data?.error || err.message || 'Failed to record deduction');
    }
  }

  async function submitChallan(e) {
    e.preventDefault();
    try {
      await api.tds.challan(challanFor.id, challan);
      setChallanFor(null); setChallan(EMPTY_CHALLAN); load();
    } catch (err) {
      alert(err.response?.data?.error || err.message || 'Failed to record challan');
    }
  }

  const columns = [
    { key: 'deducted_date', label: 'Deducted', render: r => r.deducted_date || '—' },
    { key: 'vendor_name', label: 'Vendor' },
    { key: 'vendor_pan', label: 'PAN', render: r => r.vendor_pan || '—' },
    { key: 'section', label: 'Section', render: r => <Badge type="primary">{r.section}</Badge> },
    // Stored as a fraction; shown the way the Act states it.
    { key: 'rate', label: 'Rate', render: r => `${(r.rate * 100).toFixed(2)}%` },
    { key: 'taxable_amount', label: 'Taxable', render: r => fmtCurrency(r.taxable_amount) },
    { key: 'tds_amount', label: 'TDS', render: r => <strong>{fmtCurrency(r.tds_amount)}</strong> },
    { key: 'reference_no', label: 'Against', render: r => r.reference_no || '—' },
    { key: 'period', label: 'Period', render: r => r.period || '—' },
    {
      key: 'status',
      label: 'Status',
      render: r => <Badge type={r.status === 'DEPOSITED' ? 'success' : 'warning'}>{r.status}</Badge>,
    },
    { key: 'challan_no', label: 'Challan', render: r => r.challan_no || '—' },
    {
      key: 'actions',
      label: '',
      render: r => (r.status === 'DEDUCTED'
        ? <button className="btn btn-outline btn-sm" onClick={() => { setChallanFor(r); setChallan(EMPTY_CHALLAN); }}>Record challan</button>
        : null),
    },
  ];

  const summaryColumns = [
    { key: 'vendor_name', label: 'Vendor' },
    { key: 'vendor_pan', label: 'PAN' },
    { key: 'section', label: 'Section' },
    { key: 'deductions', label: 'Entries' },
    { key: 'taxable_total', label: 'Taxable', render: r => fmtCurrency(r.taxable_total) },
    { key: 'tds_total', label: 'TDS deducted', render: r => fmtCurrency(r.tds_total) },
    { key: 'tds_deposited', label: 'Deposited', render: r => fmtCurrency(r.tds_deposited) },
    {
      key: 'tds_pending',
      label: 'Pending',
      render: r => <span style={{ color: r.tds_pending > 0 ? 'var(--danger, #b91c1c)' : 'inherit' }}>{fmtCurrency(r.tds_pending)}</span>,
    },
  ];

  return (
    <div>
      <PageHeader
        title="TDS Register"
        subtitle="Tax withheld on open-access and energy payments, with challan tracking for deposit with the government"
        actions={<button className="btn btn-primary" onClick={() => setShowRecord(true)}>+ Record deduction</button>}
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 15, marginBottom: 20 }}>
        <StatCard label="Pending deposit" value={fmtCurrency(pending?.total_pending || 0)} tone={pending?.total_pending > 0 ? 'danger' : 'default'} hint="TDS deducted but not yet paid to government" />
        <StatCard label="Vendors with dues" value={pending?.vendors?.length || 0} />
        <StatCard label="Entries in view" value={entries.length} />
        <StatCard label="Vendor master" value={vendors.length} hint="Agencies with PAN on file" />
        <StatCard
          label="Buyers without PAN"
          value={panGaps ? panGaps.missing_pan : '—'}
          tone={panGaps && panGaps.trading_without_pan > 0 ? 'danger' : 'default'}
          hint={panGaps ? `${panGaps.trading_without_pan} of them are trading` : undefined}
        />
      </div>

      <Card
        title="Deduction register"
        actions={(
          <div style={{ display: 'flex', gap: 10 }}>
            <select className="input" value={filters.status} onChange={e => setFilters({ ...filters, status: e.target.value })} style={{ width: 150 }}>
              <option value="">All statuses</option>
              <option value="DEDUCTED">Pending deposit</option>
              <option value="DEPOSITED">Deposited</option>
            </select>
            <select className="input" value={filters.vendor} onChange={e => setFilters({ ...filters, vendor: e.target.value })} style={{ width: 180 }}>
              <option value="">All vendors</option>
              {vendors.map(v => <option key={v.id} value={v.name}>{v.name}</option>)}
            </select>
            <input className="input" placeholder="Period YYYY-MM" value={filters.period} onChange={e => setFilters({ ...filters, period: e.target.value })} style={{ width: 150 }} />
          </div>
        )}
      >
        <Table columns={columns} rows={entries} loading={loading} emptyMessage="No TDS entries recorded." />
      </Card>

      <Card title="Vendor-wise summary (Form 26Q basis)">
        <Table columns={summaryColumns} rows={summary} loading={loading} emptyMessage="Nothing to summarise yet." />
      </Card>

      {panGaps && (
        <Card title={`Section 194Q PAN compliance — ${panGaps.with_pan} of ${panGaps.buyers} buyer(s) on file`}>
          <p style={{ fontSize: 13, color: 'var(--slate-600)', marginBottom: 12 }}>
            194Q applies to the energy SJVN sells. Without the buyer's PAN the deduction falls under 206AA at 5%
            instead of 0.1% — a fifty-fold difference, so this is worth closing before the next bill is raised.
          </p>
          <Table
            columns={[
              { key: 'name', label: 'Buyer' },
              { key: 'deals', label: 'Deals' },
              { key: 'pan', label: 'PAN', render: r => (r.pan ? r.pan : <span style={{ color: 'var(--danger, #b91c1c)' }}>Not on file</span>) },
              { key: 'gst', label: 'GST', render: r => r.gst || '—' },
              {
                key: 'tds_rate_applicable',
                label: 'Rate that would apply',
                render: r => (
                  <Badge type={r.has_pan ? 'success' : 'danger'}>
                    {(r.tds_rate_applicable * 100).toFixed(1)}% {r.has_pan ? '(194Q)' : '(206AA)'}
                  </Badge>
                ),
              },
            ]}
            rows={panGaps.items}
            loading={loading}
            emptyMessage="No buyers on the platform."
          />
        </Card>
      )}

      <Modal open={showRecord} onClose={() => setShowRecord(false)} title="Record a TDS deduction">
        <form onSubmit={submitEntry}>
          <Field label="Vendor" required>
            <select className="input" value={entry.vendor_name} onChange={e => setEntry({ ...entry, vendor_name: e.target.value })} required>
              <option value="">Select vendor</option>
              {vendors.map(v => <option key={v.id} value={v.name}>{v.name} — {v.pan}</option>)}
            </select>
          </Field>
          <p style={{ fontSize: 12, color: 'var(--slate-500)', margin: '6px 0 14px' }}>
            The vendor's PAN and default section fill in automatically. Override the section or rate only where the payment is taxed differently.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 15 }}>
            <Field label="Taxable amount (₹)" required>
              <input type="number" step="0.01" className="input" value={entry.taxable_amount} onChange={e => setEntry({ ...entry, taxable_amount: e.target.value })} required />
            </Field>
            <Field label="Section (optional override)">
              <select className="input" value={entry.section} onChange={e => setEntry({ ...entry, section: e.target.value })}>
                <option value="">Vendor default</option>
                {SECTIONS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Rate as fraction (optional)">
              <input type="number" step="0.0001" className="input" value={entry.rate} onChange={e => setEntry({ ...entry, rate: e.target.value })} placeholder="0.10 = 10%" />
            </Field>
            <Field label="Reference type">
              <select className="input" value={entry.reference_type} onChange={e => setEntry({ ...entry, reference_type: e.target.value })}>
                <option value="OA_APPLICATION">Open-access application</option>
                <option value="ENERGY_INVOICE">Energy invoice</option>
                <option value="MANUAL">Manual</option>
              </select>
            </Field>
            <Field label="Reference no.">
              <input className="input" value={entry.reference_no} onChange={e => setEntry({ ...entry, reference_no: e.target.value })} placeholder="e.g. SJVN010426WR2354" />
            </Field>
            <Field label="Period">
              <input className="input" value={entry.period} onChange={e => setEntry({ ...entry, period: e.target.value })} placeholder="YYYY-MM" />
            </Field>
            <Field label="Deducted on">
              <input type="date" className="input" value={entry.deducted_date} onChange={e => setEntry({ ...entry, deducted_date: e.target.value })} />
            </Field>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 18 }}>
            <button type="button" className="btn btn-ghost" onClick={() => setShowRecord(false)}>Cancel</button>
            <button type="submit" className="btn btn-primary">Record</button>
          </div>
        </form>
      </Modal>

      <Modal open={!!challanFor} onClose={() => setChallanFor(null)} title="Record challan">
        {challanFor && (
          <form onSubmit={submitChallan}>
            <p style={{ fontSize: 13, color: 'var(--slate-500)', marginBottom: 14 }}>
              {fmtCurrency(challanFor.tds_amount)} withheld from {challanFor.vendor_name} under {challanFor.section}.
              Recording the challan marks it deposited.
            </p>
            <Field label="Challan number" required>
              <input className="input" value={challan.challan_no} onChange={e => setChallan({ ...challan, challan_no: e.target.value })} required />
            </Field>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 15, marginTop: 12 }}>
              <Field label="Challan date">
                <input type="date" className="input" value={challan.challan_date} onChange={e => setChallan({ ...challan, challan_date: e.target.value })} />
              </Field>
              <Field label="Paid to government on">
                <input type="date" className="input" value={challan.paid_to_govt_date} onChange={e => setChallan({ ...challan, paid_to_govt_date: e.target.value })} />
              </Field>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 18 }}>
              <button type="button" className="btn btn-ghost" onClick={() => setChallanFor(null)}>Cancel</button>
              <button type="submit" className="btn btn-primary">Mark deposited</button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
