import React, { useEffect, useState } from 'react';
import { api } from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { PageHeader, Card, Table, Badge, Modal, Field, fmtNumber } from '../../components/ui.jsx';
import { DocumentManager } from '../../components/DocumentManager.jsx';

const EMPTY_FORM = {
  client_id: '', exchange: 'IEX', product: 'DAM', bid_date: '', delivery_date: '', gate_closure_time: '',
};

const EMPTY_BLOCK = { time_block: 'Block-1', quantum_mw: '', price_per_unit: '' };

export default function Bids() {
  const { user } = useAuth();
  const [rows, setRows] = useState([]);
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [blocks, setBlocks] = useState([{ ...EMPTY_BLOCK }]);
  const [error, setError] = useState('');
  const [selectedBid, setSelectedBid] = useState(null);

  function load() {
    setLoading(true);
    api.bids.list().then(setRows).finally(() => setLoading(false));
  }

  useEffect(load, []);
  useEffect(() => { api.tradingClients.list({ status: 'ACTIVE' }).then(setClients).catch(() => {}); }, []);

  function openCreate() {
    setForm(EMPTY_FORM);
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
    { key: 'actions', label: 'Actions', render: r => <button className="btn btn-outline" onClick={() => setSelectedBid(r)}>View</button> }
  ];

  return (
    <div style={{ padding: 20 }}>
      <PageHeader title="Exchange Bid Management" onAdd={openCreate} addLabel="New Portfolio Bid" />
      <Card>
        <Table columns={columns} data={rows} loading={loading} />
      </Card>

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
              <p><strong>Gate Closure:</strong> {new Date(selectedBid.gate_closure_time).toLocaleString()}</p>
              <p><strong>Approval Status:</strong> <Badge>{selectedBid.approval_status}</Badge></p>
              <p><strong>Exchange Status:</strong> <Badge>{selectedBid.status}</Badge></p>
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
