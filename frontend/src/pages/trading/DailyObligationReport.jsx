import React, { useState, useEffect } from 'react';
import { PortfolioSelect, usePortfolios } from '../../context/PortfolioContext.jsx';
import { api } from '../../api/client.js';
import { PageHeader, Card, Badge, fmtNumber } from '../../components/ui.jsx';

export default function DailyObligationReport() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  // The date filter is bound to this below; without the state it was a bare
  // undeclared identifier and the page threw on first render.
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [layout, setLayout] = useState('SPLIT'); // 'SPLIT' (1-48 | 49-96) or 'SINGLE'
  const { activeId: portfolio } = usePortfolios();

  const fetchDOR = async () => {
    setLoading(true);
    try {
      setData(await api.tradingOps.dor({ date, portfolio }));
    } catch (err) {
      console.error('Failed to fetch DOR', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDOR();
  }, [date, portfolio]);

  const renderVolume = (mw) => {
    if (mw === 0) return <span style={{ color: '#6c757d' }}>0.00</span>;
    if (mw < 0) return <span style={{ color: '#27ae60', fontWeight: 'bold' }}>{mw.toFixed(2)}</span>; // Green for cleared injection
    return <span>{mw.toFixed(2)}</span>;
  };

  const renderMcp = (mcp, volume) => {
    if (mcp >= 8000) {
      return <Badge type="success" style={{ background: '#f1c40f', color: '#000', fontWeight: 'bold' }}>₹ {fmtNumber(mcp)}</Badge>; // Gold
    }
    // For zero-cleared blocks, show MCP normally but slightly faded
    if (volume === 0) {
       return <span style={{ color: '#6c757d' }}>{fmtNumber(mcp)}</span>;
    }
    return <span>{fmtNumber(mcp)}</span>;
  };

  const getRowStyle = (block) => {
    if (block.volume_mw < 0) return { background: '#e8f5e9', borderBottom: '1px solid #c8e6c9' }; // Cleared & Generating
    if (block.volume_mw === 0) return { background: '#f8f9fa', borderBottom: '1px solid #dee2e6' }; // Zero Cleared (Recorded Price)
    return { borderBottom: '1px solid #eee' };
  };

  const TableHeader = () => (
    <thead>
      <tr style={{ background: '#343a40', color: '#fff' }}>
        <th scope="col" style={{ padding: 8, textAlign: 'left' }}>Time Block</th>
        <th scope="col" style={{ padding: 8, textAlign: 'right' }}>Qty (MW)</th>
        <th scope="col" style={{ padding: 8, textAlign: 'right' }}>Rate (₹/MWh)</th>
        <th scope="col" style={{ padding: 8, textAlign: 'right' }}>Amount (₹)</th>
      </tr>
    </thead>
  );

  const TableRow = ({ block }) => (
    <tr key={block.block_no} style={getRowStyle(block)}>
      <td style={{ padding: 8 }}>{block.time_label}</td>
      <td style={{ padding: 8, textAlign: 'right' }}>{renderVolume(block.volume_mw)}</td>
      <td style={{ padding: 8, textAlign: 'right' }}>{renderMcp(block.mcp, block.volume_mw)}</td>
      <td style={{ padding: 8, textAlign: 'right' }}>
         {block.trade_value === 0 ? <span style={{ color: '#6c757d' }}>0.00</span> : fmtNumber(block.trade_value)}
      </td>
    </tr>
  );

  return (
    <div style={{ padding: 20, maxWidth: 1600, margin: '0 auto' }}>
      {/* The report reads the bid book now: a block is here because a bid cleared
          on it. The charges that turn a gross position into a payout are raised
          on the exchange invoice, not on this report. */}
      {data?.note && <div className="alert alert-info" role="status">{data.note}</div>}

      <PageHeader 
        title="Daily Obligation Report (DOR) & Settlement" 
        actions={
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn btn-primary" style={{ background: '#d35400' }}>[ PDF v ] Export</button>
            <button className="btn btn-primary" style={{ background: '#28a745' }}>[ EXCEL v ] Export</button>
          </div>
        }
      />

      <Card style={{ marginBottom: 20, background: '#f5f7f9' }}>
        <div style={{ display: 'flex', gap: 20, alignItems: 'center' }}>
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 'bold', marginBottom: 5 }} htmlFor="dailyobligationreport-trading-date">Trading Date:</label>
            <input id="dailyobligationreport-trading-date" type="date" className="input" value={date} onChange={e => setDate(e.target.value)} />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 'bold', marginBottom: 5 }} htmlFor="dailyobligationreport-portfolio-tag">Portfolio Tag:</label>
            <PortfolioSelect id="dailyobligationreport-portfolio-tag" scope="global" allLabel="-- Select portfolio --" />
          </div>
          <div style={{ marginLeft: 'auto', borderLeft: '1px solid #ccc', paddingLeft: 20 }}>
            <span style={{ display: 'block', fontSize: 12, fontWeight: 'bold', marginBottom: 5 }}>Matrix Layout:</span>
            <div role="group" aria-label="Matrix Layout" style={{ display: 'flex', gap: 5 }}>
              <button 
                className={`btn btn-sm ${layout === 'SPLIT' ? 'btn-primary' : 'btn-outline'}`}
                onClick={() => setLayout('SPLIT')}
              >
                Split Grid (1-48 | 49-96)
              </button>
              <button 
                className={`btn btn-sm ${layout === 'SINGLE' ? 'btn-primary' : 'btn-outline'}`}
                onClick={() => setLayout('SINGLE')}
              >
                Single Column (1-96)
              </button>
            </div>
          </div>
        </div>
      </Card>

      <Card>
        {loading || !data ? (
          <div style={{ padding: 40, textAlign: 'center', color: '#666' }}>Loading DOR Data...</div>
        ) : (
          <div>
            <div style={{ marginBottom: 20, padding: 15, background: '#e9ecef', borderRadius: 4, display: 'flex', justifyContent: 'space-between' }}>
              <div>
                <strong>Client:</strong> {data.portfolio}
              </div>
              <div>
                <strong>Date:</strong> {data.date}
              </div>
            </div>

            {/* The clearance status printed here used to be a fixed string
                claiming an active NOC valid to 31-DEC-2026, regardless of the
                portfolio or the real record. A settlement report asserting an
                open-access approval that was never checked is the kind of claim
                an auditor would rely on, so it states the gap instead. */}
            <div style={{ marginBottom: 20, padding: '10px 15px', background: 'var(--slate-50)', color: 'var(--slate-600)', borderRadius: 4, border: '1px solid var(--slate-200)' }}>
               <strong>Standing Clearance (NOC):</strong> not shown — this report is not yet linked to the
               portfolio's clearance record. Check the client's clearance on the bidding screen.
            </div>

            <div style={{ display: 'flex', gap: 15, marginBottom: 10, fontSize: 12 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><div style={{width: 12, height: 12, background: '#e8f5e9', border: '1px solid #c8e6c9'}}></div> Cleared & Generating</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><div style={{width: 12, height: 12, background: '#f8f9fa', border: '1px solid #dee2e6'}}></div> Zero Cleared (Price Recorded)</span>
            </div>

            {layout === 'SPLIT' ? (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 40 }}>
                {/* Left Column 1-48 */}
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <TableHeader />
                  <tbody>
                    {data.blocks.slice(0, 48).map(b => <TableRow key={b.block_no} block={b} />)}
                  </tbody>
                </table>
                {/* Right Column 49-96 */}
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <TableHeader />
                  <tbody>
                    {data.blocks.slice(48, 96).map(b => <TableRow key={b.block_no} block={b} />)}
                  </tbody>
                </table>
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <TableHeader />
                <tbody>
                  {data.blocks.map(b => <TableRow key={b.block_no} block={b} />)}
                </tbody>
              </table>
            )}

            <div style={{ marginTop: 30, borderTop: '2px solid #000', paddingTop: 20 }}>
              <table style={{ width: '100%', fontSize: 16, fontWeight: 'bold' }}>
                <tbody>
                  <tr>
                    <td style={{ width: '50%' }}>TOTAL SUMMARY ({data.summary.blocks_with_obligation ?? data.blocks.length} BLOCKS WITH AN OBLIGATION)</td>
                    <td style={{ textAlign: 'right', paddingRight: 20 }}>Energy Cleared: <span style={{ color: '#2980b9' }}>{fmtNumber(data.summary.total_mwh)} MWh</span></td>
                    <td style={{ textAlign: 'right', paddingRight: 20 }}>Avg Rate: <span style={{ color: '#27ae60' }}>₹{fmtNumber(data.summary.weighted_avg_rate)}/MWh</span></td>
                    <td style={{ textAlign: 'right', color: '#c0392b' }}>Revenue: ₹{fmtNumber(data.summary.total_revenue)}</td>
                  </tr>
                </tbody>
              </table>
            </div>


            {/* A settlement waterfall stood here — NLDC fee, CTU, STU, SLDC, IEX
                fees, IGST, a net payout and a badge reading "MATCHED WITH IEX
                PORTAL" — every figure invented by the API stub. Those charges are
                raised on the exchange invoice, which is where they can be read
                against something real. */}
            <p style={{ marginTop: 24, fontSize: 12, color: '#555' }}>
              This report is the cleared position from the bid book. The charges that turn it into a payout —
              NLDC, CTU, STU, SLDC, exchange fees and tax — are raised on the exchange invoice for the period.
            </p>
          </div>
        )}
      </Card>

    </div>
  );
}
