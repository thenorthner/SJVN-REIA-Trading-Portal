import React from 'react';
import MyEnergyData from '../shared/MyEnergyData.jsx';

// A seller's generation, contract by contract.
export default function SellerEnergyData() {
  return (
    <MyEnergyData
      title="Energy Data (Generation Records)"
      subtitle="Your metered generation as recorded by SJVN — the trend, the source documents, and your confirmation before billing"
      contractLabel="Contract"
      energyLabel="Generation"
      disputesPath="/seller/disputes"
    />
  );
}
