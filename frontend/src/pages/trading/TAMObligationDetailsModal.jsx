import React from 'react';
import { Link } from 'react-router-dom';
import { Table, fmtNumber } from '../../components/ui.jsx';

function hoursFromTimeBlock(label) {
  const raw = String(label || '');
  const dash = raw.indexOf('-');
  if (dash > 0) {
    const s = raw.slice(0, dash).trim();
    const e = raw.slice(dash + 1).trim();
    const parse = (t) => {
      if (t === '24:00' || t === '24:00:00') return 24 * 60;
      const m = t.match(/^(\d{1,2}):(\d{2})/);
      if (!m) return null;
      const h = Number(m[1]);
      const min = Number(m[2]);
      if (h === 24 && min === 0) return 24 * 60;
      return h * 60 + min;
    };
    const start = parse(s);
    let end = parse(e);
    if (start != null && end != null) {
      if (end === 0 && start > 0) end = 24 * 60;
      if (end === start) end += 15;
      if (end < start) end += 24 * 60;
      const h = (end - start) / 60;
      if (h > 0 && h <= 24) return h;
    }
  }
  return 0.25;
}

function blockRows(record) {
  const bids = record.children?.length
    ? record.children.map((c) => c.bid).filter(Boolean)
    : record.bid ? [record.bid] : [];
  const rows = [];
  let sno = 1;
  for (const bid of bids) {
    for (const blk of bid.blocks || []) {
      const [fromTime, toTime] = String(blk.time_block || '').split('-');
      const hours = hoursFromTimeBlock(blk.time_block);
      const mw = Number(blk.cleared_quantum_mw || 0);
      const bidMw = Number(blk.quantum_mw || 0);
      const price = blk.cleared_price != null ? Number(blk.cleared_price) : Number(blk.price_per_unit || 0);
      rows.push({
        sno: sno++,
        bidId: bid.id,
        fromDate: bid.delivery_date,
        toDate: bid.delivery_date,
        fromTime: fromTime || '',
        toTime: toTime || '',
        bidMw,
        mw,
        mwh: mw * hours,
        price,
        value: mw * hours * 1000 * price,
        status: blk.status,
      });
    }
  }
  return rows;
}

export default function TAMObligationDetailsModal({ record, product = 'TAM', onClose }) {
  if (!record) return null;
  const scheduleData = blockRows(record);
  const totalMwh = scheduleData.reduce((a, r) => a + r.mwh, 0);
  const totalValue = scheduleData.reduce((a, r) => a + r.value, 0);

  const scheduleCols = [
    { key: 'sno', label: 'S.No.' },
    { key: 'fromDate', label: 'Delivery' },
    { key: 'fromTime', label: 'From' },
    { key: 'toTime', label: 'To' },
    { key: 'bidMw', label: 'Bid (MW)', render: (r) => fmtNumber(r.bidMw, 2) },
    { key: 'mw', label: 'Cleared (MW)', render: (r) => fmtNumber(r.mw, 2) },
    { key: 'mwh', label: 'Energy (MWh)', render: (r) => fmtNumber(r.mwh, 3) },
    { key: 'price', label: '₹/kWh', render: (r) => (r.price ? fmtNumber(r.price, 2) : '—') },
    { key: 'value', label: 'Value (₹)', render: (r) => fmtNumber(r.value, 2) },
    { key: 'status', label: 'Status' },
  ];

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
    }}>
      <div style={{ background: '#fff', borderRadius: 8, width: 1000, maxHeight: '90vh', overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '15px 20px', borderBottom: '1px solid #ddd', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#f8f9fa', borderRadius: '8px 8px 0 0' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 18, color: '#333' }}>{product} cleared blocks</h2>
            <div style={{ fontSize: 12, color: '#666', marginTop: 4 }}>
              {record.client_name} · {record.exchange} · {record.deliveryDate}
            </div>
          </div>
          <button type="button" onClick={onClose} style={{ background: 'transparent', border: 'none', fontSize: 24, cursor: 'pointer', color: '#888' }}>&times;</button>
        </div>

        <div style={{ padding: 20 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '15px 20px', marginBottom: 24 }}>
            <div>
              <div style={{ fontSize: 11, color: '#666', fontWeight: 'bold', textTransform: 'uppercase' }}>Client</div>
              <div style={{ fontSize: 14 }}>{record.client_name}</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: '#666', fontWeight: 'bold', textTransform: 'uppercase' }}>Exchange</div>
              <div style={{ fontSize: 14 }}>{record.exchange}</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: '#666', fontWeight: 'bold', textTransform: 'uppercase' }}>Contract</div>
              <div style={{ fontSize: 14 }}>
                {record.contract_id
                  ? <Link to={`/trading/exchange/contracts/${record.contract_id}`}>{record.contract_id}</Link>
                  : '—'}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: '#666', fontWeight: 'bold', textTransform: 'uppercase' }}>Status</div>
              <div style={{ fontSize: 14 }}>{record.status}</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: '#666', fontWeight: 'bold', textTransform: 'uppercase' }}>Cleared energy</div>
              <div style={{ fontSize: 14, fontWeight: 'bold' }}>{fmtNumber(totalMwh, 3)} MWh</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: '#666', fontWeight: 'bold', textTransform: 'uppercase' }}>Value</div>
              <div style={{ fontSize: 14, fontWeight: 'bold' }}>₹{fmtNumber(totalValue, 2)}</div>
            </div>
          </div>

          {scheduleData.length === 0 ? (
            <div style={{ padding: 24, textAlign: 'center', color: '#666' }}>No bid blocks on this row.</div>
          ) : (
            <Table columns={scheduleCols} data={scheduleData} />
          )}
        </div>
      </div>
    </div>
  );
}
