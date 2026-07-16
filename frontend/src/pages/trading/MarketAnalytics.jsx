import React, { useEffect, useState } from 'react';
import { api } from '../../api/client.js';
import { PageHeader, Card, Table, Badge, Modal, Field, fmtNumber } from '../../components/ui.jsx';

export default function MarketAnalytics() {
  const [rates, setRates] = useState([]);
  const [events, setEvents] = useState([]);
  const [factors, setFactors] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [showAlertModal, setShowAlertModal] = useState(false);
  const [alertForm, setAlertForm] = useState({ product: 'DAM', condition: 'ABOVE', threshold_price: '' });

  useEffect(() => {
    loadData();
    loadAlerts();
  }, []);

  async function loadData() {
    try {
      const rateData = await api.marketAnalytics.getRates();
      const contextData = await api.marketAnalytics.getContext();
      setRates(rateData);
      setEvents(contextData.events);
      setFactors(contextData.factors);
    } catch (err) {}
  }

  async function loadAlerts() {
    try {
      const alertData = await api.marketAnalytics.getAlerts();
      setAlerts(alertData);
    } catch (err) {}
  }

  async function handleCreateAlert(e) {
    e.preventDefault();
    try {
      await api.marketAnalytics.createAlert(alertForm);
      setShowAlertModal(false);
      loadAlerts();
    } catch (err) {
      alert("Failed to create alert");
    }
  }

  const ratesCols = [
    { key: 'rate_date', label: 'Date' },
    { key: 'exchange', label: 'Exchange', render: r => <Badge type="primary">{r.exchange}</Badge> },
    { key: 'product', label: 'Product' },
    { key: 'mcp_rate', label: 'MCP (₹/unit)', render: r => `₹${r.mcp_rate}` },
    { key: 'volume_mw', label: 'Volume (MW)', render: r => fmtNumber(r.volume_mw) },
    { key: 'forecast_rate', label: 'Forecast (₹/unit)', render: r => <span style={{color:'#777'}}>₹{r.forecast_rate}</span> },
    { key: 'data_source', label: 'Source' },
  ];

  const eventsCols = [
    { key: 'event_date', label: 'Date' },
    { key: 'event_type', label: 'Type', render: r => <Badge>{r.event_type}</Badge> },
    { key: 'description', label: 'Description' },
    { key: 'impact_level', label: 'Impact', render: r => <Badge type={r.impact_level === 'HIGH' ? 'danger' : r.impact_level === 'MEDIUM' ? 'warning' : 'success'}>{r.impact_level}</Badge> },
  ];

  const factorsCols = [
    { key: 'factor_date', label: 'Date' },
    { key: 'weather_index', label: 'Weather Index (Temp)' },
    { key: 'renewable_forecast_mw', label: 'Renewables (MW)' },
    { key: 'coal_price_index', label: 'Coal Index' },
  ];

  return (
    <div style={{ padding: 20 }}>
      <PageHeader 
        title="Market Rates & Analytics" 
        actions={
          <button className="btn btn-outline" onClick={() => setShowAlertModal(true)}>+ Set Price Alert</button>
        }
      />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 20 }}>
        <Card title="Multi-Exchange Rates (IEX, PXIL, HPX)">
          <Table columns={ratesCols} data={rates.slice(0, 15)} />
        </Card>
        
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <Card title="Market Events (Context)">
            <Table columns={eventsCols} data={events} />
          </Card>
          <Card title="External Factors (Weather & Fuel)">
            <Table columns={factorsCols} data={factors.slice(0, 5)} />
          </Card>
        </div>
      </div>

      <Card title="Active Price Alerts">
        <Table 
          columns={[
            { key: 'product', label: 'Product' },
            { key: 'condition', label: 'Condition' },
            { key: 'threshold_price', label: 'Threshold Price (₹)', render: r => `₹${r.threshold_price}` },
            { key: 'is_active', label: 'Status', render: r => <Badge type={r.is_active ? 'success' : 'neutral'}>{r.is_active ? 'Active' : 'Inactive'}</Badge> },
          ]} 
          data={alerts} 
        />
      </Card>

      {showAlertModal && (
        <Modal open={true} onClose={() => setShowAlertModal(false)} title="Set Market Price Alert" width={400}>
          <form onSubmit={handleCreateAlert}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 15, marginBottom: 20 }}>
              <Field label="Product" required>
                <select className="input" value={alertForm.product} onChange={e => setAlertForm({...alertForm, product: e.target.value})}>
                  <option value="DAM">DAM</option>
                  <option value="RTM">RTM</option>
                  <option value="GDAM">GDAM</option>
                </select>
              </Field>
              <Field label="Condition" required>
                <select className="input" value={alertForm.condition} onChange={e => setAlertForm({...alertForm, condition: e.target.value})}>
                  <option value="ABOVE">Spikes Above</option>
                  <option value="BELOW">Drops Below</option>
                </select>
              </Field>
              <Field label="Threshold Price (₹)" required>
                <input type="number" step="0.01" className="input" value={alertForm.threshold_price} onChange={e => setAlertForm({...alertForm, threshold_price: e.target.value})} required />
              </Field>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button type="button" className="btn btn-outline" onClick={() => setShowAlertModal(false)}>Cancel</button>
              <button type="submit" className="btn btn-primary">Create Alert</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
