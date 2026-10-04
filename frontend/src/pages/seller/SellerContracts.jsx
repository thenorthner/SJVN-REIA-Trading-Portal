import React from 'react';
import MyContracts from '../shared/MyContracts.jsx';

// A seller sees its PPAs.
export default function SellerContracts() {
  return (
    <MyContracts
      contractType="PPA"
      title="My Contracts (PPAs)"
      subtitle="Your Power Purchase Agreements with SJVN — documents, milestones, guarantee, requests and notices"
      sourceLabel="Project Type"
      capacityLabel="Capacity"
    />
  );
}
