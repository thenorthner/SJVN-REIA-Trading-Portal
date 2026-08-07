import React, { useRef, useState } from 'react';
import { api } from '../../api/client.js';
import { PageHeader, Card, Badge, StatCard } from '../../components/ui.jsx';

// What each counter in the import report means, in the order the import runs.
const REPORT_ROWS = [
  ['entities_created', 'Counterparties created', 'Buyers not already on the platform. A name that resolves to an existing entity is reused rather than duplicated.'],
  ['clients_created', 'Trading clients created', 'One per resolved counterparty.'],
  ['bilaterals_created', 'Deals created', 'One per buyer, grouping that buyer’s open-access applications.'],
  ['bilaterals_skipped', 'Deals already present', 'Skipped, so a re-run does not duplicate.'],
  ['applications_covered', 'Applications covered', 'Rows from the Application Ledger folded into those deals.'],
  ['ists_rates_created', 'ISTS rate windows', 'Effective-dated tariff history derived from the applications.'],
  ['ists_rates_skipped', 'Rate history already present', 'Skipped when the history was imported before.'],
  ['schedule_days_imported', 'Schedule days', 'Day-wise availability, requested and scheduled energy.'],
  ['cashflow_inflows', 'Receivable invoices', 'Bills raised on the buyer.'],
  ['cashflow_outflows', 'Payable invoices', 'Bills received from the seller.'],
  ['tds_created', 'TDS deductions recorded', 'From the monthly TDS sheets.'],
  ['tds_skipped', 'TDS already recorded', 'Skipped, so a re-run does not double-count.'],
];

export default function LedgerImport() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [file, setFile] = useState(null);
  const fileRef = useRef(null);

  async function run(useUpload) {
    setBusy(true); setError(''); setResult(null);
    try {
      const res = useUpload ? await api.ledgerImport.upload(file) : await api.ledgerImport.run();
      setResult(res);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Import failed');
    } finally {
      setBusy(false);
    }
  }

  const report = result?.report;
  const repairs = report?.date_repairs || [];

  return (
    <div>
      <PageHeader
        title="Import Power Trading Ledger"
        subtitle="Loads counterparties, deals, rate history, schedules, invoices and TDS from the ISET ledger workbook"
      />

      <Card title="Run an import">
        <p style={{ fontSize: 14, color: 'var(--slate-600)', marginBottom: 16 }}>
          The import is repeatable — anything already on the platform is skipped or updated rather than duplicated,
          so running it twice is safe.
        </p>

        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <div style={{ flex: '1 1 300px' }}>
            <h4 style={{ fontSize: 14, marginBottom: 8 }}>Use the bundled workbook</h4>
            <p style={{ fontSize: 13, color: 'var(--slate-500)', marginBottom: 12 }}>
              Reads the ledger shipped with the deployment. This is the usual path on a fresh server.
            </p>
            <button className="btn btn-primary" disabled={busy} onClick={() => run(false)}>
              {busy ? 'Importing…' : 'Import bundled ledger'}
            </button>
          </div>

          <div style={{ flex: '1 1 300px' }}>
            <h4 style={{ fontSize: 14, marginBottom: 8 }}>Or upload a newer workbook</h4>
            <p style={{ fontSize: 13, color: 'var(--slate-500)', marginBottom: 12 }}>
              Point at an updated .xlsx to bring in later months.
            </p>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx"
              onChange={e => setFile(e.target.files?.[0] || null)}
              style={{ display: 'block', marginBottom: 10, fontSize: 13 }}
            />
            <button className="btn btn-secondary" disabled={busy || !file} onClick={() => run(true)}>
              {busy ? 'Importing…' : 'Import uploaded file'}
            </button>
          </div>
        </div>

        {error && (
          <div style={{ marginTop: 16, padding: 12, background: '#fef2f2', color: '#b91c1c', borderRadius: 6, fontSize: 14 }}>
            {error}
          </div>
        )}
      </Card>

      {report && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 15, marginBottom: 20 }}>
            <StatCard label="Deals created" value={report.bilaterals_created} hint={`${report.applications_covered} application(s) covered`} />
            <StatCard label="Schedule days" value={report.schedule_days_imported} />
            <StatCard label="Invoices loaded" value={(report.cashflow_inflows || 0) + (report.cashflow_outflows || 0)} hint={`${report.cashflow_inflows} receivable · ${report.cashflow_outflows} payable`} />
            <StatCard label="TDS entries" value={report.tds_created} hint={report.tds_skipped ? `${report.tds_skipped} already recorded` : undefined} />
          </div>

          <Card title={`Import report — source: ${result.source}`}>
            <table className="data-table">
              <thead>
                <tr><th scope="col">What</th><th scope="col">Count</th><th scope="col">Meaning</th></tr>
              </thead>
              <tbody>
                {REPORT_ROWS.map(([key, label, meaning]) => (
                  <tr key={key}>
                    <td>{label}</td>
                    <td><strong>{report[key] ?? 0}</strong></td>
                    <td style={{ fontSize: 12, color: 'var(--slate-500)' }}>{meaning}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <Card title="Data corrections applied">
            <p style={{ fontSize: 13, color: 'var(--slate-600)', marginBottom: 12 }}>
              Two defects in the source workbook are corrected on the way in, and reported here rather than applied silently.
            </p>
            <div style={{ marginBottom: 14 }}>
              <Badge type="primary">Always applied</Badge>
              <p style={{ fontSize: 13, color: 'var(--slate-600)', marginTop: 6 }}>
                Numeric date cells are day/month swapped — the dates were typed DD/MM/YYYY into a workbook reading
                MM/DD/YYYY, so 1 April was stored as 4 January. Every such cell is decoded and swapped back.
              </p>
            </div>
            <div>
              <Badge type={repairs.length ? 'warning' : 'neutral'}>
                {repairs.length ? `${repairs.length} year typo corrected` : 'No year typos found'}
              </Badge>
              {repairs.length > 0 && (
                <table className="data-table" style={{ marginTop: 10 }}>
                  <thead><tr><th scope="col">Sheet</th><th scope="col">Found in file</th><th scope="col">Read as</th></tr></thead>
                  <tbody>
                    {repairs.map((r, i) => (
                      <tr key={i}>
                        <td>{r.sheet}</td>
                        <td style={{ color: 'var(--danger, #b91c1c)' }}>{r.found}</td>
                        <td>{r.used}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
