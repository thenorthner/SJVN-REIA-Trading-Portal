/**
 * Global Notification Routing & Deep-Linking Engine
 * 
 * Maps any notification (in-app, server-generated, or compliance alert)
 * to its exact action destination across the platform, like native mobile app notifications.
 */

/**
 * Resolves a notification to its action target route and CTA label.
 * @param {object} n Notification object ({ id, type, message, link, created_at, ... })
 * @param {object} user Signed-in user profile ({ role, id, ... })
 * @returns {{ url: string, label: string, isMail?: boolean }}
 */
export function getNotificationAction(n, user) {
  if (!n) return { url: '/', label: 'View →' };

  // 1. Explicit deep-link stored with notification
  if (n.link && typeof n.link === 'string' && n.link.trim()) {
    return {
      url: n.link.trim(),
      label: getActionLabel(n.type, n.message),
    };
  }

  const type = String(n.type || '').toUpperCase();
  const msg = String(n.message || '');
  const role = String(user?.role || '');
  const isSeller = role.startsWith('SELLER');
  const isBuyer = role.startsWith('BUYER');
  const isTradingClient = ['TRADING_CLIENT', 'CLIENT_TRADER', 'CLIENT_VIEWER'].includes(role);
  const isThermalUser = ['THERMAL_ADMIN', 'THERMAL_USER'].includes(role);
  const isHydroUser = ['COMMERCIAL_ADMIN', 'COMMERCIAL', 'HYDRO_ADMIN', 'HYDRO_USER'].includes(role);

  // Extract common reference numbers from notification text
  const billNoMatch = msg.match(/\b(HB\/\d{4}\/\d+|SB\/\d{4}\/\d+|INV\/\d{4}\/\d+|[A-Z0-9-_\/]+(?:bill|invoice)[A-Z0-9-_\/]*)\b/i)
    || msg.match(/(?:bill|invoice)\s+([A-Z0-9_\/-]+)/i);
  const billNo = billNoMatch ? (billNoMatch[1] || billNoMatch[0]) : null;

  const disputeMatch = msg.match(/\b(DSP-[A-Z0-9-]+)\b/i) || msg.match(/(?:dispute)\s+([A-Z0-9_\/-]+)/i);
  const disputeNo = disputeMatch ? (disputeMatch[1] || disputeMatch[0]) : null;

  const reconMatch = msg.match(/\b(REC-[A-Z0-9-]+)\b/i) || msg.match(/(?:recon|reconciliation)\s+([A-Z0-9_\/-]+)/i);
  const reconNo = reconMatch ? (reconMatch[1] || reconMatch[0]) : null;

  const contractMatch = msg.match(/\b(PPA\/[A-Z0-9-_\/]+|PSA\/[A-Z0-9-_\/]+|CON-[A-Z0-9-]+)\b/i);
  const contractNo = contractMatch ? contractMatch[0] : null;

  // ----------------------------------------------------
  // A. HYDRO & THERMAL STATION BILLING & APPROVALS
  // ----------------------------------------------------
  if (
    type.includes('HYDRO') ||
    type.includes('THERMAL') ||
    msg.toLowerCase().includes('hydro bill') ||
    msg.toLowerCase().includes('thermal bill')
  ) {
    if (type === 'HYDRO_DISPUTE' || msg.toLowerCase().includes('dispute')) {
      return {
        url: isThermalUser ? '/thermal/disputes' : '/hydro-thermal/disputes',
        label: 'View Dispute →',
      };
    }
    if (type.includes('NOTE') || msg.toLowerCase().includes('credit note') || msg.toLowerCase().includes('debit note')) {
      return {
        url: isThermalUser ? '/thermal/notes' : '/hydro-thermal/notes',
        label: 'Review Note →',
      };
    }
    if (
      type === 'HYDRO_BILL_FOR_APPROVAL' ||
      msg.toLowerCase().includes('pending your approval') ||
      msg.toLowerCase().includes('for approval')
    ) {
      const base = isThermalUser ? '/thermal/billing' : '/hydro-thermal/hydro-billing';
      return {
        url: billNo ? `${base}?bill_no=${encodeURIComponent(billNo)}` : base,
        label: 'Review & Approve →',
      };
    }
    if (type === 'HYDRO_BILL_APPROVED' || msg.toLowerCase().includes('approved and can be issued')) {
      const base = isThermalUser ? '/thermal/billing' : '/hydro-thermal/hydro-billing';
      return {
        url: billNo ? `${base}?bill_no=${encodeURIComponent(billNo)}` : base,
        label: 'Issue Bill →',
      };
    }
    if (type === 'HYDRO_BILL_REJECTED' || msg.toLowerCase().includes('rejected in approval')) {
      const base = isThermalUser ? '/thermal/billing' : '/hydro-thermal/hydro-billing';
      return {
        url: billNo ? `${base}?bill_no=${encodeURIComponent(billNo)}` : base,
        label: 'View Rejection →',
      };
    }
    if (
      type === 'HYDRO_BILL_ISSUED' ||
      type === 'HYDRO_BILL_REVISED' ||
      msg.toLowerCase().includes('is issued') ||
      msg.toLowerCase().includes('has been revised')
    ) {
      if (isBuyer || isSeller) {
        return {
          url: '/hydro-thermal/hydro-ledger',
          label: 'View Statement →',
        };
      }
      return {
        url: isThermalUser ? '/thermal/billing' : '/hydro-thermal/hydro-billing',
        label: 'View Bill →',
      };
    }
    return {
      url: isThermalUser ? '/thermal/billing' : '/hydro-thermal/hydro-billing',
      label: 'Open Billing →',
    };
  }

  // ----------------------------------------------------
  // B. INVOICES & BILLING (REIA & COUNTERPARTIES)
  // ----------------------------------------------------
  if (
    type.includes('INVOICE') ||
    type.includes('ARREAR') ||
    type.includes('SUPPLEMENTARY') ||
    msg.toLowerCase().includes('invoice') ||
    msg.toLowerCase().includes('arrear bill')
  ) {
    if (isSeller) {
      return {
        url: billNo ? `/seller/invoices?invoice_no=${encodeURIComponent(billNo)}` : '/seller/invoices',
        label: 'View Invoice →',
      };
    }
    if (isBuyer) {
      return {
        url: billNo ? `/buyer/invoices?invoice_no=${encodeURIComponent(billNo)}` : '/buyer/invoices',
        label: 'View Bill →',
      };
    }
    return {
      url: billNo ? `/reia/invoices?invoice_no=${encodeURIComponent(billNo)}` : '/reia/invoices',
      label: type === 'INVOICE_SUBMITTED' ? 'Review Invoice →' : 'View Invoices →',
    };
  }

  // ----------------------------------------------------
  // C. PAYMENTS & REALIZATIONS
  // ----------------------------------------------------
  if (type.includes('PAYMENT') || msg.toLowerCase().includes('payment released') || msg.toLowerCase().includes('payment received')) {
    if (isSeller) return { url: '/seller/payments', label: 'View Payments →' };
    if (isBuyer) return { url: '/buyer/payments', label: 'View Payments →' };
    return { url: '/reia/invoices', label: 'View Invoices →' };
  }

  // ----------------------------------------------------
  // D. DISPUTES
  // ----------------------------------------------------
  if (type.includes('DISPUTE') || msg.toLowerCase().includes('dispute')) {
    if (isSeller) return { url: disputeNo ? `/seller/disputes?id=${encodeURIComponent(disputeNo)}` : '/seller/disputes', label: 'View Dispute →' };
    if (isBuyer) return { url: disputeNo ? `/buyer/disputes?id=${encodeURIComponent(disputeNo)}` : '/buyer/disputes', label: 'View Dispute →' };
    return { url: disputeNo ? `/reia/disputes?id=${encodeURIComponent(disputeNo)}` : '/reia/disputes', label: 'Resolve Dispute →' };
  }

  // ----------------------------------------------------
  // E. RECONCILIATION
  // ----------------------------------------------------
  if (type.includes('RECON') || msg.toLowerCase().includes('reconciliation') || msg.toLowerCase().includes('disputed by') || msg.toLowerCase().includes('reopened')) {
    if (isSeller) return { url: '/seller/reconciliation', label: 'View Reconciliation →' };
    if (isBuyer) return { url: '/buyer/reconciliation', label: 'View Reconciliation →' };
    return { url: reconNo ? `/reia/reconciliation?recon_no=${encodeURIComponent(reconNo)}` : '/reia/reconciliation', label: 'Review Recon →' };
  }

  // ----------------------------------------------------
  // F. PAYMENT SECURITY (LC / BG)
  // ----------------------------------------------------
  if (type.includes('SECURITY') || msg.toLowerCase().includes('letter of credit') || msg.toLowerCase().includes('bank guarantee') || msg.toLowerCase().includes('payment security')) {
    if (isSeller) return { url: '/seller/payment-security', label: 'View Security →' };
    if (isBuyer) return { url: '/buyer/payment-security', label: 'View Security →' };
    return { url: '/reia/payment-security', label: 'Review Security →' };
  }

  // ----------------------------------------------------
  // G. ENERGY DATA & SEA / REA
  // ----------------------------------------------------
  if (type.includes('ENERGY') || type.includes('REA_SCRAPER') || msg.toLowerCase().includes('energy data') || msg.toLowerCase().includes('jmr') || msg.toLowerCase().includes('sldc')) {
    if (isSeller) return { url: '/seller/energy-data', label: 'View Energy →' };
    if (isBuyer) return { url: '/buyer/energy-data', label: 'View Energy →' };
    return { url: '/reia/energy-data', label: 'View Energy Data →' };
  }

  // ----------------------------------------------------
  // H. DSM & SCHEDULE DEVIATIONS
  // ----------------------------------------------------
  if (type.includes('DSM') || type.includes('DEVIATION') || msg.toLowerCase().includes('deviation settlement')) {
    if (isThermalUser) return { url: '/thermal/dsm', label: 'View Deviation →' };
    if (isHydroUser) return { url: '/hydro-thermal/dsm', label: 'View Deviation →' };
    if (role.startsWith('TRADING')) return { url: '/trading/deviations', label: 'View Deviation →' };
    return { url: '/reia/deviation', label: 'View DSM Settlement →' };
  }

  // ----------------------------------------------------
  // I. ONBOARDING & REGULATORY VERIFICATION
  // ----------------------------------------------------
  if (type.includes('ONBOARDING') || type.includes('RISK') || msg.toLowerCase().includes('onboarding') || msg.toLowerCase().includes('stakeholder')) {
    return { url: '/reia/entities', label: 'Review Onboarding →' };
  }
  if (type.includes('DOCUMENT') || msg.toLowerCase().includes('document') || msg.toLowerCase().includes('kyc') || msg.toLowerCase().includes('certificate')) {
    if (isSeller) return { url: '/seller/documents', label: 'My Documents →' };
    if (isBuyer) return { url: '/buyer/documents', label: 'My Documents →' };
    return { url: '/reia/document-desk', label: 'Review Documents →' };
  }

  // ----------------------------------------------------
  // J. CONTRACTS
  // ----------------------------------------------------
  if (type.includes('CONTRACT') || msg.toLowerCase().includes('contract') || msg.toLowerCase().includes('ppa') || msg.toLowerCase().includes('psa')) {
    if (isSeller) return { url: contractNo ? `/seller/contracts?contract_no=${encodeURIComponent(contractNo)}` : '/seller/contracts', label: 'View Contract →' };
    if (isBuyer) return { url: contractNo ? `/buyer/contracts?contract_no=${encodeURIComponent(contractNo)}` : '/buyer/contracts', label: 'View Contract →' };
    return { url: contractNo ? `/reia/contracts?contract_no=${encodeURIComponent(contractNo)}` : '/reia/contracts', label: 'View Contract →' };
  }

  // ----------------------------------------------------
  // K. QUICK CONNECT / MAIL
  // ----------------------------------------------------
  if (type.includes('MAIL') || msg.toLowerCase().includes('quick connect') || msg.toLowerCase().includes('new message')) {
    return { url: '#mail', isMail: true, label: 'Open Message →' };
  }

  // ----------------------------------------------------
  // L. TRADING, CLEARANCES, NOAR & CERC
  // ----------------------------------------------------
  if (type.includes('CLEARANCE') || type === 'COMPLIANCE_ALERT' || msg.toLowerCase().includes('standing clearance')) {
    return { url: '/trading/pre-trade', label: 'Manage Clearance →' };
  }
  if (type.includes('NOAR') || msg.toLowerCase().includes('noar')) {
    return { url: '/trading/noar-registry', label: 'View NOAR →' };
  }
  if (type.includes('TRADING') || msg.toLowerCase().includes('trading') || msg.toLowerCase().includes('bid')) {
    if (isTradingClient) return { url: '/trading/my-bids', label: 'My Bids →' };
    return { url: '/trading/billing-settlement', label: 'View Settlement →' };
  }
  if (type.includes('CERC') || msg.toLowerCase().includes('cerc')) {
    return { url: '/reia/cerc-compliance', label: 'View CERC →' };
  }
  if (type.includes('TDS')) {
    return { url: '/seller-ledger', label: 'View TDS →' };
  }
  if (type.includes('STAFF') || type.includes('TEAM') || msg.toLowerCase().includes('role was changed')) {
    return { url: '/settings/user-profile', label: 'My Profile →' };
  }

  // Default fallback based on role
  if (isSeller) return { url: '/seller', label: 'Dashboard →' };
  if (isBuyer) return { url: '/buyer', label: 'Dashboard →' };
  if (isTradingClient) return { url: '/trading/home', label: 'Trading Home →' };
  if (isThermalUser) return { url: '/thermal', label: 'Thermal Portal →' };
  if (isHydroUser) return { url: '/hydro-thermal', label: 'Hydro Portal →' };
  return { url: '/reia', label: 'View Portal →' };
}

function getActionLabel(type, msg = '') {
  const t = String(type || '').toUpperCase();
  const m = String(msg || '').toLowerCase();
  if (t === 'HYDRO_BILL_FOR_APPROVAL' || m.includes('pending your approval')) return 'Review & Approve →';
  if (t === 'HYDRO_BILL_APPROVED') return 'Issue Bill →';
  if (t === 'INVOICE_SUBMITTED') return 'Review Invoice →';
  if (t.includes('DISPUTE')) return 'Resolve Dispute →';
  if (t.includes('RECON')) return 'View Recon →';
  if (t.includes('SECURITY')) return 'Review Security →';
  if (t.includes('CLEARANCE')) return 'Manage Clearance →';
  return 'Take Action →';
}

/**
 * Returns a human-friendly relative time string (e.g., 'Just now', '2m ago', '3h ago', 'Yesterday').
 */
export function formatTimeAgo(isoString) {
  if (!isoString) return '';
  const date = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(isoString) ? isoString : `${isoString.replace(' ', 'T')}Z`);
  const now = new Date();
  const diffSec = Math.max(0, Math.floor((now - date) / 1000));
  if (diffSec < 60) return 'Just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}h ago`;
  const diffDays = Math.floor(diffHour / 24);
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}
