import React, { useRef, useCallback, useEffect, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { useNavigate } from 'react-router-dom';
import api from '../api/client.js';
import { Badge, Field, fmtNumber } from './ui.jsx';
import { PreviewModal } from './DocumentManager.jsx';
import { fmtDate, fmtDateTime } from '../datetime.js';

// One period's energy in full, for whoever opens it: the figure and where it
// came from, the month by 15-minute block, and what the counterparty has said
// to it. A seller or buyer answers the figure here; the REIA desk attaches the
// source document, loads the blocks and answers an objection.

const errText = (e) => e.response?.data?.error || e.message;
const mwh = (v) => (v === null || v === undefined ? '—' : `${fmtNumber(v, 3)} MWh`);

function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** The counterparty's answer, as a badge. */
export function ResponseBadge({ row }) {
  if (row.response_status === 'ACCEPTED') return <Badge status="ACTIVE" label="Accepted" />;
  if (row.response_status === 'OBJECTED') {
    if (row.objection_outcome === 'UPHELD') return <Badge status="PENDING" label="Objection upheld" />;
    if (row.objection_outcome === 'REJECTED') return <Badge status="DRAFT" label="Objection not accepted" />;
    return <Badge status="REJECTED" label="Objected" />;
  }
  return row.status === 'VALIDATED'
    ? <Badge status="PENDING" label="Awaiting confirmation" />
    : <span style={{ color: 'var(--slate-500)', fontSize: 13.5 }}>—</span>;
}

function Summary({ d, run, onPreview, setError }) {
  const [file, setFile] = useState(null);
  const [kind, setKind] = useState(/REA|RPC|RLDC|SLDC/i.test(d.source || '') ? 'REA_COPY' : 'JMR_SIGNED');
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  // A counterparty asks SJVN's REIA desk for the paper through Quick Connect:
  // the message opens pre-written, addressed to the desk, and goes when they send it.
  async function askForSource() {
    let to = [];
    try {
      const people = await api.mail.directory('');
      to = people.filter((p) => ['REIA_MAKER', 'REIA_CHECKER'].includes(p.role) && p.company === 'SJVN');
    } catch { /* the composer lets them pick someone */ }
    const period = d.period_month;
    const subject = `Source document for ${period}${d.contract_no ? ` — ${d.contract_no}` : ''}`;
    const bodyHtml = `<p>Dear Sir/Madam,</p><p>Please share the source document (signed Joint Meter Reading or Regional/State Energy Account) for the energy recorded for <strong>${period}</strong>${d.contract_no ? ` under contract <strong>${d.contract_no}</strong>` : ''}, so that we can confirm the figure.</p><p>Regards</p>`;
    navigate('/mail', { state: { compose: { title: 'Ask SJVN for the source document', to, subject, bodyHtml } } });
  }
  const item = (label, value) => (
    <div className="detail-item"><span className="detail-label">{label}</span><span className="detail-value">{value}</span></div>
  );

  async function attach(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('contract_id', d.contract_id);
      fd.append('document_type', kind);
      fd.append('category', 'RECORD');
      fd.append('title', `${kind === 'JMR_SIGNED' ? 'Signed JMR' : 'Energy account'} — ${d.period_month}`);
      const up = await api.documents.upload(fd);
      await run(() => api.energyRecords.attachSource(d.id, up.version_id), () => setFile(null));
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="detail-grid mb-0">
        {item('Contract', d.contract_no)}
        {item('Period', d.period_month)}
        {item('Type', <Badge status={d.data_type} />)}
        {item('Status', <Badge status={d.status} />)}
        {item('Energy', <strong>{mwh(d.energy_mwh)}</strong>)}
        {item('CUF', d.cuf_percent != null
          ? <>{fmtNumber(d.cuf_percent)}%{d.cuf_computed ? <span style={{ fontSize: 13, color: 'var(--slate-500)' }}> (worked out from energy and capacity)</span> : ''}</>
          : '—')}
        {d.min_cuf_percent != null && item('Contractual minimum CUF', `${fmtNumber(d.min_cuf_percent)}%`)}
        {d.lock_override_reason && item('Locked with a reason', <>{d.lock_override_reason}{d.lock_override_by ? <span style={{ fontSize: 13, color: 'var(--slate-500)' }}> — {d.lock_override_by}</span> : ''}</>)}
        {item('Availability', d.availability_percent != null ? `${fmtNumber(d.availability_percent)}%` : '—')}
        {item('Source', d.source)}
        {item('Bill', d.invoice ? `${d.invoice.invoice_no} (${d.invoice.status})` : 'Not billed yet')}
      </div>

      {d.comparison && (
        <>
          <div className="section-title" style={{ marginTop: 18 }}>Provisional against final</div>
          <div className="detail-grid mb-0">
            {item('Provisional', mwh(d.comparison.provisional_mwh))}
            {item('Final', mwh(d.comparison.final_mwh))}
            {item('Difference', (
              <strong style={{ color: d.comparison.difference_mwh < 0 ? 'var(--on-red)' : d.comparison.difference_mwh > 0 ? 'var(--on-green)' : 'inherit' }}>
                {d.comparison.difference_mwh > 0 ? '+' : ''}{fmtNumber(d.comparison.difference_mwh, 3)} MWh
                {d.comparison.difference_pct != null ? ` (${d.comparison.difference_pct > 0 ? '+' : ''}${d.comparison.difference_pct}%)` : ''}
              </strong>
            ))}
          </div>
        </>
      )}

      {d.deviation_notes && (
        <>
          <div className="section-title" style={{ marginTop: 18 }}>SJVN's validation note</div>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--slate-600)', lineHeight: 1.5 }}>{d.deviation_notes}</p>
        </>
      )}

      <div className="section-title" style={{ marginTop: 18 }}>Source document</div>
      {d.source_document ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13.5 }}><strong>{d.source_document.title}</strong> · {d.source_document.file_name}</span>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => onPreview(d.source_document.version_id, d.source_document.file_name)}>View source document</button>
        </div>
      ) : (
        <>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--slate-500)' }}>
            {d.can_manage ? 'No source document is attached to this period yet.' : 'SJVN has not attached the source document for this period yet. You can ask for it in a message to the desk, or through an objection or a notice on the contract.'}
          </p>
          {!d.can_manage && (
            <button type="button" className="btn btn-outline btn-sm" style={{ marginTop: 10 }} onClick={askForSource}>
              Ask SJVN for the source document
            </button>
          )}
        </>
      )}
      {d.rea && (
        <p style={{ margin: '8px 0 0', fontSize: 13 }}>
          The {d.rea.rpc_source} energy account for this period, as published: <a href={d.rea.pdf_url} target="_blank" rel="noopener noreferrer">open on the RPC's site</a>
        </p>
      )}
      {d.can_manage && (
        <form className="cw-form" onSubmit={attach}>
          <div className="form-grid">
            <Field label={d.source_document ? 'Replace with' : 'Attach the document this figure was taken from'}>
              <input type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={(e) => setFile(e.target.files[0])} />
            </Field>
            <Field label="It is">
              <select value={kind} onChange={(e) => setKind(e.target.value)}>
                <option value="JMR_SIGNED">A signed Joint Meter Reading</option>
                <option value="REA_COPY">A regional / state energy account</option>
              </select>
            </Field>
          </div>
          <div className="form-actions"><button type="submit" className="btn btn-primary btn-sm" disabled={!file || busy}>{busy ? 'Attaching…' : 'Attach'}</button></div>
        </form>
      )}
    </div>
  );
}

function Blocks({ d, reload, setError }) {
  const [data, setData] = useState(null);
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  const load = useCallback((date) => api.energyRecords.blocks(d.id, date).then(setData).catch((e) => setError(errText(e))), [d.id, setError]);
  useEffect(() => { load(); }, [load]);

  async function upload(e) {
    e.preventDefault();
    setBusy(true);
    try {
      setResult(await api.energyRecords.uploadBlocks(d.id, file));
      setFile(null);
      setError('');
      await load();
      reload();
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  }

  if (!data) return <div style={{ padding: 20 }}>Loading…</div>;
  const has = data.days.length > 0;

  return (
    <div>
      {d.can_manage && (
        <form className="cw-form" onSubmit={upload} style={{ marginTop: 0 }}>
          <Field label={`${has ? 'Replace' : 'Load'} the 15-minute blocks for ${d.period_month} (Excel or CSV: Date, Block 1–96, Scheduled MWh, Actual MWh)`}>
            <input type="file" accept=".xlsx,.xls,.csv" onChange={(e) => setFile(e.target.files[0])} />
          </Field>
          <div className="form-actions">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => api.energyRecords.blocksTemplate().then((b) => saveBlob(b, 'energy-blocks-template.xlsx'))}>Download template</button>
            <button type="submit" className="btn btn-primary btn-sm" disabled={!file || busy}>{busy ? 'Loading…' : 'Load blocks'}</button>
          </div>
          {result && <div className="alert alert-success" style={{ marginTop: 10 }}>{result.loaded} blocks over {result.days} day(s) loaded — {mwh(result.actual_mwh)}.</div>}
          {result?.warning && <div className="alert alert-error">{result.warning}</div>}
        </form>
      )}

      {!has ? (
        <div className="empty-cell" style={{ padding: 28 }}>
          No 15-minute data has been loaded for this period.
          {!d.can_manage && <div style={{ marginTop: 6, fontSize: 13.5 }}>The monthly figure above is what is billed. Block-wise data appears here once SJVN loads the SLDC / RLDC block statement.</div>}
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
            <span style={{ fontSize: 13, color: 'var(--slate-600)' }}>
              {data.days.length} day(s) loaded · scheduled {mwh(d.blocks.scheduled_mwh)} · actual {mwh(d.blocks.actual_mwh)}
            </span>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => api.energyRecords.blocksXlsx(d.id).then((b) => saveBlob(b, `blocks-${d.period_month}.xlsx`)).catch((e) => setError(errText(e)))}>
              Download month as Excel
            </button>
          </div>

          <div style={{ width: '100%', height: 200 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.days} margin={{ top: 4, right: 8, left: 0, bottom: 0 }} onClick={(e) => e?.activeLabel && load(e.activeLabel)}>
                <CartesianGrid stroke="var(--border)" vertical={false} />
                <XAxis dataKey="date" tickFormatter={(v) => v.slice(8)} tick={{ fontSize: 13 }} />
                <YAxis tick={{ fontSize: 13 }} width={48} />
                <Tooltip formatter={(v) => `${fmtNumber(v, 3)} MWh`} />
                <Legend wrapperStyle={{ fontSize: 13.5 }} />
                <Bar dataKey="scheduled_mwh" name="Scheduled" fill="url(#eliteSlate)" isAnimationActive={false} />
                <Bar dataKey="actual_mwh" name="Actual" fill="url(#eliteBlue)" isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '14px 0 8px' }}>
            <label htmlFor="block-day" style={{ fontSize: 13, fontWeight: 600 }}>Day</label>
            <select id="block-day" value={data.date || ''} onChange={(e) => load(e.target.value)}>
              {data.days.map((x) => <option key={x.date} value={x.date}>{fmtDate(x.date)} — {fmtNumber(x.actual_mwh, 3)} MWh</option>)}
            </select>
            <span style={{ fontSize: 13.5, color: 'var(--slate-500)' }}>{data.blocks.length} of 96 blocks</span>
          </div>
          <div className="table-wrap" style={{ maxHeight: 320, overflowY: 'auto' }}>
            <table className="data-table" style={{ margin: 0 }}>
              <thead>
                <tr>
                  <th scope="col">Block</th><th scope="col">Time</th>
                  <th scope="col" style={{ textAlign: 'right' }}>Scheduled (MWh)</th>
                  <th scope="col" style={{ textAlign: 'right' }}>Actual (MWh)</th>
                  <th scope="col" style={{ textAlign: 'right' }}>Deviation (MWh)</th>
                </tr>
              </thead>
              <tbody>
                {data.blocks.map((b) => (
                  <tr key={b.block_no}>
                    <td>{b.block_no}</td><td>{b.time}</td>
                    <td style={{ textAlign: 'right' }}>{b.scheduled_mwh ?? '—'}</td>
                    <td style={{ textAlign: 'right' }}>{b.actual_mwh ?? '—'}</td>
                    <td style={{ textAlign: 'right', color: b.deviation_mwh < 0 ? 'var(--on-red)' : b.deviation_mwh > 0 ? 'var(--on-green)' : 'inherit' }}>
                      {b.deviation_mwh === null ? '—' : `${b.deviation_mwh > 0 ? '+' : ''}${b.deviation_mwh}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function Response({ d, run, onPreview, setError, disputesPath }) {
  const [form, setForm] = useState(null);   // objection: { note, claimed_mwh, file }
  const [answer, setAnswer] = useState(null); // SJVN: { outcome, note }
  const [busy, setBusy] = useState(false);
  const open = d.response_status === 'OBJECTED' && !d.objection_outcome;

  async function object(e) {
    e.preventDefault();
    setBusy(true);
    try {
      let attachment;
      if (form.file) {
        const fd = new FormData();
        fd.append('file', form.file);
        fd.append('contract_id', d.contract_id);
        fd.append('document_type', 'ENERGY_OBJECTION_PROOF');
        fd.append('category', 'RECORD');
        fd.append('title', `Own meter record — ${d.period_month}`);
        attachment = (await api.documents.upload(fd)).version_id;
      }
      await run(() => api.energyRecords.respond(d.id, { response: 'OBJECTED', note: form.note, claimed_mwh: form.claimed_mwh, attachment_version_id: attachment }), () => setForm(null));
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  }

  const disputeUrl = d.invoice && disputesPath
    ? `${disputesPath}?${new URLSearchParams({ invoice: d.invoice.id, reason: 'ENERGY_DATA_MISMATCH', note: `Energy for ${d.period_month} on ${d.contract_no}: recorded ${d.energy_mwh} MWh${d.claimed_mwh != null ? `, our figure ${d.claimed_mwh} MWh` : ''}.` })}`
    : null;

  return (
    <div>
      {!d.response_status && (
        <p style={{ margin: '0 0 12px', fontSize: 13.5, color: 'var(--slate-600)', lineHeight: 1.5 }}>
          {d.can_manage
            ? 'The counterparty has not yet answered this figure.'
            : d.status === 'DRAFT'
              ? 'SJVN is still preparing this period. You can answer it once it has been validated.'
              : <>SJVN has recorded <strong>{mwh(d.energy_mwh)}</strong> for {d.period_month}. Confirm it if it agrees with your own records — your acceptance is kept on record before the bill is raised — or object if it does not.</>}
        </p>
      )}

      {d.response_status === 'ACCEPTED' && (
        <div className="alert alert-success">
          Accepted by {d.response_by_name || 'the counterparty'} on {fmtDateTime(d.response_at)} — {mwh(d.energy_mwh)} for {d.period_month}.
        </div>
      )}

      {d.response_status === 'OBJECTED' && (
        <div className="cw-card" style={{ borderLeft: `4px solid ${open ? '#dc2626' : '#94a3b8'}` }}>
          <strong>Objection</strong>
          <span style={{ marginLeft: 8, fontSize: 13.5, color: 'var(--slate-500)' }}>{d.response_by_name} · {fmtDateTime(d.response_at)}</span>
          <p style={{ margin: '6px 0', fontSize: 13.5, whiteSpace: 'pre-wrap' }}>{d.response_note}</p>
          <div style={{ fontSize: 13.5, color: 'var(--slate-600)', display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <span>On record: {mwh(d.energy_mwh)}</span>
            {d.claimed_mwh != null && <span>Counterparty's figure: <strong>{mwh(d.claimed_mwh)}</strong> ({d.claimed_mwh - d.energy_mwh > 0 ? '+' : ''}{fmtNumber(d.claimed_mwh - d.energy_mwh, 3)})</span>}
            {d.response_version_id && <button type="button" className="btn-link" onClick={() => onPreview(d.response_version_id, 'meter-record')}>View their record</button>}
          </div>
          {d.objection_outcome && (
            <div style={{ marginTop: 8, fontSize: 13, color: d.objection_outcome === 'UPHELD' ? 'var(--on-green)' : 'var(--on-red)' }}>
              <strong>{d.objection_outcome === 'UPHELD' ? 'SJVN agrees — the record is to be corrected' : 'SJVN has not accepted the objection'}</strong>
              {' '}· {d.objection_resolved_by_name} · {fmtDateTime(d.objection_resolved_at)} — {d.objection_resolution}
            </div>
          )}
        </div>
      )}

      {d.can_respond && !form && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
          <button className="btn btn-success" onClick={() => window.confirm(`Accept ${d.energy_mwh} MWh for ${d.period_month}? This is recorded as your agreement to the figure and cannot be undone.`) && run(() => api.energyRecords.respond(d.id, { response: 'ACCEPTED' }))}>
            {open ? 'Withdraw objection and accept' : 'Accept & confirm'}
          </button>
          {!d.response_status && <button className="btn btn-danger" onClick={() => setForm({ note: '', claimed_mwh: '', file: null })}>Object to this figure</button>}
        </div>
      )}

      {form && (
        <form className="cw-form" onSubmit={object}>
          <div className="form-grid">
            <Field label="The figure you hold (MWh)"><input type="number" step="any" min="0" value={form.claimed_mwh} onChange={(e) => setForm({ ...form, claimed_mwh: e.target.value })} /></Field>
            <Field label="Your meter record (optional)"><input type="file" onChange={(e) => setForm({ ...form, file: e.target.files[0] })} /></Field>
          </div>
          <Field label="What is wrong with the recorded figure" required>
            <textarea required rows={3} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="e.g. Our check meter reads 9,600 MWh for the month; the JMR of 2 June shows the same." />
          </Field>
          <div className="form-actions"><button type="button" className="btn btn-ghost" onClick={() => setForm(null)}>Cancel</button><button type="submit" className="btn btn-danger" disabled={busy}>{busy ? 'Sending…' : 'Send objection to SJVN'}</button></div>
        </form>
      )}

      {!d.can_manage && (
        <div style={{ marginTop: 18, fontSize: 13, color: 'var(--slate-600)' }}>
          <div className="section-title">Dispute on the bill</div>
          {disputeUrl
            ? <>This period was billed on <strong>{d.invoice.invoice_no}</strong>. A dispute is raised against the bill: <a href={disputeUrl} className="btn btn-secondary btn-sm" style={{ marginLeft: 6 }}>Raise dispute on {d.invoice.invoice_no}</a></>
            : 'This period has not been billed yet, so there is no bill to dispute. Object to the figure above instead; SJVN has to answer the objection before the period is locked for billing.'}
        </div>
      )}

      {d.can_manage && open && !answer && (
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button className="btn btn-success btn-sm" onClick={() => setAnswer({ outcome: 'UPHELD', note: '' })}>Agree — record to be corrected</button>
          <button className="btn btn-danger btn-sm" onClick={() => setAnswer({ outcome: 'REJECTED', note: '' })}>Not accepted</button>
        </div>
      )}
      {answer && (
        <form className="cw-form" onSubmit={(e) => { e.preventDefault(); run(() => api.energyRecords.resolveObjection(d.id, answer), () => setAnswer(null)); }}>
          <Field label={answer.outcome === 'UPHELD' ? 'What will be corrected' : 'Why the objection is not accepted'} required>
            <textarea required rows={3} value={answer.note} onChange={(e) => setAnswer({ ...answer, note: e.target.value })} />
          </Field>
          {answer.outcome === 'UPHELD' && <p style={{ margin: '0 0 10px', fontSize: 13.5, color: 'var(--slate-600)' }}>This records the decision. Enter the corrected figure as a new record for the period.</p>}
          <div className="form-actions"><button type="button" className="btn btn-ghost" onClick={() => setAnswer(null)}>Cancel</button><button type="submit" className="btn btn-primary">Send answer</button></div>
        </form>
      )}
    </div>
  );
}

/**
 * @param id            the energy record
 * @param onChanged     called after anything changes, so a list behind can refresh
 * @param startTab      SUMMARY | BLOCKS | RESPONSE
 * @param disputesPath  where this user's disputes page is, for the link onto a bill
 */
export default function EnergyRecordDetail({ id, onChanged, startTab = 'SUMMARY', disputesPath }) {
  const [d, setD] = useState(null);
  const [tab, setTab] = useState(startTab);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState(null);

  const load = useCallback(() => api.energyRecords.get(id).then(setD).catch((e) => setError(errText(e))), [id]);
  useEffect(() => { load(); }, [load]);

  const lockRef = useRef(false);
  const run = useCallback(async (fn, after) => {
    // A second click before the first has answered must not send the action again.
    if (lockRef.current) return;
    lockRef.current = true;
    try {
      await fn();
      setError('');
      after?.();
      await load();
      onChanged?.();
    } catch (e) {
      setError(errText(e));
    } finally {
      lockRef.current = false;
    }
  }, [load, onChanged]);

  if (!d) return <div style={{ padding: 24 }}>{error || 'Loading…'}</div>;
  const openObjection = d.response_status === 'OBJECTED' && !d.objection_outcome;
  const needsAnswer = d.can_manage ? openObjection : d.can_respond && !d.response_status && d.status === 'VALIDATED';

  return (
    <div>
      <div className="nb-tabs" role="tablist">
        {[['SUMMARY', 'Summary & source'], ['BLOCKS', `15-minute blocks${d.blocks.count ? '' : ' (none)'}`], ['RESPONSE', d.can_manage ? 'Counterparty\'s answer' : 'Accept or object']].map(([key, label]) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key} className={`nb-tab ${tab === key ? 'active' : ''}`} onClick={() => setTab(key)}>
            {label}{key === 'RESPONSE' && needsAnswer && <span className="cw-dot">1</span>}
          </button>
        ))}
      </div>
      {error && <div className="alert alert-error" role="alert">{error}</div>}
      {tab === 'SUMMARY' && <Summary d={d} run={run} setError={setError} onPreview={(vid, name) => setPreview({ vid, name })} />}
      {tab === 'BLOCKS' && <Blocks d={d} reload={() => { load(); onChanged?.(); }} setError={setError} />}
      {tab === 'RESPONSE' && <Response d={d} run={run} setError={setError} disputesPath={disputesPath} onPreview={(vid, name) => setPreview({ vid, name })} />}
      <PreviewModal open={!!preview} versionId={preview?.vid} fileName={preview?.name} onClose={() => setPreview(null)} />
    </div>
  );
}
