import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../../api/client.js';
import { useAuth } from '../../../context/AuthContext.jsx';
import { writeRolesFor, deskLabel } from '../../../lib/stationVertical.js';
import { PageHeader, Card, Table, Badge, StatCard, AlertPopup, Modal, Field, fmtCurrency } from '../../../components/ui.jsx';
import { fmtDate } from '../../../datetime.js';

const STATUS_LABEL = {
  OPEN: 'To be filed', FILED: 'Filed', UNDER_HEARING: 'Under hearing', ORDER_RESERVED: 'Order reserved',
  ORDER_ISSUED: 'Order issued', PAID: 'Paid', CLOSED: 'Closed',
};
const STATUS_TONE = { OPEN: 'warning', FILED: 'primary', UNDER_HEARING: 'primary', ORDER_RESERVED: 'primary', ORDER_ISSUED: 'success', PAID: 'success', CLOSED: 'neutral' };
const PETITIONS = ['TARIFF_PETITION', 'TRUE_UP', 'REVIEW_PETITION', 'APPEAL'];
const EMPTY = {
  contract_id: '', item_type: 'TARIFF_PETITION', title: '', petition_no: '', control_period: '2024-29', due_date: '', filed_on: '',
  next_hearing: '', order_date: '', order_ref: '', amount: '', status: 'OPEN', tariff_impact: true, implemented_on: '', remarks: '',
};

// Petitions, true-ups and reviews before CERC, the fees that go with them, and
// any dated filing — with the orders that still have to reach the bills.
export default function StationRegulatory({ vertical = 'HYDRO' }) {
  const { user } = useAuth();
  const canWrite = writeRolesFor(vertical).includes(user?.role);
  const tariffPath = vertical === 'THERMAL' ? '/thermal/stations' : '/hydro-thermal/stations';
  const arrearPath = vertical === 'THERMAL' ? '/thermal/arrear-supplementary' : '/hydro-thermal/arrear-supplementary';
  const [data, setData] = useState(null);
  const [stations, setStations] = useState([]);
  const [view, setView] = useState('OPEN');
  const [form, setForm] = useState(null);
  const [popup, setPopup] = useState(null);
  const busy = useRef(false);

  const load = useCallback(() => {
    api.hydroDesk.regulatory({ vertical })
      .then(setData)
      .catch((e) => setPopup({ title: 'Could not load', message: e.response?.data?.error || e.message }));
  }, [vertical]);
  useEffect(() => {
    load();
    api.hydroBilling.stations({ vertical }).then((l) => setStations(l || [])).catch(() => setStations([]));
  }, [load, vertical]);

  const set = (k) => (e) => {
    const v = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    setForm((f) => ({ ...f, values: { ...f.values, [k]: v } }));
  };

  function validate(v) {
    const p = [];
    if (!v.title.trim()) p.push('Title');
    if (['FILED', 'UNDER_HEARING', 'ORDER_RESERVED', 'ORDER_ISSUED'].includes(v.status) && !v.filed_on) p.push('Filed on — needed once it is filed');
    if (v.status === 'ORDER_ISSUED' && (!v.order_date || !v.order_ref.trim())) p.push('Order date and order reference — needed for an issued order');
    if (v.status === 'PAID' && v.item_type !== 'CERC_FEE') p.push('Only a fee is marked paid; close other items instead');
    if (v.status === 'PAID' && !(Number(v.amount) > 0)) p.push('Amount paid');
    if (v.order_date && v.filed_on && v.order_date < v.filed_on) p.push('The order cannot predate the filing');
    return p;
  }

  async function save() {
    if (busy.current) return;
    const problems = validate(form.values);
    if (problems.length) { setPopup({ title: 'Check the details', items: problems }); return; }
    busy.current = true;
    const body = { ...form.values, contract_id: form.values.contract_id || null };
    try {
      if (form.id) await api.hydroDesk.updateRegulatory(form.id, body, { vertical });
      else await api.hydroDesk.addRegulatory(body, { vertical });
      setPopup({ tone: 'success', title: 'Saved', message: form.values.title });
      setForm(null);
      load();
    } catch (e) {
      setPopup({ title: 'Not saved', message: e.response?.data?.error || e.message });
    } finally { busy.current = false; }
  }

  function edit(i) {
    const v = {};
    for (const k of Object.keys(EMPTY)) v[k] = i[k] ?? '';
    v.tariff_impact = !!i.tariff_impact;
    setForm({ id: i.id, values: v });
  }

  const items = (data?.items || []).filter((i) => {
    if (view === 'OPEN') return !['ORDER_ISSUED', 'PAID', 'CLOSED'].includes(i.status) || i.to_implement;
    if (view === 'ATTENTION') return i.overdue || i.due_soon || i.hearing_soon || i.to_implement;
    return true;
  });
  const t = data?.totals || {};

  return (
    <div>
      <PageHeader
        title="Regulatory Desk"
        subtitle={`The ${deskLabel(vertical).toLowerCase()} desk's business before CERC and the appellate forums — tariff and true-up petitions, reviews and appeals, CERC fees and other filings — and the tariff orders still to reach the bills`}
        actions={canWrite && <button type="button" className="btn btn-primary" onClick={() => setForm({ id: null, values: { ...EMPTY } })}>Add item</button>}
      />
      <div className="kpi-grid">
        <StatCard label="Open items" value={t.open ?? 0} onClick={() => setView('OPEN')} />
        <StatCard label="Past due, not filed" value={t.overdue ?? 0} tone={t.overdue ? 'red' : 'default'} onClick={() => setView('ATTENTION')} />
        <StatCard label="Due in 30 days" value={t.due_soon ?? 0} tone={t.due_soon ? 'amber' : 'default'} onClick={() => setView('ATTENTION')} />
        <StatCard label="Hearings in 30 days" value={t.hearings_soon ?? 0} tone={t.hearings_soon ? 'amber' : 'default'} onClick={() => setView('ATTENTION')} />
        <StatCard label="Orders not yet in the bills" value={t.to_implement ?? 0} tone={t.to_implement ? 'red' : 'default'} onClick={() => setView('ATTENTION')} />
        <StatCard label="Fees outstanding" value={fmtCurrency(t.fees_due || 0)} />
      </div>

      <Card actions={(
        <select value={view} onChange={(e) => setView(e.target.value)} aria-label="Show">
          <option value="OPEN">Open and to implement</option>
          <option value="ATTENTION">Needs attention</option>
          <option value="ALL">Everything</option>
        </select>
      )}
      >
        <Table
          columns={[
            { key: 'title', header: 'Item', render: (i) => <span><strong>{i.title}</strong><div style={{ fontSize: 14, color: 'var(--text-light)' }}>{i.type_label}{i.petition_no ? ` · ${i.petition_no}` : ''}{i.control_period ? ` · ${i.control_period}` : ''}</div></span> },
            { key: 'station', header: 'Station', render: (i) => i.station_name || 'All stations' },
            { key: 'status', header: 'Standing', render: (i) => (
              <span><Badge type={STATUS_TONE[i.status]}>{STATUS_LABEL[i.status]}</Badge>
                {i.overdue && <div style={{ fontSize: 14, color: 'var(--red-deep)' }}>{-i.days_to_due} days past due</div>}
                {i.due_soon && <div style={{ fontSize: 14, color: 'var(--amber-strong)' }}>Due in {i.days_to_due} days</div>}
                {i.to_implement && <div style={{ fontSize: 14, color: 'var(--red-deep)' }}>Tariff not yet updated</div>}
              </span>
            ) },
            { key: 'dates', header: 'Dates', render: (i) => (
              <span style={{ fontSize: 14.5 }}>
                {i.due_date && <div>Due {fmtDate(i.due_date)}</div>}
                {i.filed_on && <div>Filed {fmtDate(i.filed_on)}</div>}
                {i.next_hearing && <div style={{ color: i.hearing_soon ? 'var(--amber-strong)' : undefined }}>Hearing {fmtDate(i.next_hearing)}</div>}
                {i.order_date && <div>Order {fmtDate(i.order_date)}{i.order_ref ? ` · ${i.order_ref}` : ''}</div>}
                {i.implemented_on && <div>In the bills {fmtDate(i.implemented_on)}</div>}
              </span>
            ) },
            { key: 'amount', header: 'Amount', render: (i) => (i.amount != null ? fmtCurrency(i.amount) : '—') },
            { key: 'act', header: '', render: (i) => (
              <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {i.to_implement && <Link className="btn btn-outline btn-sm" to={tariffPath}>Update tariff</Link>}
                {i.to_implement && <Link className="btn btn-outline btn-sm" to={arrearPath}>Raise arrears</Link>}
                {canWrite && <button type="button" className="btn btn-secondary btn-sm" onClick={() => edit(i)}>Update</button>}
              </span>
            ) },
          ]}
          rows={items}
          emptyMessage={data ? 'Nothing here. Add a petition, fee or filing to start tracking it.' : 'Loading…'}
        />
        <p className="inline-note">An order that changes the tariff stays flagged until it is marked implemented — the year's tariff updated and an arrear bill raised for the months already billed at the old rate.</p>
      </Card>

      <Modal open={!!form} onClose={() => setForm(null)} title={form?.id ? 'Update item' : 'Add regulatory item'} width={720}>
        {form && (
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 12 }}>
              <Field label="Kind" required>
                <select value={form.values.item_type} onChange={set('item_type')}>
                  {(data?.types || []).map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}
                </select>
              </Field>
              <Field label="Station">
                <select value={form.values.contract_id || ''} onChange={set('contract_id')}>
                  <option value="">All stations</option>
                  {stations.map((s) => <option key={s.id} value={s.id}>{s.station_name || s.contract_no}</option>)}
                </select>
              </Field>
              <Field label="Standing" required>
                <select value={form.values.status} onChange={set('status')}>
                  {(data?.statuses || []).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                </select>
              </Field>
            </div>
            <Field label="Title" required><input value={form.values.title} onChange={set('title')} style={{ width: '100%' }} placeholder="e.g. NJHPS tariff petition for 2024-29" /></Field>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
              <Field label="Petition / reference no."><input value={form.values.petition_no} onChange={set('petition_no')} /></Field>
              <Field label="Control period"><input value={form.values.control_period} onChange={set('control_period')} /></Field>
              <Field label="Due date"><input type="date" value={form.values.due_date} onChange={set('due_date')} /></Field>
              <Field label="Filed on"><input type="date" value={form.values.filed_on} onChange={set('filed_on')} /></Field>
              <Field label="Next hearing"><input type="date" value={form.values.next_hearing} onChange={set('next_hearing')} /></Field>
              <Field label="Order date"><input type="date" value={form.values.order_date} onChange={set('order_date')} /></Field>
              <Field label="Order reference"><input value={form.values.order_ref} onChange={set('order_ref')} /></Field>
              <Field label={form.values.item_type === 'CERC_FEE' ? 'Fee (₹)' : 'Amount (₹, AFC claimed / allowed)'}><input type="number" min="0" value={form.values.amount} onChange={set('amount')} /></Field>
            </div>
            {PETITIONS.includes(form.values.item_type) && (
              <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap', margin: '8px 0' }}>
                <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 15 }}>
                  <input type="checkbox" checked={!!form.values.tariff_impact} onChange={set('tariff_impact')} /> The order changes the tariff
                </label>
                {form.values.tariff_impact && form.values.status === 'ORDER_ISSUED' && (
                  <Field label="Implemented in the bills on"><input type="date" value={form.values.implemented_on} onChange={set('implemented_on')} /></Field>
                )}
              </div>
            )}
            <Field label="Remarks"><textarea rows={2} value={form.values.remarks} onChange={set('remarks')} style={{ width: '100%' }} /></Field>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
              <button type="button" className="btn btn-outline" onClick={() => setForm(null)}>Cancel</button>
              <button type="button" className="btn btn-primary" onClick={save}>Save</button>
            </div>
          </div>
        )}
      </Modal>
      <AlertPopup open={!!popup} tone={popup?.tone || 'error'} title={popup?.title} message={popup?.message} items={popup?.items} onClose={() => setPopup(null)} />
    </div>
  );
}
