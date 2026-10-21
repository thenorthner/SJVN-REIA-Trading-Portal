import React, { useEffect, useState, useMemo } from 'react';
import { useCanWrite } from '../../lib/deskAccess.js';
import { useNavigate } from 'react-router-dom';
import {
  ResponsiveContainer, ComposedChart, BarChart, Bar, LineChart, Line, AreaChart, Area,
  PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine,
} from 'recharts';
import {
  Zap, Droplets, Flame, TrendingUp, ShieldCheck, FileText, Building2, Users,
  CheckCircle2, Clock, ArrowUpRight, BarChart3, PieChart as PieIcon, Layers,
  ArrowRight, ExternalLink, RefreshCw, AlertCircle, Sparkles, ChevronRight,
} from 'lucide-react';
import api from '../../api/client.js';
import { PageHeader, Card, fmtCurrency, fmtNumber, Badge } from '../../components/ui.jsx';
import SjvnMacroEnergyCorridor3D from '../../components/SjvnMacroEnergyCorridor3D.jsx';
import HydroEnergyOverview from '../../components/HydroEnergyOverview.jsx';

const CHART_COLORS = [
  '#10b981', '#3b82f6', '#8b5cf6', '#f59e0b', '#06b6d4',
  '#ec4899', '#14b8a6', '#6366f1', '#84cc16', '#a855f7',
];

export default function HydroThermalDashboard() {
  // Read-only for the administrators and the auditor (Target #2 Phase B).
  const canWrite = useCanWrite();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [stationFilter, setStationFilter] = useState('ALL');
  const [refreshing, setRefreshing] = useState(false);

  function loadDashboard() {
    setLoading(true);
    // The hydro desk's own stations: thermal has its own dashboard.
    api.hydroBilling.dashboard({ vertical: 'HYDRO' })
      .then((res) => {
        setData(res);
        setError('');
      })
      .catch((err) => {
        setError(err.response?.data?.error || err.message || 'Failed to load dashboard data');
      })
      .finally(() => {
        setLoading(false);
        setRefreshing(false);
      });
  }

  useEffect(() => {
    loadDashboard();
  }, []);

  function handleRefresh() {
    setRefreshing(true);
    loadDashboard();
  }

  // Filtered stations based on stationFilter
  const displayStations = useMemo(() => {
    if (!data?.stations) return [];
    if (stationFilter === 'ALL') return data.stations;
    return data.stations.filter((s) => s.id === stationFilter);
  }, [data, stationFilter]);

  if (loading && !data) {
    return (
      <div style={{ padding: '60px 20px', textAlign: 'center', color: 'var(--slate-500)' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10, fontSize: 16 }}>
          <RefreshCw size={20} className="spinning" /> Loading Hydro Billing Dashboard...
        </div>
      </div>
    );
  }

  const { kpis, stations, monthlyBillingTrend, pafmTrend, energyScheduledTrend, beneficiaryBreakup, pipeline, recentBills } = data || {};
  // Labels come from the data: the financial year, each station's NAPAF and
  // free-power share, and the home state that takes it.
  const fyLabel = data?.financial_year ? `FY ${data.financial_year.slice(0, 4)}-${data.financial_year.slice(7)}` : 'this FY';
  const napafs = [...new Set((stations || []).map((st) => st.napaf_percent).filter((v) => v != null))].sort((a, b) => a - b);
  const napafText = napafs.length ? napafs.map((v) => `${v}%`).join(' / ') : 'NAPAF';
  const fehs = [...new Set((stations || []).map((st) => st.free_energy_home_state).filter((v) => v != null))].sort((a, b) => a - b);
  const fehsText = fehs.length ? (fehs.length > 1 ? `${fehs[0]}–${fehs[fehs.length - 1]}%` : `${fehs[0]}%`) : '';
  const homeStates = [...new Set((stations || []).map((st) => st.home_state).filter(Boolean))].join(', ') || 'the home state';
  const pafmValues = (pafmTrend || []).flatMap((row) => (stations || []).map((st) => row[st.code])).filter((v) => v != null);
  const pafmDomain = [
    Math.max(0, Math.floor(Math.min(...pafmValues, ...napafs, 100) / 5) * 5 - 5),
    Math.ceil(Math.max(...pafmValues, ...napafs, 100) / 5) * 5 + 2,
  ];
  const desk = data?.desk || {};
  const mc = desk.month_close;

  return (
    <div style={{ paddingBottom: 40 }}>
      {/* Page Header */}
      <PageHeader
        title="Hydro Billing Dashboard"
        subtitle={`CERC two-part tariff billing, plant availability (PAFM), billing and regional settlement — ${fyLabel}${data?.as_of ? `, as of ${data.as_of}` : ''}`}
        actions={
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={handleRefresh}
              disabled={refreshing}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
            >
              <RefreshCw size={14} className={refreshing ? 'spinning' : ''} /> {refreshing ? 'Refreshing...' : 'Refresh'}
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => navigate('/hydro-thermal/hydro-ledger')}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
            >
              <FileText size={14} /> Beneficiary Ledger
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => navigate('/hydro-thermal/hydro-billing')}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
            >
              <Zap size={14} /> Station Bills
            </button>
          </div>
        }
      />

      {error && (
        <div style={{
          padding: '12px 16px',
          background: 'var(--t-red-50)',
          border: '1px solid var(--t-red-line)',
          borderRadius: 8,
          color: 'var(--on-red)',
          marginBottom: 20,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}>
          <AlertCircle size={18} />
          <span>{error}</span>
        </div>
      )}

      {/* What the desk has open today, from the same registers its screens show. */}
      {data?.desk && (
        <Card title={mc ? `The desk today — ${mc.period} close: ${mc.clear ? 'nothing holding it' : `${mc.open_items} item(s) holding it`}` : 'The desk today'} style={{ marginBottom: 24 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10 }}>
            {[
              ...(mc ? [
                { to: '/hydro-thermal/month-close', label: `${mc.period}: not billed`, value: mc.not_billed, tone: mc.not_billed ? 'amber' : null },
                { to: '/hydro-thermal/month-close', label: `${mc.period}: draft / approval`, value: mc.in_progress, tone: mc.in_progress ? 'amber' : null },
                { to: '/hydro-thermal/month-close', label: `${mc.period}: issued`, value: mc.issued },
                { to: '/hydro-thermal/month-close', label: `${mc.period}: booked to Finance`, value: mc.booked, tone: 'green' },
              ] : []),
              { to: '/hydro-thermal/approvals', label: 'Bills in approval', value: desk.approvals?.bills ?? 0, tone: desk.approvals?.bills ? 'amber' : null },
              { to: '/hydro-thermal/approvals', label: 'Notes awaiting checker', value: desk.approvals?.notes ?? 0, tone: desk.approvals?.notes ? 'amber' : null },
              { to: '/hydro-thermal/power-regulation', label: 'In default / regulated', value: `${desk.regulation?.candidates ?? 0} / ${desk.regulation?.regulating ?? 0}`, tone: desk.regulation?.candidates ? 'red' : null },
              { to: '/hydro-thermal/regulatory', label: 'Regulatory items open', value: desk.regulatory?.open ?? 0, tone: desk.regulatory?.overdue || desk.regulatory?.to_implement ? 'red' : null },
              { to: '/hydro-thermal/ppas', label: 'Billed without a PPA', value: desk.ppas?.missing ?? 0, tone: desk.ppas?.missing ? 'red' : null },
              { to: '/hydro-thermal/receivables', label: 'Overdue over 90 days', value: fmtCurrency(desk.ageing?.d90_plus || 0), tone: desk.ageing?.d90_plus ? 'red' : null },
              { to: '/hydro-thermal/advances', label: 'Advances unapplied', value: fmtCurrency(desk.ageing?.advance || 0) },
            ].map((p) => (
              <div
                key={p.label}
                role="link"
                tabIndex={0}
                onClick={() => navigate(p.to)}
                onKeyDown={(e) => { if (e.key === 'Enter') navigate(p.to); }}
                style={{ padding: '12px 14px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer' }}
              >
                <div style={{ fontSize: 13, color: 'var(--text-light)' }}>{p.label}</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: p.tone ? `var(--${p.tone})` : 'var(--text)' }}>{p.value}</div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Flagship SJVN Fleet-Wide Hydro-Thermal Macro Energy Corridor */}
      <SjvnMacroEnergyCorridor3D data={data} kpis={kpis} stations={stations} />

      {/* Module Navigation Cards Ribbon */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
        gap: 14,
        marginBottom: 24,
      }}>
        {[
          {
            title: 'Hydro Billing',
            tagline: 'Station-wise',
            hint: 'Raise & manage station bills',
            path: '/hydro-thermal/hydro-billing',
            badge: `${stations?.length ?? 0} Stations`,
            badgeColor: '#2563eb',
            badgeBg: '#eff6ff',
            icon: Droplets,
            gradient: 'linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%)',
            iconColor: '#2563eb',
          },
          {
            title: 'Account Display',
            tagline: 'Beneficiary Ledger',
            hint: 'View beneficiary accounts & clearing',
            path: '/hydro-thermal/hydro-ledger',
            badge: `${kpis?.beneficiariesCount ?? 0} Utilities`,
            badgeColor: '#059669',
            badgeBg: '#ecfdf5',
            icon: Users,
            gradient: 'linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%)',
            iconColor: '#059669',
          },
          {
            title: 'Additional Charges',
            tagline: 'Claims & TCS',
            hint: 'Manage water cess, RLDC & tax',
            path: '/hydro-thermal/hydro-claims',
            badge: 'TCS & Cess',
            badgeColor: '#d97706',
            badgeBg: '#fffbeb',
            icon: ShieldCheck,
            gradient: 'linear-gradient(135deg, #fffbeb 0%, #fef3c7 100%)',
            iconColor: '#d97706',
          },
          {
            title: 'Finance Posting',
            tagline: 'SAP FI Docs',
            hint: 'Post bills to SAP FI module',
            path: '/hydro-thermal/hydro-finance',
            badge: 'SAP Ready',
            badgeColor: '#7c3aed',
            badgeBg: '#f5f3ff',
            icon: FileText,
            gradient: 'linear-gradient(135deg, #f5f3ff 0%, #ede9fe 100%)',
            iconColor: '#7c3aed',
          },
          {
            title: 'PTC Sale Bills',
            tagline: 'Power Trading',
            hint: 'Bills raised on PTC for power sold',
            path: '/hydro-thermal/hydro-ptc',
            badge: 'Trading Desk',
            badgeColor: '#0891b2',
            badgeBg: '#ecfeff',
            icon: TrendingUp,
            gradient: 'linear-gradient(135deg, #ecfeff 0%, #cffafe 100%)',
            iconColor: '#0891b2',
          },
        ].map((item, idx) => {
          const Icon = item.icon;
          return (
            <div
              key={idx}
              onClick={() => navigate(item.path)}
              style={{
                background: 'var(--surface)',
                border: '1px solid var(--slate-200, var(--slate-200))',
                borderRadius: 12,
                padding: '16px 18px',
                cursor: 'pointer',
                transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                position: 'relative',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'translateY(-2px)';
                e.currentTarget.style.borderColor = item.badgeColor;
                e.currentTarget.style.boxShadow = `0 8px 20px rgba(0,0,0,0.06)`;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'none';
                e.currentTarget.style.borderColor = 'var(--slate-200, #e2e8f0)';
                e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.04)';
              }}
            >
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                  <div style={{
                    width: 38,
                    height: 38,
                    borderRadius: 10,
                    background: item.gradient,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: item.iconColor,
                  }}>
                    <Icon size={20} />
                  </div>
                  <span style={{
                    fontSize: 13,
                    fontWeight: 600,
                    padding: '2px 8px',
                    borderRadius: 999,
                    background: item.badgeBg,
                    color: item.badgeColor,
                    border: `1px solid ${item.badgeColor}33`,
                  }}>
                    {item.badge}
                  </span>
                </div>
                <div style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--slate-500)', marginBottom: 2 }}>
                  {item.title}
                </div>
                <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--slate-900)', marginBottom: 6 }}>
                  {item.tagline}
                </div>
              </div>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                paddingTop: 10,
                borderTop: '1px solid var(--slate-100, var(--slate-100))',
                marginTop: 8,
              }}>
                <span style={{ fontSize: 13.5, color: 'var(--slate-400)' }}>{item.hint}</span>
                <ArrowRight size={14} color="var(--slate-400)" />
              </div>
            </div>
          );
        })}
      </div>

      {/* Key Metric KPIs Ribbon */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
        gap: 14,
        marginBottom: 24,
      }}>
        <div style={{
          background: 'var(--surface)',
          borderRadius: 12,
          padding: '16px',
          border: '1px solid var(--slate-200)',
          boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
        }}>
          <div style={{ fontSize: 13.5, color: 'var(--slate-500)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            Total Capacity
          </div>
          <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--on-blue)', marginTop: 4 }}>
            {fmtNumber(kpis?.totalCapacityMw ?? 0, 0)} <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--slate-500)' }}>MW</span>
          </div>
          <div style={{ fontSize: 13.5, color: 'var(--slate-500)', marginTop: 4 }}>
            {fmtNumber(kpis?.operationalHydroMw ?? 0, 0)} MW Hydro{kpis?.thermalCommissioningMw ? ` · ${fmtNumber(kpis.thermalCommissioningMw, 0)} MW Thermal` : ''}
          </div>
        </div>

        <div style={{
          background: 'var(--surface)',
          borderRadius: 12,
          padding: '16px',
          border: '1px solid var(--slate-200)',
          boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
        }}>
          <div style={{ fontSize: 13.5, color: 'var(--slate-500)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            Annual Fixed Charges
          </div>
          <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--on-blue)', marginTop: 4 }}>
            ₹{fmtNumber(kpis?.annualAfcCr ?? 0, 1)} <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--slate-500)' }}>Cr</span>
          </div>
          <div style={{ fontSize: 13.5, color: 'var(--slate-500)', marginTop: 4 }}>
            CERC Approved Fixed Tariff
          </div>
        </div>

        <div style={{
          background: 'var(--surface)',
          borderRadius: 12,
          padding: '16px',
          border: '1px solid var(--slate-200)',
          boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
        }}>
          <div style={{ fontSize: 13.5, color: 'var(--slate-500)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            Billed ({fyLabel})
          </div>
          <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--on-blue)', marginTop: 4 }}>
            ₹{fmtNumber(kpis?.cumulativeBilledCr ?? 0, 1)} <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--slate-500)' }}>Cr</span>
          </div>
          <div style={{ fontSize: 13.5, color: 'var(--slate-500)', marginTop: 4 }}>
            Cumulative Capacity + Energy
          </div>
        </div>

        <div style={{
          background: 'var(--surface)',
          borderRadius: 12,
          padding: '16px',
          border: '1px solid var(--slate-200)',
          boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
        }}>
          <div style={{ fontSize: 13.5, color: 'var(--slate-500)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            Realized Collections
          </div>
          <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--on-green)', marginTop: 4 }}>
            {kpis?.realizationPct != null ? `${kpis.realizationPct}%` : '—'}
          </div>
          <div style={{ fontSize: 13.5, color: 'var(--slate-500)', marginTop: 4 }}>
            ₹{fmtNumber(kpis?.cumulativeCollectedCr ?? 0, 1)} Cr Received
          </div>
        </div>

        <div style={{
          background: 'var(--surface)',
          borderRadius: 12,
          padding: '16px',
          border: '1px solid var(--slate-200)',
          boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
        }}>
          <div style={{ fontSize: 13.5, color: 'var(--slate-500)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            Average Availability
          </div>
          <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--on-green)', marginTop: 4 }}>
            {kpis?.avgPafmPct != null ? `${kpis.avgPafmPct}%` : '—'}
          </div>
          <div style={{ fontSize: 13.5, color: 'var(--on-green)', marginTop: 4, fontWeight: 600 }}>
            NAPAF target: {(stations || []).map((st) => `${String(st.contract_no || '').split('/')[2] || st.station_name} ${st.napaf_percent ?? '—'}%`).join(' · ') || '—'}
          </div>
        </div>

        <div style={{
          background: 'var(--surface)',
          borderRadius: 12,
          padding: '16px',
          border: '1px solid var(--slate-200)',
          boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
        }}>
          <div style={{ fontSize: 13.5, color: 'var(--slate-500)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            Scheduled Generation
          </div>
          <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--on-blue)', marginTop: 4 }}>
            {fmtNumber(kpis?.cumulativeEnergyMu ?? 0, 1)} <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--slate-500)' }}>MU</span>
          </div>
          <div style={{ fontSize: 13.5, color: 'var(--slate-500)', marginTop: 4 }}>
            Ex-bus Energy to Northern Grid
          </div>
        </div>
      </div>

      {/* Station Portfolio Cards with Filter Chips */}
      <div style={{ marginBottom: 24 }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 12,
          marginBottom: 14,
        }}>
          <div>
            <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--slate-900)', margin: '0 0 4px' }}>
              Power Stations Operating Portfolio
            </h3>
            <p style={{ fontSize: 13, color: 'var(--slate-500)', margin: 0 }}>
              Tariff constants, capacity parameters, and CERC compliance for Hydro and Thermal generating stations
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--slate-500)', marginRight: 4 }}>Filter:</span>
            {[
              { id: 'ALL', label: 'All Stations' },
              ...(stations || []).map((st) => ({ id: st.id, label: `${st.station_name} (${fmtNumber(st.capacity_mw, 0)} MW)` })),
            ].map((f) => (
              <button
                key={f.id}
                type="button"
                className={`nb-chip ${stationFilter === f.id ? 'active' : ''}`}
                onClick={() => setStationFilter(f.id)}
                style={{ padding: '4px 10px', fontSize: 13.5 }}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
          gap: 16,
        }}>
          {displayStations.map((st) => {
            const isHydro = st.project_type === 'Hydro' || st.project_type === 'PSP';
            const isOperational = st.status === 'OPERATIONAL';
            return (
              <div
                key={st.id}
                style={{
                  background: 'var(--surface)',
                  borderRadius: 12,
                  border: '1px solid var(--slate-200)',
                  padding: '18px 20px',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                  position: 'relative',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                }}
              >
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{
                        width: 36,
                        height: 36,
                        borderRadius: 8,
                        background: isHydro ? 'var(--t-blue-50)' : 'var(--t-orange-50)',
                        color: isHydro ? 'var(--on-blue)' : 'var(--on-amber)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}>
                        {isHydro ? <Droplets size={20} /> : <Flame size={20} />}
                      </div>
                      <div>
                        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--slate-900)' }}>
                          {st.station_name}
                        </div>
                        <div style={{ fontSize: 13.5, color: 'var(--slate-500)' }}>
                          {st.contract_no}
                        </div>
                      </div>
                    </div>
                    <span style={{
                      fontSize: 13,
                      fontWeight: 600,
                      padding: '3px 8px',
                      borderRadius: 999,
                      background: isOperational ? 'var(--t-green-50)' : 'var(--t-amber-50)',
                      color: isOperational ? 'var(--on-green)' : 'var(--on-amber)',
                      border: `1px solid ${isOperational ? 'var(--t-green-100)' : 'var(--t-amber-line)'}`,
                    }}>
                      {st.status}
                    </span>
                  </div>

                  {/* Station Metrics Grid */}
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(2, 1fr)',
                    gap: 10,
                    padding: '12px',
                    background: 'var(--slate-50, var(--slate-50))',
                    borderRadius: 8,
                    marginBottom: 14,
                  }}>
                    <div>
                      <div style={{ fontSize: 13, color: 'var(--slate-500)' }}>Installed Capacity</div>
                      <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--slate-900)' }}>
                        {fmtNumber(st.capacity_mw, 0)} MW
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: 13, color: 'var(--slate-500)' }}>Annual AFC (CERC)</div>
                      <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--slate-900)' }}>
                        ₹{fmtNumber((st.annual_afc || 0) / 1e7, 1)} Cr
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: 13, color: 'var(--slate-500)' }}>Target NAPAF</div>
                      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--slate-800)' }}>
                        {st.napaf_percent}%
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: 13, color: 'var(--slate-500)' }}>Current PAFM</div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--on-green)' }}>
                        {st.pafm_achieved == null ? 'Not billed yet' : `${st.pafm_achieved}% (${st.pafm_month}) ${st.pafm_below_napaf ? '🔴 Below NAPAF' : '🟢 Normal'}`}
                      </div>
                    </div>
                  </div>
                </div>

                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  paddingTop: 12,
                  borderTop: '1px solid var(--slate-100)',
                }}>
                  <div style={{ fontSize: 13.5, color: 'var(--slate-500)' }}>
                    Design Energy: <strong>{fmtNumber((st.annual_design_energy_mwh || 0) / 1000, 0)} MU</strong>
                  </div>
                  {isOperational ? (
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => navigate(`/hydro-thermal/hydro-billing?contract_id=${st.id}`)}
                      style={{ fontSize: 13.5, padding: '4px 10px' }}
                    >
                      Manage Bills <ChevronRight size={14} />
                    </button>
                  ) : (
                    <span style={{ fontSize: 13.5, color: 'var(--on-amber)', fontWeight: 600 }}>
                      Tariff In Progress
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* REIA-migrated Hydro REA Generation & Plant Availability Analytics */}
      <HydroEnergyOverview contractId={stationFilter} />

      {/* Primary Analytics Charts (Row 1) */}
      <div className="grid-2" style={{ marginBottom: 24 }}>
        {/* Chart 1: Monthly Billing Trend */}
        <Card title={`Monthly Billing & Collection Trend (${fyLabel})`}>
          <div style={{ padding: '6px 0 14px', fontSize: 13.5, color: 'var(--slate-500)' }}>
            Station billing breakup across Capacity Charges, Energy Charges, and Realized Collections in ₹ Crore
          </div>
          <div className="chart-box" style={{ height: 320 }}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={monthlyBillingTrend || []}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--slate-200, #e2e8f0)" />
                <XAxis dataKey="billing_period" tick={{ fontSize: 13 }} />
                <YAxis tick={{ fontSize: 13 }} tickFormatter={(v) => `₹${v}Cr`} />
                <Tooltip
                  formatter={(val, name) => [
                    `₹${Number(val).toFixed(2)} Cr`,
                    name === 'capacity_charges'
                      ? 'Capacity Charge'
                      : name === 'energy_charges'
                      ? 'Energy Charge'
                      : 'Amount Collected',
                  ]}
                />
                <Legend
                  wrapperStyle={{ paddingTop: 10, fontSize: 13.5 }}
                  formatter={(val) =>
                    val === 'capacity_charges'
                      ? 'Capacity Charge (Fixed)'
                      : val === 'energy_charges'
                      ? 'Energy Charge (Variable)'
                      : 'Amount Collected'
                  }
                />
                <Bar dataKey="capacity_charges" stackId="a" fill="#3b82f6" radius={[0, 0, 0, 0]} name="capacity_charges" />
                <Bar dataKey="energy_charges" stackId="a" fill="#10b981" radius={[4, 4, 0, 0]} name="energy_charges" />
                <Line
                  type="monotone"
                  dataKey="collected_amount"
                  stroke="#f59e0b"
                  strokeWidth={2.5}
                  dot={{ r: 4, fill: '#f59e0b' }}
                  name="collected_amount"
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {/* Chart 2: Beneficiary Allocation & Revenue Share */}
        <Card title="Beneficiary Allocation & Revenue Share">
          <div style={{ padding: '6px 0 14px', fontSize: 13.5, color: 'var(--slate-500)' }}>
            Proportionate share of station capacity and charges allocated to Northern Region beneficiaries
          </div>
          <div className="chart-box" style={{ height: 320 }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={beneficiaryBreakup || []}
                  dataKey="share_pct"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={105}
                  innerRadius={55}
                  paddingAngle={2}
                  label={({ name, percent }) => `${(percent * 100).toFixed(0)}%`}
                >
                  {(beneficiaryBreakup || []).map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color || CHART_COLORS[index % CHART_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(val, name, item) => [
                    `${val}% (${item.payload.mw_share} MW · ₹${item.payload.billed_cr} Cr)`,
                    item.payload.name,
                  ]}
                />
                <Legend
                  layout="horizontal"
                  verticalAlign="bottom"
                  align="center"
                  wrapperStyle={{ fontSize: 13, maxHeight: 60, overflowY: 'auto', paddingTop: 10 }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      {/* Secondary Analytics Charts (Row 2) */}
      <div className="grid-2" style={{ marginBottom: 24 }}>
        {/* Chart 3: Plant Availability Factor (PAFM) vs Target */}
        <Card title={`Plant Availability Factor (PAFM) vs NAPAF (${napafText})`}>
          <div style={{ padding: '6px 0 14px', fontSize: 13.5, color: 'var(--slate-500)' }}>
            Monthly plant availability achieved against each station's NAPAF — the norm for full capacity charge recovery
          </div>
          <div className="chart-box" style={{ height: 300 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={pafmTrend || []}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--slate-200, #e2e8f0)" />
                <XAxis dataKey="period" tick={{ fontSize: 13 }} />
                <YAxis domain={pafmDomain} tick={{ fontSize: 13 }} tickFormatter={(v) => `${v}%`} />
                <Tooltip formatter={(val, name) => [`${val}%`, name.toUpperCase()]} />
                <Legend wrapperStyle={{ paddingTop: 10, fontSize: 13.5 }} />
                {napafs.map((v) => {
                  const who = (stations || []).filter((st) => st.napaf_percent === v).map((st) => st.code.toUpperCase()).join(', ');
                  return <ReferenceLine key={v} y={v} label={{ value: `NAPAF ${v}% (${who})`, fill: '#ef4444', fontSize: 12, position: 'insideTopRight' }} stroke="#ef4444" strokeDasharray="4 4" strokeWidth={1.5} />;
                })}
                {(stations || []).map((st, i) => (
                  <Line key={st.id} type="monotone" dataKey={st.code} name={`${st.station_name} (${fmtNumber(st.capacity_mw || 0, 0)} MW)`} stroke={CHART_COLORS[(i + 1) % CHART_COLORS.length]} strokeWidth={2.5} connectNulls dot={{ r: 3.5 }} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {/* Chart 4: Energy Generation & Scheduling Trend */}
        <Card title="Scheduled Generation vs Design Energy (MU)">
          <div style={{ padding: '6px 0 14px', fontSize: 13.5, color: 'var(--slate-500)' }}>
            Monthly design energy benchmark, actual scheduled energy ex-bus, and free power to {homeStates}
          </div>
          <div className="chart-box" style={{ height: 300 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={energyScheduledTrend || []}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--slate-200, #e2e8f0)" />
                <XAxis dataKey="period" tick={{ fontSize: 13 }} />
                <YAxis tick={{ fontSize: 13 }} tickFormatter={(v) => `${v} MU`} />
                <Tooltip formatter={(val, name) => [`${val} MU`, name === 'design_energy' ? 'Design Energy' : name === 'scheduled_energy' ? 'Scheduled Energy' : `Free Power (FEHS ${fehsText})`]} />
                <Legend wrapperStyle={{ paddingTop: 10, fontSize: 13.5 }} />
                <Bar dataKey="design_energy" name="Design Energy Target" fill="#94a3b8" radius={[4, 4, 0, 0]} />
                <Bar dataKey="scheduled_energy" name="Actual Scheduled Ex-Bus" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                <Bar dataKey="free_power" name={`Free Power to Home State${fehsText ? ` (${fehsText})` : ''}`} fill="#10b981" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      {/* Beneficiary Allocation & Realization Matrix Table */}
      <Card
        title="Beneficiary Utility Allocation & Settlement Position"
        actions={
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => navigate('/hydro-thermal/hydro-ledger')}
          >
            Open Full Ledger <ExternalLink size={13} style={{ marginLeft: 4 }} />
          </button>
        }
      >
        <div style={{ padding: '6px 0 14px', fontSize: 13.5, color: 'var(--slate-500)' }}>
          Northern Region beneficiaries billing share, MW entitlement, cumulative billed amount, and realization efficiency
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Beneficiary Utility</th>
                <th scope="col">State / Jurisdiction</th>
                <th scope="col" className="num">Capacity Share</th>
                <th scope="col" className="num">Allocated (MW)</th>
                <th scope="col" className="num">Billed (₹ Cr)</th>
                <th scope="col" className="num">Collected (₹ Cr)</th>
                <th scope="col" style={{ width: 140 }}>Realization Rate</th>
                <th scope="col">Status</th>
                <th scope="col" className="actions">Action</th>
              </tr>
            </thead>
            <tbody>
              {(beneficiaryBreakup || []).map((b, idx) => {
                const pctRealized = Math.round((b.collected_cr / b.billed_cr) * 100);
                return (
                  <tr key={idx}>
                    <td>
                      <div style={{ fontWeight: 600, color: 'var(--slate-900)' }}>{b.name}</div>
                    </td>
                    <td>{b.state}</td>
                    <td className="num" style={{ fontWeight: 600 }}>{b.share_pct}%</td>
                    <td className="num">{b.mw_share} MW</td>
                    <td className="num" style={{ fontWeight: 600 }}>₹{b.billed_cr}</td>
                    <td className="num" style={{ color: 'var(--on-green)', fontWeight: 600 }}>₹{b.collected_cr}</td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{
                          flex: 1,
                          height: 6,
                          background: 'var(--slate-200)',
                          borderRadius: 999,
                          overflow: 'hidden',
                        }}>
                          <div style={{
                            width: `${pctRealized}%`,
                            height: '100%',
                            background: pctRealized >= 98 ? '#10b981' : pctRealized >= 95 ? '#3b82f6' : '#f59e0b',
                            borderRadius: 999,
                          }} />
                        </div>
                        <span style={{ fontSize: 13, fontWeight: 600, minWidth: 32 }}>{pctRealized}%</span>
                      </div>
                    </td>
                    <td>
                      <span style={{
                        fontSize: 13,
                        fontWeight: 600,
                        padding: '2px 8px',
                        borderRadius: 999,
                        background: b.status === 'Settled' ? 'var(--t-green-50)' : b.status === 'Current' ? 'var(--t-blue-50)' : 'var(--t-red-50)',
                        color: b.status === 'Settled' ? 'var(--on-green)' : b.status === 'Current' ? 'var(--on-blue)' : 'var(--on-red)',
                        border: `1px solid ${b.status === 'Settled' ? 'var(--t-green-100)' : b.status === 'Current' ? 'var(--t-blue-line)' : 'var(--t-red-line)'}`,
                      }}>
                        {b.status}
                      </span>
                    </td>
                    <td className="actions">
                      <button
                        type="button"
                        className="btn btn-ghost btn-xs"
                        onClick={() => navigate(`/hydro-thermal/hydro-ledger?beneficiary=${encodeURIComponent(b.name)}`)}
                        style={{ fontSize: 13 }}
                      >
                        Ledger
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Billing Workflow Pipeline & Recent Station Bills */}
      <div style={{ marginTop: 24 }}>
        <Card
          title="Recent Station Billing Cycles & Approval Workflow"
          actions={canWrite && (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => navigate('/hydro-thermal/hydro-billing')}
            >
              + Raise Station Bill
            </button>
          )}
        >
          {/* Status Pipeline Funnel */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'var(--slate-50, var(--slate-50))',
            border: '1px solid var(--slate-200)',
            borderRadius: 10,
            padding: '12px 18px',
            marginBottom: 16,
            flexWrap: 'wrap',
            gap: 12,
          }}>
            {[
              { label: 'Draft Bills', count: pipeline?.draft ?? 0, color: '#64748b' },
              { label: 'In Approval', count: pipeline?.in_approval ?? 0, color: '#f59e0b' },
              { label: 'Approved', count: pipeline?.approved ?? 0, color: '#3b82f6' },
              { label: 'Issued', count: pipeline?.issued ?? 0, color: '#10b981' },
              { label: 'Dispatched to Beneficiaries', count: pipeline?.dispatched ?? 0, color: '#059669' },
            ].map((st, i, arr) => (
              <React.Fragment key={i}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{
                    width: 28,
                    height: 28,
                    borderRadius: '50%',
                    background: `${st.color}1a`,
                    color: st.color,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 13.5,
                    fontWeight: 700,
                  }}>
                    {st.count}
                  </div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--slate-900)' }}>{st.label}</div>
                  </div>
                </div>
                {i < arr.length - 1 && <ChevronRight size={16} color="var(--slate-300)" />}
              </React.Fragment>
            ))}
          </div>

          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Bill No</th>
                  <th scope="col">Station</th>
                  <th scope="col">Billing Month</th>
                  <th scope="col">Bill Kind</th>
                  <th scope="col" className="num">Capacity Charge</th>
                  <th scope="col" className="num">Energy Charge</th>
                  <th scope="col" className="num">Total Billed</th>
                  <th scope="col">Status</th>
                  <th scope="col" className="actions">Action</th>
                </tr>
              </thead>
              <tbody>
                {(recentBills || []).map((bill) => (
                  <tr key={bill.id}>
                    <td>
                      <span style={{ fontWeight: 600, fontFamily: 'monospace', color: 'var(--on-blue)' }}>
                        {bill.bill_no}
                      </span>
                    </td>
                    <td style={{ fontWeight: 500 }}>{bill.station_name}</td>
                    <td>{bill.billing_month}</td>
                    <td>
                      <span style={{
                        fontSize: 13,
                        padding: '2px 6px',
                        borderRadius: 4,
                        background: 'var(--slate-100)',
                        color: 'var(--slate-700)',
                        fontWeight: 600,
                      }}>
                        {bill.bill_kind}
                      </span>
                    </td>
                    <td className="num">{fmtCurrency(bill.capacity_charge)}</td>
                    <td className="num">{fmtCurrency(bill.energy_charge)}</td>
                    <td className="num" style={{ fontWeight: 700, color: 'var(--slate-900)' }}>
                      {fmtCurrency(bill.total_charges)}
                    </td>
                    <td>
                      <Badge status={bill.status || 'ISSUED'} />
                    </td>
                    <td className="actions">
                      <button
                        type="button"
                        className="btn btn-outline btn-xs"
                        onClick={() => navigate(`/hydro-thermal/hydro-billing?bill_id=${bill.id}`)}
                      >
                        View Bill
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}
