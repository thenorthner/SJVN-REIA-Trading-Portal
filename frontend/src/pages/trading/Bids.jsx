import React, { useEffect, useState, useMemo} from 'react';
import { PortfolioSelect } from '../../context/PortfolioContext.jsx';
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

/**
 * Wall clock, isolated so its tick does not re-render the bidding screen.
 *
 * The interval used to live in the page component: every second the whole
 * 1,500-line tree — column definitions, filtered rows, the roll-up — was
 * rebuilt to move a colon. Harmless at a handful of bids, but this is the
 * screen that grows to hundreds of bids x 96 blocks.
 */
function LiveClock({ format = 'time', prefix = '' }) {
  const [now, setNow] = React.useState(new Date());
  React.useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);
  if (format === 'date') {
    return <>{prefix}{now.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '-')}</>;
  }
  if (format === 'time24') return <>{prefix}{now.toLocaleTimeString('en-GB', { hour12: false })}</>;
  return <>{prefix}{now.toLocaleTimeString('en-US', { hour12: false })}</>;
}

export default function Bids({ product = 'DAM', externalView = null }) {
  const { user } = useAuth();
  const [rows, setRows] = useState([]);
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const activeTab = product;
  const [globalClient, setGlobalClient] = useState('');
  const [deliveryDateFilter, setDeliveryDateFilter] = useState('');
  const [appliedDeliveryDate, setAppliedDeliveryDate] = useState('');
  const [bidView, setBidView] = useState(externalView === 'HISTORY' ? 'history' : 'manage');
  const [selectedForCompare, setSelectedForCompare] = useState([]);
  const [showCompareModal, setShowCompareModal] = useState(false);
  const [timelineDate, setTimelineDate] = useState('');
  const [showTimelineModal, setShowTimelineModal] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [blocks, setBlocks] = useState([{ ...EMPTY_BLOCK }]);
  const [error, setError] = useState('');
  const [selectedBid, setSelectedBid] = useState(null);
  const [auditBid, setAuditBid] = useState(null);

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

  // ── HP SLDC Standing Clearance Compliance (Naitwar Mori HPS) ──
  const [showOutageModal, setShowOutageModal] = useState(false);
  const [outageAcknowledged, setOutageAcknowledged] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  // Standing clearance comes from the client's own record, not a constant. It
  // was hard-coded to Naitwar Mori HPS, so every client was validated against
  // that one plant's ceiling and that one plant's expiry date.
  const [clearance, setClearance] = useState(null);
  const clearanceClientId = form.client_id || null;

  useEffect(() => {
    if (!clearanceClientId) { setClearance(null); return; }
    api.standingClearance.get(clearanceClientId).then(setClearance).catch(() => setClearance(null));
  }, [clearanceClientId]);

  const clearanceDaysLeft = clearance?.days_left ?? null;

  /**
   * Pre-submission compliance check (clauses 21-24, 26).
   *
   * The authority is the API — it runs the same checks on every write, so a bid
   * posted directly cannot skip them. This call is the trader's early warning,
   * not the control; it returns the identical findings the submit would raise.
   */
  async function validateCompliance(payload) {
    try {
      const res = await api.standingClearance.check({
        client_id: payload.client_id || form.client_id,
        product: payload.product || form.product,
        exchange: payload.exchange || form.exchange,
        delivery_date: payload.delivery_date || form.delivery_date,
        type: payload.type || form.type,
        bid_on: payload.bid_on || form.bid_on,
        blocks: payload.blocks || [],
        forced_outage: outageAcknowledged,
      });
      return (res.violations || []).map((v) => `Compliance Violation (Clause ${v.clause}): ${v.message}`);
    } catch (err) {
      // Never let a failed pre-check pass a bid through silently — the API
      // enforces the same rules on write and will refuse it there.
      return [err.response?.data?.error || 'Could not run the standing-clearance check. Try again.'];
    }
  }

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

    // Clause 23: Intercept BUY bids from generators — force outage verification
    if (clearance?.is_generator && form.type === 'Buy' && !outageAcknowledged) {
      setShowOutageModal(true);
      return;
    }

    try {
      const payload = {
        ...form,
        blocks: blocks.map(b => ({
          time_block: b.time_block,
          quantum_mw: Number(b.quantum_mw),
          price_per_unit: Number(b.price_per_unit)
        }))
      };

      // Standing clearance pre-check (clauses 21-24, 26). The API enforces the
      // same rules on write; this only saves the trader a round trip.
      const complianceErrors = await validateCompliance(payload);
      if (complianceErrors.length > 0) {
        setError(complianceErrors.join('\n'));
        return;
      }

      const created = await api.bids.create(payload);
      setShowCreate(false);
      setOutageAcknowledged(false); // Reset for next bid
      if (created?.compliance_warnings?.length) {
        setError(created.compliance_warnings.map((w) => `Note (Clause ${w.clause}): ${w.message}`).join('\n'));
      }
      load();
    } catch (err) {
      // The API returns structured clause findings; show those rather than a
      // generic failure so the trader knows which limit was hit.
      const data = err.response?.data;
      setError(
        data?.violations?.length
          ? data.violations.map((v) => `Compliance Violation (Clause ${v.clause}): ${v.message}`).join('\n')
          : data?.error || 'Failed to create bid'
      );
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
    { key: 'structure', label: 'Bid Structure', render: r => r.structure || 'Single' },
    { key: 'type', label: 'Bid Type', render: r => r.type || 'Sell' },
    { key: 'revision_no', label: 'Rev No', render: r => r.revision_no || 1 },
    { key: 'internal_status', label: 'Internal Status', render: r => (
      bidView === 'history' ? <span style={{ color: 'var(--green-strong)', fontWeight: '500', fontSize: 12 }}>File Prepared</span> : 
      <Badge type={r.approval_status === 'APPROVED' ? 'success' : r.approval_status === 'REJECTED' ? 'danger' : 'warning'}>{r.approval_status}</Badge>
    ) },
    { key: 'status', label: 'Exchange Status', render: r => {
      if (tab.short === 'RTM') {
        if (r.status === 'SUBMITTED') return <span style={{ color: 'var(--green-strong)', fontWeight: 'bold', fontSize: 12 }}>Submitted to Exchange</span>;
        if (r.status === 'PENDING') return <span style={{ color: '#ca8a04', fontWeight: 'bold', fontSize: 12 }}>Pending Gateway</span>;
        if (r.status === 'REJECTED') return <span style={{ color: 'var(--red-strong)', fontWeight: 'bold', fontSize: 12, cursor: 'help' }} title={r.rejection_reason || 'Error Code 402: Bid quantity exceeds standing clearance limit'}>Rejected by Exchange</span>;
        return <span style={{ color: '#ca8a04', fontWeight: 'bold', fontSize: 12 }}>Pending Gateway</span>; // Default mock for new RTM bids
      }
      return <Badge type={r.status === 'CLEARED' ? 'success' : r.status === 'DRAFT' ? 'neutral' : 'primary'}>{r.status}</Badge>;
    } },
    { key: 'actions', label: 'Actions', render: r => (
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <button className="btn btn-outline" onClick={() => {
          if (bidView === 'history' && tab.short === 'DAM') {
            setAuditBid(r);
          } else {
            setSelectedBid(r);
          }
        }}>View</button>
        <button className="btn btn-outline" title="Re-bid using this bid's blocks" onClick={() => handleCloneBid(r)}>Re-bid</button>
        {bidView === 'history' && tab.short === 'RTM' && (
          <button className="btn btn-outline" title="View Day Timeline" onClick={() => { setTimelineDate(r.delivery_date); setShowTimelineModal(true); }}></button>
        )}
        {bidView === 'history' && (
          <input 
            type="checkbox" 
            checked={selectedForCompare.includes(r.id)} 
            onChange={(e) => {
              if (e.target.checked) {
                if (selectedForCompare.length < 2) setSelectedForCompare([...selectedForCompare, r.id]);
                else alert('You can only compare 2 revisions at a time.');
              } else {
                setSelectedForCompare(selectedForCompare.filter(id => id !== r.id));
              }
            }}
            title="Select for comparison"
            style={{ marginLeft: 8, cursor: 'pointer' }}
          />
        )}
      </div>
    ) }
  ];

  const tab = PRODUCT_TABS.find((t) => t.key === activeTab) || PRODUCT_TABS[0];

  // Filtering and rolling up every bid's blocks is the expensive part of this
  // render, and it only changes when the data or a filter does.
  const tabBids = useMemo(() => {
    let list = rows.filter((r) => tab.members.includes(r.product));
    if (globalClient) list = list.filter((r) => r.client_id === globalClient);
    if (appliedDeliveryDate) list = list.filter((r) => r.delivery_date === appliedDeliveryDate);
    return list;
  }, [rows, tab, globalClient, appliedDeliveryDate]);

  const { manageBids, historyBids } = useMemo(() => ({
    manageBids: tabBids.filter((b) => !isHistoryBid(b)),
    historyBids: tabBids.filter(isHistoryBid),
  }), [tabBids]);

  const viewBids = bidView === 'history' ? historyBids : manageBids;

  // This product's position, from the blocks the list endpoint already returns.
  const summary = useMemo(() => {
    const blockSum = (b, field) => (b.blocks || []).reduce((a, k) => a + Number(k[field] || 0), 0);
    const s = {
      count: tabBids.length,
      quantumBid: tabBids.reduce((a, b) => a + blockSum(b, 'quantum_mw'), 0),
      clearedMw: tabBids.reduce((a, b) => a + blockSum(b, 'cleared_quantum_mw'), 0),
      unclearedMw: tabBids.reduce((a, b) => a + Number(b.uncleared_mw || 0), 0),
    };
    s.clearRatio = s.quantumBid > 0 ? (s.clearedMw / s.quantumBid) * 100 : 0;
    return s;
  }, [tabBids]);

  return (
    <div style={{ padding: 20 }}>
      <PageHeader
        title={`${tab.label} Management`}
        onAdd={(!externalView || externalView === 'MANAGE') ? openCreate : undefined}
        addLabel={(!externalView || externalView === 'MANAGE') ? `New ${tab.short} Bid` : undefined}
        actions={
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <select className="input" aria-label="Filter bids by client portfolio" value={globalClient} onChange={e => setGlobalClient(e.target.value)} style={{ padding: '4px 10px' }}>
              <option value="">All Clients (Portfolio)</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <button className="btn btn-outline" onClick={openBulk}>
              Bulk Upload ({tab.short})
            </button>
          </div>
        }
      />

      {/* ── SLDC Standing Clearance Badge (Clause 26) ── */}
      {clearance && (() => {
        // Clause 26 asks the generator to APPLY for renewal a week before expiry;
        // it does not stop trading. Only a clearance that has actually lapsed
        // blocks bids, and that refusal is enforced by the API.
        const tone = {
          EXPIRED:       { bg: '#fef2f2', border: '#fecaca', fg: 'var(--red-strong)', label: 'EXPIRED' },
          RENEWAL_DUE:   { bg: '#fffbeb', border: '#fde68a', fg: 'var(--amber-strong)', label: 'RENEWAL DUE' },
          ACTIVE:        { bg: '#f0fdf4', border: '#bbf7d0', fg: 'var(--green-strong)', label: 'ACTIVE' },
          NOT_ON_RECORD: { bg: 'var(--slate-50)', border: 'var(--slate-200)', fg: 'var(--slate-500)', label: 'NOT ON RECORD' },
        }[clearance.state];
        return (
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '10px 16px', marginBottom: 12, borderRadius: 8,
            background: tone.bg, border: `1px solid ${tone.border}`,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 16 }}></span>
              <div>
                <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--slate-700)' }}>
                  {clearance.sldc_name || 'SLDC'} Standing Clearance:{' '}
                </span>
                <span style={{ fontWeight: 700, fontSize: 13, color: tone.fg }}>{tone.label}</span>
                <span style={{ fontSize: 12, color: 'var(--slate-500)', marginLeft: 8 }}>
                  {clearance.client_name}
                  {clearance.tgna_approved_mw != null && ` | T-GNA Cap: ${clearance.tgna_approved_mw} MW`}
                  {clearance.standing_clearance_no && ` | ${clearance.standing_clearance_no}`}
                  {clearance.approver && ` | Approver: ${clearance.approver}`}
                </span>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {clearance.state === 'ACTIVE' && (
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--green-strong)' }}>
                  Expires in: {clearance.days_left} days
                </span>
              )}
              {clearance.state === 'RENEWAL_DUE' && (
                <>
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--amber-strong)' }}>
                    Expires in: {clearance.days_left} day(s) — bidding continues
                  </span>
                  <button className="btn btn-sm" style={{ background: 'var(--amber-strong)', color: '#fff', fontSize: 11 }}>
                    Trigger Renewal Declaration
                  </button>
                </>
              )}
              {clearance.state === 'EXPIRED' && (
                <>
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--red-strong)' }}>
                    Lapsed {Math.abs(clearance.days_left)} day(s) ago — new bids refused
                  </span>
                  <button className="btn btn-sm" style={{ background: 'var(--red-strong)', color: '#fff', fontSize: 11 }}>
                    Submit Renewal NOW
                  </button>
                </>
              )}
              {clearance.state === 'NOT_ON_RECORD' && (
                <span style={{ fontSize: 12, color: 'var(--slate-500)' }}>
                  No NOC captured for this client — capacity limits cannot be checked
                </span>
              )}
            </div>
          </div>
        );
      })()}

      {/* Alert / Countdown Banner */}
      {tab.short === 'RTM' ? (
        <div style={{ background: '#ecfdf5', border: '1px solid #a7f3d0', padding: '10px 15px', borderRadius: 6, marginBottom: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ color: '#065f46', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: '#10b981', boxShadow: '0 0 8px #10b981' }}></span>
            Active Window: RTM Session #29 | Gate Closes In: 08m 42s
          </div>
          <div style={{ color: '#065f46', fontWeight: 600, fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
            Current Time: <LiveClock /> IST
          </div>
        </div>
      ) : (
        <div style={{ background: '#fff3cd', border: '1px solid #ffe69c', padding: '10px 15px', borderRadius: 6, marginBottom: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ color: '#664d03', fontWeight: 600 }}>
            <span style={{ marginRight: 8 }}></span>
            Closing in 2 Hrs 15 Mins for {tab.short} bid (Gate Closure: 12:00 PM)
          </div>
        </div>
      )}

      {/* Conditional Filter Bar */}
      {bidView === 'history' && tab.short === 'DAM' ? (
        <Card style={{ marginBottom: 20, background: 'var(--slate-50)' }}>
          <div style={{ display: 'flex', gap: 15, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 5 }} htmlFor="bids-portfolio-name">Portfolio Name</label>
              <PortfolioSelect id="bids-portfolio-name" includeAll />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 5 }} htmlFor="bids-delivery-date">Delivery Date</label>
              <input id="bids-delivery-date" type="date" className="input" value={deliveryDateFilter} onChange={e => setDeliveryDateFilter(e.target.value)} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 5 }} htmlFor="bids-submission-date">Submission Date</label>
              <input id="bids-submission-date" type="date" className="input" />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 5 }} htmlFor="bids-bid-type">Bid Type</label>
              <select id="bids-bid-type" className="input"><option>--Select--</option><option>Sell</option><option>Buy</option></select>
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 5 }} htmlFor="bids-bid">Bid</label>
              <select id="bids-bid" className="input"><option>--Select--</option><option>Single</option><option>Block</option></select>
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 5 }} htmlFor="bids-bid-source">Bid Source</label>
              <select id="bids-bid-source" className="input"><option>--Select--</option><option>Web Portal</option><option>API Gateway</option><option>Excel Upload</option></select>
            </div>
            
            <button className="btn btn-primary" onClick={() => setAppliedDeliveryDate(deliveryDateFilter)}>Search</button>

            <div style={{ marginLeft: 'auto', display: 'flex', gap: 10 }}>
              <button className="btn btn-outline" style={{ color: '#27ae60', borderColor: '#27ae60' }}>[ EXCEL v ]</button>
              <button className="btn btn-outline">Export File</button>
            </div>
          </div>
        </Card>
      ) : (
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', marginBottom: 20, background: 'var(--surface)', padding: 15, border: '1px solid var(--border)', borderRadius: 8 }}>
          <div>
            <label style={{ display: 'block', fontSize: 12, marginBottom: 5, color: 'var(--text-muted)' }} htmlFor="bids-delivery-date-2">Delivery Date</label>
            <input id="bids-delivery-date-2" type="date" className="input" value={deliveryDateFilter} onChange={e => setDeliveryDateFilter(e.target.value)} />
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
      )}

      <div style={{ fontSize: 12, color: 'var(--slate-500)', marginBottom: 14 }}>{tab.hint}</div>

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

      {/* Manage (working) vs Bid History (decided) — PTC's two sub-views. Hide if controlled externally. */}
      {!externalView && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            {[
              { key: 'manage', label: `Manage Bids (${manageBids.length})` },
              { key: 'history', label: `Bid History (${historyBids.length})` },
            ].map((v) => (
              <button
                key={v.key}
                className={`btn btn-sm ${bidView === v.key ? 'btn-primary' : 'btn-outline'}`}
                onClick={() => { setBidView(v.key); setSelectedForCompare([]); }}
              >
                {v.label}
              </button>
            ))}
          </div>
          {bidView === 'history' && (
            <button 
              className="btn btn-primary btn-sm" 
              disabled={selectedForCompare.length !== 2}
              onClick={() => setShowCompareModal(true)}
            >
              Compare Revisions ({selectedForCompare.length}/2)
            </button>
          )}
        </div>
      )}

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
            Upload an Excel workbook (.xlsx/.xls) or .csv file, or reuse a previous bid. Rows sharing the same client, exchange, product and dates are grouped into
            one portfolio bid.
          </p>

          <div style={{ display: 'flex', gap: 10, marginBottom: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <button className="btn btn-outline" onClick={handleDownloadTemplate}>Download CSV Template</button>
          </div>

          <label 
            htmlFor="bulk-file-upload"
            style={{ 
              display: 'block',
              border: '2px dashed var(--slate-300)', 
              borderRadius: 8, 
              padding: '40px 20px', 
              textAlign: 'center', 
              background: 'var(--slate-50)', 
              marginBottom: 20,
              cursor: 'pointer',
              transition: 'all 0.2s'
            }}
            onMouseOver={e => { e.currentTarget.style.background = 'var(--slate-100)'; e.currentTarget.style.borderColor = 'var(--slate-400)'; }}
            onMouseOut={e => { e.currentTarget.style.background = 'var(--slate-50)'; e.currentTarget.style.borderColor = 'var(--slate-300)'; }}
          >
            <div style={{ fontSize: 40, marginBottom: 10 }}></div>
            <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--slate-700)' }}>Drag & Drop Bid CSV/Excel Here</div>
            <div style={{ fontSize: 13, color: 'var(--slate-500)', marginTop: 5 }}>or click to <strong>Browse Files</strong></div>
            <input
              id="bulk-file-upload"
              type="file"
              accept=".csv,.txt,.tsv,.xlsx,.xlsm,.xls"
              onChange={handlePickFile}
              style={{ display: 'none' }}
            />
          </label>

          {/* Re-bid: pull a past bid's blocks in, then edit the dates before submitting. */}
          <div style={{ display: 'flex', gap: 10, marginBottom: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <label style={{ fontSize: 13, color: '#555' }} htmlFor="bids-copy-from-previous-bid">Copy from previous bid:</label>
            <select id="bids-copy-from-previous-bid"
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
          
          {bulkResult && (
            <div style={{ marginTop: 15 }}>
              {bulkResult.bids_created > 0 && (
                <div style={{ color: 'green', marginBottom: 10 }}>
                   {bulkResult.bids_created} bid(s) created from {bulkResult.rows_received} row(s).
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

      {(showCreate || externalView === 'CREATE') && (
        <Modal open={true} onClose={() => { setShowCreate(false); }} title="" width={960}>
          {/* ── PTC-Style CREATE DAM NEW BID Header with Clock Fallback ── */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 0', borderBottom: '2px solid var(--navy)', marginBottom: 20 }}>
            <h3 style={{ margin: 0, color: 'var(--navy)', fontWeight: 700, letterSpacing: 0.5 }}>CREATE DAM NEW BID</h3>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontFamily: 'monospace', fontSize: 13, color: 'var(--slate-700)', background: 'var(--slate-100)', padding: '6px 14px', borderRadius: 4, border: '1px solid var(--slate-300)' }}>
              <span>DATE : <LiveClock format="date" /></span>
              <span style={{ margin: '0 6px', color: 'var(--text-subtle)' }}>|</span>
              {/* Clock Fallback: if server clock payload is empty, use local synced clock with visual indicator */}
              <span>TIME : <LiveClock format="time24" /></span>
              <span style={{ fontSize: 9, color: 'var(--green-strong)', animation: 'pulse 2s infinite', marginLeft: 4 }} title="Local clock sync — server WebSocket fallback active">● SYNC</span>
            </div>
          </div>

          <form onSubmit={handleCreate}>
            {/* ── Asset Verification Card (NOAR / Standing Clearance) ── */}
            {clearance && clearance.state !== 'NOT_ON_RECORD' && (
              <div style={{ background: 'var(--slate-50)', border: '1px solid var(--slate-300)', padding: '12px 16px', borderRadius: 8, marginBottom: 20 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <div>
                    <h4 style={{ margin: '0 0 4px 0', color: 'var(--navy)', fontSize: 14 }}>{clearance.client_name}</h4>
                    <div style={{ fontSize: 12, color: 'var(--slate-600)', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                      {clearance.noar_id && <span>NOAR ID: <strong>{clearance.noar_id}</strong></span>}
                      {clearance.standing_clearance_no && <span>NOC: <strong>{clearance.standing_clearance_no}</strong></span>}
                      {clearance.tgna_approved_mw != null && <span>T-GNA Cap: <strong>{clearance.tgna_approved_mw} MW</strong></span>}
                      {clearance.max_ramp_rate_mw_per_min != null && <span>Ramp: <strong>{clearance.max_ramp_rate_mw_per_min} MW/min</strong></span>}
                    </div>
                  </div>
                  <div style={{ fontSize: 11, background: '#e0f2fe', padding: '4px 8px', borderRadius: 4, color: '#0369a1', fontWeight: 600 }}>
                    {clearance.is_generator ? 'Generating Station' : 'Trader / Buyer'}
                  </div>
                </div>

                <div style={{ fontSize: 12, color: 'var(--slate-600)', display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                  <span>Valid till <strong>{clearance.valid_till}</strong></span>
                  {clearance.periphery_loss_percent != null && (
                    <span>Injection loss to periphery: <strong>{clearance.periphery_loss_percent}%</strong></span>
                  )}
                  {clearance.operating_charge_per_day != null && (
                    <span>Operating charge: <strong>₹{clearance.operating_charge_per_day}/day</strong></span>
                  )}
                  {clearance.is_generator && (
                    <span style={{ color: 'var(--amber-strong)' }}>Clause 23: BUY only during a forced outage</span>
                  )}
                </div>
              </div>
            )}

            {/* ── Row 1: Core Selectors (Left) + Radio Groups (Right) ── */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0, marginBottom: 20, border: '1px solid var(--slate-200)', borderRadius: 8, overflow: 'hidden' }}>
              {/* LEFT — Dropdowns */}
              <div style={{ padding: 20, borderRight: '1px solid var(--slate-200)', display: 'flex', flexDirection: 'column', gap: 14 }}>
                <Field label="Exchange" required>
                  <select className="input" value={form.exchange} onChange={e => {
                    // State Reset: clear file attachment on exchange switch, preserve block format radios
                    setBulkText(''); setBulkResult(null); setBulkFileNote('');
                    setForm({...form, exchange: e.target.value});
                  }}>
                    <option value="">---Select---</option>
                    <option value="IEX">IEX</option>
                    <option value="PXIL">PXIL</option>
                  </select>
                  {/* Dynamic CERC Price Limit Hint */}
                  {form.exchange && (
                    <div style={{ fontSize: 11, marginTop: 4, color: 'var(--sky)', display: 'flex', gap: 12 }}>
                      <span>Floor: ₹0.00/kWh</span>
                      <span>Ceiling: {form.exchange === 'IEX' ? '₹12.00' : '₹10.00'}/kWh</span>
                      <span style={{ color: 'var(--green-strong)' }}>● Gateway Active</span>
                    </div>
                  )}
                </Field>
                {/* Segment Tag — Read-only */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--slate-600)' }}>Segment:</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--navy)', background: '#e0f2fe', padding: '2px 10px', borderRadius: 4 }}>{tab.short}</span>
                </div>
                <Field label="Delivery Date" required>
                  <input type="date" className="input" value={form.delivery_date} onChange={e => setForm({...form, delivery_date: e.target.value})} required />
                </Field>
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                    <label htmlFor="bids-create-portfolio" style={{ fontSize: 12, fontWeight: 600, color: 'var(--slate-600)' }}>
                      Portfolio
                      <span aria-hidden="true" style={{ color: 'var(--red)' }}> *</span>
                      <span className="sr-only"> (required)</span>
                    </label>
                    {form.client_id && (
                      <button type="button" onClick={() => setShowProfile(true)} style={{ background: 'none', border: 'none', color: 'var(--navy)', fontSize: 11, cursor: 'pointer', textDecoration: 'underline' }}>
                        View Profile
                      </button>
                    )}
                  </div>
                  <select id="bids-create-portfolio" className="input" value={form.client_id} onChange={e => {
                    const selectedClient = clients.find(c => c.id === e.target.value);
                    const isGenerator = selectedClient?.client_type === 'GENERATOR';
                    // State Reset: clear file attachment on portfolio switch, preserve block format radios
                    setBulkText(''); setBulkResult(null); setBulkFileNote('');
                    setForm({
                      ...form,
                      client_id: e.target.value,
                      // Auto-defaults: Hydro generator → Sell + EX-BUS + IEX (higher liquidity)
                      exchange: form.exchange || 'IEX',
                      type: isGenerator ? 'Sell' : 'Buy',
                      bid_on: isGenerator ? 'EX-BUS' : 'PERIPHERY',
                      structure: 'Single',
                    });
                  }} required>
                    <option value="">---Select---</option>
                    {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
              </div>

              {/* RIGHT — Radio Groups */}
              <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
                {/* Bid Type — Color-Coded (placed first to match PTC layout) */}
                <div>
                  <span style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 6, color: 'var(--slate-600)' }}>Bid Type</span>
                  <div role="group" aria-label="Bid Type" style={{ display: 'flex', gap: 16 }}>
                    {[
                      { value: 'Buy', emoji: '', color: 'var(--green-strong)', bg: '#f0fdf4' },
                      { value: 'Sell', emoji: '', color: 'var(--red-strong)', bg: '#fef2f2' },
                      { value: 'Both', emoji: '', color: 'var(--slate-600)', bg: 'transparent' },
                    ].map(opt => (
                      <label key={opt.value} style={{
                        display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer',
                        color: (form.type || 'Sell') === opt.value ? opt.color : 'var(--slate-500)',
                        fontWeight: (form.type || 'Sell') === opt.value ? 700 : 400,
                        background: (form.type || 'Sell') === opt.value ? opt.bg : 'transparent',
                        padding: '4px 10px', borderRadius: 6,
                        border: (form.type || 'Sell') === opt.value ? `1px solid ${opt.color}30` : '1px solid transparent',
                        transition: 'all 0.15s',
                      }}>
                        <input type="radio" name="bidType" value={opt.value} checked={(form.type || 'Sell') === opt.value} onChange={e => setForm({...form, type: e.target.value})} style={{ accentColor: opt.color || 'var(--navy)' }} />
                        {opt.emoji && <span>{opt.emoji}</span>}{opt.value}
                      </label>
                    ))}
                  </div>
                </div>

                {/* Bid Structure */}
                <div>
                  <span style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 6, color: 'var(--slate-600)' }}>Bid</span>
                  <div role="group" aria-label="Bid" style={{ display: 'flex', gap: 20 }}>
                    {['Single', 'Block'].map(opt => (
                      <label key={opt} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer', color: 'var(--slate-700)' }}>
                        <input type="radio" name="bidStructure" value={opt} checked={(form.structure || 'Single') === opt} onChange={e => setForm({...form, structure: e.target.value})} style={{ accentColor: 'var(--navy)' }} />
                        {opt}
                      </label>
                    ))}
                  </div>
                </div>


                {/* Bid On — EX-BUS vs Regional Periphery */}
                <div>
                  <span style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 6, color: 'var(--slate-600)' }}>Bid On</span>
                  <div role="group" aria-label="Bid On" style={{ display: 'flex', gap: 20 }}>
                    {[
                      { value: 'EX-BUS', label: 'EX-BUS', hint: 'Plant Busbar' },
                      { value: 'PERIPHERY', label: 'Regional Periphery', hint: 'Grid Entry Point' },
                    ].map(opt => (
                      <label key={opt.value} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer', color: 'var(--slate-700)' }} title={opt.hint}>
                        <input type="radio" name="bidOn" value={opt.value} checked={(form.bid_on || 'EX-BUS') === opt.value} onChange={e => setForm({...form, bid_on: e.target.value})} style={{ accentColor: 'var(--navy)' }} />
                        {opt.label}
                      </label>
                    ))}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginTop: 4 }}>
                    {(form.bid_on || 'EX-BUS') === 'EX-BUS'
                      ? 'Losses borne by buyer · ₹/kWh at plant terminal'
                      : 'Includes CTU/STU transmission loss adjustment'}
                  </div>
                </div>
              </div>
            </div>

            {/* ── Row 2: Excel File Upload Zone with Block Granularity ── */}
            <div style={{ border: '1px solid var(--slate-200)', borderRadius: 8, padding: 20, marginBottom: 20, background: '#fafbfc' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                <div>
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--slate-600)' }}>Select Excel File Bid Type to Upload :</span>
                  <div role="group" aria-label="Select Excel File Bid Type to Upload " style={{ display: 'flex', gap: 18, marginTop: 8 }}>
                    {['24 Blocks', '50 Blocks', '96 Blocks'].map(opt => (
                      <label key={opt} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer', color: 'var(--slate-700)' }}>
                        <input type="radio" name="blockGranularity" value={opt} defaultChecked={opt === '96 Blocks'} style={{ accentColor: 'var(--navy)' }} />
                        {opt}
                      </label>
                    ))}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, fontSize: 12 }}>
                  <span style={{ color: 'var(--slate-500)' }}>Download formats:</span>
                  {['24 blocks', '50 blocks', '96 blocks'].map((t, i) => (
                    <React.Fragment key={t}>
                      {i > 0 && <span style={{ color: 'var(--slate-300)' }}>|</span>}
                      <button type="button" onClick={handleDownloadTemplate} style={{ background: 'none', border: 'none', color: 'var(--navy)', textDecoration: 'underline', cursor: 'pointer', padding: 0, fontSize: 12 }}>{t}</button>
                    </React.Fragment>
                  ))}
                </div>
              </div>

              {/* Drag-and-Drop Upload Zone */}
              <label
                htmlFor="dam-file-upload"
                style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  border: '2px dashed var(--slate-400)', borderRadius: 8, padding: '30px 20px',
                  background: '#fff', cursor: 'pointer', transition: 'all 0.2s',
                  minHeight: 100,
                }}
                onMouseOver={e => { e.currentTarget.style.background = '#f0f7ff'; e.currentTarget.style.borderColor = 'var(--navy)'; }}
                onMouseOut={e => { e.currentTarget.style.background = '#fff'; e.currentTarget.style.borderColor = 'var(--slate-400)'; }}
                onDragOver={e => { e.preventDefault(); e.currentTarget.style.background = '#e0f2fe'; e.currentTarget.style.borderColor = 'var(--sky)'; }}
                onDragLeave={e => { e.currentTarget.style.background = '#fff'; e.currentTarget.style.borderColor = 'var(--slate-400)'; }}
                onDrop={e => {
                  e.preventDefault();
                  e.currentTarget.style.background = '#fff';
                  e.currentTarget.style.borderColor = 'var(--slate-400)';
                  const file = e.dataTransfer.files?.[0];
                  if (file) {
                    // Reuse the existing handlePickFile logic
                    const fakeEvent = { target: { files: [file] } };
                    handlePickFile(fakeEvent);
                  }
                }}
              >
                <div style={{ fontSize: 36, marginBottom: 8 }}></div>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--slate-700)' }}>Drag & Drop .xlsx Bid File Here</div>
                <div style={{ fontSize: 12, color: 'var(--slate-500)', marginTop: 4 }}>or click to <strong>Browse Files</strong></div>
                <input
                  id="dam-file-upload"
                  type="file"
                  accept=".xlsx,.xlsm,.xls,.csv"
                  onChange={handlePickFile}
                  style={{ display: 'none' }}
                />
              </label>
              {bulkFileNote && <div style={{ marginTop: 10, fontSize: 13, color: 'var(--navy)', fontWeight: 500 }}> {bulkFileNote}</div>}
              <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end' }}>
                <button type="button" className="btn btn-primary" style={{ background: 'var(--navy)' }} disabled={!bulkText} onClick={() => runBulk(true)}>Import File Data</button>
              </div>
            </div>

            {/* ── Bulk validation result preview ── */}
            {bulkResult && (
              <div style={{ marginBottom: 20 }}>
                {bulkResult.bids_created > 0 && (
                  <div style={{ color: 'green', marginBottom: 10 }}> {bulkResult.bids_created} bid(s) created from {bulkResult.rows_received} row(s).</div>
                )}
                {bulkResult.preview?.length > 0 && (
                  <>
                    <h4 style={{ marginBottom: 8 }}>Parsed Bid Blocks Preview</h4>
                    <Table
                      columns={[
                        { key: 'client_name', label: 'Client' },
                        { key: 'exchange', label: 'Exchange' },
                        { key: 'product', label: 'Product' },
                        { key: 'delivery_date', label: 'Delivery' },
                        { key: 'blocks', label: 'Blocks' },
                        { key: 'total_mw', label: 'Total MW' },
                        { key: 'exposure', label: 'Exposure (₹)', render: (r) => fmtNumber(r.exposure) },
                      ]}
                      data={bulkResult.preview}
                    />
                  </>
                )}
                {bulkResult.errors?.length > 0 && (
                  <div style={{ marginTop: 12 }}>
                    <h4 style={{ marginBottom: 8, color: '#b00' }}>Errors ({bulkResult.errors.length})</h4>
                    {bulkResult.errors.map((e, i) => (
                      <div key={i} style={{ color: '#b00', fontSize: 13 }}>{e.row ? `Row ${e.row}: ` : ''}{e.errors.join('; ')}</div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ── Financial & Compliance Estimators ── */}
            {(() => {
              const activeBlocks = bulkResult?.preview ? bulkResult.preview.flatMap(p => p.blocks) : blocks;
              if (!activeBlocks || activeBlocks.length === 0 || !activeBlocks[0]?.quantum_mw) return null;

              // Estimator runs off the client's own clearance; without one there
              // is nothing to measure the bid against, so it stays hidden rather
              // than quoting another plant's cap and charges.
              if (!clearance || clearance.tgna_approved_mw == null) return null;

              const isExBus = (form.bid_on || 'EX-BUS') === 'EX-BUS';
              const lossMultiplier = 1 - (Number(clearance.periphery_loss_percent) || 0) / 100;
              const maxBidMW = Math.max(0, ...activeBlocks.map(b => Number(b.quantum_mw || 0)));
              const regionalMW = isExBus ? (maxBidMW * lossMultiplier) : maxBidMW;
              const utilPercent = Math.min(100, (regionalMW / clearance.tgna_approved_mw) * 100);

              let grossRevenue = 0;
              let totalMWBlocks = 0;
              let totalMWh = 0;

              activeBlocks.forEach(b => {
                const mw = Number(b.quantum_mw || 0);
                const price = Number(b.price_per_unit || 0);
                grossRevenue += mw * 0.25 * price;
                totalMWBlocks += mw;
                totalMWh += mw * 0.25;
              });

              const regionalTxFee = totalMWBlocks * (Number(clearance.regional_tx_charge_per_mw_block) || 0);
              const stateTxFee = totalMWh * (Number(clearance.state_tx_charge_per_mwh) || 0);
              const dailySLDCFee = Number(clearance.operating_charge_per_day) || 0;
              const netRevenue = grossRevenue - regionalTxFee - stateTxFee - dailySLDCFee;

              return (
                <div style={{ marginBottom: 20, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                  {/* Quantum Limit Guardrail */}
                  <div style={{ padding: 12, borderRadius: 8, background: 'var(--slate-50)', border: '1px solid var(--slate-300)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, alignItems: 'center' }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--slate-700)' }}>Approved NOAR Cap: {clearance.tgna_approved_mw} MW</span>
                      <span style={{ fontSize: 12, fontWeight: 700, color: utilPercent > 100 ? 'var(--red-strong)' : '#0ea5e9' }}>{utilPercent.toFixed(1)}% Utilized</span>
                    </div>
                    <div style={{ height: 6, background: 'var(--slate-200)', borderRadius: 3, overflow: 'hidden', marginBottom: 8 }}>
                      <div style={{ height: '100%', background: utilPercent > 100 ? 'var(--red-strong)' : '#0ea5e9', width: `${Math.min(100, utilPercent)}%` }} />
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--slate-500)' }}>
                      Current Bid: {maxBidMW.toFixed(2)} MW {isExBus ? `(EX-BUS) → ${regionalMW.toFixed(2)} MW (Periphery)` : '(Regional Periphery)'}
                    </div>
                  </div>

                  {/* Net Financial Estimator */}
                  <div style={{ padding: 12, borderRadius: 8, background: '#f0fdf4', border: '1px solid #bbf7d0' }}>
                    <h4 style={{ fontSize: 13, color: 'var(--green-strong)', margin: '0 0 8px 0' }}>Automated Clearing Net Financial Estimator</h4>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--slate-600)', marginBottom: 4 }}>
                      <span>Gross Revenue (Estimated):</span>
                      <span>₹ {grossRevenue.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--red-strong)', marginBottom: 4 }}>
                      <span>Transmission & SLDC Fees:</span>
                      <span>- ₹ {(regionalTxFee + stateTxFee + dailySLDCFee).toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: 'var(--green-strong)', fontWeight: 700, marginTop: 8, paddingTop: 8, borderTop: '1px solid #bbf7d0' }}>
                      <span>Net Realization:</span>
                      <span>₹ {netRevenue.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* ── Manual Block Entry (fallback/alternative) ── */}
            <details style={{ marginBottom: 20 }}>
              <summary style={{ cursor: 'pointer', fontSize: 13, fontWeight: 600, color: 'var(--slate-600)', marginBottom: 10 }}>
                ▸ Manual Block Entry (add blocks individually)
              </summary>
              <div style={{ paddingTop: 10 }}>
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
                <button type="button" className="btn btn-outline" onClick={() => setBlocks([...blocks, { ...EMPTY_BLOCK }])}>+ Add Block</button>
              </div>
            </details>

            {error && <div style={{ color: 'red', marginBottom: 15 }}>{error}</div>}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, borderTop: '1px solid var(--slate-200)', paddingTop: 15 }}>
              <button type="button" className="btn btn-outline" onClick={() => setShowCreate(false)}>Cancel</button>
              <button type="submit" className="btn btn-primary" style={{ background: 'var(--navy)' }}>Create Draft Portfolio</button>
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
            <div style={{ marginTop: 20, padding: 12, background: '#f2f6fb', borderLeft: '4px solid var(--navy)' }}>
              <strong>OCF Carry-Forward Chain</strong>
              <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                {chain.legs.map((l, i) => (
                  <React.Fragment key={l.id}>
                    {i > 0 && <span style={{ color: 'var(--navy)' }}>→</span>}
                    <span
                      style={{
                        padding: '4px 8px', borderRadius: 4, fontSize: 12,
                        background: l.id === selectedBid.id ? 'var(--navy)' : '#fff',
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

      {showCompareModal && selectedForCompare.length === 2 && (
        <Modal open={true} onClose={() => setShowCompareModal(false)} title="Compare Bid Revisions" width={900}>
          <div style={{ display: 'flex', gap: 20 }}>
            {selectedForCompare.map((id, index) => {
              const bid = rows.find(r => r.id === id);
              if (!bid) return null;
              return (
                <div key={id} style={{ flex: 1, border: '1px solid var(--slate-200)', borderRadius: 8, padding: 15, background: index === 0 ? 'var(--slate-50)' : '#f0fdf4' }}>
                  <h4 style={{ marginBottom: 10, color: index === 0 ? 'var(--slate-600)' : '#166534' }}>
                    {index === 0 ? 'Base Revision' : 'Target Revision'} ({bid.revision_no || '1'})
                  </h4>
                  <div style={{ fontSize: 13, marginBottom: 15, color: 'var(--slate-500)' }}>
                    <p><strong>Ref:</strong> {bid.id}</p>
                    <p><strong>Status:</strong> {bid.status}</p>
                  </div>
                  <Table 
                    columns={[
                      { key: 'time_block', label: 'Block' },
                      { key: 'quantum_mw', label: 'Req (MW)' },
                      { key: 'price_per_unit', label: 'Price (₹)' }
                    ]}
                    data={bid.blocks || []}
                  />
                </div>
              );
            })}
          </div>
          <div style={{ marginTop: 20, textAlign: 'right' }}>
            <button className="btn btn-outline" onClick={() => setShowCompareModal(false)}>Close Comparison</button>
          </div>
        </Modal>
      )}

      {showTimelineModal && (
        <Modal open={true} onClose={() => setShowTimelineModal(false)} title={`Revision Timeline: ${timelineDate}`} width={600}>
          <div style={{ padding: 10 }}>
            {tabBids.filter(b => isHistoryBid(b) && b.delivery_date === timelineDate)
              .sort((a, b) => (b.revision_no || 1) - (a.revision_no || 1))
              .map((bid, i, arr) => (
              <div key={bid.id} style={{ display: 'flex', gap: 15, marginBottom: 20 }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <div style={{ width: 12, height: 12, borderRadius: '50%', background: bid.status === 'REJECTED' ? '#ef4444' : '#10b981' }}></div>
                  {i !== arr.length - 1 && <div style={{ width: 2, flex: 1, background: 'var(--slate-200)', marginTop: 4 }}></div>}
                </div>
                <div>
                  <div style={{ fontWeight: 600, color: 'var(--slate-700)' }}>Revision {bid.revision_no || 1}</div>
                  <div style={{ fontSize: 13, color: 'var(--slate-500)', marginTop: 4 }}>
                    <strong>Submitted:</strong> {bid.id} | <strong>Type:</strong> {bid.type}
                  </div>
                  <div style={{ fontSize: 13, marginTop: 4, display: 'flex', gap: 10 }}>
                    <span style={{ color: 'var(--green-strong)' }}>File Prepared</span>
                    <span>|</span>
                    {bid.status === 'REJECTED' ? 
                      <span style={{ color: 'var(--red-strong)' }}>Exchange Error 402</span> : 
                      <span style={{ color: 'var(--green-strong)' }}>Exchange Cleared</span>
                    }
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 20, textAlign: 'right' }}>
            <button className="btn btn-outline" onClick={() => setShowTimelineModal(false)}>Close Timeline</button>
          </div>
        </Modal>
      )}

      {/* Slide-over Audit Trail Viewer for DAM History */}
      {auditBid && (
        <div style={{ position: 'fixed', top: 0, right: 0, bottom: 0, width: '600px', background: '#fff', zIndex: 9999, boxShadow: '-5px 0 25px rgba(0,0,0,0.2)', display: 'flex', flexDirection: 'column', animation: 'slideIn 0.3s ease-out forwards' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: 20, background: '#f8f9fa', borderBottom: '1px solid #dee2e6' }}>
            <div>
              <h3 style={{ margin: 0 }}>Audit Trail Viewer: {auditBid.id}</h3>
              <div style={{ fontSize: 12, color: 'var(--slate-500)', marginTop: 5 }}>Portfolio: {auditBid.client_name} | Delivery: {auditBid.delivery_date}</div>
            </div>
            <button onClick={() => setAuditBid(null)} style={{ background: 'none', border: 'none', fontSize: 24, cursor: 'pointer', lineHeight: 1 }}>&times;</button>
          </div>
          <div style={{ flex: 1, padding: 20, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
            <div style={{ background: 'var(--slate-50)', padding: 15, borderRadius: 6, border: '1px solid var(--slate-200)', marginBottom: 20 }}>
               <h4 style={{ margin: '0 0 10px 0', color: 'var(--slate-700)' }}>Digital Signature & Provenance</h4>
               <div style={{ fontSize: 13, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div><strong>Bid Source:</strong> API Gateway</div>
                  <div><strong>Origin Timestamp:</strong> {auditBid.bid_date} 10:45:12 UTC</div>
                  <div><strong>User Agent:</strong> SJVN_Algo_Bot/2.1</div>
                  <div><strong>Signature Hash:</strong> <span style={{ fontFamily: 'monospace', color: 'var(--sky)' }}>e3b0c44298fc...</span></div>
               </div>
            </div>
            
            <h4 style={{ marginBottom: 10, color: 'var(--slate-700)' }}>Submitted 96-Block MW/Price Matrix</h4>
            <Table 
              columns={[
                { key: 'time_block', label: 'Time Block' },
                { key: 'quantum_mw', label: 'Req Quantum (MW)' },
                { key: 'price_per_unit', label: 'Req Price (₹)' },
              ]} 
              data={auditBid.blocks || []} 
            />
          </div>
        </div>
      )}
      {/* ── Clause 23: Forced Outage Verification Modal ── */}
      {showOutageModal && (
        <Modal open={true} onClose={() => setShowOutageModal(false)} title="Compliance Check: Clause 23">
          <div style={{ padding: 20 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, marginBottom: 20 }}>
              <div style={{ fontSize: 32 }}></div>
              <div>
                <h4 style={{ margin: '0 0 8px 0', color: 'var(--red-strong)', fontSize: 16 }}>Regulatory Constraint Violation Risk</h4>
                <p style={{ margin: 0, fontSize: 13, color: 'var(--slate-700)', lineHeight: 1.5 }}>
                  As per its SLDC Standing Clearance, <strong>{clearance?.client_name || 'this generating station'}</strong> is strictly prohibited from submitting <strong>BUY</strong> bids on the power exchange unless the plant is undergoing an active <strong>Forced Outage</strong>.
                </p>
              </div>
            </div>
            
            <div style={{ background: 'var(--slate-50)', padding: 15, borderRadius: 8, border: '1px solid var(--slate-200)', marginBottom: 24 }}>
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer' }}>
                <input 
                  type="checkbox" 
                  checked={outageAcknowledged} 
                  onChange={e => setOutageAcknowledged(e.target.checked)} 
                  style={{ marginTop: 4, accentColor: 'var(--red-strong)', width: 16, height: 16 }}
                />
                <span style={{ fontSize: 13, color: 'var(--slate-600)', fontWeight: 500 }}>
                  I confirm that {clearance?.client_name || 'this generating station'} is currently experiencing a forced outage and this BUY bid is for replacement power. I understand that false declarations may result in {clearance?.sldc_name || 'the SLDC'} revoking the standing clearance (Clause 28).
                </span>
              </label>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
              <button className="btn btn-outline" onClick={() => setShowOutageModal(false)}>Cancel Bid</button>
              <button 
                className="btn btn-primary" 
                style={{ background: outageAcknowledged ? 'var(--red-strong)' : 'var(--slate-400)', borderColor: outageAcknowledged ? 'var(--red-deep)' : 'var(--slate-400)' }} 
                disabled={!outageAcknowledged}
                onClick={(e) => {
                  setShowOutageModal(false);
                  handleCreate(e); // Re-trigger submission now that outage is acknowledged
                }}
              >
                Confirm & Submit Bid
              </button>
            </div>
          </div>
        </Modal>
      )}
      {/* ── Portfolio Profile Pop-up Modal ── */}
      {showProfile && (
        <Modal open={true} onClose={() => setShowProfile(false)} title="Portfolio Profile" width={640}>
          <div style={{ padding: '0 20px 20px 20px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, border: '1px solid var(--slate-200)' }}>
              <tbody>
                {[
                  { k: 'Portfolio ID:', v: clearance?.client_id || '—' },
                  { k: 'Portfolio Name:', v: clearance?.client_name || '—' },
                  { k: 'NOAR ID:', v: clearance?.noar_id || '—' },
                  { k: 'Standing Clearance:', v: clearance?.standing_clearance_no || 'not on record' },
                  { k: 'Issuing SLDC:', v: clearance?.sldc_name || '—' },
                  { k: 'Valid Till:', v: clearance?.valid_till || '—' },
                  { k: 'T-GNA Cap:', v: clearance?.tgna_approved_mw != null ? `${clearance.tgna_approved_mw} MW` : '—' },
                  { k: 'Status:', v: <span style={{ color: 'var(--green-strong)', fontWeight: 600 }}>Active</span> },
                  { k: 'Tick Value:', v: '1' },
                  { k: 'Bid:', v: 'Single' },
                  { k: 'Bid On:', v: 'Regional Periphery' },
                  { k: 'Contact Person Name:', v: 'SJVN LTD' },
                  { k: 'Full Address:', v: 'SJVN LTD, CORPORATE HEAD QUARTERS, SHAKTI SADAN, SHANAN, SHIMLA-171006' },
                  { k: 'Zip Code:', v: '171006' },
                  { k: 'Mobile No.1:', v: '8894300943' },
                ].map((row, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid var(--slate-200)', background: i % 2 === 0 ? 'var(--slate-50)' : '#ffffff' }}>
                    <td style={{ padding: '8px 12px', fontWeight: 600, color: 'var(--slate-600)', width: '35%', borderRight: '1px solid var(--slate-200)' }}>{row.k}</td>
                    <td style={{ padding: '8px 12px', color: 'var(--slate-800)' }}>{row.v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
              <button className="btn btn-outline" onClick={() => setShowProfile(false)}>Close</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
