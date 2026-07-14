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
  auth: {
    login: (email, password) => p('/auth/login', { email, password }),
    me: () => g('/auth/me'),
  },
  entities: {
    list: (params) => g('/entities', params),
    get: (id) => g(`/entities/${id}`),
    create: (body) => p('/entities', body),
    update: (id, body) => put(`/entities/${id}`, body),
    approve: (id, decision, remarks) => p(`/entities/${id}/approve`, { decision, remarks }),
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
  },
  invoices: {
    list: (params) => g('/invoices', params),
    get: (id) => g(`/invoices/${id}`),
    generate: (body) => p('/invoices/generate', body),
    submit: (body) => p('/invoices', body),
    submitForApproval: (id) => p(`/invoices/${id}/submit-for-approval`),
    act: (id, level, decision, comments) => p(`/invoices/${id}/approvals/${level}/act`, { decision, comments }),
    send: (id) => p(`/invoices/${id}/send`),
    recordPayment: (id, body) => p(`/invoices/${id}/payments`, body),
  },
  disputes: {
    list: (params) => g('/disputes', params),
    create: (body) => p('/disputes', body),
    setStatus: (id, status) => p(`/disputes/${id}/status`, { status }),
    resolve: (id, body) => p(`/disputes/${id}/resolve`, body),
  },
  paymentSecurity: {
    list: (params) => g('/payment-security', params),
    expiring: (days) => g('/payment-security/expiring', { days }),
    create: (body) => p('/payment-security', body),
    renew: (id, body) => p(`/payment-security/${id}/renew`, body),
    invoke: (id, amount) => p(`/payment-security/${id}/invoke`, { amount }),
  },
  reconciliation: {
    list: (params) => g('/reconciliation', params),
    run: (body) => p('/reconciliation/run', body),
    resolve: (id, notes) => p(`/reconciliation/${id}/resolve`, { notes }),
  },
  tradingClients: {
    list: (params) => g('/trading-clients', params),
    get: (id) => g(`/trading-clients/${id}`),
    create: (body) => p('/trading-clients', body),
    update: (id, body) => put(`/trading-clients/${id}`, body),
  },
  bids: {
    list: (params) => g('/bids', params),
    validate: (body) => p('/bids/validate', body),
    create: (body) => p('/bids', body),
    update: (id, body) => put(`/bids/${id}`, body),
    cancel: (id) => p(`/bids/${id}/cancel`),
    remove: (id) => del(`/bids/${id}`),
    clear: (id, body) => p(`/bids/${id}/clear`, body),
  },
  bilateral: {
    list: (params) => g('/bilateral', params),
    create: (body) => p('/bilateral', body),
    openAccess: (id, decision) => p(`/bilateral/${id}/open-access`, { decision }),
    schedule: (id, schedule_status) => p(`/bilateral/${id}/schedule`, { schedule_status }),
  },
  tradingInvoices: {
    list: (params) => g('/trading-invoices', params),
    get: (id) => g(`/trading-invoices/${id}`),
    generate: (body) => p('/trading-invoices/generate', body),
    send: (id) => p(`/trading-invoices/${id}/send`),
    recordPayment: (id, body) => p(`/trading-invoices/${id}/payments`, body),
  },
  marketRates: {
    list: (params) => g('/market-rates', params),
  },
  dashboard: {
    reia: () => g('/dashboard/reia'),
    trading: () => g('/dashboard/trading'),
    consolidated: () => g('/dashboard/consolidated'),
  },
  sellerDashboard: () => g('/seller-dashboard'),
  buyerDashboard: () => g('/buyer-dashboard'),
  notifications: {
    list: () => g('/notifications'),
    markRead: (id) => p(`/notifications/${id}/read`),
    markAllRead: () => p('/notifications/read-all'),
  },
  auditLogs: {
    list: (params) => g('/audit-logs', params),
  },
};

export default api;
