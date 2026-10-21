import React, { useEffect, useState } from 'react';
import api from '../../api/client.js';
import { Table, Badge, Modal, fmtNumber } from '../../components/ui.jsx';

// What the scheduled NRPC scan fetched, read and recorded. The scan runs on a
// cron with no one watching it; without this a month that never arrived, or
// whose PDF would not read, shows only as a bill that was never drafted.

const FETCH_TONE = { PROCESSED: 'APPROVED', FAILED: 'REJECTED' };

// rea_fetch_log keeps SQLite's UTC "YYYY-MM-DD HH:MM:SS".
const at = (s) => (s ? new Date(`${String(s).replace(' ', 'T')}Z`).toLocaleString('en-IN') : '—');

/** One line on what a manual scan did, for the desk to read after clicking. */
export function describeScan({ scan, draft }) {
  const parts = [];
  if (!scan.newMonths) parts.push('No new REA on the NRPC site — every published month is already fetched.');
  else parts.push(`Found ${scan.newMonths} new month(s): fetched ${scan.downloaded}, recorded ${scan.records} station figure(s).`);
  if (scan.errors?.length) parts.push(`Problems: ${scan.errors.map((e) => (e.month ? `${e.month}: ${e.error}` : e.error || String(e))).join('; ')}.`);
  if (draft?.created?.length) parts.push(`Drafted ${draft.created.length} bill(s): ${draft.created.join(', ')}.`);
  else if (draft?.skipped) parts.push(`No bills drafted — ${draft.skipped}.`);
  else if (draft?.error) parts.push(`Bill drafting failed: ${draft.error}.`);
  return { tone: scan.errors?.length || draft?.error ? 'warn' : 'ok', text: parts.join(' ') };
}

export default function ReaFetchLog({ onScanned }) {
  const [data, setData] = useState(null);
  const [loadErr, setLoadErr] = useState('');
  const [scanning, setScanning] = useState(false);
  const [said, setSaid] = useState(null);
  const [open, setOpen] = useState(null);

  const load = () => api.hydroBilling.reaFetchLog({ rpc: 'NRPC' })
    .then((d) => { setData(d); setLoadErr(''); })
    .catch((err) => setLoadErr(err?.response?.data?.error || 'The REA fetch log could not be loaded.'));
  useEffect(() => { load(); }, []);

  async function scanNow() {
    setScanning(true);
    setSaid(null);
    try {
      const res = await api.hydroBilling.reaScan();
      setSaid(describeScan(res));
      onScanned?.();
    } catch (err) {
      setSaid({ tone: 'error', text: err?.response?.data?.error || 'The NRPC scan could not be run.' });
    } finally {
      setScanning(false);
      load();
    }
  }

  const status = data?.status;
  const log = data?.log || [];
  const busy = scanning || data?.scanning;

  return (
    <section style={{ marginTop: 24 }} aria-labelledby="rea-fetch-log-title">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
        <div>
          <h4 id="rea-fetch-log-title" style={{ margin: 0 }}>REA fetch log — NRPC</h4>
          <div style={{ fontSize: 13, color: 'var(--slate-500)', marginTop: 2 }}>
            The scheduled scan runs at 06:00 IST daily on the 1st–10th, then every third day.
            {status && <> Fetched: <strong>{status.total_processed}</strong> · Failed: <strong>{status.total_failed}</strong>
              {status.latest_fetch && <> · Last: {status.latest_fetch.period_month} on {at(status.latest_fetch.fetched_at)}</>}</>}
          </div>
        </div>
        <button type="button" className="btn btn-primary btn-sm" onClick={scanNow} disabled={busy}>
          {busy ? 'Scanning NRPC…' : 'Scan NRPC now'}
        </button>
      </div>

      {said && (
        <div className={`alert ${said.tone === 'error' ? 'alert-error' : said.tone === 'warn' ? 'alert-warning' : 'alert-success'}`} role="status" style={{ marginBottom: 10 }}>
          {said.text}
        </div>
      )}
      {loadErr && <div className="alert alert-error" role="alert">{loadErr}</div>}

      <Table
        caption="Regional Energy Accounts fetched from NRPC"
        loading={!data && !loadErr}
        emptyMessage={data ? 'The scan has not fetched any REA yet.' : 'Loading…'}
        rows={log}
        columns={[
          { key: 'period_month', header: 'Month' },
          { key: 'data_type', header: 'Type', render: (r) => (r.data_type === 'FINAL' ? 'Final' : 'Provisional') },
          { key: 'status', header: 'Status', render: (r) => <Badge status={FETCH_TONE[r.status] || 'PENDING'} label={r.status} /> },
          {
            key: 'stations',
            header: 'Station records',
            render: (r) => (r.stations.length
              ? <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(r)}>View {r.stations.length}</button>
              : (r.status === 'PROCESSED' ? '0' : '—')),
          },
          {
            key: 'pdf',
            header: 'REA PDF',
            render: (r) => (r.has_pdf
              ? <a href={api.hydroBilling.reaFetchPdfUrl(r.id)} target="_blank" rel="noreferrer" title={r.pdf_url || undefined}>Download PDF</a>
              : '—'),
          },
          { key: 'fetched_at', header: 'Fetched at', render: (r) => at(r.fetched_at) },
          {
            key: 'error_message',
            header: 'Fail reason',
            render: (r) => (r.error_message ? <span style={{ color: 'var(--red-deep)' }}>{r.error_message}</span> : '—'),
          },
        ]}
      />

      <Modal open={!!open} onClose={() => setOpen(null)} title={open ? `NRPC REA ${open.period_month} (${open.data_type === 'FINAL' ? 'Final' : 'Provisional'}) — station records` : ''}>
        {open && (
          <Table
            caption="Station figures recorded from this REA"
            rows={open.stations}
            columns={[
              { key: 'station_name', header: 'Station', render: (s) => s.station_name || s.contract_no },
              { key: 'contract_no', header: 'Contract' },
              { key: 'energy_mwh', header: 'Energy (MWh)', render: (s) => fmtNumber(s.energy_mwh, 2) },
              { key: 'availability_percent', header: 'Availability %', render: (s) => (s.availability_percent != null ? fmtNumber(s.availability_percent, 2) : '—') },
              { key: 'free_energy_mwh', header: 'Free energy (MWh)', render: (s) => (s.free_energy_mwh != null ? fmtNumber(s.free_energy_mwh, 2) : '—') },
              { key: 'status', header: 'Status', render: (s) => <Badge status={s.status} /> },
            ]}
          />
        )}
      </Modal>
    </section>
  );
}
