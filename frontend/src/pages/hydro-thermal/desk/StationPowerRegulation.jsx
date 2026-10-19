import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../../api/client.js';
import { useAuth } from '../../../context/AuthContext.jsx';
import { pathFor, writeRolesFor, deskLabel } from '../../../lib/stationVertical.js';
import { PageHeader, Card, Table, Badge, StatCard, AlertPopup, Modal, Field, fmtCurrency } from '../../../components/ui.jsx';
import { fmtDate } from '../../../datetime.js';

const GROUND = { OVERDUE: 'Dues overdue', SECURITY_NOT_MAINTAINED: 'Security not maintained', BOTH: 'Overdue and security short' };
const STATUS = {
  NOTICE_ISSUED: { label: 'On notice', tone: 'warning' },
  REGULATING: { label: 'Regulating', tone: 'danger' },
  RESTORED: { label: 'Restored', tone: 'success' },
  WITHDRAWN: { label: 'Withdrawn', tone: 'neutral' },
};
const mu = (kwh) => `${(Number(kwh || 0) / 1e6).toLocaleString('en-IN', { maximumFractionDigits: 3 })} MU`;
const today = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);

// Regulating supply to a beneficiary in default: who qualifies, the notice
// served, from when supply was regulated, what was withheld, and restoration.
export default function StationPowerRegulation({ vertical = 'HYDRO' }) {
  const { user } = useAuth();
  const canWrite = writeRolesFor(vertical).includes(user?.role);
  const [data, setData] = useState(null);
  const [form, setForm] = useState(null); // { kind: 'NOTICE'|'REGULATE'|'RESTORE'|'WITHDRAW', row, values }
  const [popup, setPopup] = useState(null);
  const busy = useRef(false);

  const load = useCallback(() => {
    api.hydroDesk.powerRegulation({ vertical })
      .then(setData)
      .catch((e) => setPopup({ title: 'Could not load', message: e.response?.data?.error || e.message }));
  }, [vertical]);
  useEffect(load, [load]);

  const set = (k) => (e) => setForm((f) => ({ ...f, values: { ...f.values, [k]: e.target.value } }));

  function validate({ kind, row, values: v }) {
    const p = [];
    if (kind === 'NOTICE') {
      if (!v.notice_ref.trim()) p.push('Notice reference');
      if (!v.notice_date) p.push('Notice date');
      if (v.notice_date > today()) p.push('The notice date cannot be in the future');
    }
    if (kind === 'REGULATE') {
      if (!v.regulate_from) p.push('Regulate from');
      else if (v.regulate_from < row.earliest_regulation_date) p.push(`The notice runs until ${fmtDate(row.earliest_regulation_date)}`);
      if (!(Number(v.regulation_pct) > 0 && Number(v.regulation_pct) <= 100)) p.push('Share withheld must be more than 0 and at most 100%');
      if (!v.rldc_intimation_ref.trim()) p.push('RLDC / SLDC intimation reference');
    }
    if ((kind === 'RESTORE' || kind === 'WITHDRAW') && !v.reason.trim()) p.push('Reason');
    return p;
  }

  async function submit() {
    if (busy.current) return;
    const problems = validate(form);
    if (problems.length) { setPopup({ title: 'Check the details', items: problems }); return; }
    busy.current = true;
    try {
      const { kind, row, values } = form;
      if (kind === 'NOTICE') {
        const c = await api.hydroDesk.issueRegulationNotice({ contract_id: row.contract_id, beneficiary_name: row.beneficiary_name, ...values }, { vertical });
        setPopup({ tone: 'success', title: `${c.case_no} opened`, message: `Supply to ${c.beneficiary_name} may be regulated from ${fmtDate(c.earliest_regulation_date)}.` });
      } else {
        await api.hydroDesk.moveRegulation(row.id, { action: kind, ...values }, { vertical });
        const done = { REGULATE: 'Regulation started', RESTORE: 'Supply restored', WITHDRAW: 'Notice withdrawn' }[kind];
        setPopup({ tone: 'success', title: done, message: kind === 'REGULATE' ? 'Enter what is withheld each month in the bill\'s regulation panel, from the REA\'s un-requisitioned surplus.' : '' });
      }
      setForm(null);
      load();
    } catch (e) {
      setPopup({ title: 'Not done', message: e.response?.data?.error || e.message });
    } finally { busy.current = false; }
  }

  const t = data?.totals || {};
  const n = data?.norms || {};
  const open = (kind, row, values) => setForm({ kind, row, values });

  return (
    <div>
      <PageHeader
        title="Regulation of Power Supply"
        subtitle={`${deskLabel(vertical)} beneficiaries in default — dues beyond ${n.trigger_days ?? 60} days or payment security short of the PPA — the notice served, regulation through the RLDC, the energy withheld on each bill, and restoration`}
      />
      <div className="kpi-grid">
        <StatCard label="In default, no case open" value={t.candidates ?? 0} tone={t.candidates ? 'amber' : 'default'} />
        <StatCard label="On notice" value={t.notices ?? 0} hint={t.notices_matured ? `${t.notices_matured} past the notice period` : undefined} tone={t.notices ? 'amber' : 'default'} />
        <StatCard label="Being regulated" value={t.regulating ?? 0} tone={t.regulating ? 'red' : 'default'} />
        <StatCard label="Regulated, dues now cleared" value={t.regulating_cleared ?? 0} tone={t.regulating_cleared ? 'green' : 'default'} hint={t.regulating_cleared ? 'Restore supply' : undefined} />
        <StatCard label="Energy withheld on bills" value={mu(t.withheld_kwh)} />
      </div>

      <Card title="Beneficiaries in default">
        <Table
          columns={[
            { key: 'beneficiary_name', header: 'Beneficiary', render: (r) => <Link to={`${pathFor(vertical, 'ledger')}?beneficiary=${encodeURIComponent(r.beneficiary_name)}`}>{r.beneficiary_name}</Link> },
            { key: 'station_name', header: 'Station' },
            { key: 'ground', header: 'Ground', render: (r) => <Badge type="warning">{GROUND[r.ground]}</Badge> },
            { key: 'overdue', header: 'Overdue', render: (r) => <span>{fmtCurrency(r.overdue)}<div style={{ fontSize: 12.5, color: 'var(--text-light)' }}>oldest {r.days_overdue} days past due</div></span> },
            { key: 'security_short', header: 'Security short', render: (r) => (r.security_short > 0 ? fmtCurrency(r.security_short) : '—') },
            { key: 'act', header: '', render: (r) => (canWrite
              ? <button type="button" className="btn btn-primary btn-sm" onClick={() => open('NOTICE', r, { notice_ref: '', notice_date: today(), remarks: '' })}>Serve notice</button>
              : null) },
          ]}
          rows={(data?.candidates || []).map((r) => ({ ...r, id: `${r.contract_id}|${r.beneficiary_name}` }))}
          emptyMessage={data ? 'No beneficiary is in default.' : 'Loading…'}
        />
      </Card>

      <Card title="Regulation cases">
        <Table
          columns={[
            { key: 'case_no', header: 'Case', render: (c) => <span>{c.case_no}<div style={{ fontSize: 12.5, color: 'var(--text-light)' }}>{c.station_name}</div></span> },
            { key: 'beneficiary_name', header: 'Beneficiary', render: (c) => <span>{c.beneficiary_name}<div style={{ fontSize: 12.5, color: 'var(--text-light)' }}>{GROUND[c.ground]} · {fmtCurrency(c.outstanding_at_notice)} at notice</div></span> },
            { key: 'status', header: 'Standing', render: (c) => (
              <span><Badge type={STATUS[c.status].tone}>{STATUS[c.status].label}</Badge>
                {c.status === 'NOTICE_ISSUED' && <div style={{ fontSize: 12.5, color: c.notice_matured ? 'var(--amber-strong)' : 'var(--text-light)' }}>{c.notice_matured ? 'Notice period over' : `Can regulate from ${fmtDate(c.earliest_regulation_date)}`}</div>}
                {c.status === 'REGULATING' && c.default_cleared && <div style={{ fontSize: 12.5, color: 'var(--on-green-2)' }}>Dues cleared — restore</div>}
              </span>
            ) },
            { key: 'dates', header: 'Notice / regulation', render: (c) => (
              <span style={{ fontSize: 13 }}>
                <div>Notice {c.notice_ref}, {fmtDate(c.notice_date)}</div>
                {c.regulate_from && <div>Regulated from {fmtDate(c.regulate_from)} · {c.regulation_pct}% withheld · {c.rldc_intimation_ref}</div>}
                {c.restored_on && <div>{c.status === 'WITHDRAWN' ? 'Withdrawn' : 'Restored'} {fmtDate(c.restored_on)} — {c.close_reason}</div>}
              </span>
            ) },
            { key: 'withheld', header: 'Withheld on bills', render: (c) => (c.withheld.length
              ? <span>{mu(c.withheld_kwh)}{c.withheld.map((w) => <div key={w.bill_no} style={{ fontSize: 12.5, color: 'var(--text-light)' }}>{w.billing_month}: {mu(w.withheld_kwh)} ({w.bill_no})</div>)}</span>
              : '—') },
            { key: 'now', header: 'Overdue now', render: (c) => (['NOTICE_ISSUED', 'REGULATING'].includes(c.status) ? fmtCurrency(c.overdue_now) : '—') },
            { key: 'act', header: '', render: (c) => (!canWrite ? null : (
              <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {c.status === 'NOTICE_ISSUED' && <button type="button" className="btn btn-primary btn-sm" disabled={!c.notice_matured} title={c.notice_matured ? '' : `Notice runs until ${c.earliest_regulation_date}`} onClick={() => open('REGULATE', c, { regulate_from: c.earliest_regulation_date > today() ? c.earliest_regulation_date : today(), regulation_pct: '100', rldc_intimation_ref: '' })}>Start regulation</button>}
                {c.status === 'NOTICE_ISSUED' && <button type="button" className="btn btn-outline btn-sm" onClick={() => open('WITHDRAW', c, { on_date: today(), reason: '' })}>Withdraw</button>}
                {c.status === 'REGULATING' && <button type="button" className="btn btn-primary btn-sm" onClick={() => open('RESTORE', c, { on_date: today(), reason: c.default_cleared ? 'Outstanding dues cleared' : '' })}>Restore supply</button>}
              </span>
            )) },
          ]}
          rows={data?.cases || []}
          emptyMessage={data ? 'No regulation case yet.' : 'Loading…'}
        />
        <p className="inline-note">Thresholds are masters: dues more than {n.trigger_days ?? 60} days past due, and {n.notice_days ?? 15} days' notice before regulation (power_regulation_trigger_days, power_regulation_notice_days). A regulated beneficiary still carries its capacity charge; the withheld energy is entered on each month's bill against the REA's un-requisitioned surplus.</p>
      </Card>

      <Modal open={!!form} onClose={() => setForm(null)} width={600} title={form ? `${{ NOTICE: 'Serve regulation notice', REGULATE: 'Start regulation', RESTORE: 'Restore supply', WITHDRAW: 'Withdraw notice' }[form.kind]} — ${form.row.beneficiary_name}` : ''}>
        {form && (
          <div>
            {form.kind === 'NOTICE' && (
              <>
                <p style={{ marginTop: 0, fontSize: 13.5 }}>{GROUND[form.row.ground]} — {fmtCurrency(form.row.overdue)} overdue, oldest {form.row.days_overdue} days. Supply can be regulated {n.notice_days ?? 15} days after the notice date.</p>
                <Field label="Notice reference" required><input value={form.values.notice_ref} onChange={set('notice_ref')} style={{ width: '100%' }} /></Field>
                <Field label="Notice date" required><input type="date" max={today()} value={form.values.notice_date} onChange={set('notice_date')} /></Field>
                <Field label="Remarks"><textarea rows={2} value={form.values.remarks} onChange={set('remarks')} style={{ width: '100%' }} /></Field>
              </>
            )}
            {form.kind === 'REGULATE' && (
              <>
                <Field label="Regulate from" required><input type="date" min={form.row.earliest_regulation_date} value={form.values.regulate_from} onChange={set('regulate_from')} /></Field>
                <Field label="Share of entitlement withheld" required>
                  <select value={form.values.regulation_pct} onChange={set('regulation_pct')}>
                    {['10', '25', '50', '75', '100'].map((x) => <option key={x} value={x}>{x}%</option>)}
                  </select>
                </Field>
                <Field label="RLDC / SLDC intimation reference" required><input value={form.values.rldc_intimation_ref} onChange={set('rldc_intimation_ref')} style={{ width: '100%' }} /></Field>
              </>
            )}
            {(form.kind === 'RESTORE' || form.kind === 'WITHDRAW') && (
              <>
                {form.kind === 'RESTORE' && !form.row.default_cleared && <div className="inline-note" style={{ color: 'var(--amber-strong)' }}>{fmtCurrency(form.row.overdue_now)} is still overdue. Restore only on a payment plan or an order, and say so.</div>}
                <Field label="Date" required><input type="date" value={form.values.on_date} onChange={set('on_date')} /></Field>
                <Field label="Reason" required><textarea rows={2} value={form.values.reason} onChange={set('reason')} style={{ width: '100%' }} /></Field>
              </>
            )}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
              <button type="button" className="btn btn-outline" onClick={() => setForm(null)}>Cancel</button>
              <button type="button" className="btn btn-primary" onClick={submit}>Confirm</button>
            </div>
          </div>
        )}
      </Modal>
      <AlertPopup open={!!popup} tone={popup?.tone || 'error'} title={popup?.title} message={popup?.message} items={popup?.items} onClose={() => setPopup(null)} />
    </div>
  );
}
