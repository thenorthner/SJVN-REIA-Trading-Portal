import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { ROLE_GROUPS } from '../../roles.js';
import { PageHeader, Card, Table, Badge, Modal, Field, fmtNumber, fmtCurrency } from '../../components/ui.jsx';

const TABS = [
  { id: 'entities', label: 'Entities' },
  { id: 'contracts', label: 'Contracts' },
  { id: 'projects', label: 'Projects' },
  { id: 'banks', label: 'Banks' },
  { id: 'holidays', label: 'Holidays & Working Calendar' },
  // Hidden for solar-focused scope (β is a hydro/PSP frequency-response input).
  // Uncomment to restore for hydro.
  // { id: 'beta', label: 'Frequency β' },
  { id: 'regulatory', label: 'Regulatory' },
  { id: 'billing', label: 'Billing Params' },
  { id: 'trading', label: 'Trading Params' },
  { id: 'documents', label: 'Document Types' },
  { id: 'lookups', label: 'Lookups' },
  { id: 'losses', label: 'Transmission Losses' },
];

const EMPTY_BANK = { bank_name: '', ifsc_prefix: '', branch_name: '', city: '', swift_code: '' };
const EMPTY_BETA = {
  contract_id: '', period_month: '', beta_value: '1.00',
  station_code: '', station_name: '', source: 'NRPC', certified_on: '', notes: '',
};
const EMPTY_PROJECT = {
  name: '', parent_entity_id: '', category: 'SPV', technology: 'Solar',
  capacity_mw: '', pan_no: '', gst_no: '', entity_type: 'SELLER',
  bank_name: 'HDFC Bank', account_no: '0000000000', ifsc_code: 'HDFC0000001', branch_address: 'N/A',
};
const EMPTY_LOOKUP = { id: null, category: 'PROJECT_TYPE', code: '', label: '', sort_order: 0, is_active: 1 };
const EMPTY_DOC = { id: null, module_name: 'STAKEHOLDERS', code: '', label: '', category: 'VERIFY', reason: '', is_mandatory: false, sort_order: 0, is_active: 1 };
const EMPTY_PARAM = { param_key: '', param_value: '', data_type: 'NUMBER', unit: '', description: '' };
const EMPTY_HOLIDAY = { holiday_date: '', name: '', scope: 'NATIONAL', state: '', holiday_type: 'PUBLIC', remarks: '' };

function formatDayName(dateStr) {
  if (!dateStr) return '';
  try {
    const d = new Date(`${dateStr}T00:00:00Z`);
    return d.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
  } catch {
    return '';
  }
}

export default function MastersHub() {
  const { user } = useAuth();
  const canWrite = ROLE_GROUPS.MASTERS_WRITE.includes(user?.role);
  const [tab, setTab] = useState('entities');
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState('');

  const [entities, setEntities] = useState([]);
  const [contracts, setContracts] = useState([]);
  const [projects, setProjects] = useState([]);
  const [parents, setParents] = useState([]);
  const [banks, setBanks] = useState([]);
  const [betas, setBetas] = useState([]);
  const [params, setParams] = useState([]);
  const [docTypes, setDocTypes] = useState([]);
  const [lookups, setLookups] = useState([]);
  const [lookupFilter, setLookupFilter] = useState('');
  const [docModuleFilter, setDocModuleFilter] = useState('');
  
  const [lossData, setLossData] = useState(null);
  const [loadingLosses, setLoadingLosses] = useState(false);

  // Holiday & Working Calendar state
  const [holidays, setHolidays] = useState([]);
  const [holidayStates, setHolidayStates] = useState([]);
  const [holidaySettings, setHolidaySettings] = useState(null);
  const [holidayYear, setHolidayYear] = useState('2026');
  const [holidayStateFilter, setHolidayStateFilter] = useState('');
  const [holidayScopeFilter, setHolidayScopeFilter] = useState('');
  const [includeInactiveHolidays, setIncludeInactiveHolidays] = useState(false);
  const [showAddHoliday, setShowAddHoliday] = useState(false);
  const [showBulkHoliday, setShowBulkHoliday] = useState(false);
  const [holidayForm, setHolidayForm] = useState(EMPTY_HOLIDAY);
  const [bulkHolidayText, setBulkHolidayText] = useState('');
  const [deactivateHolidayObj, setDeactivateHolidayObj] = useState(null);
  const [deactivateReason, setDeactivateReason] = useState('');

  // Live Due Date Simulator state
  const [simBillDate, setSimBillDate] = useState('2026-05-05');
  const [simTermsDays, setSimTermsDays] = useState(45);
  const [simState, setSimState] = useState('');
  const [simResult, setSimResult] = useState(null);
  const [simLoading, setSimLoading] = useState(false);

  const [bankForm, setBankForm] = useState(EMPTY_BANK);
  const [showBank, setShowBank] = useState(false);
  const [editBank, setEditBank] = useState(null);
  const [betaForm, setBetaForm] = useState(EMPTY_BETA);
  const [showBeta, setShowBeta] = useState(false);
  const [editBeta, setEditBeta] = useState(null);
  const [projectForm, setProjectForm] = useState(EMPTY_PROJECT);
  const [showProject, setShowProject] = useState(false);
  const [editParam, setEditParam] = useState(null);
  const [paramForm, setParamForm] = useState({ param_value: '', unit: '', description: '', is_active: 1 });
  const [showParam, setShowParam] = useState(false);
  const [newParamForm, setNewParamForm] = useState(EMPTY_PARAM);
  const [showLookup, setShowLookup] = useState(false);
  const [lookupForm, setLookupForm] = useState(EMPTY_LOOKUP);
  const [showDoc, setShowDoc] = useState(false);
  const [docForm, setDocForm] = useState(EMPTY_DOC);

  function loadSummary() {
    api.masters.summary().then(setSummary).catch(() => {});
  }

  function loadHolidaysData() {
    api.holidays.list({
      year: holidayYear || undefined,
      state: holidayStateFilter || undefined,
      scope: holidayScopeFilter || undefined,
      include_inactive: includeInactiveHolidays ? 1 : undefined,
    }).then(setHolidays).catch((e) => setError(e.response?.data?.error || 'Failed to load holidays'));
    api.holidays.states().then(setHolidayStates).catch(() => {});
    api.holidays.settings().then(setHolidaySettings).catch(() => {});
  }

  function loadTab(t = tab) {
    setError('');
    if (t === 'entities') api.entities.list().then(setEntities).catch((e) => setError(e.response?.data?.error || 'Failed'));
    if (t === 'contracts') api.contracts.list().then(setContracts).catch((e) => setError(e.response?.data?.error || 'Failed'));
    if (t === 'projects') {
      api.masters.projects().then(setProjects).catch(() => {});
      api.entities.list().then((all) => setParents(all.filter((e) => !e.parent_entity_id))).catch(() => {});
    }
    if (t === 'banks') api.masters.banks({ active: '0' }).then(setBanks).catch((e) => setError(e.response?.data?.error || 'Failed'));
    if (t === 'holidays') loadHolidaysData();
    if (t === 'beta') {
      api.stationBeta.list().then(setBetas).catch((e) => setError(e.response?.data?.error || 'Failed'));
      api.contracts.list().then(setContracts).catch(() => {});
    }
    if (t === 'regulatory') api.masters.parameters({ category: 'REGULATORY', active: '0' }).then(setParams).catch((e) => setError(e.response?.data?.error || 'Failed'));
    if (t === 'billing') api.masters.parameters({ category: 'BILLING', active: '0' }).then(setParams).catch((e) => setError(e.response?.data?.error || 'Failed'));
    if (t === 'trading') api.masters.parameters({ category: 'TRADING', active: '0' }).then(setParams).catch((e) => setError(e.response?.data?.error || 'Failed'));
    if (t === 'documents') api.masters.documentTypes({ active: '0' }).then(setDocTypes).catch((e) => setError(e.response?.data?.error || 'Failed'));
    if (t === 'lookups') api.masters.lookups({ active: '0' }).then(setLookups).catch((e) => setError(e.response?.data?.error || 'Failed'));
  }

  useEffect(() => { loadSummary(); }, []);
  useEffect(() => { loadTab(tab); }, [tab, holidayYear, holidayStateFilter, holidayScopeFilter, includeInactiveHolidays]);

  useEffect(() => {
    if (tab === 'holidays' && simBillDate) {
      setSimLoading(true);
      api.holidays.previewDueDate({
        bill_date: simBillDate,
        terms_days: simTermsDays,
        state: simState || undefined,
      }).then(setSimResult).catch(() => {}).finally(() => setSimLoading(false));
    }
  }, [tab, simBillDate, simTermsDays, simState]);

  async function saveHoliday(e) {
    e.preventDefault();
    try {
      await api.holidays.add({
        ...holidayForm,
        state: holidayForm.scope === 'STATE' ? holidayForm.state : null,
      });
      setShowAddHoliday(false);
      setHolidayForm(EMPTY_HOLIDAY);
      loadHolidaysData();
      loadSummary();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to add holiday');
    }
  }

  async function saveBulkHolidays(e) {
    e.preventDefault();
    try {
      const lines = bulkHolidayText.split('\n').map((l) => l.trim()).filter(Boolean);
      const items = [];
      for (const line of lines) {
        const parts = line.split(/[,\t]/).map((p) => p.trim());
        if (parts.length >= 2) {
          const [holiday_date, name, scope = 'NATIONAL', state = '', holiday_type = 'PUBLIC', remarks = ''] = parts;
          items.push({
            holiday_date,
            name,
            scope: scope.toUpperCase() === 'STATE' ? 'STATE' : 'NATIONAL',
            state: scope.toUpperCase() === 'STATE' ? (state || null) : null,
            holiday_type: ['PUBLIC', 'RESTRICTED', 'BANK', 'LOCAL'].includes(holiday_type.toUpperCase()) ? holiday_type.toUpperCase() : 'PUBLIC',
            remarks: remarks || null,
          });
        }
      }
      if (items.length === 0) {
        alert('No valid rows found. Format: YYYY-MM-DD, Holiday Name, NATIONAL/STATE, State, Type');
        return;
      }
      const res = await api.holidays.bulkAdd({ holidays: items });
      alert(`Bulk Import Complete: ${res.inserted || items.length} holiday(s) saved.`);
      setShowBulkHoliday(false);
      setBulkHolidayText('');
      loadHolidaysData();
      loadSummary();
    } catch (err) {
      alert(err.response?.data?.error || 'Bulk import failed');
    }
  }

  async function handleDeactivateHoliday(e) {
    e.preventDefault();
    if (!deactivateHolidayObj) return;
    try {
      await api.holidays.deactivate(deactivateHolidayObj.id, { reason: deactivateReason });
      setDeactivateHolidayObj(null);
      setDeactivateReason('');
      loadHolidaysData();
      loadSummary();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to deactivate holiday');
    }
  }

  async function handleReactivateHoliday(id) {
    try {
      await api.holidays.reactivate(id);
      loadHolidaysData();
      loadSummary();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to reactivate holiday');
    }
  }

  async function saveBank(e) {
    e.preventDefault();
    try {
      if (editBank) await api.masters.updateBank(editBank.id, bankForm);
      else await api.masters.createBank(bankForm);
      setShowBank(false);
      setEditBank(null);
      setBankForm(EMPTY_BANK);
      loadTab('banks');
      loadSummary();
    } catch (err) {
      alert(err.response?.data?.error || 'Save failed');
    }
  }

  async function saveBeta(e) {
    e.preventDefault();
    try {
      const body = {
        ...betaForm,
        beta_value: Number(betaForm.beta_value),
        certified_on: betaForm.certified_on || null,
        notes: betaForm.notes || null,
      };
      if (editBeta) await api.stationBeta.update(editBeta.id, body);
      else await api.stationBeta.create(body);
      setShowBeta(false);
      setEditBeta(null);
      setBetaForm(EMPTY_BETA);
      loadTab('beta');
      loadSummary();
    } catch (err) {
      alert(err.response?.data?.error || 'Save failed');
    }
  }

  async function trueUpBeta(row) {
    if (!window.confirm(`Generate supplementary incentive true-up for ${row.contract_no} / ${row.period_month}?`)) return;
    try {
      const res = await api.stationBeta.trueUp(row.id);
      if (res.delta === 0) alert(res.message || 'No true-up needed');
      else alert(`Created ${res.invoice?.invoice_no}: ₹${Number(res.delta).toLocaleString('en-IN')}`);
      loadTab('beta');
    } catch (err) {
      alert(err.response?.data?.error || 'True-up failed');
    }
  }

  async function deleteBeta(row) {
    if (!window.confirm(`Delete β for ${row.contract_no} / ${row.period_month}?`)) return;
    try {
      await api.stationBeta.remove(row.id);
      loadTab('beta');
      loadSummary();
    } catch (err) {
      alert(err.response?.data?.error || 'Delete failed');
    }
  }

  async function saveProject(e) {
    e.preventDefault();
    try {
      await api.entities.create({
        ...projectForm,
        capacity_mw: projectForm.capacity_mw ? Number(projectForm.capacity_mw) : null,
        contracted_capacity_mw: projectForm.capacity_mw ? Number(projectForm.capacity_mw) : null,
        parent_entity_id: projectForm.parent_entity_id || null,
        contacts: [{ contact_type: 'COMMERCIAL', name: 'Project Lead', email: 'project@example.com', phone: '9999999999', is_primary: true }],
      });
      setShowProject(false);
      setProjectForm(EMPTY_PROJECT);
      loadTab('projects');
      loadSummary();
    } catch (err) {
      alert(err.response?.data?.error || 'Create failed');
    }
  }

  async function saveParam(e) {
    e.preventDefault();
    try {
      await api.masters.updateParameter(editParam.param_key, {
        param_value: paramForm.param_value,
        unit: paramForm.unit,
        description: paramForm.description,
        is_active: paramForm.is_active ? 1 : 0,
      });
      setEditParam(null);
      loadTab(tab);
      loadSummary();
    } catch (err) {
      alert(err.response?.data?.error || 'Update failed');
    }
  }

  async function createParam(e) {
    e.preventDefault();
    try {
      await api.masters.createParameter({ ...newParamForm, category: tab === 'regulatory' ? 'REGULATORY' : 'BILLING' });
      setShowParam(false);
      setNewParamForm(EMPTY_PARAM);
      loadTab(tab);
      loadSummary();
    } catch (err) {
      alert(err.response?.data?.error || 'Create failed');
    }
  }

  async function toggleParam(p) {
    try {
      await api.masters.updateParameter(p.param_key, { param_value: p.param_value, is_active: p.is_active ? 0 : 1 });
      loadTab(tab);
      loadSummary();
    } catch (err) {
      alert(err.response?.data?.error || 'Update failed');
    }
  }

  async function toggleBank(b) {
    try {
      await api.masters.updateBank(b.id, { ...b, is_active: b.is_active ? 0 : 1 });
      loadTab('banks');
      loadSummary();
    } catch (err) {
      alert(err.response?.data?.error || 'Update failed');
    }
  }

  async function saveLookup(e) {
    e.preventDefault();
    try {
      if (lookupForm.id) {
        await api.masters.updateLookup(lookupForm.id, {
          label: lookupForm.label,
          sort_order: Number(lookupForm.sort_order) || 0,
          is_active: lookupForm.is_active ? 1 : 0,
        });
      } else {
        await api.masters.createLookup(lookupForm);
      }
      setShowLookup(false);
      setLookupForm(EMPTY_LOOKUP);
      loadTab('lookups');
      loadSummary();
    } catch (err) {
      alert(err.response?.data?.error || 'Save failed');
    }
  }

  async function toggleLookup(l) {
    try {
      await api.masters.updateLookup(l.id, { label: l.label, sort_order: l.sort_order, is_active: l.is_active ? 0 : 1 });
      loadTab('lookups');
      loadSummary();
    } catch (err) {
      alert(err.response?.data?.error || 'Update failed');
    }
  }

  async function saveDoc(e) {
    e.preventDefault();
    try {
      if (docForm.id) {
        await api.masters.updateDocumentType(docForm.id, {
          label: docForm.label,
          category: docForm.category,
          reason: docForm.reason,
          is_mandatory: docForm.is_mandatory ? 1 : 0,
          sort_order: Number(docForm.sort_order) || 0,
          is_active: docForm.is_active ? 1 : 0,
        });
      } else {
        await api.masters.createDocumentType(docForm);
      }
      setShowDoc(false);
      setDocForm(EMPTY_DOC);
      loadTab('documents');
      loadSummary();
    } catch (err) {
      alert(err.response?.data?.error || 'Save failed');
    }
  }

  async function toggleDoc(d) {
    try {
      await api.masters.updateDocumentType(d.id, {
        label: d.label, category: d.category, reason: d.reason,
        is_mandatory: d.is_mandatory ? 1 : 0, sort_order: d.sort_order, is_active: d.is_active ? 0 : 1,
      });
      loadTab('documents');
      loadSummary();
    } catch (err) {
      alert(err.response?.data?.error || 'Update failed');
    }
  }

  const filteredLookups = lookupFilter
    ? lookups.filter((l) => l.category === lookupFilter)
    : lookups;
  const filteredDocs = docModuleFilter
    ? docTypes.filter((d) => d.module_name === docModuleFilter)
    : docTypes;
  const lookupCategories = [...new Set(lookups.map((l) => l.category))];
  const docModules = [...new Set(docTypes.map((d) => d.module_name))];

  return (
    <div>
      <PageHeader
        title="Master Data"
        subtitle="Configurable masters — entities, contracts, projects, banks, regulatory & billing parameters"
      />

      {summary && (
        <div className="grid-4" style={{ marginBottom: 16, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10 }}>
          {[
            ['Entities', summary.entities],
            ['Contracts', summary.contracts],
            ['Projects', summary.projects],
            ['Banks', summary.banks],
            ['Freq. β', summary.station_beta],
            ['Regulatory', summary.regulatory_params],
            ['Billing', summary.billing_params],
            ['Doc Types', summary.document_types],
            ['Lookups', summary.lookups],
          ].map(([label, val]) => (
            <div key={label} style={{ background: 'var(--slate-50)', border: '1px solid var(--slate-200)', borderRadius: 8, padding: '10px 12px' }}>
              <div style={{ fontSize: 11, color: 'var(--slate-500)' }}>{label}</div>
              <div style={{ fontSize: 18, fontWeight: 700 }}>{val}</div>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={'btn btn-sm ' + (tab === t.id ? 'btn-primary' : 'btn-outline')}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && <div className="form-error" style={{ marginBottom: 12 }}>{error}</div>}

      {tab === 'entities' && (
        <Card title="Entity Master">
          <p style={{ fontSize: 13, color: 'var(--slate-500)', marginTop: 0 }}>
            Operational onboarding lives under Stakeholders. This master view lists all registered entities.
            {' '}<Link to="/reia/entities">Open Stakeholders →</Link>
          </p>
          <Table
            columns={[
              { key: 'name', header: 'Name' },
              { key: 'entity_type', header: 'Type', render: (r) => <Badge status={r.entity_type} /> },
              { key: 'category', header: 'Category' },
              { key: 'pan_no', header: 'PAN' },
              { key: 'gst_no', header: 'GST' },
              { key: 'status', header: 'Status', render: (r) => <Badge status={r.status} /> },
            ]}
            rows={entities}
            emptyMessage="No entities."
          />
        </Card>
      )}

      {tab === 'contracts' && (
        <Card title="Contract Master">
          <p style={{ fontSize: 13, color: 'var(--slate-500)', marginTop: 0 }}>
            PPA/PSA lifecycle is managed under Contracts.
            {' '}<Link to="/reia/contracts">Open Contracts →</Link>
          </p>
          <Table
            columns={[
              { key: 'contract_no', header: 'Contract No' },
              { key: 'contract_type', header: 'Type' },
              { key: 'project_type', header: 'Project' },
              { key: 'capacity_mw', header: 'MW', render: (r) => fmtNumber(r.capacity_mw) },
              { key: 'tariff_per_unit', header: 'Tariff', render: (r) => r.tariff_per_unit != null ? `₹${r.tariff_per_unit}` : '-' },
              { key: 'status', header: 'Status', render: (r) => <Badge status={r.status} /> },
            ]}
            rows={contracts}
            emptyMessage="No contracts."
          />
        </Card>
      )}

      {tab === 'projects' && (
        <Card
          title="Project Master (SPVs)"
          actions={canWrite && (
            <button className="btn btn-primary btn-sm" onClick={() => { setProjectForm(EMPTY_PROJECT); setShowProject(true); }}>+ Add Project</button>
          )}
        >
          <p style={{ fontSize: 13, color: 'var(--slate-500)', marginTop: 0 }}>
            Projects are child entities (SPVs) under a parent group, with capacity and technology.
          </p>
          <Table
            columns={[
              { key: 'name', header: 'Project' },
              { key: 'parent_name', header: 'Parent' },
              { key: 'technology', header: 'Technology' },
              { key: 'capacity_mw', header: 'Capacity MW', render: (r) => fmtNumber(r.capacity_mw) },
              { key: 'status', header: 'Status', render: (r) => <Badge status={r.status} /> },
            ]}
            rows={projects}
            emptyMessage="No SPV/projects yet. Add a child under a parent entity."
          />
        </Card>
      )}

      {tab === 'banks' && (
        <Card
          title="Bank Master"
          actions={canWrite && (
            <button className="btn btn-primary btn-sm" onClick={() => { setEditBank(null); setBankForm(EMPTY_BANK); setShowBank(true); }}>+ Add Bank</button>
          )}
        >
          <Table
            columns={[
              { key: 'bank_name', header: 'Bank' },
              { key: 'ifsc_prefix', header: 'IFSC Prefix' },
              { key: 'branch_name', header: 'Branch' },
              { key: 'city', header: 'City' },
              { key: 'swift_code', header: 'SWIFT' },
              { key: 'is_active', header: 'Active', render: (r) => r.is_active ? <Badge status="ACTIVE" /> : <Badge status="DRAFT" label="Inactive" /> },
              ...(canWrite ? [{
                key: 'actions', header: '', render: (r) => (
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button className="btn btn-outline btn-sm" onClick={() => { setEditBank(r); setBankForm(r); setShowBank(true); }}>Edit</button>
                    <button className={'btn btn-sm ' + (r.is_active ? 'btn-danger' : 'btn-success')} onClick={() => toggleBank(r)}>
                      {r.is_active ? 'Deactivate' : 'Activate'}
                    </button>
                  </div>
                ),
              }] : []),
            ]}
            rows={banks}
            emptyMessage="No banks in master."
          />
        </Card>
      )}

      {tab === 'beta' && (
        <Card
          title="Frequency Response β (CERC)"
          actions={canWrite && (
            <button className="btn btn-primary btn-sm" onClick={() => { setEditBeta(null); setBetaForm(EMPTY_BETA); setShowBeta(true); }}>+ Enter Certified β</button>
          )}
        >
          <p style={{ fontSize: 13, color: 'var(--slate-500)', marginTop: 0 }}>
            Store NRPC-certified Average Monthly Frequency Response Performance (β, 0–1).
            Hydro/PSP incentive = (3% × β × AFC)/12 when β &gt; 0.30. Provisional bills stay unblocked; use True-up when β arrives late.
          </p>
          <Table
            columns={[
              { key: 'period_month', header: 'Period' },
              { key: 'station_code', header: 'Station', render: (r) => r.station_code || r.station_name || '—' },
              { key: 'contract_no', header: 'Contract' },
              { key: 'beta_value', header: 'β', render: (r) => Number(r.beta_value).toFixed(2) },
              { key: 'source', header: 'Source' },
              { key: 'certified_on', header: 'Certified' },
              { key: 'computed_incentive', header: 'Incentive', render: (r) => r.computed_incentive != null ? fmtCurrency(r.computed_incentive) : '—' },
              { key: 'incentive_eligible', header: 'Eligible', render: (r) => r.incentive_eligible ? <Badge status="ACTIVE" label="Yes" /> : <Badge status="DRAFT" label="No" /> },
              ...(canWrite ? [{
                key: 'actions', header: '', render: (r) => (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <button className="btn btn-outline btn-sm" onClick={() => {
                      setEditBeta(r);
                      setBetaForm({
                        contract_id: r.contract_id,
                        period_month: r.period_month,
                        beta_value: String(r.beta_value),
                        station_code: r.station_code || '',
                        station_name: r.station_name || '',
                        source: r.source || 'NRPC',
                        certified_on: r.certified_on || '',
                        notes: r.notes || '',
                      });
                      setShowBeta(true);
                    }}>Edit</button>
                    <button className="btn btn-primary btn-sm" onClick={() => trueUpBeta(r)}>True-up</button>
                    <button className="btn btn-danger btn-sm" onClick={() => deleteBeta(r)}>Delete</button>
                  </div>
                ),
              }] : []),
            ]}
            rows={betas}
            emptyMessage="No certified β records yet. Enter values from NRPC certificates (e.g. NJHPS May 2026 = 1.00)."
          />
        </Card>
      )}

      {(tab === 'regulatory' || tab === 'billing' || tab === 'trading') && (
        <Card
          title={tab === 'regulatory' ? 'Regulatory Parameter Master' : 'Billing Parameter Master'}
          actions={canWrite && (
            <button className="btn btn-primary btn-sm" onClick={() => { setNewParamForm(EMPTY_PARAM); setShowParam(true); }}>+ Add Parameter</button>
          )}
        >
          <p style={{ fontSize: 13, color: 'var(--slate-500)', marginTop: 0 }}>
            These values drive energy validation and invoice generation. Changes apply immediately to new calculations.
          </p>
          <Table
            columns={[
              { key: 'param_key', header: 'Key', render: (r) => <code style={{ fontSize: 12 }}>{r.param_key}</code> },
              { key: 'param_value', header: 'Value', render: (r) => <strong>{r.param_value}</strong> },
              { key: 'unit', header: 'Unit' },
              { key: 'description', header: 'Description' },
              { key: 'is_active', header: 'Active', render: (r) => r.is_active ? <Badge status="ACTIVE" /> : <Badge status="DRAFT" label="Inactive" /> },
              ...(canWrite ? [{
                key: 'actions', header: '', render: (r) => (
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button className="btn btn-outline btn-sm" onClick={() => { setEditParam(r); setParamForm({ param_value: r.param_value, unit: r.unit || '', description: r.description || '', is_active: r.is_active }); }}>Edit</button>
                    <button className={'btn btn-sm ' + (r.is_active ? 'btn-danger' : 'btn-success')} onClick={() => toggleParam(r)}>
                      {r.is_active ? 'Disable' : 'Enable'}
                    </button>
                  </div>
                ),
              }] : []),
            ]}
            rows={params}
            emptyMessage="No parameters seeded."
          />
        </Card>
      )}

      {tab === 'documents' && (
        <Card
          title="Document Type Master"
          actions={canWrite && (
            <button className="btn btn-primary btn-sm" onClick={() => { setDocForm(EMPTY_DOC); setShowDoc(true); }}>+ Add Type</button>
          )}
        >
          <div style={{ marginBottom: 12 }}>
            <select value={docModuleFilter} onChange={(e) => setDocModuleFilter(e.target.value)}>
              <option value="">All modules</option>
              {docModules.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <Table
            columns={[
              { key: 'module_name', header: 'Module' },
              { key: 'code', header: 'Code' },
              { key: 'label', header: 'Label' },
              { key: 'category', header: 'Category', render: (r) => <Badge status={r.category === 'VERIFY' ? 'PENDING' : 'DRAFT'} label={r.category} /> },
              { key: 'is_mandatory', header: 'Mandatory', render: (r) => r.is_mandatory ? 'Yes' : 'No' },
              { key: 'is_active', header: 'Active', render: (r) => r.is_active ? <Badge status="ACTIVE" /> : <Badge status="DRAFT" label="Inactive" /> },
              ...(canWrite ? [{
                key: 'actions', header: '', render: (r) => (
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button className="btn btn-outline btn-sm" onClick={() => { setDocForm({ id: r.id, module_name: r.module_name, code: r.code, label: r.label, category: r.category, reason: r.reason || '', is_mandatory: !!r.is_mandatory, sort_order: r.sort_order || 0, is_active: r.is_active }); setShowDoc(true); }}>Edit</button>
                    <button className={'btn btn-sm ' + (r.is_active ? 'btn-danger' : 'btn-success')} onClick={() => toggleDoc(r)}>
                      {r.is_active ? 'Disable' : 'Enable'}
                    </button>
                  </div>
                ),
              }] : []),
            ]}
            rows={filteredDocs}
            emptyMessage="No document types."
          />
        </Card>
      )}

      {tab === 'lookups' && (
        <Card
          title="Lookup Master"
          actions={canWrite && (
            <button className="btn btn-primary btn-sm" onClick={() => { setLookupForm(EMPTY_LOOKUP); setShowLookup(true); }}>+ Add Lookup</button>
          )}
        >
          <div style={{ marginBottom: 12 }}>
            <select value={lookupFilter} onChange={(e) => setLookupFilter(e.target.value)}>
              <option value="">All categories</option>
              {lookupCategories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <Table
            columns={[
              { key: 'category', header: 'Category' },
              { key: 'code', header: 'Code' },
              { key: 'label', header: 'Label' },
              { key: 'sort_order', header: 'Order' },
              { key: 'is_active', header: 'Active', render: (r) => r.is_active ? <Badge status="ACTIVE" /> : <Badge status="DRAFT" label="Inactive" /> },
              ...(canWrite ? [{
                key: 'actions', header: '', render: (r) => (
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button className="btn btn-outline btn-sm" onClick={() => { setLookupForm({ id: r.id, category: r.category, code: r.code, label: r.label, sort_order: r.sort_order || 0, is_active: r.is_active }); setShowLookup(true); }}>Edit</button>
                    <button className={'btn btn-sm ' + (r.is_active ? 'btn-danger' : 'btn-success')} onClick={() => toggleLookup(r)}>
                      {r.is_active ? 'Disable' : 'Enable'}
                    </button>
                  </div>
                ),
              }] : []),
            ]}
            rows={filteredLookups}
            emptyMessage="No lookups."
          />
        </Card>
      )}

      {tab === 'holidays' && (
        <Card
          title="Holiday & Working-Day Calendar Master"
          actions={canWrite && (
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-outline btn-sm" onClick={() => setShowBulkHoliday(true)}>Bulk Import</button>
              <button className="btn btn-primary btn-sm" onClick={() => { setHolidayForm(EMPTY_HOLIDAY); setShowAddHoliday(true); }}>+ Add Holiday</button>
            </div>
          )}
        >
          <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: 16, marginBottom: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12, marginBottom: 14 }}>
              <div>
                <h4 style={{ margin: '0 0 4px 0', fontSize: 14, color: '#1e293b', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span></span> Live Due-Date & Working-Days Simulator
                </h4>
                <p style={{ margin: 0, fontSize: 12, color: '#64748b' }}>
                  Verify how state-specific public holidays and weekly offs affect payment deadlines & late-payment surcharge (LPS).
                </p>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <span className="badge" style={{ background: '#e0f2fe', color: '#0369a1', fontSize: 11 }}>
                  Weekly Offs: {holidaySettings?.weekly_off_names?.join(', ') || 'Saturday, Sunday'}
                </span>
                <span className="badge" style={{ background: '#fef3c7', color: '#92400e', fontSize: 11 }}>
                  Counting Mode: {holidaySettings?.due_date_counting_mode || 'CALENDAR_ROLL_FORWARD'}
                </span>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, alignItems: 'end' }}>
              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#475569', marginBottom: 4 }}>Bill Presentation Date</label>
                <input
                  type="date"
                  className="input"
                  value={simBillDate}
                  onChange={(e) => setSimBillDate(e.target.value)}
                  style={{ width: '100%', fontSize: 13 }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#475569', marginBottom: 4 }}>Credit Terms (Days)</label>
                <input
                  type="number"
                  min="1"
                  max="120"
                  className="input"
                  value={simTermsDays}
                  onChange={(e) => setSimTermsDays(Number(e.target.value))}
                  style={{ width: '100%', fontSize: 13 }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#475569', marginBottom: 4 }}>Beneficiary / Buyer State</label>
                <select
                  className="input"
                  value={simState}
                  onChange={(e) => setSimState(e.target.value)}
                  style={{ width: '100%', fontSize: 13 }}
                >
                  <option value="">National Only (No State Override)</option>
                  {holidayStates.map((st) => <option key={st} value={st}>{st}</option>)}
                </select>
              </div>
            </div>

            {simResult && (
              <div style={{ marginTop: 14 }}>
                <div style={{ padding: 14, background: '#ffffff', borderRadius: 8, border: '1px solid #cbd5e1', display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center' }}>
                  <div>
                    <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', fontWeight: 700, letterSpacing: 0.5 }}>Calculated Due Date (Target)</div>
                    <div style={{ fontSize: 20, fontWeight: 800, color: '#0f172a' }}>
                      {simResult.due_date} <span style={{ fontSize: 13, fontWeight: 600, color: '#0284c7' }}>({formatDayName(simResult.due_date)})</span>
                    </div>
                  </div>
                  <div style={{ borderLeft: '1px solid #e2e8f0', paddingLeft: 16 }}>
                    <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600 }}>Working Days Target</div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: '#16a34a' }}>
                      {simResult.terms_days} Working Days
                    </div>
                  </div>
                  <div style={{ borderLeft: '1px solid #e2e8f0', paddingLeft: 16 }}>
                    <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600 }}>Total Calendar Days Span</div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: '#334155' }}>
                      {simResult.calendar_days_taken} Calendar Days
                    </div>
                  </div>
                  <div style={{ borderLeft: '1px solid #e2e8f0', paddingLeft: 16 }}>
                    <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600 }}>Non-Working Days Skipped</div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: '#dc2626' }}>
                      {(simResult.calendar_days_taken || 0) - (simResult.terms_days || 0)} Days (Weekends + Holidays)
                    </div>
                  </div>
                  <div style={{ borderLeft: '1px solid #e2e8f0', paddingLeft: 16, flex: 1, minWidth: 200 }}>
                    <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600 }}>LPS Protection</div>
                    <div style={{ fontSize: 12, color: '#334155' }}>
                      Weekends & {simState ? `${simState} gazetted holidays` : 'gazetted holidays'} skipped from counting. Surcharge starts strictly after due date.
                    </div>
                  </div>
                </div>

                {/* Day by Day Step Breakdown */}
                {Array.isArray(simResult.daily_breakdown) && simResult.daily_breakdown.length > 0 && (
                  <div style={{ marginTop: 12, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: 12 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#334155', marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span>Step-by-Step Counting Progression ({simResult.daily_breakdown.length} days total):</span>
                      <span style={{ fontSize: 11, fontWeight: 'normal', color: '#64748b' }}>
                        Working Day | Day 0 | Skipped (Sat/Sun/Holiday)
                      </span>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxHeight: 180, overflowY: 'auto', padding: 4 }}>
                      {simResult.daily_breakdown.map((b) => {
                        let bg = '#e2e8f0';
                        let color = '#334155';
                        let border = '1px solid #cbd5e1';
                        if (b.status === 'DAY_0') {
                          bg = '#f1f5f9';
                          color = '#475569';
                          border = '1px solid #94a3b8';
                        } else if (b.status === 'DUE_DATE') {
                          bg = '#16a34a';
                          color = '#ffffff';
                          border = '1px solid #15803d';
                        } else if (b.status === 'COUNTED') {
                          bg = '#dcfce7';
                          color = '#15803d';
                          border = '1px solid #86efac';
                        } else if (b.status === 'SKIPPED') {
                          bg = '#fee2e2';
                          color = '#b91c1c';
                          border = '1px solid #fca5a5';
                        }
                        return (
                          <div
                            key={b.date}
                            title={`${b.date} (${b.day_name}): ${b.label}`}
                            style={{
                              padding: '4px 8px',
                              borderRadius: 6,
                              fontSize: 11,
                              background: bg,
                              color: color,
                              border: border,
                              fontWeight: b.status === 'DUE_DATE' ? 700 : 500,
                              display: 'flex',
                              flexDirection: 'column',
                              alignItems: 'center',
                              minWidth: 72,
                            }}
                          >
                            <span style={{ fontSize: 10, opacity: 0.85 }}>{b.date.slice(5)} ({b.day_name})</span>
                            <span style={{ fontSize: 11, fontWeight: 700 }}>
                              {b.status === 'DAY_0' ? 'Day 0' : b.status === 'SKIPPED' ? ' Skip' : `Day ${b.day_number}`}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', marginBottom: 16, background: '#f1f5f9', padding: '10px 14px', borderRadius: 6 }}>
            <div>
              <span style={{ fontSize: 12, fontWeight: 700, marginRight: 6 }}>Year:</span>
              <select value={holidayYear} onChange={(e) => setHolidayYear(e.target.value)} style={{ fontSize: 12, padding: '4px 8px' }}>
                <option value="">All Years</option>
                <option value="2025">2025</option>
                <option value="2026">2026</option>
                <option value="2027">2027</option>
              </select>
            </div>
            <div>
              <span style={{ fontSize: 12, fontWeight: 700, marginRight: 6 }}>Scope:</span>
              <select value={holidayScopeFilter} onChange={(e) => setHolidayScopeFilter(e.target.value)} style={{ fontSize: 12, padding: '4px 8px' }}>
                <option value="">All Scopes</option>
                <option value="NATIONAL">NATIONAL</option>
                <option value="STATE">STATE</option>
              </select>
            </div>
            <div>
              <span style={{ fontSize: 12, fontWeight: 700, marginRight: 6 }}>State:</span>
              <select value={holidayStateFilter} onChange={(e) => setHolidayStateFilter(e.target.value)} style={{ fontSize: 12, padding: '4px 8px' }}>
                <option value="">All States</option>
                {holidayStates.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', marginLeft: 'auto' }}>
              <input type="checkbox" checked={includeInactiveHolidays} onChange={(e) => setIncludeInactiveHolidays(e.target.checked)} />
              Include Withdrawn / Inactive
            </label>
          </div>

          <Table
            columns={[
              { key: 'holiday_date', header: 'Date', render: (r) => <strong style={{ fontSize: 13 }}>{r.holiday_date}</strong> },
              { key: 'day', header: 'Day', render: (r) => <span style={{ color: '#64748b', fontSize: 12 }}>{formatDayName(r.holiday_date)}</span> },
              { key: 'name', header: 'Holiday Name', render: (r) => <span style={{ fontWeight: 600 }}>{r.name}</span> },
              { key: 'scope', header: 'Scope', render: (r) => <Badge status={r.scope === 'NATIONAL' ? 'ACTIVE' : 'PENDING'} label={r.scope} /> },
              { key: 'state', header: 'State / Region', render: (r) => r.state ? <span style={{ color: '#0284c7', fontWeight: 600 }}>{r.state}</span> : <span style={{ color: '#64748b' }}>All India (National)</span> },
              { key: 'holiday_type', header: 'Type', render: (r) => <Badge status="DRAFT" label={r.holiday_type} /> },
              { key: 'remarks', header: 'Remarks / Gazette Ref', render: (r) => r.remarks || '—' },
              { key: 'is_active', header: 'Status', render: (r) => r.is_active ? <Badge status="ACTIVE" label="Active" /> : <Badge status="REJECTED" label="Withdrawn" /> },
              ...(canWrite ? [{
                key: 'actions', header: '', render: (r) => (
                  <div>
                    {r.is_active ? (
                      <button className="btn btn-sm btn-danger" style={{ fontSize: 11, padding: '2px 8px' }} onClick={() => { setDeactivateHolidayObj(r); setDeactivateReason(''); }}>
                        Withdraw
                      </button>
                    ) : (
                      <button className="btn btn-sm btn-success" style={{ fontSize: 11, padding: '2px 8px' }} onClick={() => handleReactivateHoliday(r.id)}>
                        Reactivate
                      </button>
                    )}
                  </div>
                ),
              }] : []),
            ]}
            rows={holidays}
            emptyMessage="No holidays configured for the selected criteria."
          />
        </Card>
      )}

      {/* Modals */}
      <Modal open={showAddHoliday} onClose={() => setShowAddHoliday(false)} title="Add Holiday">
        <form onSubmit={saveHoliday}>
          <div className="form-grid">
            <Field label="Holiday Date">
              <input required type="date" value={holidayForm.holiday_date} onChange={(e) => setHolidayForm({ ...holidayForm, holiday_date: e.target.value })} />
            </Field>
            <Field label="Scope">
              <select value={holidayForm.scope} onChange={(e) => setHolidayForm({ ...holidayForm, scope: e.target.value })}>
                <option value="NATIONAL">NATIONAL (Applies to all entities)</option>
                <option value="STATE">STATE (Applies to specific state)</option>
              </select>
            </Field>
          </div>

          <Field label="Holiday Name">
            <input required placeholder="e.g. Statehood Day / Baisakhi / Diwali" value={holidayForm.name} onChange={(e) => setHolidayForm({ ...holidayForm, name: e.target.value })} />
          </Field>

          <div className="form-grid">
            {holidayForm.scope === 'STATE' ? (
              <Field label="State Name">
                <input required placeholder="e.g. Himachal Pradesh / Punjab / Haryana" value={holidayForm.state} onChange={(e) => setHolidayForm({ ...holidayForm, state: e.target.value })} />
              </Field>
            ) : (
              <Field label="Scope Note">
                <input disabled value="All India (Central Gazetted)" />
              </Field>
            )}
            <Field label="Holiday Type">
              <select value={holidayForm.holiday_type} onChange={(e) => setHolidayForm({ ...holidayForm, holiday_type: e.target.value })}>
                <option value="PUBLIC">PUBLIC (Gazetted public holiday)</option>
                <option value="BANK">BANK (Negotiable Instruments Act)</option>
                <option value="RESTRICTED">RESTRICTED (Optional holiday)</option>
                <option value="LOCAL">LOCAL (Regional / SLDC office closed)</option>
              </select>
            </Field>
          </div>

          <Field label="Remarks / Circular Ref">
            <input placeholder="e.g. HP Govt Gazetted Circular No. 2026/04" value={holidayForm.remarks} onChange={(e) => setHolidayForm({ ...holidayForm, remarks: e.target.value })} />
          </Field>

          <div className="form-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setShowAddHoliday(false)}>Cancel</button>
            <button type="submit" className="btn btn-primary">Save Holiday</button>
          </div>
        </form>
      </Modal>

      <Modal open={showBulkHoliday} onClose={() => setShowBulkHoliday(false)} title="Bulk Import Holidays">
        <form onSubmit={saveBulkHolidays}>
          <p style={{ fontSize: 12, color: '#64748b', marginTop: 0 }}>
            Paste comma-separated or tab-separated holiday entries (one per line):<br />
            <code>YYYY-MM-DD, Holiday Name, Scope (NATIONAL/STATE), State (optional), Type (PUBLIC/BANK)</code>
          </p>
          <Field label="Holiday Entries">
            <textarea
              required
              rows={8}
              className="input"
              style={{ width: '100%', fontFamily: 'monospace', fontSize: 12 }}
              placeholder={"2026-01-26, Republic Day, NATIONAL, , PUBLIC\n2026-04-15, Himachal Day, STATE, Himachal Pradesh, PUBLIC\n2026-04-13, Baisakhi, STATE, Punjab, PUBLIC"}
              value={bulkHolidayText}
              onChange={(e) => setBulkHolidayText(e.target.value)}
            />
          </Field>
          <div className="form-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setShowBulkHoliday(false)}>Cancel</button>
            <button type="submit" className="btn btn-primary">Import Holidays</button>
          </div>
        </form>
      </Modal>

      <Modal open={!!deactivateHolidayObj} onClose={() => setDeactivateHolidayObj(null)} title="Withdraw Holiday">
        {deactivateHolidayObj && (
          <form onSubmit={handleDeactivateHoliday}>
            <p style={{ fontSize: 13, color: '#334155', marginTop: 0 }}>
              Are you sure you want to withdraw <strong>{deactivateHolidayObj.name}</strong> on <strong>{deactivateHolidayObj.holiday_date}</strong>?
            </p>
            <Field label="Reason / Justification for withdrawal">
              <input required placeholder="e.g. State govt cancelled gazetted off" value={deactivateReason} onChange={(e) => setDeactivateReason(e.target.value)} />
            </Field>
            <div className="form-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setDeactivateHolidayObj(null)}>Cancel</button>
              <button type="submit" className="btn btn-danger">Confirm Withdrawal</button>
            </div>
          </form>
        )}
      </Modal>
      <Modal open={showBank} onClose={() => setShowBank(false)} title={editBank ? 'Edit Bank' : 'Add Bank'}>
        <form onSubmit={saveBank}>
          <Field label="Bank Name"><input required value={bankForm.bank_name} onChange={(e) => setBankForm({ ...bankForm, bank_name: e.target.value })} /></Field>
          <div className="form-grid">
            <Field label="IFSC Prefix"><input value={bankForm.ifsc_prefix || ''} onChange={(e) => setBankForm({ ...bankForm, ifsc_prefix: e.target.value })} /></Field>
            <Field label="SWIFT"><input value={bankForm.swift_code || ''} onChange={(e) => setBankForm({ ...bankForm, swift_code: e.target.value })} /></Field>
            <Field label="Branch"><input value={bankForm.branch_name || ''} onChange={(e) => setBankForm({ ...bankForm, branch_name: e.target.value })} /></Field>
            <Field label="City"><input value={bankForm.city || ''} onChange={(e) => setBankForm({ ...bankForm, city: e.target.value })} /></Field>
          </div>
          <div className="form-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setShowBank(false)}>Cancel</button>
            <button type="submit" className="btn btn-primary">Save</button>
          </div>
        </form>
      </Modal>

      <Modal open={showBeta} onClose={() => setShowBeta(false)} title={editBeta ? 'Edit Certified β' : 'Enter Certified β'}>
        <form onSubmit={saveBeta}>
          <Field label="Contract (Hydro/PSP PPA preferred)">
            <select
              required
              disabled={!!editBeta}
              value={betaForm.contract_id}
              onChange={(e) => setBetaForm({ ...betaForm, contract_id: e.target.value })}
            >
              <option value="">Select contract...</option>
              {contracts
                .filter((c) => ['Hydro', 'PSP'].includes(c.project_type) || c.contract_type === 'PPA')
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.contract_no} · {c.project_type} · {c.contract_type}
                  </option>
                ))}
            </select>
          </Field>
          <div className="form-grid">
            <Field label="Billing Period (YYYY-MM)">
              <input
                required
                pattern="\d{4}-\d{2}"
                placeholder="2026-05"
                disabled={!!editBeta}
                value={betaForm.period_month}
                onChange={(e) => setBetaForm({ ...betaForm, period_month: e.target.value })}
              />
            </Field>
            <Field label="β Value (0–1)">
              <input
                required
                type="number"
                step="0.01"
                min="0"
                max="1"
                value={betaForm.beta_value}
                onChange={(e) => setBetaForm({ ...betaForm, beta_value: e.target.value })}
              />
            </Field>
            <Field label="Station Code">
              <input placeholder="NJHPS" value={betaForm.station_code} onChange={(e) => setBetaForm({ ...betaForm, station_code: e.target.value })} />
            </Field>
            <Field label="Station Name">
              <input placeholder="NATHPA JHAKRI" value={betaForm.station_name} onChange={(e) => setBetaForm({ ...betaForm, station_name: e.target.value })} />
            </Field>
            <Field label="Source">
              <select value={betaForm.source} onChange={(e) => setBetaForm({ ...betaForm, source: e.target.value })}>
                <option value="NRPC">NRPC</option>
                <option value="NRLDC">NRLDC</option>
                <option value="SLDC">SLDC</option>
                <option value="MANUAL">MANUAL</option>
              </select>
            </Field>
            <Field label="Certified On">
              <input type="date" value={betaForm.certified_on} onChange={(e) => setBetaForm({ ...betaForm, certified_on: e.target.value })} />
            </Field>
          </div>
          <Field label="Notes">
            <input value={betaForm.notes} onChange={(e) => setBetaForm({ ...betaForm, notes: e.target.value })} placeholder="e.g. NRPC letter dated 19.06.2026" />
          </Field>
          <div className="form-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setShowBeta(false)}>Cancel</button>
            <button type="submit" className="btn btn-primary">Save</button>
          </div>
        </form>
      </Modal>

      <Modal open={showProject} onClose={() => setShowProject(false)} title="Add Project (SPV)">
        <form onSubmit={saveProject}>
          <Field label="Parent Entity">
            <select required value={projectForm.parent_entity_id} onChange={(e) => setProjectForm({ ...projectForm, parent_entity_id: e.target.value })}>
              <option value="">Select parent...</option>
              {parents.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
          <Field label="Project Name"><input required value={projectForm.name} onChange={(e) => setProjectForm({ ...projectForm, name: e.target.value })} /></Field>
          <div className="form-grid">
            <Field label="Technology"><input value={projectForm.technology} onChange={(e) => setProjectForm({ ...projectForm, technology: e.target.value })} /></Field>
            <Field label="Capacity (MW)"><input type="number" step="0.01" value={projectForm.capacity_mw} onChange={(e) => setProjectForm({ ...projectForm, capacity_mw: e.target.value })} /></Field>
          </div>
          <div className="form-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setShowProject(false)}>Cancel</button>
            <button type="submit" className="btn btn-primary">Create</button>
          </div>
        </form>
      </Modal>

      <Modal open={!!editParam} onClose={() => setEditParam(null)} title={`Edit: ${editParam?.param_key || ''}`}>
        {editParam && (
          <form onSubmit={saveParam}>
            <p style={{ fontSize: 12, color: 'var(--slate-500)', marginTop: 0 }}>
              <code>{editParam.param_key}</code> · {editParam.category} · {editParam.data_type}
            </p>
            <Field label={`Value (${editParam.unit || editParam.data_type})`}>
              <input required value={paramForm.param_value} onChange={(e) => setParamForm({ ...paramForm, param_value: e.target.value })} />
            </Field>
            <div className="form-grid">
              <Field label="Unit"><input value={paramForm.unit} onChange={(e) => setParamForm({ ...paramForm, unit: e.target.value })} /></Field>
              <Field label="Active">
                <select value={paramForm.is_active ? '1' : '0'} onChange={(e) => setParamForm({ ...paramForm, is_active: e.target.value === '1' ? 1 : 0 })}>
                  <option value="1">Active</option>
                  <option value="0">Inactive</option>
                </select>
              </Field>
            </div>
            <Field label="Description"><input value={paramForm.description} onChange={(e) => setParamForm({ ...paramForm, description: e.target.value })} /></Field>
            <div className="form-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setEditParam(null)}>Cancel</button>
              <button type="submit" className="btn btn-primary">Update</button>
            </div>
          </form>
        )}
      </Modal>

      <Modal open={showParam} onClose={() => setShowParam(false)} title={`Add ${tab === 'regulatory' ? 'Regulatory' : 'Billing'} Parameter`}>
        <form onSubmit={createParam}>
          <Field label="Parameter Key (unique, snake_case)">
            <input required placeholder="e.g. wheeling_charge_per_mwh" value={newParamForm.param_key} onChange={(e) => setNewParamForm({ ...newParamForm, param_key: e.target.value })} />
          </Field>
          <div className="form-grid">
            <Field label="Value"><input required value={newParamForm.param_value} onChange={(e) => setNewParamForm({ ...newParamForm, param_value: e.target.value })} /></Field>
            <Field label="Data Type">
              <select value={newParamForm.data_type} onChange={(e) => setNewParamForm({ ...newParamForm, data_type: e.target.value })}>
                <option value="NUMBER">Number</option>
                <option value="PERCENT">Percent</option>
                <option value="TEXT">Text</option>
                <option value="JSON">JSON</option>
              </select>
            </Field>
            <Field label="Unit"><input placeholder="INR/MWh, %, days" value={newParamForm.unit} onChange={(e) => setNewParamForm({ ...newParamForm, unit: e.target.value })} /></Field>
          </div>
          <Field label="Description"><input value={newParamForm.description} onChange={(e) => setNewParamForm({ ...newParamForm, description: e.target.value })} /></Field>
          <p className="inline-note">Category: <strong>{tab === 'regulatory' ? 'REGULATORY' : 'BILLING'}</strong> (set by the active tab).</p>
          <div className="form-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setShowParam(false)}>Cancel</button>
            <button type="submit" className="btn btn-primary">Create</button>
          </div>
        </form>
      </Modal>

      <Modal open={showLookup} onClose={() => { setShowLookup(false); setLookupForm(EMPTY_LOOKUP); }} title={lookupForm.id ? 'Edit Lookup' : 'Add Lookup'}>
        <form onSubmit={saveLookup}>
          <Field label="Category">
            <input required disabled={!!lookupForm.id} value={lookupForm.category} onChange={(e) => setLookupForm({ ...lookupForm, category: e.target.value })} placeholder="PROJECT_TYPE" />
          </Field>
          <Field label="Code"><input required disabled={!!lookupForm.id} value={lookupForm.code} onChange={(e) => setLookupForm({ ...lookupForm, code: e.target.value })} /></Field>
          <Field label="Label"><input required value={lookupForm.label} onChange={(e) => setLookupForm({ ...lookupForm, label: e.target.value })} /></Field>
          <div className="form-grid">
            <Field label="Sort Order"><input type="number" value={lookupForm.sort_order} onChange={(e) => setLookupForm({ ...lookupForm, sort_order: e.target.value })} /></Field>
            {lookupForm.id != null && (
              <Field label="Active">
                <select value={lookupForm.is_active ? '1' : '0'} onChange={(e) => setLookupForm({ ...lookupForm, is_active: e.target.value === '1' ? 1 : 0 })}>
                  <option value="1">Active</option>
                  <option value="0">Inactive</option>
                </select>
              </Field>
            )}
          </div>
          {lookupForm.id && <p className="inline-note">Category & code are identifiers and can't be changed after creation.</p>}
          <div className="form-actions">
            <button type="button" className="btn btn-ghost" onClick={() => { setShowLookup(false); setLookupForm(EMPTY_LOOKUP); }}>Cancel</button>
            <button type="submit" className="btn btn-primary">{lookupForm.id ? 'Update' : 'Create'}</button>
          </div>
        </form>
      </Modal>

      <Modal open={showDoc} onClose={() => { setShowDoc(false); setDocForm(EMPTY_DOC); }} title={docForm.id ? 'Edit Document Type' : 'Add Document Type'}>
        <form onSubmit={saveDoc}>
          <div className="form-grid">
            <Field label="Module"><input required disabled={!!docForm.id} value={docForm.module_name} onChange={(e) => setDocForm({ ...docForm, module_name: e.target.value })} /></Field>
            <Field label="Code"><input required disabled={!!docForm.id} value={docForm.code} onChange={(e) => setDocForm({ ...docForm, code: e.target.value })} /></Field>
          </div>
          <Field label="Label"><input required value={docForm.label} onChange={(e) => setDocForm({ ...docForm, label: e.target.value })} /></Field>
          <div className="form-grid">
            <Field label="Category">
              <select value={docForm.category} onChange={(e) => setDocForm({ ...docForm, category: e.target.value })}>
                <option value="VERIFY">VERIFY (needs approval)</option>
                <option value="RECORD">RECORD (no approval)</option>
              </select>
            </Field>
            <Field label="Sort Order"><input type="number" value={docForm.sort_order} onChange={(e) => setDocForm({ ...docForm, sort_order: e.target.value })} /></Field>
          </div>
          <Field label="Reason / Why needed"><input value={docForm.reason} onChange={(e) => setDocForm({ ...docForm, reason: e.target.value })} /></Field>
          <div className="form-grid">
            <Field label="Mandatory">
              <select value={docForm.is_mandatory ? '1' : '0'} onChange={(e) => setDocForm({ ...docForm, is_mandatory: e.target.value === '1' })}>
                <option value="0">Optional</option>
                <option value="1">Mandatory</option>
              </select>
            </Field>
            {docForm.id != null && (
              <Field label="Active">
                <select value={docForm.is_active ? '1' : '0'} onChange={(e) => setDocForm({ ...docForm, is_active: e.target.value === '1' ? 1 : 0 })}>
                  <option value="1">Active</option>
                  <option value="0">Inactive</option>
                </select>
              </Field>
            )}
          </div>
          {docForm.id && <p className="inline-note">Module & code are identifiers and can't be changed after creation.</p>}
          <div className="form-actions">
            <button type="button" className="btn btn-ghost" onClick={() => { setShowDoc(false); setDocForm(EMPTY_DOC); }}>Cancel</button>
            <button type="submit" className="btn btn-primary">{docForm.id ? 'Update' : 'Create'}</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
