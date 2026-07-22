/**
 * Regulatory approval checklist for stakeholder onboarding.
 * Free-text "Passed" is not enough — track specific clearances with status.
 */
export const APPROVAL_STATUSES = [
  'NOT_STARTED',
  'NOT_APPLICABLE',
  'SUBMITTED',
  'VERIFIED',
  'EXPIRED',
  'REJECTED',
];

/** Catalog of regulatory items. applies_to: SELLER | BUYER | BOTH */
export const REGULATORY_APPROVAL_CATALOG = [
  {
    code: 'COMPANY_REGISTRATION',
    label: 'Company Registration (PAN / GST / CIN)',
    applies_to: 'BOTH',
    is_mandatory: true,
    doc_type: 'COMPANY_REGISTRATION',
    sort_order: 1,
    help: 'Legal identity of the entity',
  },
  {
    code: 'GENERATION_LICENSE',
    label: 'Generation License / CEA Registration',
    applies_to: 'SELLER',
    is_mandatory: true,
    doc_type: 'GENERATION_LICENSE',
    sort_order: 2,
    help: 'Required before seller commercial onboarding',
  },
  {
    code: 'ENV_CLEARANCE',
    label: 'Environmental Clearance',
    applies_to: 'SELLER',
    is_mandatory: true,
    doc_type: 'ENV_CLEARANCE',
    sort_order: 3,
    help: 'Mark N/A only if not applicable for the project type',
  },
  {
    code: 'CONNECTIVITY_APPROVAL',
    label: 'Grid Connectivity (CTU / STU / RLDC)',
    applies_to: 'SELLER',
    is_mandatory: true,
    doc_type: 'PLANT_TECHNICAL_DOCS',
    sort_order: 4,
    help: 'Connectivity / metering / evacuation approval',
  },
  {
    code: 'COD_CERTIFICATE',
    label: 'COD Certificate',
    applies_to: 'SELLER',
    is_mandatory: true,
    doc_type: 'COD_CERTIFICATE',
    sort_order: 5,
    help: 'Required for commissioned capacity; N/A if under construction',
  },
  {
    code: 'PLANT_TECHNICAL_DOCS',
    label: 'Plant Technical Docs (SLD / Capacity)',
    applies_to: 'SELLER',
    is_mandatory: true,
    doc_type: 'PLANT_TECHNICAL_DOCS',
    sort_order: 6,
    help: 'Match against contracted / installed capacity',
  },
  {
    code: 'DISCOM_LICENSE',
    label: 'DISCOM / Procurer License or Registration',
    applies_to: 'BUYER',
    is_mandatory: true,
    doc_type: 'DISCOM_LICENSE',
    sort_order: 2,
    help: 'Legal buyer status (DISCOM license or C&I registration)',
  },
  {
    code: 'SERC_APPROVAL',
    label: 'SERC / Regulatory Commission Approval',
    applies_to: 'BUYER',
    is_mandatory: false,
    doc_type: 'DISCOM_LICENSE',
    sort_order: 3,
    help: 'Where PSA / tariff requires commission approval',
  },
  {
    code: 'BOARD_RESOLUTION',
    label: 'Board Resolution / Power of Attorney',
    applies_to: 'BOTH',
    is_mandatory: true,
    doc_type: 'BOARD_RESOLUTION',
    sort_order: 8,
    help: 'Signing authority must be genuine',
  },
  {
    code: 'BANK_ACCOUNT_PROOF',
    label: 'Bank Account Proof (Cancelled Cheque)',
    applies_to: 'BOTH',
    is_mandatory: true,
    doc_type: 'BANK_ACCOUNT_PROOF',
    sort_order: 9,
    help: 'Required with penny-drop verification',
  },
];

export function catalogForEntityType(entityType) {
  return REGULATORY_APPROVAL_CATALOG.filter(
    (a) => a.applies_to === 'BOTH' || a.applies_to === entityType
  ).sort((a, b) => a.sort_order - b.sort_order);
}

export function summarizeApprovals(rows = []) {
  const applicable = rows.filter((r) => r.status !== 'NOT_APPLICABLE');
  const mandatory = applicable.filter((r) => r.is_mandatory);
  const verified = mandatory.filter((r) => r.status === 'VERIFIED');
  const submitted = applicable.filter((r) => ['SUBMITTED', 'VERIFIED'].includes(r.status));
  const blocking = mandatory.filter((r) => !['VERIFIED', 'NOT_APPLICABLE'].includes(r.status));
  return {
    total: rows.length,
    applicable: applicable.length,
    mandatory: mandatory.length,
    verified: verified.length,
    submitted: submitted.length,
    blocking: blocking.map((r) => r.approval_code || r.code),
    ready_for_approval: mandatory.length > 0 && blocking.length === 0,
    summary_text: mandatory.length
      ? `${verified.length}/${mandatory.length} mandatory verified`
      : 'No checklist',
  };
}
