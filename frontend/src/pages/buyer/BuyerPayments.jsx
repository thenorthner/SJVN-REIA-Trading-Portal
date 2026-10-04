import React from 'react';
import { PageHeader } from '../../components/ui.jsx';
import SellerLedgerView from '../../components/SellerLedgerView.jsx';

// A buyer's own account with SJVN: the same ledger a seller has, read the other
// way round — what SJVN billed, what was paid, what was held back as tax.
export default function BuyerPayments() {
  return (
    <div>
      <PageHeader
        title="Payment Ledger"
        subtitle="Your account with SJVN — what is outstanding and how late, the ledger, a receipt for each payment Finance has confirmed, and your TDS certificates"
      />
      <SellerLedgerView partySide="BUYER" />
    </div>
  );
}
