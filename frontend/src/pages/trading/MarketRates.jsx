import React, { useEffect, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import api from '../../api/client.js';
import { PageHeader, Card, Table, fmtNumber } from '../../components/ui.jsx';

export default function MarketRates() {
  const [rows, setRows] = useState([]);
  const [product, setProduct] = useState('DAM');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.marketRates.list({ product }).then(setRows).finally(() => setLoading(false));
  }, [product]);

  const avgMcp = rows.length ? rows.reduce((s, r) => s + r.mcp_rate, 0) / rows.length : 0;
  const latest = rows[rows.length - 1];

  const columns = [
    { key: 'rate_date', header: 'Date' },
    { key: 'product', header: 'Product' },
    { key: 'mcp_rate', header: 'MCP Rate (₹/unit)', render: (r) => r.mcp_rate },
    { key: 'forecast_rate', header: 'Forecast Rate (₹/unit)', render: (r) => r.forecast_rate ?? '-' },
  ];

  return (
    <div>
      <PageHeader
        title="Market Rates &amp; Analytics"
        subtitle="Market Clearing Price trends and forecast readiness across exchange products"
      />

      <div className="filters-bar">
        <select value={product} onChange={(e) => setProduct(e.target.value)}>
          {['DAM', 'HPDAM', 'TAM', 'GDAM', 'RTM', 'GTAM'].map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>

      <div className="kpi-grid">
        <div className="stat-card">
          <div className="stat-label">Average MCP</div>
          <div className="stat-value">₹{fmtNumber(avgMcp, 2)}</div>
        </div>
        <div className="stat-card tone-blue">
          <div className="stat-label">Latest MCP</div>
          <div className="stat-value">₹{latest ? fmtNumber(latest.mcp_rate, 2) : '-'}</div>
          <div className="stat-hint">{latest?.rate_date}</div>
        </div>
        <div className="stat-card tone-green">
          <div className="stat-label">Latest Forecast</div>
          <div className="stat-value">₹{latest?.forecast_rate != null ? fmtNumber(latest.forecast_rate, 2) : '-'}</div>
        </div>
      </div>

      <Card title={`${product} Market Clearing Price Trend`}>
        <div className="chart-box">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={rows}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e6ed" />
              <XAxis dataKey="rate_date" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="mcp_rate" name="MCP Rate" stroke="#0b5fff" strokeWidth={2.5} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="forecast_rate" name="Forecast" stroke="#b3760a" strokeDasharray="4 4" strokeWidth={2} dot={{ r: 2 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <Card title="Rate History">
        <Table columns={columns} rows={loading ? [] : rows} emptyMessage={loading ? 'Loading...' : 'No market rate data found.'} />
      </Card>
    </div>
  );
}
