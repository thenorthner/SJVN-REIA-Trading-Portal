import React from 'react';
import { PageHeader } from '../../components/ui.jsx';
import SellerLedgerView from '../../components/SellerLedgerView.jsx';

// A seller's own account with SJVN.
export default function SellerPayments() {
  return (
    <div>
      <PageHeader
        title="Payments & Ledger"
        subtitle="Your account with SJVN — what is outstanding and how late, the ledger, each payment's advice, and your TDS certificates"
      />
      <SellerLedgerView />
    </div>
  );
}
