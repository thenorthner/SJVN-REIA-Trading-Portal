import React from 'react';
import MyContracts from '../shared/MyContracts.jsx';

// A buyer sees its PSAs.
export default function BuyerContracts() {
  return (
    <MyContracts
      contractType="PSA"
      title="My Contracts (PSAs)"
      subtitle="Your Power Sale Agreements with SJVN — documents, milestones, requests and notices"
      sourceLabel="Power Source"
      capacityLabel="Allocated"
    />
  );
}
