import React from 'react';

const LABELS = {
  SUBMITTED: 'Submitted',
  UNDER_VERIFICATION: 'Under Verification',
  COMMERCIAL_VERIFICATION: 'Commercial Verification',
  FINANCE_APPROVAL: 'Finance Approval',
  APPROVED: 'Approved',
  PAYMENT_RELEASED: 'Payment Released',
};

// Developer (PPA) invoice pipeline per the REIA Dashboard doc.
// `stages` is the ordered list; `current` is the active stage key.
export default function DevStageStepper({ stages = [], current }) {
  if (!stages.length) return null;
  const currentIdx = stages.indexOf(current);
  return (
    <div className="status-stepper" style={{ marginTop: 4 }}>
      {stages.map((s, idx) => {
        let cls = 'step';
        if (idx < currentIdx) cls += ' step-done';
        else if (idx === currentIdx) cls += ' step-active';
        return (
          <div key={s} className={cls}>
            <div className="step-dot">{idx < currentIdx ? '✓' : idx + 1}</div>
            <div className="step-label">{LABELS[s] || s}</div>
          </div>
        );
      })}
    </div>
  );
}
