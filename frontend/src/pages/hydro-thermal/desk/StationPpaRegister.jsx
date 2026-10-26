import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../../api/client.js';
import { useAuth } from '../../../context/AuthContext.jsx';
import { pathFor, writeRolesFor, deskLabel } from '../../../lib/stationVertical.js';
import { PageHeader, Card, Table, Badge, StatCard, AlertPopup, Modal, Field, fmtCurrency } from '../../../components/ui.jsx';
import { fmtDate } from '../../../datetime.js';

const STANDING = {
  ON_FILE: { label: 'On file', tone: 'success' },
  EXPIRING: { label: 'Expiring', tone: 'warning' },
  EXPIRED: { label: 'Expired', tone: 'danger' },
  TERMINATED: { label: 'Terminated', tone: 'danger' },
  NOT_STARTED: { label: 'Not yet in force', tone: 'warning' },
  MISSING: { label: 'No PPA on file', tone: 'danger' },
};
const pct = (v) => (v == null ? '—' : `${Number(v).toLocaleString('en-IN', { maximumFractionDigits: 4 })}%`);
const EMPTY = { ppa_ref: '', signed_on: '', valid_from: '', valid_to: '', contracted_share_pct: '', lc_months_required: '1', tariff_basis: 'CERC tariff order for the station, as revised from time to time', remarks: '' };

// Each beneficiary a station bills, beside the PPA behind the share: is one on
// file, is it running out, is the beneficiary onboarded, is its LC enough.
export default function StationPpaRegister({ vertical = 'HYDRO' }) {
  const { user } = useAuth();
  const canWrite = writeRolesFor(vertical).includes(user?.role);
  const [data, setData] = useState(null);
  const [filter, setFilter] = useState('ALL');
  const [form, setForm] = useState(null); // { mode, station, row, values }
  const [popup, setPopup] = useState(null);
  const busy = useRef(false);

  const load = useCallback(() => {
    api.hydroDesk.ppas({ vertical })
      .then(setData)
      .catch((e) => setPopup({ title: 'Could not load', message: e.response?.data?.error || e.message }));
  }, [vertical]);
  useEffect(load, [load]);

  function openAdd(station, row) {
    setForm({ mode: 'add', station, row, values: { ...EMPTY } });
  }
  function openEdit(station, row) {
    const p = row.ppa;
    setForm({
      mode: 'edit', station, row,
      values: {
        ppa_ref: p.ppa_ref || '', signed_on: p.signed_on || '', valid_from: p.valid_from || '', valid_to: p.valid_to || '',
        contracted_share_pct: p.contracted_share_pct ?? '', lc_months_required: p.lc_months_required ?? '', tariff_basis: p.tariff_basis || '', remarks: p.remarks || '',
      },
    });
  }
  const set = (k) => (e) => setForm((f) => ({ ...f, values: { ...f.values, [k]: e.target.value } }));

  function validate(v) {
    const missing = [];
    if (!v.ppa_ref.trim()) missing.push('PPA reference');
    if (!v.valid_from) missing.push('Valid from');
    if (v.valid_to && v.valid_from && v.valid_to < v.valid_from) missing.push('Valid to must be on or after valid from');
    if (v.contracted_share_pct !== '' && !(Number(v.contracted_share_pct) > 0 && Number(v.contracted_share_pct) <= 100)) missing.push('Contracted share must be between 0 and 100%');
    if (v.lc_months_required !== '' && !(Number(v.lc_months_required) >= 0 && Number(v.lc_months_required) <= 12)) missing.push('LC cover must be 0–12 months');
    return missing;
  }

  async function save() {
    if (busy.current) return;
    const problems = validate(form.values);
    if (problems.length) { setPopup({ title: 'Check the PPA details', items: problems }); return; }
    busy.current = true;
    try {
      if (form.mode === 'add') {
        await api.hydroDesk.addPpa({ ...form.values, contract_id: form.station.contract_id, beneficiary_name: form.row.beneficiary_name }, { vertical });
      } else {
        await api.hydroDesk.updatePpa(form.row.ppa.id, form.values, { vertical });
      }
      setPopup({ tone: 'success', title: 'PPA saved', message: `${form.row.beneficiary_name} — ${form.values.ppa_ref}` });
      setForm(null);
      load();
    } catch (e) {
      setPopup({ title: 'Not saved', message: e.response?.data?.error || e.message });
    } finally { busy.current = false; }
  }

  async function terminate() {
    if (busy.current) return;
    if (!form.values.remarks.trim()) { setPopup({ title: 'A reason is needed', message: 'Say in Remarks why the PPA is terminated.' }); return; }
    busy.current = true;
    try {
      await api.hydroDesk.updatePpa(form.row.ppa.id, { status: 'TERMINATED', remarks: form.values.remarks }, { vertical });
      setPopup({ tone: 'success', title: 'PPA terminated', message: form.row.ppa.ppa_ref });
      setForm(null);
      load();
    } catch (e) {
      setPopup({ title: 'Not done', message: e.response?.data?.error || e.message });
    } finally { busy.current = false; }
  }

  const matches = (r) => {
    if (filter === 'ATTENTION') return r.billed_now && ['MISSING', 'EXPIRED', 'TERMINATED', 'NOT_STARTED', 'EXPIRING'].includes(r.ppa_standing);
    if (filter === 'NOT_ONBOARDED') return r.billed_now && !r.entity;
    if (filter === 'SECURITY') return r.security_short > 0;
    return true;
  };
  const t = data?.totals || {};

  return (
    <div>
      <PageHeader
        title="Beneficiary PPAs & Allocation"
        subtitle={`Every beneficiary a ${deskLabel(vertical).toLowerCase()} station bills, beside the PPA behind its share — whether one is on file and in force, whether it is running out, whether the beneficiary is onboarded, and whether its payment security covers what the PPA asks`}
      />
      <div className="kpi-grid">
        <StatCard label="Beneficiaries billed" value={t.beneficiaries ?? 0} onClick={() => setFilter('ALL')} />
        <StatCard label="Billed without a PPA in force" value={t.missing ?? 0} tone={t.missing ? 'red' : 'green'} onClick={() => setFilter('ATTENTION')} />
        <StatCard label={`Expiring in ${data?.expiry_warning_days || 180} days`} value={t.expiring ?? 0} tone={t.expiring ? 'amber' : 'default'} onClick={() => setFilter('ATTENTION')} />
        <StatCard label="Not onboarded as stakeholder" value={t.not_onboarded ?? 0} tone={t.not_onboarded ? 'amber' : 'default'} onClick={() => setFilter('NOT_ONBOARDED')} />
        <StatCard label="Security below PPA cover" value={t.security_short ?? 0} tone={t.security_short ? 'red' : 'default'} onClick={() => setFilter('SECURITY')} />
      </div>

      <div className="filters-bar">
        <select value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Show">
          <option value="ALL">All beneficiaries</option>
          <option value="ATTENTION">PPA needs attention</option>
          <option value="NOT_ONBOARDED">Not onboarded</option>
          <option value="SECURITY">Security short of PPA cover</option>
        </select>
      </div>

      {(data?.stations || []).map((s) => (
        <Card key={s.contract_id} title={`${s.station_name}${s.allocation_month ? ` · allocation as of ${s.allocation_month}` : ''}`}>
          <Table
            columns={[
              { key: 'beneficiary_name', header: 'Beneficiary', render: (r) => <span>{r.beneficiary_name}{r.parent_state && r.parent_state !== r.beneficiary_name ? <div style={{ fontSize: 14, color: 'var(--text-light)' }}>{r.parent_state}</div> : null}</span> },
              { key: 'alloc', header: 'Share billed', render: (r) => (r.billed_now
                ? <span>{pct(r.allocation_pct)}{r.allocation_min_12m != null && r.allocation_min_12m !== r.allocation_max_12m ? <div style={{ fontSize: 14, color: 'var(--text-light)' }}>12 m: {pct(r.allocation_min_12m)} – {pct(r.allocation_max_12m)}</div> : null}</span>
                : <span style={{ color: 'var(--text-light)' }}>not on current allocation</span>) },
              { key: 'ppa', header: 'PPA', render: (r) => (
                <span>
                  <Badge type={STANDING[r.ppa_standing].tone}>{STANDING[r.ppa_standing].label}</Badge>
                  {r.ppa && <div style={{ fontSize: 14, marginTop: 2 }}>{r.ppa.ppa_ref} · {fmtDate(r.ppa.valid_from)} – {r.ppa.valid_to ? fmtDate(r.ppa.valid_to) : 'station life'}{r.ppa.days_to_expiry != null && r.ppa.days_to_expiry >= 0 && r.ppa_standing === 'EXPIRING' ? ` (${r.ppa.days_to_expiry} days left)` : ''}</div>}
                </span>
              ) },
              { key: 'entity', header: 'Stakeholder', render: (r) => (r.entity ? <span>{r.entity.name} <Badge status={r.entity.status} /></span> : <span style={{ color: 'var(--amber-strong)' }}>Not onboarded</span>) },
              { key: 'security', header: 'Security held / required', render: (r) => (
                <span>
                  {fmtCurrency(r.security_held)}{r.security_required != null ? ` / ${fmtCurrency(r.security_required)}` : ''}
                  {r.security_short > 0 && <div style={{ fontSize: 14, color: 'var(--red-deep)' }}>Short {fmtCurrency(r.security_short)}</div>}
                </span>
              ) },
              { key: 'outstanding', header: 'Outstanding', render: (r) => <Link to={`${pathFor(vertical, 'ledger')}?beneficiary=${encodeURIComponent(r.beneficiary_name)}`}>{fmtCurrency(r.outstanding)}</Link> },
              { key: 'act', header: '', render: (r) => (!canWrite ? null : (r.ppa && r.ppa.status === 'ACTIVE' && r.ppa_standing !== 'EXPIRED'
                ? <button type="button" className="btn btn-secondary btn-sm" onClick={() => openEdit(s, r)}>Edit PPA</button>
                : <button type="button" className="btn btn-primary btn-sm" onClick={() => openAdd(s, r)}>{r.ppa ? 'Record renewal' : 'Record PPA'}</button>)) },
            ]}
            rows={s.rows.filter(matches).map((r) => ({ ...r, id: r.beneficiary_name }))}
            emptyMessage={data ? 'Nothing matches this filter.' : 'Loading…'}
          />
        </Card>
      ))}
      {data && !data.stations.length && <Card><p className="inline-note">No {deskLabel(vertical).toLowerCase()} station is on the platform.</p></Card>}
      <p className="inline-note">The share billed comes from the REA allocation each month; the PPA is the agreement behind it. Security required is the PPA's LC cover in months times the beneficiary's average monthly billing over the last year.</p>

      <Modal open={!!form} onClose={() => setForm(null)} title={form ? `${form.mode === 'add' ? 'Record PPA' : 'Edit PPA'} — ${form.row.beneficiary_name}, ${form.station.station_name}` : ''} width={640}>
        {form && (
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
              <Field label="PPA reference" required><input value={form.values.ppa_ref} onChange={set('ppa_ref')} /></Field>
              <Field label="Signed on"><input type="date" value={form.values.signed_on} onChange={set('signed_on')} /></Field>
              <Field label="Valid from" required><input type="date" value={form.values.valid_from} onChange={set('valid_from')} /></Field>
              <Field label="Valid to (blank: station life)"><input type="date" value={form.values.valid_to} onChange={set('valid_to')} /></Field>
              <Field label="Contracted share %"><input type="number" step="0.0001" min="0" max="100" value={form.values.contracted_share_pct} onChange={set('contracted_share_pct')} /></Field>
              <Field label="LC cover required">
                <select value={form.values.lc_months_required} onChange={set('lc_months_required')}>
                  <option value="">Not stated</option>
                  <option value="1">1 month of billing</option>
                  <option value="1.05">105% of 1 month (LPS Rules)</option>
                  <option value="2">2 months of billing</option>
                  <option value="3">3 months of billing</option>
                </select>
              </Field>
            </div>
            <Field label="Tariff basis"><input value={form.values.tariff_basis} onChange={set('tariff_basis')} style={{ width: '100%' }} /></Field>
            <Field label="Remarks"><textarea rows={2} value={form.values.remarks} onChange={set('remarks')} style={{ width: '100%' }} /></Field>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', marginTop: 12 }}>
              <span>{form.mode === 'edit' && <button type="button" className="btn btn-danger" onClick={terminate}>Terminate PPA</button>}</span>
              <span style={{ display: 'flex', gap: 8 }}>
                <button type="button" className="btn btn-outline" onClick={() => setForm(null)}>Cancel</button>
                <button type="button" className="btn btn-primary" onClick={save}>Save</button>
              </span>
            </div>
          </div>
        )}
      </Modal>
      <AlertPopup open={!!popup} tone={popup?.tone || 'error'} title={popup?.title} message={popup?.message} items={popup?.items} onClose={() => setPopup(null)} />
    </div>
  );
}
