import React, { useEffect, useState } from 'react';
import * as XLSX from 'xlsx';
import { api } from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { PageHeader, Card, Table, Badge, Modal, Field, fmtNumber } from '../../components/ui.jsx';
import { DocumentManager } from '../../components/DocumentManager.jsx';

const EMPTY_FORM = {
  client_id: '', exchange: 'IEX', product: 'DAM', bid_date: '', delivery_date: '', gate_closure_time: '',
};

const EMPTY_BLOCK = { time_block: 'Block-1', quantum_mw: '', price_per_unit: '' };

// One workspace per exchange energy product, the way PTC separates DAM / GDAM /
// RTM management. Certificate products (REC, ESCERT) have their own modules and
// are intentionally not here. `members` groups the sibling products a tab owns.
const PRODUCT_TABS = [
  { key: 'DAM', label: 'DAM / HP-DAM', short: 'DAM', members: ['DAM', 'HPDAM'], hint: 'Day-ahead · 15-minute delivery blocks' },
  { key: 'GDAM', label: 'GDAM / GTAM', short: 'GDAM', members: ['GDAM', 'GTAM'], hint: 'Green day-ahead / term-ahead · 15-minute blocks' },
  { key: 'RTM', label: 'Real-Time (RTM)', short: 'RTM', members: ['RTM'], hint: 'Intra-day · 30-minute delivery blocks' },
  { key: 'TAM', label: 'Term-Ahead (TAM)', short: 'TAM', members: ['TAM'], hint: 'Term-ahead contracts' },
];

// A bid is "history" once it is decided; everything else is still being worked.
const isHistoryBid = (b) => b.status === 'CLEARED' || b.status === 'REJECTED' || b.approval_status === 'REJECTED';

const BULK_COLUMNS = [
  'client_id', 'exchange', 'product', 'bid_date', 'delivery_date',
  'gate_closure_time', 'time_block', 'quantum_mw', 'price_per_unit',
];

const SHEET_EXT = /\.(xlsx|xlsm|xls)$/i;

/** Admin-configured default premium/discount for a carry-forward route, as form text. */
function ocfDefaultFor(bid, toProduct) {
  const v = bid?.carry_forward_defaults?.[toProduct];
  return Number.isFinite(Number(v)) && Number(v) !== 0 ? String(v) : '';
}

/** Save a blob the browser already holds, without a second unauthenticated request. */
function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Read a real Excel workbook and flatten its first sheet to CSV text. */
async function sheetToCsv(file) {
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new Error('Workbook has no sheets');
  // Dates come back as text so bid_date/delivery_date survive the round trip.
  return XLSX.utils.sheet_to_csv(wb.Sheets[sheetName], { rawNumbers: false });
}

/** Turn an existing bid into paste-ready rows, so a past bid can be re-bid for a new day. */
function bidToRows(bid, overrides = {}) {
  const bidDate = overrides.bid_date || bid.bid_date || '';
  const deliveryDate = overrides.delivery_date || bid.delivery_date || '';
  const lines = [BULK_COLUMNS.join(',')];
  (bid.blocks || []).forEach((b) => {
    lines.push([
      bid.client_id, bid.exchange, bid.product, bidDate, deliveryDate,
      overrides.gate_closure_time ?? (bid.gate_closure_time || ''),
      b.time_block, b.quantum_mw, b.price_per_unit,
    ].join(','));
  });
  return lines.join('\n');
}

// Parse pasted CSV / TSV (Excel copy-paste lands as tab-separated) into row objects.
function parseTabular(text) {
  const lines = text.trim().split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const split = (line) => (line.includes('\t') ? line.split('\t') : line.split(',')).map((c) => c.trim());

  const first = split(lines[0]).map((c) => c.toLowerCase());
  const hasHeader = first.includes('client_id') || first.includes('quantum_mw');
  const headers = hasHeader ? first : BULK_COLUMNS;

  return lines.slice(hasHeader ? 1 : 0).map((line) => {
    const cells = split(line);
    return headers.reduce((row, h, i) => ({ ...row, [h]: cells[i] ?? '' }), {});
  });
}

export default function Bids({ product = 'DAM' }) {
  const { user } = useAuth();
  const [rows, setRows] = useState([]);
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const activeTab = product;
  const [globalClient, setGlobalClient] = useState('');
  const [deliveryDateFilter, setDeliveryDateFilter] = useState('');
  const [appliedDeliveryDate, setAppliedDeliveryDate] = useState('');
  const [bidView, setBidView] = useState('manage');
  const [form, setForm] = useState(EMPTY_FORM);
  const [blocks, setBlocks] = useState([{ ...EMPTY_BLOCK }]);
  const [error, setError] = useState('');
  const [selectedBid, setSelectedBid] = useState(null);

  // Bulk upload
  const [showBulk, setShowBulk] = useState(false);
  const [bulkText, setBulkText] = useState('');
  const [bulkResult, setBulkResult] = useState(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkFileNote, setBulkFileNote] = useState('');
  const [reuseId, setReuseId] = useState('');

  // OCF carry-forward + exchange result
  const [chain, setChain] = useState(null);
  const [resultForm, setResultForm] = useState(null);
  const [syncBusy, setSyncBusy] = useState(false);
  const [ocfForm, setOcfForm] = useState(null);

  function load() {
    setLoading(true);
    api.bids.list().then(setRows).finally(() => setLoading(false));
  }

  useEffect(load, []);
  useEffect(() => { api.tradingClients.list({ status: 'ACTIVE' }).then(setClients).catch(() => {}); }, []);

  // Refresh the OCF lineage whenever a different bid is opened.
  useEffect(() => {
    setChain(null); setResultForm(null); setOcfForm(null);
    if (selectedBid) api.bids.chain(selectedBid.id).then(setChain).catch(() => {});
  }, [selectedBid?.id]);

  async function refreshSelected(id) {
    const fresh = await api.bids.get(id);
    setSelectedBid(fresh);
    load();
  }

  function openBulk(prefillText = '') {
    setBulkText(typeof prefillText === 'string' ? prefillText : '');
    setBulkResult(null);
    setBulkFileNote('');
    setReuseId('');
    setShowBulk(true);
  }

  /** Re-bid straight from the list — loads that bid's blocks into the bulk editor. */
  function handleCloneBid(bid) {
    openBulk(bidToRows(bid));
    setBulkFileNote(`Copied ${bid.blocks?.length || 0} block(s) from ${bid.id}. Update the dates and gate closure, then Validate.`);
  }

  async function handleDownloadTemplate() {
    try {
      saveBlob(await api.bids.downloadBulkTemplate(), 'bid_bulk_template.csv');
    } catch {
      alert('Could not download the template. Please try again.');
    }
  }

  // Accepts a real Excel workbook as well as CSV/TSV — .xlsx is a binary zip,
  // so reading it as text would produce garbage.
  async function handlePickFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBulkResult(null);
    try {
      const text = SHEET_EXT.test(file.name) ? await sheetToCsv(file) : await file.text();
      setBulkText(text);
      const rowCount = text.trim().split(/\r?\n/).filter((l) => l.trim()).length;
      setBulkFileNote(`Loaded "${file.name}" — ${rowCount} line(s) including header. Review below, then Validate.`);
    } catch (err) {
      setBulkFileNote('');
      setBulkResult({ errors: [{ row: null, errors: [`Could not read "${file.name}": ${err.message}`] }] });
    }
  }

  async function handleReuseBid() {
    if (!reuseId) return;
    try {
      // The list rows already carry blocks, but re-fetch so a stale list can't
      // silently produce an empty re-bid.
      const bid = await api.bids.get(reuseId);
      if (!bid.blocks?.length) {
        setBulkResult({ errors: [{ row: null, errors: ['That bid has no blocks to copy'] }] });
        return;
      }
      setBulkText(bidToRows(bid));
      setBulkResult(null);
      setBulkFileNote(`Loaded ${bid.blocks.length} block(s) from ${bid.id}. Update the bid/delivery dates and gate closure before validating.`);
    } catch {
      setBulkResult({ errors: [{ row: null, errors: ['Could not load that bid'] }] });
    }
  }

  async function runBulk(dryRun) {
    const parsed = parseTabular(bulkText);
    if (!parsed.length) { setBulkResult({ errors: [{ row: null, errors: ['Nothing to parse — paste rows first'] }] }); return; }
    setBulkBusy(true);
    try {
      const res = await api.bids.bulk(parsed, dryRun);
      setBulkResult(res);
      if (!dryRun && res.bids_created) { load(); setBulkText(''); }
    } catch (err) {
      setBulkResult(err.response?.data || { errors: [{ row: null, errors: ['Upload failed'] }] });
    } finally {
      setBulkBusy(false);
    }
  }

  async function handleRecordResult(e) {
    e.preventDefault();
    try {
      const payload = Object.entries(resultForm).map(([time_block, v]) => ({
        time_block,
        cleared_quantum_mw: Number(v.cleared_quantum_mw || 0),
        cleared_price: v.cleared_price === '' ? null : Number(v.cleared_price),
      }));
      await api.bids.recordResult(selectedBid.id, payload);
      await refreshSelected(selectedBid.id);
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to record result');
    }
  }

  async function handleSyncResult(e) {
    e.preventDefault();
    setSyncBusy(true);
    try {
      const updated = await api.bids.syncResult(selectedBid.id);
      setSelectedBid(updated);
      setResultForm(null);
      load();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to sync IEX result');
    } finally {
      setSyncBusy(false);
    }
  }

  async function handleCarryForward(e) {
    e.preventDefault();
    try {
      const created = await api.bids.carryForward(selectedBid.id, {
        to_product: ocfForm.to_product,
        premium_discount: Number(ocfForm.premium_discount || 0),
        gate_closure_time: ocfForm.gate_closure_time || undefined,
      });
      setSelectedBid(created);
      load();
    } catch (err) {
      alert(err.response?.data?.error || 'Carry-forward failed');
    }
  }

  function openCreate() {
    // Default to the tab's primary product (e.g. the DAM tab covers DAM+HPDAM,
    // create should start on DAM); the form still lets the user switch.
    const tab = PRODUCT_TABS.find((t) => t.key === activeTab) || PRODUCT_TABS[0];
    setForm({ ...EMPTY_FORM, product: tab.members[0] });
    setBlocks([{ ...EMPTY_BLOCK }]);
    setError('');
    setShowCreate(true);
  }

  async function handleCreate(e) {
    e.preventDefault();
    setError('');
    try {
      const payload = {
        ...form,
        blocks: blocks.map(b => ({
          time_block: b.time_block,
          quantum_mw: Number(b.quantum_mw),
          price_per_unit: Number(b.price_per_unit)
        }))
      };
      await api.bids.create(payload);
      setShowCreate(false);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create bid');
    }
  }

  async function handleApprove(id, status) {
    try {
      await api.bids.approve(id, status, 'Reviewed by Maker/Checker');
      setSelectedBid(null);
      load();
    } catch (err) {
      alert(err.response?.data?.error || 'Action failed');
    }
  }

  async function handleSubmitToExchange(id) {
    try {
      await api.bids.submit(id);
      setSelectedBid(null);
      load();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to submit to exchange. Check Gate Closure.');
    }
  }

  const columns = [
    { key: 'id', label: 'Bid Ref' },
    { key: 'client_name', label: 'Client' },
    { key: 'exchange', label: 'Exchange/Product', render: r => `${r.exchange} - ${r.product}` },
    { key: 'delivery_date', label: 'Delivery Date' },
    { key: 'approval_status', label: 'Approval', render: r => <Badge type={r.approval_status === 'APPROVED' ? 'success' : r.approval_status === 'REJECTED' ? 'danger' : 'warning'}>{r.approval_status}</Badge> },
    { key: 'status', label: 'Exchange Status', render: r => <Badge type={r.status === 'CLEARED' ? 'success' : r.status === 'DRAFT' ? 'neutral' : 'primary'}>{r.status}</Badge> },
    { key: 'actions', label: 'Actions', render: r => (
      <div style={{ display: 'flex', gap: 6 }}>
        <button className="btn btn-outline" onClick={() => setSelectedBid(r)}>View</button>
        <button className="btn btn-outline" title="Re-bid using this bid's blocks" onClick={() => handleCloneBid(r)}>Re-bid</button>
      </div>
    ) }
  ];

  const tab = PRODUCT_TABS.find((t) => t.key === activeTab) || PRODUCT_TABS[0];
  let tabBids = rows.filter((r) => tab.members.includes(r.product));
  if (globalClient) tabBids = tabBids.filter(r => r.client_id === globalClient);
  if (appliedDeliveryDate) tabBids = tabBids.filter(r => r.delivery_date === appliedDeliveryDate);
  const viewBids = tabBids.filter((b) => (bidView === 'history' ? isHistoryBid(b) : !isHistoryBid(b)));

  // This product's position, from the blocks the list endpoint already returns.
  const blockSum = (b, field) => (b.blocks || []).reduce((a, k) => a + Number(k[field] || 0), 0);
  const summary = {
    count: tabBids.length,
    quantumBid: tabBids.reduce((a, b) => a + blockSum(b, 'quantum_mw'), 0),
    clearedMw: tabBids.reduce((a, b) => a + blockSum(b, 'cleared_quantum_mw'), 0),
    unclearedMw: tabBids.reduce((a, b) => a + Number(b.uncleared_mw || 0), 0),
  };
  summary.clearRatio = summary.quantumBid > 0 ? (summary.clearedMw / summary.quantumBid) * 100 : 0;

  return (
    <div style={{ padding: 20 }}>
      <PageHeader
        title={`${tab.label} Management`}
        onAdd={openCreate}
        addLabel={`New ${tab.short} Bid`}
        actions={
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <select className="input" value={globalClient} onChange={e => setGlobalClient(e.target.value)} style={{ padding: '4px 10px' }}>
              <option value="">All Clients (Portfolio)</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <button className="btn btn-outline" onClick={openBulk}>
              Bulk Upload ({tab.short})
            </button>
          </div>
        }
      />

      {/* Alert / Countdown Banner */}
      <div style={{ background: '#fff3cd', border: '1px solid #ffe69c', padding: '10px 15px', borderRadius: 6, marginBottom: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ color: '#664d03', fontWeight: 600 }}>
          <span style={{ marginRight: 8 }}>⏳</span>
          Closing in 2 Hrs 15 Mins for {tab.short} bid (Gate Closure: 12:00 PM)
        </div>
      </div>

      {/* Delivery Date Picker & Filter */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', marginBottom: 20, background: 'var(--surface)', padding: 15, border: '1px solid var(--border)', borderRadius: 8 }}>
        <div>
          <label style={{ display: 'block', fontSize: 12, marginBottom: 5, color: 'var(--text-muted)' }}>Delivery Date</label>
          <input type="date" className="input" value={deliveryDateFilter} onChange={e => setDeliveryDateFilter(e.target.value)} />
        </div>
        <button className="btn btn-primary" disabled={!deliveryDateFilter} onClick={() => setAppliedDeliveryDate(deliveryDateFilter)}>
          Display
        </button>
        {appliedDeliveryDate && (
          <button className="btn btn-outline" onClick={() => { setDeliveryDateFilter(''); setAppliedDeliveryDate(''); }}>
            Clear Filter
          </button>
        )}
      </div>

      <div style={{ fontSize: 12, color: '#64748b', marginBottom: 14 }}>{tab.hint}</div>

      {/* Per-product summary — this product's bidding position at a glance. */}
      <Card style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap' }}>
          {[
            { label: 'Bids', value: summary.count },
            { label: 'Quantum bid', value: `${fmtNumber(summary.quantumBid)} MW` },
            { label: 'Cleared', value: `${fmtNumber(summary.clearedMw)} MW`, tone: '#166534' },
            { label: 'Uncleared', value: `${fmtNumber(summary.unclearedMw)} MW`, tone: summary.unclearedMw > 0 ? '#92400e' : undefined },
            { label: 'Clear ratio', value: summary.quantumBid > 0 ? `${Math.round(summary.clearRatio)}%` : '—' },
          ].map((s) => (
            <div key={s.label}>
              <div style={{ fontSize: 12, color: '#64748b' }}>{s.label}</div>
              <div style={{ fontSize: 20, fontWeight: 600, color: s.tone || '#0f172a' }}>{s.value}</div>
            </div>
          ))}
        </div>
      </Card>

      {/* Manage (working) vs Bid History (decided) — PTC's two sub-views. */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        {[
          { key: 'manage', label: `Manage Bids (${tabBids.filter((b) => !isHistoryBid(b)).length})` },
          { key: 'history', label: `Bid History (${tabBids.filter(isHistoryBid).length})` },
        ].map((v) => (
          <button
            key={v.key}
            className={`btn btn-sm ${bidView === v.key ? 'btn-primary' : 'btn-outline'}`}
            onClick={() => setBidView(v.key)}
          >
            {v.label}
          </button>
        ))}
      </div>

      <Card>
        <Table
          columns={columns}
          data={viewBids}
          loading={loading}
          emptyMessage={bidView === 'history'
            ? `No decided ${tab.short} bids yet.`
            : `No open ${tab.short} bids. Use "New ${tab.short} Bid" to create one.`}
        />
      </Card>

      {showBulk && (
        <Modal open={true} onClose={() => setShowBulk(false)} title="Bulk Bid Upload" width={900}>
          <p style={{ marginBottom: 10, color: '#555' }}>
            Paste rows from Excel/CSV (tab or comma separated), upload an Excel workbook (.xlsx/.xls) or .csv file,
            or reuse a previous bid. Rows sharing the same client, exchange, product and dates are grouped into
            one portfolio bid.
          </p>
          <div style={{ display: 'flex', gap: 10, marginBottom: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <button className="btn btn-outline" onClick={handleDownloadTemplate}>Download CSV Template</button>
            <input
              type="file"
              accept=".csv,.txt,.tsv,.xlsx,.xlsm,.xls"
              onChange={handlePickFile}
            />
          </div>

          {/* Re-bid: pull a past bid's blocks in, then edit the dates before submitting. */}
          <div style={{ display: 'flex', gap: 10, marginBottom: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <label style={{ fontSize: 13, color: '#555' }}>Copy from previous bid:</label>
            <select
              className="input"
              style={{ maxWidth: 380 }}
              value={reuseId}
              onChange={(e) => setReuseId(e.target.value)}
            >
              <option value="">— select a bid —</option>
              {rows.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.id} · {r.client_name} · {r.exchange}-{r.product} · {r.delivery_date}
                </option>
              ))}
            </select>
            <button className="btn btn-outline" disabled={!reuseId} onClick={handleReuseBid}>Load rows</button>
          </div>

          {bulkFileNote && <div style={{ marginBottom: 10, fontSize: 13, color: '#555' }}>{bulkFileNote}</div>}
          <textarea
            className="input"
            style={{ width: '100%', minHeight: 160, fontFamily: 'monospace', fontSize: 12 }}
            placeholder={BULK_COLUMNS.join(',')}
            value={bulkText}
            onChange={(e) => { setBulkText(e.target.value); setBulkResult(null); }}
          />

          {bulkResult && (
            <div style={{ marginTop: 15 }}>
              {bulkResult.bids_created > 0 && (
                <div style={{ color: 'green', marginBottom: 10 }}>
                  ✓ {bulkResult.bids_created} bid(s) created from {bulkResult.rows_received} row(s).
                </div>
              )}
              {bulkResult.preview?.length > 0 && (
                <>
                  <h4 style={{ marginBottom: 8 }}>Bids to create</h4>
                  <Table
                    columns={[
                      { key: 'client_name', label: 'Client' },
                      { key: 'exchange', label: 'Exchange' },
                      { key: 'product', label: 'Product' },
                      { key: 'delivery_date', label: 'Delivery' },
                      { key: 'blocks', label: 'Blocks' },
                      { key: 'total_mw', label: 'Total MW' },
                      { key: 'exposure', label: 'Exposure (₹)', render: (r) => fmtNumber(r.exposure) },
                      { key: 'source_rows', label: 'From rows', render: (r) => (r.source_rows || []).join(', ') },
                    ]}
                    data={bulkResult.preview}
                  />
                </>
              )}
              {bulkResult.errors?.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <h4 style={{ marginBottom: 8, color: '#b00' }}>Errors ({bulkResult.errors.length})</h4>
                  {bulkResult.errors.map((e, i) => (
                    <div key={i} style={{ color: '#b00', fontSize: 13 }}>
                      {e.row ? `Row ${e.row}: ` : ''}{e.errors.join('; ')}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div style={{ marginTop: 20, display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <button className="btn btn-outline" onClick={() => setShowBulk(false)}>Close</button>
            <button className="btn btn-outline" disabled={bulkBusy} onClick={() => runBulk(true)}>Validate (Preview)</button>
            <button
              className="btn btn-primary"
              disabled={bulkBusy || !bulkResult || bulkResult.errors?.length > 0 || !bulkResult.preview?.length}
              onClick={() => runBulk(false)}
            >
              Create {bulkResult?.preview?.length || ''} Bid(s)
            </button>
          </div>
        </Modal>
      )}

      {showCreate && (
        <Modal open={true} onClose={() => setShowCreate(false)} title="Create Block Bid Portfolio" width={800}>
          <form onSubmit={handleCreate}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 15, marginBottom: 20 }}>
              <Field label="Client" required>
                <select className="input" value={form.client_id} onChange={e => setForm({...form, client_id: e.target.value})} required>
                  <option value="">Select Client</option>
                  {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </Field>
              <Field label="Exchange" required>
                <select className="input" value={form.exchange} onChange={e => setForm({...form, exchange: e.target.value})}>
                  <option value="IEX">IEX</option>
                  <option value="PXIL">PXIL</option>
                  <option value="HPX">HPX</option>
                </select>
              </Field>
              <Field label="Product" required>
                <select className="input" value={form.product} onChange={e => setForm({...form, product: e.target.value})}>
                  <option value="DAM">DAM (Day Ahead)</option>
                  <option value="RTM">RTM (Real Time)</option>
                  <option value="GDAM">GDAM (Green DAM)</option>
                </select>
              </Field>
              <Field label="Bid Date" required>
                <input type="date" className="input" value={form.bid_date} onChange={e => setForm({...form, bid_date: e.target.value})} required />
              </Field>
              <Field label="Delivery Date" required>
                <input type="date" className="input" value={form.delivery_date} onChange={e => setForm({...form, delivery_date: e.target.value})} required />
              </Field>
              <Field label="Gate Closure Time (UTC)" required>
                <input type="datetime-local" className="input" value={form.gate_closure_time} onChange={e => setForm({...form, gate_closure_time: e.target.value})} required />
              </Field>
            </div>

            <h4 style={{ marginBottom: 10 }}>Bid Blocks</h4>
            {blocks.map((b, idx) => (
              <div key={idx} style={{ display: 'flex', gap: 10, marginBottom: 10, alignItems: 'flex-end' }}>
                <Field label="Time Block">
                  <input type="text" className="input" value={b.time_block} onChange={e => { const nb = [...blocks]; nb[idx].time_block = e.target.value; setBlocks(nb); }} required />
                </Field>
                <Field label="Quantum (MW)">
                  <input type="number" step="0.1" className="input" value={b.quantum_mw} onChange={e => { const nb = [...blocks]; nb[idx].quantum_mw = e.target.value; setBlocks(nb); }} required />
                </Field>
                <Field label="Price (₹/unit)">
                  <input type="number" step="0.01" className="input" value={b.price_per_unit} onChange={e => { const nb = [...blocks]; nb[idx].price_per_unit = e.target.value; setBlocks(nb); }} required />
                </Field>
                {blocks.length > 1 && (
                  <button type="button" className="btn btn-danger" style={{ marginBottom: 4 }} onClick={() => setBlocks(blocks.filter((_, i) => i !== idx))}>X</button>
                )}
              </div>
            ))}
            <button type="button" className="btn btn-outline" style={{ marginBottom: 20 }} onClick={() => setBlocks([...blocks, { ...EMPTY_BLOCK }])}>+ Add Block</button>

            {error && <div style={{ color: 'red', marginBottom: 15 }}>{error}</div>}
            
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button type="button" className="btn btn-outline" onClick={() => setShowCreate(false)}>Cancel</button>
              <button type="submit" className="btn btn-primary">Create Draft Portfolio</button>
            </div>
          </form>
        </Modal>
      )}

      {selectedBid && (
        <Modal open={true} onClose={() => setSelectedBid(null)} title={`Bid Details: ${selectedBid.id}`} width={900}>
          <div style={{ display: 'flex', gap: 20, marginBottom: 20 }}>
            <div style={{ flex: 1 }}>
              <p><strong>Client:</strong> {selectedBid.client_name}</p>
              <p><strong>Exchange:</strong> {selectedBid.exchange} / {selectedBid.product}</p>
              <p><strong>Delivery Date:</strong> {selectedBid.delivery_date}</p>
              <p><strong>Total Exposure:</strong> ₹{fmtNumber(selectedBid.blocks.reduce((a, b) => a + (b.quantum_mw * b.price_per_unit), 0))}</p>
            </div>
            <div style={{ flex: 1 }}>
              <p><strong>Gate Closure:</strong> {selectedBid.gate_closure_time ? new Date(selectedBid.gate_closure_time).toLocaleString() : 'Not set'}</p>
              <p><strong>Approval Status:</strong> <Badge>{selectedBid.approval_status}</Badge></p>
              <p><strong>Exchange Status:</strong> <Badge>{selectedBid.status}</Badge></p>
              <p><strong>Cleared / Uncleared:</strong> {fmtNumber(selectedBid.cleared_quantum_mw)} MW / {fmtNumber(selectedBid.uncleared_mw)} MW</p>
              <p><strong>Receipt Ref:</strong> {selectedBid.exchange_receipt_ref || 'N/A'}</p>
            </div>
          </div>

          <h4 style={{ marginBottom: 10 }}>Blocks</h4>
          <Table 
            columns={[
              { key: 'time_block', label: 'Time Block' },
              { key: 'quantum_mw', label: 'Req Quantum (MW)' },
              { key: 'price_per_unit', label: 'Req Price (₹)' },
              { key: 'cleared_quantum_mw', label: 'Cleared Quantum' },
              { key: 'cleared_price', label: 'Cleared Price' },
              { key: 'status', label: 'Status' }
            ]} 
            data={selectedBid.blocks || []} 
          />

          {/* OCF carry-forward lineage across market segments */}
          {chain?.legs?.length > 1 && (
            <div style={{ marginTop: 20, padding: 12, background: '#f2f6fb', borderLeft: '4px solid #0b4a8f' }}>
              <strong>OCF Carry-Forward Chain</strong>
              <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                {chain.legs.map((l, i) => (
                  <React.Fragment key={l.id}>
                    {i > 0 && <span style={{ color: '#0b4a8f' }}>→</span>}
                    <span
                      style={{
                        padding: '4px 8px', borderRadius: 4, fontSize: 12,
                        background: l.id === selectedBid.id ? '#0b4a8f' : '#fff',
                        color: l.id === selectedBid.id ? '#fff' : '#333',
                        border: '1px solid #cbd7e6', cursor: 'pointer',
                      }}
                      onClick={() => setSelectedBid(l)}
                      title={l.id}
                    >
                      <b>{l.product}</b> {fmtNumber(l.quantum_mw)} MW
                      {l.premium_discount
                        ? ` (${l.premium_discount > 0 ? '+' : '−'}₹${Math.abs(l.premium_discount).toFixed(2)})`
                        : ''}
                      {' · '}cleared {fmtNumber(l.cleared_quantum_mw)}
                    </span>
                  </React.Fragment>
                ))}
              </div>
            </div>
          )}

          {/* Record the exchange clearing result, block-wise */}
          {selectedBid.status === 'SUBMITTED' && (
            <div style={{ marginTop: 20 }}>
              {!resultForm ? (
                <div style={{ display: 'flex', gap: '10px' }}>
                  <button
                    className="btn btn-outline"
                    onClick={() => setResultForm(Object.fromEntries(
                      (selectedBid.blocks || []).map((b) => [b.time_block, { cleared_quantum_mw: '', cleared_price: '' }])
                    ))}
                  >
                    Record Exchange Result
                  </button>
                  <button
                    className="btn btn-secondary"
                    onClick={handleSyncResult}
                    disabled={syncBusy}
                  >
                    {syncBusy ? 'Syncing...' : 'Sync IEX Result'}
                  </button>
                </div>
              ) : (
                <form onSubmit={handleRecordResult} style={{ padding: 12, border: '1px solid #ddd' }}>
                  <h4 style={{ marginBottom: 10 }}>Exchange Clearing Result</h4>
                  {(selectedBid.blocks || []).map((b) => (
                    <div key={b.time_block} style={{ display: 'flex', gap: 10, alignItems: 'flex-end', marginBottom: 8 }}>
                      <div style={{ minWidth: 150 }}>{b.time_block} — bid {b.quantum_mw} MW @ ₹{b.price_per_unit}</div>
                      <Field label="Cleared MW">
                        <input type="number" step="0.1" min="0" max={b.quantum_mw} className="input" required
                          value={resultForm[b.time_block]?.cleared_quantum_mw ?? ''}
                          onChange={(e) => setResultForm({ ...resultForm, [b.time_block]: { ...resultForm[b.time_block], cleared_quantum_mw: e.target.value } })} />
                      </Field>
                      <Field label="Cleared Price (₹)">
                        <input type="number" step="0.01" min="0" className="input"
                          value={resultForm[b.time_block]?.cleared_price ?? ''}
                          onChange={(e) => setResultForm({ ...resultForm, [b.time_block]: { ...resultForm[b.time_block], cleared_price: e.target.value } })} />
                      </Field>
                    </div>
                  ))}
                  <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                    <button type="button" className="btn btn-outline" onClick={() => setResultForm(null)}>Cancel</button>
                    <button type="submit" className="btn btn-primary">Save Result</button>
                  </div>
                </form>
              )}
            </div>
          )}

          {selectedBid.carried_forward_to && (
            <p style={{ marginTop: 16, color: '#555' }}>
              Uncleared quantum already carried forward as <strong>{selectedBid.carried_forward_to}</strong>.
            </p>
          )}

          {/* Carry the uncleared quantum into the next market segment */}
          {selectedBid.uncleared_mw > 0 && !selectedBid.carried_forward_to
            && (selectedBid.carry_forward_options || []).length > 0 && (
            <div style={{ marginTop: 20 }}>
              {!ocfForm ? (
                <button
                  className="btn btn-outline"
                  onClick={() => {
                    const to = selectedBid.carry_forward_options[0];
                    setOcfForm({ to_product: to, premium_discount: ocfDefaultFor(selectedBid, to), gate_closure_time: '' });
                  }}
                >
                  Carry Forward {fmtNumber(selectedBid.uncleared_mw)} MW uncleared →
                </button>
              ) : (
                <form onSubmit={handleCarryForward} style={{ padding: 12, border: '1px solid #ddd' }}>
                  <h4 style={{ marginBottom: 10 }}>
                    OCF Carry-Forward — {fmtNumber(selectedBid.uncleared_mw)} MW from {selectedBid.product}
                  </h4>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                    <Field label="To Segment" required>
                      <select className="input" value={ocfForm.to_product}
                        onChange={(e) => setOcfForm({
                          ...ocfForm,
                          to_product: e.target.value,
                          // Re-apply the configured default for the newly chosen route.
                          premium_discount: ocfDefaultFor(selectedBid, e.target.value),
                        })}>
                        {selectedBid.carry_forward_options.map((p) => <option key={p} value={p}>{p}</option>)}
                      </select>
                    </Field>
                    <Field label="Premium (+) / Discount (−) ₹/unit">
                      <input type="number" step="0.01" className="input" placeholder="0.00"
                        value={ocfForm.premium_discount}
                        onChange={(e) => setOcfForm({ ...ocfForm, premium_discount: e.target.value })} />
                    </Field>
                    <Field label="Gate Closure (new leg)">
                      <input type="datetime-local" className="input" value={ocfForm.gate_closure_time}
                        onChange={(e) => setOcfForm({ ...ocfForm, gate_closure_time: e.target.value })} />
                    </Field>
                    <button type="button" className="btn btn-outline" style={{ marginBottom: 4 }} onClick={() => setOcfForm(null)}>Cancel</button>
                    <button type="submit" className="btn btn-primary" style={{ marginBottom: 4 }}>Create Carry-Forward Bid</button>
                  </div>
                </form>
              )}
            </div>
          )}

          <div style={{ marginTop: 24 }}>
            <DocumentManager
              moduleName="EXCHANGE_BIDS"
              title="Bid Documents & Exchange Receipts"
            />
          </div>

          <div style={{ marginTop: 20, display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            {selectedBid.approval_status === 'PENDING' && (
              <>
                <button className="btn btn-danger" onClick={() => handleApprove(selectedBid.id, 'REJECTED')}>Reject</button>
                <button className="btn btn-success" onClick={() => handleApprove(selectedBid.id, 'APPROVED')}>Approve</button>
              </>
            )}
            {selectedBid.approval_status === 'APPROVED' && selectedBid.status === 'DRAFT' && (
              <button className="btn btn-primary" onClick={() => handleSubmitToExchange(selectedBid.id)}>Submit to Exchange</button>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
