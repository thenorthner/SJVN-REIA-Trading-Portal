import React from 'react';
import MyEnergyData from '../shared/MyEnergyData.jsx';

// A buyer's allocated energy, PSA by PSA. CUF is the generator's measure, not the buyer's.
export default function BuyerEnergyData() {
  return (
    <MyEnergyData
      title="Energy Data (Allocated Energy)"
      subtitle="The energy allocated to you as recorded by SJVN — the trend, the source documents, and your confirmation before billing"
      contractType="PSA"
      contractLabel="PSA"
      energyLabel="Allocated energy"
      disputesPath="/buyer/disputes"
      showCuf={false}
    />
  );
}
