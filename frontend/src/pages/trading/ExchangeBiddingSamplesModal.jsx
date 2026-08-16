import React, { useMemo, useState } from 'react';
import { Modal } from '../../components/ui.jsx';

/** ISET Exchange Bidding Samples — files offered from Download Samples. */
export const BIDDING_SAMPLE_FILES = [
  { name: 'DAM_SINGLE_BID_SELL.csv', product: 'DAM', bid: 'single', side: 'Sell' },
  { name: 'DAM_SINGLE_BID_BUY.csv', product: 'DAM', bid: 'single', side: 'Buy' },
  { name: 'DAM_BLOCKBID_BUY.csv', product: 'DAM', bid: 'block', side: 'Buy' },
  { name: 'DAM_BLOCKBID_SELL.csv', product: 'DAM', bid: 'block', side: 'Sell' },
  { name: 'RTM_SINGLE_BID_SELL.csv', product: 'RTM', bid: 'single', side: 'Sell' },
  { name: 'RTM_SINGLE_BID_BUY.csv', product: 'RTM', bid: 'single', side: 'Buy' },
];

function csvFor(file) {
  const isBlock = file.bid === 'block';
  const header = isBlock
    ? 'from_period_id,to_period_id,buy_sell,ocf_opted,premium_discount_price,max_ocf_quantity,rate,quantity,bid_reference,block_id'
    : 'from_period_id,to_period_id,buy_sell,ocf_opted,premium_discount_price,max_ocf_quantity,rate,quantity,bid_reference';

  const rows = isBlock
    ? [
        `17:30,17:45,${file.side},No,0,0,2500,500,SJVA11,B1`,
        `17:45,23:30,${file.side},No,0,0,2500,900,SJVA12,B2`,
      ]
    : [
        `00:00,00:15,${file.side},No,0,0,${file.side === 'Buy' ? '3200' : '3500'},10,SJVA11`,
        `00:15,01:00,${file.side},No,0,0,${file.side === 'Buy' ? '3100' : '3400'},15,SJVA12`,
      ];

  // RTM samples include a session hint in a comment row? Keep same columns; caller uses product for context.
  return `${header}\n${rows.join('\n')}\n`;
}

function downloadFile(file) {
  const blob = new Blob([csvFor(file)], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * Modal listing the six ISET sample CSVs (DAM/RTM single & block, buy/sell).
 */
export default function ExchangeBiddingSamplesModal({ open, onClose }) {
  const [search, setSearch] = useState('');
  const [pageSize, setPageSize] = useState(10);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return BIDDING_SAMPLE_FILES;
    return BIDDING_SAMPLE_FILES.filter((f) => f.name.toLowerCase().includes(q));
  }, [search]);

  const page = filtered.slice(0, pageSize);

  if (!open) return null;

  return (
    <Modal open onClose={onClose} title="Exchange Bidding Samples" width={720}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
        <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
          Show
          <select className="input" style={{ width: 70, padding: '4px 6px' }} value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))}>
            {[10, 25, 50].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
          entries
        </label>
        <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
          Search:
          <input className="input" style={{ width: 180 }} value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr>
            {['S.No', 'File Name', 'Download'].map((h) => (
              <th key={h} style={{ background: '#5b9bd5', color: '#fff', padding: '8px 12px', textAlign: 'left' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {page.length === 0 ? (
            <tr>
              <td colSpan={3} style={{ padding: 16, textAlign: 'center', color: '#64748b' }}>No matching samples</td>
            </tr>
          ) : page.map((file, i) => (
            <tr key={file.name} style={{ borderBottom: '1px solid #e2e8f0' }}>
              <td style={{ padding: '10px 12px' }}>{i + 1}</td>
              <td style={{ padding: '10px 12px' }}>{file.name}</td>
              <td style={{ padding: '10px 12px' }}>
                <button
                  type="button"
                  onClick={() => downloadFile(file)}
                  style={{ background: 'none', border: 'none', color: '#1d4ed8', cursor: 'pointer', fontWeight: 600, padding: 0 }}
                >
                  Download
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, fontSize: 12, color: '#64748b' }}>
        <span>
          Showing {page.length === 0 ? 0 : 1} to {page.length} of {filtered.length} entries
        </span>
        <span>
          <button type="button" className="btn btn-sm btn-outline" disabled style={{ marginRight: 6 }}>Previous</button>
          <button type="button" className="btn btn-sm btn-primary" style={{ marginRight: 6 }}>1</button>
          <button type="button" className="btn btn-sm btn-outline" disabled>Next</button>
        </span>
      </div>
    </Modal>
  );
}
