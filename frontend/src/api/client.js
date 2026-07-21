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
    generate: (body) => p('/invoices/generate', body),
    submit: (body) => p('/invoices', body),
    submitL2: (id) => p(`/invoices/${id}/submit-l2`),
    approveL2: (id, comments) => p(`/invoices/${id}/approve-l2`, { comments }),
    submitForApproval: (id) => p(`/invoices/${id}/submit-for-approval`),
    act: (id, level, decision, comments) => p(`/invoices/${id}/approvals/${level}/act`, { decision, comments }),
    send: (id) => p(`/invoices/${id}/send`),
    recordPayment: (id, body) => p(`/invoices/${id}/payments`, body),
  },
  billingTrail: {
    get: (params) => g('/billing-trail', params),
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
    acknowledge: (id, decision, note) => p(`/reconciliation/${id}/acknowledge`, { decision, note }),
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
  bids: {
    list: (params) => g('/bids', params),
    get: (id) => g(`/bids/${id}`),
    create: (body) => p('/bids', body),
    submit: (id) => p(`/bids/${id}/submit`),
    approve: (id, status, reason) => p(`/bids/${id}/approve`, { status, reason }),
    noBid: (body) => p('/bids/no-bid', body),
  },
  bilateral: {
    list: (params) => g('/bilateral', params),
    get: (id) => g(`/bilateral/${id}`),
    create: (body) => p('/bilateral', body),
    createSchedule: (id, body) => p(`/bilateral/${id}/schedules`, body),
    updateApproval: (id, node_type, status) => p(`/bilateral/schedules/${id}/approvals`, { node_type, status }),
    curtail: (id, curtailed_mw) => p(`/bilateral/schedules/${id}/curtail`, { curtailed_mw }),
    recordActuals: (id, actual_mw) => p(`/bilateral/schedules/${id}/actuals`, { actual_mw }),
  },
  billingSettlement: {
    listInvoices: (params) => g('/billing-settlement/invoices', params),
    generateInvoice: (body) => p('/billing-settlement/invoices/generate', body),
    getLedger: (clientId) => g(`/billing-settlement/ledger/${clientId}`),
    getSoa: () => g('/billing-settlement/soa'),
    applyNetting: (body) => p('/billing-settlement/netting', body),
  },
  marketAnalytics: {
    getRates: (params) => g('/market-analytics/rates', params),
    getContext: (params) => g('/market-analytics/context', params),
    getAlerts: () => g('/market-analytics/alerts'),
    createAlert: (body) => p('/market-analytics/alerts', body),
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
    list: () => g('/notifications'),
    markRead: (id) => p(`/notifications/${id}/read`),
    markAllRead: () => p('/notifications/read-all'),
  },
  alerts: {
    board: () => g('/alerts/board'),
    broadcasts: (params) => g('/alerts/broadcasts', params),
    createBroadcast: (body) => p('/alerts/broadcasts', body),
    deleteBroadcast: (id) => del(`/alerts/broadcasts/${id}`),
  },
  auditLogs: {
    list: (params) => g('/audit-logs', params),
    get: (id) => g(`/audit-logs/${id}`),
    verifyIntegrity: () => p('/audit-logs/verify-integrity'),
    violationsSod: () => g('/audit-logs/violations/sod'),
    logExport: (body) => p('/audit-logs/log-export', body),
  },
};

export default api;
