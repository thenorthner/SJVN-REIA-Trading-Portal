import React from 'react';
import MyDisputes from '../shared/MyDisputes.jsx';

// A seller disputes its own bills to SJVN.
export default function SellerDisputes() {
  return <MyDisputes role="SELLER" direction="SELLER_TO_SJVN" />;
}
