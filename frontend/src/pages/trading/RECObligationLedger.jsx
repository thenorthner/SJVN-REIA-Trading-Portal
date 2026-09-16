import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../api/client.js';
import { PageHeader, Card, Table, Badge, Modal, StatCard, Field, fmtNumber, fmtCurrency } from '../../components/ui.jsx';
import { fmtDate } from '../../datetime.js';

// CP-83-85 §5 step 6 — the REC purchase and sale ledger, built from the
// exchange's own obligation report instead of retyped off it.
//
// The file's column headings are not published anywhere SJVN holds, so an
// upload is shown before it is committed: which column fed which field, which
// headings were ignored, which rows were not trades, and which amounts this
// platform computed rather than read. A figure the exchange stated and one
// worked out here are never drawn the same way.

const DIFF_LABEL = {
  SALE_NOT_BOOKED: 'Settled at the exchange, not booked against any lot',
  QTY_MISMATCH: 'Quantity disagrees with the REC ledger',
  RATE_MISMATCH: 'Rate disagrees with the REC ledger',
  BOOKED_NOT_IN_REPORT: 'Booked here, missing from this report',
};
const DIFF_TONE = {
  SALE_NOT_BOOKED: 'warning',
  QTY_MISMATCH: 'danger',
  RATE_MISMATCH: 'danger',
  BOOKED_NOT_IN_REPORT: 'warning',
};

const INSTRUMENT_LABEL = { SOLAR: 'Solar', NON_SOLAR: 'Non-solar' };

export default function RECObligationLedger() {
  const [ledger, setLedger] = useState(null);
  const [uploads, setUploads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(null);
  const [pendingFile, setPendingFile] = useState(null);
  const [platform, setPlatform] = useState('IEX');
  const [filters, setFilters] = useState({ from: '', to: '', side: '' });
  const [viewingUpload, setViewingUpload] = useState(null);
  const fileRef = useRef(null);

  const load = useCallback((f = filters) => {
    const params = {};
    if (f.from) params.from = f.from;
    if (f.to) params.to = f.to;
    if (f.side) params.side = f.side;
    return Promise.all([api.recObligations.ledger(params), api.recObligations.uploads()])
      .then(([l, u]) => { setLedger(l); setUploads(Array.isArray(u) ? u : []); })
      .catch((err) => setError(err?.response?.data?.error || 'Could not load the REC obligation ledger.'))
      .finally(() => setLoading(false));
  }, [filters]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!viewingUpload) return undefined;
    let live = true;
    api.recObligations.upload(viewingUpload.id)
      .then((d) => { if (live) setViewingUpload((cur) => (cur && cur.id === d.upload.id ? { ...cur, ...d } : cur)); })
      .catch(() => {});
    return () => { live = false; };
  }, [viewingUpload?.id]);

  // Nothing is written until the desk has seen what the file was read as.
  const choose = async (file) => {
    if (!file) return;
    setError('');
    setBusy(true);
    setPendingFile(file);
    try {
      setPreview(await api.recObligations.upload_(file, { platform, dry_run: true }));
    } catch (err) {
      setPreview(null);
      setPendingFile(null);
      setError(err?.response?.data?.error || 'That file could not be read.');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const commit = async () => {
    if (!pendingFile) return;
    setBusy(true);
    setError('');
    try {
      const result = await api.recObligations.upload_(pendingFile, { platform, dry_run: false });
      setPreview({ ...result, committed: true });
      setPendingFile(null);
      await load();
    } catch (err) {
      setError(err?.response?.data?.error || 'The upload failed.');
    } finally {
      setBusy(false);
    }
  };

  const withdraw = async (row) => {
    setBusy(true);
    try {
      await api.recObligations.withdraw(row.id);
      await load();
      setViewingUpload(null);
    } catch (err) {
      setError(err?.response?.data?.error || 'The upload could not be withdrawn.');
    } finally {
      setBusy(false);
    }
  };

  const s = ledger?.summary;
  const differences = ledger?.reconciliation || [];

  const lineColumns = [
    { key: 'trade_date', header: 'Session', render: (r) => fmtDate(r.trade_date) },
    { key: 'side', header: 'Side', render: (r) => <Badge type={r.side === 'BUY' ? 'info' : 'success'}>{r.side === 'BUY' ? 'Purchase' : 'Sale'}</Badge> },
    { key: 'instrument', header: 'Instrument', render: (r) => INSTRUMENT_LABEL[r.instrument] || r.instrument || '—' },
    { key: 'quantity', header: 'RECs', render: (r) => fmtNumber(r.quantity, 0) },
    { key: 'price_per_rec', header: 'Rate (₹/REC)', render: (r) => (r.price_per_rec == null ? '—' : fmtNumber(r.price_per_rec)) },
    {
      key: 'trade_value',
      header: 'Value (₹)',
      render: (r) => (
        <span title={r.derived_fields?.includes('trade_value') ? 'Computed here — the report did not carry it' : ''}>
          {fmtCurrency(r.trade_value)}
          {r.derived_fields?.includes('trade_value') ? ' *' : ''}
        </span>
      ),
    },
    { key: 'exchange_fee', header: 'Fee (₹)', render: (r) => (r.exchange_fee == null ? '—' : fmtCurrency(r.exchange_fee)) },
    {
      key: 'net_amount',
      header: 'Net (₹)',
      render: (r) => (
        <span title={r.derived_fields?.includes('net_amount') ? 'Computed here — the report did not carry it' : ''}>
          {fmtCurrency(r.net_amount)}
          {r.derived_fields?.includes('net_amount') ? ' *' : ''}
        </span>
      ),
    },
    { key: 'settlement_date', header: 'Settles', render: (r) => (r.settlement_date ? fmtDate(r.settlement_date) : '—') },
    { key: 'reference_no', header: 'Reference', render: (r) => r.reference_no || '—' },
  ];

  return (
    <div>
      <PageHeader
        title="REC Purchase & Sale Ledger"
        subtitle="Built from the exchange's obligation report, and checked against the certificates booked against our own lots"
        actions={(
          <a className="btn btn-outline" href="/api/rec-obligations/template" download>Column template</a>
        )}
      />

      {error && <div className="alert alert-error" role="alert">{error}</div>}

      <div className="kpi-grid">
        <StatCard label="RECs sold" value={fmtNumber(s?.sold_qty || 0, 0)} tone="green" hint={s?.sale_value ? `${fmtCurrency(s.sale_value)} traded` : 'Nothing uploaded yet'} />
        <StatCard label="RECs bought" value={fmtNumber(s?.bought_qty || 0, 0)} tone="blue" hint={s?.purchase_value ? `${fmtCurrency(s.purchase_value)} traded` : ''} />
        <StatCard label="Net settlement" value={fmtCurrency(s?.net_amount || 0)} tone={(s?.net_amount || 0) >= 0 ? 'green' : 'amber'} hint="Sales received less purchases paid, after exchange fees" />
        <StatCard
          label="Disagreeing with the REC ledger"
          value={fmtNumber(differences.length, 0)}
          tone={differences.length ? 'amber' : 'default'}
          hint={differences.length ? 'Each needs the desk to correct one side' : `${fmtNumber(s?.session_count || 0, 0)} session(s) on record`}
        />
      </div>

      <Card title="Upload the obligation report" style={{ marginBottom: 20 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr', gap: 16, alignItems: 'end' }}>
          <Field label="Exchange">
            <select className="input" value={platform} onChange={(e) => setPlatform(e.target.value)}>
              <option value="IEX">IEX</option>
              <option value="PXIL">PXIL</option>
              <option value="HPX">HPX</option>
            </select>
          </Field>
          <Field label="Report file (.xlsx, .xls or .csv)">
            <input
              ref={fileRef}
              type="file"
              className="input"
              accept=".xlsx,.xls,.csv"
              disabled={busy}
              onChange={(e) => choose(e.target.files?.[0])}
            />
          </Field>
        </div>
        <p className="muted" style={{ marginTop: 12, fontSize: 12 }}>
          The file is read by column name, not by position. Nothing is saved until you have seen
          what it was read as. Uploading the same file twice is refused; a corrected report updates
          the trades it restates.
        </p>
      </Card>

      {differences.length > 0 && (
        <div className="alert alert-warning" role="alert">
          <strong>{DIFF_LABEL[differences[0].kind] || differences[0].kind}: </strong>
          {differences[0].detail}
          {differences.length > 1 && ` ${differences.length - 1} more session(s) disagree.`}
        </div>
      )}

      <Card title="Sessions on record" style={{ marginBottom: 20 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', gap: 16, alignItems: 'end' }}>
          <Field label="From (session)">
            <input type="date" className="input" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} />
          </Field>
          <Field label="To (session)">
            <input type="date" className="input" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} />
          </Field>
          <Field label="Side">
            <select className="input" value={filters.side} onChange={(e) => setFilters({ ...filters, side: e.target.value })}>
              <option value="">Purchases and sales</option>
              <option value="SELL">Sales only</option>
              <option value="BUY">Purchases only</option>
            </select>
          </Field>
          <button type="button" className="btn btn-outline" onClick={() => load()} disabled={busy}>Apply</button>
        </div>
      </Card>

      <Card style={{ padding: 0 }}>
        <Table
          columns={lineColumns}
          data={ledger?.lines || []}
          loading={loading}
          emptyMessage="No obligation report has been uploaded yet."
        />
      </Card>
      {(ledger?.lines || []).some((l) => l.derived_fields?.length) && (
        <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
          * computed here from quantity, rate and the exchange&apos;s charges — the report did not carry that figure.
        </p>
      )}

      {uploads.length > 0 && (
        <Card title="Reports uploaded" style={{ marginTop: 20, padding: 0 }}>
          <Table
            columns={[
              { key: 'file_name', header: 'File', render: (r) => <strong>{r.file_name}</strong> },
              { key: 'platform', header: 'Exchange' },
              {
                key: 'sessions',
                header: 'Sessions',
                render: (r) => (r.session_from === r.session_to ? fmtDate(r.session_from) : `${fmtDate(r.session_from)} – ${fmtDate(r.session_to)}`),
              },
              { key: 'line_count', header: 'Trades', render: (r) => fmtNumber(r.line_count, 0) },
              { key: 'sold_qty', header: 'Sold', render: (r) => fmtNumber(r.sold_qty, 0) },
              { key: 'bought_qty', header: 'Bought', render: (r) => fmtNumber(r.bought_qty, 0) },
              { key: 'created_at', header: 'Uploaded', render: (r) => `${fmtDate(r.created_at)}${r.uploaded_by ? ` · ${r.uploaded_by}` : ''}` },
              {
                key: 'actions',
                header: 'Actions',
                render: (r) => <button type="button" className="btn btn-xs btn-outline" onClick={() => setViewingUpload(r)}>View</button>,
              },
            ]}
            data={uploads}
            emptyMessage=""
          />
        </Card>
      )}

      {preview && (
        <Modal
          open
          onClose={() => { setPreview(null); setPendingFile(null); }}
          title={preview.committed ? 'Report uploaded' : `Read from ${preview.file_name || 'the file'}`}
          width={900}
        >
          <div style={{ display: 'grid', gap: 18 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, fontSize: 13 }}>
              <div><strong>Sheet:</strong> {preview.sheet}</div>
              <div><strong>Exchange:</strong> {preview.platform}</div>
              <div><strong>Sessions:</strong> {fmtDate(preview.session_from)} – {fmtDate(preview.session_to)}</div>
              <div><strong>Trades read:</strong> {fmtNumber(preview.lines_read, 0)}</div>
              <div><strong>Sold:</strong> {fmtNumber(preview.totals?.sold_qty, 0)} REC(s)</div>
              <div><strong>Bought:</strong> {fmtNumber(preview.totals?.bought_qty, 0)} REC(s)</div>
            </div>

            {preview.committed && (
              <div className="alert alert-success" role="status">
                {fmtNumber(preview.lines_created, 0)} new trade(s) recorded
                {preview.lines_updated ? `, ${fmtNumber(preview.lines_updated, 0)} restated from an earlier report` : ''}.
              </div>
            )}

            {(preview.warnings || []).length > 0 && (
              <div className="alert alert-warning" role="alert">
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {preview.warnings.map((w) => <li key={w}>{w}</li>)}
                </ul>
              </div>
            )}

            <div>
              <h4 style={{ margin: '0 0 8px' }}>Columns read</h4>
              <div style={{ fontSize: 13 }}>
                {(preview.columns_mapped || []).map((c) => (
                  <div key={c.column}>
                    <code>{c.column}</code> → {c.field.replace(/_/g, ' ')}
                  </div>
                ))}
              </div>
              {(preview.columns_ignored || []).length > 0 && (
                <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
                  Ignored: {preview.columns_ignored.join(', ')}. If one of these holds a figure that
                  matters, it needs to be added to the parser before it can be relied on.
                </p>
              )}
            </div>

            {(preview.skipped || []).length > 0 && (
              <div>
                <h4 style={{ margin: '0 0 8px' }}>Rows left out</h4>
                <Table
                  columns={[
                    { key: 'row_no', header: 'Row' },
                    { key: 'reason', header: 'Why' },
                    { key: 'cells', header: 'As it reads', render: (r) => r.cells.filter(Boolean).join(' | ') },
                  ]}
                  data={preview.skipped.map((r, i) => ({ id: `skip-${i}`, ...r }))}
                  emptyMessage=""
                />
              </div>
            )}

            {(preview.reconciliation || []).length > 0 && (
              <div>
                <h4 style={{ margin: '0 0 8px' }}>Against the REC ledger</h4>
                <ul style={{ fontSize: 13, paddingLeft: 18 }}>
                  {preview.reconciliation.map((d, i) => (
                    <li key={`${d.kind}-${d.trade_date}-${i}`} style={{ marginBottom: 6 }}>
                      <Badge type={DIFF_TONE[d.kind] || 'warning'}>{DIFF_LABEL[d.kind] || d.kind}</Badge>
                      <span style={{ marginLeft: 8 }}>{d.detail}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {!preview.committed && (
              <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
                <button type="button" className="btn btn-outline" onClick={() => { setPreview(null); setPendingFile(null); }}>Cancel</button>
                <button type="button" className="btn btn-primary" onClick={commit} disabled={busy}>
                  {busy ? 'Saving…' : `Record ${fmtNumber(preview.lines_read, 0)} trade(s)`}
                </button>
              </div>
            )}
          </div>
        </Modal>
      )}

      {viewingUpload && (
        <Modal open onClose={() => setViewingUpload(null)} title={viewingUpload.file_name} width={900}>
          <div style={{ display: 'grid', gap: 18 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, fontSize: 13 }}>
              <div><strong>Exchange:</strong> {viewingUpload.platform}</div>
              <div><strong>Sheet:</strong> {viewingUpload.sheet_name || '—'}</div>
              <div><strong>Trades:</strong> {fmtNumber(viewingUpload.line_count, 0)}</div>
              <div><strong>Uploaded by:</strong> {viewingUpload.uploaded_by || '—'}</div>
            </div>

            {(viewingUpload.lines || []).length > 0 && (
              <Table columns={lineColumns} data={viewingUpload.lines} emptyMessage="" />
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <p className="muted" style={{ fontSize: 12, margin: 0 }}>
                Withdrawing removes only the trades this report is still the source of — anything a
                later report has since restated stays.
              </p>
              <button type="button" className="btn btn-danger" onClick={() => withdraw(viewingUpload)} disabled={busy}>
                Withdraw this report
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
