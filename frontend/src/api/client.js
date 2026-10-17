import axios from 'axios';
import { ROLE_GROUPS } from '../roles.js';

const client = axios.create({ baseURL: '/api' });

client.interceptors.request.use((config) => {
  const token = localStorage.getItem('sjvn_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

client.interceptors.response.use(
  (res) => res,
  (err) => {
    // A 401 from the password-change form means the *typed* current password was
    // wrong, not that the session expired — signing the user out there would
    // throw them back to the login screen for a typo.
    const isPasswordCheck = err.config?.url?.includes('/auth/change-password');
    if (err.response?.status === 401 && !isPasswordCheck) {
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
const of = (entityId) => (entityId ? { entity_id: entityId } : undefined);
const del = (url) => client.delete(url).then((r) => r.data);

export const api = {
  client,
  auth: {
    login: (email, password) => p('/auth/login', { email, password }),
    me: () => g('/auth/me'),
    changePassword: (current_password, new_password) =>
      p('/auth/change-password', { current_password, new_password }),
  },
  entities: {
    setOwnStation: (id, body) => p(`/entities/${id}/own-station`, body),
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
    approve: (id, decision, remarks, extra = {}) => p(`/entities/${id}/approve`, { decision, remarks, ...extra }),
    setBlacklist: (id, blacklisted, reason) => p(`/entities/${id}/blacklist`, { blacklisted, reason }),
    linkVertical: (id, vertical) => p(`/entities/${id}/verticals`, { vertical }),
  },
  users: {
    list: () => g('/users'),
    create: (body) => p('/users', body),
    updateStatus: (id, is_active) => put(`/users/${id}/status`, { is_active })
  },
  // A company's own users: levels, resets, switching off, and what each has been doing.
  // `entityId` is for SJVN's admins, opening a company's team from outside it.
  team: {
    companies: () => g('/team/companies'),
    get: (entityId) => g('/team', of(entityId)),
    add: (body, entityId) => client.post('/team', body, { params: of(entityId) }).then((r) => r.data),
    update: (id, body, entityId) => client.patch(`/team/${id}`, body, { params: of(entityId) }).then((r) => r.data),
    deactivate: (id, reason, entityId) => client.post(`/team/${id}/deactivate`, { reason }, { params: of(entityId) }).then((r) => r.data),
    reactivate: (id, entityId) => client.post(`/team/${id}/reactivate`, {}, { params: of(entityId) }).then((r) => r.data),
    resetPassword: (id, entityId) => client.post(`/team/${id}/reset-password`, {}, { params: of(entityId) }).then((r) => r.data),
    unlock: (id, entityId) => client.post(`/team/${id}/unlock`, {}, { params: of(entityId) }).then((r) => r.data),
    activity: (id, entityId) => g(`/team/${id}/activity`, of(entityId)),
    history: (entityId) => g('/team/history', of(entityId)),
    exportCsv: (entityId) => client.get('/team/export.csv', { params: of(entityId), responseType: 'blob' }).then((r) => r.data),
  },
  // SJVN's own users: roles, resets, switching off.
  staff: {
    get: () => g('/staff'),
    add: (body) => p('/staff', body),
    update: (id, body) => patch(`/staff/${id}`, body),
    deactivate: (id, reason) => p(`/staff/${id}/deactivate`, { reason }),
    reactivate: (id) => p(`/staff/${id}/reactivate`),
    resetPassword: (id) => p(`/staff/${id}/reset-password`),
    unlock: (id) => p(`/staff/${id}/unlock`),
    activity: (id) => g(`/staff/${id}/activity`),
    history: () => g('/staff/history'),
    exportCsv: () => client.get('/staff/export.csv', { responseType: 'blob' }).then((r) => r.data),
  },
  // What is waiting on SJVN, across every desk.
  sjvnDesk: () => g('/sjvn-desk'),
  documents: {
    list: (params) => g('/documents', params),
    upload: (formData) => client.post('/documents/upload', formData, { headers: { 'Content-Type': 'multipart/form-data' } }).then(r => r.data),
    verify: (versionId) => p(`/documents/${versionId}/verify`),
    reject: (versionId, reason, reason_code) => p(`/documents/${versionId}/reject`, { reason, reason_code }),
    rejectReasons: () => g('/documents/reject-reasons'),
    history: (documentId) => g(`/documents/history/${documentId}`),
    queue: (params) => g('/documents/queue', params),
    kycReport: (params) => g('/documents/kyc-report', params),
    requests: (params) => g('/documents/requests', params),
    createRequest: (body) => p('/documents/requests', body),
    cancelRequest: (id) => p(`/documents/requests/${id}/cancel`),
    zip: (params) => client.get('/documents/zip', { params, responseType: 'blob' }).then((r) => ({
      blob: r.data,
      fileName: (r.headers['content-disposition'] || '').match(/filename="?([^";]+)"?/i)?.[1] || 'documents.zip',
    })),
    submitL2: (versionId) => p(`/documents/${versionId}/submit-l2`),
    downloadUrl: (versionId) => {
      const token = localStorage.getItem('sjvn_token') || localStorage.getItem('token');
      return `/api/documents/${versionId}/download${token ? `?token=${encodeURIComponent(token)}` : ''}`;
    },
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
  // The working side of a contract: milestones, requests, notices, the guarantee.
  contractWorkspace: {
    meta: () => g('/contract-workspace/meta'),
    summary: () => g('/contract-workspace/summary'),
    pending: () => g('/contract-workspace/pending'),
    get: (id) => g(`/contract-workspace/${id}`),
    addStandardMilestones: (id) => p(`/contract-workspace/${id}/milestones/standard`),
    addMilestone: (id, body) => p(`/contract-workspace/${id}/milestones`, body),
    updateMilestone: (mid, body) => patch(`/contract-workspace/milestones/${mid}`, body),
    removeMilestone: (mid) => del(`/contract-workspace/milestones/${mid}`),
    reportMilestone: (mid, body) => p(`/contract-workspace/milestones/${mid}/report`, body),
    confirmMilestone: (mid, body) => p(`/contract-workspace/milestones/${mid}/confirm`, body),
    raiseRequest: (id, body) => p(`/contract-workspace/${id}/requests`, body),
    decideRequest: (rid, body) => p(`/contract-workspace/requests/${rid}/decide`, body),
    withdrawRequest: (rid) => p(`/contract-workspace/requests/${rid}/withdraw`),
    sendNotice: (id, body) => p(`/contract-workspace/${id}/notices`, body),
    acknowledgeNotice: (nid) => p(`/contract-workspace/notices/${nid}/acknowledge`),
  },
  contracts: {
    hold: (id) => g(`/contracts/${id}/hold`),
    setHold: (id, on, reason) => p(`/contracts/${id}/hold`, { on, reason }),
    overrideHold: (id, body) => p(`/contracts/${id}/hold/override`, body),
    complianceRequest: (id, code) => p(`/contracts/${id}/compliance-request`, { code }),
    list: (params) => g('/contracts', params),
    get: (id) => g(`/contracts/${id}`),
    create: (body) => p('/contracts', body),
    amend: (id, body) => p(`/contracts/${id}/amend`, body),
    updateStatus: (id, body) => p(`/contracts/${id}/status`, body),
    allocations: (id) => g(`/contracts/${id}/allocations`),
    addAllocation: (id, body) => p(`/contracts/${id}/allocations`, body),
    deleteAllocation: (id, allocId) => del(`/contracts/${id}/allocations/${allocId}`),
    discardDraft: (id) => del(`/contracts/${id}`),
    // The complete split from a date: shares left out end the day before.
    reviseAllocations: (id, body) => p(`/contracts/${id}/allocations/revise`, body),
    // dry_run validates and reports without writing, so the desk sees what a
    // file would do before it does it.
    bulkUpload: (rows, dryRun = false) => p('/contracts/bulk-upload', { rows, dry_run: !!dryRun }),
    // Through the axios client so the JWT is attached — a plain <a href> hits the
    // API unauthenticated and downloads the 401 body as the template.
    bulkTemplate: () => client.get('/contracts/bulk-template', { responseType: 'blob' }).then((r) => r.data),
  },
  energyData: {
    list: (params) => g('/energy-data', params),
    create: (body) => p('/energy-data', body),
    validate: (id) => p(`/energy-data/${id}/validate`),
    lock: (id, body) => p(`/energy-data/${id}/lock`, body),
    parseREA: (formData) => client.post('/energy-data/parse-rea', formData, { headers: { 'Content-Type': 'multipart/form-data' } }).then(r => r.data),
    reaStatus: () => g('/energy-data/rea-status'),
    reaLog: (params) => g('/energy-data/rea-log', params),
    reaTrigger: (body) => p('/energy-data/rea-trigger', body),
    reaScan: (body) => p('/energy-data/rea-scan', body),
    // A JMR, a state energy account or an RLDC statement, from the document's
    // own table. dry_run reads and matches without writing.
    accountTypes: () => g('/energy-data/account-types'),
    accountTemplate: (accountType) => client.get('/energy-data/account-template', { params: { account_type: accountType }, responseType: 'blob' }).then((r) => r.data),
    uploadAccount: (file, fields = {}, dryRun = false) => {
      const fd = new FormData();
      fd.append('file', file);
      for (const [k, v] of Object.entries(fields)) if (v) fd.append(k, v);
      fd.append('dry_run', dryRun ? 'true' : 'false');
      return client.post('/energy-data/upload-account', fd).then((r) => r.data);
    },
  },
  invoices: {
    // A month of bills from the seller's own sheet: dry_run checks and reports
    // without raising anything.
    upload: (rows, dryRun = false) => p('/invoices/upload', { rows, dry_run: !!dryRun }),
    uploadTemplate: () => client.get('/invoices/upload-template', { responseType: 'blob' }).then((r) => r.data),
    list: (params) => g('/invoices', params),
    get: (id) => g(`/invoices/${id}`),
    downloadPdf: (id) => client.get(`/invoices/${id}/pdf`, { responseType: 'blob' }).then(res => res.data),
    payments: (params) => g('/invoices/payments', params),
    getVerification: (id) => g(`/invoices/${id}/verification`),
    saveVerification: (id, body) => p(`/invoices/${id}/verification`, body),
    generate: (body) => p('/invoices/generate', body),
    backToBack: (id) => g(`/invoices/${id}/back-to-back`),
    readiness: (period) => g('/invoices/readiness', period ? { period_month: period } : undefined),
    generateReady: (body) => p('/invoices/generate-ready', body),
    monthClose: (period) => g('/invoices/month-close', period ? { period_month: period } : undefined),
    releasePlanner: () => g('/invoices/release-planner'),
    sendBack: (id, note) => p(`/invoices/${id}/send-back`, { note }),
    verifyBulk: (ids) => p('/invoices/verify-bulk', { invoice_ids: ids }),
    lpsPreview: (period) => g('/invoices/lps-bills/preview', period ? { period_month: period } : undefined),
    raiseLpsBills: (body) => p('/invoices/lps-bills', body),
    arrear: (body) => p('/invoices/arrear', body),
    supplementary: (body) => p('/invoices/supplementary', body),
    submit: (body) => p('/invoices', body),
    // A seller correcting its own draft, or a bill SJVN sent back, before it goes again.
    revise: (id, body) => client.put(`/invoices/${id}/revise`, body).then((r) => r.data),
    submitL2: (id) => p(`/invoices/${id}/submit-l2`),
    approveL2: (id, comments) => p(`/invoices/${id}/approve-l2`, { comments }),
    submitForApproval: (id) => p(`/invoices/${id}/submit-for-approval`),
    act: (id, level, decision, comments, extra = {}) => p(`/invoices/${id}/approvals/${level}/act`, { decision, comments, ...extra }),
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
  // A guarantee as a document: expiry, the bank's SFMS advice, the scan, amendments, and SJVN's own LCs.
  securityDesk: {
    meta: () => g('/security-desk/meta'),
    overview: () => g('/security-desk/overview'),
    get: (id) => g(`/security-desk/instruments/${id}`),
    submit: (body) => p('/security-desk/instruments', body),
    decideSubmission: (id, body) => p(`/security-desk/instruments/${id}/decide`, body),
    recordSfms: (id, body) => p(`/security-desk/instruments/${id}/sfms`, body),
    attachDocument: (id, body) => p(`/security-desk/instruments/${id}/document`, body),
    amend: (id, body) => p(`/security-desk/instruments/${id}/amendments`, body),
    decideAmendment: (id, body) => p(`/security-desk/amendments/${id}/decide`, body),
    withdrawAmendment: (id) => p(`/security-desk/amendments/${id}/withdraw`),
    lc: (id) => g(`/security-desk/lcs/${id}`),
    openLc: (body) => p('/security-desk/lcs', body),
    amendLc: (id, body) => p(`/security-desk/lcs/${id}/amend`, body),
    closeLc: (id, note) => p(`/security-desk/lcs/${id}/close`, { note }),
    drawLc: (id, body) => p(`/security-desk/lcs/${id}/draws`, body),
    reinstateLc: (id, body) => p(`/security-desk/lcs/${id}/reinstate`, body),
    register: () => client.get('/security-desk/register.xlsx', { responseType: 'blob' }).then((r) => r.data),
  },
  // A dispute's clock, surcharge, answer to the resolution, group and dossier.
  disputeExtras: {
    meta: () => g('/dispute-extras/meta'),
    overview: () => g('/dispute-extras/overview'),
    get: (id) => g(`/dispute-extras/${id}`),
    respond: (id, body) => p(`/dispute-extras/${id}/respond`, body),
    conclude: (id, note, awarded_amount) => p(`/dispute-extras/${id}/conclude`, { note, awarded_amount }),
    withdraw: (id, note) => p(`/dispute-extras/${id}/withdraw`, { note }),
    link: (ids, title) => p('/dispute-extras/link', { ids, title }),
    dossier: (id, format) => client.get(`/dispute-extras/${id}/dossier.${format}`, { responseType: 'blob' }).then((r) => r.data),
  },
  // Around the signatures of a reconciliation statement.
  reconSignoff: {
    get: (id) => g(`/recon-signoff/${id}`),
    sign: (id, body) => p(`/recon-signoff/${id}/sign`, body),
    resolveException: (id, body) => p(`/recon-signoff/exceptions/${id}/resolve`, body),
    attachSignedCopy: (id, version_id) => p(`/recon-signoff/${id}/signed-copy`, { version_id }),
    statementFile: (id, format) => client.get(`/recon-signoff/${id}/statement.${format}`, { responseType: 'blob' }).then((r) => r.data),
  },
  // A seller's account with SJVN: statement, ageing, payment advice, TDS certificates.
  ledger: {
    statement: (params) => g('/ledger/statement', params),
    sellers: () => g('/ledger/sellers'),
    buyers: () => g('/ledger/buyers'),
    statementFile: (format, params) => client.get(`/ledger/statement.${format}`, { params, responseType: 'blob' }).then((r) => r.data),
    payment: (id) => g(`/ledger/payments/${id}`),
    advicePdf: (id) => client.get(`/ledger/payments/${id}/advice.pdf`, { responseType: 'blob' }).then((r) => r.data),
    tdsCertificates: (params) => g('/ledger/tds-certificates', params),
    fileTdsCertificate: (body) => p('/ledger/tds-certificates', body),
  },
  // A buyer's bills from SJVN, and the payments it tells SJVN about. Finance confirms each one.
  buyerBills: {
    list: (params) => g('/buyer-bills', params),
    exportCsv: (params) => client.get('/buyer-bills/export.csv', { params, responseType: 'blob' }).then((r) => r.data),
    downloadZip: (ids) => client.post('/buyer-bills/download.zip', { ids }, { responseType: 'blob' }).then((r) => r.data),
    acknowledge: (id) => p(`/buyer-bills/${id}/acknowledge`),
    intimations: (params) => g('/buyer-bills/intimations', params),
    notify: (body) => p('/buyer-bills/intimations', body),
    approve: (id) => p(`/buyer-bills/intimations/${id}/approve`),
    returnToMaker: (id, note) => p(`/buyer-bills/intimations/${id}/return-to-maker`, { note }),
    bulkApprove: (ids) => p('/buyer-bills/intimations/bulk-approve', { ids }),
    withdraw: (id, note) => p(`/buyer-bills/intimations/${id}/withdraw`, { note }),
    confirm: (id, body) => p(`/buyer-bills/intimations/${id}/confirm`, body),
    reject: (id, note) => p(`/buyer-bills/intimations/${id}/reject`, { note }),
  },
  // What goes with a seller's invoice: e-invoice reference, signed copy, TDS estimate, hard copy.
  invoiceCompliance: {
    get: (id) => g(`/invoice-compliance/${id}`),
    tdsPreview: (params) => g('/invoice-compliance/tds-preview', params),
    saveEinvoice: (id, body) => p(`/invoice-compliance/${id}/einvoice`, body),
    removeEinvoice: (id) => del(`/invoice-compliance/${id}/einvoice`),
    qr: (id) => g(`/invoice-compliance/${id}/einvoice/qr`),
    attachSigned: (id, version_id) => p(`/invoice-compliance/${id}/signed-copy`, { version_id }),
    dispatchHardcopy: (id, body) => p(`/invoice-compliance/${id}/hardcopy`, body),
    receiveHardcopy: (id, body) => p(`/invoice-compliance/${id}/hardcopy/received`, body),
  },
  // One period's energy as its counterparty sees and answers it.
  energyRecords: {
    analytics: (params) => g('/energy-records/analytics', params),
    get: (id) => g(`/energy-records/${id}`),
    blocks: (id, date) => g(`/energy-records/${id}/blocks`, date ? { date } : undefined),
    blocksXlsx: (id) => client.get(`/energy-records/${id}/blocks.xlsx`, { responseType: 'blob' }).then((r) => r.data),
    blocksTemplate: () => client.get('/energy-records/blocks-template', { responseType: 'blob' }).then((r) => r.data),
    uploadBlocks: (id, file) => {
      const fd = new FormData();
      fd.append('file', file);
      return client.post(`/energy-records/${id}/blocks`, fd).then((r) => r.data);
    },
    attachSource: (id, version_id) => p(`/energy-records/${id}/source-document`, { version_id }),
    respond: (id, body) => p(`/energy-records/${id}/respond`, body),
    resolveObjection: (id, body) => p(`/energy-records/${id}/resolve-objection`, body),
  },
  energyBanking: {
    position: (contractId) => g(`/energy-banking/${contractId}`),
    bank: (body) => p('/energy-banking', body),
    draw: (body) => p('/energy-banking/draw', body),
    settle: (body) => p('/energy-banking/settle', body),
  },
  powerDiversion: {
    list: (params) => g('/power-diversion', params),
    summary: () => g('/power-diversion/summary'),
    create: (body) => p('/power-diversion', body),
    // One server-side step: proceeds set against this PSA's dues, surcharge first.
    recover: (id) => p(`/power-diversion/${id}/recover`, {}),
    billDeficit: (id) => p(`/power-diversion/${id}/bill-deficit`, {}),
    defaultDashboard: () => g('/power-diversion/default-dashboard'),
    pnl: () => g('/power-diversion/pnl'),
    remove: (id) => del(`/power-diversion/${id}`),
  },
  // Money a counterparty paid that no bill could take, held as its advance.
  advances: {
    list: (params) => g('/advances', params),
    get: (id) => g(`/advances/${id}`),
    apply: (id, body) => p(`/advances/${id}/apply`, body),
    refund: (id, body) => p(`/advances/${id}/refund`, body),
  },
  notes: {
    list: (params) => g('/notes', params),
    summary: () => g('/notes/summary'),
    create: (body) => p('/notes', body),
    approve: (id, body) => p(`/notes/${id}/approve`, body || {}),
    reject: (id, reason) => p(`/notes/${id}/reject`, { reason }),
    apply: (id, invoiceId) => p(`/notes/${id}/apply`, { invoice_id: invoiceId }),
    cancel: (id, reason) => p(`/notes/${id}/cancel`, { reason }),
    downloadPdf: (id) => client.get(`/notes/${id}/pdf`, { responseType: 'blob' }).then((res) => res.data),
    cufTrueUp: (contractId, contractYear) => p('/notes/cuf-true-up', { contract_id: contractId, contract_year: contractYear }),
    approvalQueue: () => g('/notes/approval-queue'),
    fromException: (body) => p('/notes/from-exception', body),
  },
  billingTrail: {
    get: (params) => g('/billing-trail', params),
  },
  deviation: {
    list: (params) => g('/deviation', params),
    summary: (params) => g('/deviation/summary', params),
    get: (id) => g(`/deviation/${id}`),
    scrape: (plantCode) => g('/deviation/scrape', { plant_code: plantCode }),
    create: (body) => p('/deviation', body),
    fromDsa: (body) => p('/deviation/from-dsa', body),
    update: (id, body) => put(`/deviation/${id}`, body),
    dispatch: (id, body) => p(`/deviation/${id}/dispatch`, body),
    linkInvoice: (id, body) => p(`/deviation/${id}/link-invoice`, body),
    statementSync: (params) => g('/deviation/statement-sync', params),
    raiseFromStatement: (body) => p('/deviation/raise-from-statement', body),
    poolTracker: () => g('/deviation/pool-tracker'),
    remove: (id) => del(`/deviation/${id}`),
  },
  // NRPC's weekly Deviation Settlement Account: the statement SJVN's DSM bills
  // are raised from, imported whole rather than per plant.
  nrpcDsa: {
    upload: (file) => {
      const fd = new FormData();
      fd.append('file', file);
      return client.post('/nrpc-dsa/upload', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      }).then((r) => r.data);
    },
    accounts: (params) => g('/nrpc-dsa/accounts', params),
    account: (id) => g(`/nrpc-dsa/accounts/${id}`),
    entities: (params) => g('/nrpc-dsa/entities', params),
    entityWeeks: (name, params) => g(`/nrpc-dsa/entities/${encodeURIComponent(name)}/weeks`, params),
    /**
     * Open the statement PDF in a new tab.
     *
     * Fetched rather than linked: the endpoint needs the session token, which a
     * plain href would not carry, so the bytes are pulled and handed to the
     * browser as an object URL.
     */
    openPdf: async (id) => {
      // Asked for as a file, a refusal comes back as a file too — read the reason out of it.
      const res = await client.get(`/nrpc-dsa/accounts/${id}/pdf`, { responseType: 'blob' }).catch(async (err) => {
        let msg = 'Could not open the statement PDF';
        try { msg = JSON.parse(await err.response.data.text()).error || msg; } catch { /* keep the default */ }
        throw new Error(msg);
      });
      if (res.data?.type && res.data.type.includes('json')) {
        const text = await res.data.text();
        let msg = 'Could not open the statement PDF';
        try { msg = JSON.parse(text).error || msg; } catch { /* keep the default */ }
        throw new Error(msg);
      }
      const url = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
      const win = window.open(url, '_blank', 'noopener');
      if (!win) { URL.revokeObjectURL(url); throw new Error('The browser blocked the popup — allow popups for this site.'); }
      // Released once the tab has had time to read it; revoking immediately
      // leaves some browsers with a blank tab.
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    },
  },

  // The exchange's obligation report, and the REC purchase/sale ledger built
  // from it. `upload_` takes the File itself — the report is parsed server-side,
  // so the browser never has to understand the exchange's layout.
  recObligations: {
    ledger: (params) => g('/rec-obligations/ledger', params),
    uploads: () => g('/rec-obligations/uploads'),
    upload: (id) => g(`/rec-obligations/uploads/${id}`),
    upload_: (file, { platform = 'IEX', dry_run = false } = {}) => {
      const form = new FormData();
      form.append('file', file);
      form.append('platform', platform);
      form.append('dry_run', String(!!dry_run));
      return client.post('/rec-obligations/upload', form, { headers: { 'Content-Type': 'multipart/form-data' } }).then((r) => r.data);
    },
    withdraw: (id) => del(`/rec-obligations/uploads/${id}`),
    // One session's sale as the uploaded reports state it, for REC Order. A
    // session with no sale in any report answers 404 with a message, not an
    // error to show as a failure.
    settlementDraft: (tradeDate, platform = 'IEX') => client.get('/rec-obligations/settlement-draft', {
      params: { trade_date: tradeDate, platform },
      validateStatus: (s) => s === 200 || s === 404,
    }).then((r) => r.data),
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
    // The NLDC REC Registry application behind a lot, before the certificates exist.
    followUps: () => g('/rec/follow-ups'),
    registryStep: (id, body) => p(`/rec/${id}/registry`, body),
    uploadDocument: (id, file, docType) => {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('doc_type', docType);
      return client.post(`/rec/${id}/documents`, fd).then((r) => r.data);
    },
    // Fetched through the client rather than linked to, so the download carries
    // the bearer token a plain <a href> would not.
    downloadDocument: (docId) => client.get(`/rec/documents/${docId}/download`, { responseType: 'blob' }).then((r) => r.data),
  },
  noarApi: {
    status: () => g('/noar-api/status'),
    sync: (body) => p('/noar-api/sync', body),
    applications: (params) => g('/noar-api/applications', params),
    application: (applicationNo) => g(`/noar-api/applications/${encodeURIComponent(applicationNo)}`),
    reconciliation: () => g('/noar-api/reconciliation'),
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
    markFiledOutside: (body) => p('/form-iv/mark-filed-outside', body),
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
    // Who owes what, how late it is, and what the lateness has earned.
    paymentMonitoring: (side = 'RECEIVABLE') => g('/reports/payment-monitoring', { side }),
    // Energy against what each contract's capacity could make.
    generationPerformance: (params) => g('/reports/generation-performance', params),
    cufTracker: (params) => g('/reports/cuf-tracker', params),
    // Tenure, commissioning, security and approvals, per contract.
    contractCompliance: (params) => g('/reports/contract-compliance', params),
    // The technical and commercial checks on developer bills, across the desk.
    verificationQueue: (params) => g('/reports/verification-queue', params),
    // Every period that owes CERC a return, including the ones nobody started.
    cercCompliance: (params) => g('/reports/cerc-compliance', params),
    // One period's return sorted into the formats it is filed in (IV-A, IV-B, ...).
    cercAnnexures: (periodType, period) => g('/reports/cerc-compliance/annexures', { period_type: periodType, period }),
    // The same split as the Excel workbook the Commission takes the soft copy in.
    cercAnnexuresXlsx: async (periodType, period) => {
      let res;
      try {
        res = await client.get('/reports/cerc-compliance/annexures/xlsx', {
          params: { period_type: periodType, period }, responseType: 'blob',
        });
      } catch (err) {
        // A refusal comes back as a blob too; read the reason out of it rather
        // than showing "Request failed with status code 400".
        let msg = 'Could not build the Form-IV workbook';
        try { msg = JSON.parse(await err.response.data.text()).error || msg; } catch { /* keep default */ }
        throw new Error(msg);
      }
      if (res.data?.type && res.data.type.includes('json')) {
        let msg = 'Could not build the Form-IV workbook';
        try { msg = JSON.parse(await res.data.text()).error || msg; } catch { /* keep default */ }
        throw new Error(msg);
      }
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url; a.download = `CERC_Form-IV_${period}.xlsx`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    },
    // Annual licence fee and net worth, year by year.
    cercLicence: () => g('/reports/cerc-compliance/licence'),
    saveCercLicence: (fy, body) => put(`/reports/cerc-compliance/licence/${fy}`, body),
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
      a.download = from === 'all' && to === 'all' ? 'SJVN_Energy_Report_all-periods.pdf' : `SJVN_Energy_Report_${from}_to_${to}.pdf`;
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
      a.download = `SJVN_Dispute_Report_${params.status ? `${String(params.status).toLowerCase()}_` : ''}${params.from || params.to ? `${params.from || 'start'}_to_${params.to || 'today'}` : 'all-dates'}.pdf`;
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
    // Several bills for one cause: all raised and linked, or none.
    raiseBatch: (body) => p('/disputes/batch', body),
    transition: (id, status, note) => p(`/disputes/${id}/transition`, { status, note }),
    resolve: (id, body) => p(`/disputes/${id}/resolve`, body),
    comment: (id, body, is_internal = false) => p(`/disputes/${id}/comments`, { body, is_internal }),
    assign: (id, assigned_to) => p(`/disputes/${id}/assign`, { assigned_to }),
    uploadEvidence: (id, file, note) => {
      const fd = new FormData();
      fd.append('file', file);
      if (note) fd.append('note', note);
      return client.post(`/disputes/${id}/evidence`, fd).then((r) => r.data);
    },
    downloadEvidence: (id, filename) => client.get(`/disputes/${id}/evidence/${encodeURIComponent(filename)}`, { responseType: 'blob' }).then((r) => r.data),
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
    board: () => g('/payment-security/board'),
    requestShortfall: (contractId, note) => p(`/payment-security/board/${contractId}/request`, { note }),
    reinstatements: () => g('/payment-security/reinstatements'),
    financeSignoff: (releaseId, note) => p(`/payment-security/releases/${releaseId}/finance-signoff`, { note }),
    overrides: () => g('/payment-security/overrides'),
    invocations: (params) => g('/payment-security/invocations', params),
    create: (body) => p('/payment-security', body),
    fromContract: (contractId) => p(`/payment-security/from-contract/${contractId}`),
    verify: (id, bank_confirmation_ref) => p(`/payment-security/${id}/verify`, { bank_confirmation_ref }),
    utilize: (id, amount, reason) => p(`/payment-security/${id}/utilize`, { amount, reason }),
    replenish: (id, amount, reason) => p(`/payment-security/${id}/replenish`, { amount, reason }),
    renew: (id, body) => p(`/payment-security/${id}/renew`, body),
    invoke: (id, amount) => p(`/payment-security/${id}/invoke`, { amount }),
    startInvocation: (body) => p('/payment-security/invocations', body),
    transitionInvocation: (id, status, notes) => p(`/payment-security/invocations/${id}/transition`, { status, notes }),
    releaseRequest: (id, reason) => p(`/payment-security/${id}/release-request`, { reason }),
    actRelease: (id, decision, note) => p(`/payment-security/releases/${id}/act`, { decision, note }),
    invocationPdf: (id) => client.get(`/payment-security/invocations/${id}/pdf`, { responseType: 'blob' }).then((r) => r.data),
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
    // Agreeing goes through the sign-off route, which records who signed what;
    // disagreeing stays where it was.
    acknowledge: (id, decision, note, remarks) => (decision === 'DISAGREE'
      ? p(`/reconciliation/${id}/acknowledge`, { decision, note, remarks })
      : p(`/recon-signoff/${id}/sign`, { decision, remarks: remarks || note })),
    reopenRequest: (id, reason) => p(`/reconciliation/${id}/reopen-request`, { reason }),
    reopenRequests: () => g('/reconciliation/reopen-requests'),
    actReopen: (id, decision) => p(`/reconciliation/reopen-requests/${id}/act`, { decision }),
    statement: (id, version) => g(`/reconciliation/${id}/statement`, version ? { version } : undefined),
    regenerateStatement: (id) => p(`/reconciliation/${id}/regenerate-statement`),
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
  dsmSlabs: {
    list: (params) => g('/masters/dsm/slabs', params),
    effective: (params) => g('/masters/dsm/slabs/effective', params),
    create: (body) => p('/masters/dsm/slabs', body),
    update: (id, body) => patch(`/masters/dsm/slabs/${id}`, body),
    preview: (body) => p('/masters/dsm/preview', body),
    readiness: () => g('/masters/dsm/readiness'),
  },
  nocUpdation: {
    meta: () => g('/noc-updation/meta'),
    list: (params) => g('/noc-updation', params),
    get: (id) => g(`/noc-updation/${id}`),
    create: (body) => p('/noc-updation', body),
    cancel: (id, body) => patch(`/noc-updation/${id}/cancel`, body),
  },
  clientPortfolios: {
    list: (params) => g('/client-portfolios', params),
    save: (body) => put('/client-portfolios', body),
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
    // The SLDC standing clearance behind a client's bids: its validity, T-GNA,
    // ramp rate, losses and the charges that come with it.
    standingClearance: (clientId) => g(`/bids/standing-clearance/${clientId}`),
    clearancesNeedingAttention: () => g('/bids/standing-clearance'),
  },
  exchangeContracts: {
    list: (params) => g('/exchange-contracts', params),
    get: (id) => g(`/exchange-contracts/${id}`),
    create: (body) => p('/exchange-contracts', body),
    update: (id, body) => put(`/exchange-contracts/${id}`, body),
    // Settlement preview over the cleared bids. Pass bill_type to price one of
    // the three bills instead of returning the raw cleared position.
    settlement: (id, params) => g(`/exchange-contracts/${id}/settlement`, params),
    bids: (id, params) => g(`/exchange-contracts/${id}/bids`, params),
    invoices: (id) => g(`/exchange-contracts/${id}/invoices`),
    generateInvoice: (id, body) => p(`/exchange-contracts/${id}/invoices`, body),
  },
  exchangeBidding: {
    list: (params) => g('/exchange-bidding', params),
    get: (id) => g(`/exchange-bidding/${id}`),
    create: (body) => p('/exchange-bidding', body),
    meta: () => g('/exchange-bidding/meta'),
  },
  exchangeBiddingLatest: {
    list: (params) => g('/exchange-bidding-latest', params),
    get: (id) => g(`/exchange-bidding-latest/${id}`),
    create: (body) => p('/exchange-bidding-latest', body),
    report: (params) => g('/exchange-bidding-latest/report', params),
  },
  iexBidBook: {
    list: (params) => g('/iex-bid-book', params),
  },
  exchangeApplications: {
    list: (params) => g('/exchange-applications', params),
    get: (id) => g(`/exchange-applications/${id}`),
    approve: (id, body) => p(`/exchange-applications/${id}/approve`, body),
    step: (id, body) => p(`/exchange-applications/${id}/step`, body),
  },
  exchangeUpdateCharges: {
    lookup: (application_id) => g('/exchange-update-charges/lookup', { application_id }),
    load: (source, application_id) => g('/exchange-update-charges/load', { source, application_id }),
    save: (body) => p('/exchange-update-charges', body),
  },
  escertOrders: {
    list: (params) => g('/escert-orders', params),
    meta: () => g('/escert-orders/meta'),
    create: (body) => p('/escert-orders', body),
  },
  pxilOrders: {
    list: (params) => g('/pxil-orders', params),
    get: (id) => g(`/pxil-orders/${id}`),
    create: (body) => p('/pxil-orders', body),
    placeBid: (id) => p(`/pxil-orders/${id}/place-bid`),
  },
  // PXIL member report APIs. Read-only; each response carries `mode`, which is
  // STUB until PXIL credentials are configured on the server.
  pxil: {
    status: () => g('/pxil/status'),
    tamGtam: (params) => g('/pxil/tam-gtam', params),
    slotWise: (params) => g('/pxil/slot-wise', params),
    formatD: (params) => g('/pxil/format-d', params),
    memberDor: (params) => g('/pxil/member-dor', params),
    tradeMargin: (params) => g('/pxil/trade-margin', params),
    reverseAuction: () => g('/pxil/reverse-auction'),
  },
  // IEX Front Office API. Read-only; each response carries `mode`, which is
  // STUB until IEX credentials and a base URL are configured on the server.
  iex: {
    status: () => g('/iex/status'),
    connectivity: (params) => g('/iex/connectivity', params),
    decimals: (params) => g('/iex/decimals', params),
    deliveryDates: (params) => g('/iex/delivery-dates', params),
    pqResults: (params) => g('/iex/pq-results', params),
    scheduleReport: (params) => g('/iex/schedule-report', params),
    publishInfo: (params) => g('/iex/publish-info', params),
    // REC and EC/ESCerts share one API; `product` separates the segments.
    recConnectivity: () => g('/iex/rec/connectivity'),
    recProducts: () => g('/iex/rec/products'),
    recOrders: (params) => g('/iex/rec/orders', params),
    recTrades: (params) => g('/iex/rec/trades', params),
  },
  isetReports: {
    meta: () => g('/iset-reports/meta'),
    list: (kind) => g(`/iset-reports/${kind}`),
    noarApplication: (applicationNo) => g(`/iset-reports/noar-approvals/${encodeURIComponent(applicationNo)}`),
    createDailySchedule: (body) => p('/iset-reports/daily-schedule', body),
  },
  recTrading: {
    createOrder: (body) => p('/rec-trading/orders', body),
    listOrders: (params) => g('/rec-trading/orders', params),
    getOrder: (id) => g(`/rec-trading/orders/${id}`),
    orderReport: (params) => g('/rec-trading/orders/report', params),
    listBids: (params) => g('/rec-trading/bids', params),
    bidsMeta: () => g('/rec-trading/bids/meta'),
    createBid: (body) => p('/rec-trading/bids', body),
    getBid: (id) => g(`/rec-trading/bids/${id}`),
    // Sellable certificate position, oldest vintage first.
    inventory: (params) => g('/rec-trading/inventory', params),
    // Maker-checker: whoever raised the bid cannot be the one to clear it.
    approveBid: (id, body) => p(`/rec-trading/bids/${id}/approve`, body),
    // Records what the session cleared and moves the certificates with it.
    executeBid: (id, body) => p(`/rec-trading/bids/${id}/execute`, body),
    cancelBid: (id) => p(`/rec-trading/bids/${id}/cancel`, {}),
  },
  bilateral: {
    list: (params) => g('/bilateral', params),
    get: (id) => g(`/bilateral/${id}`),
    create: (body) => p('/bilateral', body),
    contractReport: (params) => g('/bilateral/contract-report', params),
    createSchedule: (id, body) => p(`/bilateral/${id}/schedules`, body),
    updateApproval: (id, node_type, status) => p(`/bilateral/schedules/${id}/approvals`, { node_type, status }),
    curtail: (id, curtailed_mw) => p(`/bilateral/schedules/${id}/curtail`, { curtailed_mw }),
    recordActuals: (id, actual_mw, grid_frequency_hz) => p(`/bilateral/schedules/${id}/actuals`, { actual_mw, grid_frequency_hz }),
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
    // Settlement preview for a supply period. Pass bill_type to price one of the
    // three bills instead of returning the raw settlement position.
    settlement: (id, params) => g(`/bilateral/${id}/settlement`, params),
    invoices: (id) => g(`/bilateral/${id}/invoices`),
    generateInvoice: (id, body) => p(`/bilateral/${id}/invoices`, body),
    // A rate revised from a date, and power split between buyers.
    rateRevisions: (id) => g(`/bilateral/${id}/rate-revisions`),
    addRateRevision: (id, body) => p(`/bilateral/${id}/rate-revisions`, body),
    removeRateRevision: (id, revisionId) => del(`/bilateral/${id}/rate-revisions/${revisionId}`),
    buyerSplits: (id) => g(`/bilateral/${id}/buyer-splits`),
    setBuyerSplit: (id, body) => put(`/bilateral/${id}/buyer-splits`, body),
    removeBuyerSplit: (id, effectiveFrom) => del(`/bilateral/${id}/buyer-splits/${effectiveFrom}`),
  },
  bilateralBidding: {
    list: (params) => g('/bilateral-bidding', params),
    get: (id) => g(`/bilateral-bidding/${id}`),
    create: (body) => p('/bilateral-bidding', body),
    meta: () => g('/bilateral-bidding/meta'),
    // Turn a submitted application into a bilateral contract. The commercial
    // terms are supplied here — the format-generation form carries no rate.
    createContract: (id, body) => p(`/bilateral-bidding/${id}/contract`, body),
  },
  bilateralApplications: {
    list: (params) => g('/bilateral-applications', params),
    get: (id) => g(`/bilateral-applications/${id}`),
    create: (body) => p('/bilateral-applications', body),
    downloadCsv: (id) => client.get(`/bilateral-applications/${id}/csv`, { responseType: 'blob' }).then((r) => r.data),
    downloadFormatI: (id) => client.get(`/bilateral-applications/${id}/format-i`, { responseType: 'blob' }).then((r) => r.data),
    downloadFormatII: (id, party = 'Buyer') => client.get(`/bilateral-applications/${id}/format-ii`, { params: { party }, responseType: 'blob' }).then((r) => r.data),
  },
  viewBillInvoices: {
    list: (params) => g('/view-bill-invoices', params),
    get: (id) => g(`/view-bill-invoices/${id}`),
    update: (id, body) => put(`/view-bill-invoices/${id}`, body),
    recordPayment: (id, body) => p(`/view-bill-invoices/${id}/payment`, body),
    cancel: (id, body) => p(`/view-bill-invoices/${id}/cancel`, body),
    downloadPdf: (id) => client.get(`/view-bill-invoices/${id}/pdf`, { responseType: 'blob' }).then((r) => r.data),
  },
  csvUploads: {
    meta: () => g('/csv-uploads/meta'),
    list: (params) => g('/csv-uploads', params),
    create: (body) => p('/csv-uploads', body),
    downloadSample: (kind) => client.get(`/csv-uploads/sample/${kind}`, { responseType: 'blob' }).then((r) => r.data),
  },
  // The Bill section: one client-first way in to all six bill types, plus the
  // Bill of Supply register behind the supply-bill screens.
  billing: {
    meta: () => g('/billing/meta'),
    clients: () => g('/billing/clients'),
    contracts: (params) => g('/billing/contracts', params),
    preview: (body) => p('/billing/preview', body),
    generate: (body) => p('/billing/generate', body),
    listBillOfSupply: (params) => g('/billing/bill-of-supply', params),
    getBillOfSupply: (id) => g(`/billing/bill-of-supply/${id}`),
    createBillOfSupply: (body) => p('/billing/bill-of-supply', body),
    cancelBillOfSupply: (id) => p(`/billing/bill-of-supply/${id}/cancel`, {}),
    supplyBillReport: (params) => g('/billing/supply-bill-report', params),
  },
  billingSettlement: {
    listInvoices: (params) => g('/billing-settlement/invoices', params),
    generateInvoice: (body) => p('/billing-settlement/invoices/generate', body),
    getLedger: (clientId) => g(`/billing-settlement/ledger/${clientId}`),
    getSoa: () => g('/billing-settlement/soa'),
    nettingPreview: (params) => g('/billing-settlement/netting/preview', params),
    applyNetting: (body) => p('/billing-settlement/netting', body),
  },
  generatorBilling: {
    list: (params) => g('/generator-billing', params),
    generate: (body) => p('/generator-billing/generate', body),
    updateStatus: (id, status) => p(`/generator-billing/${id}/status`, { status }),
  },
  thermal: {
    stations: () => g('/thermal/stations'),
    createStation: (body) => p('/thermal/stations', body),
    tariffs: (contractId) => g('/thermal/tariffs', { contract_id: contractId }),
    setTariff: (body) => p('/thermal/tariffs', body),
    ecrPreview: (body) => p('/thermal/ecr-preview', body),
  },
  // The hydro desk after a bill is out: disputes, LC, balance confirmation, TDS.
  hydroDesk: {
    disputeReasons: () => g('/hydro-desk/disputes/reasons'),
    disputeShares: (params) => g('/hydro-desk/disputes/shares', params),
    disputes: (params) => g('/hydro-desk/disputes', params),
    dispute: (id) => g(`/hydro-desk/disputes/${id}`),
    raiseDispute: (body) => p('/hydro-desk/disputes', body),
    moveDispute: (id, body) => p(`/hydro-desk/disputes/${id}/move`, body),
    disputeComments: (id) => g(`/hydro-desk/disputes/${id}/comments`),
    addDisputeComment: (id, body, is_internal) => p(`/hydro-desk/disputes/${id}/comments`, { body, is_internal }),
    disputeStats: (params) => g('/hydro-desk/disputes/stats', params),
    security: (params) => g('/hydro-desk/security', params),
    securityEvents: (id) => g(`/hydro-desk/security/${id}/events`),
    addSecurity: (body) => p('/hydro-desk/security', body),
    amendSecurity: (id, body) => p(`/hydro-desk/security/${id}/amend`, body),
    invokeSecurity: (id, body) => p(`/hydro-desk/security/${id}/invoke`, body),
    releaseSecurity: (id, body) => p(`/hydro-desk/security/${id}/release`, body),
    reconciliations: (params) => g('/hydro-desk/reconciliations', params),
    createReconciliation: (body) => p('/hydro-desk/reconciliations', body),
    moveReconciliation: (id, body) => p(`/hydro-desk/reconciliations/${id}/move`, body),
    reconciliationPdf: (id, no) => api.reports.downloadPdf(`/hydro-desk/reconciliations/${id}/pdf`, `${String(no || id).replace(/[^\w.-]+/g, '_')}.pdf`),
    tdsSections: () => g('/hydro-desk/tds/sections'),
    tds: (params) => g('/hydro-desk/tds', params),
    recordTds: (body) => p('/hydro-desk/tds', body),
    tdsCertificate: (id, body) => p(`/hydro-desk/tds/${id}/certificate`, body),
  },
  hydroBilling: {
    dashboard: () => g('/hydro-billing/dashboard'),
    stations: (params) => g('/hydro-billing/stations', params),
    list: (params) => g('/hydro-billing', params),
    get: (id) => g(`/hydro-billing/${id}`),
    preview: (body) => p('/hydro-billing/preview', body),
    create: (body) => p('/hydro-billing', body),
    fromRea: (body) => p('/hydro-billing/from-rea', body),
    fromReaJob: (id) => g(`/hydro-billing/from-rea/jobs/${id}`),
    uploadRea: (formData) => client.post('/hydro-billing/upload-rea', formData, { headers: { 'Content-Type': 'multipart/form-data' } }).then((r) => r.data),
    autoDraft: () => g('/hydro-billing/from-rea/auto'),
    issue: (id, body) => p(`/hydro-billing/${id}/issue`, body || {}),
    cancel: (id, reason) => p(`/hydro-billing/${id}/cancel`, { reason }),
    allocations: (params) => g('/hydro-billing/allocations', params),
    createAllocation: (body) => p('/hydro-billing/allocations', body),
    replaceAllocations: (body) => p('/hydro-billing/allocations/bulk', body),
    // Approval chain
    approvers: (params) => g('/hydro-billing/approvers', params),
    inbox: () => g('/hydro-billing/approvals/inbox'),
    sendForApproval: (id, body) => p(`/hydro-billing/${id}/send-for-approval`, body),
    act: (id, body) => p(`/hydro-billing/${id}/approve`, body),
    approvals: (id) => g(`/hydro-billing/${id}/approvals`),
    // Beneficiary ledger (Account Display)
    accounts: (params) => g('/hydro-billing/ledger/accounts', params),
    ledger: (params) => g('/hydro-billing/ledger', params),
    pay: (body) => p('/hydro-billing/ledger/payment', body),
    reversePayment: (docId, reason) => p(`/hydro-billing/ledger/${docId}/reverse-payment`, { reason }),
    resetClearing: (docId) => p(`/hydro-billing/ledger/${docId}/reset-clearing`, {}),
    accountMaintenance: (docId, body) => p(`/hydro-billing/ledger/${docId}/account-maintenance`, body || {}),
    lpsPreview: (params) => g('/hydro-billing/ledger/lps', params),
    postLps: (body) => p('/hydro-billing/ledger/lps', body),
    // Debit / credit notes on a beneficiary's account (maker-checker).
    notes: (params) => g('/hydro-billing/notes', params),
    raiseNote: (body) => p('/hydro-billing/notes', body),
    approveNote: (id) => p(`/hydro-billing/notes/${id}/approve`, {}),
    rejectNote: (id, reason) => p(`/hydro-billing/notes/${id}/reject`, { reason }),
    // Release, print and despatch. The PDF goes through the shared downloader so
    // it carries the auth header and unwraps a JSON error into a real message.
    release: (id) => p(`/hydro-billing/${id}/release`, {}),
    downloadPdf: (id, billNo) =>
      api.reports.downloadPdf(`/hydro-billing/${id}/pdf`, `${String(billNo || id).replace(/[^\w.-]+/g, '_')}.pdf`),
    // Each beneficiary's own bill, one page apiece, in a single PDF.
    downloadBeneficiaryBills: (id, billNo) =>
      api.reports.downloadPdf(`/hydro-billing/${id}/beneficiary-bills/pdf`, `${String(billNo || id).replace(/[^\w.-]+/g, '_')}_beneficiary_bills.pdf`),
    // Emailing the bill to its beneficiaries, and the record of each send.
    recipients: (id) => g(`/hydro-billing/${id}/recipients`),
    send: (id, body) => p(`/hydro-billing/${id}/send`, body || {}),
    deliveries: (id) => g(`/hydro-billing/${id}/deliveries`),
    dispatch: (id, body) => p(`/hydro-billing/${id}/dispatch`, body),
    // Taking a bill back out of approval, and the two kinds of bill on months already billed.
    recall: (id, reason) => p(`/hydro-billing/${id}/recall`, { reason }),
    arrearPreview: (body) => p('/hydro-billing/arrears/preview', body),
    createArrear: (body) => p('/hydro-billing/arrears', body),
    supplementaryReasons: () => g('/hydro-billing/supplementary/reasons'),
    createSupplementary: (body) => p('/hydro-billing/supplementary', body),
    tariffs: (contractId) => g('/hydro-billing/tariffs', { contract_id: contractId }),
    receivables: (params) => g('/hydro-billing/receivables', params),
    setTariff: (body) => p('/hydro-billing/tariffs', body),
    // Additional charges and TCS
    charges: (params) => g('/hydro-billing/charges', params),
    addCharge: (body) => p('/hydro-billing/charges', body),
    claimCharges: (body) => p('/hydro-billing/charges/claim', body),
    tcsClaims: (params) => g('/hydro-billing/tcs', params),
    previewTcs: (body) => p('/hydro-billing/tcs/preview', body),
    claimTcs: (body) => p('/hydro-billing/tcs', body),
    // FI integration — the month-end handover to corporate Finance
    fiPostings: (params) => g('/hydro-billing/fi', params),
    fiBookable: (params) => g('/hydro-billing/fi/bookable', params),
    fiPosting: (id) => g(`/hydro-billing/fi/${id}`),
    fiPrepare: (body) => p('/hydro-billing/fi/prepare', body),
    fiPost: (id, body) => p(`/hydro-billing/fi/${id}/post`, body || {}),
    fiReverse: (id, reason) => p(`/hydro-billing/fi/${id}/reverse`, { reason }),
    // Power trading (PTC)
    ptcBills: (params) => g('/hydro-billing/ptc', params),
    ptcConsolidate: (body) => p('/hydro-billing/ptc/consolidate', body),
    createPtc: (body) => p('/hydro-billing/ptc', body),
    updateAllocation: (id, body) => patch(`/hydro-billing/allocations/${id}`, body),
  },
  // In-portal mail. Nothing here leaves the portal.
  mail: {
    list: (params) => g('/mail', params),
    get: (id) => g(`/mail/${id}`),
    unreadCount: () => g('/mail/unread-count'),
    directory: (q) => g('/mail/directory', { q }),
    send: ({ to, cc, bcc, subject, body, bodyHtml, replyTo, files, forwardAttachments, draftId }) => {
      const fd = new FormData();
      fd.append('to', JSON.stringify(to || []));
      fd.append('cc', JSON.stringify(cc || []));
      fd.append('bcc', JSON.stringify(bcc || []));
      fd.append('subject', subject || '');
      fd.append('body', body || '');
      if (bodyHtml) fd.append('body_html', bodyHtml);
      if (replyTo) fd.append('reply_to', replyTo);
      if (forwardAttachments?.length) fd.append('forward_attachments', JSON.stringify(forwardAttachments));
      if (draftId) fd.append('draft_id', draftId);
      for (const f of files || []) fd.append('files', f);
      return client.post('/mail', fd, { headers: { 'Content-Type': 'multipart/form-data' } }).then((r) => r.data);
    },
    drafts: (params) => g('/mail/drafts', params),
    createDraft: (body) => p('/mail/drafts', body),
    updateDraft: (id, body) => client.put(`/mail/drafts/${id}`, body).then((r) => r.data),
    removeDraft: (id) => del(`/mail/drafts/${id}`),
    settings: () => g('/mail/settings'),
    saveSettings: (body) => client.put('/mail/settings', body).then((r) => r.data),
    setRead: (id, read) => p(`/mail/${id}/read`, { read }),
    setArchived: (id, archived) => p(`/mail/${id}/archive`, { archived }),
    setStarred: (id, starred) => p(`/mail/${id}/star`, { starred }),
    remove: (id) => del(`/mail/${id}`),
    restore: (id) => p(`/mail/${id}/restore`),
    purge: (id) => del(`/mail/${id}?forever=1`),
    bulk: (ids, action) => p('/mail/bulk', { ids, action }),
    addDraftFiles: (id, files) => {
      const fd = new FormData();
      for (const f of files) fd.append('files', f);
      return client.post(`/mail/drafts/${id}/files`, fd, { headers: { 'Content-Type': 'multipart/form-data' } }).then((r) => r.data);
    },
    removeDraftFile: (id, fileId) => del(`/mail/drafts/${id}/files/${fileId}`),
    attachment: (id) => client.get(`/mail/attachments/${id}`, { responseType: 'blob' }).then((r) => r.data),
  },
  // REIA's month-end handover to corporate Finance (the hydro one is under
  // hydroBilling.fi*).
  reiaFi: {
    postings: (params) => g('/reia-fi', params),
    bookable: (params) => g('/reia-fi/bookable', params),
    checklist: (period) => g('/reia-fi/checklist', { period_month: period }),
    posting: (id) => g(`/reia-fi/${id}`),
    prepare: (body) => p('/reia-fi/prepare', body),
    post: (id, body) => p(`/reia-fi/${id}/post`, body || {}),
    reverse: (id, reason) => p(`/reia-fi/${id}/reverse`, { reason }),
  },
  marketAnalytics: {
    getRates: (params) => g('/market-analytics/rates', params),
    getSummary: (params) => g('/market-analytics/summary', params),
    getTrend: (params) => g('/market-analytics/trend', params),
    getLatestPrices: () => g('/market-analytics/latest-prices'),
    getBlocks: (params) => g('/market-analytics/blocks', params),
    bidVsCleared: (params) => g('/market-analytics/bid-vs-cleared', params),
    getContext: (params) => g('/market-analytics/context', params),
    getAlerts: () => g('/market-analytics/alerts'),
    createAlert: (body) => p('/market-analytics/alerts', body),
    toggleAlert: (id, is_active) => patch(`/market-analytics/alerts/${id}`, { is_active }),
    deleteAlert: (id) => del(`/market-analytics/alerts/${id}`),
  },
  marketForecast: {
    series: () => g('/market-forecast/series'),
    runs: (params) => g('/market-forecast/runs', params),
    run: (id, params) => g(`/market-forecast/runs/${id}`, params),
    createRun: (body) => p('/market-forecast/runs', body),
    accuracy: (params) => g('/market-forecast/accuracy', params),
    forDate: (params) => g('/market-forecast/for-date', params),
    exportRun: (id) => client.get(`/market-forecast/runs/${id}/export`, { responseType: 'blob' }).then((r) => r.data),
    priceFileTemplate: () => client.get('/market-forecast/actuals/template', { responseType: 'blob' }).then((r) => r.data),
    uploadPrices: ({ file, exchange, product, date }) => {
      const form = new FormData();
      form.append('file', file);
      form.append('exchange', exchange);
      form.append('product', product);
      if (date) form.append('date', date);
      return client.post('/market-forecast/actuals/upload', form, { headers: { 'Content-Type': 'multipart/form-data' } }).then((r) => r.data);
    },
  },
  dashboard: {
    reia: () => g('/dashboard/reia'),
    trading: {
      realtime: () => g('/dashboard/trading/realtime'),
      daily: () => g('/dashboard/trading/daily'),
      periodic: () => g('/dashboard/trading/periodic'),
      analytics: () => g('/dashboard/trading/analytics'),
      health: () => g('/dashboard/trading/health'),
    },
    consolidated: () => g('/dashboard/consolidated'),
  },
  // A seller's or buyer's landing page: what is waiting, where the money stands, what is coming up.
  home: {
    get: (period) => g('/home', period ? { period } : undefined),
    summaryPdf: (period) => client.get('/home/summary.pdf', { params: period ? { period } : undefined, responseType: 'blob' }).then((r) => r.data),
  },
  sellerDashboard: () => g('/seller-dashboard'),
  // A client's own requests to the desk: raised by its maker, cleared by its
  // checker, acted on by the desk.
  clientBidRequests: {
    list: (params) => g('/client-bid-requests', params),
    get: (id) => g(`/client-bid-requests/${id}`),
    raise: (body) => p('/client-bid-requests', body),
    check: (id, body) => p(`/client-bid-requests/${id}/check`, body),
    withdraw: (id, body) => p(`/client-bid-requests/${id}/withdraw`, body),
    place: (id, body) => p(`/client-bid-requests/${id}/place`, body),
  },
  tradingClient: {
    summary: (params) => g('/trading-client/summary', params),
  },
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
    list: async (role) => {
      // Only the trading desk may read clearances. Asking on everyone's behalf
      // drew a 403 for every other role on every page and every 20-second
      // refresh — and each refusal is written to the audit log as ACCESS_DENIED,
      // burying real refusals under the bell's own.
      const [serverNotifs, clearance] = await Promise.all([
        g('/notifications').catch(() => []),
        ROLE_GROUPS.TRADING_ALL.includes(role) ? g('/bids/standing-clearance').catch(() => null) : null,
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
    markAllRead: async (notifs = []) => {
      try {
        const dismissed = JSON.parse(localStorage.getItem('sjvn_clearance_dismissed') || '[]');
        const toDismiss = new Set(dismissed);
        (notifs || []).forEach((n) => {
          if (String(n.id).startsWith('clearance-')) {
            toDismiss.add(n.id);
          }
        });
        try {
          const clearance = await g('/bids/standing-clearance');
          if (clearance) {
            (clearance.expired || []).forEach((c) => toDismiss.add(`clearance-expired-${c.client_id}`));
            (clearance.renewal_due || []).forEach((c) => toDismiss.add(`clearance-renewal-${c.client_id}`));
          }
        } catch {
          // Ignore if role lacks permission
        }
        localStorage.setItem('sjvn_clearance_dismissed', JSON.stringify([...toDismiss]));
      } catch (e) {
        console.warn('Could not update sjvn_clearance_dismissed in localStorage', e);
      }

      const serverIds = (notifs || [])
        .filter((n) => !String(n.id).startsWith('clearance-'))
        .map((n) => n.id);

      return p('/notifications/read-all', { ids: serverIds });
    },
    testEmail: () => p('/notifications/test-email'),
  },
  alerts: {
    board: () => g('/alerts/board'),
    acknowledge: (kind, key) => p('/alerts/board/ack', { kind, key }),
    unacknowledge: (kind, key) => p('/alerts/board/unack', { kind, key }),
    history: (params) => g('/alerts/history', params),
    preferences: () => g('/alerts/preferences'),
    savePreferences: (body) => put('/alerts/preferences', body),
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
    obligations: (params) => g('/trading/schedules/obligations', params),
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
    approve: (id, body) => p(`/trading-notes/${id}/approve`, body || {}),
    reject: (id, reason) => p(`/trading-notes/${id}/reject`, { reason }),
    settle: (id, body) => p(`/trading-notes/${id}/settle`, body),
    cancel: (id, body) => p(`/trading-notes/${id}/cancel`, body),
  },
  auditLogs: {
    list: (params) => g('/audit-logs', params),
    get: (id) => g(`/audit-logs/${id}`),
    facets: (params) => g('/audit-logs/facets', params),
    summary: (params) => g('/audit-logs/summary', params),
    integrity: () => g('/audit-logs/integrity'),
    verifyIntegrity: () => p('/audit-logs/verify-integrity'),
    violationsSod: () => g('/audit-logs/violations/sod'),
    logExport: (body) => p('/audit-logs/log-export', body),
    // The server writes the export to the trail before sending the file.
    exportCsv: async (params) => {
      const res = await client.get('/audit-logs/export.csv', { params, responseType: 'blob' });
      const url = URL.createObjectURL(new Blob([res.data], { type: 'text/csv' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `SJVN_Audit_Trail_${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      return {
        rows: Number(res.headers['x-export-rows'] || 0),
        truncated: res.headers['x-export-truncated'] ? Number(res.headers['x-export-truncated']) : null,
      };
    },
  },
  cercMarket: {
    getSummary: (period) => g(period ? `/cerc-market/summary/${period}` : '/cerc-market/summary'),
    // `g` already wraps its second argument as axios `params`; these used to wrap
    // it again, so ?period never reached the server and every month showed the latest.
    getPrices: (params) => g('/cerc-market/prices', params),
    getVolumes: (params) => g('/cerc-market/volumes', params),
    getDailyTrend: (params) => g('/cerc-market/daily-trend', params),
    getDsm: (params) => g('/cerc-market/dsm', params),
    getRec: (params) => g('/cerc-market/rec', params),
    marketMonth: (period) => g('/cerc-market/market-month', period ? { period } : undefined),
    volumeHistory: () => g('/cerc-market/volume-history'),
    // Who traded: segment is TRADING_LICENSEE / BILATERAL / DAM / GDAM / HP-DAM / RTM,
    // side SELL / BUY (ALL for licensees). Term-ahead market is TAM / GTAM / HP-TAM.
    participants: (params) => g('/cerc-market/participants', params),
    concentrationHistory: (params) => g('/cerc-market/concentration-history', params),
    termAhead: (params) => g('/cerc-market/term-ahead', params),
    getPeriods: () => g('/cerc-market/periods'),
    getFetchLog: () => g('/cerc-market/fetch-log'),
    triggerFetch: (period) => p('/cerc-market/trigger', { period }),
    triggerScan: () => p('/cerc-market/scan'),
  },
};

export default api;
