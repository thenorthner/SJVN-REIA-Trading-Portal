(() => {
'use strict';

/* ───────────────────────── data: roles ───────────────────────── */
const R = {
  M: { b:'M',  name:'REIA Maker', short:'Maker', c:'maker', side:'SJVN', cls:'Prepares', level:'Signs no approval level', demo:'REIA Maker',
       line:'Prepares the desk’s work: onboards companies, drafts contracts, records energy, raises and submits bills, sends them, runs reconciliations.' },
  C: { b:'C',  name:'REIA Checker', short:'Checker', c:'checker', side:'SJVN', cls:'Decides', level:'Bill approval: Level 1', demo:'REIA Checker',
       line:'Decides on what the maker prepared: verifies documents, approves companies, signs contracts, validates and locks energy, approves Level 1, runs disputes, pays sellers, signs statements.' },
  H: { b:'H',  name:'REIA Approver (HOD)', short:'HOD', c:'hod', side:'SJVN', cls:'Sanctions', level:'Bill approval: Level 3', demo:'REIA Approver',
       line:'The final word on the desk: approves bills at Level 3 and decides disputes.' },
  F: { b:'F',  name:'Finance', short:'Finance', c:'fin', side:'SJVN', cls:'Concurs and confirms money', level:'Bill approval: Level 2', demo:'Finance',
       line:'Concurs on bills at Level 2, confirms money that reached SJVN’s bank, concurs on large reconciliations, handles advances and TDS certificates.' },
  G: { b:'MG', name:'Management', short:'Management', c:'mgmt', side:'SJVN', cls:'Sanctions and oversees', level:'Bill approval: Level 3, as the HOD’s alternate', demo:'Management',
       line:'Can do what the HOD does at Level 3 and on disputes, approves break-glass access, and is alerted when a dispute breaches its SLA.' },
  A: { b:'A',  name:'SJVN Admin', short:'Admin', c:'admin', side:'SJVN', cls:'Governs', level:'Signs no approval level', demo:'SJVN Admin',
       line:'Runs the platform: SJVN users, company log-ins, project access, additional charge, the audit trail. Takes part in onboarding. Never drafts, approves or releases a transaction.' },
  S: { b:'S',  name:'Seller (generator)', short:'Seller', c:'seller', side:'Company', cls:'PPA side', level:'Has its own Levels 1–3 inside the company', demo:'Seller',
       line:'The solar or wind developer SJVN buys from. Accepts the energy figure, raises its own bill, disputes, signs its reconciliation.' },
  B: { b:'B',  name:'Buyer (DISCOM)', short:'Buyer', c:'buyer', side:'Company', cls:'PSA side', level:'Has its own Levels 1–3 inside the company', demo:'Buyer',
       line:'The distribution company SJVN sells to. Receives bills, disputes them, tells SJVN it has paid, signs its reconciliation.' },
  X: { b:'',   name:'Platform (automatic)', short:'Automatic', c:'sys', side:'System', cls:'Runs on its own', level:'—',
       line:'Scheduled jobs that need nobody to log in.' },
};
const ROLE_ORDER = ['M','C','H','F','G','A','S','B'];
const AUTO_JOBS = [
  'Every hour: creates last month’s reconciliation statement for each ACTIVE contract.',
  'Dispute SLA check: not acknowledged in 2 days or not resolved in 15 → ESCALATED, Management alerted.',
  'Payment security: reminders as an instrument nears its expiry date.',
  'Daily alert to SJVN Admin when a project has nobody to act at a tier.',
];

/* ───────────────────────── data: missions ───────────────────────── */
const SELLER_DOCS = ['Company Registration (PAN / GST / CIN)','Generation License / CEA Registration','Environmental Clearance','Grid Connectivity (CTU / STU / RLDC)','COD Certificate','Plant Technical Docs (SLD / Capacity)','Board Resolution / Power of Attorney','Bank Account Proof (Cancelled Cheque)'];
const BUYER_DOCS = ['Company Registration (PAN / GST / CIN)','DISCOM / Procurer License or Registration','Board Resolution / Power of Attorney','Bank Account Proof (Cancelled Cheque)'];

const MISSIONS = [
{ n:1, zone:'setup', short:'Onboard & KYC', name:'Onboard and verify the companies', screen:'REIA Billing & Settlement › Stakeholders & KYC Desk',
  goal:'Bring the seller and the buyer onto the platform, with every required document checked by a second person.',
  start:'A new seller or buyer to deal with', end:'Company {APPROVED}, bank account verified',
  steps:[
    { who:'M', t:'Onboard the company', where:'REIA Billing & Settlement › Stakeholders & KYC Desk', press:['+ Onboard Stakeholder','Submit'],
      fill:['Entity type: Seller (Generator) or Buyer (Beneficiary / DISCOM)','Name, category, PAN, GSTIN','Seller: technology and capacity (MW). Buyer: contracted capacity (MW)','Address, authorised signatory and designation','Commercial contact: name, email, phone','Bank: name, account number, IFSC, branch address'],
      res:{o:'Company', t:'PENDING'},
      rules:['PAN is checked as soon as you leave the field: 5 letters, 4 digits, 1 letter. A wrong one opens a popup.','GSTIN is the 2-digit state code, the same PAN, then 3 characters (for example 08AAQCS1432K1Z5).','A PAN or GSTIN already on another company is refused.'],
      block:'Checker: no `+ Onboard Stakeholder` on the desk.' },
    { who:'M', t:'Fill the regulatory checklist', where:'Company › View › Regulatory Approvals', press:['Update','Save'],
      fill:['Reference / approval no.','Issued by, issued on, valid until','Status: SUBMITTED'],
      lists:{ 'Seller: 8 required items':SELLER_DOCS, 'Buyer: 4 required items':BUYER_DOCS, 'Buyer: optional':['SERC / Regulatory Commission Approval'] },
      res:{o:'Each item', f:'NOT_STARTED', t:'SUBMITTED'},
      rules:['The maker can choose only NOT_STARTED, SUBMITTED or EXPIRED.','A company can upload its own evidence from its portal (Level 2 and above). SJVN still decides.'],
      refuse:['Marking Environmental Clearance verified is the REIA checker’s decision.'],
      block:'Maker: no VERIFIED or REJECTED in the list, and no “Approval Action” box.' },
    { who:'C', t:'Verify each document', where:'Company › Regulatory Approvals', press:['Update','VERIFIED','Save'],
      res:{o:'Each item', f:'SUBMITTED', t:'VERIFIED'},
      rules:['The checker decides each item: VERIFIED, REJECTED or NOT_APPLICABLE.','The checker does not type the details in. That stays with the maker.'],
      refuse:['The REIA maker records COD Certificate’s details; the checker decides on them.'] },
    { who:'C', t:'Approve the company', where:'Company › Approval Action', press:['Standard Approval'],
      res:{o:'Company', f:'PENDING', t:'APPROVED'},
      rules:['Refused while any required item is not VERIFIED. The popup lists what is still pending.','Four eyes: whoever onboarded the company cannot approve it, administrators included.','The bank account is marked verified at the same time, because its proof was verified. If not: `Confirm against bank proof` › `Confirm account`.','`Reject`, with a reason, ends at REJECTED.'],
      refuse:['Approval was refused'] },
  ],
  also:['Changing an APPROVED company (details, contacts or bank) sends it back to PENDING until the checker approves it again.','Blacklisting: REIA Checker or SJVN Admin.','Direct admission without the checklist is for administrators only, and is not part of the normal run.','Onboarding counts as governance, so SJVN Admin may also act on this desk. The four-eyes rule still applies.'],
  extra:'docs' },

{ n:2, zone:'setup', short:'Company logins', name:'Give the companies their log-ins', screen:'REIA Billing & Settlement › Company Users',
  goal:'Each company gets its own sign-in, then decides who in its team prepares, checks and approves.',
  start:'Company onboarded (its screens open once KYC is {APPROVED})', end:'Seller and buyer signed in with their own passwords',
  steps:[
    { who:'A', t:'Create the company’s first log-in', where:'REIA Billing & Settlement › Company Users', press:['Add Team Member','Add to team'],
      fill:['Search the company (“Type to search company…”) and pick it','Full name, email (their sign-in), designation, phone','Access level: Level 3 — Approver for the first log-in','Tick “Set the temporary password myself”, or let the platform make one (shown once)'],
      res:{o:'Flagged', text:'Temporary password'},
      rules:['Only SJVN Admin (or IT Super Admin) manages company log-ins. The REIA desk no longer creates users.','A company’s Admin account can be reset or switched off only by SJVN.'],
      block:'SJVN Admin: no `+ Generate Invoice`, and no other desk action. Read-only on transactions.' },
    { who:'S', t:'First sign-in, set a new password', where:'Sign-in page', press:['Sign in','Save'],
      fill:['Company email and the temporary password','Forced popup: current password, new password, confirm new password'],
      res:{o:'Lands on', text:'Seller dashboard'},
      rules:['Contracts, energy, invoices and the rest stay locked until the company’s KYC is APPROVED.'] },
    { who:'B', t:'First sign-in, set a new password', where:'Sign-in page', press:['Sign in','Save'],
      fill:['Company email and the temporary password','Forced popup: current password, new password, confirm new password'],
      res:{o:'Lands on', text:'Buyer dashboard'},
      rules:['A company log-in sees only its own company’s contracts, bills, payments and disputes.'] },
    { who:'S', opt:true, noquiz:true, t:'Add its own makers and checkers', where:'Seller Portal › My Team',
      fill:['Name, email, designation, phone','Level 1 — Maker, or Level 2 — Checker'],
      rules:['Level 3 adds and manages Level 1 and Level 2.','Only the Company Admin (or SJVN) adds or changes a Level 3 approver.','The buyer builds its team the same way.'] },
  ],
  also:['A Level 1 maker prepares but cannot send anything to SJVN alone: its Level 2 or 3 sends it.','A Level 1 maker cannot sign a reconciliation.'],
  extra:'tiers' },

{ n:3, zone:'setup', short:'Contracts & mapping', name:'Contracts: PPA, PSA and the mapping', screen:'REIA Billing & Settlement › Contracts (PPA/PSA)',
  goal:'Put the purchase (PPA) and the sale (PSA) on the platform, link them, and make both live.',
  start:'Seller and buyer {APPROVED}', end:'PPA and PSA {ACTIVE}, PSA mapped to the PPA',
  steps:[
    { who:'M', t:'Draft the PPA (seller → SJVN)', where:'REIA Billing & Settlement › Contracts (PPA/PSA)', press:['+ New Contract','Create Draft Contract'],
      fill:['Contract no., type PPA, the seller','Project type: Solar, Wind, Hybrid or FDRE','Total capacity (MW)','Tariff type and base tariff (₹/kWh), e.g. 2.75','Billing cycle, tenure start and end','Minimum / guaranteed CUF (%)','The signed agreement (PDF)'],
      res:{o:'Contract', t:'DRAFT'},
      block:'Checker: no `+ New Contract`.' },
    { who:'M', t:'Draft the PSA (SJVN → buyer)', where:'REIA Billing & Settlement › Contracts (PPA/PSA)', press:['+ New Contract','Create Draft Contract'],
      fill:['Contract no., type PSA, the buyer','Capacity, tariff (e.g. 2.82), billing cycle, tenure','SJVN margin (₹/MWh), optional, e.g. 70','The signed agreement (PDF)'],
      res:{o:'Contract', t:'DRAFT'} },
    { who:'M', t:'Map the PSA to the PPA', where:'Open the PPA › Projects Mapped', press:['+ Map PSA to this PPA','Save Map'],
      fill:['Select PSA','Allocation %','Effective from'],
      res:{o:'Mapping', text:'Saved at 100%'},
      rules:['The confirmation shows the share mapped and the spread per unit, e.g. +₹0.07.','A PSA that sells below the PPA tariff needs a recorded reason.'] },
    { who:'M', t:'Move both into negotiation', where:'Each contract', press:['Update Lifecycle Stage','UNDER_NEGOTIATION'],
      res:{o:'Contract', f:'DRAFT', t:'UNDER_NEGOTIATION'},
      rules:['The maker moves a contract only between DRAFT and UNDER_NEGOTIATION.'],
      refuse:['Moving a contract to SIGNED is the REIA checker’s decision.'],
      block:'Maker: no SIGNED, ACTIVE or TERMINATED in the list.' },
    { who:'C', t:'Sign both contracts', where:'Each contract', press:['Update Lifecycle Stage','SIGNED'],
      res:{o:'Contract', f:'UNDER_NEGOTIATION', t:'SIGNED'},
      rules:['A signed agreement must be on file before a contract can say SIGNED.'] },
    { who:'C', t:'Make both live', where:'Each contract', press:['Update Lifecycle Stage','ACTIVE'],
      res:{o:'Contract', f:'SIGNED', t:'ACTIVE'},
      rules:['A contract goes ACTIVE only on or after its tenure start date. Until then it stays SIGNED, and nothing is billed on it.','A renewable PPA needs its minimum CUF before it goes live.','Optional stop on the way: PENDING_REGULATORY_APPROVAL.'],
      refuse:['PPA/… starts on 2026-09-01. It stays SIGNED until then and can be made ACTIVE from that date.','PPA/… has no minimum CUF. Enter the CUF the PPA guarantees (Edit Draft or amendment) before making it ACTIVE.'] },
  ],
  also:['Amendment: the maker drafts it, the checker makes it live, and the old version becomes AMENDED.','Hold: maker, checker, HOD or Management can hold a contract. Only the HOD or Management overrides a hold.','Terminate, close, renew: the checker.','Many contracts at once: the maker’s bulk upload.'] },

{ n:4, zone:'setup', short:'Payment security', name:'Payment security: the buyer’s LC', screen:'REIA Billing & Settlement › Payment Security',
  goal:'Hold the buyer’s letter of credit, confirmed by its bank, so SJVN is covered if the buyer does not pay.',
  start:'PSA in place', end:'LC {ACTIVE}, bank confirmation received',
  steps:[
    { who:'M', t:'Record the buyer’s LC', where:'REIA Billing & Settlement › Payment Security', press:['+ Instrument','Save'],
      fill:['Contract: the PSA','Mechanism: Letter of credit','Limit (₹), e.g. 5,00,00,000','Bank’s LC number, issuing bank','Validity start and end','Remarks'],
      res:{o:'LC', t:'ACTIVE'},
      rules:['The LC gets a number like PS/LC/2026/000NN. Its SFMS column reads “Pending” until the bank confirms.','A buyer can also submit its own instrument from its portal. It arrives as DRAFT for the desk to accept.'] },
    { who:'C', t:'Record the bank’s confirmation', where:'Payment Security › the LC', press:['Record bank confirmation','Confirm'],
      fill:['Bank’s confirmation reference (SFMS: MT700 / MT707 for an LC, MT760 / MT767 for a bank guarantee)'],
      res:{o:'SFMS column', f:'PENDING', t:'RECEIVED'},
      rules:['“Bank confirm” then shows the reference.'],
      refuse:['The SFMS message date cannot be in the future'],
      block:'Maker: no `Record bank confirmation` on the LC.' },
  ],
  also:['Renew: the maker. Top up (replenish): the maker or the buyer.','Drawing on, invoking or accepting a company’s instrument: the checker.','Release: the company or desk asks, the checker acts, Finance signs off. Only with no dues and no open disputes.','Short cover can be treated as adequate for up to 90 days, with a reason: HOD or Management only.'],
  extra:'security' },

{ n:5, zone:'month', short:'Energy', name:'Energy for the month', screen:'REIA Billing & Settlement › Energy Data & Validation',
  goal:'Agree one energy figure for the month that SJVN and the seller both stand behind, then freeze it for billing.',
  start:'PPA {ACTIVE}, month over, meter data (JMR / REA) in hand', end:'Energy {LOCKED}: ready to bill',
  steps:[
    { who:'M', t:'Record the month’s energy', where:'REIA Billing & Settlement › Energy Data & Validation', press:['+ Record Energy Data','Save'],
      fill:['Contract: the PPA','Period (month)','Data type: Provisional or Final','Source, e.g. JMR (joint meter reading)','Energy (MWh), e.g. 7,920'],
      res:{o:'Energy', t:'DRAFT'},
      rules:['CUF is worked out for you: 7,920 MWh from 50 MW in September is 22%.','The REA can be uploaded and read in instead of typing.'],
      block:'Maker: no `Validate`, no `Lock` on the row.' },
    { who:'C', t:'Validate the figure', where:'Energy Data & Validation › the row', press:['Validate'],
      res:{o:'Energy', f:'DRAFT', t:'VALIDATED'},
      rules:['If the figure disagrees with another source for the same month, it goes to DISPUTED instead.'],
      block:'Checker: no `+ Record Energy Data`.' },
    { who:'S', t:'Accept the figure', where:'Seller Portal › Energy Data › the month', press:['Accept','Accept the figure'],
      res:{o:'Seller’s answer', t:'ACCEPTED'},
      rules:['An in-page popup asks “Accept this energy figure?”.','Or object: give the MWh you claim, a note and a file.','The seller sees the figure only after it has left DRAFT.'] },
    { who:'C', opt:true, t:'Rule on an objection', where:'Energy Data & Validation › the row',
      res:{o:'Objection', f:'OBJECTED', t:'UPHELD'},
      rules:['UPHELD or REJECTED, with a note the seller reads.','If upheld, the maker records the corrected figure. It replaces the old one.'],
      refuse:['Ruling on an objection is the REIA checker’s'] },
    { who:'C', t:'Lock it for billing', where:'Energy Data & Validation › the row', press:['Lock'],
      res:{o:'Energy', f:'VALIDATED', t:'LOCKED'},
      rules:['Only a LOCKED figure can be billed: one per contract, month and kind.','A reason is required to lock a figure that failed validation, has an unanswered objection, or an upheld objection it does not meet.','Here the seller accepted, so no reason is asked.'],
      refuse:['This period failed validation and cannot be locked without a recorded reason.'] },
  ],
  also:['The buyer sees its share under “Energy Allocation”, by the PSA’s mapping %.','The maker can record certified curtailment hours on a month’s figure.'] },

{ n:6, zone:'month', short:'Bills & approval', name:'Bills and their approval', screen:'REIA Billing & Settlement › Billing & Invoicing',
  goal:'Raise SJVN’s bill on the buyer, check the seller’s own bill against SJVN’s figure, and take both up the approval ladder.',
  start:'Energy {LOCKED}', end:'Both bills {APPROVED}, buyer’s bill {SENT}',
  steps:[
    { who:'M', t:'Generate SJVN’s bill on the buyer', where:'REIA Billing & Settlement › Billing & Invoicing', press:['+ Generate Invoice','Generate'],
      fill:['Contract: the PSA','Billing period, e.g. 2026-09','Invoice type: Provisional or Final'],
      res:{o:'INV-PSA/…', t:'DRAFT'},
      rules:['Amount = MWh × 1,000 × PSA tariff: 7,920 × 1,000 × ₹2.82 = ₹2,23,34,400 (energy plus SJVN margin).','The Month-Close Board can raise every ready bill in one go.'],
      block:'Checker and SJVN Admin: no `+ Generate Invoice`.' },
    { who:'M', t:'Generate SJVN’s own figure for the PPA', where:'REIA Billing & Settlement › Billing & Invoicing', press:['+ Generate Invoice','Generate'],
      fill:['Contract: the PPA','Same billing period and type'],
      res:{o:'INV-PPA/…', t:'DRAFT'},
      rules:['7,920 × 1,000 × ₹2.75 = ₹2,17,80,000.','It stays DRAFT. It is only the yardstick the seller’s own bill is checked against.'],
      refuse:['… is the developer’s own bill for 2026-09; submit that one for approval.'] },
    { who:'S', t:'Raise its own bill', where:'Seller Portal › My Invoices', press:['+ Create Invoice','Submit to SJVN'],
      fill:['Contract (PPA), billing period, invoice type','Your invoice ref (optional)','The form fills itself: MWh × tariff, the source (JMR, final) and the TDS note'],
      res:{o:'Seller’s bill', t:'SUBMITTED'},
      rules:['A Level 1 maker’s bill goes to its own checker first (PENDING_L2). Level 2 or 3 sends it on.'] },
    { who:'M', t:'Check it against SJVN’s figure', where:'Billing & Invoicing › click the bill’s number', press:['Validate vs System'],
      res:{o:'Validation', t:'MATCHED'},
      rules:['PARTIAL or MISMATCH must be settled before approval: the checker sends the bill back to the seller, or waives the gap with a reason.','Clicking the contract number opens the contract, not the bill.'] },
    { who:'M', t:'Complete the verification checklist', where:'The seller’s bill › Verification Checklist', press:['Save Verification'],
      lists:{ 'Technical Verification: each line VERIFIED, PENDING, FAILED or NA':['REA Uploaded','Energy Verified','Tariff Verified','Contract Capacity Verified','CUF Compliance','COD Compliance','Curtailment Checked','Change in Law Verified'], 'Commercial Verification: the build-up':['Energy Charges and the bill’s other lines (filled in for you)','Change in Law','Compensation Event','Liquidated Damages (−)','Previous Adjustment'] },
      res:{o:'Verification', t:'VERIFIED'},
      rules:['A developer’s bill cannot be approved without a completed verification.','Only Curtailment Checked and Change in Law Verified may be NA.','Clearing a failed automatic check needs a written reason.','The build-up must come to what the bill says. If the gap is only the liquidated damages, save, then Draft LD note; otherwise the checker sends the bill back to the developer.'] },
    { who:'M', t:'Submit both bills for approval', where:'Each bill', press:['Submit for SJVN Approval'],
      res:{o:'Bill', f:'DRAFT', t:'UNDER_APPROVAL'},
      rules:['Levels by amount: up to ₹1 lakh one level, above ₹1 lakh two, above ₹10 lakh three. SJVN can change the bands in its masters.'],
      block:'Maker: no `Approve Level …` button on either bill.' },
    { who:'C', t:'Approve Level 1', where:'Each bill › Approval Workflow', press:['Approve Level 1'],
      fill:['Comments'],
      res:{o:'Level 1', t:'APPROVED'},
      rules:['Whoever verified the bill cannot approve its Level 1.','The checker can also reject, or send the seller’s bill back.'],
      refuse:['You verified INV-…, so someone else approves its first level.'],
      block:'HOD: no approve button while Level 1 is pending.' },
    { who:'F', t:'Approve Level 2', where:'Each bill › Approval Workflow', press:['Approve Level 2'],
      fill:['Comments'],
      res:{o:'Level 2', t:'APPROVED'},
      block:'Checker: no approve button while Level 2 is pending.' },
    { who:'H', t:'Approve Level 3', where:'Each bill › Approval Workflow', press:['Approve Level 3'],
      fill:['Comments','If asked: acknowledge the security position, e.g. “LC held and bank-confirmed”'],
      res:{o:'Bill', f:'UNDER_APPROVAL', t:'APPROVED'},
      rules:['Management can sign Level 3 instead of the HOD.','Three approvals, three different people, strictly in order.'] },
    { who:'M', t:'Send the bill to the buyer', where:'The buyer’s bill', press:['Send Email to Buyer'],
      res:{o:'Bill', f:'APPROVED', t:'SENT'},
      rules:['Emailed to the buyer. With no mail server set up, it is written to the outbox and marked SIMULATED.','Send before payment: a paid bill can no longer be sent.','The buyer’s 15-day dispute window starts when the bill is presented.'] },
  ],
  also:['Arrear, supplementary and late-payment surcharge bills: the maker raises them, and they climb the same ladder.','Cancel a bill: maker or checker, while it is DRAFT, SUBMITTED, REJECTED, PENDING_L2 or UNDER_APPROVAL.','Invoice Verification (under Others) lists every developer bill and what it is waiting on.'],
  extra:'ladder' },

{ n:7, zone:'month', short:'Disputes', name:'Disputes', screen:'REIA Billing & Settlement › Dispute Management',
  goal:'Let the buyer challenge part of a bill, decide it fairly, and settle what is accepted with a credit note.',
  start:'Bill {SENT}, within 15 days of presentation', end:'Dispute {CLOSED}, credit note issued if accepted',
  steps:[
    { who:'B', t:'Raise a dispute', where:'Buyer Portal › Billing & Payments › the bill', press:['Raise a dispute on this bill','Submit Dispute'],
      fill:['Amount disputed (₹)','Charge line: energy charges, SJVN margin…','Reason code, e.g. energy data mismatch','Issue description','Evidence file'],
      res:{o:'Dispute', t:'RAISED'},
      rules:['The bill shows DISPUTED, with the amount in dispute.','After 15 days from presentation the bill is conclusive and cannot be disputed.','The seller disputes its side the same way. The maker can raise one on a party’s behalf.'],
      refuse:['This bill is now conclusive — the 15-day dispute window (from …) has passed.'] },
    { who:'C', t:'Acknowledge and start the review', where:'REIA Billing & Settlement › Dispute Management › the dispute', press:['Acknowledge','Start Review'],
      res:{o:'Dispute', f:'RAISED', t:'UNDER_REVIEW'},
      rules:['Clock: acknowledge within 2 days, resolve within 15. A breach makes it ESCALATED and alerts Management.'],
      block:'Maker: no Acknowledge, Start Review, Request Info, Confirm Resolution or Close Dispute.' },
    { who:'C', opt:true, t:'Ask the buyer for information', where:'The dispute', press:['Request Info'],
      fill:['What information is needed (at least 10 characters)'],
      res:{o:'Dispute', f:'UNDER_REVIEW', t:'INFO_REQUESTED'},
      refuse:['Say what information is needed (at least 10 characters) — it is what the party reads.'] },
    { who:'B', opt:true, t:'Answer SJVN', where:'Buyer Portal › My Disputes › the dispute', press:['Send'],
      fill:['Message to SJVN'],
      res:{o:'Dispute', f:'INFO_REQUESTED', t:'UNDER_REVIEW'},
      rules:['A banner says “SJVN has asked for more information”.'] },
    { who:'H', t:'Decide the dispute', where:'REIA Billing & Settlement › Dispute Management › the dispute', press:['Confirm Resolution'],
      fill:['Outcome: accepted (full or partial credit) or rejected','Amount accepted (₹), e.g. 50,000','Resolution reasoning, shown to both parties'],
      res:{o:'Dispute', f:'UNDER_REVIEW', t:'RESOLVED_ACCEPTED'},
      rules:['Accepted: a draft credit note is made for the accepted amount.','Rejected: RESOLVED_REJECTED, no note.','Management can decide instead of the HOD.'],
      block:'Checker: no `Confirm Resolution`.' },
    { who:'C', t:'Approve the credit note', where:'REIA Billing & Settlement › Notes for Approval', press:['Approve & issue'],
      res:{o:'Credit note', f:'DRAFT', t:'ISSUED'},
      rules:['Issued with its own note number. The bill shows the credit applied, and its balance falls.','A credit note is not money, so the bill reads “Partially paid — credit applied”.','Finance can approve notes too. Whoever raised a note cannot approve it.'],
      block:'Maker: no `Approve & issue`.' },
    { who:'B', t:'Accept the outcome', where:'Buyer Portal › My Disputes › the dispute', press:['Accept resolution','Accept and close'],
      res:{o:'Dispute', f:'RESOLVED_ACCEPTED', t:'CLOSED'},
      rules:['Or contest it: name the forum (SJVN senior management, legal / conciliation, arbitration, the Regulatory Commission) and the amount.','The party has 15 days to answer. After that the checker can `Close Dispute`.'] },
  ],
  also:['The maker keeps the record of a contested dispute: forum, hearings, how it ended.','Debit notes, and notes for other reasons, go through the same Notes for Approval queue.'],
  extra:'clock' },

{ n:8, zone:'month', short:'Buyer pays', name:'The buyer pays', screen:'Buyer Portal › Billing & Payments, then REIA Billing & Settlement › Payment Monitoring',
  goal:'Record the buyer’s money only once Finance has seen it in SJVN’s bank.',
  start:'Bill {SENT}', end:'Bill {PAID}',
  steps:[
    { who:'B', t:'Tell SJVN about the payment', where:'Buyer Portal › Billing & Payments › the bill', press:['Intimate payment to SJVN','Send to SJVN Finance'],
      fill:['Amount credited to SJVN (bill less credit notes), e.g. 2,22,84,400','Payment date, mode (RTGS…), UTR / reference','Remarks'],
      res:{o:'Intimation', t:'SUBMITTED'},
      rules:['A buyer’s Level 1 maker sends it to its checker first (PENDING_CHECKER). The checker sends it on or returns it.','The buyer can withdraw it until Finance acts.'] },
    { who:'F', t:'Confirm the money arrived', where:'REIA Billing & Settlement › Payment Monitoring › Payments to confirm', press:['Confirm receipt','Confirm and record the payment'],
      fill:['Value date in SJVN’s bank'],
      res:{o:'Bill', f:'SENT', t:'PAID'},
      rules:['Only Finance confirms money. The desk that raised the bill never marks it paid.','Part of the bill paid: PARTIALLY_PAID.','Money beyond the bill can be held as the buyer’s advance (Advances & Unapplied Receipts).'],
      block:'Maker and checker cannot confirm a receipt.' },
  ],
  also:['Paid late: surcharge accrues from the due date, and the maker can raise a late-payment surcharge bill.','Paid early: the buyer earns the contract’s early-payment rebate.','Payment Monitoring shows both sides: what buyers owe SJVN, and what SJVN owes generators.'] },

{ n:9, zone:'month', short:'Pay the seller', name:'Pay the seller: pay-when-paid', screen:'REIA Billing & Settlement › Billing & Invoicing › the seller’s bill',
  goal:'Pass the buyer’s money on to the seller: only what was realised, less the rebate SJVN earns and the TDS.',
  start:'Buyer’s bill {PAID}, seller’s bill {APPROVED}', end:'Seller’s bill {PAID}',
  steps:[
    { who:'F', opt:true, noquiz:true, t:'See what each seller can be paid', where:'REIA Billing & Settlement › Others › Developer Release Planner',
      rules:['Shows what buyers paid that belongs to each generator (its energy share; no SJVN margin, no credit notes), what has gone out, and what can be released now.'] },
    { who:'C', alt:['F'], t:'Release to the generator', where:'The seller’s bill › Release Payment to Generator (Pay-when-paid)', press:['Release to Generator'],
      fill:['Net amount paid (₹)','TDS deducted (₹)','Fund source: DISCOM realization, own fund or payment security fund','Payment date, reference'],
      res:{o:'Seller’s bill', f:'APPROVED', t:'PAID'},
      rules:['The section shows what the DISCOM has realised, what is already released, and what is available.','Net + TDS may not exceed the lower of what is available and the bill less the early-payment rebate: 1.5% if paid within 5 days of the bill, 1% within 30 days, unless the PPA sets its own.','TDS u/s 194Q: 0.1% of the bill above ₹50 lakh in the year.','Net + TDS + rebate = the bill, exactly. Finance can release too.'],
      refuse:['₹2,17,80,000 is more than the ₹2,14,53,300 left on … (₹2,17,80,000 owed, less the 1.50% early-payment rebate it earns if paid today).'],
      block:'Maker: the release section does not appear.' },
    { who:'S', opt:true, noquiz:true, t:'See the money', where:'Seller Portal › My Dashboard / Payments & Ledger',
      rules:['“Latest payments from SJVN” shows the release. No other company is named anywhere.'] },
  ],
  also:['Finance files the quarterly TDS certificates (Form 16A) for sellers from Counterparty Ledgers & TDS.','The Money tab works through these figures and lets you change them.'],
  extra:'release' },

{ n:10, zone:'month', short:'Reconciliation', name:'Reconcile the month', screen:'REIA Billing & Settlement › Reconciliation',
  goal:'Agree, contract by contract, that the month’s energy, bills and payments tie up, and have both sides sign.',
  start:'Month billed and paid', end:'Statement {CLOSED}, signed by both',
  steps:[
    { who:'X', noquiz:true, t:'Statement created automatically', where:'Hourly job',
      res:{o:'Statement', t:'PENDING_SIGN_OFF'},
      rules:['Every hour the platform creates last month’s statement for each ACTIVE contract.','If a statement was made before payments landed, use `Regenerate statement (Re-sync)`.'] },
    { who:'M', opt:true, t:'Run a reconciliation', where:'REIA Billing & Settlement › Reconciliation', press:['+ Run Reconciliation','Run'],
      fill:['Scope: REIA contract (PPA / PSA)','Contract','Period type: Monthly','Period'],
      res:{o:'Statement', t:'PENDING_SIGN_OFF'},
      rules:['NEEDS_REVIEW instead when a line does not match.','Lines: energy (metered vs billed), billed vs paid, tax / SAP, performance, penalty (CUF assessed at year end).','Tax and SAP lines read NOT_CONNECTED unless a figure is supplied. That is expected.'],
      refuse:['R… is already open for 2026-09. Open it and use "Regenerate statement" to refresh its figures, or finish it first.'],
      block:'Checker: no `+ Run Reconciliation`.' },
    { who:'C', opt:true, t:'Override an exception', where:'The statement › the line', press:['Override'],
      fill:['Why accepting variance…'],
      res:{o:'Line', text:'Accepted with a reason'},
      block:'Maker: no `Override`.' },
    { who:'F', t:'Concur for Finance', where:'The statement', press:['Concur for Finance'],
      rules:['Needed when the statement covers more than ₹1 crore billed. The desk cannot sign before it.'],
      refuse:['R… covers ₹2,23,34,400 billed, above the ₹1,00,00,000 limit. Finance concurs before SJVN signs.'] },
    { who:'C', t:'Sign for SJVN', where:'The statement', press:['✓ SJVN Agree & Sign-Off','✓ Confirm & Sign Off'],
      fill:['Tick “I confirm digital sign-off”'],
      res:{o:'SJVN side', text:'Signed'},
      rules:['Only with no open lines.'],
      block:'Maker: no `SJVN Agree & Sign-Off`.' },
    { who:'B', t:'Sign for the buyer', where:'Buyer Portal › Reconciliation › the PSA statement', press:['I agree — sign off','Sign off'],
      fill:['Tick “I have reviewed this statement…”'],
      res:{o:'PSA statement', t:'CLOSED'},
      rules:['A Level 1 maker cannot sign. Level 2, 3 or the Company Admin can.'] },
    { who:'S', t:'Sign for the seller', where:'Seller Portal › Reconciliation › the PPA statement', press:['I agree — sign off','Sign off'],
      fill:['Tick “I have reviewed this statement…”'],
      res:{o:'PPA statement', t:'CLOSED'},
      rules:['The statement then shows “Signed by both — closed”.'] },
  ],
  also:['Reopen: a party or the desk asks; Finance or the checker decides.','The maker can raise a dispute from a statement line, inside the dispute window.'],
  extra:'recon' },
];

/* ───────────────────────── data: powers matrix ─────────────────────────
   Codes in role order M C H F MG A S B: Y does it · y can also · r sees only · x blocked · - no access */
const MX = [
  ['KYC','Onboard a company','Y x r r r y - -','`+ Onboard Stakeholder`'],
  ['KYC','Record a checklist item’s details (SUBMITTED)','Y x r r r y y y','Companies submit from their portal (Level 2 and above)'],
  ['KYC','Verify or reject a checklist item','x Y r r r y - -',''],
  ['KYC','Approve a company (Standard Approval)','x Y r r r y - -','Never the person who onboarded it'],
  ['KYC','Confirm a company’s bank account','x Y r r r y - -',''],
  ['KYC','Blacklist a company','x Y r r r Y - -',''],
  ['KYC','Create company log-ins','x x - - - Y y y','Company Level 3 adds its own makers and checkers'],
  ['Contracts','Draft a PPA or PSA (+ New Contract)','Y x r r r r r r',''],
  ['Contracts','Map a PSA to a PPA','Y x r r r r - -',''],
  ['Contracts','Move a draft into negotiation','Y x r r r r - -',''],
  ['Contracts','Sign, activate, terminate or close a contract','x Y r r r r - -',''],
  ['Contracts','Draft an amendment','Y x r r r r - -',''],
  ['Contracts','Put a contract on hold','y y y r y r - -',''],
  ['Contracts','Override a hold','r r Y r Y r - -',''],
  ['Security','Record an instrument (+ Instrument)','Y x r r r r y y','A company’s own submission arrives as DRAFT'],
  ['Security','Accept a company’s instrument','x Y r r r r - -',''],
  ['Security','Record the bank’s confirmation (SFMS)','x Y r r r r - -',''],
  ['Security','Issue the demand letter for an invocation','Y x r r r r - -',''],
  ['Security','Draw on or invoke security','x Y r r r r - -',''],
  ['Security','Release an instrument','x Y r Y r r y y','Company asks, checker acts, Finance signs off'],
  ['Security','Treat short cover as adequate (up to 90 days)','x x Y r Y r - -',''],
  ['Energy','Record energy (+ Record Energy Data)','Y x r r r r - -',''],
  ['Energy','Validate energy','x Y r r r r - -',''],
  ['Energy','Accept or object to the energy figure','r r r r r r Y -',''],
  ['Energy','Rule on an objection','x Y r r r r - -',''],
  ['Energy','Lock energy for billing','x Y r r r r - -',''],
  ['Bills','Generate SJVN’s bill (+ Generate Invoice)','Y x r r r x - r',''],
  ['Bills','Raise its own bill to SJVN','r r r r r r Y -','Level 1 needs its own checker first'],
  ['Bills','Validate a seller’s bill vs System','Y y r r r r - -',''],
  ['Bills','Complete the verification checklist','Y x r r r r - -',''],
  ['Bills','Submit a bill for SJVN approval','Y x r r r r - -',''],
  ['Bills','Approve Level 1','x Y x r r r - -','Not whoever verified the bill'],
  ['Bills','Approve Level 2','x x x Y r r - -',''],
  ['Bills','Approve Level 3','x x Y r Y r - -',''],
  ['Bills','Send a seller’s bill back, or waive a mismatch','x Y r r r r - -',''],
  ['Bills','Send a bill to the buyer','Y x r r r r - -',''],
  ['Bills','Cancel a bill','y y r r r r - -',''],
  ['Disputes','Raise a dispute','y r r r r r Y Y','The maker raises on a party’s behalf'],
  ['Disputes','Acknowledge, review, ask for information on, or close a dispute','x Y r r r r - -',''],
  ['Disputes','Answer a request for information','r r r r r r Y Y',''],
  ['Disputes','Decide a dispute (Confirm Resolution)','x x Y r Y r - -',''],
  ['Disputes','Approve a credit note (Approve & issue)','x Y r y r r - -',''],
  ['Disputes','Accept or contest the outcome','r r r r r r Y Y',''],
  ['Disputes','Keep the forum and hearing record','Y r r r r r - -',''],
  ['Money','Tell SJVN a payment was made','r r r r r r - Y','Buyer Level 1 needs its checker first'],
  ['Money','Confirm money received','x x r Y r r - -',''],
  ['Money','Release payment to a seller','x Y r y r r - -',''],
  ['Money','Apply or refund an advance','r r r Y r r - -',''],
  ['Money','File TDS certificates (Form 16A)','r r r Y r r - y','Finance for sellers; a buyer files its own'],
  ['Money','Raise a late-payment surcharge bill','Y x r r r r - -',''],
  ['Reconciliation','Run a reconciliation','Y x r r r r - -','The hourly job also creates them'],
  ['Reconciliation','Override an exception','x Y r r r r - -',''],
  ['Reconciliation','Concur on a statement above ₹1 crore','r r r Y r r - -',''],
  ['Reconciliation','Sign for SJVN','x Y r r r r - -',''],
  ['Reconciliation','Sign for the company','r r r r r r Y Y','Not a Level 1 maker'],
  ['Reconciliation','Decide a reopen request','r Y r Y r r - -',''],
  ['Notes','Draft a debit or credit note','Y x r y r r - -',''],
  ['Notes','Approve or reject a note','x Y r y r r - -',''],
  ['Notes','Apply an issued note to its bill','Y x r y r r - -',''],
  ['SAP posting','Prepare the month’s posting','Y x r r r r - -',''],
  ['SAP posting','Post the month’s posting, push it to SAP, or reverse it','x Y r r r r - -',''],
  ['Governance','Create SJVN users','- - - - - Y - -',''],
  ['Governance','Assign projects to users','- - - - r Y - -',''],
  ['Governance','Give someone additional charge (up to 90 days)','- - - - r Y - -',''],
  ['Governance','Approve break-glass access (up to 72 hours)','- - - - Y Y - -',''],
  ['Governance','Read the audit trail','- - - - - Y - -',''],
].map(([mod, a, cells, note]) => {
  const c = cells.split(' ');
  return { mod, a, note, cell: Object.fromEntries(ROLE_ORDER.map((k, i) => [k, c[i]])) };
});
const MODS = [...new Set(MX.map(r => r.mod))];

/* ───────────────────────── data: company tiers (team screen, as enforced) ───────────────────────── */
const TIERS = {
  S: [['See contracts, energy data, invoices, payments and disputes',1,1,1,1],['Prepare an invoice or upload a document',1,1,1,1],['Approve a maker’s draft and submit it to SJVN',0,1,1,1],['Submit KYC documents for SJVN’s verification',0,1,1,1],['Raise a dispute, request a release',1,1,1,1],['Sign a reconciliation',0,1,1,1],['Add makers and checkers, reset their passwords, switch them off',0,0,1,1],['Add or change an Approver (Level 3)',0,0,0,1]],
  B: [['See PSAs, allocated energy, bills, payments and disputes',1,1,1,1],['Prepare a payment intimation or upload a document',1,1,1,1],['Send a payment intimation to SJVN Finance',0,1,1,1],['Submit KYC documents, file a TDS certificate (Form 16A)',0,1,1,1],['Raise a dispute, request a release',1,1,1,1],['Sign a reconciliation',0,1,1,1],['Add makers and checkers, reset their passwords, switch them off',0,0,1,1],['Add or change an Approver (Level 3)',0,0,0,1]],
};

/* ───────────────────────── data: lifecycles ───────────────────────── */
const LIFE = [
  { id:'company', name:'Company (KYC)', tracks:[
    { title:'The company record', main:[{s:'PENDING', by:['M'], act:'Onboard'},{s:'APPROVED', by:['C'], act:'`Standard Approval`'}],
      br:[{f:'PENDING', t:'REJECTED', by:['C'], act:'`Reject`, with a reason'},{f:'APPROVED', t:'PENDING', by:['M','S','B'], act:'Any change to details, contacts or bank', note:'until the checker approves again'}] },
    { title:'Each checklist item', main:[{s:'NOT_STARTED'},{s:'SUBMITTED', by:['M','S','B'], act:'Details and evidence'},{s:'VERIFIED', by:['C'], act:'Verify'}],
      br:[{f:'SUBMITTED', t:'REJECTED', by:['C'], act:'Reject', note:'the maker resubmits'},{f:'SUBMITTED', t:'NOT_APPLICABLE', by:['C'], act:'Not applicable'},{f:'VERIFIED', t:'EXPIRED', by:['M'], act:'Validity lapsed'}] } ],
    notes:['Blacklisting is a separate flag, set by the REIA Checker or SJVN Admin.'] },
  { id:'contract', name:'Contract (PPA / PSA)', tracks:[
    { title:'A contract', main:[{s:'DRAFT', by:['M'], act:'`+ New Contract`'},{s:'UNDER_NEGOTIATION', by:['M'], act:'Update stage'},{s:'SIGNED', by:['C'], act:'Agreement on file'},{s:'ACTIVE', by:['C'], act:'From tenure start'},{s:'NEARING_EXPIRY', by:['C'], act:'Close to tenure end'},{s:'EXPIRED', by:['C'], act:'Tenure over'},{s:'CLOSED', by:['C'], act:'Close'}],
      br:[{f:'UNDER_NEGOTIATION', t:'DRAFT', by:['M'], act:'Back to draft'},{f:'SIGNED', t:'PENDING_REGULATORY_APPROVAL', by:['C'], act:'Waiting on a regulator', note:'then ACTIVE'},{f:'ACTIVE', t:'AMENDED', by:['C'], act:'Its amendment goes live'},{f:'EXPIRED', t:'RENEWED', by:['C'], act:'Renew', note:'then ACTIVE'},{f:'ACTIVE', t:'TERMINATED', by:['C'], act:'Terminate, with reason and date', note:'then CLOSED'}] } ],
    notes:['The maker moves only between DRAFT and UNDER_NEGOTIATION. Every other move is the checker’s.'] },
  { id:'security', name:'Payment security', tracks:[
    { title:'An instrument (LC, BG, fund)', main:[{s:'DRAFT', by:['S','B'], act:'Company submits'},{s:'ACTIVE', by:['C'], act:'Accept'},{s:'RELEASE_PENDING', by:['S','B'], act:'Release requested'},{s:'RELEASED', by:['C','F'], act:'Checker acts, Finance signs off'}],
      br:[{f:'(maker records it)', t:'ACTIVE', by:['M'], act:'`+ Instrument`'},{f:'DRAFT', t:'CLOSED', by:['C'], act:'Refuse the submission'},{f:'ACTIVE', t:'PARTIALLY_UTILIZED', by:['C'], act:'Draw on it'},{f:'ACTIVE', t:'RENEWED', by:['M'], act:'Renew'},{f:'ACTIVE', t:'EXPIRED', by:['X'], act:'Validity ends'}] },
    { title:'An invocation', main:[{s:'ELIGIBLE', by:['M'], act:'Raise it'},{s:'NOTICE_ISSUED', by:['C'], act:'Notice (letter by the maker)'},{s:'CLAIMED', by:['C'], act:'Claim on the bank'},{s:'FUNDS_RECEIVED', by:['C'], act:'Money in'}],
      br:[{f:'NOTICE_ISSUED', t:'REJECTED', by:['C'], act:'Bank refuses'},{f:'CLAIMED', t:'REJECTED', by:['C'], act:'Bank refuses'}] } ],
    notes:['A buyer’s default is met from its LC, then the payment security fund, then the corpus fund. A seller’s BG answers only for the seller.'] },
  { id:'energy', name:'Energy record', tracks:[
    { title:'The month’s figure', main:[{s:'DRAFT', by:['M'], act:'Record'},{s:'VALIDATED', by:['C'], act:'`Validate`'},{s:'LOCKED', by:['C'], act:'`Lock`'}],
      br:[{f:'DRAFT', t:'DISPUTED', by:['C'], act:'Validation finds a disagreement', note:'re-record, or lock with a reason'}] },
    { title:'The seller’s answer', main:[{s:'VALIDATED'},{s:'ACCEPTED', by:['S'], act:'`Accept the figure`'}],
      br:[{f:'VALIDATED', t:'OBJECTED', by:['S'], act:'Object, with the MWh it claims'},{f:'OBJECTED', t:'UPHELD', by:['C'], act:'Rule', note:'the maker records the corrected figure'},{f:'OBJECTED', t:'REJECTED', by:['C'], act:'Rule', note:'the figure stands'}] } ] },
  { id:'billb', name:'SJVN’s bill on the buyer', tracks:[
    { title:'PSA bill', main:[{s:'DRAFT', by:['M'], act:'Generate'},{s:'UNDER_APPROVAL', by:['M'], act:'Submit'},{s:'APPROVED', by:['C','F','H'], act:'Level 1 → 2 → 3'},{s:'SENT', by:['M'], act:'`Send Email to Buyer`'},{s:'PAID', by:['F'], act:'Confirm receipt'}],
      br:[{f:'UNDER_APPROVAL', t:'REJECTED', by:['C','F','H'], act:'Reject at any level', note:'the maker fixes and resubmits'},{f:'SENT', t:'DISPUTED', by:['B'], act:'Raise a dispute'},{f:'SENT', t:'PARTIALLY_PAID', by:['F'], act:'Part payment, or a credit note applied'},{f:'DRAFT', t:'CANCELLED', by:['M','C'], act:'Cancel'}] } ],
    notes:['Bills up to ₹1 lakh need one level, above ₹1 lakh two, above ₹10 lakh three.'] },
  { id:'bills', name:'Seller’s bill to SJVN', tracks:[
    { title:'PPA bill', main:[{s:'PENDING_L2', by:['S'], act:'Level 1 drafts'},{s:'SUBMITTED', by:['S'], act:'Level 2 / 3 sends'},{s:'UNDER_APPROVAL', by:['M'], act:'Matched, verified, submitted'},{s:'APPROVED', by:['C','F','H'], act:'Level 1 → 2 → 3'},{s:'PAID', by:['C','F'], act:'Release to Generator'}],
      br:[{f:'SUBMITTED', t:'REJECTED', by:['C'], act:'Send back, saying what to fix', note:'the seller revises and resubmits'},{f:'UNDER_APPROVAL', t:'REJECTED', by:['C','F','H'], act:'Reject at any level'}] } ],
    notes:['A seller’s Level 2 or 3 goes straight to SUBMITTED.'] },
  { id:'dispute', name:'Dispute', tracks:[
    { title:'A dispute', main:[{s:'RAISED', by:['B','S'], act:'Raise'},{s:'ACKNOWLEDGED', by:['C'], act:'`Acknowledge`'},{s:'UNDER_REVIEW', by:['C'], act:'`Start Review`'},{s:'RESOLVED_ACCEPTED', by:['H'], act:'`Confirm Resolution`'},{s:'CLOSED', by:['B','S'], act:'`Accept and close`'}],
      br:[{f:'UNDER_REVIEW', t:'INFO_REQUESTED', by:['C'], act:'`Request Info`'},{f:'INFO_REQUESTED', t:'UNDER_REVIEW', by:['B','S'], act:'Party answers'},{f:'UNDER_REVIEW', t:'RESOLVED_REJECTED', by:['H'], act:'Reject the claim', note:'then CLOSED'},{f:'(open)', t:'ESCALATED', by:['X'], act:'SLA breached', note:'back to review or resolved'},{f:'RESOLVED_ACCEPTED', t:'CLOSED', by:['C'], act:'`Close Dispute` after 15 days unanswered'}] } ],
    notes:['Management can decide in place of the HOD.'] },
  { id:'note', name:'Debit / credit note', tracks:[
    { title:'A note', main:[{s:'DRAFT', by:['M'], act:'Draft, or made by a dispute'},{s:'ISSUED', by:['C'], act:'`Approve & issue`'},{s:'SETTLED', by:['M'], act:'Applied to its bill'}],
      br:[{f:'DRAFT', t:'REJECTED', by:['C'], act:'Reject'},{f:'(note)', t:'CANCELLED', by:['C'], act:'Cancel'}] } ],
    notes:['Finance can draft, approve and apply notes as well.'] },
  { id:'intimation', name:'Payment intimation', tracks:[
    { title:'The buyer’s payment intimation', main:[{s:'PENDING_CHECKER', by:['B'], act:'Level 1 prepares'},{s:'SUBMITTED', by:['B'], act:'Level 2 / 3 sends'},{s:'CONFIRMED', by:['F'], act:'`Confirm receipt`'}],
      br:[{f:'PENDING_CHECKER', t:'RETURNED_BY_CHECKER', by:['B'], act:'Its checker returns it'},{f:'SUBMITTED', t:'REJECTED', by:['F'], act:'Not in the bank'},{f:'SUBMITTED', t:'WITHDRAWN', by:['B'], act:'Withdraw before Finance acts'}] } ] },
  { id:'recon', name:'Reconciliation statement', tracks:[
    { title:'A monthly statement', main:[{s:'NEEDS_REVIEW', by:['X','M'], act:'Created, a line differs'},{s:'PENDING_SIGN_OFF', by:['C'], act:'`Override` with a reason'},{s:'CLOSED', by:['F','C','B','S'], act:'Finance concurs, SJVN signs, the company signs'}],
      br:[{f:'(created)', t:'PENDING_SIGN_OFF', by:['X','M'], act:'Every line matches'},{f:'CLOSED', t:'REOPENED', by:['C','F'], act:'Reopen request accepted'}] } ],
    notes:['AUTO_MATCHED counts as ready to sign.','Finance concurs only on statements above ₹1 crore.'] },
];

/* ───────────────────────── data: rules of the game ───────────────────────── */
const RULES = [
  { who:['M','C'], t:'Maker prepares, checker decides', d:'The checker never creates. The maker never verifies, approves, locks or signs.' },
  { who:['M','C'], t:'Four eyes on every decision', d:'Whoever onboarded a company cannot approve it. Whoever verified a bill cannot approve its Level 1.' },
  { who:['C','F','H'], t:'Bills climb by amount', d:'Up to ₹1 lakh: 1 level. Above ₹1 lakh: 2. Above ₹10 lakh: 3. Three different people, in order.' },
  { who:['F'], t:'Only Finance says money arrived', d:'The desk that raises a bill never marks it paid. Finance confirms against SJVN’s bank.' },
  { who:['A'], t:'Admin governs, never transacts', d:'Users, company log-ins, project access, delegation. Read-only on bills and money.' },
  { who:['S','B'], t:'Companies have their own maker–checker', d:'Level 1 prepares, Level 2 or 3 sends to SJVN, Level 3 runs the team.' },
  { icon:'clock', t:'The clocks run', d:'15 days to dispute a bill. SJVN acknowledges in 2 days and resolves in 15. The party has 15 days to accept or contest.' },
  { who:['B','S'], t:'Pay-when-paid', d:'A seller is paid only from what the buyer paid, less the early-payment rebate and TDS.' },
  { who:['F','C'], t:'Big statements need Finance', d:'A reconciliation above ₹1 crore needs Finance’s concurrence before SJVN signs.' },
  { icon:'check', t:'Affirm before you commit', d:'Important actions open a “Statutory affirmation” popup: tick the declaration, then “Confirm and submit”.' },
];

/* ───────────────────────── data: side quests ─────────────────────────
   The screens beyond the ten missions, each played the same way: lanes, steps,
   log-out / log-in switches and a details drawer. Labels are the platform's own. */
const QZONES = [['money','Money in and out'],['close','Closing the month'],['risk','Contracts and risk'],['platform','Platform'],['reports','Reports'],['alerts','Alerts and messages']];
const QUESTS = [
{ zone:'money', short:'Late payment surcharge', name:'Bill the late payment surcharge', screen:'REIA Billing & Settlement › Others › Month-Close Board',
  goal:'When a buyer pays after the due date, demand the surcharge its overdue bills have earned, once a month, as a bill of its own.',
  start:'Buyer’s bill {SENT}, past its due date, not fully paid', end:'LPS bill {SENT} to the buyer',
  steps:[
    { who:'M', opt:true, noquiz:true, t:'See what is running late', where:'REIA Billing & Settlement › Payment Monitoring',
      fill:['Side: Owed to SJVN (buyers)','Tick “Overdue only”'],
      rules:['Each open bill with its delay, “Surcharge billed” and “Surcharge earned, not billed”.','The same screen shows the other side: Owed by SJVN (developers).'] },
    { who:'M', t:'Raise the surcharge bills', where:'Others › Month-Close Board › Late payment surcharge for the month', press:['Raise LPS bills'],
      fill:['Billing month: the month just ended'],
      res:{o:'LPS-PSA/…', t:'DRAFT'},
      rules:['One LPS bill per buyer contract, for what its overdue bills earned up to the month’s last day and has not been billed.','Electricity (Late Payment Surcharge) Rules, 2022: calendar days past the due date, the base rate rising 0.5% a month, to 3% above it.','The base rate is the contract’s, 15% a year when none is set.','Each bill’s surcharge is billed once. Cancelling an LPS bill gives it back.'],
      block:'Checker: no `Raise LPS bills` on the board.' },
    { who:'M', t:'Submit it for approval', where:'Billing & Invoicing › the LPS bill', press:['Submit for SJVN Approval'],
      res:{o:'LPS bill', f:'DRAFT', t:'UNDER_APPROVAL'},
      rules:['It climbs the same ladder as a monthly bill: up to ₹1 lakh one level, above ₹1 lakh two, above ₹10 lakh three.'] },
    { who:'C', t:'Approve Level 1', where:'The LPS bill › Approval Workflow', press:['Approve Level 1'], fill:['Comments'],
      res:{o:'Level 1', t:'APPROVED'},
      block:'Maker: no `Approve Level …` button.' },
    { who:'F', opt:true, t:'Approve Level 2', where:'The LPS bill › Approval Workflow', press:['Approve Level 2'], fill:['Comments'],
      res:{o:'Level 2', t:'APPROVED'},
      rules:['Only above ₹1 lakh.'] },
    { who:'H', opt:true, t:'Approve Level 3', where:'The LPS bill › Approval Workflow', press:['Approve Level 3'], fill:['Comments'],
      res:{o:'LPS bill', f:'UNDER_APPROVAL', t:'APPROVED'},
      rules:['Only above ₹10 lakh. Management can sign instead of the HOD.'] },
    { who:'M', t:'Send it to the buyer', where:'The LPS bill', press:['Send Email to Buyer'],
      res:{o:'LPS bill', f:'APPROVED', t:'SENT'},
      rules:['It carries its own due date.'] },
  ],
  also:['A payment is applied to the surcharge first, oldest bill first, then to the oldest bill’s principal (PSA Art. 6.3).','Each company’s ledger shows “LPS accrued to date”.'] },

{ zone:'money', short:'Debit & credit notes', name:'Debit and credit notes', screen:'REIA Billing & Settlement › Billing & Invoicing › the bill › Debit / Credit Notes',
  goal:'Correct a bill already presented without rewriting it: a debit note asks for more, a credit note gives some back. A second person approves before either counts.',
  start:'Bill presented: {APPROVED}, {SENT} or later', end:'Note {ISSUED}',
  steps:[
    { who:'M', alt:['F'], t:'Raise the note on the bill', where:'Billing & Invoicing › click the bill’s number › Debit / Credit Notes', press:['+ Raise Note','Save as draft'],
      fill:['Type: Debit note — the party owes more, or Credit note — the party owes less','Reason code: Revised / amended REA, Change in Law, Transmission / wheeling charges, Late Payment Surcharge, Compensation event, Liquidated damages, Other','Taxable value (₹), tax on the note (₹), tax label (e.g. IGST 18%)','What the note is for (printed on it)'],
      res:{o:'Note', t:'DRAFT'},
      rules:['Saved as a draft. It takes effect only when someone else approves it.','Finance can raise notes too.'],
      refuse:['The invoice is still a draft — correct the draft instead of raising a note'],
      block:'Checker: no `+ Raise Note`.' },
    { who:'C', alt:['F'], t:'Approve and issue it', where:'REIA Billing & Settlement › Notes for Approval', press:['Approve & issue'],
      res:{o:'Note', f:'DRAFT', t:'ISSUED'},
      rules:['Each note says where it came from: Dispute resolution, Reconciliation exception, CUF true-up, Power diversion, Raised on the desk.','A note a dispute asked for shows the dispute, its evidence and the resolver’s reasoning beside the button.','`Reject` asks why it is not approved.','The bill’s own Debit / Credit Notes table has the same `Approve` and `Reject`.'],
      refuse:['Segregation of duties: whoever raised this note cannot approve it. It needs a different approver.'],
      block:'Maker: no `Approve & issue`.' },
    { who:'X', noquiz:true, t:'The note takes effect', where:'Automatic, on approval',
      res:{o:'Debit note', text:'Billed as its own supplementary invoice'},
      rules:['A debit note becomes its own supplementary bill, numbered as the note, with its own due date.','A credit note is set against the bill. What the bill cannot absorb stays on the note for another bill of the same contract.','The bill as issued is never rewritten.'] },
    { who:'M', alt:['F'], opt:true, t:'Apply leftover credit to another bill', where:'The bill › Debit / Credit Notes › the note', press:['Apply credit','Apply'],
      fill:['Choose an open bill of this contract…'],
      res:{o:'Credit', text:'Applied to the chosen bill'},
      rules:['Only another open bill of the same contract and the same side.'] },
  ],
  also:['`PDF` downloads an issued note.','`Cancel`, with a reason: the checker or Finance withdraws a draft, or cancels an issued note so its effect is reversed.','Credit notes from disputes come the same way (Mission 7).'] },

{ zone:'money', short:'Arrear & supplementary', name:'Arrear and supplementary bills', screen:'REIA Billing & Settlement › Billing & Invoicing',
  goal:'Recover charges missed in a past period, or adjust a bill for a tariff order, change in law, energy or surcharge, as a bill of its own.',
  start:'A past period was under-billed, or an order changes what is due', end:'Bill {SENT}',
  steps:[
    { who:'M', t:'Raise an arrear bill', where:'REIA Billing & Settlement › Billing & Invoicing', press:['+ Arrear Bill','Raise Arrear'],
      fill:['Contract','Arrear Period (recovering for)','Arrear Amount (₹), Taxes / GST (₹)','Reason for arrear'],
      res:{o:'Arrear bill', t:'DRAFT'},
      rules:['An arrear bill recovers charges missed or under-billed in a past period, so it is always a positive amount.','For money owed back, raise a credit note or a negative supplementary.'],
      block:'Checker: no `+ Arrear Bill`, no `+ Supplementary`.' },
    { who:'M', opt:true, t:'Or raise a supplementary bill', where:'REIA Billing & Settlement › Billing & Invoicing', press:['+ Supplementary','Create Supplementary'],
      fill:['Contract and billing period','Reason category: Revised / amended REA true-up, Change in Law, Transmission charges, Late Payment Surcharge (LPS), β true-up, Other','Adjustment amount (₹): positive debit, negative credit','Taxes / GST and transmission (₹)','Link to parent invoice (optional)','Reason / reference: the order or clause'],
      res:{o:'Supplementary bill', t:'DRAFT'},
      rules:['Creates a SUPPLEMENTARY draft with the billing family reference.'] },
    { who:'M', t:'Submit it for approval', where:'The new bill', press:['Submit for SJVN Approval'],
      res:{o:'Bill', f:'DRAFT', t:'UNDER_APPROVAL'},
      rules:['Exactly the same ladder as a monthly bill, by amount.'] },
    { who:'C', t:'Approve Level 1', where:'The bill › Approval Workflow', press:['Approve Level 1'], fill:['Comments'],
      res:{o:'Level 1', t:'APPROVED'} },
    { who:'F', opt:true, t:'Approve Level 2', where:'The bill › Approval Workflow', press:['Approve Level 2'], fill:['Comments'],
      res:{o:'Level 2', t:'APPROVED'},
      rules:['Only above ₹1 lakh.'] },
    { who:'H', opt:true, t:'Approve Level 3', where:'The bill › Approval Workflow', press:['Approve Level 3'], fill:['Comments'],
      res:{o:'Bill', f:'UNDER_APPROVAL', t:'APPROVED'},
      rules:['Only above ₹10 lakh. Management can sign instead of the HOD.'] },
    { who:'M', t:'Send it to the buyer', where:'The bill', press:['Send Email to Buyer'],
      res:{o:'Bill', f:'APPROVED', t:'SENT'} },
  ],
  also:['Late payment surcharge bills come from the Month-Close Board (Side quest 1).','A week of deviation settlement is billed from its own screen (Side quest 10).'] },

{ zone:'money', short:'Advances', name:'Advances and unapplied receipts', screen:'REIA Billing & Settlement › Others › Advances & Unapplied Receipts',
  goal:'Hold money a buyer paid that no bill could take, then apply it to a later bill of the same buyer, or refund it.',
  start:'A buyer pays more than its bill has left', end:'Advance {APPLIED} or {REFUNDED}',
  steps:[
    { who:'B', t:'Tell SJVN about the payment', where:'Buyer Portal › Billing & Payments › the bill', press:['Intimate payment to SJVN','Send to SJVN Finance'],
      fill:['Amount credited to SJVN','Payment date, mode, UTR / reference'],
      res:{o:'Intimation', t:'SUBMITTED'} },
    { who:'F', t:'Confirm it, and hold the excess', where:'REIA Billing & Settlement › Payment Monitoring › Payments to confirm', press:['Confirm receipt','Confirm and record the payment'],
      fill:['Value date in SJVN’s bank','Tick “This is more than the bill has left. Apply what the bill can take and hold the rest as the buyer’s advance”'],
      res:{o:'Advance', t:'OPEN'},
      rules:['The bill takes what it can. The rest appears under Advances as “Paid beyond the bill”.'],
      block:'Maker and checker cannot confirm a receipt.' },
    { who:'F', t:'Apply it to a later bill', where:'Advances & Unapplied Receipts › the advance', press:['Apply to a bill','Apply'],
      fill:['Bill','Amount (blank = as much as both allow)'],
      res:{o:'Advance', f:'OPEN', t:'APPLIED'},
      rules:['Only to the same company’s open bills.','Applied in part, the advance stays OPEN with what is left.'],
      refuse:['INV-… is not a bill of …, so this advance cannot settle it'],
      block:'Maker and checker: no `Apply to a bill`, no `Refund`.' },
    { who:'F', opt:true, t:'Or refund it', where:'Advances & Unapplied Receipts › the advance', press:['Refund','Record refund'],
      fill:['Amount (blank = all that is left)','Refund UTR','Why refunded, not applied'],
      res:{o:'Advance', f:'OPEN', t:'REFUNDED'},
      refuse:['Say why the advance is refunded rather than applied'] },
  ],
  also:['A power diversion that recovers more than the buyer owes lands here too, as “Diversion surplus” (Side quest 16).'] },

{ zone:'money', short:'Release planner', name:'Release buyer receipts to the generators', screen:'REIA Billing & Settlement › Others › Developer Release Planner',
  goal:'Pass on, in one sitting, what buyers have paid that is each generator’s energy share.',
  start:'Buyer’s bill {PAID}, the developer’s bill open', end:'Developer’s bill paid from buyer receipts',
  steps:[
    { who:'F', noquiz:true, t:'See what each generator can be paid', where:'REIA Billing & Settlement › Others › Developer Release Planner',
      rules:['Buyer receipts that are the generator’s energy share — no margin, no credit notes — against what each developer bill still has open.','Totals: Open on developer bills, Realised, not released, Releasable now.','A row that cannot be released says why under “Releasable now”.'] },
    { who:'C', alt:['F'], t:'Release from buyer receipts', where:'Developer Release Planner › the developer’s bill', press:['Release','Release from buyer receipts'],
      fill:['Amount (₹): up to what is releasable now','Payment date','UTR / reference'],
      res:{o:'Developer’s bill', text:'Released'},
      block:'Maker: no `Release` on the planner.' },
    { who:'S', opt:true, noquiz:true, t:'See the payment', where:'Seller Portal › Payments & Ledger', press:['View payment advice'],
      rules:['The release shows under the ledger’s Payments.'] },
  ],
  also:['A release on one bill, with TDS and the early-payment rebate, is Mission 9.'] },

{ zone:'money', short:'Ledgers & TDS', name:'Ledgers and TDS certificates', screen:'REIA Billing & Settlement › Others › Counterparty Ledgers & TDS',
  goal:'Keep each company’s statement of account, and file the quarterly TDS certificates (Form 16A) in both directions.',
  start:'A quarter has ended', end:'Certificates filed and reconciled',
  steps:[
    { who:'F', t:'File the seller’s Form 16A', where:'Counterparty Ledgers & TDS › Ledger of one party › Sellers (payable) › the seller › TDS certificates', press:['+ File a certificate','File certificate'],
      fill:['Financial year, e.g. 2026-27','Quarter: Q1 — Apr–Jun to Q4 — Jan–Mar','Certificate number','TDS on the certificate (₹)','Certificate (PDF)'],
      res:{o:'Form 16A', text:'Filed'},
      rules:['The quarterly certificate for the tax SJVN deducted at source from the seller’s payments.'] },
    { who:'S', noquiz:true, t:'Download the certificate', where:'Seller Portal › Payments & Ledger › TDS certificates', press:['View / download'],
      rules:['The seller claims the credit in its income-tax return.','Its ledger has four tabs: Outstanding & ageing, Ledger, Payments, TDS certificates.'] },
    { who:'B', t:'File its own certificate', where:'Buyer Portal › Billing & Payments › Payment Ledger & Receipts › TDS certificates', press:['+ File a certificate','File certificate'],
      rules:['For the tax the buyer deducted at source from its payments to SJVN, so SJVN can claim the credit.','A checker, approver or the company admin files them.'] },
    { who:'F', t:'Reconcile TDS against Form 16A', where:'Counterparty Ledgers & TDS › TDS vs Form 16A (all parties)', press:['Mark','Save'],
      fill:['Reconciliation: Reconciled, or Mismatch — taken up with the party','Note'],
      res:{o:'Quarter', text:'Reconciled'},
      block:'Maker and checker: no `Mark`.' },
  ],
  also:['`Statement (PDF)` and `Statement (Excel)` give any party’s account for a period.','A buyer’s ledger works the same way, as receivable.'] },

{ zone:'close', short:'Month-Close Board', name:'Close the month on one board', screen:'REIA Billing & Settlement › Others › Month-Close Board',
  goal:'One month, closed in order: energy locked and billed, statements reconciled, surcharge billed, and the open items Finance should see before it books the month.',
  start:'The month is over', end:'Every live contract billed and reconciled',
  steps:[
    { who:'X', noquiz:true, t:'One row per live contract', where:'Month-Close Board',
      res:{o:'Row', text:'Ready'},
      rules:['Each row answers: energy locked? PPA bill in? already billed?','Standing: Ready, Billed, Waiting for energy, Blocked, Month not over.','A month that has not ended cannot be billed; the board names the latest that can.'] },
    { who:'M', t:'Raise every ready bill', where:'Month-Close Board', press:['Generate all ready (n)'],
      fill:['Billing month'],
      res:{o:'Each ready bill', t:'DRAFT'},
      rules:['Bills are raised as drafts through the same Generate path, one at a time.','Each goes for approval under Billing & Invoicing (Mission 6).','A row that could not be raised says why in the popup.'],
      block:'Checker: no `Generate all ready`.' },
    { who:'M', opt:true, t:'Run the month’s reconciliations', where:'Month-Close Board › Reconciliation', press:['Run'],
      res:{o:'Statement', text:'Raised'},
      rules:['A month is reconciled once its energy is locked and its bill presented.','The hourly job usually gets there first (Mission 10).'] },
    { who:'M', opt:true, noquiz:true, t:'Raise the surcharge bills', where:'Month-Close Board › Late payment surcharge', press:['Raise LPS bills'],
      res:{o:'LPS bill', t:'DRAFT'},
      rules:['The whole surcharge run is Side quest 1.'] },
    { who:'F', noquiz:true, t:'Check the posting checklist', where:'Month-Close Board › Posting checklist',
      res:{o:'Checklist', text:'Nothing open'},
      rules:['The open items before Finance books the month, each with a count and an amount.','Finance then books the month (Side quest 9).'] },
  ],
  also:['Pick another month with the month box. A month still running cannot be picked.'] },

{ zone:'close', short:'Invoice Verification', name:'Verify developer bills', screen:'REIA Billing & Settlement › Others › Invoice Verification',
  goal:'Run the technical and commercial checks on every developer bill, and send back what fails with exactly what failed.',
  start:'Seller’s bill {SUBMITTED}', end:'Bill verified, or back with the developer',
  steps:[
    { who:'S', t:'Submit its bill', where:'Seller Portal › My Invoices', press:['+ Create Invoice','Submit to SJVN'],
      res:{o:'Seller’s bill', t:'SUBMITTED'} },
    { who:'M', t:'Verify the bills that pass', where:'REIA Billing & Settlement › Others › Invoice Verification', press:['Verify selected (n)'],
      fill:['Filter: Everything, Not started, In progress, Failed a check, Verified','Tick the bills'],
      res:{o:'Verification', t:'VERIFIED'},
      rules:['Bulk verification takes only bills whose automatic checks all pass and whose build-up meets the bill.','For each, capacity is confirmed and curtailment and change in law are marked not claimed.','Any other bill: `Open the bill to verify it` › Verification Checklist (Mission 6).'],
      block:'Checker: no `Verify selected`.' },
    { who:'C', opt:true, t:'Send back what fails', where:'Invoice Verification › the bill', press:['Send back to the developer'],
      res:{o:'Seller’s bill', f:'SUBMITTED', t:'REJECTED'},
      rules:['It goes back with exactly what failed.','Only a bill still with SJVN can be sent back.'],
      block:'Maker: no `Send back to the developer`.' },
    { who:'S', opt:true, t:'Correct it and resubmit', where:'Seller Portal › My Invoices › the bill', press:['Revise the bill','Resubmit to SJVN'],
      res:{o:'Seller’s bill', f:'REJECTED', t:'SUBMITTED'},
      rules:['`Revise the bill` reworks the figures from the locked energy; `Resubmit to SJVN` sends it back to SJVN’s desk, where a new bill lands.','Revising clears the verification, so the maker verifies it again and sends it into approval.','A Level 1 maker’s bill goes to its own checker, who sends it to SJVN again.'] },
  ],
  also:['“Approved without a completed verification” lists any bill that slipped through.','“Value awaiting verification” totals what is held up.'] },

{ zone:'close', short:'Finance posting (SAP)', name:'Hand the month to Finance and SAP', screen:'Finance & SAP Integration › REIA › Finance Posting (FI)',
  goal:'The month-end handover of REIA billing to corporate Finance: sales, purchases and credit notes, each booked once.',
  start:'The month’s bills issued or accepted', end:'Posting {POSTED}',
  steps:[
    { who:'M', t:'Prepare the posting', where:'Finance Posting (FI) › Prepare a month', press:['Prepare the posting'],
      fill:['Month','What Finance is booking: Sale to buyers (receivable), Purchase from developers (payable), or Credit notes issued'],
      res:{o:'Posting', t:'PREPARED'},
      rules:['Shows the documents waiting, energy, SJVN margin, pass-through and the total to book.','Open month-close items do not stop it; the Month-Close Board has the detail.'],
      block:'Checker: no `Prepare the posting`.' },
    { who:'C', t:'Push the sale to SAP', where:'Postings › the posting › SAP', press:['SAP','Push to SAP'],
      res:{o:'Each invoice', text:'Sent to SAP'},
      rules:['Each invoice goes to SAP as one document: the receivable on key 40 and its parts on key 50.','An invoice already in SAP is not sent again.','Pushing books the posting, so it is the checker’s step.'],
      block:'Maker: no `Push to SAP`.' },
    { who:'C', alt:['M'], noquiz:true, t:'Read back the FI document', where:'Postings › the posting › SAP', press:['Read back from SAP'],
      res:{o:'Posting', f:'PREPARED', t:'POSTED'},
      rules:['Once SAP has posted every invoice, the posting shows as posted, under SAP’s FI documents.'] },
    { who:'C', opt:true, t:'Or record Finance’s voucher', where:'Postings › the posting', press:['Post','Post it'],
      fill:['Finance document number, e.g. SAP-JV-2026-08-9901'],
      res:{o:'Posting', f:'PREPARED', t:'POSTED'},
      rules:['For a posting not sent to SAP: purchases, credit notes.','Whoever prepared a batch does not also book it.'],
      refuse:['You prepared this posting, so someone else books it.'] },
    { who:'C', opt:true, t:'Reverse a wrong posting', where:'Postings › the posting', press:['Reverse','Reverse it'],
      fill:['Reason (at least 10 characters)'],
      res:{o:'Posting', f:'POSTED', t:'REVERSED'},
      rules:['A posting still PREPARED is withdrawn instead: `Withdraw`.','Once in SAP, SAP books it: no reversal from here.'] },
  ],
  also:['`Test SAP connection` checks the link before a push.','The platform books the sale; SAP takes the finance (FI) part.'] },

{ zone:'close', short:'Deviation (DSM)', name:'Deviation settlement (DSM)', screen:'REIA Billing & Settlement › Others › Deviation Settlement (DSM)',
  goal:'Bill each week’s grid deviation charge or credit at the figure NRPC published, as a supplementary bill.',
  start:'NRPC has issued the week’s Deviation Settlement Account', end:'Week {DISPATCHED}, its bill approved',
  steps:[
    { who:'M', t:'Upload the NRPC statement', where:'Deviation Settlement (DSM)', press:['Upload official NRPC DSA','Import statement'],
      fill:['Statement PDF'],
      res:{o:'Statement', text:'Held for its week'},
      rules:['NRPC prints Paid (+) / Received (−). The platform records + recoverable / − payable, the reverse sign.','1 LU = 100 MWh.'],
      block:'Checker: no `Upload official NRPC DSA`, no `Raise from NRPC statement`.' },
    { who:'M', t:'Raise the week from it', where:'Deviation Settlement (DSM)', press:['Raise from NRPC statement','Raise this week'],
      fill:['Contract: the project’s PPA','NRPC statement (week)','The entity, as the statement names it','Notes (optional)'],
      res:{o:'Week', t:'CALCULATED'},
      rules:['The week is recorded at the figure NRPC published; nothing is computed here.','Nothing is billed until you generate the supplementary bill.'] },
    { who:'M', t:'Generate the supplementary bill', where:'Deviation Settlement (DSM) › the week', press:['Generate supplementary bill','Dispatch & Create Invoice'],
      fill:['Bill / Invoice No. (optional): auto-generated if blank (DSM-PPA / DSM-PSA)','Dispatch Date'],
      res:{o:'Week', f:'CALCULATED', t:'DISPATCHED'},
      rules:['Creates a supplementary invoice linked to the week, as a draft. Once raised, the week is frozen.'],
      refuse:['This row is a manual estimate, not the published settlement, so it cannot be billed.'] },
    { who:'M', t:'Submit the bill for approval', where:'Billing & Invoicing › the DSM bill', press:['Submit for SJVN Approval'],
      res:{o:'DSM bill', f:'DRAFT', t:'UNDER_APPROVAL'},
      rules:['Then the usual ladder by amount: checker, Finance above ₹1 lakh, HOD above ₹10 lakh.'] },
    { who:'C', t:'Approve Level 1', where:'The DSM bill › Approval Workflow', press:['Approve Level 1'], fill:['Comments'],
      res:{o:'Level 1', t:'APPROVED'} },
  ],
  also:['`Add manual estimate`: (actual − scheduled) MWh × rate, labelled an estimate. Use it to accrue, not to bill.','A reissued statement marks the week superseded: import the current one.','`View source` opens the NRPC statement a figure came from.'] },

{ zone:'risk', short:'Contract changes', name:'Amend a live contract', screen:'REIA Billing & Settlement › Contracts (PPA/PSA)',
  goal:'Change a signed contract’s terms from a date, as a new version, so the old terms stay on record.',
  start:'Contract {ACTIVE}; an order or agreement changes its terms', end:'New version {ACTIVE}, old one {AMENDED}',
  steps:[
    { who:'M', t:'Draft the amendment', where:'Contracts (PPA/PSA) › the contract', press:['Amend Contract','Submit Amendment (Creates v2)'],
      fill:['The terms that change','Effective From','Amendment Reason / Reference, e.g. CERC Tariff Order, Mutual Agreement, SCOD Extension'],
      res:{o:'Version 2', t:'PENDING_REGULATORY_APPROVAL'},
      rules:['A contract still DRAFT or UNDER_NEGOTIATION is corrected in place instead: `Edit Draft` › `Save Draft Changes`, no new version.','The effective date cannot be before the contract began.'],
      refuse:['The amendment changes none of the contract terms — nothing to submit.','Give the date the amendment takes effect from — an amendment applies from a date.'],
      block:'Checker: no `Amend Contract`.' },
    { who:'C', t:'Make the new version live', where:'Version 2', press:['Update Lifecycle Stage','ACTIVE','Update Status'],
      res:{o:'Version 2', f:'PENDING_REGULATORY_APPROVAL', t:'ACTIVE'},
      rules:['Making it live is what retires the version it replaces.'],
      block:'Maker: no ACTIVE in the list.' },
    { who:'X', noquiz:true, t:'The old version retires', where:'Automatic, when version 2 goes live',
      res:{o:'Version 1', f:'ACTIVE', t:'AMENDED'},
      rules:['The two versions hand over on the effective date: the old one’s mappings end the day before, the new one’s start that day.'] },
  ],
  also:['Terminate, close, renew: the checker, through `Update Lifecycle Stage`. Terminating asks for the date, the ground and the notice reference.','Holds: Side quest 12.','Many contracts at once: the maker’s bulk upload.'] },

{ zone:'risk', short:'Compliance & holds', name:'Compliance Desk: flags and holds', screen:'REIA Billing & Settlement › Others › Compliance Desk',
  goal:'See which contracts fall short on tenure, commissioning, capacity, payment security or statutory approvals, ask for what is missing, and hold a contract when it must stop.',
  start:'A contract misses something it owes', end:'Back in order, or held with a reason',
  steps:[
    { who:'X', noquiz:true, t:'Flag what is out of order', where:'Compliance Desk › Contract Compliance',
      res:{o:'Contract', text:'Not compliant'},
      rules:['Tenure, commissioning, capacity, payment security and statutory approvals, per contract.','Counts: Not compliant, Action due, In order.','The notice window (days, 90 to start with) sets how far ahead “Action due” looks.'] },
    { who:'M', t:'Ask the counterparty', where:'Compliance Desk › the contract › the item', press:['Ask the counterparty'],
      res:{o:'Request', text:'Sent to the counterparty'},
      block:'Checker: no `Ask the counterparty`.' },
    { who:'M', alt:['C'], t:'Put the contract on hold', where:'Compliance Desk › the contract › Hold', press:['Put on hold','Save'],
      fill:['Reason (at least 15 characters)'],
      res:{o:'Hold', text:'On hold'},
      rules:['On hold, no new SJVN bill is generated on the contract: generating one is refused with “… is on hold, so … is stopped”.','Not held, the row reads “New bills and scheduling go ahead.”'] },
    { who:'H', alt:['G'], opt:true, t:'Lift a breach for a stated time', where:'Compliance Desk › the contract › Hold', press:['Lift for a stated time','Save'],
      fill:['Reason (at least 15 characters)','Lifted until (30 days at most)'],
      res:{o:'Hold', text:'Lifted until the date'},
      rules:['Only the HOD or Management lifts a hold that a breach put on.'],
      block:'Maker and checker: no `Lift for a stated time`.' },
    { who:'M', alt:['C','H'], opt:true, noquiz:true, t:'Release a manual hold', where:'Compliance Desk › the contract › Hold', press:['Release hold','Save'],
      fill:['Reason (at least 15 characters)'],
      res:{o:'Hold', text:'Not held'} },
  ],
  also:['When the automatic hold is switched off, a breach shows as “Flag only”.'] },

{ zone:'risk', short:'CUF true-up', name:'Generation performance and the CUF true-up', screen:'REIA Billing & Settlement › Others › Generation Performance',
  goal:'Compare energy with what each project’s capacity could make, and settle a contract year’s CUF shortfall with a credit note.',
  start:'Contract year over, every month of it locked', end:'True-up credit note {ISSUED}',
  steps:[
    { who:'X', noquiz:true, t:'Assess the contract year', where:'Generation Performance › Contract-year CUF and the year-end true-up',
      res:{o:'Assessment', text:'True-up due'},
      rules:['CUF is assessed over the contract year (from the tenure start, from the COD in the first year), not month by month.','States: Year in progress, Waiting on locked energy, CUF met, True-up due, Note raised.'] },
    { who:'M', alt:['F'], t:'Raise the true-up note', where:'Generation Performance › the contract year', press:['Raise true-up note'],
      res:{o:'Credit note', t:'DRAFT'},
      rules:['Raised on the year’s last bill, for the shortfall’s value.','With no bill presented in the year, there is nothing to set it against.'],
      block:'Checker: no `Raise true-up note`.' },
    { who:'C', alt:['F'], t:'Approve it', where:'REIA Billing & Settlement › Notes for Approval', press:['Approve & issue'],
      res:{o:'Credit note', f:'DRAFT', t:'ISSUED'},
      rules:['The queue shows it as “CUF true-up”.','Whoever raised it cannot approve it.'] },
  ],
  also:['By project: energy accounted, CUF over the period, months below the contract CUF.','Narrow it with From (month) and To (month).'] },

{ zone:'risk', short:'Invoke security', name:'Invoke the payment security', screen:'REIA Billing & Settlement › Payment Security',
  goal:'When a buyer stops paying, draw on its security in waterfall order and follow the claim until the money arrives.',
  start:'Buyer’s bills 30 days or more past due', end:'Invocation {FUNDS_RECEIVED}',
  steps:[
    { who:'M', t:'Start the invocation', where:'Payment Security › Start waterfall invocation', press:['Invoke waterfall','Confirm invocation'],
      fill:['Contract: the PSA','Amount (optional): leave it blank for everything 30 days or more past due and not already demanded'],
      res:{o:'Invocation', t:'NOTICE_ISSUED'},
      rules:['Waterfall order: the counterparty’s own instrument first, pooled funds last. On a PSA that is the buyer’s letter of credit.','A demand notice is raised and the counterparty is told. It cannot be undone from this screen.','On a PPA it is the seller’s guarantee: enter the amount and what the seller defaulted on.'],
      block:'Checker: no `Invoke waterfall`.' },
    { who:'C', t:'Lodge the claim with the bank', where:'Payment Security › Invocations › the row', press:['Claimed','Save'],
      fill:['Claim submitted to the bank on','Bank / claim reference'],
      res:{o:'Invocation', f:'NOTICE_ISSUED', t:'CLAIMED'},
      rules:['The bank has 7 days from the claim to honour or refuse it. After that the claim is flagged as late.'],
      block:'Maker: no `Claimed`, `Funds in` or `Bank refused`.' },
    { who:'C', t:'Record the bank’s answer', where:'Payment Security › Invocations › the row', press:['Funds in','Save'],
      fill:['Bank paid on'],
      res:{o:'Invocation', f:'CLAIMED', t:'FUNDS_RECEIVED'},
      rules:['If the bank says no: `Bank refused`, with the date. The invocation ends REJECTED.'] },
    { who:'M', opt:true, noquiz:true, t:'File the bank’s letter', where:'Payment Security › Invocations › the row', press:['Attach bank letter'],
      rules:['The demand letter itself: `View` or `PDF` on the row.'] },
  ],
  also:['How much cover is required, and the waterfall: Mission 4.'] },

{ zone:'risk', short:'Release security', name:'Release the payment security', screen:'REIA Billing & Settlement › Payment Security › Release queue',
  goal:'Give a company’s security back once it owes nothing and has no open dispute, on two signatures.',
  start:'Nothing owed, no open dispute', end:'Instrument {RELEASED}',
  steps:[
    { who:'S', t:'Ask for the release', where:'Seller Portal › Payment Security › the instrument', press:['Request release','Send release request'],
      fill:['Reason / milestone reference, e.g. COD achieved on 12 Aug 2026; EMD to be returned.'],
      res:{o:'Instrument', t:'RELEASE_PENDING'},
      rules:['The screen warns first if anything is outstanding or a dispute is open: a request made then is likely to be refused.','The buyer asks the same way. The maker or Finance can ask from the desk.'] },
    { who:'F', t:'Sign off for Finance', where:'REIA Billing & Settlement › Payment Security › Release queue', press:['Sign off for Finance'],
      res:{o:'Checklist', text:'Finance signed off'},
      rules:['Each request shows its checklist, item by item, and its position today: dues and open disputes.'] },
    { who:'C', t:'Release it', where:'Payment Security › Release queue', press:['Release'],
      res:{o:'Instrument', f:'RELEASE_PENDING', t:'RELEASED'},
      rules:['`Release` stays disabled until every item on the checklist is met.','`Refuse` asks why, and the company is told.','Finance can release too, but not one it signed off or asked for.'],
      refuse:['You signed off this release for Finance, so someone else releases it.','You asked for this release; another officer decides it.'],
      block:'Maker: no `Release` in the queue.' },
  ],
  also:['Short cover can be treated as adequate for up to 90 days, with a reason: HOD or Management (Adequacy overrides).'] },

{ zone:'risk', short:'Power diversion', name:'Power diversion on default', screen:'REIA Billing & Settlement › Others › Power Diversion',
  goal:'When a buyer does not pay or does not take the power, sell it elsewhere and set the proceeds against its dues (PSA Art. 6.6).',
  start:'Buyer in payment default, or power not requisitioned', end:'Diversion {RECOVERED}',
  steps:[
    { who:'M', t:'Record the diversion', where:'REIA Billing & Settlement › Others › Power Diversion', press:['+ Record Diversion','Record'],
      fill:['PSA Contract (defaulting buyer)','Period','Reason: Payment default, or Power not requisitioned','Quantum Diverted (MWh)','Sale Rate (₹/MWh) and Expenses (₹)'],
      res:{o:'Diversion', t:'RECORDED'},
      rules:['Net gain: what the sale fetched, less the expenses.','Payment default needs a bill past its due date.'],
      refuse:['… has no bill past its due date, so the buyer is not in payment default. If the buyer did not schedule the power, record it as not requisitioned.'],
      block:'Checker: no `+ Record Diversion`.' },
    { who:'M', t:'Recover the gain against dues', where:'Power Diversion › the row', press:['Recover against dues','Recover'],
      res:{o:'Diversion', f:'RECORDED', t:'RECOVERED'},
      rules:['Set against the buyer’s dues on the PSA, surcharge first and oldest bill first.','Whatever the PSA does not owe is held as the buyer’s advance (Side quest 4).'] },
    { who:'M', opt:true, t:'Or bill the deficit', where:'Power Diversion › the row', press:['Bill the deficit','Draft debit note'],
      res:{o:'Debit note', t:'DRAFT'},
      rules:['A sale below costs leaves the buyer owing the deficit. It is drafted as a debit note on the buyer’s latest bill.'] },
    { who:'F', alt:['C'], opt:true, t:'Approve the debit note', where:'REIA Billing & Settlement › Notes for Approval', press:['Approve & issue'],
      res:{o:'Debit note', f:'DRAFT', t:'ISSUED'},
      rules:['The queue shows it as “Power diversion”.'] },
  ],
  also:['`Cancel` takes a RECORDED diversion out of every total.'] },

{ zone:'risk', short:'Energy banking', name:'Energy banking', screen:'REIA Billing & Settlement › Others › Energy Banking',
  goal:'Credit the seller with energy the buyer could not take, draw it back later in the cycle, and settle what is left in cash once the cycle closes.',
  start:'A locked month with energy the buyer could not take', end:'Cycle {SETTLED}',
  steps:[
    { who:'M', t:'Bank the energy', where:'Energy Banking › the PPA', press:['+ Bank Energy','Bank Energy'],
      fill:['PPA Contract','Month generated (locked)','Energy Banked (MWh)'],
      res:{o:'Banked energy', t:'OPEN'},
      rules:['Banking Cycle and Cycle Ends On fill themselves once you pick the month, by the PPA’s banking basis: monthly unless the PPA sets seasonal (Apr–Sep / Oct–Mar) or annual (the financial year).','A month’s energy locks only after the month, so a cycle takes entries until the end of the month after it ends: September’s monthly cycle is banked, and drawn, in October.','Before you bank, the form shows what the seller would be paid if the energy were never drawn, so the discount is visible.'],
      refuse:['The cycle ended on … and took entries until …; energy cannot be banked into a closed cycle.'],
      block:'Checker: no `+ Bank Energy`.' },
    { who:'M', t:'Draw it back', where:'Energy Banking › the cycle', press:['Draw','Draw'],
      fill:['Cycle','Draw (MWh)'],
      res:{o:'Still available', text:'Less the draw'},
      rules:['Only while the cycle takes entries: until the end of the month after it ends. After that it settles in cash; it is not drawn from.','The generator bills the draw at the full tariff, and each buyer its share. A draw recorded after the cycle ended is billed in the cycle’s last month.'] },
    { who:'C', t:'Settle closed cycles', where:'Energy Banking', press:['Settle Closed Cycles','Settle'],
      res:{o:'Unused energy', t:'SETTLED'},
      rules:['Only a cycle whose entries have closed (the month after it ended) is settled. The sweep also runs every night.','Unused energy settles in cash at a discount to tariff: 75% of tariff unless SJVN sets another figure.','It is billed, and passed on to the buyers for their share.'],
      block:'Maker: no `Settle Closed Cycles`.' },
  ],
  also:['Totals: Banked, Drawn Back, Still Available, Cash Settled.'] },

{ zone:'platform', short:'Additional charge', name:'Cover an officer who is away', screen:'Platform › Additional Charge & Break-glass',
  goal:'When an officer is on leave, another officer holds the charge for a stated period and acts in their place, every action under their own name.',
  start:'An officer goes on leave, tour or training', end:'Charge {IN_FORCE}, the work goes on',
  steps:[
    { who:'A', t:'Record the additional charge', where:'Platform › Additional Charge & Break-glass › Additional charges', press:['Record a charge','Record'],
      fill:['Officer who is away','Officer who holds the charge','From, and To (up to 90 days)','Projects, if the charge covers only some','Reason and office order'],
      res:{o:'Charge', t:'IN_FORCE'},
      rules:['An officer cannot hold their own charge.','An administrator does not transact, so cannot hold a desk charge.','A charge runs for at most 90 days; record a new one to extend it.'],
      block:'Desk officers: no `Record a charge`.' },
    { who:'C', noquiz:true, t:'Act for the absent officer', where:'Additional Charge & Break-glass › You can act as (or the “Work as” list in the top bar)', press:['Act now'],
      res:{o:'Top bar', text:'Acting for the absent officer'},
      rules:['The banner reads “Additional charge: you are acting for … as … until …”.','What you do is recorded under your own name.'] },
    { who:'C', noquiz:true, t:'Go back to your own role', where:'The banner in the top bar', press:['Work as myself'],
      res:{o:'Top bar', text:'Your own role'} },
    { who:'A', opt:true, noquiz:true, t:'End the charge early', where:'Additional charges › the charge', press:['Withdraw'],
      res:{o:'Charge', text:'Withdrawn'} },
  ],
  also:['Management and the compliance auditor can read every charge.','Here the checker holds the charge. Any desk officer can.'] },

{ zone:'platform', short:'Break-glass', name:'Break-glass: emergency access', screen:'Platform › Additional Charge & Break-glass › Break-glass',
  goal:'When work cannot wait and nobody who holds the role can act, open that role for a few hours, on two approvals.',
  start:'Urgent work, and nobody holding the role is available', end:'The grant closes by itself',
  steps:[
    { who:'M', noquiz:true, t:'Ask for break-glass', where:'Additional Charge & Break-glass › Break-glass', press:['Ask for break-glass'],
      fill:['Role needed','For: 1 to 72 hours','What cannot wait, and why nobody who holds the role can act (at least 15 characters)'],
      res:{o:'Request', t:'REQUESTED'},
      rules:['It opens only after two approvals and closes by itself.','Ask as yourself, not while acting for someone.'],
      refuse:['You already have a request or an open grant for that role'] },
    { who:'G', noquiz:true, t:'Give the first approval', where:'Break-glass › the request', press:['Approve'],
      res:{o:'Request', text:'A second approver is needed'},
      rules:['Management, SJVN Admin or IT Super Admin approves. One of the two approvals must come from Management.','Nobody approves their own break-glass. `Refuse` asks why.'] },
    { who:'A', noquiz:true, t:'Give the second approval', where:'Break-glass › the request', press:['Approve'],
      res:{o:'Grant', t:'ACTIVE'},
      refuse:['A second, different approver is needed','One of the two approvals must come from Management'] },
    { who:'M', noquiz:true, t:'Work under the grant', where:'Top bar › Work as › Break-glass — the role',
      res:{o:'Top bar', text:'Working as the role'},
      rules:['The banner reads “Break-glass: you are working as … until …”.','Everything you change is flagged in the audit trail.','`End` closes it before the hours run out.'] },
  ],
  also:['For a planned absence, use an additional charge instead (Side quest 18).'] },

{ zone:'platform', short:'Project access', name:'Who works on which project', screen:'Platform › Project Assignments',
  goal:'Give each maker, checker and approver all REIA projects or only some, and make sure every project has someone at every tier.',
  start:'A new officer, or a project changing hands', end:'Every project fully covered',
  steps:[
    { who:'A', t:'Set an officer’s projects', where:'Project Assignments › REIA officers › the officer', press:['Change','Save'],
      fill:['Works on: All REIA projects, or Only the projects ticked below','Find a project: contract no., seller, buyer or type'],
      res:{o:'Officer', text:'All projects, or n selected'},
      rules:['Only SJVN Admin (or IT Super Admin) changes it. Management and the compliance auditor read it.'],
      block:'Maker, checker and HOD: the page is not on their menu.' },
    { who:'X', noquiz:true, t:'Check every project is covered', where:'Project Assignments › Who covers each project',
      res:{o:'Cover', text:'Full'},
      rules:['“No …” names the tier nobody covers.','A daily alert tells SJVN Admin when a project has nobody to act at a tier.'] },
    { who:'M', opt:true, noquiz:true, t:'Work on those projects only', where:'Every REIA screen',
      rules:['An officer on selected projects sees only those projects’ work.'] },
  ],
  also:['An additional charge can also be limited to some projects (Side quest 18).'] },

{ zone:'platform', short:'Audit trail', name:'Read the audit trail', screen:'Platform › Audit Trail',
  goal:'A complete, tamper-proof history of every action taken on the platform: who, when, and the value before and after.',
  start:'Any question about who did what', end:'The record found, the chain checked',
  steps:[
    { who:'X', noquiz:true, t:'Log every action', where:'Automatic, on every change',
      res:{o:'Event', text:'Recorded'},
      rules:['Who, when, and the value before and after.','A change made while acting for someone is its own entry.'] },
    { who:'A', t:'Find the record', where:'Platform › Audit Trail', press:['View full details'],
      fill:['Search people, actions, record IDs, reasons, details…','Narrow by module, action, user, record type or date'],
      rules:['The counts at the top: Events, People, Security events, Exports & downloads, Duty conflicts, Record integrity.','Duty conflicts: `Review them`.'] },
    { who:'A', t:'Check nothing was altered', where:'Audit Trail › Record integrity', press:['Verify full chain'],
      res:{o:'Record integrity', text:'Checked'},
      rules:['A broken link is named: `Open the broken record`.'] },
    { who:'A', opt:true, t:'Export the evidence', where:'Audit Trail', press:['Audit Report (PDF)'],
      rules:['Also `Activity Report (PDF)` and `Export CSV`.'] },
  ],
  also:['The compliance auditor reads the same trail.'] },

{ zone:'close', short:'CERC Form-IV', name:'File the CERC Form-IV return', screen:'REIA Billing & Settlement › Others › Compliance Desk › CERC Regulatory Compliance',
  goal:'Report the month’s PPA/PSA sales to CERC on Form-IV: the maker prepares the return, the checker files it.',
  start:'The month’s PSA bills issued', end:'Return {SUBMITTED} on CERC’s reference',
  steps:[
    { who:'M', t:'Open the month on the calendar', where:'CERC Regulatory Compliance › Calendar', press:['Prepare Form-IV'],
      res:{o:'Form-IV screen', text:'Opens with the month chosen'},
      rules:['Every completed month is listed, `Not started` until someone begins its return. A month with nothing billed still owes a NIL return.','`Annexures` shows the month on IV-D and IV-E before the return is started.'] },
    { who:'M', t:'Create the return from the bills', where:'Form-IV › New Form-IV Filing', press:['Create Filing'],
      fill:['Period Type: Monthly','Month','Pre-fill transactions from the month’s PPA/PSA bills (ticked)'],
      res:{o:'Return', t:'DRAFT'},
      rules:['One line per PSA and the PPA allocated to it: the energy billed to the discom, both prices and the SJVN margin.','A PPA/PSA sale is long-term, so its line is marked EXEMPT from the margin cap.','Power from SJVN’s own projects is left out.'],
      block:'Checker: no `+ New Filing`, no `Regenerate from bills`.' },
    { who:'M', opt:true, t:'Rebuild after a bill changes', where:'Form-IV › the return', press:['Regenerate from bills'],
      res:{o:'Lines', text:'Rebuilt from the bills'},
      rules:['Lines added with `+ Add transaction` stay, renumbered after the rebuilt ones.','A line missing a price, or over the cap without a reason, stops the filing.'] },
    { who:'C', t:'File it with CERC', where:'Form-IV › the return', press:['Mark Submitted to CERC','Confirm and submit'],
      fill:['CERC Filing Reference No.','The statutory declaration (tick)'],
      res:{o:'Return', f:'DRAFT', t:'SUBMITTED'},
      rules:['Filed on CERC’s acknowledgement reference. The return is then locked: it is the filed record.','Due by the 15th of the next month.'],
      block:'Maker: no `Mark Submitted to CERC`; the return says the REIA checker files it.' },
    { who:'M', opt:true, noquiz:true, t:'Roll up the year', where:'Form-IV › Annual return', press:['Roll up annual'],
      res:{o:'Annual return', t:'DRAFT'},
      rules:['Built from the twelve filed monthlies, once all are filed. The checker files it by 30 April.'] },
  ],
  also:['`Already filed outside the platform?` records a return filed before the platform held it, on CERC’s acknowledgement.','`Export CSV`, `CERC Excel (annexures)` and `Download PDF` give the return in the filed layouts.'] },

{ zone:'reports', short:'Reports', name:'Pull a report, and share it', screen:'REIA Billing & Settlement › REIA Dashboard › Reports',
  goal:'Any figure the desk holds, as a report on screen and as CSV, Excel or PDF: a ready-made one in a click, or one built to your own columns, filters and grouping, saved and shared with the desk.',
  start:'Someone needs the desk’s figures', end:'The report on screen, downloaded, saved for next time',
  steps:[
    { who:'M', alt:['C','H','F','G','A'], noquiz:true, t:'Open a ready-made report', where:'REIA Dashboard › Reports › Predefined reports', press:['View report'],
      lists:{ 'Every SJVN officer of the desk: 20 reports (Management and SJVN Admin also “Audit trail by user”)':['Billing: the bills registers (PSA, PPA) and monthly billing','Money: payments, outstanding and ageing on both sides, LPS, rebates','Disputes and notes: disputes register, open disputes by reason, debit and credit notes','Energy and contracts: energy accounts, energy allocated by beneficiary, contracts register','Security and reconciliation: payment security and expiry, reconciliation statements','Governance: approvals and maker–checker activity, SAP posting status'] },
      res:{o:'Report', text:'On screen'},
      rules:['It reads the desk’s live records: rows, subtotals and the grand total, with the filters applied listed under the title.','An officer on selected projects sees only those: “Your assigned projects only.”','The tab is in the address (?tab=reports), so it can be bookmarked and sent.'] },
    { who:'M', alt:['C','H','F','G','A'], noquiz:true, t:'Download it', where:'The report on screen', press:['Download CSV','Download Excel','Download PDF'],
      rules:['The file carries the same rows and totals as the screen.','Up to 50,000 rows. Past that the report says only the first rows are in it: narrow the filters.'] },
    { who:'M', alt:['C','H','F','G','A'], noquiz:true, t:'Build a report of your own', where:'Reports › Custom report (or `Customise` on any report)', press:['Run report'],
      fill:['Report on: what it is about, e.g. Bills register, Payments and receipts, Disputes','Report name (optional; printed as the title)','Columns: `Usual columns`, `All` or `None`, then their order in the report','Filters: Date range on, and a Period from This month to Last financial year; `Add a filter` for parties, status, people, amounts or text','Grouping and order: Group by, with subtotals; Subtotals only (one line per group); Sort by, Then by'],
      res:{o:'Report', text:'On screen'},
      rules:['1 to 40 columns.','A from/to pair the wrong way round is said as soon as you leave the box.','Every problem is listed at once, in one popup.'],
      refuse:['Pick at least one column to show.'] },
    { who:'M', alt:['C','H','F','G','A'], noquiz:true, t:'Save it, and share it with the desk', where:'Reports › Custom report', press:['Save to my reports'],
      fill:['Report name: needed to save','Tick “Share with other SJVN officers”'],
      res:{o:'Saved report', text:'Shared with the desk'},
      rules:['It keeps the columns, filters and grouping, not the rows: every run reads the records afresh.','A name you already used asks before it replaces that report.','Only its owner can `Remove` it. The data it reports on is not touched.'],
      refuse:['Give the report a name to save it under.'] },
    { who:'H', alt:['C','F','G','A'], noquiz:true, t:'Run a colleague’s saved report', where:'Reports › Saved reports', press:['View report'],
      res:{o:'Report', text:'On screen'},
      rules:['Its card says “Shared by” and the colleague’s name, with no `Remove`.','`Customise` opens it in the builder; saving it there makes a copy of your own.'] },
    { who:'G', alt:['A'], t:'Read who did what on the desk', where:'Reports › Predefined reports › Governance', press:['Audit trail by user','View report'],
      res:{o:'Report', text:'On screen'},
      rules:['“Audit trail by user”: every recorded action on the desk, grouped by user. Management, SJVN Admin and the compliance auditor open it.','Approvals and maker–checker activity, and SAP posting status, are open to every SJVN officer of the desk.'],
      block:'Maker, checker, HOD and Finance: “Audit trail by user” is not among their reports.' },
    { who:'S', noquiz:true, t:'Pull its own figures', where:'Seller Portal › Reports', press:['View report','Download PDF'],
      lists:{ 'The seller’s 12 reports, in its own words':['My bills to SJVN (PPA)','Monthly billing to SJVN (PPA)','Payments received from SJVN','What SJVN owes you, by age','LPS accrued and billed','Rebates allowed and availed','Disputes register','Open disputes by reason','Energy accounts (PPA)','My contracts (PPAs)','Payment security and expiry','Reconciliation statements'] },
      rules:['Only rows the company is a party to: “Rows your company is a party to, as your other screens show them.”','SJVN’s own columns, such as SJVN margin and who prepared a bill, are left out.','It can save its own layouts; there is no box to share them.','The page opens once the company’s KYC is approved.'] },
    { who:'B', noquiz:true, t:'Pull its own figures', where:'Buyer Portal › Reports', press:['View report','Download Excel'],
      lists:{ 'The buyer’s 12 reports, in its own words':['Bills from SJVN (PSA)','Monthly billing from SJVN (PSA)','Payments made to SJVN','What you owe SJVN, by age','LPS accrued and billed','Rebates allowed and availed','Disputes register','Open disputes by reason','Energy supplied to you (PSA)','My contracts (PSAs)','Payment security and expiry','Reconciliation statements'] },
      rules:['The same tab as the seller’s, cut to the buyer’s own contracts.'] },
  ],
  also:['`Download PDF Snapshot` on the dashboard’s Overview tab gives the whole dashboard as one PDF.','Every screen keeps its own downloads too, e.g. a statement from Counterparty Ledgers & TDS (Side quest 6).'] },

{ zone:'platform', short:'Role Powers', name:'Change what a role may do, or make a role', screen:'Platform › Role Powers',
  goal:'Read which SJVN role holds which power, give or take one away with a reason on the record, and make a new role from any combination the rules allow.',
  start:'An office order changes who does what', end:'The change in force, its users told, the reason on the record',
  steps:[
    { who:'A', t:'Read who holds which power', where:'Platform › Role Powers', press:['Powers by role'],
      fill:['Search powers…','All areas, or one area','`Changed only`: the cells an administrator changed'],
      rules:['A tick is a power the role holds, a half-tick part of it, a cross one it does not. Who holds what by default is read from the platform’s own access rules.','A locked cell is one that can never change; click it to see which rule holds it.','The compliance auditor reads the same page and its history, and changes nothing.'],
      block:'Maker, checker, HOD, Finance and Management: Role Powers is not on their menu.' },
    { who:'A', t:'Give or take away a power', where:'Role Powers › click the cell', press:['Give the power','Take the power away'],
      fill:['Reason: a sentence, at least 15 characters','Office order / note reference (optional)'],
      res:{o:'Cell', text:'Changed by an administrator'},
      rules:['It applies at once, on every screen and action of the power, and the change, its reason and who made it go on the audit trail.','Never allowed: a maker also checking, an administrator transacting, the auditor changing data, a power left with nobody.','Nobody changes their own role’s powers: another administrator has to.'],
      refuse:['Write the reason in a sentence — at least 15 characters.'] },
    { who:'M', noquiz:true, t:'Hear that your role changed', where:'The bell in the top bar › System Alerts',
      rules:['Every active user of the role is told: who changed it, and the reason. “It applies at once; reload the portal to see your menu change.”','A screen the role lost says “The SJVN Administrator has taken this power away from your role.”'] },
    { who:'A', opt:true, t:'Undo a change', where:'Role Powers › click the changed cell', press:['Return to the platform default'],
      fill:['Reason'],
      res:{o:'Cell', text:'As the platform gives it'} },
    { who:'A', t:'Make a role', where:'Role Powers', press:['Make a role','Next: its powers','Make the role'],
      fill:['Name, e.g. Solar Bill Checker','What it is for, in a sentence','Works like: the platform role it starts from','Reason, and the office order reference','Then tick its powers: it starts with what the role it works like holds'],
      res:{o:'Role', text:'A new column, “Made here”'},
      rules:['Each tick beyond the starting role is held to the same rules as a single change: the summary says “Within the rules” or how many rules are broken.','A power that works from another power’s screens ticks that one too, and says so.'],
      refuse:['Give the role a name of at least 3 characters.'] },
    { who:'A', t:'Give the made role to an officer', where:'Platform › SJVN Users › the officer › Role',
      rules:['Changing someone’s role signs them out, and the new role applies from their next sign-in.'] },
    { who:'A', opt:true, t:'Retire a made role', where:'Role Powers › click the role’s name', press:['Retire it'],
      fill:['Reason'],
      res:{o:'Role', text:'Retired'},
      rules:['Retired, never deleted: nobody can be given it afterwards, and its record stays in the history.','While officers hold it, it cannot be retired: give each another role on SJVN Users first.'] },
    { who:'A', noquiz:true, t:'Read the change history', where:'Role Powers', press:['Change history'],
      rules:['When, by whom, the power, the role and its users, the change, the reason and the reference.','`Export` gives the matrix as a CSV.'] },
  ],
  also:['The audit trail keeps every change too (Platform › Audit Trail).','A made role does the work of the role it works like wherever the matrix lists no power.'] },

{ zone:'platform', short:'Holidays & due dates', name:'Keep the holiday calendar that dates every bill', screen:'Platform › Master Data › Holidays & Working Calendar',
  goal:'Every bill falls due, and every rebate window closes, on a day the payer’s office is open. The holiday calendar decides which days those are, state by state.',
  start:'A new year’s gazette, or a state declaring a holiday', end:'The calendar right, and the due date checked before the bill is raised',
  steps:[
    { who:'M', alt:['C','H','F','G'], noquiz:true, t:'Check a due date before raising a bill', where:'Master Data › Holidays & Working Calendar › Live Due-Date & Working-Days Simulator',
      fill:['Bill Presentation Date','Credit Terms (Days)','Beneficiary / Buyer State, or National Only (No State Override)'],
      res:{o:'Calculated Due Date (Target)', text:'Shown with the days skipped'},
      rules:['Counted in calendar days, then moved to the next working day if the last day is a weekly off or a holiday (Counting Mode: CALENDAR_ROLL_FORWARD).','The payer’s calendar governs: the buyer’s state on SJVN’s bill to a buyer; SJVN’s own state, Himachal Pradesh, on a seller’s bill to SJVN.','The early-payment rebate window moves the same way. Surcharge counts every day the money is late.'] },
    { who:'M', alt:['C','H','F','G'], noquiz:true, t:'Read a state’s holidays', where:'Holidays & Working Calendar', press:['State-wise calendar','Holiday register'],
      fill:['Year, Scope (NATIONAL or STATE) and State'],
      rules:['Non-working days are the weekly offs, the national holidays and the payer’s own state’s holidays: one date can be open for one buyer and closed for another.'] },
    { who:'A', t:'Add a holiday', where:'Holidays & Working Calendar', press:['+ Add Holiday','Save Holiday'],
      fill:['Holiday Date','Scope: NATIONAL (Applies to all entities) or STATE (Applies to specific state)','Holiday Name, and the State / UT for a state holiday','Holiday Type: PUBLIC, BANK, RESTRICTED or LOCAL','Remarks / Circular Ref, e.g. the gazette circular'],
      res:{o:'Holiday', text:'Active'},
      rules:['A RESTRICTED (optional) holiday does not close the day.','A bill already raised keeps the due date it was given.'],
      refuse:['… is already a weekly off, so it does not need a holiday entry.'],
      block:'Maker, checker, HOD, Finance and Management: no `+ Add Holiday`; the administrators keep the calendar.' },
    { who:'A', opt:true, t:'Load a year’s holidays at once', where:'Holidays & Working Calendar', press:['Bulk Import','Import Holidays'],
      fill:['One line each: YYYY-MM-DD, Holiday Name, Scope (NATIONAL/STATE), State (optional), Type (PUBLIC/BANK)'],
      rules:['A weekly off, or a day already on the calendar, is skipped and listed with why.'] },
    { who:'A', opt:true, t:'Withdraw a holiday', where:'Holiday register › the holiday', press:['Withdraw','Confirm Withdrawal'],
      fill:['Reason, e.g. State govt cancelled gazetted off'],
      res:{o:'Holiday', text:'Withdrawn'},
      rules:['Withdrawn, never deleted: a bill already raised was dated against it, and the row is the evidence. `Include Withdrawn / Inactive` shows it again.'] },
  ],
  also:['Billing Params in Master Data hold the payment terms used when a contract states none.','The same calendar is behind the surcharge run on the Month-Close Board.'] },

{ zone:'alerts', short:'Alerts & messages', name:'Read the alerts, and message the desk', screen:'Alerts › Notification Board, and Alerts › Quick Connect',
  goal:'What needs attention right now, worked out live from the books, on one board; and a quick in-portal message to a colleague or a counterparty, which is never a formal notice.',
  start:'Any working day', end:'The alert dealt with, the question answered',
  steps:[
    { who:'M', alt:['C','H','F','G','A'], noquiz:true, t:'Read what needs attention', where:'Alerts › Notification Board', press:['Live board'],
      fill:['Search alerts…','Severity chips: Critical, Attention, For information'],
      rules:['Worked out live: overdue payments, payments due this week, invoices awaiting approval, expiring or short security, escalated and open disputes, reconciliation exceptions.','SJVN’s officers share one board; each seller and buyer company has its own, from its own contracts only.'] },
    { who:'M', alt:['C','H','F','G','A'], noquiz:true, t:'Clear an alert off your board', where:'Notification Board › the alert', press:['Acknowledge'],
      rules:['It leaves your board only, nobody else’s, and comes back if it gets worse. `Put back` returns it.','`History` keeps every alert from when it first showed to when it cleared, with how long it lasted.'] },
    { who:'M', alt:['C','H','F','G','A'], noquiz:true, t:'Choose which alerts reach you', where:'Notification Board', press:['Alert settings','Save'],
      fill:['Email me: Every alert, Critical and Attention alerts, Critical alerts only, or Nothing — I will look at the board','SMS me: the same choices'],
      rules:['Every alert is always on the board; this only chooses which are also sent when they first appear.'] },
    { who:'M', alt:['C','A'], noquiz:true, t:'Pin a message for everyone', where:'Notification Board', press:['+ Post Message','Post to Board'],
      fill:['Title, e.g. Quarter-end billing freeze on 31st','Message','Priority: For information, Attention or Critical','Who should see it: Everyone, SJVN internal team only, Sellers only or Buyers only','Show until (optional)'],
      res:{o:'Message', text:'Pinned at the top of the board'},
      rules:['The message is pinned at the top of the Notification Board for the chosen audience.','`Remove` takes it off for everyone; `Acknowledge` only off your own board.'],
      block:'HOD, Finance and Management: no `+ Post Message`.' },
    { who:'M', alt:['C','H','F','G','A'], noquiz:true, t:'Message someone on the portal', where:'Alerts › Quick Connect', press:['New Message','Send Message'],
      fill:['To: Type a name, email or company','Subject, and the message','Cc, Bcc and attachments if needed'],
      rules:['Informal operational facility — not a legal/contractual communication mode.','SJVN’s officers can write to anyone with an active login.'],
      refuse:['A message needs a subject'] },
    { who:'S', noquiz:true, t:'Ask SJVN a question', where:'Seller Portal › Quick Connect', press:['New Message','Send Message'],
      rules:['A company writes to SJVN’s officers and its own colleagues only, never to another company, whose names it never sees.','A formal notice, a dispute intimation or a bill must NOT be served via Quick Connect: it follows the PPA or PSA.'] },
    { who:'B', noquiz:true, t:'Read its own board', where:'Buyer Portal › Notification Board',
      rules:['Its own contracts only: its overdue bills, its payments due this week, its security and its disputes.'] },
    { who:'C', alt:['A'], noquiz:true, t:'Answer what testers reported', where:'Account menu › Public feedback', press:['Save'],
      fill:['Click the report','Status: Replied, or Closed without reply','Reply sent to the visitor'],
      res:{o:'Feedback', text:'Replied, or Closed without reply'},
      rules:['Every report from the portal’s Feedback page lands here, with the page it came from. A report sent from this Playbook names its step, e.g. “REIA Playbook Q24.6”.','SJVN Admin finds the same list under Data requests & declarations.'],
      block:'Maker, HOD, Finance and Management: no `Public feedback` in their account menu.' },
  ],
  also:['The bell in the top bar lists your own notifications, e.g. a change to your role’s powers.','`Disclaimer` in Quick Connect says what the facility is not for.','On the portal, every step of this Playbook has a “Report a problem” link: it opens the Feedback page with the step filled in.'] },
];

/* ───────────────────────── data: the complete cycle ─────────────────────────
   The whole desk on one page: each stage's normal path, then every way it can
   go differently and what the platform does then. Labels, refusals and
   statuses are the platform's own, as in the missions; `see` opens the mission
   or side quest that plays the stage step by step. */
const CPHASES = [['setup','Once per deal'],['month','Every month'],['wrong','When a buyer defaults'],['year','Each quarter and year'],['always','Any day']];
const CYCLE = [
{ phase:'setup', t:'Onboard the companies (KYC)', ends:'Company {APPROVED}, bank account verified', see:['m1'],
  path:[
    ['M','`+ Onboard Stakeholder`: name, PAN, GSTIN, address, signatory, contact and bank. The company is {PENDING}.'],
    ['M','Fill the regulatory checklist (8 items for a seller, 4 for a buyer): reference, issuer, dates, document. Each item {SUBMITTED}. The company can upload its own evidence from its portal.'],
    ['C','Decide each item: {VERIFIED}, {REJECTED} or not applicable.'],
    ['C','`Standard Approval`: the company is {APPROVED}, and its bank account is verified with it.'],
  ],
  edges:[
    { if:'A PAN or GSTIN is in the wrong shape', then:'A popup says so as soon as you leave the field. One already on another company is refused.' },
    { if:'The checker approves while an item is not verified', then:'Refused. The popup lists every item still pending.', refuse:'Approval was refused' },
    { if:'The person who onboarded the company tries to approve it', then:'Refused, administrators included: four eyes on every company.' },
    { if:'The checker types a reference, issuer, date or document itself', then:'Refused: the checker decides on what the maker recorded. It rejects the item with a note, the maker corrects it, then the checker decides.', refuse:'The checker cannot change …’s reference, issuer, dates or document. Reject it with a note so the REIA maker corrects them, then decide on what they record.' },
    { if:'A document is rejected', then:'The item is {REJECTED} with the checker’s note. The maker (or the company) submits it again.' },
    { if:'A document’s validity has lapsed', then:'It cannot be verified. The item goes {EXPIRED} and the maker records the renewed document.' },
    { if:'The company should not be approved', then:'`Reject`, with a reason: the company is {REJECTED}.' },
    { if:'The bank account was not verified with the approval', then:'`Confirm against bank proof` › `Confirm account`, by the checker.' },
    { if:'An approved company changes its details, contacts or bank', then:'It goes back to {PENDING} until the checker approves it again.' },
    { if:'A company’s KYC is not approved yet', then:'Its log-ins reach only the onboarding screens and messages. Every other screen, and the API behind it, refuses; its home page shows the notice and no figures.', refuse:'Your company’s KYC is pending. This opens once SJVN has approved it.' },
    { if:'A company must be barred', then:'Blacklisting: the REIA checker or SJVN Admin.' },
  ] },

{ phase:'setup', t:'Give the companies their log-ins', ends:'Each company signed in, with its own team', see:['m2'],
  path:[
    ['A','`Add Team Member` › `Add to team`: the company’s first log-in, at Level 3, with a temporary password.'],
    ['S','First sign-in: a popup forces a new password. The buyer does the same.'],
    ['S','Level 3 adds its own Level 1 makers and Level 2 checkers under My Team.'],
  ],
  edges:[
    { if:'The REIA desk wants to create a company user', then:'It cannot: only SJVN Admin (or IT Super Admin) manages company log-ins.' },
    { if:'A company’s Level 1 maker prepares something', then:'It never goes to SJVN alone: its own Level 2 or 3 sends it. A bill waits at {PENDING_L2}, a payment intimation at {PENDING_CHECKER}.' },
    { if:'A Level 1 maker tries to sign a reconciliation', then:'Not allowed: Level 2, Level 3 or the Company Admin signs.' },
    { if:'A Level 3 approver must be added or changed', then:'Only the Company Admin or SJVN does it.' },
    { if:'The Company Admin is locked out or leaves', then:'Only SJVN resets or switches off a company’s Admin account.' },
    { if:'A company looks for another company’s records', then:'It never sees them: contracts, bills, payments, disputes, names and messages are its own company’s only. Asking the API for another company’s is refused.' },
  ] },

{ phase:'setup', t:'Contracts: PPA, PSA and the mapping', ends:'PPA and PSA {ACTIVE}, the PSA mapped to the PPA', see:['m3','q11','q12'],
  path:[
    ['M','`+ New Contract` › `Create Draft Contract`, once for the PPA (seller → SJVN) and once for the PSA (SJVN → buyer). Both {DRAFT}.'],
    ['M','`+ Map PSA to this PPA` › `Save Map`: allocation % and Effective From.'],
    ['M','`Update Lifecycle Stage`: {UNDER_NEGOTIATION}.'],
    ['C','{SIGNED} once the signed agreement is on file, then {ACTIVE} from the tenure start.'],
  ],
  edges:[
    { if:'The maker tries to sign or activate', then:'The maker moves a contract only between DRAFT and UNDER_NEGOTIATION.', refuse:'Moving a contract to SIGNED is the REIA checker’s decision.' },
    { if:'The checker makes it live before the tenure starts', then:'Refused: it stays {SIGNED}, and nothing is billed on it, until that date.', refuse:'PPA/… starts on 2026-09-01. It stays SIGNED until then and can be made ACTIVE from that date.' },
    { if:'A renewable PPA has no minimum CUF', then:'It cannot go live until the CUF is entered.', refuse:'PPA/… has no minimum CUF. Enter the CUF the PPA guarantees (Edit Draft or amendment) before making it ACTIVE.' },
    { if:'A regulator’s approval is awaited', then:'{SIGNED} → {PENDING_REGULATORY_APPROVAL} → {ACTIVE}.' },
    { if:'The PSA sells below the PPA tariff', then:'The mapping asks for a recorded reason.' },
    { if:'The mapping is saved after supply has begun', then:'Effective From starts as the day both contracts are in force, not today, so a PPA and PSA from 1 September mapped in October still bill September. Change it only on purpose.' },
    { if:'A PSA holds no share for a month', then:'That month cannot be billed on it.', refuse:'This PSA holds no allocation for … — its share of the PPA had ended or had not yet started.' },
    { if:'A PSA draws from several PPAs and one has no energy for the month', then:'Refused: a PSA is billed for its whole supply or not at all.' },
    { if:'A draft contract has a mistake', then:'`Edit Draft` › `Save Draft Changes`: corrected in place, no new version.' },
    { if:'A live contract’s terms change', then:'`Amend Contract`: a new version from a date that is a real day, not before the contract began. The checker makes it {ACTIVE}; the old one becomes {AMENDED}.', refuse:'The amendment changes none of the contract terms — nothing to submit.' },
    { if:'A month falls on both sides of an amendment', then:'The month is billed on the version in force on its first day, whichever version is picked. A tariff change dated inside the month is priced part by part, by each part’s energy (by days where the 15-minute data is not in), and each part shows on the bill.' },
    { if:'A contract must stop', then:'Hold: the maker, checker, HOD or Management. Only the HOD or Management lifts a hold a breach put on, for 30 days at most. Terminate, close and renew: the checker.' },
    { if:'The tenure is ending', then:'{NEARING_EXPIRY}, then {EXPIRED}; the checker renews ({RENEWED}) or closes it.' },
  ] },

{ phase:'setup', t:'Payment security: the buyer’s LC', ends:'LC {ACTIVE}, bank confirmation received', see:['m4','q15'],
  path:[
    ['M','`+ Instrument` › `Save`: mechanism, limit, the bank’s LC number, validity. The LC is {ACTIVE}; its SFMS column reads Pending.'],
    ['C','`Record bank confirmation` › `Confirm`: the SFMS reference (MT700 / MT707 for an LC, MT760 / MT767 for a guarantee).'],
  ],
  edges:[
    { if:'The validity ends before it starts', then:'Refused by the form as soon as the date is typed, and by the server.', refuse:'The validity cannot end before it starts' },
    { if:'The instrument has already expired', then:'Refused: it cannot be recorded.', refuse:'This instrument has already expired' },
    { if:'The SFMS message is dated in the future', then:'Refused.', refuse:'The SFMS message date cannot be in the future' },
    { if:'The buyer submits its own instrument from its portal', then:'It arrives {DRAFT}; the checker accepts it ({ACTIVE}) or refuses it.' },
    { if:'The cover is short of what is required', then:'The coverage ratio falls below 1. The HOD or Management can treat it as adequate for up to 90 days, with a reason.' },
    { if:'The instrument nears its expiry', then:'Reminders go out. The maker renews it; the maker or the buyer tops it up.' },
    { if:'The company wants its security back', then:'Only with no dues and no open dispute: the company, the maker or Finance asks, Finance signs off, the checker releases. Whoever asked or signed off does not release it.', refuse:'You asked for this release; another officer decides it.' },
    { if:'The buyer stops paying', then:'The security is invoked: see “When a buyer defaults” below.' },
  ] },

{ phase:'month', t:'Energy for the month', ends:'Energy {LOCKED}: ready to bill', see:['m5','q17'],
  path:[
    ['M','`+ Record Energy Data` › `Save`: the PPA, the month, Provisional or Final, the source (JMR / REA) and the MWh. {DRAFT}.'],
    ['C','`Validate`: {VALIDATED}. The seller sees the figure from here on.'],
    ['S','`Accept` › `Accept the figure`: {ACCEPTED}.'],
    ['C','`Lock`: {LOCKED}. Only a locked figure is billed.'],
  ],
  edges:[
    { if:'The figure disagrees with another source for the month', then:'Validation sends it to {DISPUTED}. Re-record it, or lock it with a recorded reason.' },
    { if:'The seller does not agree', then:'It objects with the MWh it claims, a note and a file ({OBJECTED}). The checker rules: {UPHELD} (the maker records the corrected figure, which replaces the old one) or {REJECTED} (the figure stands).' },
    { if:'Locking a figure that failed validation, or whose objection is unanswered or unmet', then:'A reason is required.', refuse:'This period failed validation and cannot be locked without a recorded reason.' },
    { if:'Someone bills a month that is not over', then:'Refused, naming the latest month that can be billed.', refuse:'Cannot bill …: the month has not ended yet. The latest month that can be billed is ….' },
    { if:'Someone bills energy that is not locked', then:'Refused.', refuse:'Energy for … is …, not LOCKED. Validate and lock it on the Energy Data desk before billing.' },
    { if:'A FINAL bill is asked for with only provisional energy', then:'Refused: provisional and final stay separate.' },
    { if:'The buyer could not take some of the energy', then:'Bank it. A cycle takes entries (bank and draw) until the end of the month after it ends; a draw is billed at the full tariff; what is never drawn settles in cash at 75% of tariff once the cycle closes.', refuse:'The cycle ended on … and took entries until …; energy cannot be banked into a closed cycle.' },
    { if:'The contract was amended after the energy was recorded', then:'The energy still counts: it belongs to the plant, whichever version is billed.' },
    { if:'The grid curtailed the plant', then:'The maker records the certified curtailment hours on the month’s figure.' },
  ] },

{ phase:'month', t:'Bills and their approval', ends:'Both bills {APPROVED}, the buyer’s bill {SENT}', see:['m6','q8'],
  path:[
    ['M','`+ Generate Invoice` on the PSA: SJVN’s bill on the buyer, {DRAFT}. Then the same on the PPA: SJVN’s own figure, which stays DRAFT as the yardstick.'],
    ['S','`+ Create Invoice` › `Submit to SJVN`: the seller’s own bill, {SUBMITTED}.'],
    ['M','`Validate vs System` (MATCHED), the Verification Checklist (`Save Verification`), then `Submit for SJVN Approval` on both bills: {UNDER_APPROVAL}.'],
    ['C','`Approve Level 1`. Above ₹1 lakh Finance signs `Approve Level 2`; above ₹10 lakh the HOD (or Management) signs `Approve Level 3`. The bill is {APPROVED}.'],
    ['M','`Send Email to Buyer`: {SENT}. The bill is presented, and its due date and dispute window start.'],
  ],
  edges:[
    { if:'The month is already billed on this contract', then:'Refused, across every version of the contract. A bill raised in error is cancelled first; a correction is a supplementary.', refuse:'… already has a … bill for … — … (…). Cancel that one first, or raise a Supplementary for a correction.' },
    { if:'The contract is not live, is on hold, or the month is outside its term or before its COD', then:'Refused, saying which.', refuse:'Cannot bill a contract in status … — it must be ACTIVE first.' },
    { if:'A seller’s Level 1 maker raises the bill', then:'It waits at {PENDING_L2} for the company’s own checker, who sends it on.' },
    { if:'The seller’s bill does not match SJVN’s figure (PARTIAL or MISMATCH)', then:'Settled before approval: the checker sends it back to the seller, or waives the gap with a reason.' },
    { if:'The seller’s bill is sent back', then:'It is {REJECTED} with what to fix. The seller presses `Revise the bill` › `Resubmit to SJVN`: back to {SUBMITTED}, and the maker verifies it again.' },
    { if:'Someone submits SJVN’s own PPA figure once the developer has billed', then:'Refused: the developer’s bill is the one that goes up.', refuse:'… is the developer’s own bill for 2026-09; submit that one for approval.' },
    { if:'The build-up carries a change-in-law amount', then:'Change in Law Verified cannot be marked NA: verify the claim, or fail it with the reason.' },
    { if:'The build-up does not come to what the bill says', then:'If the gap is only the liquidated damages: save, then Draft LD note. Otherwise the checker sends the bill back.' },
    { if:'The maker who verified the bill tries Level 1', then:'Refused: someone else approves it.', refuse:'You verified INV-…, so someone else approves its first level.' },
    { if:'Someone other than the officer a level is pending with sends the bill back', then:'Refused: a level is decided, both ways, by the role it belongs to. Tell that officer what is wrong.', refuse:'Level … is with …. Only they can send the bill back from it; tell them what is wrong.' },
    { if:'A level rejects the bill', then:'{REJECTED}. The maker fixes it and submits it again.' },
    { if:'A bill was raised in error', then:'Cancel it (maker or checker) while it is DRAFT, SUBMITTED, REJECTED, PENDING_L2 or UNDER_APPROVAL.' },
    { if:'No mail server is set up', then:'The email is written to the outbox and marked SIMULATED.' },
    { if:'The bill is paid before it is sent', then:'It can no longer be sent: send before payment.' },
    { if:'The due date falls on a closed day', then:'The contract’s payment terms run in calendar days from presentation; a last day on the payer’s weekly off or holiday moves to its next working day. The payer’s calendar: the buyer’s state on SJVN’s bill, Himachal Pradesh on a seller’s bill. A restricted holiday closes nothing.' },
  ] },

{ phase:'month', t:'Disputes', ends:'Dispute {CLOSED}, a credit note issued if accepted', see:['m7'],
  path:[
    ['B','`Raise a dispute on this bill` › `Submit Dispute`: amount, charge line, reason, evidence. The dispute is {RAISED}; the bill shows {DISPUTED}.'],
    ['C','`Acknowledge`, then `Start Review`: {UNDER_REVIEW}.'],
    ['H','`Confirm Resolution`: accepted in full or part ({RESOLVED_ACCEPTED}, a draft credit note made), or rejected.'],
    ['C','`Approve & issue` the credit note: {ISSUED}. The bill’s balance falls.'],
    ['B','`Accept resolution` › `Accept and close`: {CLOSED}.'],
  ],
  edges:[
    { if:'More than 15 days have passed since the bill was presented', then:'The bill is conclusive: no dispute can be raised.', refuse:'This bill is now conclusive — the 15-day dispute window (from …) has passed.' },
    { if:'SJVN does not acknowledge in 2 days, or resolve in 15', then:'The dispute is {ESCALATED} and Management is alerted.' },
    { if:'SJVN needs more from the party', then:'`Request Info` (at least 10 characters): {INFO_REQUESTED}. The party answers and it returns to {UNDER_REVIEW}.' },
    { if:'The claim is rejected', then:'{RESOLVED_REJECTED}: no note, the disputed amount is due.' },
    { if:'The party does not accept the outcome', then:'It contests, naming the forum (SJVN senior management, conciliation, arbitration, the Regulatory Commission) and the amount. The maker keeps the record of hearings and the end.' },
    { if:'The party does not answer within 15 days', then:'The checker may `Close Dispute`.' },
    { if:'The buyer pays the part not in dispute', then:'The bill stays {DISPUTED}, so the disputed part can still be collected. When the dispute closes, what has been paid by then decides the status.' },
    { if:'The buyer wins part of the dispute', then:'The credit counts from the bill’s due date: no surcharge runs on the part it won.' },
    { if:'The dispute’s credit note is later cancelled', then:'The dispute goes back to {UNDER_REVIEW} and its amount is held again, not demanded.' },
    { if:'The seller disputes, or the party asked the desk to', then:'The seller disputes its side the same way; the maker can raise one on a party’s behalf, or from a reconciliation line inside the window.' },
    { if:'The HOD is away', then:'Management decides instead.' },
  ] },

{ phase:'month', t:'Correct a bill already out: notes, arrears, supplementaries', ends:'Note {ISSUED}, or the new bill {SENT}', see:['q2','q3'],
  path:[
    ['M','`+ Raise Note` › `Save as draft`: debit (owes more) or credit (owes less), reason, taxable value, tax. {DRAFT}. Finance can raise notes too.'],
    ['C','`Approve & issue` in Notes for Approval: {ISSUED}. A debit note becomes its own supplementary bill; a credit note is set against the bill.'],
    ['M','For a past month: `+ Arrear Bill` › `Raise Arrear`, or `+ Supplementary` › `Create Supplementary`. It climbs the same ladder by amount and is sent like any bill.'],
  ],
  edges:[
    { if:'The bill is still a draft, in approval or sent back', then:'Not issued yet, so it is corrected itself, not by a note.', refuse:'The invoice is still a draft — correct the draft instead of raising a note' },
    { if:'A negative amount, or one that rounds to nothing', then:'Refused, not turned round: a credit is raised as a credit.', refuse:'A positive taxable amount is required' },
    { if:'The same note is raised twice while the first is live', then:'Refused: same bill, type, amount and reason.', refuse:'This note is already raised against … — same type, amount and reason.' },
    { if:'A credit note takes back more tax than the bill charged', then:'Refused: at most the bill’s tax less what is already credited. After 30 November following the supply’s financial year, tax cannot be credited at all (CGST Act s.34).', refuse:'Raise the credit for the value alone, without tax.' },
    { if:'The note is dated wrongly', then:'Its issue date must be a real day, not after today and not before the bill it adjusts was issued.' },
    { if:'Whoever raised the note tries to approve it', then:'Refused.', refuse:'Segregation of duties: whoever raised this note cannot approve it. It needs a different approver.' },
    { if:'An issued note must be withdrawn', then:'`Cancel`, with a reason, by the checker or Finance: its effect is reversed.', refuse:'Say why the note is cancelled — it was issued' },
    { if:'A credit note is bigger than the bill can absorb', then:'The rest stays on the note: `Apply credit` to another open bill of the same contract and side.' },
    { if:'The company wants its note', then:'`PDF` on the bill: the company the note was issued to downloads it too.' },
    { if:'An arrear would be negative', then:'Refused: money owed back is a credit note or a negative supplementary.' },
    { if:'An arrear or supplementary is for a month not yet come, or outside the contract’s term', then:'Refused.', refuse:'… has not come yet; an arrear recovers a month already supplied.' },
    { if:'A tariff revision reaches back over a month already billed', then:'Arrear, Amount: `From a tariff revision`. Worked out from the month’s final bill: energy × (the rate now due − the rate last charged), less earlier revision arrears. A month with only a provisional is settled by its final bill instead; a revision downwards is a credit note, which the refusal suggests.' },
    { if:'A Change in Law claim', then:'A supplementary with the date the law took effect (Law in force from). A month that ended before it is refused. No early-payment rebate on it.' },
  ] },

{ phase:'month', t:'The buyer pays: rebate and surcharge', ends:'Bill {PAID}', see:['m8','q1','q4'],
  path:[
    ['B','`Intimate payment to SJVN` › `Send to SJVN Finance`: amount, date, mode, UTR. {SUBMITTED}.'],
    ['F','`Confirm receipt` › `Confirm and record the payment`, at the value date in SJVN’s bank: {PAID}. Only Finance says money arrived.'],
  ],
  edges:[
    { if:'The buyer’s Level 1 maker sends the intimation', then:'It waits at {PENDING_CHECKER}; the buyer’s checker sends it on or returns it ({RETURNED_BY_CHECKER}).' },
    { if:'The buyer changes its mind', then:'It withdraws the intimation until Finance acts: {WITHDRAWN}.' },
    { if:'The money is not in SJVN’s bank', then:'Finance does not confirm it: {REJECTED}.' },
    { if:'Part of the bill is paid', then:'{PARTIALLY_PAID}. A credit note applied reads “Partially paid — credit applied”: a note is not money.' },
    { if:'The buyer pays more than the bill has left', then:'The bill takes what it can; the rest is the buyer’s advance ({OPEN}), applied to a later bill of the same buyer ({APPLIED}) or refunded with a reason ({REFUNDED}).' },
    { if:'The buyer pays early', then:'It earns the rebate its PSA sets. The window runs in calendar days from presentation and, ending on the buyer’s closed day, moves to its next working day.' },
    { if:'The bill is a surcharge bill or a change-in-law bill', then:'No early-payment rebate on it.' },
    { if:'The buyer pays late', then:'Surcharge runs from the day after the due date, every calendar day the money is late: the base rate, plus 0.5% for each month of default, capped at 3% above the base. The base rate is the contract’s own, else 15% a year from the masters, or that financial year’s rate where the masters keep a yearly schedule.' },
    { if:'The contract gives grace days', then:'A bill settled inside them earns no surcharge.' },
    { if:'A surcharge bill is itself paid late', then:'No surcharge on surcharge.' },
    { if:'Surcharge has built up', then:'Once a month, `Raise LPS bills` on the Month-Close Board: one LPS bill per buyer contract, each bill’s surcharge billed once. Cancelling an LPS bill gives it back.' },
    { if:'One lump receipt covers several bills', then:'Surcharge first, oldest bill first, then the oldest principal (PSA Art. 6.3), worked out as of the day the money came, not today.', refuse:'The payment date must be a real date not in the future' },
    { if:'The maker or checker tries to confirm a receipt', then:'Not on their screens: the desk that raises a bill never marks it paid.' },
  ] },

{ phase:'month', t:'Pay the seller: pay-when-paid', ends:'Seller’s bill {PAID}', see:['m9','q5'],
  path:[
    ['F','Developer Release Planner: what buyers paid that is each generator’s energy share, what has gone out, what can be released now.'],
    ['C','`Release to Generator`: net amount, TDS, fund source, date and reference. The seller’s bill is {PAID}. Finance can release too.'],
    ['S','Sees the money under Latest payments from SJVN, with no other company named.'],
  ],
  edges:[
    { if:'The release asks for more than is available', then:'Refused: never more than the buyer realised, nor more than the bill less the rebate SJVN earns.', refuse:'₹2,17,80,000 is more than the ₹2,14,53,300 left on … (₹2,17,80,000 owed, less the 1.50% early-payment rebate it earns if paid today).' },
    { if:'SJVN pays early', then:'SJVN earns 1.5% within 5 days of the bill and 1% within 30, unless the PPA sets its own. The window closes on SJVN’s calendar (Himachal Pradesh), moved to the next working day.' },
    { if:'The seller has been paid over ₹50 lakh in the year', then:'TDS u/s 194Q: 0.1% of the bill above ₹50 lakh. Net + TDS + rebate = the bill, exactly.' },
    { if:'The buyer has not paid yet', then:'Nothing of it is releasable. A release from SJVN’s own fund or the payment security fund is recorded as such.' },
    { if:'The maker looks for the release', then:'The release section does not appear.' },
  ] },

{ phase:'month', t:'Reconcile the month', ends:'Statement {CLOSED}, signed by both sides', see:['m10'],
  path:[
    ['X','Every hour: last month’s statement for each ACTIVE contract, {PENDING_SIGN_OFF} (or {NEEDS_REVIEW} where a line differs).'],
    ['C','`Override` a line that differs, with why the variance is accepted.'],
    ['F','`Concur for Finance` on a statement above ₹1 crore billed.'],
    ['C','`✓ SJVN Agree & Sign-Off`. The buyer and the seller each press `I agree — sign off`: {CLOSED}.'],
  ],
  edges:[
    { if:'The statement was made before payments landed', then:'`Regenerate statement (Re-sync)`.' },
    { if:'Someone runs one for a month already open', then:'Refused: open it and regenerate, or finish it first.', refuse:'R… is already open for 2026-09. Open it and use "Regenerate statement" to refresh its figures, or finish it first.' },
    { if:'SJVN signs a statement above ₹1 crore before Finance', then:'Refused.', refuse:'R… covers ₹2,23,34,400 billed, above the ₹1,00,00,000 limit. Finance concurs before SJVN signs.' },
    { if:'A line is still open', then:'SJVN cannot sign until it is overridden or settled.' },
    { if:'Tax or SAP lines read NOT_CONNECTED', then:'Expected unless a figure is supplied.' },
    { if:'A company’s Level 1 maker tries to sign', then:'Not allowed: Level 2, Level 3 or the Company Admin.' },
    { if:'A closed statement turns out wrong', then:'A party or the desk asks to reopen; Finance or the checker decides: {REOPENED}.' },
    { if:'A line shows a bill is wrong', then:'The maker raises a dispute from the line, inside the dispute window.' },
  ] },

{ phase:'month', t:'Close the month: Finance, SAP, CERC and DSM', ends:'Posting {POSTED}, Form-IV {SUBMITTED}', see:['q7','q9','q22','q10'],
  path:[
    ['M','Month-Close Board: `Generate all ready (n)` raises every ready bill; `Raise LPS bills` raises the month’s surcharge.'],
    ['M','Finance Posting (FI): `Prepare the posting` for the month and what is booked: {PREPARED}.'],
    ['C','`Push to SAP`, then `Read back from SAP`: {POSTED} on SAP’s FI documents. A posting not sent to SAP is booked with `Post` and Finance’s voucher.'],
    ['M','CERC Form-IV: `Prepare Form-IV` › `Create Filing` from the month’s bills: {DRAFT}.'],
    ['C','`Mark Submitted to CERC` › `Confirm and submit` on CERC’s reference, by the 15th: {SUBMITTED}, then locked.'],
    ['M','Each week, DSM: `Upload official NRPC DSA`, `Raise from NRPC statement`, `Generate supplementary bill`; the bill climbs the ladder.'],
  ],
  edges:[
    { if:'A row on the board cannot be raised', then:'The popup says why. A month that has not ended cannot be picked.' },
    { if:'A document was cancelled or changed after the posting was prepared', then:'Booking is refused: withdraw it and prepare the month again.', refuse:'Changed since this posting was prepared: …. Withdraw it and prepare the month again.' },
    { if:'Whoever prepared the posting tries to book it', then:'Refused.', refuse:'You prepared this posting, so someone else books it.' },
    { if:'An invoice is already in SAP', then:'It is not sent again. A push SAP never answered is held until a read back settles it, so nothing is sent twice.' },
    { if:'The posting has gone to SAP', then:'No voucher can be typed in for it and no reversal is made here: SAP books it.' },
    { if:'SAP cannot be reached or is not set up', then:'`Test SAP connection` checks the link; the screen says when SAP is not configured.' },
    { if:'A posting was wrong', then:'`Reverse`, with a reason of at least 10 characters ({REVERSED}). One still PREPARED is withdrawn instead.' },
    { if:'Nothing was billed in the month', then:'A NIL Form-IV return is still owed.' },
    { if:'A Form-IV line has no price, or is over the cap without a reason', then:'The filing stops. A bill changed since: `Regenerate from bills`. A return filed before the platform held it: `Already filed outside the platform?`.' },
    { if:'A DSM row is a manual estimate', then:'It cannot be billed: only NRPC’s published figure is.', refuse:'This row is a manual estimate, not the published settlement, so it cannot be billed.' },
    { if:'NRPC reissues a week’s statement', then:'The old one is marked superseded: import the current one. NRPC prints Paid (+) / Received (−), the reverse of the platform’s sign.' },
  ] },

{ phase:'wrong', t:'When a buyer defaults', ends:'Invocation {FUNDS_RECEIVED}, or the power sold elsewhere and {RECOVERED}', see:['q14','q16','q12'],
  path:[
    ['M','`Invoke waterfall` › `Confirm invocation` on the PSA, for everything 30 days or more past due: {NOTICE_ISSUED}, the buyer told.'],
    ['C','`Claimed` › `Save` when the claim reaches the bank ({CLAIMED}); `Funds in` when it pays ({FUNDS_RECEIVED}).'],
    ['M','Or `+ Record Diversion` › `Record`: the power sold elsewhere ({RECORDED}), then `Recover against dues` ({RECOVERED}).'],
  ],
  edges:[
    { if:'Which security pays first', then:'The buyer’s LC, then the payment security fund, then the corpus fund. A seller’s guarantee answers only for the seller.' },
    { if:'The bank does not answer within 7 days', then:'The claim is flagged as late.' },
    { if:'The bank refuses', then:'`Bank refused`, with the date: the invocation is {REJECTED}.' },
    { if:'The notice went out by mistake', then:'It cannot be undone from this screen.' },
    { if:'Diversion is recorded as a payment default with no bill past due', then:'Refused: record it as power not requisitioned if that is what happened.', refuse:'… has no bill past its due date, so the buyer is not in payment default. If the buyer did not schedule the power, record it as not requisitioned.' },
    { if:'The diversion fetched more than the buyer owes', then:'The surplus is held as the buyer’s advance.' },
    { if:'The power sold for less than it cost', then:'`Bill the deficit`: a debit note on the buyer’s latest bill.' },
    { if:'No more bills should go out on the contract', then:'Put it on hold: new SJVN bills on it are refused until the hold is released.' },
  ] },

{ phase:'year', t:'Each quarter and each year', ends:'Certificates filed, CUF trued up, the year’s returns and rates in place', see:['q6','q13','q22','q25'],
  path:[
    ['F','Each quarter: `+ File a certificate` (Form 16A) for each seller, then reconcile TDS against Form 16A.'],
    ['M','Each contract year: `Raise true-up note` where the CUF fell short. The checker approves it in Notes for Approval.'],
    ['M','By 30 April: `Roll up annual` on Form-IV once the twelve monthlies are filed; the checker files it.'],
    ['A','Each April, the year’s LPS base rate as a new row in the masters’ schedule; each new year, the holiday calendar.'],
  ],
  edges:[
    { if:'A month of the contract year is not locked', then:'The CUF waits: Waiting on locked energy.' },
    { if:'No bill was presented in the year', then:'There is nothing to set the true-up note against.' },
    { if:'The LPS base rate changes in April', then:'Add the year’s row; changing the single master rate instead would re-price every open bill back to its due date. A contract with its own rate keeps it.' },
    { if:'A holiday is declared after bills were raised', then:'Bills already raised keep their due dates. Holidays are withdrawn, never deleted. A weekly off needs no entry.', refuse:'… is already a weekly off, so it does not need a holiday entry.' },
    { if:'A buyer has deducted TDS from its payments', then:'It files its own certificate from its portal, so SJVN can claim the credit.' },
  ] },

{ phase:'always', t:'People and access, any day', ends:'The work goes on, under each officer’s own name', see:['q18','q19','q20','q24','q26','q21','q23'],
  path:[
    ['A','Additional charge: `Record a charge` for an officer away (up to 90 days): {IN_FORCE}. The holder acts as them under their own name.'],
    ['M','Break-glass when nobody holding a role can act: `Ask for break-glass`, opened on two approvals, one from Management.'],
    ['A','Project Assignments and Role Powers: who works on which project, and which role may do what.'],
    ['M','Every day: the Notification Board, Quick Connect and the Reports tab.'],
    ['X','Every action is logged: who, when, and the value before and after. SJVN Admin reads it in the Audit Trail and checks nothing was altered (`Verify full chain`).'],
  ],
  edges:[
    { if:'An officer would hold their own charge, or an administrator a desk charge', then:'Not allowed.' },
    { if:'Break-glass is asked for again while one is open', then:'Refused. A grant closes by itself, and everything done under it is flagged in the audit trail.', refuse:'You already have a request or an open grant for that role' },
    { if:'A project has nobody to act at a tier', then:'SJVN Admin is alerted daily.' },
    { if:'A power change would let a maker also check, an administrator transact, or leave a power with nobody', then:'Never allowed. Nobody changes their own role’s powers.' },
    { if:'Someone serves a notice, a dispute or a bill on Quick Connect', then:'It does not count: those follow the PPA or PSA.' },
    { if:'A report runs past 50,000 rows', then:'The file says only the first rows are in it: narrow the filters.' },
    { if:'Someone asks who did what, or acted for whom', then:'The Audit Trail has it: a change made while acting for someone is its own entry, and duty conflicts are counted at the top (`Review them`).' },
    { if:'A record in the trail was altered', then:'The chain check names the broken link: `Open the broken record`.' },
  ] },
];

/* ───────────────────────── helpers ───────────────────────── */
const KEY = 'reia-playbook-v1';
const P = (() => { let v = {}; try { v = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { v = {}; } return Object.assign({ done:{}, best:0, theme:'', lastM:0 }, v); })();
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(P)); } catch (e) { /* storage blocked: progress lives for this visit only */ } };
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const REDUCE = window.matchMedia ? matchMedia('(prefers-reduced-motion: reduce)').matches : false;

const ICON = {
  lock:'<svg class="ic" viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="7" width="10" height="7.5" rx="1.6" fill="currentColor"/><path d="M5.2 7V5.2a2.8 2.8 0 0 1 5.6 0V7" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>',
  login:'<svg class="ic" viewBox="0 0 16 16" aria-hidden="true"><path d="M9.5 2.5H13v11H9.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M2 8h8M7 4.8 10.2 8 7 11.2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  check:'<svg class="ic" viewBox="0 0 16 16" aria-hidden="true"><path d="m3.2 8.4 3 3 6.6-6.8" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  play:'<svg class="ic" viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 2.8v10.4L13 8z" fill="currentColor"/></svg>',
  clock:'<svg class="ic" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8 4.6V8l2.4 1.6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  auto:'<svg class="ic" viewBox="0 0 16 16" aria-hidden="true"><path d="M13 8a5 5 0 1 1-1.6-3.7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M12.2 1.6v3.2H9" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  sun:'<svg class="ic" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="3.2" fill="currentColor"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.4 1.4M11.6 11.6 13 13M3 13l1.4-1.4M11.6 4.4 13 3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  moon:'<svg class="ic" viewBox="0 0 16 16" aria-hidden="true"><path d="M13.5 10.2A6 6 0 0 1 5.8 2.5a6 6 0 1 0 7.7 7.7z" fill="currentColor"/></svg>',
};
const KIND = {};
'APPROVED ACTIVE VERIFIED LOCKED PAID CLOSED ISSUED SETTLED CONFIRMED RELEASED FUNDS_RECEIVED MATCHED ACCEPTED AGREED RECEIVED RECOVERED POSTED APPLIED REFUNDED IN_FORCE DISPATCHED SENT SIGNED RENEWED RESOLVED_ACCEPTED'.split(' ').forEach((k) => { KIND[k] = 'good'; });
'REJECTED TERMINATED CANCELLED DISPUTED MISMATCH EXPIRED ESCALATED OBJECTED RETURNED_BY_CHECKER REVERSED RESOLVED_REJECTED WITHDRAWN'.split(' ').forEach((k) => { KIND[k] = 'bad'; });
'PENDING PENDING_L2 PENDING_CHECKER SUBMITTED UNDER_APPROVAL UNDER_REVIEW INFO_REQUESTED PENDING_SIGN_OFF NEEDS_REVIEW RELEASE_PENDING NOTICE_ISSUED CLAIMED ACKNOWLEDGED UNDER_NEGOTIATION PENDING_REGULATORY_APPROVAL NEARING_EXPIRY PARTIALLY_PAID PARTIALLY_UTILIZED VALIDATED REOPENED ELIGIBLE UPHELD RECORDED PREPARED CALCULATED OPEN REQUESTED RAISED'.split(' ').forEach((k) => { KIND[k] = 'wait'; });
'DRAFT NOT_STARTED'.split(' ').forEach((k) => { KIND[k] = 'start'; });

const st = (s, big) => `<span class="st ${KIND[s] || ''}${big ? ' big' : ''}">${esc(String(s).replace(/_/g, ' '))}</span>`;
const fmt = (s) => esc(s)
  .replace(/`([^`]+)`/g, '<span class="ui">$1</span>')
  .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  .replace(/\{([A-Z][A-Z0-9_]*)\}/g, (m, t) => st(t));
const rb = (k, size = '') => `<span class="rb ${size}" style="--c:var(--c-${R[k].c})" role="img" aria-label="${esc(R[k].name)}" title="${esc(R[k].name)}">${k === 'X' ? ICON.auto : R[k].b}</span>`;
const inr = (n) => '₹' + Math.round(n).toLocaleString('en-IN');
const crore = (n) => `₹${(n / 1e7).toFixed(2)} Cr`;
const shuffle = (a) => { const b = a.slice(); for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };

// Missions and side quests play on one engine: each has an id ("m3", "q7") and
// its own list. A mission's progress stays under its number, as it always was.
MISSIONS.forEach((m) => { m.id = 'm' + m.n; m.kind = 'Mission'; m.list = MISSIONS; });
QUESTS.forEach((q, i) => { q.n = i + 1; q.id = 'q' + q.n; q.kind = 'Quest'; q.list = QUESTS; });
const BOOK = Object.fromEntries([...MISSIONS, ...QUESTS].map((m) => [m.id, m]));
const doneKey = (m) => (m.kind === 'Mission' ? m.n : m.id);
const isDone = (m) => !!P.done[doneKey(m)];
const zoneName = (m) => (m.kind === 'Mission' ? (m.zone === 'setup' ? 'One-time setup' : 'Every month') : 'Side quest · ' + QZONES.find(([z]) => z === m.zone)[1]);
const playersOf = (m) => [...new Set(m.steps.map((s) => s.who))];
// Who is logged in when step i starts: the last person to act. An automatic step
// needs nobody, so whoever was logged in before it still is.
const humanBefore = (m, i) => { for (let k = i - 1; k >= 0; k--) if (m.steps[k].who !== 'X') return m.steps[k].who; return null; };
const loginsIn = (m) => m.steps.filter((s, i) => s.who !== 'X' && humanBefore(m, i) !== s.who).length;
const loginHint = (k) => k === 'X' ? 'No log-in: the platform does this on its own.'
  : R[k].side === 'SJVN' ? `Sign-in page › Quick Demo Login › “${R[k].demo}”.`
  : `Sign in with the ${R[k].short.toLowerCase()} company’s own email and password.`;
// The screens a step names, as the portal's own menu addresses them
// (frontend/src/components/Layout.jsx). The portal copy links each step to its
// screen and to the feedback form; the offline copy has no portal to open.
const ON_PORTAL = /\/reia-playbook\//.test(location.pathname);
const SCREENS = {
  SJVN: {
    'REIA Dashboard':'/reia', 'Reports':'/reia?tab=reports', 'Stakeholders & KYC Desk':'/reia/entities', 'Company Users':'/reia/company-users',
    'Contracts (PPA/PSA)':'/reia/contracts', 'Payment Security':'/reia/payment-security', 'Energy Data & Validation':'/reia/energy-data',
    'Billing & Invoicing':'/reia/invoices', 'Notes for Approval':'/reia/note-approvals', 'Dispute Management':'/reia/disputes',
    'Payment Monitoring':'/reia/payment-monitoring', 'Reconciliation':'/reia/reconciliation', 'Compliance Desk':'/reia/compliance',
    'Contract Compliance':'/reia/contract-compliance', 'CERC Regulatory Compliance':'/reia/cerc-compliance', 'Form-IV':'/reia/form-iv',
    'Month-Close Board':'/reia/billing-readiness', 'Developer Release Planner':'/reia/release-planner', 'Invoice Verification':'/reia/verification',
    'Counterparty Ledgers & TDS':'/reia/seller-ledgers', 'Generation Performance':'/reia/generation-performance', 'Power Diversion':'/reia/power-diversion',
    'Advances & Unapplied Receipts':'/reia/advances', 'Energy Banking':'/reia/energy-banking', 'Deviation Settlement (DSM)':'/reia/deviation',
    'Finance Posting (FI)':'/reia/finance-posting', 'Project Assignments':'/admin/project-assignments', 'Additional Charge & Break-glass':'/settings/delegations',
    'Audit Trail':'/audit-logs', 'Role Powers':'/admin/role-powers', 'SJVN Users':'/admin/users', 'Master Data':'/masters',
    'Holidays & Working Calendar':'/masters?tab=holidays', 'Notification Board':'/notification-board', 'Quick Connect':'/mail', 'Sign-in page':'/login',
    'Public feedback':'/settings/privacy-requests',
  },
  S: {
    'Seller Portal':'/seller', 'My Dashboard':'/seller', 'My Team':'/seller/team', 'My Contracts (PPAs)':'/seller/contracts', 'Energy Data':'/seller/energy-data',
    'My Invoices':'/seller/invoices', 'Payments & Ledger':'/seller/payments', 'My Disputes':'/seller/disputes', 'Payment Security':'/seller/payment-security',
    'Reconciliation':'/seller/reconciliation', 'Reports':'/seller/reports', 'Notification Board':'/notification-board', 'Quick Connect':'/mail',
  },
  B: {
    'Buyer Portal':'/buyer', 'My Dashboard':'/buyer', 'My Team':'/buyer/team', 'My PSAs':'/buyer/contracts', 'Energy Allocation':'/buyer/energy-data',
    'Billing & Payments':'/buyer/invoices', 'My Disputes':'/buyer/disputes', 'Payment Security':'/buyer/payment-security',
    'Reconciliation':'/buyer/reconciliation', 'Reports':'/buyer/reports', 'Notification Board':'/notification-board', 'Quick Connect':'/mail',
  },
};
const PORTAL_OF = { S:'Seller Portal', B:'Buyer Portal' };
// Pages the Compliance Desk opens as its own tabs.
const WITHIN = { '/reia/contract-compliance':'/reia/compliance', '/reia/cerc-compliance':'/reia/compliance', '/reia/form-iv':'/reia/compliance' };
const EVERYWHERE = /^(The bell|Top bar|The banner in the top bar)/;
// The first screen a place names, read left to right ("Month-Close Board ›
// Reconciliation" is the board), sharpened by a later one at the same address
// ("Master Data › Holidays & Working Calendar" is the holidays tab). "The LPS
// bill" and the like are bills, on Billing & Invoicing. Something in the top
// bar is on every screen, so it has no link: { none:true }.
function placeLink(place) {
  const parts = String(place || '').split(/ › |, then |, and /).map((p) => p.trim());
  if (EVERYWHERE.test(parts[0])) return { none:true };
  const side = parts.includes('Seller Portal') ? 'S' : parts.includes('Buyer Portal') ? 'B' : 'SJVN';
  const map = SCREENS[side];
  let hit = null;
  for (const part of parts) {
    let name = [part, ...part.split(' / ')].find((n) => map[n]);
    if (!name && side === 'SJVN' && !hit && /^(The|Each)\b.*\bbill$/.test(part)) name = 'Billing & Invoicing';
    if (!name && part === 'Every REIA screen') name = 'REIA Dashboard';
    const firm = hit && hit.name !== PORTAL_OF[side];
    if (!name) { if (firm) break; continue; }
    const url = map[name];
    if (!firm || url.startsWith(hit.url + '?') || url.startsWith(hit.url + '/') || WITHIN[url] === hit.url) hit = { side, name, url };
    else break;
  }
  return hit;
}
/** Where step s of m is on the portal: its own place, else the mission's screen, else the company's portal. */
function stepLink(m, s) {
  if (s.who === 'X') return null;
  const side = s.who === 'S' || s.who === 'B' ? s.who : 'SJVN';
  const own = placeLink(s.where);
  if (own && own.none) return null;
  if (own && (own.side === side || own.url === '/login')) return own;
  const main = placeLink(m.screen);
  if (main && !main.none && main.side === side) return main;
  return side === 'SJVN' ? null : { side, name:PORTAL_OF[side], url:SCREENS[side][PORTAL_OF[side]] };
}
const stepId = (m, i) => `${m.kind === 'Quest' ? 'Q' : 'M'}${m.n}.${i + 1}`;
function feedbackUrl(m, s, i) {
  const from = `REIA Playbook ${stepId(m, i)} · ${m.short} · ${s.t}`.slice(0, 200);
  return '/feedback?from=' + encodeURIComponent(from);
}
// Who logs in for step i, as the drawer and the printed copy say it.
function loginLine(m, i) {
  const s = m.steps[i]; const before = humanBefore(m, i);
  return s.who === 'X' ? loginHint('X') : before === s.who ? 'Same log-in as the step before.' : `${before ? `Log out of ${R[before].short}. ` : ''}${loginHint(s.who)}`;
}
// "My steps": the role a tester picked, kept with their progress.
const isMine = (s) => !!P.me && (s.who === P.me || (s.alt || []).includes(P.me));
function sessions(filter) {
  const out = [];
  MISSIONS.forEach((m) => {
    if (filter !== 'all' && m.zone !== filter) return;
    m.steps.forEach((s, i) => {
      const last = out[out.length - 1];
      if (last && last.who === s.who) last.items.push({ m, s, i });
      else out.push({ who:s.who, items:[{ m, s, i }] });
    });
  });
  return out;
}
const TOTAL_STEPS = MISSIONS.reduce((a, m) => a + m.steps.length, 0);
const LOGINS = sessions('all').filter((s) => s.who !== 'X').length;
const QUEST_STEPS = QUESTS.reduce((a, q) => a + q.steps.length, 0);
const MAXXP = (TOTAL_STEPS + QUEST_STEPS) * 10 + 100;
const RANKS = [[0,'Trainee'],[0.2,'Desk Officer'],[0.45,'Senior Officer'],[0.7,'Desk Lead'],[1,'REIA Pro']];
const xpNow = () => [...MISSIONS, ...QUESTS].reduce((a, m) => a + (isDone(m) ? m.steps.length * 10 : 0), 0) + (P.best || 0) * 10;
const rankOf = (x) => { let r = RANKS[0][1]; RANKS.forEach(([t, n]) => { if (x / MAXXP >= t - 1e-9) r = n; }); return r; };

/* ───────────────────────── shell ───────────────────────── */
const TABS = [['map','Map'],['cycle','Full cycle'],['find','Find a step'],['missions','Missions'],['players','Players'],['powers','Powers'],['lifecycles','Lifecycles'],['relay','Log-in relay'],['money','Money'],['quests','Side quests'],['quiz','Quiz']];
const app = $('#app'); const drawer = $('#drawer'); const scrim = $('#scrim'); const hud = $('#hud'); const sw = $('#switch');
let current = 'map';

function paintXP() {
  const x = xpNow();
  $('#xp').innerHTML = `<b>${esc(rankOf(x))}</b><span class="xp-bar"><i style="width:${Math.min(100, x / MAXXP * 100).toFixed(1)}%"></i></span><span class="xp-n">${x} / ${MAXXP} XP</span>`;
}
function paintTheme() {
  const dark = document.documentElement.dataset.theme ? document.documentElement.dataset.theme === 'dark' : (window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
  $('#theme').innerHTML = dark ? ICON.sun : ICON.moon;
  $('#theme').setAttribute('aria-label', dark ? 'Switch to light' : 'Switch to dark');
}
function paintTabs() {
  const sec = /^m\d+$/.test(current) ? 'missions' : /^q\d+$/.test(current) ? 'quests' : current;
  $('#tabs').innerHTML = TABS.map(([id, label]) => `<button class="tab" type="button" data-go="${id}"${id === sec ? ' aria-current="page"' : ''}>${label}</button>`).join('');
}

function go(token, push = true) {
  if (token === 'missions') token = 'm' + (P.lastM || (MISSIONS.find((m) => !isDone(m)) || MISSIONS[0]).n);
  const views = { map:viewMap, cycle:viewCycle, find:viewFind, players:viewPlayers, powers:viewPowers, lifecycles:viewLife, relay:viewRelay, money:viewMoney, quests:viewSide, quiz:viewQuiz };
  const playable = /^[mq]\d+$/.test(token);
  if (!playable && !views[token]) token = 'map';
  if (playable && !BOOK[token]) token = token[0] === 'q' ? 'quests' : 'm1';
  exitPlay();
  closeDrawer(true);
  current = token;
  const book = BOOK[token];
  app.innerHTML = book ? viewMission(token) : views[token]();
  if (book && book.kind === 'Mission') { P.lastM = book.n; save(); }
  after(token);
  paintTabs(); paintXP();
  window.scrollTo(0, 0);
  if (push) { try { history.pushState(null, '', '#' + token); } catch (e) { /* framed: keep state in the page */ } }
}
function after(token) {
  if (token === 'powers') paintPowers();
  if (token === 'money') paintMoney();
  if (token === 'find') paintFind();
  if (/^[mq]\d+$/.test(token)) fitLanes();
}
// Side-by-side lanes need about 200px a role; narrower, the cards stack and keep their lane as a stagger.
function fitLanes() {
  const w = $('.lanes-wrap'); if (!w) return;
  w.classList.toggle('stack', w.clientWidth < Number(w.dataset.cols) * 200 + 10);
}
window.addEventListener('resize', fitLanes);

/* ───────────────────────── view: map ───────────────────────── */
const POS = { 1:[140,150], 2:[360,150], 3:[580,150], 4:[800,150], 5:[800,330], 6:[540,330], 7:[280,330], 8:[280,540], 9:[540,540], 10:[800,540] };
function mapSvg() {
  const chev = (x, y, r) => `<path class="chev" d="M-5 -7 L4 0 L-5 7" transform="translate(${x} ${y}) rotate(${r})"/>`;
  const badge = (k, x, y) => `<g class="bdg" style="--c:var(--c-${R[k].c})"><circle cx="${x}" cy="${y}" r="10"/><text x="${x}" y="${y + 3.6}" text-anchor="middle">${k === 'X' ? '↻' : R[k].b}</text></g>`;
  let s = `<svg viewBox="20 24 990 640" role="group" aria-label="REIA line map: setup stations 1 to 4 lead into a monthly loop of stations 5 to 10">`;
  s += `<path class="ln-setup" d="M 52 150 H 800 V 330"/>`;
  s += `<path class="ln-loop" d="M 196 330 H 884 A 56 56 0 0 1 940 386 V 484 A 56 56 0 0 1 884 540 H 196 A 56 56 0 0 1 140 484 V 386 A 56 56 0 0 1 196 330 Z"/>`;
  s += `<path class="ln-term" d="M 52 132 V 168"/>`;
  s += [chev(250,150,0), chev(470,150,0), chev(690,150,0), chev(800,240,90), chev(670,330,180), chev(410,330,180), chev(140,435,90), chev(410,540,0), chev(670,540,0), chev(940,435,-90)].join('');
  s += `<text class="m-note" x="60" y="196">ONE-TIME SETUP · PER DEAL</text>`;
  s += `<text class="m-water" x="540" y="476" text-anchor="middle">EVERY MONTH</text>`;
  s += `<text class="m-note" transform="translate(976 435) rotate(-90)" text-anchor="middle">NEXT MONTH</text>`;
  MISSIONS.forEach((m) => {
    const [x, y] = POS[m.n];
    const above = m.n <= 4;
    const pl = playersOf(m);
    const bw = 23; const bx0 = x - ((pl.length - 1) * bw) / 2;
    const yb = above ? y - 40 : y + 44; const yn = above ? y - 64 : y + 78; const ym = above ? y - 88 : y + 100;
    const done = !!P.done[m.n];
    s += `<a class="stn${done ? ' done' : ''}" href="#m${m.n}" data-go="m${m.n}" aria-label="Mission ${m.n}: ${esc(m.name)}${done ? ', done' : ''}">`;
    if (m.n === 5) s += `<circle class="stn-x" cx="${x}" cy="${y}" r="32"/>`;
    s += `<circle class="stn-c" cx="${x}" cy="${y}" r="22"/><text class="stn-n" x="${x}" y="${y + 6.5}" text-anchor="middle">${done ? '✓' : m.n}</text>`;
    s += `<text class="stn-name" x="${x}" y="${yn}" text-anchor="middle">${esc(m.short)}</text>`;
    s += `<text class="stn-meta" x="${x}" y="${ym}" text-anchor="middle">${m.steps.length} steps · ${loginsIn(m)} log-ins</text>`;
    s += pl.map((k, i) => badge(k, bx0 + i * bw, yb)).join('');
    s += `</a>`;
  });
  return s + `</svg>`;
}
function mapList() {
  const item = (m) => `<a class="ll-i ${m.zone}${P.done[m.n] ? ' done' : ''}" href="#m${m.n}" data-go="m${m.n}"><span class="ll-n">${P.done[m.n] ? '✓' : m.n}</span><span class="ll-t"><b>${esc(m.short)}</b><small>${m.steps.length} steps · ${loginsIn(m)} log-ins</small></span><span class="ll-b">${playersOf(m).map((k) => rb(k, 'xs')).join('')}</span></a>`;
  return `<div class="ll"><p class="ll-h">One-time setup · per deal</p>${MISSIONS.filter((m) => m.zone === 'setup').map(item).join('')}<p class="ll-h">Every month · then back to Energy</p>${MISSIONS.filter((m) => m.zone === 'month').map(item).join('')}</div>`;
}
function viewMap() {
  const stats = [[MISSIONS.length,'missions'],[TOTAL_STEPS,'steps'],[8,'players'],[LOGINS,'log-ins, full run']];
  const x = xpNow(); const doneN = MISSIONS.filter(isDone).length; const next = MISSIONS.find((m) => !isDone(m));
  const questsN = QUESTS.filter(isDone).length;
  return `
  <section class="intro">
    <div>
      <p class="eyebrow">SJVN · REIA desk · renewable energy intermediary</p>
      <h1>How a REIA deal moves, from first document to closed month</h1>
      <p class="lede">SJVN buys power from a seller under a PPA, sells it to a buyer under a PSA, and keeps the SJVN margin. Four stations set a deal up once. Six repeat every month. Open a station to play it step by step: who logs in, which screen, which button, what changes.</p>
      <div class="me">
        <div><small>Your rank</small><b>${esc(rankOf(x))}</b></div>
        <span class="me-bar" aria-hidden="true"><i style="width:${Math.min(100, x / MAXXP * 100).toFixed(1)}%"></i></span>
        <div class="me-n"><b>${doneN}</b> of ${MISSIONS.length} missions done · <b>${questsN}</b> of ${QUESTS.length} side quests · best quiz <b>${P.best || 0}</b>/10 · ${x} XP</div>
        <button class="btn primary" type="button" data-go="m${next ? next.n : 1}">${ICON.play} ${next ? `Next: ${esc(next.short)}` : 'Replay mission 1'}</button>
      </div>
      <p class="cy-cta"><button class="btn" type="button" data-go="cycle">The whole cycle on one page, every exception included →</button></p>
    </div>
    <div class="stats">${stats.map(([n, l]) => `<div class="stat"><b>${n}</b><span>${l}</span></div>`).join('')}</div>
  </section>
  <section class="mapbox" aria-label="Line map">
    <div class="map-top"><h2>The line map</h2>
      <div class="legend"><span class="lgd"><i class="s"></i>Setup, once per deal</span><span class="lgd"><i></i>Monthly loop</span><span class="lgd">${rb('C','xs')}Who acts at the station</span><span class="lgd"><i class="d"></i>Mission marked done</span></div>
    </div>
    <div class="map-svg">${mapSvg()}</div>
    ${mapList()}
  </section>
  <section class="blk">
    <div class="blk-h"><h2>The players</h2><button class="lnk" type="button" data-go="players">Every power, role by role →</button></div>
    <div class="roster">${ROLE_ORDER.map((k) => `<button class="rcard" type="button" data-player="${k}" style="--c:var(--c-${R[k].c})">${rb(k,'lg')}<span><b>${esc(R[k].name)}</b><small>${esc(R[k].cls)} · ${esc(R[k].level)}</small></span></button>`).join('')}</div>
  </section>
  <section class="blk">
    <div class="blk-h"><h2>Rules of the game</h2><p>The platform enforces each of these. Nobody can skip them.</p></div>
    <div class="rules">${RULES.map((r) => `<div class="rule"><div class="rw">${r.who ? r.who.map((k) => rb(k,'sm')).join('') : ICON[r.icon]}</div><b>${esc(r.t)}</b><p>${fmt(r.d)}</p></div>`).join('')}</div>
  </section>`;
}

/* ───────────────────────── view: mission ───────────────────────── */
function resHtml(r) {
  if (!r) return '';
  return `<span>${esc(r.o)}:</span> ${r.text ? `<strong>${esc(r.text)}</strong>` : `${r.f ? st(r.f) + '<span class="arw">→</span>' : ''}${st(r.t)}`}`;
}
// from: who is logged in before the hand-off (null: nobody yet).
function handLabel(from, to) {
  if (to === 'X') return { cls:'auto', html:`${ICON.auto} Automatic` };
  return { cls:'', html:`${rb(to,'xs')} ${!from ? 'Log in as' : from === to ? 'Back to' : 'Log out, log in as'} ${esc(R[to].short)}` };
}
function stepCard(m, s, i) {
  return `<button class="step${s.opt ? ' opt' : ''}" type="button" data-step="${m.id}:${i}" style="--c:var(--c-${R[s.who].c})">
    <span class="sc-top">${rb(s.who,'sm')}<span class="sc-who">${esc(R[s.who].short)}</span><span class="sc-no">${m.kind === 'Quest' ? 'Q' : ''}${m.n}.${i + 1}</span>${s.opt ? '<span class="tag">If needed</span>' : ''}${s.alt ? `<span class="tag">or ${s.alt.map((k) => esc(R[k].short)).join(', ')}</span>` : ''}${s.block ? `<span class="sc-lock" title="Blocked for the wrong role: open for details">${ICON.lock}</span>` : ''}<span class="sc-go" aria-hidden="true">›</span></span>
    <span class="sc-t">${fmt(s.t)}</span>
    ${s.press ? `<span class="sc-press">${s.press.map((p) => `<span class="ui">${esc(p)}</span>`).join('<span class="sep">›</span>')}</span>` : ''}
    ${s.res ? `<span class="sc-res">${resHtml(s.res)}</span>` : ''}
    ${s.block ? `<span class="sc-block">${ICON.lock}<span>${fmt(s.block)}</span></span>` : ''}
  </button>`;
}
function missionExtra(m) {
  if (m.extra === 'docs') return `<section class="panel blk"><h3>Required documents</h3><div class="xgrid">
    <div><p class="eyebrow">Seller · 8 required</p><ul>${SELLER_DOCS.map((d) => `<li>${esc(d)}</li>`).join('')}</ul></div>
    <div><p class="eyebrow">Buyer · 4 required, 1 optional</p><ul>${BUYER_DOCS.map((d) => `<li>${esc(d)}</li>`).join('')}<li>SERC / regulatory commission approval (optional)</li></ul></div></div></section>`;
  if (m.extra === 'tiers') return `<section class="blk"><div class="blk-h"><h2>Inside a company: four access levels</h2><p>What each level may do, as the platform enforces it.</p></div><div class="pgrid">${['S','B'].map((k) => `<div class="panel" style="--c:var(--c-${R[k].c})"><h3>${rb(k,'sm')} ${esc(R[k].name)}</h3>${tierTable(k)}</div>`).join('')}</div></section>`;
  if (m.extra === 'ladder') return `<section class="panel blk"><h3>The approval ladder</h3><div class="ladder">
    ${[['Up to ₹1 lakh',['C']],['Above ₹1 lakh',['C','F']],['Above ₹10 lakh',['C','F','H']]].map(([b, ks]) => `<div class="lad"><b>${b}</b><div class="lad-steps">${ks.map((k, i) => `<span class="lv">${rb(k,'sm')} L${i + 1} ${esc(R[k].short)}${k === 'H' ? ' / Management' : ''}</span>`).join('<span class="arw">→</span>')}</div></div>`).join('')}
    </div><p class="lede" style="font-size:15px">Each level is a different person, in order. The maker who verified a bill cannot sign its Level 1. SJVN can change the bands and who signs each level in its masters.</p></section>`;
  if (m.extra === 'clock') return `<section class="panel blk"><h3>${ICON.clock} The dispute clock (default days)</h3>
    <div class="clock"><div class="clock-bar"><i style="width:${2 / 45 * 100}%;background:var(--c-checker)"></i><i style="width:${13 / 45 * 100}%;background:var(--c-hod)"></i><i style="width:${30 / 45 * 100}%;background:var(--c-buyer);opacity:.75"></i></div>
    <div class="clock-marks"><div><b>Day 0 → 2</b>Checker acknowledges</div><div><b>By day 15</b>HOD resolves, or ESCALATED</div><div><b>Then 15 days</b>Buyer accepts or contests</div></div></div>
    <p class="lede" style="font-size:15px">Separately, the buyer has 15 days from the bill’s presentation to raise a dispute at all.</p></section>`;
  if (m.extra === 'security') return `<section class="panel blk"><h3>How much cover, and who answers for whom</h3><div class="xgrid">
    <div><p class="eyebrow">Cover required on a PSA</p><ul><li>LC = 1.1 × a month’s bill (3-month average; before that, capacity × CUF × tariff)</li><li>Corpus = 10% of that</li><li>Coverage ratio = security ÷ (dues + next month’s average bill). Adequate at 1 or more.</li></ul></div>
    <div><p class="eyebrow">When someone defaults</p><div class="flow" style="margin-bottom:8px"><span class="fchip">${rb('B','xs')} Buyer</span><span class="farr">→</span><span class="fchip">LC</span><span class="farr">→</span><span class="fchip">Payment security fund</span><span class="farr">→</span><span class="fchip">Corpus fund</span></div><div class="flow"><span class="fchip">${rb('S','xs')} Seller</span><span class="farr">→</span><span class="fchip">Its bank guarantee</span><span class="farr">→</span><span class="fchip">Funds</span></div></div></div></section>`;
  if (m.extra === 'release') { const v = moneyCalc(DEMO); return `<section class="panel blk"><h3>The release, worked through</h3><div class="calc">
    <div><span>Seller’s bill</span><span class="v">${inr(v.BP)}</span></div>
    <div><span>Early-payment rebate SJVN earns (1.5%, paid within 5 days)</span><span class="v">− ${inr(v.rebate)}</span></div>
    <div><span>TDS u/s 194Q (0.1% above ₹50 lakh)</span><span class="v">− ${inr(v.TDS)}</span></div>
    <div class="tot"><span>Net paid to the seller</span><span class="v">${inr(v.net)}</span></div></div>
    <p style="margin-top:10px"><button class="lnk" type="button" data-go="money">Change the numbers in the Money tab →</button></p></section>`; }
  if (m.extra === 'recon') return `<section class="panel blk"><h3>What a statement compares</h3><div class="calc">
    <div><span>Energy<small>Metered (the locked figure) vs energy on every bill of the month</small></span><span class="v">MWh</span></div>
    <div><span>Billed vs paid<small>Bills of the month vs payments, credit notes included</small></span><span class="v">₹</span></div>
    <div><span>Tax and SAP<small>NOT_CONNECTED unless a figure is supplied</small></span><span class="v">—</span></div>
    <div><span>Performance<small>Availability against 90%; NOT_CONNECTED when none is recorded</small></span><span class="v">%</span></div>
    <div><span>Penalty<small>CUF below the PPA minimum is assessed at the year end</small></span><span class="v">₹</span></div></div></section>`;
  return '';
}
function viewMission(id) {
  const m = BOOK[id]; const n = m.n; const L = m.list;
  const word = m.kind === 'Quest' ? 'quest' : 'mission';
  const cols = playersOf(m);
  const colOf = (k) => cols.indexOf(k) + 1;
  let row = 2; const cells = [];
  m.steps.forEach((s, i) => {
    const prev = m.steps[i - 1];
    if (prev && prev.who !== s.who) {
      const a = colOf(prev.who); const b = colOf(s.who);
      const lo = Math.min(a, b); const hi = Math.max(a, b);
      const h = handLabel(humanBefore(m, i), s.who);
      cells.push(`<div class="hand ${b > a ? 'fwd' : 'back'}" style="--a:${lo};--b:${hi + 1};--k:${hi - lo + 1};--l0:${lo - 1};--h0:${hi - 1};--row:${row}"><span class="ln"></span><span class="pill ${h.cls}" title="${esc(loginHint(s.who))}">${h.html}</span></div>`);
      row++;
    }
    cells.push(`<div class="cell${isMine(s) ? ' me' : ''}" style="--col:${colOf(s.who)};--i:${colOf(s.who) - 1};--row:${row}">${stepCard(m, s, i)}</div>`);
    row++;
  });
  const heads = cols.map((k, i) => `<div class="lhead" style="--col:${i + 1}">${rb(k,'lg')}<b>${esc(R[k].short)}</b><small>${esc(R[k].side === 'Company' ? 'company log-in' : R[k].side === 'System' ? 'no log-in' : 'SJVN log-in')}</small></div>`).join('');
  const rails = cols.map((k, i) => `<span class="rail" style="--col:${i + 1};--i:${i};--end:${row};--c:var(--c-${R[k].c})"></span>`).join('');
  const blocks = m.steps.filter((s) => s.block);
  const done = isDone(m);
  const mine = P.me && m.steps.some(isMine);
  const main = ON_PORTAL ? placeLink(m.screen) : null;
  return `
  <nav class="mnav" aria-label="${m.kind === 'Quest' ? 'Side quests' : 'Missions'}">
    ${m.kind === 'Quest' ? '<button class="lnk" type="button" data-go="quests">← All side quests</button>' : ''}
    ${L.map((x) => `<button class="chip${isDone(x) ? ' done' : ''}" type="button" data-go="${x.id}"${x.n === n ? ' aria-current="true"' : ''} title="${esc(x.name)}">${x.n}</button>`).join('')}
    <span class="sp"></span>
    ${n > 1 ? `<button class="lnk" type="button" data-go="${L[n - 2].id}">← ${esc(L[n - 2].short)}</button>` : ''}
    ${n < L.length ? `<button class="lnk" type="button" data-go="${L[n].id}">${esc(L[n].short)} →</button>` : ''}
  </nav>
  <section class="mhead">
    <div>
      <p class="eyebrow">${esc(zoneName(m))} · ${m.kind} ${n} of ${L.length}</p>
      <h1>${esc(m.name)}</h1>
      <p class="lede">${fmt(m.goal)}</p>
      <div class="mstats">
        <span class="mstat"><b>${m.steps.length}</b>steps</span>
        <span class="mstat"><b>${loginsIn(m)}</b>log-ins</span>
        <span class="mstat"><b>${blocks.length}</b>wrong-role blocks</span>
        <span class="mplayers">${cols.map((k) => rb(k,'md')).join('')}</span>
      </div>
      <div class="mact">
        <button class="btn primary" type="button" data-play="${m.id}">${ICON.play} Play this ${word}</button>
        <button class="btn${done ? ' ok' : ''}" type="button" data-done="${m.id}" aria-pressed="${done}">${ICON.check} ${done ? 'Done' : 'Mark as done'}</button>
        <button class="btn" type="button" data-print>Print or save as PDF</button>
      </div>
    </div>
    <dl class="mmeta">
      <div><dt>Starts when</dt><dd>${fmt(m.start)}</dd></div>
      <div><dt>Ends with</dt><dd>${fmt(m.end)}</dd></div>
      <div><dt>Main screen</dt><dd>${esc(m.screen)}${main && !main.none ? `<br><a class="golink" href="${esc(main.url)}" target="_blank" rel="noopener">Open it ↗</a>` : ''}</dd></div>
    </dl>
  </section>
  ${P.me ? `<p class="me-bar-m">${rb(P.me,'sm')}${mine ? `Your steps as ${esc(R[P.me].short)} are lit; the rest are faded.` : `${esc(R[P.me].short)} has no step in this ${word}.`} <button class="lnk" type="button" data-me="">Show everyone’s</button></p>` : ''}
  <div class="lanes-wrap" data-cols="${cols.length}"><p class="lane-key">Lanes, left to right: ${cols.map((k) => `<span>${rb(k,'xs')}${esc(R[k].short)}</span>`).join('')}</p><div class="lanes${mine ? ' mine' : ''}" style="--cols:${cols.length};--nn:${Math.max(1, cols.length - 1)}">${rails}${heads}${cells.join('')}</div></div>
  <section class="mfoot">
    ${blocks.length ? `<div class="panel"><h3>${ICON.lock} What the platform blocks here</h3><ul class="blist">${blocks.map((s) => `<li>${rb(s.who,'sm')}<span>${fmt(s.block)}</span></li>`).join('')}</ul></div>` : ''}
    <div class="panel"><h3>Also on this desk</h3><ul class="alist">${m.also.map((a) => `<li>${fmt(a)}</li>`).join('')}</ul></div>
  </section>
  ${missionExtra(m)}
  ${printSteps(m)}`;
}
// What the printed copy says of each step: everything the drawer says, in order.
function printSteps(m) {
  const row = (h, v) => (v ? `<dt>${h}</dt><dd>${v}</dd>` : '');
  const list = (a, f = fmt) => (a && a.length ? `<ul>${a.map((x) => `<li>${f(x)}</li>`).join('')}</ul>` : '');
  const ui = (a) => (a ? a.map((p) => `<span class="ui">${esc(p)}</span>`).join(' › ') : '');
  return `<section class="print-only"><h2 style="margin:18px 0 6px">Step by step</h2>
    ${m.steps.map((s, i) => `<div class="pr-step"><h3>${stepId(m, i)} · ${esc(R[s.who].name)}${s.alt ? ` (or ${s.alt.map((k) => esc(R[k].short)).join(', ')})` : ''}${s.opt ? ' · if needed' : ''}: ${fmt(s.t)}</h3><dl>
      ${row('Log-in', esc(loginLine(m, i)))}${row('Where', esc(s.where || ''))}${row('Press', ui(s.press))}${row('Fill in', list(s.fill))}
      ${s.lists ? Object.entries(s.lists).map(([h, items]) => row(esc(h), list(items, esc))).join('') : ''}
      ${row('Result', s.res ? resHtml(s.res) : '')}${row('Applies', list(s.rules))}${row('If it refuses', list(s.refuse, (x) => `“${esc(x)}”`))}${row('Blocked', s.block ? fmt(s.block) : '')}
    </dl></div>`).join('')}
    <p class="pr-foot">REIA Playbook · ${m.kind === 'Quest' ? 'Side quest' : 'Mission'} ${m.n}: ${esc(m.name)} · printed ${new Date().toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' })}. Every label is as the platform shows it.</p></section>`;
}
function tierTable(k) {
  return `<div class="tbl-wrap" style="border:0"><table class="tier"><thead><tr><th>What</th><th>L1<br>Maker</th><th>L2<br>Checker</th><th>L3<br>Approver</th><th>Company<br>Admin</th></tr></thead><tbody>
    ${TIERS[k].map(([w, ...v]) => `<tr><td>${esc(w)}</td>${v.map((x) => `<td>${x ? ICON.check : '<span class="no">–</span>'}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

/* ───────────────────────── drawer ───────────────────────── */
let lastFocus = null;
function lastWord(m) {
  if (m.kind === 'Quest') return m.n < QUESTS.length ? `Quest complete. Next side quest: ${esc(QUESTS[m.n].name)}.` : 'That was the last side quest. The board shows which are still open.';
  return m.n < MISSIONS.length ? `Mission complete. Next mission: ${esc(MISSIONS[m.n].name)}.` : 'The month is closed. Next month starts again at Energy.';
}
function openDrawer(id, i) {
  const m = BOOK[id]; if (!m) return; const s = m.steps[i]; if (!s) return; const n = m.n;
  const next = m.steps[i + 1];
  const login = loginLine(m, i);
  const link = ON_PORTAL ? stepLink(m, s) : null;
  const lists = s.lists ? Object.entries(s.lists).map(([h, items]) => `<div class="dsec"><h4>${esc(h)}</h4><ul>${items.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>`).join('') : '';
  drawer.innerHTML = `
    <div class="d-top">${rb(s.who,'lg')}<div><small>${m.kind === 'Quest' ? 'Side quest' : 'Mission'} ${n} · step ${i + 1} of ${m.steps.length}${s.opt ? ' · if needed' : ''}</small><b>${esc(R[s.who].name)}${s.alt ? ` <span style="font-weight:400;color:var(--muted)">or ${s.alt.map((k) => esc(R[k].name)).join(', ')}</span>` : ''}</b></div><button class="dclose" type="button" data-close aria-label="Close">✕</button></div>
    <h2>${fmt(s.t)}</h2>
    <div class="dsec"><h4>Log-in</h4><div class="dlog">${s.who === 'X' ? ICON.auto : ICON.login}<span>${esc(login)}</span></div></div>
    ${s.where || link ? `<div class="dsec"><h4>Where</h4>${s.where ? `<p>${esc(s.where)}</p>` : ''}${link ? `<a class="golink" href="${esc(link.url)}" target="_blank" rel="noopener">${link.name === PORTAL_OF[s.who] ? `Open the ${esc(link.name)}` : 'Open this screen'} ↗ <small>${esc(link.url)}</small></a><p class="hint">Opens in a new tab, as whoever is signed in there: ${R[s.who].side === 'SJVN' ? `sign in as the ${esc(R[s.who].short)} first` : `sign in with the ${esc(R[s.who].short.toLowerCase())} company’s log-in first`}.</p>` : ''}</div>` : ''}
    ${s.press ? `<div class="dsec"><h4>Press</h4><div class="row">${s.press.map((p) => `<span class="ui">${esc(p)}</span>`).join('<span class="sep">›</span>')}</div></div>` : ''}
    ${s.fill ? `<div class="dsec"><h4>Fill in</h4><ul>${s.fill.map((x) => `<li>${fmt(x)}</li>`).join('')}</ul></div>` : ''}
    ${lists}
    ${s.res ? `<div class="dsec"><h4>Result</h4><div class="row">${resHtml(s.res)}</div></div>` : ''}
    ${s.rules ? `<div class="dsec"><h4>What the platform applies</h4><ul>${s.rules.map((x) => `<li>${fmt(x)}</li>`).join('')}</ul></div>` : ''}
    ${s.refuse ? `<div class="dsec"><h4>If it refuses, you see</h4>${s.refuse.map((x) => `<p class="quote">“${esc(x)}”</p>`).join('')}</div>` : ''}
    ${s.block ? `<div class="dsec"><h4>Blocked for the wrong role</h4><div class="row" style="color:var(--bad)">${ICON.lock}<span>${fmt(s.block)}</span></div></div>` : ''}
    <div class="dsec"><h4>Next</h4><p>${next ? `${next.who !== s.who ? (next.who === 'X' ? 'The platform takes over: ' : `Hand over to ${esc(R[next.who].name)}: `) : 'Same person: '}${fmt(next.t)}` : lastWord(m)}</p></div>
    <div class="dsec"><h4>Something wrong with this step?</h4><div class="sid"><code>${stepId(m, i)}</code>${ON_PORTAL ? `<a class="golink" style="margin:0" href="${esc(feedbackUrl(m, s, i))}" target="_blank" rel="noopener">Report a problem ↗</a>` : '<span class="hint" style="margin:0">Quote this step’s number when you report it.</span>'}</div>${ON_PORTAL ? '<p class="hint">The feedback form opens with this step filled in as the page it is about.</p>' : ''}</div>
    <div class="dnav"><button class="btn" type="button" data-open="${id}:${i - 1}"${i === 0 ? ' disabled' : ''}>← Previous step</button><button class="btn" type="button" data-open="${id}:${i + 1}"${!next ? ' disabled' : ''}>Next step →</button></div>`;
  if (!drawer.classList.contains('open')) lastFocus = document.activeElement;
  drawer.classList.add('open'); drawer.setAttribute('aria-hidden', 'false'); scrim.hidden = false;
  drawer.scrollTop = 0;
  const c = $('[data-close]', drawer); if (c) c.focus({ preventScroll:true });
}
function closeDrawer(silent) {
  if (!drawer.classList.contains('open')) return;
  drawer.classList.remove('open'); drawer.setAttribute('aria-hidden', 'true'); scrim.hidden = true;
  if (!silent && lastFocus && document.contains(lastFocus)) lastFocus.focus({ preventScroll:true });
}

/* ───────────────────────── play mode ───────────────────────── */
let play = null; let swTimer = null; let swNext = null;
function startPlay(id) {
  if (!BOOK[id]) return;
  closeDrawer(true);
  play = { id, i:0 };
  document.body.classList.add('playing');
  showStep();
}
function showStep() {
  if (!play) return;
  const m = BOOK[play.id]; const s = m.steps[play.i];
  $$('.step').forEach((el) => el.classList.toggle('cur', el.dataset.step === `${play.id}:${play.i}`));
  const el = $(`.step[data-step="${play.id}:${play.i}"]`);
  if (el) el.scrollIntoView({ block:'center', inline:'center', behavior: REDUCE ? 'auto' : 'smooth' });
  hud.hidden = false;
  hud.innerHTML = `<div class="hud-dots">${m.steps.map((x, k) => `<span class="${k === play.i ? 'on' : k < play.i ? 'past' : ''}"></span>`).join('')}</div>
    <div class="hud-row">${rb(s.who,'md')}<div class="hud-txt"><small>Step ${play.i + 1} of ${m.steps.length} · ${esc(R[s.who].name)}${s.opt ? ' · if needed' : ''}</small><b>${fmt(s.t)}</b></div>
    <div class="hud-btns"><button class="hb" type="button" data-hud="prev"${play.i === 0 ? ' disabled' : ''} aria-label="Previous step">←</button>${hudLink(m, s)}<button class="hb" type="button" data-hud="info">Details</button><button class="hb primary" type="button" data-hud="next">${play.i === m.steps.length - 1 ? 'Finish' : 'Next →'}</button><button class="hb" type="button" data-hud="exit" aria-label="Stop playing">✕</button></div></div>`;
}
function hudLink(m, s) {
  const l = ON_PORTAL ? stepLink(m, s) : null;
  return l ? `<a class="hb go" href="${esc(l.url)}" target="_blank" rel="noopener" title="Open ${esc(l.name)} in a new tab">Open screen ↗</a>` : '';
}
function stepPlay(d) {
  if (!play) return;
  const m = BOOK[play.id]; const j = play.i + d;
  if (j < 0) return;
  if (j >= m.steps.length) { finishPlay(); return; }
  const from = humanBefore(m, j); const to = m.steps[j].who;
  play.i = j;
  if (d > 0 && from !== to && to !== 'X') showSwitch(from, to); else showStep();
}
function showSwitch(from, to) {
  clearTimeout(swTimer);
  sw.innerHTML = `<div class="sw-box" role="dialog" aria-label="Switch player"><p class="eyebrow">${from ? 'Switch player' : 'First log-in'}</p><h3>${from ? 'Log out, then log in' : 'Log in'} as ${esc(R[to].name)}</h3>
    <div class="sw-row">${from ? `<div class="sw-who sw-from">${rb(from,'xl')}${esc(R[from].short)}</div><div class="sw-arrow">→</div>` : ''}<div class="sw-who">${rb(to,'xl')}${esc(R[to].short)}</div></div>
    <p class="sw-hint">${esc(loginHint(to))}</p><div class="sw-btns"><button class="btn primary" type="button" data-sw="go">Continue</button></div></div>`;
  sw.hidden = false;
  swNext = () => { sw.hidden = true; swNext = null; showStep(); };
  const b = $('[data-sw="go"]', sw); if (b) b.focus({ preventScroll:true });
  swTimer = setTimeout(() => { if (swNext) swNext(); }, 2200);
}
function finishPlay() {
  const m = BOOK[play.id]; const n = m.n; const done = isDone(m); const more = n < m.list.length;
  const what = m.kind === 'Quest' ? 'Side quest' : 'Mission';
  const gain = done ? 0 : m.steps.length * 10;
  clearTimeout(swTimer);
  sw.innerHTML = `<div class="sw-box" role="dialog" aria-label="${what} complete"><p class="eyebrow">${what} ${n} complete</p><h3>${esc(m.name)}</h3>
    <div class="sw-row"><div class="sw-who">${playersOf(m).map((k) => rb(k,'md')).join('')}</div></div>
    <p class="sw-hint">${m.steps.length} steps, ${loginsIn(m)} log-ins.${gain ? ` Marking it done adds ${gain} XP.` : ' Already marked done.'}</p>
    <div class="sw-btns">${done ? '' : `<button class="btn primary" type="button" data-sw="done">${ICON.check} Mark done${more ? ' and go to the next' : ''}</button>`}${done && more ? `<button class="btn primary" type="button" data-sw="next">Next ${m.kind === 'Quest' ? 'quest' : 'mission'} →</button>` : ''}<button class="btn" type="button" data-sw="stay">Stay here</button></div></div>`;
  sw.hidden = false;
  swNext = null;
  const b = $('.sw-btns .btn', sw); if (b) b.focus({ preventScroll:true });
}
function exitPlay() {
  play = null; clearTimeout(swTimer); swNext = null;
  sw.hidden = true; hud.hidden = true;
  document.body.classList.remove('playing');
  $$('.step.cur').forEach((el) => el.classList.remove('cur'));
}

/* ───────────────────────── view: players ───────────────────────── */
function playerCard(k) {
  const r = R[k];
  if (k === 'X') {
    return `<article class="pc" id="p-X" style="--c:var(--c-sys)"><header>${rb('X','xl')}<div><p class="pc-cls">${esc(r.cls)}</p><h3>${esc(r.name)}</h3></div></header><p class="pc-line">${esc(r.line)}</p><ul class="pc-can">${AUTO_JOBS.map((j) => `<li>${ICON.auto}<span>${esc(j)}</span></li>`).join('')}</ul></article>`;
  }
  const can = MX.filter((row) => row.cell[k] === 'Y' || row.cell[k] === 'y');
  const cant = MX.filter((row) => row.cell[k] === 'x');
  const ms = MISSIONS.filter((m) => m.steps.some((s) => s.who === k || (s.alt || []).includes(k)));
  const steps = MISSIONS.reduce((a, m) => a + m.steps.filter((s) => s.who === k).length, 0);
  const qs = QUESTS.filter((q) => q.steps.some((s) => s.who === k || (s.alt || []).includes(k)));
  return `<article class="pc" id="p-${k}" style="--c:var(--c-${r.c})">
    <header>${rb(k,'xl')}<div><p class="pc-cls">${esc(r.cls)}</p><h3>${esc(r.name)}</h3><p class="pc-lvl">${esc(r.level)}</p></div></header>
    <p class="pc-line">${esc(r.line)}</p>
    <div class="pc-stats"><div><b>${ms.length}</b><span>missions</span></div><div><b>${steps}</b><span>steps</span></div><div><b>${can.length}</b><span>powers</span></div><div><b>${cant.length}</b><span>blocked</span></div></div>
    ${ms.length ? `<div class="pc-ms">${ms.map((m) => `<button class="chip" type="button" data-go="m${m.n}"><span class="chip-n">${m.n}</span>${esc(m.short)}</button>`).join('')}</div>` : ''}
    ${qs.length ? `<details><summary>Side quests (${qs.length})</summary><div class="pc-ms">${qs.map((q) => `<button class="chip" type="button" data-go="${q.id}"><span class="chip-n">Q${q.n}</span>${esc(q.short)}</button>`).join('')}</div></details>` : ''}
    <details open><summary>Can do (${can.length})</summary><ul class="pc-can">${can.map((row) => `<li>${ICON.check}<span>${fmt(row.a)}${row.cell[k] === 'y' ? ' <em>(shared)</em>' : ''}<span class="mod">${esc(row.mod)}</span></span></li>`).join('')}</ul></details>
    ${cant.length ? `<details><summary>Blocked by the platform (${cant.length})</summary><ul class="pc-cant">${cant.map((row) => `<li>${ICON.lock}<span>${fmt(row.a)}<span class="mod">${esc(row.mod)}</span></span></li>`).join('')}</ul></details>` : ''}
    ${k === 'S' || k === 'B' ? `<details><summary>Inside the company: Levels 1–3</summary>${tierTable(k)}</details>` : ''}
    <p class="pc-login">${ICON.login}<span>${esc(loginHint(k))}</span></p>
  </article>`;
}
function viewPlayers() {
  return `<section><p class="eyebrow">Players</p><h1>Who holds which power</h1>
    <p class="lede">Eight roles act on the REIA desk, six inside SJVN and two outside it. Each card lists what the role can do and what the platform refuses it, taken from the same rules the platform applies.</p></section>
    <h2 class="side-h">SJVN side</h2><div class="pgrid">${['M','C','H','F','G','A'].map(playerCard).join('')}</div>
    <h2 class="side-h">Company side</h2><div class="pgrid">${['S','B'].map(playerCard).join('')}</div>
    <h2 class="side-h">No log-in</h2><div class="pgrid">${playerCard('X')}</div>`;
}

/* ───────────────────────── view: powers ───────────────────────── */
const PW = { mod:'All', hl:'', q:'' };
const CELL = { Y:'Does it', y:'Can also', r:'Sees only', x:'Blocked', '-':'No access' };
function viewPowers() {
  return `<section><p class="eyebrow">Powers</p><h1>Who can press what</h1>
    <p class="lede">Every action on the REIA desk against every role. Pick a module, search an action, or click a role to light up its column.</p></section>
    <div class="tools">
      ${['All', ...MODS].map((x) => `<button class="chip" type="button" data-mod="${esc(x)}" aria-pressed="${PW.mod === x}">${esc(x)}</button>`).join('')}
      <input class="search" id="pw-q" type="search" placeholder="Search an action, e.g. lock, LC, sign" value="${esc(PW.q)}" aria-label="Search actions">
    </div>
    <div class="pw-legend">
      <span><span class="cd" style="--c:var(--c-maker)">${ICON.check}</span>Does it</span>
      <span><span class="cd hollow" style="--c:var(--c-maker)">${ICON.check}</span>Can also</span>
      <span><span class="cs"></span>Sees only</span>
      <span><span class="cx">${ICON.lock}</span>Blocked by the platform</span>
      <span><span class="cn">–</span>Not on their screens</span>
    </div>
    <div class="tbl-wrap"><table class="pw" id="pwt"></table></div>`;
}
function paintPowers() {
  const t = $('#pwt'); if (!t) return;
  const q = PW.q.trim().toLowerCase();
  const rows = MX.filter((r) => (PW.mod === 'All' || r.mod === PW.mod) && (!q || (r.a + ' ' + r.note + ' ' + r.mod).toLowerCase().includes(q)));
  const head = `<thead><tr><th scope="col" style="text-align:left;padding-left:14px">Action</th>${ROLE_ORDER.map((k) => `<th scope="col"><button type="button" data-hl="${k}" aria-pressed="${PW.hl === k}">${rb(k,'sm')}<span>${esc(R[k].short)}</span></button></th>`).join('')}</tr></thead>`;
  if (!rows.length) { t.innerHTML = head + `<tbody><tr><td colspan="9" class="empty">No action matches “${esc(PW.q)}”. Try a shorter word.</td></tr></tbody>`; return; }
  let body = ''; let mod = '';
  rows.forEach((r) => {
    if (r.mod !== mod) { mod = r.mod; body += `<tr class="grp"><th colspan="9" scope="rowgroup">${esc(mod)}</th></tr>`; }
    body += `<tr><th scope="row">${fmt(r.a)}${r.note ? `<small>${fmt(r.note)}</small>` : ''}</th>${ROLE_ORDER.map((k) => {
      const v = r.cell[k];
      const g = v === 'Y' ? `<span class="cd" style="--c:var(--c-${R[k].c})">${ICON.check}</span>`
        : v === 'y' ? `<span class="cd hollow" style="--c:var(--c-${R[k].c})">${ICON.check}</span>`
        : v === 'r' ? '<span class="cs"></span>' : v === 'x' ? `<span class="cx">${ICON.lock}</span>` : '<span class="cn">–</span>';
      return `<td class="${PW.hl === k ? 'hl' : ''}" style="--c:var(--c-${R[k].c})" title="${esc(R[k].name)}: ${CELL[v]}"><span class="vh">${CELL[v]}</span><span aria-hidden="true">${g}</span></td>`;
    }).join('')}</tr>`;
  });
  t.innerHTML = head + `<tbody>${body}</tbody>`;
}

/* ───────────────────────── view: lifecycles ───────────────────────── */
let LC = 'billb';
function viewLife() {
  const L = LIFE.find((x) => x.id === LC) || LIFE[0];
  const track = (tr) => `<div class="lc-card"><h3>${esc(tr.title)}</h3><div class="trk">${tr.main.map((nd, i) => `${i || nd.by ? `<span class="edge"><span class="who">${(nd.by || []).map((k) => rb(k,'xs')).join('')}</span><span class="arr"></span><span class="lbl">${fmt(nd.act || '')}</span></span>` : ''}${st(nd.s, true)}`).join('')}</div>
    ${tr.br && tr.br.length ? `<ul class="branches">${tr.br.map((b) => `<li>${/^[A-Z_]+$/.test(b.f) ? st(b.f) : `<span class="br-note">${esc(b.f)}</span>`}<span class="br-act"><span class="arw">→</span>${b.by.map((k) => rb(k,'xs')).join('')}${fmt(b.act)}<span class="arw">→</span></span>${st(b.t)}${b.note ? `<span class="br-note">${esc(b.note)}</span>` : ''}</li>`).join('')}</ul>` : ''}</div>`;
  return `<section><p class="eyebrow">Lifecycles</p><h1>Every status, and who moves it</h1>
    <p class="lede">Each record on the desk moves through fixed statuses. The main path runs left to right; side exits are listed under it. The badge on each arrow is the role that makes that move.</p></section>
    <div class="lc-tabs">${LIFE.map((x) => `<button class="chip" type="button" data-lc="${x.id}" aria-pressed="${x.id === L.id}">${esc(x.name)}</button>`).join('')}</div>
    ${L.tracks.map(track).join('')}
    ${L.notes ? `<ul class="lc-notes">${L.notes.map((x) => `<li>${fmt(x)}</li>`).join('')}</ul>` : ''}`;
}

/* ───────────────────────── view: log-in relay ───────────────────────── */
let RF = 'all';
function viewRelay() {
  const ss = sessions(RF);
  const logins = ss.filter((s) => s.who !== 'X').length;
  const max = Math.max(...MISSIONS.map(loginsIn));
  let count = 0;
  return `<section class="relay-top">
      <div><p class="eyebrow">Log-in relay</p><h1>When to log out, and who logs in next</h1>
      <p class="lede">One complete run, from onboarding to a closed month, as a relay of log-ins. Each block is one sitting: log in, do the actions listed, log out, hand the baton on. Click an action for its details.</p>
      <div class="tools">${[['all','Full run'],['setup','Setup only'],['month','One month']].map(([id, l]) => `<button class="chip" type="button" data-rf="${id}" aria-pressed="${RF === id}">${l}</button>`).join('')}<span class="mstat"><b>${logins}</b>log-ins</span></div></div>
      <div class="bars-mini" aria-label="Log-ins per mission">${MISSIONS.map((m) => `<div class="bm"><span>${m.n} · ${esc(m.short)}</span><i style="width:${(loginsIn(m) / max * 100).toFixed(0)}%"></i><b>${loginsIn(m)}</b></div>`).join('')}</div>
    </section>
    <ol class="relay">${ss.map((s, idx) => `<li class="rl" style="--c:var(--c-${R[s.who].c})">${rb(s.who,'lg')}<div class="rl-h"><small>${s.who === 'X' ? 'Automatic' : `Log-in ${++count}`}</small><b>${esc(R[s.who].name)}</b><span>${esc(loginHint(s.who))}</span></div>
      <ol class="rl-acts">${s.items.map((it) => `<li><button type="button" data-open="${it.m.id}:${it.i}"><span class="mtag">${it.m.n}.${it.i + 1}</span><span>${fmt(it.s.t)}${it.s.opt ? ' <em>(if needed)</em>' : ''}</span></button></li>`).join('')}</ol>
      ${idx < ss.length - 1 && s.who !== 'X' ? `<div class="rl-out">Log out</div>` : '<div class="rl-out" style="visibility:hidden">·</div>'}</li>`).join('')}</ol>`;
}

/* ───────────────────────── view: money ───────────────────────── */
const DEMO = { mwh:7920, ppa:2.75, margin:70, credit:50000, rebate:1.5, tds:true };
const MV = Object.assign({}, DEMO);
function moneyCalc(v) {
  const BP = v.mwh * 1000 * v.ppa;
  const margin = v.mwh * v.margin;
  const BS = BP + margin;
  const CN = Math.min(v.credit, BS);
  const paid = BS - CN;
  const realised = BS > 0 ? paid * BP / BS : 0;
  const rebate = BP * v.rebate / 100;
  const cap = Math.max(0, Math.min(realised, BP - rebate));
  const TDS = v.tds ? Math.max(0, BP - 5000000) * 0.001 : 0;
  const net = Math.max(0, cap - TDS);
  const held = Math.max(0, (BP - rebate) - cap);
  const keeps = paid - net - TDS;
  return { BP, margin, BS, CN, paid, realised, rebate, cap, TDS, net, held, keeps, psa: v.ppa + v.margin / 1000 };
}
function viewMoney() {
  const inp = (id, label, min, max, step, val) => `<div class="inp"><label for="${id}"><span>${label}</span><output id="${id}-o" for="${id}"></output></label><input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${val}"></div>`;
  return `<section><p class="eyebrow">Money</p><h1>Follow one month’s money</h1>
    <p class="lede">The worked example from the demo run: 50 MW solar, September, 7,920 MWh. Move the sliders to see how the buyer’s bill, the dispute, the rebate and TDS change what the seller is paid and what SJVN keeps.</p></section>
    <div class="money">
      <div class="inputs">
        ${inp('mv-mwh','Energy (MWh)',500,20000,10,MV.mwh)}
        ${inp('mv-ppa','PPA tariff (₹/kWh)',2,4.5,0.01,MV.ppa)}
        ${inp('mv-margin','SJVN margin (₹/MWh)',0,200,1,MV.margin)}
        ${inp('mv-credit','Dispute credit accepted (₹)',0,500000,5000,MV.credit)}
        ${inp('mv-rebate','Early-payment rebate (%)',0,3,0.25,MV.rebate)}
        <div class="inp ck"><label for="mv-tds"><input type="checkbox" id="mv-tds"${MV.tds ? ' checked' : ''}> TDS u/s 194Q applies (first bill of the year)</label></div>
        <button class="btn" type="button" data-reset>Back to the demo figures</button>
      </div>
      <div class="bars" id="mv-out"></div>
    </div>`;
}
function paintMoney() {
  const out = $('#mv-out'); if (!out) return;
  const v = moneyCalc(MV);
  const set = (id, txt) => { const o = $('#' + id + '-o'); if (o) o.textContent = txt; };
  set('mv-mwh', MV.mwh.toLocaleString('en-IN') + ' MWh'); set('mv-ppa', '₹' + MV.ppa.toFixed(2)); set('mv-margin', '₹' + MV.margin);
  set('mv-credit', inr(MV.credit)); set('mv-rebate', MV.rebate.toFixed(2) + '%');
  const scale = Math.max(v.BS, 1);
  const w = (x) => `${Math.max(0, x / scale * 100).toFixed(2)}%`;
  const bar = (label, total, segs) => `<div><div class="bl"><b>${label}</b><span>${inr(total)} · ${crore(total)}</span></div><div class="bar">${segs.map(([c, x, t]) => `<i class="${c}" style="width:${w(x)}" title="${esc(t)}: ${inr(x)}"></i>`).join('')}</div></div>`;
  out.innerHTML = `
    ${bar('SJVN’s bill on the buyer (PSA)', v.BS, [['s-energy', v.BP, 'Energy at the PPA tariff'], ['s-margin', v.margin, 'SJVN margin']])}
    ${bar('Credit note from the dispute', v.CN, [['s-credit', v.CN, 'Credit note']])}
    ${bar('Buyer pays SJVN', v.paid, [['s-pay', v.paid, 'Buyer payment']])}
    ${bar('Seller’s bill on SJVN (PPA)', v.BP, [['s-net', v.net, 'Net paid to the seller'], ['s-tds', v.TDS, 'TDS'], ['s-rebate', v.rebate, 'Rebate'], ['s-held', v.held, 'Held until realised']])}
    ${bar('SJVN keeps', Math.max(0, v.keeps), [['s-keep', Math.max(0, v.keeps), 'SJVN keeps']])}
    <div class="keys"><span><i class="s-energy"></i>Energy / net to seller</span><span><i class="s-margin"></i>SJVN</span><span><i class="s-credit"></i>Credit note</span><span><i class="s-pay"></i>Buyer’s payment</span><span><i class="s-tds"></i>TDS</span><span><i class="s-rebate"></i>Rebate</span>${v.held > 0.5 ? '<span><i class="s-held"></i>Held until the buyer pays</span>' : ''}</div>
    <div class="calc">
      <div><span>PSA tariff<small>PPA tariff ₹${MV.ppa.toFixed(2)} + margin ₹${MV.margin}/MWh</small></span><span class="v">₹${v.psa.toFixed(3)}/kWh</span></div>
      <div><span>Seller’s bill<small>${MV.mwh.toLocaleString('en-IN')} MWh × 1,000 × ₹${MV.ppa.toFixed(2)}</small></span><span class="v">${inr(v.BP)}</span></div>
      <div><span>SJVN’s bill on the buyer<small>of which SJVN margin ${inr(v.margin)}</small></span><span class="v">${inr(v.BS)}</span></div>
      <div><span>Buyer pays<small>bill − credit note</small></span><span class="v">${inr(v.paid)}</span></div>
      <div><span>Seller’s share of that<small>paid × seller’s bill ÷ SJVN’s bill</small></span><span class="v">${inr(v.realised)}</span></div>
      <div><span>Rebate SJVN earns by paying early<small>${MV.rebate.toFixed(2)}% of the seller’s bill (1.5% within 5 days of it, 1% within 30)</small></span><span class="v">${inr(v.rebate)}</span></div>
      <div><span>Release cap<small>lower of the share and (bill − rebate)</small></span><span class="v">${inr(v.cap)}</span></div>
      <div><span>TDS u/s 194Q<small>0.1% of the bill above ₹50 lakh</small></span><span class="v">${inr(v.TDS)}</span></div>
      <div class="tot"><span>Net paid to the seller<small>cap − TDS</small></span><span class="v">${inr(v.net)}</span></div>
      <div class="tot"><span>SJVN keeps<small>buyer’s payment − net − TDS${v.held > 0.5 ? `, including ${inr(v.held)} held for the seller` : ''}</small></span><span class="v">${inr(v.keeps)}</span></div>
    </div>`;
}

/* ───────────────────────── view: side quests ───────────────────────── */
// The baton for a card: who acts, in turn, with each log-in once.
function relayOf(m) {
  const out = [];
  m.steps.forEach((s) => { if (!out.length || out[out.length - 1] !== s.who) out.push(s.who); });
  return out;
}
function viewSide() {
  const doneN = QUESTS.filter(isDone).length;
  const card = (q) => {
    const done = isDone(q);
    return `<article class="sqc${done ? ' done' : ''}">
      <div class="sq-top"><span class="sq-n" aria-hidden="true">${done ? '✓' : q.n}</span><span class="sq-meta">${q.steps.length} steps · ${loginsIn(q)} log-ins${done ? ' · done' : ''}</span></div>
      <h3><a href="#${q.id}" data-go="${q.id}">${esc(q.name)}</a></h3>
      <p class="where">${esc(q.screen)}</p>
      <p class="sq-goal">${fmt(q.goal)}</p>
      <div class="flow" aria-label="Who acts, in turn">${relayOf(q).map((k) => rb(k,'sm')).join('<span class="farr">→</span>')}</div>
      <div class="sq-act"><button class="btn primary" type="button" data-play="${q.id}">${ICON.play} Play</button><button class="btn" type="button" data-go="${q.id}">Open the lanes</button></div>
    </article>`;
  };
  return `<section><p class="eyebrow">Side quests</p><h1>Everything else on the desk</h1>
    <p class="lede">The screens beyond the ten missions, each played the same way: lanes for each player, the button to press, where to log out and who logs in next. ${doneN} of ${QUESTS.length} done.</p></section>
    ${QZONES.map(([z, label]) => `<h2 class="side-h">${esc(label)}</h2><div class="sq">${QUESTS.filter((q) => q.zone === z).map(card).join('')}</div>`).join('')}`;
}

/* ───────────────────────── view: find a step ───────────────────────── */
// One search over every step of every mission and side quest, and "my steps":
// a role picked here lights that role's steps in every lane view too.
if (P.me && !ROLE_ORDER.includes(P.me)) P.me = '';
const FD = { q:'' };
let FIND_INDEX = null;
const plain = (x) => String(x ?? '').replace(/`|\*\*/g, '').replace(/\{([A-Z][A-Z0-9_]*)\}/g, (m, t) => t.replace(/_/g, ' '));
function findIndex() {
  if (FIND_INDEX) return FIND_INDEX;
  FIND_INDEX = [];
  [...MISSIONS, ...QUESTS].forEach((m) => m.steps.forEach((s, i) => {
    const lists = s.lists ? Object.entries(s.lists).flat(2) : [];
    const res = s.res ? [s.res.o, s.res.text, s.res.f, s.res.t].filter(Boolean).map((x) => String(x).replace(/_/g, ' ')) : [];
    FIND_INDEX.push({ m, s, i,
      title:plain(s.t).toLowerCase(), press:(s.press || []).join(' ').toLowerCase(),
      hay:[s.t, s.where, ...(s.press || []), ...(s.fill || []), ...(s.rules || []), ...(s.refuse || []), s.block, ...lists, ...res, m.name, m.short, m.screen, R[s.who].name, ...(s.alt || []).map((k) => R[k].name)].map(plain).join(' \u0001 ').toLowerCase() });
  }));
  return FIND_INDEX;
}
// Words a question carries that no step does, in English and Hindi as testers type them.
const STOP = new Set('a an the is are of to in on for do does how where what who which when can i my me we it this that and or kahan kaha kahaan hai hain kaise kaisa kya ka ki ke ko mein me se par karna karte karein karo hota hoti kab kaun konsa'.split(' '));
const words = (q) => { const all = q.toLowerCase().split(/[\s,?!.]+/).filter(Boolean); const w = all.filter((x) => !STOP.has(x)); return w.length ? w : all; };
const reEsc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const mark = (text, ws) => { let h = esc(plain(text)); if (!ws.length) return h; return h.replace(new RegExp(`(^|[^a-z0-9])(${ws.map((w) => reEsc(esc(w))).join('|')})`, 'gi'), '$1<mark>$2</mark>'); };
function viewFind() {
  return `<section><p class="eyebrow">Find a step</p><h1>Where is it, and who does it?</h1>
    <p class="lede">Search every mission and side quest at once: a button, a screen, a status, a word from a message. Pick your role to see your own steps here, and to light them up in every mission.</p></section>
    <div class="tools"><input class="search" id="fd-q" type="search" placeholder="e.g. Raise LPS bills, Form 16A, LOCKED" value="${esc(FD.q)}" aria-label="Search every step" autocomplete="off"></div>
    <div class="fd-roles" role="group" aria-label="My role">${['', ...ROLE_ORDER].map((k) => `<button class="chip" type="button" data-me="${k}" aria-pressed="${(P.me || '') === k}">${k ? `${rb(k,'xs')}${esc(R[k].short)}` : 'Everyone'}</button>`).join('')}</div>
    <div id="fd-out" aria-live="polite"></div>`;
}
function paintFind() {
  const out = $('#fd-out'); if (!out) return;
  $$('[data-me]', app).forEach((b) => b.setAttribute('aria-pressed', String((P.me || '') === b.dataset.me)));
  const q = FD.q.trim(); const ws = q ? words(q) : [];
  // From the start of a word: "lock" finds LOCKED, not "blocked".
  const res = ws.map((w) => new RegExp(`(^|[^a-z0-9])${reEsc(w)}`));
  let hits = findIndex().filter((x) => !P.me || isMine(x.s));
  if (ws.length) {
    hits = hits.filter((x) => res.every((re) => re.test(x.hay)))
      .map((x) => ({ x, score:res.reduce((a, re) => a + (re.test(x.title) ? 3 : 0) + (re.test(x.press) ? 2 : 0) + 1, 0) }))
      .sort((a, b) => b.score - a.score).map((h) => h.x);
  }
  if (!ws.length && !P.me) { out.innerHTML = `<p class="empty">Type what you are looking for, or pick your role to list your steps.</p>`; return; }
  const item = (x) => `<li><button class="fd-item" type="button" data-find="${x.m.id}:${x.i}">${rb(x.s.who,'md')}<small>${stepId(x.m, x.i)} · ${esc(x.m.kind === 'Quest' ? 'Side quest' : 'Mission')} ${x.m.n}: ${esc(x.m.short)}${x.s.alt ? ` · or ${x.s.alt.map((k) => esc(R[k].short)).join(', ')}` : ''}</small><b>${mark(x.s.t, ws)}</b><span class="fd-where">${x.s.where ? mark(x.s.where, ws) : ''}${x.s.press ? ` · ${x.s.press.map((p) => `<span class="ui">${mark(p, ws)}</span>`).join(' ')}` : ''}</span></button></li>`;
  const powers = ws.length ? MX.filter((r) => res.every((re) => re.test(plain(r.a + ' ' + (r.note || '') + ' ' + r.mod).toLowerCase()))).slice(0, 6) : [];
  let html = `<p class="fd-sum">${hits.length} step${hits.length === 1 ? '' : 's'}${P.me ? ` for ${esc(R[P.me].short)}` : ''}${ws.length ? ` matching “${esc(q)}”` : ''}</p>`;
  if (!hits.length) html += `<p class="empty">No step matches${P.me ? ` for ${esc(R[P.me].short)}` : ''}. Try one word, or pick Everyone.</p>`;
  else if (ws.length) html += `<ol class="fd-list">${hits.slice(0, 60).map(item).join('')}</ol>${hits.length > 60 ? '<p class="fd-sum" style="margin-top:10px">Showing the best 60. Add a word to narrow it.</p>' : ''}`;
  else {
    // My steps, mission by mission, in the order a month runs.
    const books = [...new Set(hits.map((x) => x.m))];
    html += books.map((m) => `<h2 class="fd-group">${esc(m.kind === 'Quest' ? 'Side quest' : 'Mission')} ${m.n} · ${esc(m.name)}</h2><ol class="fd-list">${hits.filter((x) => x.m === m).map(item).join('')}</ol>`).join('');
  }
  if (powers.length) html += `<h2 class="fd-group">In the powers matrix</h2><ul class="fd-list">${powers.map((r) => `<li><button class="fd-item" type="button" data-pwq="${esc(plain(r.a))}"><span></span><small>Powers · ${esc(r.mod)}</small><b>${mark(r.a, ws)}</b></button></li>`).join('')}</ul>`;
  out.innerHTML = html;
}

/* ───────────────────────── view: the full cycle ───────────────────────── */
// Every stage on one page: the normal path, then every exception. The filter
// narrows the exceptions; a stage whose title matches keeps all of its own.
const CY = { q:'' };
const CY_STEPS = CYCLE.reduce((a, c) => a + c.path.length, 0);
const CY_EDGES = CYCLE.reduce((a, c) => a + c.edges.length, 0);
const phaseName = (p) => CPHASES.find(([k]) => k === p)[1];
const seeName = (id) => `${BOOK[id].kind === 'Quest' ? 'Side quest' : 'Mission'} ${BOOK[id].n} · ${BOOK[id].short}`;
const edgeHay = (e) => plain([e.if, e.then, e.refuse].join(' ')).toLowerCase();
function viewCycle() {
  const stats = [[CYCLE.length,'stages'],[CY_STEPS,'steps'],[CY_EDGES,'exceptions'],[8,'players']];
  return `<section class="intro">
    <div><p class="eyebrow">Full cycle · one page</p><h1>The whole REIA cycle, with every exception</h1>
    <p class="lede">From the first KYC document to the year’s returns, in the order a deal lives. Each stage gives the normal path, who acts and what it ends in, then every way it can go differently and what the platform does then, with the message it shows when it refuses. Play any stage step by step from its links.</p></div>
    <div class="stats">${stats.map(([n, l]) => `<div class="stat"><b>${n}</b><span>${l}</span></div>`).join('')}</div>
  </section>
  <nav class="cy-nav" aria-label="Stages">${CPHASES.map(([p, name]) => `<div class="cy-ph"><small>${esc(name)}</small><div>${CYCLE.map((c, i) => c.phase === p ? `<button class="chip" type="button" data-cy="${i + 1}">${i + 1} · ${esc(c.t)}</button>` : '').join('')}</div></div>`).join('')}</nav>
  <div class="tools cy-tools"><input class="search" id="cy-q" type="search" placeholder="Filter the exceptions, e.g. late, cancel, KYC" value="${esc(CY.q)}" aria-label="Filter the exceptions" autocomplete="off"><button class="btn" type="button" data-print>Print or save as PDF</button></div>
  ${P.me ? `<p class="me-bar-m">${rb(P.me,'sm')}Your steps as ${esc(R[P.me].short)} are lit. <button class="lnk" type="button" data-me="">Show everyone’s</button></p>` : ''}
  <div id="cy-out" aria-live="polite">${cycleStages()}</div>`;
}
function cycleStages() {
  const q = CY.q.trim(); const ws = q ? words(q) : [];
  const res = ws.map((w) => new RegExp(`(^|[^a-z0-9])${reEsc(w)}`));
  const hit = (hay) => res.every((re) => re.test(hay));
  let shown = 0; let edges = 0;
  const html = CYCLE.map((c, i) => {
    const all = ws.length && hit(plain(c.t + ' ' + phaseName(c.phase)).toLowerCase());
    const es = !ws.length || all ? c.edges : c.edges.filter((e) => hit(edgeHay(e)));
    if (ws.length && !es.length) return '';
    shown++; edges += es.length;
    const who = [...new Set(c.path.map(([k]) => k))];
    return `<section class="cy-st" id="cy-${i + 1}">
      <header class="cy-h"><span class="cy-n">${i + 1}</span><div class="cy-hd"><p class="eyebrow">${esc(phaseName(c.phase))}</p><h2>${esc(c.t)}</h2>
        <p class="cy-meta"><span class="cy-who">${who.map((k) => rb(k,'sm')).join('')}</span><span>Ends: ${fmt(c.ends)}</span></p></div>
        <div class="cy-see"><small>Play it</small>${c.see.map((id) => `<button class="lnk" type="button" data-go="${id}">${esc(seeName(id))} →</button>`).join('')}</div></header>
      <div class="cy-cols">
        <div><h3>The normal path</h3><ol class="cy-path${P.me ? ' mine' : ''}">${c.path.map(([k, t]) => `<li class="${k === P.me ? 'me' : ''}">${rb(k,'sm')}<span><b>${esc(R[k].short)}</b> ${fmt(t)}</span></li>`).join('')}</ol></div>
        <div><h3>If it goes differently <span class="cy-c">${es.length}${es.length < c.edges.length ? ` of ${c.edges.length}` : ''}</span></h3>
          <ul class="cy-edges">${es.map((e) => `<li><b>${fmt(e.if)}</b><p>${fmt(e.then)}</p>${e.refuse ? `<p class="quote">“${esc(e.refuse)}”</p>` : ''}</li>`).join('')}</ul></div>
      </div></section>`;
  }).join('');
  if (!ws.length) return html;
  return `<p class="fd-sum">${edges} exception${edges === 1 ? '' : 's'} in ${shown} stage${shown === 1 ? '' : 's'} matching “${esc(q)}”</p>` + (shown ? html : `<p class="empty">No exception matches. Try one word.</p>`);
}

/* ───────────────────────── view: quiz ───────────────────────── */
// Roles that could also fairly answer a step's question, kept out of its options.
// 'skip' leaves the step out (both companies do it the same way).
const QX = { 'q15:0':['B','M','F'], 'q15:2':['F'], '1:0':['A'], '1:1':['A','S','B'], '1:2':['A'], '1:3':['A'], '2:1':'skip', '2:2':'skip', '4:0':['S','B'], '6:3':['C'], '7:0':['S','M'], '7:3':['S'], '7:5':['F'], '7:6':['S'], '10:5':['S'], '10:6':['B'] };
const POOL = (() => {
  const pool = [];
  MISSIONS.forEach((m) => m.steps.forEach((s, i) => {
    const qx = QX[`${m.n}:${i}`];
    if (s.who === 'X' || s.noquiz || qx === 'skip') return;
    pool.push({ q:`Whose move: “${s.t}”?`, press:s.press || null, ctx:`Mission ${m.n} · ${m.short}`, ans:s.who, not:[s.who, ...(s.alt || []), ...(qx || []), ...(s.who === 'H' ? ['G'] : [])], why:(s.rules && s.rules[0]) || s.block || '' });
  }));
  QUESTS.forEach((m) => m.steps.forEach((s, i) => {
    const qx = QX[`${m.id}:${i}`];
    if (s.who === 'X' || s.noquiz || qx === 'skip') return;
    pool.push({ q:`Whose move: “${s.t}”?`, press:s.press || null, ctx:`Side quest ${m.n} · ${m.short}`, ans:s.who, not:[s.who, ...(s.alt || []), ...(qx || []), ...(s.who === 'H' ? ['G'] : [])], why:(s.rules && s.rules[0]) || s.block || '' });
  }));
  MX.forEach((r) => {
    const ys = ROLE_ORDER.filter((k) => r.cell[k] === 'Y'); const yy = ROLE_ORDER.filter((k) => r.cell[k] === 'y');
    const a = r.a.replace(/`/g, '');
    if (ys.length === 1 && !yy.length) pool.push({ q:`Who can ${a.charAt(0).toLowerCase()}${a.slice(1)}?`, press:null, ctx:`Powers · ${r.mod}`, ans:ys[0], not:[ys[0]], why:r.note || '' });
  });
  return pool;
})();
let QZ = null;
function newRound() {
  const qs = shuffle(POOL).slice(0, 10).map((p) => {
    const others = shuffle(ROLE_ORDER.filter((k) => k !== 'G' && !p.not.includes(k))).slice(0, 3);
    return Object.assign({}, p, { opts:shuffle([p.ans, ...others]) });
  });
  QZ = { qs, i:0, score:0, picked:null, res:[] };
}
function viewQuiz() {
  if (!QZ) return `<section><p class="eyebrow">Quiz</p><h1>Who does it?</h1><p class="lede">Ten questions drawn from the missions, the side quests and the powers matrix. Pick the role that does each action. Your best score adds to your XP.</p></section>
    <div class="quiz qend"><div class="big">${P.best || 0}<span style="font-size:24px;color:var(--muted)"> / 10</span></div><p>Your best so far</p><button class="btn primary" type="button" data-quiz="start">${ICON.play} Start a round</button></div>`;
  const q = QZ.qs[QZ.i];
  if (!q) {
    const s = QZ.score;
    const msg = s === 10 ? 'Perfect. You know the desk.' : s >= 8 ? 'Strong. A couple to revisit.' : s >= 5 ? 'Getting there. Play the missions you missed.' : 'Worth a walk through the missions first.';
    return `<section><p class="eyebrow">Quiz</p><h1>Round complete</h1></section><div class="quiz qend"><div class="big">${s}<span style="font-size:24px;color:var(--muted)"> / 10</span></div><p>${msg}${s >= (P.best || 0) ? ' New best.' : ` Your best is ${P.best}.`}</p><button class="btn primary" type="button" data-quiz="start">Play again</button></div>`;
  }
  const answered = QZ.picked !== null;
  return `<section><p class="eyebrow">Quiz</p><h1>Who does it?</h1></section>
    <div class="quiz">
      <div class="qprog">${QZ.qs.map((x, k) => `<span class="${k < QZ.i ? (QZ.res[k] ? 'ok' : 'no') : k === QZ.i ? 'on' : ''}"></span>`).join('')}</div>
      <div class="qtop"><span>Question ${QZ.i + 1} of ${QZ.qs.length}</span><span>Score ${QZ.score}</span></div>
      <p class="qq">${esc(q.q)}</p>
      ${q.press ? `<p class="qhint">Presses ${q.press.map((p) => `<span class="ui">${esc(p)}</span>`).join('<span class="sep">›</span>')}</p>` : ''}
      <div class="qopts">${q.opts.map((k) => `<button class="qo${answered && k === q.ans ? ' right' : ''}${answered && k === QZ.picked && k !== q.ans ? ' wrong' : ''}" type="button" data-pick="${k}" style="--c:var(--c-${R[k].c})"${answered ? ' disabled' : ''}>${rb(k,'md')}${esc(R[k].name)}</button>`).join('')}</div>
      ${answered ? `<div class="qfb ${QZ.picked === q.ans ? 'ok' : 'no'}"><b>${QZ.picked === q.ans ? 'Right.' : `It’s the ${esc(R[q.ans].name)}.`}</b><span>${esc(q.ctx)}</span>${q.why ? `<span>${fmt(q.why)}</span>` : ''}<div><button class="btn primary" type="button" data-quiz="next">${QZ.i === QZ.qs.length - 1 ? 'See the score' : 'Next question →'}</button></div></div>` : ''}
    </div>`;
}

/* ───────────────────────── events ───────────────────────── */
document.addEventListener('click', (e) => {
  const t = e.target;
  const goEl = t.closest('[data-go]');
  if (goEl) { e.preventDefault(); go(goEl.dataset.go); return; }
  const findEl = t.closest('[data-find]');
  if (findEl) { const [id, k] = findEl.dataset.find.split(':'); go(id); openDrawer(id, Number(k)); return; }
  const pwq = t.closest('[data-pwq]');
  if (pwq) { PW.q = pwq.dataset.pwq; PW.mod = 'All'; go('powers'); return; }
  const meEl = t.closest('[data-me]');
  if (meEl) { P.me = meEl.dataset.me; save(); if (current === 'find') paintFind(); else go(current, false); return; }
  const cyEl = t.closest('[data-cy]');
  if (cyEl) { const el = $('#cy-' + cyEl.dataset.cy); if (el) el.scrollIntoView({ block:'start' }); return; }
  if (t.closest('[data-print]')) { closeDrawer(true); exitPlay(); window.print(); return; }
  const stepEl = t.closest('[data-step]');
  if (stepEl) { const [id, k] = stepEl.dataset.step.split(':'); const i = Number(k); if (play && play.id === id) { play.i = i; showStep(); } openDrawer(id, i); return; }
  const openEl = t.closest('[data-open]');
  if (openEl) { if (openEl.disabled) return; const [id, k] = openEl.dataset.open.split(':'); openDrawer(id, Number(k)); return; }
  if (t.closest('[data-close]') || t === scrim) { closeDrawer(); return; }
  const playEl = t.closest('[data-play]');
  if (playEl) { const id = playEl.dataset.play; if (current !== id) go(id); startPlay(id); return; }
  const doneEl = t.closest('[data-done]');
  if (doneEl) { const m = BOOK[doneEl.dataset.done]; const k = doneKey(m); P.done[k] = !P.done[k]; save(); go(m.id, false); return; }
  const hb = t.closest('[data-hud]');
  if (hb) { const a = hb.dataset.hud; if (a === 'next') stepPlay(1); else if (a === 'prev') stepPlay(-1); else if (a === 'exit') exitPlay(); else if (a === 'info' && play) openDrawer(play.id, play.i); return; }
  const swb = t.closest('[data-sw]');
  if (swb) {
    const a = swb.dataset.sw;
    if (a === 'go' && swNext) { swNext(); return; }
    if (a === 'done' && play) { const m = BOOK[play.id]; P.done[doneKey(m)] = true; save(); const nx = m.list[m.n]; go(nx ? nx.id : (m.kind === 'Quest' ? 'quests' : 'map')); return; }
    if (a === 'next' && play) { const nx = BOOK[play.id].list[BOOK[play.id].n]; if (nx) go(nx.id); return; }
    if (a === 'stay') { exitPlay(); return; }
    return;
  }
  if (t === sw && swNext) { swNext(); return; }
  const pl = t.closest('[data-player]');
  if (pl) { const k = pl.dataset.player; go('players'); const card = $('#p-' + k); if (card) { card.scrollIntoView({ block:'start' }); card.classList.add('flash'); setTimeout(() => card.classList.remove('flash'), 1600); } return; }
  const md = t.closest('[data-mod]');
  if (md) { PW.mod = md.dataset.mod; $$('[data-mod]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mod === PW.mod))); paintPowers(); return; }
  const hl = t.closest('[data-hl]');
  if (hl) { PW.hl = PW.hl === hl.dataset.hl ? '' : hl.dataset.hl; paintPowers(); return; }
  const lc = t.closest('[data-lc]');
  if (lc) { LC = lc.dataset.lc; app.innerHTML = viewLife(); return; }
  const rf = t.closest('[data-rf]');
  if (rf) { RF = rf.dataset.rf; app.innerHTML = viewRelay(); return; }
  if (t.closest('[data-reset]')) { Object.assign(MV, DEMO); app.innerHTML = viewMoney(); paintMoney(); return; }
  const qz = t.closest('[data-quiz]');
  if (qz) {
    if (qz.dataset.quiz === 'start') newRound();
    else if (qz.dataset.quiz === 'next') { QZ.i++; QZ.picked = null; if (QZ.i >= QZ.qs.length && QZ.score > (P.best || 0)) { P.best = QZ.score; save(); paintXP(); } }
    app.innerHTML = viewQuiz(); return;
  }
  const pick = t.closest('[data-pick]');
  if (pick && QZ && QZ.picked === null) { const q = QZ.qs[QZ.i]; QZ.picked = pick.dataset.pick; const ok = QZ.picked === q.ans; QZ.res[QZ.i] = ok; if (ok) QZ.score++; app.innerHTML = viewQuiz(); return; }
  if (t.closest('#theme')) {
    const dark = document.documentElement.dataset.theme ? document.documentElement.dataset.theme === 'dark' : (window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
    P.theme = dark ? 'light' : 'dark'; document.documentElement.dataset.theme = P.theme; save(); paintTheme();
  }
});
document.addEventListener('input', (e) => {
  const t = e.target;
  if (t.id === 'pw-q') { PW.q = t.value; paintPowers(); return; }
  if (t.id === 'fd-q') { FD.q = t.value; paintFind(); return; }
  if (t.id === 'cy-q') { CY.q = t.value; $('#cy-out').innerHTML = cycleStages(); return; }
  if (t.id && t.id.startsWith('mv-')) {
    const k = t.id.slice(3);
    if (k === 'tds') MV.tds = t.checked; else MV[k] = Number(t.value);
    paintMoney();
  }
});
document.addEventListener('change', (e) => { if (e.target.id === 'mv-tds') { MV.tds = e.target.checked; paintMoney(); } });
document.addEventListener('keydown', (e) => {
  if (e.target.matches && e.target.matches('input, textarea, select')) return;
  if (!sw.hidden) { if (swNext && (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowRight' || e.key === 'Escape')) { e.preventDefault(); swNext(); } else if (e.key === 'Escape') exitPlay(); return; }
  if (e.key === 'Escape') { if (drawer.classList.contains('open')) closeDrawer(); else if (play) exitPlay(); return; }
  if (e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); if (current !== 'find') go('find'); const f = $('#fd-q'); if (f) f.focus(); return; }
  if (play && !drawer.classList.contains('open')) {
    if (e.key === 'ArrowRight') { e.preventDefault(); stepPlay(1); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); stepPlay(-1); }
  }
});
window.addEventListener('popstate', () => go(location.hash.slice(1) || 'map', false));

if (P.theme === 'light' || P.theme === 'dark') document.documentElement.dataset.theme = P.theme;
paintTheme();
try { matchMedia('(prefers-color-scheme: dark)').addEventListener('change', paintTheme); } catch (e) { /* older browsers: the icon catches up on the next toggle */ }
go(location.hash.slice(1) || 'map', false);
})();
