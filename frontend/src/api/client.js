import axios from 'axios';

const client = axios.create({ baseURL: '/api' });

client.interceptors.request.use((config) => {
  const token = localStorage.getItem('sjvn_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

client.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('sjvn_token');
      localStorage.removeItem('sjvn_user');
      if (!window.location.pathname.startsWith('/login')) {
        window.location.href = '/login';
      }
    }
    return Promise.reject(err);
  }
);

const g = (url, params) => client.get(url, { params }).then((r) => r.data);
const p = (url, body) => client.post(url, body).then((r) => r.data);
const put = (url, body) => client.put(url, body).then((r) => r.data);
const patch = (url, body) => client.patch(url, body).then((r) => r.data);
const del = (url) => client.delete(url).then((r) => r.data);

export const api = {
  client,
  auth: {
    login: (email, password) => p('/auth/login', { email, password }),
    me: () => g('/auth/me'),
  },
  entities: {
    list: (params) => g('/entities', params),
    get: (id) => g(`/entities/${id}`),
    create: (body) => p('/entities', body),
    update: (id, body) => put(`/entities/${id}`, body),
    regulatoryCatalog: (entity_type) => g('/entities/regulatory-catalog', { entity_type }),
    updateRegulatoryApproval: (entityId, approvalId, body) =>
      put(`/entities/${entityId}/regulatory-approvals/${approvalId}`, body),
    uploadLogo: (id, file) => {
      const formData = new FormData();
      formData.append('logo', file);
      return client.post(`/entities/${id}/logo`, formData, { headers: { 'Content-Type': 'multipart/form-data' } }).then(r => r.data);
    },
    uploadSignature: (id, file) => {
      const formData = new FormData();
      formData.append('signature', file);
      return client.post(`/entities/${id}/signature`, formData, { headers: { 'Content-Type': 'multipart/form-data' } }).then(r => r.data);
    },
    approve: (id, decision, remarks) => p(`/entities/${id}/approve`, { decision, remarks }),
  },
  users: {
    list: () => g('/users'),
    create: (body) => p('/users', body),
    updateStatus: (id, is_active) => put(`/users/${id}/status`, { is_active })
  },
  documents: {
    list: (params) => g('/documents', params),
    upload: (formData) => client.post('/documents/upload', formData, { headers: { 'Content-Type': 'multipart/form-data' } }).then(r => r.data),
    verify: (versionId) => p(`/documents/${versionId}/verify`),
    reject: (versionId, reason) => p(`/documents/${versionId}/reject`, { reason }),
    downloadUrl: (versionId) => `/api/documents/${versionId}/download`,
    download: (versionId) => client.get(`/documents/${versionId}/download`, { responseType: 'blob' }).then((r) => ({
      blob: r.data,
      fileName: (() => {
        const cd = r.headers['content-disposition'] || '';
        const m = cd.match(/filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/i);
        return decodeURIComponent(m?.[1] || m?.[2] || 'document');
      })(),
      contentType: r.headers['content-type'] || r.data.type,
    })),
  },
  contracts: {
    list: (params) => g('/contracts', params),
    get: (id) => g(`/contracts/${id}`),
    create: (body) => p('/contracts', body),
    amend: (id, body) => p(`/contracts/${id}/amend`, body),
    updateStatus: (id, body) => p(`/contracts/${id}/status`, body),
    allocations: (id) => g(`/contracts/${id}/allocations`),
    addAllocation: (id, body) => p(`/contracts/${id}/allocations`, body),
    bulkUpload: (rows) => p('/contracts/bulk-upload', { rows }),
  },
  energyData: {
    list: (params) => g('/energy-data', params),
    create: (body) => p('/energy-data', body),
    validate: (id) => p(`/energy-data/${id}/validate`),
    lock: (id) => p(`/energy-data/${id}/lock`),
    parseREA: (formData) => client.post('/energy-data/parse-rea', formData, { headers: { 'Content-Type': 'multipart/form-data' } }).then(r => r.data),
    reaStatus: () => g('/energy-data/rea-status'),
    reaLog: (params) => g('/energy-data/rea-log', params),
    reaTrigger: (body) => p('/energy-data/rea-trigger', body),
    reaScan: (body) => p('/energy-data/rea-scan', body),
  },
  invoices: {
    list: (params) => g('/invoices', params),
    get: (id) => g(`/invoices/${id}`),
    downloadPdf: (id) => client.get(`/invoices/${id}/pdf`, { responseType: 'blob' }).then(res => res.data),
    getVerification: (id) => g(`/invoices/${id}/verification`),
    saveVerification: (id, body) => p(`/invoices/${id}/verification`, body),
    generate: (body) => p('/invoices/generate', body),
    arrear: (body) => p('/invoices/arrear', body),
    supplementary: (body) => p('/invoices/supplementary', body),
    submit: (body) => p('/invoices', body),
    submitL2: (id) => p(`/invoices/${id}/submit-l2`),
    approveL2: (id, comments) => p(`/invoices/${id}/approve-l2`, { comments }),
    submitForApproval: (id) => p(`/invoices/${id}/submit-for-approval`),
    act: (id, level, decision, comments) => p(`/invoices/${id}/approvals/${level}/act`, { decision, comments }),
    send: (id, body) => p(`/invoices/${id}/send`, body || {}),
    deliveries: (id) => g(`/invoices/${id}/deliveries`),
    cancel: (id, reason) => p(`/invoices/${id}/cancel`, { reason }),
    validate: (id) => p(`/invoices/${id}/validate`),
    waiveValidation: (id, reason) => p(`/invoices/${id}/validation/waive`, { reason }),
    recordPayment: (id, body) => p(`/invoices/${id}/payments`, body),
    releaseToGenerator: (id, body) => p(`/invoices/${id}/release-to-generator`, body),
    setOtherCharges: (id, body) => p(`/invoices/${id}/other-charges`, body),
    buyerOutstanding: (buyer_id) => g('/invoices/buyer-outstanding', { buyer_id }),
    waterfallPayment: (body) => p('/invoices/waterfall-payment', body),
  },
  powerDiversion: {
    list: (params) => g('/power-diversion', params),
    summary: () => g('/power-diversion/summary'),
    create: (body) => p('/power-diversion', body),
    markRecovered: (id, body) => p(`/power-diversion/${id}/mark-recovered`, body),
    remove: (id) => del(`/power-diversion/${id}`),
  },
  notes: {
    list: (params) => g('/notes', params),
    summary: () => g('/notes/summary'),
    create: (body) => p('/notes', body),
    cancel: (id) => p(`/notes/${id}/cancel`),
  },
  billingTrail: {
    get: (params) => g('/billing-trail', params),
  },
  deviation: {
    list: (params) => g('/deviation', params),
    summary: (params) => g('/deviation/summary', params),
    get: (id) => g(`/deviation/${id}`),
    create: (body) => p('/deviation', body),
    update: (id, body) => put(`/deviation/${id}`, body),
    submit: (id) => p(`/deviation/${id}/submit`),
    dispatch: (id, body) => p(`/deviation/${id}/dispatch`, body),
    linkInvoice: (id, body) => p(`/deviation/${id}/link-invoice`, body),
    remove: (id) => del(`/deviation/${id}`),
  },
  rec: {
    list: (params) => g('/rec', params),
    summary: (params) => g('/rec/summary', params),
    reference: () => g('/rec/reference'),
    issuable: (params) => g('/rec/issuable', params),
    get: (id) => g(`/rec/${id}`),
    create: (body) => p('/rec', body),
    update: (id, body) => put(`/rec/${id}`, body),
    issue: (id, body) => p(`/rec/${id}/issue`, body),
    addTxn: (id, body) => p(`/rec/${id}/transactions`, body),
    reverseTxn: (txnId, reason) => p(`/rec/transactions/${txnId}/reverse`, { reason }),
    remove: (id) => del(`/rec/${id}`),
  },
  noar: {
    list: (params) => g('/noar', params),
    summary: () => g('/noar/summary'),
    trend: () => g('/noar/trend'),
    create: (body) => p('/noar', body),
    reverse: (id, reason) => p(`/noar/${id}/reverse`, { reason }),
  },
  formIv: {
    list: (params) => g('/form-iv', params),
    summary: () => g('/form-iv/summary'),
    get: (id) => g(`/form-iv/${id}`),
    create: (body) => p('/form-iv', body),
    update: (id, body) => put(`/form-iv/${id}`, body),
    generate: (id) => p(`/form-iv/${id}/generate`),
    submit: (id, body) => p(`/form-iv/${id}/submit`, body),
    addLine: (id, body) => p(`/form-iv/${id}/lines`, body),
    updateLine: (lineId, body) => put(`/form-iv/lines/${lineId}`, body),
    deleteLine: (lineId) => del(`/form-iv/lines/${lineId}`),
    exportCsv: async (id, formNo) => {
      const res = await client.get(`/form-iv/${id}/export`, { responseType: 'blob' });
      const url = URL.createObjectURL(new Blob([res.data], { type: 'text/csv' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `${String(formNo || id).replaceAll('/', '-')}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    },
    downloadPdf: (id, formNo) => api.reports.downloadPdf(`/form-iv/${id}/pdf`, `${String(formNo || id).replaceAll('/', '-')}.pdf`),
  },
  stationBeta: {
    list: (params) => g('/station-beta', params),
    get: (id) => g(`/station-beta/${id}`),
    create: (body) => p('/station-beta', body),
    update: (id, body) => put(`/station-beta/${id}`, body),
    remove: (id) => del(`/station-beta/${id}`),
    trueUp: (id) => p(`/station-beta/${id}/true-up`),
    preview: (params) => g('/station-beta/preview/compute', params),
  },
  masters: {
    summary: () => g('/masters/summary'),
    banks: (params) => g('/masters/banks', params),
    createBank: (body) => p('/masters/banks', body),
    updateBank: (id, body) => put(`/masters/banks/${id}`, body),
    deleteBank: (id) => del(`/masters/banks/${id}`),
    parameters: (params) => g('/masters/parameters', params),
    createParameter: (body) => p('/masters/parameters', body),
    updateParameter: (key, body) => put(`/masters/parameters/${encodeURIComponent(key)}`, body),
    documentTypes: (params) => g('/masters/document-types', params),
    createDocumentType: (body) => p('/masters/document-types', body),
    updateDocumentType: (id, body) => put(`/masters/document-types/${id}`, body),
    lookups: (params) => g('/masters/lookups', params),
    createLookup: (body) => p('/masters/lookups', body),
    updateLookup: (id, body) => put(`/masters/lookups/${id}`, body),
    projects: () => g('/masters/projects'),
    resolvedBilling: () => g('/masters/resolved-billing'),
  },
  preTrade: {
    availabilities: (params) => g('/pre-trade/availabilities', params),
    declareAvailability: (body) => p('/pre-trade/availabilities', body),
    consents: (params) => g('/pre-trade/consents', params),
    submitConsent: (availabilityId, body) => p(`/pre-trade/availabilities/${availabilityId}/consents`, body),
    confirmConsent: (consentId) => p(`/pre-trade/consents/${consentId}/confirm`),
    rejectConsent: (consentId) => p(`/pre-trade/consents/${consentId}/reject`),
  },
  reports: {
    billingSummary: (params) => g('/reports/billing-summary', params),
    billingSummaryPdf: async (params = {}) => {
      const qs = new URLSearchParams();
      if (params.from) qs.set('from', params.from);
      if (params.to) qs.set('to', params.to);
      const q = qs.toString();
      const res = await client.get(`/reports/billing-summary/pdf${q ? `?${q}` : ''}`, {
        responseType: 'blob',
      });
      const blob = new Blob([res.data], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const from = params.from || 'all';
      const to = params.to || 'all';
      a.href = url;
      a.download = `SJVN_Billing_Report_${from}_to_${to}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    },
    energySummary: (params) => g('/reports/energy-summary', params),
    energySummaryPdf: async (params = {}) => {
      const qs = new URLSearchParams();
      if (params.from) qs.set('from', params.from);
      if (params.to) qs.set('to', params.to);
      if (params.contract_id) qs.set('contract_id', params.contract_id);
      const q = qs.toString();
      const res = await client.get(`/reports/energy-summary/pdf${q ? `?${q}` : ''}`, {
        responseType: 'blob',
      });
      // Guard against JSON error payloads returned as blob
      if (res.data?.type && res.data.type.includes('json')) {
        const text = await res.data.text();
        let msg = 'Failed to generate energy PDF';
        try { msg = JSON.parse(text).error || msg; } catch { /* ignore */ }
        throw new Error(msg);
      }
      const blob = new Blob([res.data], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const from = params.from || 'all';
      const to = params.to || 'all';
      a.href = url;
      a.download = `SJVN_Energy_Report_${from}_to_${to}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    },
    disputeSummaryPdf: async (params = {}) => {
      const qs = new URLSearchParams();
      if (params.from) qs.set('from', params.from);
      if (params.to) qs.set('to', params.to);
      if (params.status) qs.set('status', params.status);
      const q = qs.toString();
      const res = await client.get(`/reports/dispute-summary/pdf${q ? `?${q}` : ''}`, { responseType: 'blob' });
      if (res.data?.type && res.data.type.includes('json')) {
        const text = await res.data.text();
        let msg = 'Failed to generate dispute PDF';
        try { msg = JSON.parse(text).error || msg; } catch { /* */ }
        throw new Error(msg);
      }
      const blob = new Blob([res.data], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `SJVN_Dispute_Report_${params.from || 'all'}_to_${params.to || 'all'}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    },
    reconSummaryPdf: async (params = {}) => {
      const qs = new URLSearchParams();
      if (params.from) qs.set('from', params.from);
      if (params.to) qs.set('to', params.to);
      if (params.status) qs.set('status', params.status);
      const q = qs.toString();
      const res = await client.get(`/reports/recon-summary/pdf${q ? `?${q}` : ''}`, { responseType: 'blob' });
      if (res.data?.type && res.data.type.includes('json')) {
        const text = await res.data.text();
        let msg = 'Failed to generate reconciliation PDF';
        try { msg = JSON.parse(text).error || msg; } catch { /* */ }
        throw new Error(msg);
      }
      const blob = new Blob([res.data], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `SJVN_Reconciliation_Report_${params.from || 'all'}_to_${params.to || 'all'}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    },
    contractSummaryPdf: async (params = {}) => {
      const qs = new URLSearchParams();
      if (params.contract_type) qs.set('contract_type', params.contract_type);
      if (params.status) qs.set('status', params.status);
      if (params.project_type) qs.set('project_type', params.project_type);
      if (params.q) qs.set('q', params.q);
      const q = qs.toString();
      const res = await client.get(`/reports/contract-summary/pdf${q ? `?${q}` : ''}`, { responseType: 'blob' });
      if (res.data?.type && res.data.type.includes('json')) {
        const text = await res.data.text();
        let msg = 'Failed to generate contract PDF';
        try { msg = JSON.parse(text).error || msg; } catch { /* */ }
        throw new Error(msg);
      }
      const blob = new Blob([res.data], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'SJVN_Contract_Portfolio_Report.pdf';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    },
    audit: (params) => g('/reports/audit', params),
    marketAnalytics: (params) => g('/reports/market-analytics', params),
    tradingProfitability: (params) => g('/reports/trading-profitability', params),
    // Shared PDF download: a blob that comes back as JSON is the API's error
    // body, which would otherwise be saved as a corrupt .pdf.
    downloadPdf: async (path, filename, params = {}) => {
      const qs = new URLSearchParams(
        Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')
      ).toString();
      const res = await client.get(`${path}${qs ? `?${qs}` : ''}`, { responseType: 'blob' });
      if (res.data?.type && res.data.type.includes('json')) {
        const text = await res.data.text();
        let msg = 'Failed to generate PDF';
        try { msg = JSON.parse(text).error || msg; } catch { /* keep default */ }
        throw new Error(msg);
      }
      const url = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    },
    reiaDashboardPdf: async () => {
      const res = await client.get('/reports/reia-dashboard/pdf', { responseType: 'blob' });
      if (res.data?.type && res.data.type.includes('json')) {
        const text = await res.data.text();
        let msg = 'Failed to generate REIA dashboard PDF';
        try { msg = JSON.parse(text).error || msg; } catch { /* */ }
        throw new Error(msg);
      }
      const blob = new Blob([res.data], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'SJVN_REIA_Dashboard_Snapshot.pdf';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    },
  },
  disputes: {
    list: (params) => g('/disputes', params),
    get: (id) => g(`/disputes/${id}`),
    meta: () => g('/disputes/meta'),
    stats: () => g('/disputes/stats'),
    create: (body) => p('/disputes', body),
    transition: (id, status, note) => p(`/disputes/${id}/transition`, { status, note }),
    setStatus: (id, status) => p(`/disputes/${id}/status`, { status }),
    resolve: (id, body) => p(`/disputes/${id}/resolve`, body),
    comment: (id, body, is_internal = false) => p(`/disputes/${id}/comments`, { body, is_internal }),
    assign: (id, assigned_to) => p(`/disputes/${id}/assign`, { assigned_to }),
    uploadEvidence: (id, file, note) => {
      const fd = new FormData();
      fd.append('file', file);
      if (note) fd.append('note', note);
      return client.post(`/disputes/${id}/evidence`, fd).then((r) => r.data);
    },
    slaCheck: () => p('/disputes/sla/check'),
  },
  paymentSecurity: {
    list: (params) => g('/payment-security', params),
    get: (id) => g(`/payment-security/${id}`),
    stats: () => g('/payment-security/stats'),
    meta: () => g('/payment-security/meta'),
    expiring: (days) => g('/payment-security/expiring', { days }),
    adequacy: (contractId) => g(`/payment-security/adequacy/${contractId}`),
    requirements: (contractId) => g(`/payment-security/requirements/${contractId}`),
    releases: () => g('/payment-security/releases'),
    overrides: () => g('/payment-security/overrides'),
    invocations: (params) => g('/payment-security/invocations', params),
    create: (body) => p('/payment-security', body),
    fromContract: (contractId) => p(`/payment-security/from-contract/${contractId}`),
    verify: (id, bank_confirmation_ref) => p(`/payment-security/${id}/verify`, { bank_confirmation_ref }),
    utilize: (id, amount) => p(`/payment-security/${id}/utilize`, { amount }),
    replenish: (id, amount) => p(`/payment-security/${id}/replenish`, { amount }),
    renew: (id, body) => p(`/payment-security/${id}/renew`, body),
    invoke: (id, amount) => p(`/payment-security/${id}/invoke`, { amount }),
    startInvocation: (body) => p('/payment-security/invocations', body),
    transitionInvocation: (id, status, notes) => p(`/payment-security/invocations/${id}/transition`, { status, notes }),
    releaseRequest: (id, reason) => p(`/payment-security/${id}/release-request`, { reason }),
    actRelease: (id, decision) => p(`/payment-security/releases/${id}/act`, { decision }),
    createOverride: (body) => p('/payment-security/overrides', body),
    runAlerts: () => p('/payment-security/alerts/run'),
  },
  reconciliation: {
    list: (params) => g('/reconciliation', params),
    get: (id) => g(`/reconciliation/${id}`),
    stats: () => g('/reconciliation/stats'),
    meta: () => g('/reconciliation/meta'),
    run: (body) => p('/reconciliation/run', body),
    runScheduled: () => p('/reconciliation/run-scheduled'),
    override: (id, item_id, reason) => p(`/reconciliation/${id}/override`, { item_id, reason }),
    raiseDispute: (id, body) => p(`/reconciliation/${id}/raise-dispute`, body),
    requestSignoff: (id) => p(`/reconciliation/${id}/request-signoff`),
    acknowledge: (id, decision, note, remarks) => p(`/reconciliation/${id}/acknowledge`, { decision, note, remarks }),
    reopenRequest: (id, reason) => p(`/reconciliation/${id}/reopen-request`, { reason }),
    reopenRequests: () => g('/reconciliation/reopen-requests'),
    actReopen: (id, decision) => p(`/reconciliation/reopen-requests/${id}/act`, { decision }),
    statement: (id, version) => g(`/reconciliation/${id}/statement`, version ? { version } : undefined),
    regenerateStatement: (id) => p(`/reconciliation/${id}/regenerate-statement`),
    resolve: (id, notes) => p(`/reconciliation/${id}/resolve`, { notes }),
  },
  tradingClients: {
    list: (params) => g('/trading-clients', params),
    get: (id) => g(`/trading-clients/${id}`),
    create: (body) => p('/trading-clients', body),
    update: (id, body) => client.put(`/trading-clients/${id}`, body).then(r => r.data),
    suspend: (id, reason) => p(`/trading-clients/${id}/suspend`, { reason }),
    addSignatory: (id, body) => p(`/trading-clients/${id}/signatories`, body),
    removeSignatory: (id, sigId) => client.delete(`/trading-clients/${id}/signatories/${sigId}`).then(r => r.data),
    addExchange: (id, body) => p(`/trading-clients/${id}/exchanges`, body),
    removeExchange: (id, excId) => client.delete(`/trading-clients/${id}/exchanges/${excId}`).then(r => r.data),
  },
  rateMaster: {
    list: (params) => g('/masters/rates', params),
    effective: (charge, date) => g('/masters/rates/effective', { charge, date }),
    create: (body) => p('/masters/rates', body),
    revise: (body) => p('/masters/rates/revise', body),
  },
  tds: {
    vendors: () => g('/tds/vendors'),
    list: (params) => g('/tds', params),
    pending: () => g('/tds/pending'),
    summary: (period) => g('/tds/summary', period ? { period } : undefined),
    record: (body) => p('/tds', body),
    challan: (id, body) => p(`/tds/${id}/challan`, body),
    panCompliance: () => g('/tds/pan-compliance'),
  },
  oaCharges: {
    estimate: (body) => p('/oa-charges/estimate', body),
    save: (body) => p('/oa-charges/estimate/save', body),
    forBilateral: (id) => g(`/oa-charges/estimate/${id}`),
    reconcile: (params) => g('/oa-charges/reconcile', params),
    actualsByMonth: (params) => g('/oa-charges/actuals-by-month', params),
  },
  margin: {
    check: (params) => g('/margin/check', params),
    rateTrend: (params) => g('/margin/rate-trend', params),
    receiptExceptions: (params) => g('/margin/receipt-exceptions', params),
  },
  deviations: {
    list: (params) => g('/deviations', params),
    summary: (params) => g('/deviations/summary', params),
    scorecard: (params) => g('/deviations/scorecard', params),
    incidents: (params) => g('/deviations/incidents', params),
  },
  paymentCycle: {
    position: (params) => g('/payment-cycle/position', params),
    timeline: (params) => g('/payment-cycle/timeline', params),
    ageing: (params) => g('/payment-cycle/ageing', params),
    settlementSpeed: (params) => g('/payment-cycle/settlement-speed', params),
    entries: (params) => g('/payment-cycle/entries', params),
  },
  pnl: {
    contracts: (params) => g('/pnl/contracts', params),
    realised: (params) => g('/pnl/realised', params),
  },
  ledgerImport: {
    // No file: the server falls back to the workbook shipped in docs/.
    run: () => p('/import/trading-ledger'),
    upload: (file) => {
      const formData = new FormData();
      formData.append('file', file);
      return client.post('/import/trading-ledger', formData, { headers: { 'Content-Type': 'multipart/form-data' } }).then(r => r.data);
    },
  },
  bids: {
    list: (params) => g('/bids', params),
    get: (id) => g(`/bids/${id}`),
    create: (body) => p('/bids', body),
    submit: (id) => p(`/bids/${id}/submit`),
    approve: (id, status, reason) => p(`/bids/${id}/approve`, { status, reason }),
    noBid: (body) => p('/bids/no-bid', body),
    bulk: (rows, dryRun) => p('/bids/bulk', { rows, dry_run: !!dryRun }),
    // Must go through the axios client so the JWT is attached — a plain <a href>
    // hits the API unauthenticated and downloads the 401 JSON body instead.
    downloadBulkTemplate: () => client.get('/bids/bulk-template', { responseType: 'blob' }).then((r) => r.data),
    ocfChains: () => g('/bids/ocf-chains'),
    recordResult: (id, blocks) => p(`/bids/${id}/result`, { blocks }),
    syncResult: (id) => p(`/bids/${id}/sync-result`),
    carryForward: (id, body) => p(`/bids/${id}/carry-forward`, body),
    chain: (id) => g(`/bids/${id}/chain`),
  },
  bilateral: {
    list: (params) => g('/bilateral', params),
    get: (id) => g(`/bilateral/${id}`),
    create: (body) => p('/bilateral', body),
    createSchedule: (id, body) => p(`/bilateral/${id}/schedules`, body),
    updateApproval: (id, node_type, status) => p(`/bilateral/schedules/${id}/approvals`, { node_type, status }),
    curtail: (id, curtailed_mw) => p(`/bilateral/schedules/${id}/curtail`, { curtailed_mw }),
    recordActuals: (id, actual_mw) => p(`/bilateral/schedules/${id}/actuals`, { actual_mw }),
    updateNoar: (id, body) => p(`/bilateral/${id}/noar`, body),
    wbesStatus: () => g('/bilateral/wbes/status'),
    wbesSync: (body) => p('/bilateral/wbes/sync', body),
    noarSla: () => g('/bilateral/noar-sla'),
    noarBulk: (body) => p('/bilateral/noar/bulk', body),
    downloadNoarTimelineCsv: () => client.get('/bilateral/noar-timeline.csv', { responseType: 'blob' }).then((r) => r.data),
    downloadNoarReportPdf: () => client.get('/bilateral/noar-approval-report.pdf', { responseType: 'blob' }).then((r) => r.data),
    formatDUrl: (id) => `/api/bilateral/${id}/format-d`,
    downloadFormatD: (id) => client.get(`/bilateral/${id}/format-d`, { responseType: 'blob' }).then((r) => r.data),
    downloadLoi: (id) => client.get(`/bilateral/${id}/loi`, { responseType: 'blob' }).then((r) => r.data),
  },
  billingSettlement: {
    listInvoices: (params) => g('/billing-settlement/invoices', params),
    generateInvoice: (body) => p('/billing-settlement/invoices/generate', body),
    getLedger: (clientId) => g(`/billing-settlement/ledger/${clientId}`),
    getSoa: () => g('/billing-settlement/soa'),
    applyNetting: (body) => p('/billing-settlement/netting', body),
  },
  generatorBilling: {
    list: (params) => g('/generator-billing', params),
    generate: (body) => p('/generator-billing/generate', body),
    updateStatus: (id, status) => p(`/generator-billing/${id}/status`, { status }),
  },
  marketAnalytics: {
    getRates: (params) => g('/market-analytics/rates', params),
    getSummary: (params) => g('/market-analytics/summary', params),
    getTrend: (params) => g('/market-analytics/trend', params),
    getLatestPrices: () => g('/market-analytics/latest-prices'),
    getBlocks: (params) => g('/market-analytics/blocks', params),
    getContext: (params) => g('/market-analytics/context', params),
    getAlerts: () => g('/market-analytics/alerts'),
    createAlert: (body) => p('/market-analytics/alerts', body),
    toggleAlert: (id, is_active) => patch(`/market-analytics/alerts/${id}`, { is_active }),
    deleteAlert: (id) => del(`/market-analytics/alerts/${id}`),
  },
  dashboard: {
    reia: () => g('/dashboard/reia'),
    trading: {
      realtime: () => g('/dashboard/trading/realtime'),
      daily: () => g('/dashboard/trading/daily'),
      periodic: () => g('/dashboard/trading/periodic'),
      health: () => g('/dashboard/trading/health'),
    },
    consolidated: () => g('/dashboard/consolidated'),
  },
  sellerDashboard: () => g('/seller-dashboard'),
  buyerDashboard: () => g('/buyer-dashboard'),
  notifications: {
    /**
     * Server notifications, plus any live standing-clearance findings.
     *
     * A fabricated alert used to be injected here — a fixed 14-day expiry
     * warning for Naitwar Mori HPS, shown to every user regardless of the real
     * clearance state and indistinguishable from a genuine notification. The
     * platform now holds actual clearance records, so the warnings are derived
     * from those and disappear when a clearance is renewed.
     */
    list: async () => {
      const [serverNotifs, clearance] = await Promise.all([
        g('/notifications').catch(() => []),
        g('/bids/standing-clearance').catch(() => null),
      ]);
      if (!clearance) return serverNotifs;

      const dismissed = JSON.parse(localStorage.getItem('sjvn_clearance_dismissed') || '[]');
      const alerts = [
        ...clearance.expired.map((c) => ({
          id: `clearance-expired-${c.client_id}`,
          type: 'COMPLIANCE_ALERT',
          message: `Standing clearance${c.standing_clearance_no ? ` (${c.standing_clearance_no})` : ''} for ${c.client_name} lapsed on ${c.valid_till}. New bids are being refused.`,
        })),
        ...clearance.renewal_due.map((c) => ({
          id: `clearance-renewal-${c.client_id}`,
          type: 'COMPLIANCE_ALERT',
          message: `Standing clearance${c.standing_clearance_no ? ` (${c.standing_clearance_no})` : ''} for ${c.client_name} expires in ${c.days_left} day(s) on ${c.valid_till}. Clause 26 requires the renewal declaration ${c.renewal_notice_days} days ahead.`,
        })),
      ]
        .filter((a) => !dismissed.includes(a.id))
        .map((a) => ({ ...a, is_read: false, created_at: new Date().toISOString() }));

      return [...alerts, ...serverNotifs];
    },
    markRead: (id) => {
      // Clearance alerts are derived, not rows — dismissing one is local, and it
      // comes back if the clearance is still in that state on the next load.
      if (String(id).startsWith('clearance-')) {
        const dismissed = JSON.parse(localStorage.getItem('sjvn_clearance_dismissed') || '[]');
        localStorage.setItem('sjvn_clearance_dismissed', JSON.stringify([...new Set([...dismissed, id])]));
        return Promise.resolve({ success: true });
      }
      return p(`/notifications/${id}/read`);
    },
    markAllRead: () => p('/notifications/read-all'),
  },
  alerts: {
    board: () => g('/alerts/board'),
    complianceTicker: (portfolio_id) => g('/alerts/compliance-ticker', portfolio_id ? { portfolio_id } : undefined),
    broadcasts: (params) => g('/alerts/broadcasts', params),
    createBroadcast: (body) => p('/alerts/broadcasts', body),
    deleteBroadcast: (id) => del(`/alerts/broadcasts/${id}`),
  },
  // Trading desk operational screens. These go through the shared client so they
  // pick up the JWT and the 401 -> login redirect; hand-rolled fetch calls read
  // the wrong localStorage key and sent "Bearer null" on every request.
  standingClearance: {
    get: (clientId) => g(`/bids/standing-clearance/${clientId}`),
    check: (body) => p('/bids/compliance-check', body),
  },
  tradingOps: {
    dor: (params) => g('/trading/dor', params),
    schedules: (params) => g('/trading/schedules', params),
    archive: (params) => g('/trading/archive', params),
    bankTransactions: (params) => g('/trading/bank-transactions', params),
  },
  losses: {
    get: () => g('/masters/losses'),
    update: (body) => p('/masters/losses', body),
  },
  communications: {
    logs: () => g('/communications/logs'),
    inbox: () => g('/communications/inbox'),
    hide: (message_id) => p('/communications/inbox/hide', { message_id }),
    broadcast: (formData) => client
      .post('/communications/broadcast', formData, { headers: { 'Content-Type': 'multipart/form-data' } })
      .then((r) => r.data),
  },
  holidays: {
    list: (params) => g('/masters/holidays', params),
    states: () => g('/masters/holidays/states'),
    settings: () => g('/masters/holidays/settings'),
    check: (params) => g('/masters/holidays/check', params),
    previewDueDate: (params) => g('/masters/holidays/due-date-preview', params),
    add: (body) => p('/masters/holidays', body),
    bulkAdd: (body) => p('/masters/holidays/bulk', body),
    deactivate: (id, body) => p(`/masters/holidays/${id}/deactivate`, body),
    reactivate: (id) => p(`/masters/holidays/${id}/reactivate`),
  },
  tradingNotes: {
    list: (params) => g('/trading-notes', params),
    reference: () => g('/trading-notes/reference'),
    summary: (params) => g('/trading-notes/summary', params),
    get: (id) => g(`/trading-notes/${id}`),
    create: (body) => p('/trading-notes', body),
    settle: (id, body) => p(`/trading-notes/${id}/settle`, body),
    cancel: (id, body) => p(`/trading-notes/${id}/cancel`, body),
  },
  auditLogs: {
    list: (params) => g('/audit-logs', params),
    get: (id) => g(`/audit-logs/${id}`),
    verifyIntegrity: () => p('/audit-logs/verify-integrity'),
    violationsSod: () => g('/audit-logs/violations/sod'),
    logExport: (body) => p('/audit-logs/log-export', body),
  },
  cercMarket: {
    getSummary: (period) => g(period ? `/cerc-market/summary/${period}` : '/cerc-market/summary'),
    getPrices: (params) => g('/cerc-market/prices', { params }),
    getVolumes: (params) => g('/cerc-market/volumes', { params }),
    getDailyTrend: (params) => g('/cerc-market/daily-trend', { params }),
    getDsm: (params) => g('/cerc-market/dsm', { params }),
    getRec: (params) => g('/cerc-market/rec', { params }),
    getPeriods: () => g('/cerc-market/periods'),
    getFetchLog: () => g('/cerc-market/fetch-log'),
    triggerFetch: (period) => p('/cerc-market/trigger', { period }),
    triggerScan: () => p('/cerc-market/scan'),
  },
};

export default api;
