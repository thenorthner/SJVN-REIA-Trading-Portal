import React from 'react';
import { useDeskAccess } from '../lib/deskAccess.js';

const NAMES = { REIA: 'REIA', HYDRO: 'Hydro', THERMAL: 'Thermal', TRADING: 'Trading' };

/** Shown to the administrators and the auditor on a desk screen they can only read. */
export default function ReadOnlyNotice() {
  const { desk, readOnly } = useDeskAccess();
  if (!readOnly) return null;
  return (
    <div className="inline-note admin-readonly-note" role="note" style={{ marginBottom: 12 }}>
      You are viewing the {NAMES[desk]} desk read-only. Its officers enter, check and approve transactions;
      administrators keep masters, users, onboarding, project assignments and the audit trail.
    </div>
  );
}
