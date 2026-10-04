import React from 'react';
import MyReconciliation from '../shared/MyReconciliation.jsx';

export default function BuyerReconciliation() {
  return (
    <MyReconciliation
      subtitle="Joint validation with SJVN — review the matched energy and financial lines, the balance rolled forward, and sign off"
      contractHeader="PSA / Contract"
      partyName="Your DISCOM"
      signatoryRole="Buyer"
      disputesPath="/buyer/disputes"
    />
  );
}
