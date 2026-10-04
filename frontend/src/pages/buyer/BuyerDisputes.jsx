import React from 'react';
import MyDisputes from '../shared/MyDisputes.jsx';

// A buyer disputes the bills SJVN has issued to it.
export default function BuyerDisputes() {
  return <MyDisputes role="BUYER" direction="SJVN_TO_BUYER" />;
}
