import React from 'react';
import { Card } from '../../components/ui.jsx';
import { 
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  ComposedChart, AreaChart, Area, Cell
} from 'recharts';

const BILATERAL_DATA = [
  { state: 'Gujarat', purchase: 1280, sale: null },
  { state: 'State2', purchase: 1150, sale: null },
  { state: 'State3', purchase: 920, sale: null },
  { state: 'State4', purchase: 620, sale: null },
  { state: 'State5', purchase: 580, sale: null },
  { state: 'Maharashtra', purchase: 548.05, sale: null },
  { state: 'State7', purchase: 540, sale: null },
  { state: 'State8', purchase: 430, sale: null },
  { state: 'State9', purchase: 420, sale: null },
  { state: 'State10', purchase: 410, sale: null },
  { state: 'Limited-Raipur TPP', purchase: null, sale: 1080 },
  { state: 'State12', purchase: null, sale: 660 },
  { state: 'State13', purchase: null, sale: 420 },
  { state: 'State14', purchase: null, sale: 400 },
  { state: 'State15', purchase: null, sale: 300 },
  { state: 'State16', purchase: null, sale: 280 },
  { state: 'State17', purchase: null, sale: 270 },
  { state: 'State18', purchase: null, sale: 260 },
  { state: 'State19', purchase: null, sale: 250 },
  { state: 'State20', purchase: null, sale: 245 }
];

const DAM_DATA = [
  { state: 'Gujarat', purchase: 980, sale: null },
  { state: 'State2', purchase: 900, sale: null },
  { state: 'State3', purchase: 500, sale: null },
  { state: 'State4', purchase: 480, sale: null },
  { state: 'State5', purchase: 300, sale: null },
  { state: 'State6', purchase: 280, sale: null },
  { state: 'State7', purchase: 270, sale: null },
  { state: 'State8', purchase: 270, sale: null },
  { state: 'State9', purchase: 250, sale: null },
  { state: 'State10', purchase: 245, sale: null },
  { state: 'State11', purchase: null, sale: 560 },
  { state: 'State12', purchase: null, sale: 480 },
  { state: 'State13', purchase: null, sale: 400 },
  { state: 'State14', purchase: null, sale: 280 },
  { state: 'State15', purchase: null, sale: 220 },
  { state: 'State16', purchase: null, sale: 220 },
  { state: 'State17', purchase: null, sale: 210 },
  { state: 'State18', purchase: null, sale: 180 },
  { state: 'State19', purchase: null, sale: 180 },
  { state: 'Tamil Nadu', purchase: null, sale: 150 }
];

const ENLARGED_GTAM_DATA = [
  { name: 'Any Day Single Sided Contracts', exchange: 'HPX', volume: 28.40, price: 4.62 },
  { name: 'Daily Contracts', exchange: 'HPX', volume: 0, price: 0 },
  { name: 'Day Ahead Contingency Contracts', exchange: 'HPX', volume: 0, price: 0 },
  { name: 'Intra Day Contracts', exchange: 'HPX', volume: 0, price: 0 },
  { name: 'Monthly Contracts', exchange: 'HPX', volume: 14.88, price: 4.67 },
  { name: 'Weekly Contracts', exchange: 'HPX', volume: 9.92, price: 8.15 },
  
  { name: 'Any Day Single Sided Contracts', exchange: 'IEX', volume: 0, price: 0 },
  { name: 'Daily Contracts', exchange: 'IEX', volume: 0, price: 0 },
  { name: 'Day Ahead Contingency Contracts', exchange: 'IEX', volume: 0, price: 0 },
  { name: 'Intra Day Contracts', exchange: 'IEX', volume: 52.25, price: 3.01 },
  { name: 'Monthly Contracts', exchange: 'IEX', volume: 4.07, price: 5.55 },
  { name: 'Weekly Contracts', exchange: 'IEX', volume: 0, price: 0 },

  { name: 'Any Day Single Sided Contracts', exchange: 'PXIL', volume: 0, price: 0 },
  { name: 'Daily Contracts', exchange: 'PXIL', volume: 0, price: 0 },
  { name: 'Day Ahead Contingency Contracts', exchange: 'PXIL', volume: 0, price: 0 },
  { name: 'Intra Day Contracts', exchange: 'PXIL', volume: 0, price: 0 },
  { name: 'Monthly Contracts', exchange: 'PXIL', volume: 0, price: 0 },
  { name: 'Weekly Contracts', exchange: 'PXIL', volume: 0, price: 0 },
];


export default function GTAMAnalyticsWidget() {
  return (
    <div>
      
      {/* Top 10 Participants Row */}
      <div className="grid-2">
        
        {/* Bilateral Chart */}
        <Card title="Top 10 Bilateral Participants">
          <div className="chart-box">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={BILATERAL_DATA} margin={{ top: 0, right: 0, left: -20, bottom: 0 }} barCategoryGap="25%">
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="state" tick={{fontSize: 10}} tickFormatter={(val) => val.includes('State') ? '' : val} axisLine={true} tickLine={false} />
                <YAxis tick={{fontSize: 10}} axisLine={false} tickLine={false} />
                <Tooltip cursor={{fill: '#f1f5f9'}} contentStyle={{borderRadius: '4px', fontSize: '12px'}} />
                <Bar dataKey="purchase" stackId="a">
                  {BILATERAL_DATA.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill="#3b82f6" />
                  ))}
                </Bar>
                <Bar dataKey="sale" stackId="a">
                  {BILATERAL_DATA.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill="#ef4444" />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {/* DAM Chart */}
        <Card title="Top 10 DAM Participants">
          <div className="chart-box">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={DAM_DATA} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="state" tick={{fontSize: 10}} tickFormatter={(val) => val.includes('State') ? '' : val} axisLine={true} tickLine={false} />
                <YAxis tick={{fontSize: 10}} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{borderRadius: '4px', fontSize: '12px'}} />
                <Legend verticalAlign="bottom" height={36} wrapperStyle={{fontSize: '12px', paddingTop: '20px'}}/>
                <Area type="linear" dataKey="purchase" name="Volume of Purchase" stroke="#3b82f6" fill="#93c5fd" dot={{r:3, stroke:'#3b82f6', fill:'white', strokeWidth:2}} connectNulls />
                <Area type="linear" dataKey="sale" name="Volume of Sale" stroke="#ef4444" fill="#fca5a5" dot={{r:3, stroke:'#ef4444', fill:'white', strokeWidth:2}} connectNulls />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

      </div>

      {/* Enlarged GTAM Chart */}
      <div style={{ background: 'var(--surface)', padding: 16, border: '1px solid var(--border)', borderRadius: 2, boxShadow: 'var(--shadow-sm)' }}>
        <h3 style={{ textAlign: 'center', fontWeight: 700, color: 'var(--text)', marginBottom: 8, fontSize: 17 }}>Volume and Price of Electricity Under GTAM in PX's</h3>
        
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-muted)', marginBottom: 16, paddingLeft: 40, paddingRight: 40 }}>
          <span>TAM Actual Scheduled Volume (MU)</span>
          <span>TAM Weighted Average Price (₹/kWh)</span>
        </div>

        <div style={{ height: 320, width: '100%', marginBottom: 40 }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={ENLARGED_GTAM_DATA} margin={{ top: 20, right: 20, bottom: 60, left: 20 }}>
              <CartesianGrid stroke="#eee" vertical={false} />
              
              <XAxis 
                dataKey="name" 
                tick={{fontSize: 10, fill: '#666'}} 
                angle={-45} 
                textAnchor="end"
                interval={0}
                tickFormatter={(val) => val}
              />
              
              <YAxis yAxisId="left" tick={{fontSize: 12, fill: '#666'}} axisLine={false} tickLine={false} domain={[0, 60]} />
              <YAxis yAxisId="right" orientation="right" tick={{fontSize: 12, fill: '#666'}} axisLine={false} tickLine={false} domain={[0, 10]} />
              
              <Tooltip cursor={{fill: '#f1f5f9'}} />
              
              <Bar yAxisId="left" dataKey="volume" name="TAM Actual Scheduled Volume (MU)" fill="#4b8ce3" barSize={20} />
              <Line yAxisId="right" type="monotone" dataKey="price" name="TAM Weighted Average Price (₹/kWh)" stroke="#df5661" strokeWidth={2} dot={{r: 4, stroke: '#df5661', fill: '#fff', strokeWidth: 2}} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        {/* Custom Labels for PX Groups */}
        <div style={{ position: 'relative', marginTop: -80, marginBottom: 40, display: 'flex', fontSize: 13, fontWeight: 700, color: 'var(--text)', justifyContent: 'space-around', marginLeft: 80, marginRight: 40 }}>
           <span>HPX</span>
           <span>IEX</span>
           <span>PXIL</span>
        </div>
        
        {/* Custom Legend */}
        <div style={{ display: 'flex', justifyContent: 'center', gap: 24, marginTop: 24, paddingBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 24, height: 12, background: '#4b8ce3', borderRadius: 2 }}></div>
            <span className="chart-legend-label">TAM Actual Scheduled Volume (MU)</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
             <div style={{ width: 16, height: 16, borderRadius: 999, border: '2px solid var(--border)', borderColor: '#df5661', background: 'var(--surface)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
               <div style={{ width: '100%', height: 2, background: '#df5661' }}></div>
            </div>
            <span className="chart-legend-label">TAM Weighted Average Price (₹/kWh)</span>
          </div>
        </div>

      </div>

      {/* GTAM Data Table */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 2, boxShadow: 'var(--shadow-sm)', overflow: 'hidden' }}>
        <table className="report-table">
          <thead>
            <tr style={{ background: '#4eb1fc', color: '#fff' }}>
              <th style={{ padding: 12, borderRight: '1px solid var(--border)', borderColor: 'rgba(255,255,255,0.25)', fontWeight: 600, width: 96 }}>PX</th>
              <th style={{ padding: 12, borderRight: '1px solid var(--border)', borderColor: 'rgba(255,255,255,0.25)', fontWeight: 600, textAlign: 'left' }}>Product</th>
              <th>GTAM Actual Scheduled<br/>Volume (MU)</th>
              <th style={{ padding: 12, fontWeight: 600 }}>GTAM Weighted Average Price<br/>(₹/kWh)</th>
            </tr>
          </thead>
          <tbody style={{ color: 'var(--text)' }}>
            {/* HPX Section */}
            <tr>
              <td rowSpan={6}>HPX</td>
              <td>Any Day Single Sided<br/>Contracts</td>
              <td>28.40</td>
              <td>4.62</td>
            </tr>
            <tr>
              <td>Daily Contracts</td>
              <td>0.00</td>
              <td>0.00</td>
            </tr>
            <tr>
              <td>Day Ahead Contingency<br/>Contracts</td>
              <td>0.00</td>
              <td>0.00</td>
            </tr>
            <tr>
              <td>Intra-Day Contracts</td>
              <td>0.00</td>
              <td>0.00</td>
            </tr>
            <tr>
              <td>Monthly Contracts</td>
              <td>14.88</td>
              <td>4.67</td>
            </tr>
            <tr>
              <td>Weekly Contracts</td>
              <td>9.92</td>
              <td>8.15</td>
            </tr>

            {/* IEX Section */}
            <tr>
              <td rowSpan={6}>IEX</td>
              <td>Any Day Single Sided<br/>Contracts</td>
              <td>0.00</td>
              <td>0.00</td>
            </tr>
            <tr>
              <td>Daily Contracts</td>
              <td>0.00</td>
              <td>0.00</td>
            </tr>
            <tr>
              <td>Day Ahead Contingency<br/>Contracts</td>
              <td>0.00</td>
              <td>0.00</td>
            </tr>
            <tr>
              <td>Intra-Day Contracts</td>
              <td>52.25</td>
              <td>3.01</td>
            </tr>
            <tr>
              <td>Monthly Contracts</td>
              <td>4.07</td>
              <td>5.55</td>
            </tr>
            <tr>
              <td>Weekly Contracts</td>
              <td>0.00</td>
              <td>0.00</td>
            </tr>
          </tbody>
        </table>
      </div>

    </div>
  );
}
