import React from 'react';
import MyReconciliation from '../shared/MyReconciliation.jsx';

export default function SellerReconciliation() {
  return (
    <MyReconciliation
      subtitle="Joint validation with SJVN — meter vs bill vs payment, the balance rolled forward, and your sign-off"
      contractHeader="PPA"
      partyName="Generator"
      signatoryRole="Renewable Power Producer"
      disputesPath="/seller/disputes"
    />
  );
}
