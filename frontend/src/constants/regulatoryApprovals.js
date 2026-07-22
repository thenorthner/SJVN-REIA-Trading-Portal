/**
 * Shared regulatory approval catalog (mirrors backend).
 */
export const REGULATORY_APPROVAL_CATALOG = [
  { code: 'COMPANY_REGISTRATION', label: 'Company Registration (PAN / GST / CIN)', applies_to: 'BOTH', is_mandatory: true, sort_order: 1, help: 'Legal identity of the entity' },
  { code: 'GENERATION_LICENSE', label: 'Generation License / CEA Registration', applies_to: 'SELLER', is_mandatory: true, sort_order: 2, help: 'Required before seller commercial onboarding' },
  { code: 'ENV_CLEARANCE', label: 'Environmental Clearance', applies_to: 'SELLER', is_mandatory: true, sort_order: 3, help: 'Mark N/A only if not applicable for the project type' },
  { code: 'CONNECTIVITY_APPROVAL', label: 'Grid Connectivity (CTU / STU / RLDC)', applies_to: 'SELLER', is_mandatory: true, sort_order: 4, help: 'Connectivity / metering / evacuation approval' },
  { code: 'COD_CERTIFICATE', label: 'COD Certificate', applies_to: 'SELLER', is_mandatory: true, sort_order: 5, help: 'Required for commissioned capacity; N/A if under construction' },
  { code: 'PLANT_TECHNICAL_DOCS', label: 'Plant Technical Docs (SLD / Capacity)', applies_to: 'SELLER', is_mandatory: true, sort_order: 6, help: 'Match against contracted / installed capacity' },
  { code: 'DISCOM_LICENSE', label: 'DISCOM / Procurer License or Registration', applies_to: 'BUYER', is_mandatory: true, sort_order: 2, help: 'Legal buyer status (DISCOM license or C&I registration)' },
  { code: 'SERC_APPROVAL', label: 'SERC / Regulatory Commission Approval', applies_to: 'BUYER', is_mandatory: false, sort_order: 3, help: 'Where PSA / tariff requires commission approval' },
  { code: 'BOARD_RESOLUTION', label: 'Board Resolution / Power of Attorney', applies_to: 'BOTH', is_mandatory: true, sort_order: 8, help: 'Signing authority must be genuine' },
  { code: 'BANK_ACCOUNT_PROOF', label: 'Bank Account Proof (Cancelled Cheque)', applies_to: 'BOTH', is_mandatory: true, sort_order: 9, help: 'Required with penny-drop verification' },
];

export function catalogForEntityType(entityType) {
  return REGULATORY_APPROVAL_CATALOG
    .filter((a) => a.applies_to === 'BOTH' || a.applies_to === entityType)
    .sort((a, b) => a.sort_order - b.sort_order);
}

export const APPROVAL_STATUS_LABELS = {
  NOT_STARTED: 'Not started',
  NOT_APPLICABLE: 'Not applicable',
  SUBMITTED: 'Submitted',
  VERIFIED: 'Verified',
  EXPIRED: 'Expired',
  REJECTED: 'Rejected',
};
