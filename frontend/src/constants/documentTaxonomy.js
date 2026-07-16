export const DOCUMENT_TAXONOMY = {
  STAKEHOLDERS: [
    { value: 'COMPANY_REGISTRATION', label: 'Company Registration (PAN, GST, CIN)', category: 'VERIFY', reason: 'Legal identity confirm karni hai, fake entity na ho' },
    { value: 'GENERATION_LICENSE', label: 'Generation License', category: 'VERIFY', reason: 'Bina valid license ke onboard nahi kar sakte' },
    { value: 'ENV_CLEARANCE', label: 'Environmental Clearance', category: 'VERIFY', reason: 'Regulatory mandatory document' },
    { value: 'PLANT_TECHNICAL_DOCS', label: 'Plant Technical Docs (SLD, Capacity)', category: 'VERIFY', reason: 'Contract capacity ke against match karna hai' },
    { value: 'DISCOM_LICENSE', label: 'DISCOM License/Registration', category: 'VERIFY', reason: 'Legal buyer-status confirm karna' },
    { value: 'BANK_ACCOUNT_PROOF', label: 'Bank Account Proof (Cancelled Cheque)', category: 'VERIFY', reason: 'Penny-drop verification ke saath, fraud-prevention' },
    { value: 'BOARD_RESOLUTION', label: 'Board Resolution / Power of Attorney', category: 'VERIFY', reason: 'Confirm karna ki signing-authority genuine hai' },
    { value: 'COD_CERTIFICATE', label: 'COD Certificate', category: 'VERIFY', reason: 'Billing sirf commissioned capacity se start honi chahiye' },
    { value: 'REGULATORY_RENEWAL', label: 'Regulatory Approval Renewals', category: 'VERIFY', reason: 'Expiry ke baad dobara verify zaroori' },
    { value: 'INVOICE_TEMPLATE', label: 'Invoice Letterhead Template (Word/Image)', category: 'RECORD', reason: 'Custom invoicing ke liye reference template' }
  ],
  CONTRACTS: [
    { value: 'PPA_PSA_SIGNED', label: 'Signed PPA/PSA (Scanned Copy)', category: 'VERIFY', reason: 'Legal contract ka proof, baad mein reference ke liye' },
    { value: 'AMENDMENT_AGREEMENT', label: 'Amendment Agreement', category: 'VERIFY', reason: 'Contract-terms change ka legal proof' }
  ],
  REIA_BILLING: [
    { value: 'SELLER_INVOICE', label: 'Seller Invoice (PDF)', category: 'VERIFY', reason: 'SJVN ko data-match karke approve/reject karna hai' },
    { value: 'CALCULATION_SHEET', label: 'Supporting Calculation Sheet', category: 'RECORD', reason: 'Reference ke liye, verification invoice-data pe hoti hai' },
    { value: 'SUPPLEMENTARY_NOTE', label: 'Supplementary Invoice Supporting Note', category: 'RECORD', reason: 'Adjustment reason ka reference' }
  ],
  DISPUTES: [
    { value: 'DISPUTE_EVIDENCE', label: 'Dispute Evidence (Meter reading, email, calc)', category: 'VERIFY', reason: 'Reviewer ko evidence check karke decide karna hai' },
    { value: 'RESOLUTION_NOTE', label: 'Resolution/Settlement Note', category: 'RECORD', reason: 'Final decision ka documented proof' }
  ],
  RECONCILIATION: [
    { value: 'SIGNED_ACKNOWLEDGMENT', label: 'Signed Acknowledgment (Joint)', category: 'VERIFY', reason: 'Joint validation ka legal proof, dispute ho to reference' },
    { value: 'RAW_DATA_FILE', label: 'Supporting Raw Data Files', category: 'RECORD', reason: 'Traceability ke liye' }
  ],
  PAYMENT_SECURITY: [
    { value: 'LETTER_OF_CREDIT', label: 'Letter of Credit (LC) Copy', category: 'VERIFY', reason: 'Genuine hai ya nahi confirm karna critical hai' },
    { value: 'BANK_GUARANTEE', label: 'Bank Guarantee (EMD/PBG) Copy', category: 'VERIFY', reason: 'Fraud-prevention critical' },
    { value: 'CORPUS_FUND_PROOF', label: 'Corpus Fund Deposit Proof', category: 'VERIFY', reason: 'Amount/validity confirm karni hai' },
    { value: 'BANK_CONFIRMATION', label: 'Bank Confirmation Reference (SWIFT/letter)', category: 'VERIFY', reason: 'Sabse critical hai — bank se hi cross-verify karna' },
    { value: 'SECURITY_RENEWAL', label: 'LC/BG Renewal/Amendment', category: 'VERIFY', reason: 'Naya validity-period confirm karna' },
    { value: 'SECURITY_RELEASE_NOTE', label: 'Security Release/Refund Approval Note', category: 'VERIFY', reason: 'Release se pehle "no pending dues" checklist verify honi chahiye' }
  ],
  TRADING_CLIENTS: [
    { value: 'KYC_DOCS', label: 'KYC Documents', category: 'VERIFY', reason: 'Onboarding se pehle mandatory check' },
    { value: 'TRADING_AGREEMENT', label: 'Trading Agreement/LOI', category: 'VERIFY', reason: 'Legal basis of relationship' },
    { value: 'NOC', label: 'NOC (No Objection Certificate)', category: 'VERIFY', reason: 'Bidding se pehle validity check — critical' },
    { value: 'AUTHORIZATION_LETTER', label: 'Authorization Letter (Signatory)', category: 'VERIFY', reason: 'Fraud-prevention, sirf authorized person confirm kar sake' },
    { value: 'RISK_ASSESSMENT_NOTE', label: 'Risk Assessment Supporting Notes', category: 'RECORD', reason: 'Internal reference' }
  ],
  EXCHANGE_BIDS: [
    { value: 'EXCHANGE_RECEIPT', label: 'Exchange Acknowledgment/Receipt', category: 'RECORD', reason: 'Legal proof ki bid time pe submit hua tha' },
    { value: 'NO_BID_JUSTIFICATION', label: 'No-Bid Justification Note', category: 'RECORD', reason: 'Regulatory requirement, reference ke liye' },
    { value: 'BULK_UPLOAD_TEMPLATE', label: 'Bulk-Upload Excel Template', category: 'RECORD', reason: 'Original file preserved, audit ke liye' }
  ],
  BILATERAL: [
    { value: 'LOI', label: 'LOI (Letter of Intent)', category: 'VERIFY', reason: 'Deal ka initial legal basis' },
    { value: 'OPEN_ACCESS_APP', label: 'Open Access Application Copy', category: 'RECORD', reason: 'Proof of application filed' },
    { value: 'GRID_APPROVAL', label: 'SLDC/RLDC/NLDC Approval Letter', category: 'VERIFY', reason: 'Bina approval ke schedule finalize nahi honi chahiye' },
    { value: 'SCHEDULE_CONFIRMATION', label: 'Schedule Confirmation Document', category: 'RECORD', reason: 'Final confirmed schedule ka proof' },
    { value: 'CURTAILMENT_NOTICE', label: 'Curtailment Notice', category: 'RECORD', reason: 'Billing-adjustment ka basis' }
  ],
  TRADING_BILLING: [
    { value: 'EXCHANGE_OBLIGATION', label: 'Exchange Obligation Report', category: 'RECORD', reason: 'Auto-reconciliation ka source data' },
    { value: 'CLEARING_SETTLEMENT', label: 'Clearing House Settlement Statement', category: 'VERIFY', reason: 'Exchange-data se match karna hai — mismatch critical' },
    { value: 'TDS_CERTIFICATE', label: 'TDS Certificate', category: 'RECORD', reason: 'Tax-compliance proof' },
    { value: 'E_INVOICE_IRN', label: 'E-Invoice IRN Acknowledgment', category: 'RECORD', reason: 'Compliance proof' }
  ],
  COMPLIANCE: [
    { value: 'FORM_4', label: 'Form-4 Regulatory Report', category: 'RECORD', reason: 'Submission ka proof' },
    { value: 'CERC_LICENSE', label: 'CERC Trading License Copy', category: 'VERIFY', reason: 'System-wide validity check' },
    { value: 'IT_COMPLIANCE', label: 'MeitY/CERT-In Compliance Certificates', category: 'RECORD', reason: 'Infra-compliance proof' }
  ]
};
