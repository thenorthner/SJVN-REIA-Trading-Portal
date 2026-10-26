import React, { useCallback, useEffect, useState } from 'react';
import api from '../../../api/client.js';
import { writeRolesFor, pathFor, deskLabel } from '../../../lib/stationVertical.js';
import { useAuth } from '../../../context/AuthContext.jsx';
import { ROLE_GROUPS } from '../../../roles.js';
import { PageHeader, Card, Table, Badge, Modal, Field, StatCard, AlertPopup, fmtCurrency } from '../../../components/ui.jsx';
import { fmtDate } from '../../../datetime.js';
import ModuleGuide from '../../../components/ModuleGuide.jsx';
import { useStation, errOf } from './useStation.js';

// Tax a beneficiary deducted at source when it paid. It settles that much of
// the beneficiary's bills, so it goes onto the account as a credit — kept apart
// from money received — and the register follows the Form 16A and the 26AS
// until the credit is matched.

const TONE = { PENDING_CERTIFICATE: 'PENDING', CERTIFICATE_RECEIVED: 'PENDING', MATCHED_26AS: 'ACTIVE', MISMATCH_26AS: 'REJECTED', REVERSED: 'DRAFT' };

const TABS = [
  { key: 'REG', label: 'TDS Register' },
  { key: 'FYI', label: 'FYI — Reference Guide' },
];

export default function HydroTds({ vertical = 'HYDRO' }) {
  const { user } = useAuth();
  const canWrite = writeRolesFor(vertical).includes(user?.role);
  const { stations, stationId, setStationId, beneficiaries } = useStation(vertical);
  const [data, setData] = useState({ rows: [], by_quarter: [] });
  const [sections, setSections] = useState([]);
  const [form, setForm] = useState(null);
  const [cert, setCert] = useState(null);
  const [popup, setPopup] = useState(null);
  const [tab, setTab] = useState('REG');

  const load = useCallback(() => {
    if (!stationId) return;
    api.hydroDesk.tds({ contract_id: stationId }).then(setData).catch((e) => setPopup({ tone: 'error', title: 'Could not load', message: errOf(e) }));
  }, [stationId]);
  useEffect(load, [load]);
  useEffect(() => { api.hydroDesk.tdsSections().then(setSections).catch(() => setSections([])); }, []);

  async function record(e) {
    e.preventDefault();
    try {
      const r = await api.hydroDesk.recordTds({ ...form, contract_id: stationId, tds_amount: Number(form.tds_amount) });
      setForm(null);
      load();
      setPopup({ tone: 'success', title: 'TDS recorded', message: `${fmtCurrency(r.entry.tds_amount)} posted to ${r.entry.beneficiary_name}'s account as ${r.ledger_doc.doc_no} (${r.entry.financial_year} ${r.entry.quarter}).` });
    } catch (err) {
      setPopup({ tone: 'error', title: 'TDS was not recorded', message: errOf(err) });
    }
  }

  async function saveCert(e) {
    e.preventDefault();
    try {
      await api.hydroDesk.tdsCertificate(cert.entry.id, cert.mode === '26as' ? { amount_26as: cert.amount_26as, remarks: cert.remarks } : { certificate_no: cert.certificate_no, certificate_date: cert.certificate_date });
      setCert(null);
      load();
    } catch (err) {
      setPopup({ tone: 'error', title: 'Not saved', message: errOf(err) });
    }
  }

  const live = data.rows.filter((r) => r.status !== 'REVERSED');

  return (
    <div>
      <PageHeader
        title="TDS Deducted by Beneficiaries"
        subtitle="Tax deducted at source on payments to the station — credited to the beneficiary's account and followed to Form 16A and 26AS"
        actions={canWrite && <button className="btn btn-primary" disabled={!stationId} onClick={() => setForm({ beneficiary_name: beneficiaries[0] || '', section: '194Q', tds_amount: '', deduction_date: new Date().toISOString().slice(0, 10), deductor_tan: '', reference: '', remarks: '' })}>+ Record TDS</button>}
      />

      <div className="nb-tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} className={`nb-tab ${tab === t.key ? 'active' : ''}`} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'FYI' && (
        <ModuleGuide sections={[
          { title: 'What TDS on payments means here', body: 'When a beneficiary pays the station, it deducts tax at source under the applicable section (194Q for purchase of goods, 194C for works contracts, etc.). The amount deducted settles that much of the beneficiary\'s bills — it is posted to its account as a credit, separate from the cash received. The station then follows the Form 16A (the certificate from the beneficiary) and the 26AS (what the income-tax department shows) until the credit is matched.' },
          { title: 'Status lifecycle', body: 'PENDING CERTIFICATE → the TDS has been recorded but no Form 16A from the beneficiary yet. CERTIFICATE RECEIVED → the beneficiary has issued a 16A, but it has not been matched against the income-tax portal. MATCHED 26AS → the amount in the TDS register agrees with the 26AS. MISMATCH 26AS → the 26AS shows a different amount; follow up with the beneficiary.' },
          { title: 'Quarterly reconciliation', body: 'TDS is summarized by financial quarter (Q1 Apr–Jun through Q4 Jan–Mar). At the end of each quarter, check that the total deducted agrees with the 26AS pulled from the IT portal. Outstanding certificates should be chased within 15 days of the quarter end.' },
          { title: 'Reversal', body: 'A reversed entry means the TDS posting was incorrect or duplicated. The reversal undoes the credit on the beneficiary\'s account. A new entry must be raised in its place if the deduction was real.' },
        ]} />
      )}

      {tab === 'REG' && (<>
      <div className="filters-bar">
        <select value={stationId} onChange={(e) => setStationId(e.target.value)}>
          {stations.map((s) => <option key={s.id} value={s.id}>{s.station_name || s.contract_no}</option>)}
        </select>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14, marginBottom: 16 }}>
        <StatCard label="TDS deducted" value={fmtCurrency(live.reduce((a, r) => a + r.tds_amount, 0))} />
        <StatCard label="Form 16A awaited" value={live.filter((r) => r.status === 'PENDING_CERTIFICATE').length} tone={live.some((r) => r.status === 'PENDING_CERTIFICATE') ? 'danger' : 'default'} />
        <StatCard label="Not matched in 26AS" value={live.filter((r) => r.status !== 'MATCHED_26AS').length} />
      </div>
      {data.by_quarter.length > 0 && (
        <Card title="By quarter" style={{ marginBottom: 16 }}>
          <Table
            columns={[
              { key: 'period', header: 'Quarter' },
              { key: 'deducted', header: 'Deducted', render: (q) => fmtCurrency(q.deducted) },
              { key: 'certificates_pending', header: 'Form 16A awaited' },
              { key: 'matched', header: 'Matched in 26AS' },
            ]}
            rows={data.by_quarter.map((q) => ({ ...q, id: q.period }))}
          />
        </Card>
      )}
      <Card title="Register">
        <Table
          columns={[
            { key: 'deduction_date', header: 'Deducted on', render: (r) => fmtDate(r.deduction_date) },
            { key: 'beneficiary_name', header: 'Beneficiary' },
            { key: 'section', header: 'Section' },
            { key: 'tds_amount', header: 'Amount', render: (r) => fmtCurrency(r.tds_amount) },
            { key: 'quarter', header: 'Quarter', render: (r) => `${r.financial_year} ${r.quarter}` },
            { key: 'certificate_no', header: 'Form 16A', render: (r) => (r.certificate_no ? `${r.certificate_no} (${fmtDate(r.certificate_date)})` : '—') },
            { key: 'status', header: 'Status', render: (r) => <Badge status={TONE[r.status]} label={r.status.replaceAll('_', ' ')} /> },
            { key: 'actions', header: '', render: (r) => (canWrite && r.status !== 'REVERSED' && r.status !== 'MATCHED_26AS' ? (
              <span style={{ display: 'flex', gap: 6 }}>
                {r.status === 'PENDING_CERTIFICATE' && <button type="button" className="btn btn-xs btn-outline" onClick={() => setCert({ entry: r, mode: '16a', certificate_no: '', certificate_date: new Date().toISOString().slice(0, 10) })}>Form 16A received</button>}
                <button type="button" className="btn btn-xs btn-outline" onClick={() => setCert({ entry: r, mode: '26as', amount_26as: r.tds_amount, remarks: '' })}>Check 26AS</button>
              </span>
            ) : null) },
          ]}
          rows={data.rows}
          emptyMessage="No TDS recorded on this station."
        />
      </Card>
      </>)}

      <Modal open={!!form} onClose={() => setForm(null)} title="Record TDS deducted by a beneficiary" width={680}>
        {form && (
          <form onSubmit={record}>
            <div className="form-grid">
              <Field label="Beneficiary" required>
                <select value={form.beneficiary_name} onChange={(e) => setForm({ ...form, beneficiary_name: e.target.value })}>
                  {beneficiaries.map((b) => <option key={b} value={b}>{b}</option>)}
                </select>
              </Field>
              <Field label="Section" required>
                <select value={form.section} onChange={(e) => setForm({ ...form, section: e.target.value })}>
                  {sections.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </Field>
              <Field label="TDS amount (₹)" required><input required type="number" min="0.01" step="0.01" value={form.tds_amount} onChange={(e) => setForm({ ...form, tds_amount: e.target.value })} /></Field>
              <Field label="Deducted on" required><input required type="date" value={form.deduction_date} onChange={(e) => setForm({ ...form, deduction_date: e.target.value })} /></Field>
              <Field label="Deductor TAN"><input maxLength={10} value={form.deductor_tan} onChange={(e) => setForm({ ...form, deductor_tan: e.target.value.toUpperCase() })} placeholder="e.g. PTLP12345A" /></Field>
              <Field label="Payment reference (UTR)"><input value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} /></Field>
            </div>
            <p style={{ fontSize: 15, color: 'var(--text-muted)' }}>Record the cash received separately in Account Display; this posts only the tax part.</p>
            <div className="form-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setForm(null)}>Cancel</button>
              <button type="submit" className="btn btn-primary">Record</button>
            </div>
          </form>
        )}
      </Modal>

      <Modal open={!!cert} onClose={() => setCert(null)} title={cert?.mode === '26as' ? 'Check against Form 26AS' : 'Form 16A received'} width={500}>
        {cert && (
          <form onSubmit={saveCert}>
            {cert.mode === '26as' ? (
              <>
                <Field label="Amount shown in 26AS (₹)" required><input required type="number" step="0.01" value={cert.amount_26as} onChange={(e) => setCert({ ...cert, amount_26as: e.target.value })} /></Field>
                <Field label="Remarks"><input value={cert.remarks} onChange={(e) => setCert({ ...cert, remarks: e.target.value })} /></Field>
              </>
            ) : (
              <>
                <Field label="Certificate number" required><input required value={cert.certificate_no} onChange={(e) => setCert({ ...cert, certificate_no: e.target.value })} /></Field>
                <Field label="Certificate date"><input type="date" value={cert.certificate_date} onChange={(e) => setCert({ ...cert, certificate_date: e.target.value })} /></Field>
              </>
            )}
            <div className="form-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setCert(null)}>Cancel</button>
              <button type="submit" className="btn btn-primary">Save</button>
            </div>
          </form>
        )}
      </Modal>

      <AlertPopup open={!!popup} tone={popup?.tone} title={popup?.title} message={popup?.message} onClose={() => setPopup(null)} />
    </div>
  );
}
