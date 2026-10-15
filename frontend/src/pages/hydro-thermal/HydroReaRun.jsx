import React, { useEffect, useState } from 'react';
import { HelpCircle } from 'lucide-react';
import api from '../../api/client.js';
import { Card, Table, Badge, Field, Modal, fmtCurrency, fmtNumber } from '../../components/ui.jsx';
import HydroBeneficiaryWaterfall3D from '../../components/HydroBeneficiaryWaterfall3D.jsx';

// Draft a run of months' hydro bills straight from the Regional Energy Account.
//
// NRPC's site files each REA under an upload-timestamped name
// (…/allfile/090920261230385307REA0826_P.pdf), so the month cannot be turned
// into a link. The desk pastes the links it copied off Commercial → Regional
// Energy Accounts; the month is read off each file name (REA0826 → 2026-08) and
// the server checks it again against the month printed inside the PDF.

/** "…REA0826_P.pdf" / "…Rea0625_F.pdf" → "2026-08" / "2025-06". */
export function monthFromReaLink(link) {
  const m = /REA(\d{2})(\d{2})_[PF][A-Z0-9]*\.pdf$/i.exec(String(link).trim());
  if (!m) return null;
  const mm = Number(m[1]);
  if (mm < 1 || mm > 12) return null;
  return `20${m[2]}-${m[1]}`;
}

export function parseReaLinks(text) {
  const links = {};
  const unread = [];
  for (const raw of String(text || '').split(/\s+/)) {
    const line = raw.trim();
    if (!line) continue;
    const month = monthFromReaLink(line);
    if (month) links[month] = line; else unread.push(line);
  }
  return { links, unread };
}

/** Months from `from` to `to` inclusive, YYYY-MM, oldest first. */
export function monthsBetween(from, to) {
  const out = [];
  let [y, m] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  while ((y < ty || (y === ty && m <= tm)) && out.length < 24) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1; if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

const STATUS_TONE = { CREATED: 'APPROVED', EXISTS: 'PENDING', SKIPPED: 'DRAFT', FAILED: 'REJECTED' };

const when = (iso) => (iso ? new Date(iso).toLocaleString('en-IN') : '');

/**
 * What to tell the desk about the sweep that drafts without being asked.
 *
 * An empty bills list means two very different things depending on whether the
 * sweep ran, so this never says nothing: every state, including "it has not run
 * yet", gets a sentence.
 */
export function describeAutoDraft(status) {
  if (!status) return null;
  const { enabled, running, last } = status;
  if (running) return { tone: 'info', text: 'Drafting from the latest Regional Energy Accounts right now.' };
  if (!enabled) {
    return {
      tone: 'warn',
      text: 'Drafting by itself is switched off (hydro_rea_auto_draft) — bills are drafted only from this page.',
    };
  }
  if (!last) {
    return {
      tone: 'info',
      text: 'Drafting by itself is on. It has not run yet — the next REA scan will draft whatever the accounts allow.',
    };
  }
  const ran = `Last ran ${when(last.started_at)}`;
  const range = last.from_month ? ` for ${last.from_month}${last.to_month === last.from_month ? '' : `..${last.to_month}`}` : '';
  if (last.outcome === 'FAILED') return { tone: 'error', text: `${ran}${range} and failed: ${last.detail}` };
  if (last.outcome === 'OFF') return { tone: 'warn', text: `${ran}: drafting was switched off.` };
  if (last.outcome === 'DRAFTED') {
    return {
      tone: 'ok',
      text: `${ran}${range}: drafted ${last.bills_created} bill(s) — ${last.bill_nos.join(', ')}.`,
    };
  }
  if (last.outcome === 'BLOCKED') {
    return { tone: 'warn', text: `${ran}${range}: nothing could be drafted from the accounts on file.` };
  }
  return { tone: 'info', text: `${ran}: nothing to draft — ${last.detail || 'every landed account is already billed'}.` };
}

const TONE_CLASS = { error: 'alert alert-error', warn: 'alert alert-warning', ok: 'alert alert-success', info: 'alert alert-info' };

/** The standing answer to "did it draft anything this morning?". */
export function AutoDraftPanel({ status }) {
  const said = describeAutoDraft(status);
  if (!said) return null;
  const left = status.last?.blocked || [];
  return (
    <div className={TONE_CLASS[said.tone]} role="status" style={{ marginBottom: 12 }}>
      <div>{said.text}</div>
      {left.length > 0 && (
        <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
          {left.map((b) => (
            <li key={`${b.month}-${b.contract_no}`}>
              {b.month} {b.contract_no} — {b.reason}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function HydroReaRun({ onDone }) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [paste, setPaste] = useState('');
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState('');
  const [result, setResult] = useState(null);
  const [progress, setProgress] = useState('');
  const [auto, setAuto] = useState(null);
  const [showGuide, setShowGuide] = useState(false);

  // The sweep's own state, reloaded after a manual run because that run is what
  // the next sweep will find already billed.
  const loadAuto = () => api.hydroBilling.autoDraft().then(setAuto).catch(() => setAuto(null));
  useEffect(() => { loadAuto(); }, []);

  const { links, unread } = parseReaLinks(paste);
  const linkMonths = Object.keys(links).sort();

  // The server runs this in the background and the page polls. Fetching and
  // parsing a month's REA outlasts the proxies between the desk and the
  // server, which answered a plain request with 504 even though the server
  // carried on and billed the month.
  async function run(e) {
    e.preventDefault();
    setErr(''); setResult(null);
    const fromMonth = from || linkMonths[0];
    const toMonth = to || linkMonths[linkMonths.length - 1] || fromMonth;
    if (!fromMonth) { setErr('Give a month range, or paste the REA links for the months to bill.'); return; }
    if (fromMonth > toMonth) { setErr('From month is after To month.'); return; }
    const total = monthsBetween(fromMonth, toMonth).length;
    setRunning(true);
    setProgress(`Starting — ${total} month(s)…`);
    try {
      const start = await api.hydroBilling.fromRea({
        from_month: fromMonth, to_month: toMonth, rea_links: links, background: true,
      });
      for (;;) {
        await new Promise((r) => setTimeout(r, 3000));
        let job;
        try {
          job = await api.hydroBilling.fromReaJob(start.job_id);
        } catch (pollErr) {
          // A poll that times out is not the run failing — ask again.
          if (pollErr.response?.status === 504 || !pollErr.response) continue;
          throw pollErr;
        }
        setResult({ months: job.months || [], stations_not_ready: job.result?.stations_not_ready || [] });
        if (job.status === 'RUNNING') {
          const p = job.progress;
          setProgress(p ? `Month ${p.done + 1} of ${p.total}: fetching the ${p.month} REA and drafting…` : 'Working…');
          continue;
        }
        if (job.status === 'FAILED') setErr(job.error || 'The run failed');
        break;
      }
    } catch (ex) {
      setErr(ex.response?.data?.error || ex.message);
    } finally {
      setRunning(false);
      setProgress('');
      loadAuto();
      onDone?.();
    }
  }

  const rows = (result?.months || []).flatMap((m) => m.bills.map((b, i) => ({
    key: `${m.month}-${b.contract_no}`,
    month: i === 0 ? m.month : '',
    rea: i === 0 ? (m.rea ? `${m.rea === 'FINAL' ? 'Final' : 'Provisional'}${m.rea_imported ? ' (fetched)' : ''}` : (m.error || 'not published')) : '',
    ...b,
  })));

  return (
    <Card
      title="Bills from the Regional Energy Account"
      actions={
        <button
          type="button"
          className="btn btn-outline"
          onClick={() => setShowGuide(true)}
          title="View REA Fetch & Billing Instructions"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '5px 12px',
            fontSize: '13.5px',
            fontWeight: 500,
            borderRadius: '6px',
            color: '#475569',
            border: '1px solid #cbd5e1',
            background: '#ffffff',
            cursor: 'pointer',
          }}
        >
          <HelpCircle size={14} style={{ color: '#0284c7' }} />
          <span>Instructions</span>
        </button>
      }
    >
      <AutoDraftPanel status={auto} />
      <form onSubmit={run}>
        <Field label="REA PDF links (nrpc.gov.in)" htmlFor="rea-links">
          <textarea
            id="rea-links" rows={4} value={paste} onChange={(e) => setPaste(e.target.value)}
            placeholder="https://nrpc.gov.in/allfile/…REA0826_P.pdf"
            style={{ width: '100%', fontFamily: 'monospace', fontSize: 13.5 }}
          />
        </Field>
        {linkMonths.length > 0 && (
          <p style={{ margin: '4px 0' }}>Months read from the links: {linkMonths.join(', ')}</p>
        )}
        {unread.length > 0 && (
          <p className="text-warning" style={{ margin: '4px 0' }}>
            Not an REA PDF link (ignored): {unread.join(', ')}
          </p>
        )}
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <Field label="From month" htmlFor="rea-from">
            <input id="rea-from" type="month" value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="To month" htmlFor="rea-to">
            <input id="rea-to" type="month" value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
          <button type="submit" className="btn btn-primary" disabled={running}>
            {running ? 'Fetching REA and drafting…' : 'Fetch REA and draft bills'}
          </button>
        </div>
        <p style={{ margin: '6px 0 0', fontSize: 13.5, color: 'var(--text-light)' }}>
          Leave the months blank to bill exactly the months of the pasted links. Start from the first unbilled month of the financial year.
        </p>
      </form>

      {progress && <p role="status" style={{ marginTop: 12 }}>{progress}</p>}
      {err && <div className="alert alert-error" role="alert" style={{ marginTop: 12 }}>{err}</div>}

      {result && (
        <div style={{ marginTop: 16 }}>
          <HydroBeneficiaryWaterfall3D stationName={rows[0]?.station_name || 'Nathpa Jhakri HEP (1,500 MW)'} />
          <Table
            caption="What the run did, month by month"
            rows={rows}
            columns={[
              { key: 'month', header: 'Month' },
              { key: 'rea', header: 'REA' },
              { key: 'station_name', header: 'Station', render: (r) => r.station_name || r.contract_no },
              { key: 'status', header: 'Result', render: (r) => <Badge status={STATUS_TONE[r.status]} label={r.status} /> },
              { key: 'bill_no', header: 'Bill no.', render: (r) => r.bill_no || '—' },
              { key: 'energy_mwh', header: 'Energy (MWh)', render: (r) => (r.energy_mwh != null ? fmtNumber(r.energy_mwh, 2) : '—') },
              { key: 'pafm_pct', header: 'PAFM %', render: (r) => (r.pafm_pct != null ? fmtNumber(r.pafm_pct, 3) : '—') },
              { key: 'total_charges', header: 'Total', render: (r) => (r.total_charges != null ? fmtCurrency(r.total_charges) : '—') },
              { key: 'reason', header: 'Note', render: (r) => r.reason || r.beta_note || '' },
            ]}
          />
          {result.stations_not_ready?.length > 0 && (
            <p style={{ marginTop: 8 }}>
              Not billed, not ready: {result.stations_not_ready.map((s) => `${s.station_name || s.contract_no} (${s.missing.join(', ')})`).join('; ')}
            </p>
          )}
        </div>
      )}

      {showGuide && (
        <Modal
          open={showGuide}
          onClose={() => setShowGuide(false)}
          title="Bills from Regional Energy Account — Instructions & Process Guide"
          width={600}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, fontSize: '13.5px', lineHeight: 1.6, color: '#334155' }}>
            <div style={{ background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: 8, padding: '12px 14px' }}>
              <h4 style={{ margin: '0 0 6px', fontSize: '14px', color: '#0369a1', fontWeight: 600 }}>
                Purpose & Scope
              </h4>
              <p style={{ margin: 0 }}>
                Fetches each month&apos;s REA from NRPC, records station energy, availability and free power accounts, and drafts that month&apos;s bill for every station ready to bill. Months run oldest first so each bill carries the year&apos;s cumulative energy; nothing is issued directly.
              </p>
            </div>

            <div>
              <h4 style={{ margin: '0 0 6px', fontSize: '14px', fontWeight: 600, color: '#0f172a' }}>
                How to copy REA PDF links from NRPC
              </h4>
              <ol style={{ margin: 0, paddingLeft: 20 }}>
                <li>Open <strong>nrpc.gov.in</strong> in your browser.</li>
                <li>Navigate to <strong>Commercial → Regional Energy Accounts → Provisional REA</strong>.</li>
                <li>Copy the PDF link of each month (e.g. <code>https://nrpc.gov.in/allfile/...REA0826_P.pdf</code>).</li>
                <li>Paste the copied links into the text box above — one per line.</li>
              </ol>
            </div>

            <div>
              <h4 style={{ margin: '0 0 6px', fontSize: '14px', fontWeight: 600, color: '#0f172a' }}>
                Date Range & Billing Sequence
              </h4>
              <ul style={{ margin: 0, paddingLeft: 20 }}>
                <li>Leave the months blank to bill exactly the months of the pasted links.</li>
                <li>Or choose From/To months starting from the first month of the financial year that is not yet billed — a later month is only drafted once every preceding month has been drafted.</li>
              </ul>
            </div>

            <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '10px 14px', fontSize: '13.5px', color: '#64748b' }}>
              <strong>Automatic Sweep:</strong> The same run happens automatically after each scheduled REA scan. This desk form is reserved for months the automated scan could not reach, or for links the scan does not yet have.
            </div>
          </div>
        </Modal>
      )}
    </Card>
  );
}
