import React, { useState, useEffect } from 'react';
import { PortfolioSelect, usePortfolios } from '../../context/PortfolioContext.jsx';
import { api } from '../../api/client.js';
import { SampleDataNotice, PageHeader, Card, Badge, Table, fmtNumber } from '../../components/ui.jsx';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

export default function EnergySchedule() {
  const [blocks, setBlocks] = useState([]);
  const [loading, setLoading] = useState(false);
  const [viewMode, setViewMode] = useState('BLOCK'); // 'BLOCK' (96) or 'HOURLY' (24)
  const [peripheryView, setPeripheryView] = useState('BOTH'); // 'BOTH', 'BUSBAR', 'GRID'
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const { activeId: portfolio, active: activePortfolio } = usePortfolios();
  const [lossesConfig, setLossesConfig] = useState(null);

  const fetchSchedule = async () => {
    setLoading(true);
    try {
      const [schedule, losses] = await Promise.all([
        api.tradingOps.schedules({ date, portfolio }),
        api.losses.get(),
      ]);
      setBlocks(schedule.blocks);
      setLossesConfig(losses);
    } catch (err) {
      console.error('Failed to fetch schedules or losses', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSchedule();
  }, [date, portfolio]);

  const aggregatedData = React.useMemo(() => {
    if (viewMode === 'BLOCK') return blocks;
    
    // Aggregate to Hourly (24 rows)
    const hourly = [];
    for (let h = 0; h < 24; h++) {
      const chunk = blocks.slice(h * 4, h * 4 + 4);
      if (chunk.length === 0) continue;
      
      const plant_mw_avg = chunk.reduce((sum, b) => sum + b.plant_mw, 0) / 4;
      const regional_mw_avg = chunk.reduce((sum, b) => sum + b.regional_mw, 0) / 4;
      const jmr_mw_avg = chunk.reduce((sum, b) => sum + b.actual_jmr_mw, 0) / 4;
      
      hourly.push({
        block_no: `H${h+1}`,
        time_label: `${h.toString().padStart(2, '0')}:00 - ${(h+1).toString().padStart(2, '0')}:00`,
        plant_mw: plant_mw_avg,
        regional_mw: regional_mw_avg,
        buyer_mw: 0.0,
        scheduled_mwh: chunk.reduce((sum, b) => sum + b.scheduled_mwh, 0),
        actual_jmr_mw: jmr_mw_avg,
        deviation_mw: chunk.reduce((sum, b) => sum + b.deviation_mw, 0) / 4
      });
    }
    return hourly;
  }, [blocks, viewMode]);

  const renderMwBadge = (mw, isDrawal = false) => {
    if (mw === 0 || mw === '0.00' || !mw) {
      return <Badge type="neutral" style={{ opacity: 0.5 }}>0.00</Badge>;
    }
    if (mw < 0) return <Badge type="success">🟢 {Math.abs(mw).toFixed(2)} MW</Badge>;
    if (mw > 0 && isDrawal) return <Badge type="danger">🔴 {mw.toFixed(2)} MW</Badge>;
    if (mw > 0) return <Badge type="danger">🔴 {mw.toFixed(2)} MW</Badge>;
    return '0.00';
  };

  const renderDeviation = (dev) => {
    if (dev === 0) return <Badge type="neutral" style={{ opacity: 0.5 }}>0.00</Badge>;
    const absDev = Math.abs(dev);
    // If deviation is greater than 1MW for this example
    if (absDev > 1) {
      return <Badge type="danger">🔴 {dev.toFixed(2)} (Alert)</Badge>;
    }
    return <Badge type="neutral">{dev.toFixed(2)}</Badge>;
  };

  const columns = [
    { key: 'block_no', label: viewMode === 'BLOCK' ? 'Block (1-96)' : 'Hour (1-24)' },
    { key: 'time_label', label: 'Time Window' },
    // GRID PERIPHERY
    ...(peripheryView === 'BOTH' || peripheryView === 'GRID' ? [
      { key: 'regional_mw', label: 'Injection at Regional periphery', render: r => {
          let lossPercent = 0;
          if (r.plant_mw !== 0) {
              lossPercent = ((Math.abs(r.plant_mw) - Math.abs(r.regional_mw)) / Math.abs(r.plant_mw)) * 100;
          }
          return (
            <span title={lossPercent > 0 ? `${lossPercent.toFixed(2)}% ISTS Loss Applied` : ''}>
              {renderMwBadge(r.regional_mw)}
            </span>
          );
      } },
      { key: 'regional_drawal', label: 'Drawal at Regional periphery', render: () => renderMwBadge(0, true) }
    ] : []),
    // BUSBAR PERIPHERY
    ...(peripheryView === 'BOTH' || peripheryView === 'BUSBAR' ? [
      { key: 'plant_mw', label: 'Injection at Interface point', render: r => renderMwBadge(r.plant_mw) },
      { key: 'plant_drawal', label: 'Drawal at Interface point', render: () => renderMwBadge(0, true) }
    ] : []),
    { key: 'scheduled_mwh', label: 'Energy (MWh)', render: r => <span style={{fontWeight:'bold'}}>{fmtNumber(r.scheduled_mwh)}</span> },
    { key: 'actual_jmr_mw', label: 'Actual Meter (JMR)', render: r => renderMwBadge(r.actual_jmr_mw) },
    { key: 'deviation_mw', label: 'Deviation (MW)', render: r => renderDeviation(r.deviation_mw) }
  ];

  return (
    <div style={{ padding: 20, maxWidth: 1400, margin: '0 auto' }}>
      <SampleDataNotice detail="Schedule blocks, meter (JMR) readings and deviations come from an API stub, not from WBES or the plant's meters." />

      <PageHeader 
        title="Energy Schedule & DSM Matrix" 
        actions={
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn btn-outline">Format-D (RLDC)</button>
            <button className="btn btn-primary" style={{ background: '#28a745' }}>[ EXCEL v ] Export</button>
            <button className="btn btn-primary" style={{ background: '#0284c7' }}>⚡ Sync to RLDC / SLDC Portal</button>
          </div>
        }
      />

      <Card style={{ marginBottom: 20, background: '#f5f7f9' }}>
        <div style={{ display: 'flex', gap: 20, alignItems: 'center' }}>
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 'bold', marginBottom: 5 }} htmlFor="energyschedule-trading-date">Trading Date:</label>
            <input id="energyschedule-trading-date" type="date" className="input" value={date} onChange={e => setDate(e.target.value)} />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 'bold', marginBottom: 5 }} htmlFor="energyschedule-portfolio-id">Portfolio Id:</label>
            <PortfolioSelect id="energyschedule-portfolio-id" scope="global" allLabel="-- Select portfolio --" />
          </div>
          <div style={{ marginLeft: 'auto', borderLeft: '1px solid #ccc', paddingLeft: 20 }}>
            <span style={{ display: 'block', fontSize: 12, fontWeight: 'bold', marginBottom: 5 }}>Aggregation Level:</span>
            <div role="group" aria-label="Aggregation Level" style={{ display: 'flex', gap: 5 }}>
              <button 
                className={`btn btn-sm ${viewMode === 'BLOCK' ? 'btn-primary' : 'btn-outline'}`}
                onClick={() => setViewMode('BLOCK')}
              >
                15-Min Blocks (96)
              </button>
              <button 
                className={`btn btn-sm ${viewMode === 'HOURLY' ? 'btn-primary' : 'btn-outline'}`}
                onClick={() => setViewMode('HOURLY')}
              >
                Hourly (24)
              </button>
            </div>
          </div>
          <div style={{ marginLeft: 20, borderLeft: '1px solid #ccc', paddingLeft: 20 }}>
            <span style={{ display: 'block', fontSize: 12, fontWeight: 'bold', marginBottom: 5 }}>Periphery View:</span>
            <div role="group" aria-label="Periphery View" style={{ display: 'flex', gap: 5 }}>
              <button 
                className={`btn btn-sm ${peripheryView === 'BOTH' ? 'btn-primary' : 'btn-outline'}`}
                onClick={() => setPeripheryView('BOTH')}
              >
                Both Peripheries
              </button>
              <button 
                className={`btn btn-sm ${peripheryView === 'BUSBAR' ? 'btn-primary' : 'btn-outline'}`}
                onClick={() => setPeripheryView('BUSBAR')}
              >
                Plant Busbar (Ex-Bus)
              </button>
              <button 
                className={`btn btn-sm ${peripheryView === 'GRID' ? 'btn-primary' : 'btn-outline'}`}
                onClick={() => setPeripheryView('GRID')}
              >
                Grid Periphery (Ex-Grid)
              </button>
            </div>
          </div>
        </div>
      </Card>

      <Card>
        <div style={{ marginBottom: 20, padding: 15, background: '#e9ecef', borderRadius: 4, display: 'flex', justifyContent: 'space-between' }}>
          <div>
            <strong>Asset:</strong> {activePortfolio?.name || 'No portfolio selected'}<br/>
            <strong>Schedule Date:</strong> {new Date(date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase().replace(/ /g, '-')}
          </div>
          <div>
            <strong>Issued At:</strong> {new Date(new Date(date).getTime() - 86400000).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase().replace(/ /g, '-')} 12:44 PM<br/>
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <Badge type="success">🟢 RLDC Acknowledged</Badge>
              <Badge type="neutral">📧 Email Sent to Operator</Badge>
              <Badge type="neutral">📄 CSV Exported</Badge>
            </div>
          </div>
        </div>

        <div style={{ overflowX: 'auto', maxHeight: '70vh' }}>
          {loading ? (
            <div style={{ padding: 40, textAlign: 'center', color: '#666' }}>Loading Schedule Data...</div>
          ) : (
            <>
              {/* 96-Block Visual Schedule Chart */}
              {blocks.length > 0 && viewMode === 'BLOCK' && (
                <div style={{ marginBottom: 20, height: 250, width: '100%' }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={blocks} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="colorMw" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/>
                          <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis 
                        dataKey="block_no" 
                        tickFormatter={(val) => {
                          if (val === 1) return '00:00';
                          if (val === 48) return '12:00';
                          if (val === 96) return '24:00';
                          return '';
                        }}
                      />
                      <YAxis tickFormatter={(val) => `${val} MW`} />
                      <Tooltip 
                        labelFormatter={(label, payload) => {
                          if (payload && payload.length > 0) {
                            return `Block: ${label} | Time: ${payload[0].payload.time_label}`;
                          }
                          return `Block: ${label}`;
                        }}
                      />
                      <Area type="stepAfter" dataKey="plant_mw" name="Plant Generation (MW)" stroke="#10b981" fillOpacity={1} fill="url(#colorMw)" />
                      {peripheryView === 'BOTH' && (
                        <Area type="stepAfter" dataKey="regional_mw" name="Regional Periphery (MW)" stroke="#3b82f6" fillOpacity={0} />
                      )}
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}

              <Table columns={columns} data={aggregatedData} />
              
              {/* Transmission Loss Waterfall */}
              {lossesConfig && blocks.length > 0 && (
                <div style={{ marginTop: 30, padding: 20, background: '#e9ecef', borderRadius: 8, border: '1px solid #ced4da' }}>
                  <h3 style={{ marginTop: 0, marginBottom: 15, fontSize: 16 }}>Transmission Loss Waterfall (Daily Total)</h3>
                  
                  {(() => {
                    const totalPlantMw = Math.abs(blocks.reduce((sum, b) => sum + b.plant_mw, 0) / 4); // Total MWh calculation approx
                    // Get percentages from config
                    const stateLossPct = lossesConfig.state.HP.injection;
                    const corridorLossPct = lossesConfig.other;
                    
                    const stateLossMwh = (totalPlantMw * (stateLossPct / 100));
                    const stuBoundaryMw = totalPlantMw - stateLossMwh;
                    
                    const corridorLossMwh = (stuBoundaryMw * (corridorLossPct / 100));
                    const regionalDeliveryMw = stuBoundaryMw - corridorLossMwh;
                    
                    return (
                      <div style={{ fontFamily: 'monospace', fontSize: 14, background: '#fff', padding: 20, borderRadius: 4, border: '1px dashed #6c757d' }}>
                        <div style={{ fontWeight: 'bold' }}>[Plant Generation (Interface): {totalPlantMw.toFixed(4)} MWh]</div>
                        <div style={{ paddingLeft: 20, color: '#c0392b', margin: '8px 0' }}>↓ (-{stateLossPct}% HP State Loss = -{stateLossMwh.toFixed(4)} MWh)</div>
                        
                        <div style={{ fontWeight: 'bold' }}>[STU Boundary: {stuBoundaryMw.toFixed(4)} MWh]</div>
                        <div style={{ paddingLeft: 20, color: '#c0392b', margin: '8px 0' }}>↓ (-{corridorLossPct}% Corridor Loss = -{corridorLossMwh.toFixed(4)} MWh)</div>
                        
                        <div style={{ fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: 10 }}>
                           [Regional Delivery (ISTS): {regionalDeliveryMw.toFixed(4)} MWh] 
                           <Badge type="success">🟢 CLEARED</Badge>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              )}
            </>
          )}
        </div>
      </Card>
    </div>
  );
}
