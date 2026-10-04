/**
 * "How it works" pages for the seller and buyer portals — one per section.
 *
 * Written for someone opening the portal for the first time: what the page is
 * for, what to do on it step by step, what the colours mean, and who does what.
 * Each describes what the portal actually does, in the words of the side reading
 * it, so a seller's guide speaks of PPAs and invoices it raises and a buyer's of
 * PSAs and bills it pays.
 *
 * Each entry is a function of the side ('SELLER' | 'BUYER') returning a guide in
 * the shape ModuleGuide renders.
 */

const words = (side) => (side === 'BUYER'
  ? { seller: false, contract: 'PSA', contracts: 'PSAs', you: 'your DISCOM', security: 'letter of credit (LC)', securityShort: 'LC' }
  : { seller: true, contract: 'PPA', contracts: 'PPAs', you: 'your company', security: 'bank guarantee', securityShort: 'BG' });

const LEVELS = {
  columns: ['Level', 'What they do'],
  rows: [
    ['Maker (Level 1)', 'Prepares the work — a draft, an upload — and sends it to a checker. Cannot send it to SJVN alone.'],
    ['Checker (Level 2)', 'Reviews what the maker prepared and sends it to SJVN.'],
    ['Approver (Level 3)', 'Does what a checker does, and can also manage makers and checkers.'],
    ['Company Admin', 'The account SJVN registered for your company. Can do everything, and manages the whole team.'],
  ],
};

const dashboard = (side) => {
  const w = words(side);
  return {
    eyebrow: 'How this page works',
    title: 'My Dashboard',
    summary: `This is the first page you see. It answers three questions in one look: what is waiting on you, where your money stands with SJVN, and what is coming up in the next two months.`,
    facts: [
      { label: 'Waiting on you', value: 'Most urgent first', hint: 'Red, then amber, then blue' },
      { label: 'Coming up', value: 'Next 60 days', hint: 'Payments, expiries, milestones' },
      { label: 'Charts', value: 'Last 12 months', hint: 'Always a full year' },
      { label: 'Summary', value: 'PDF download', hint: 'To share with your management' },
    ],
    quickRef: { title: 'Quick reference', items: [
      { k: 'Red', v: 'Overdue, rejected, or about to lapse' },
      { k: 'Amber', v: 'Needs you soon' },
      { k: 'Blue', v: 'For your information' },
      { k: 'Outstanding', v: 'What is still left to be paid' },
      { k: 'Overdue', v: 'Outstanding and past the due date' },
    ] },
    sections: [
      { id: 'd-what', heading: 'What you see here', blocks: [
        { type: 'p', text: `The cards at the top are your money: how much was billed, how much was ${w.seller ? 'received' : 'paid'}, what is still outstanding and how much of that is late. Below them is the list of things waiting on you, then the charts, your ${w.contracts} and your latest bills.` },
        { type: 'p', text: 'Every card, every line in the list and every date in the calendar can be clicked. It takes you straight to the page where you can act on it.' },
      ] },
      { id: 'd-todo', heading: 'The "Waiting on you" list', blurb: 'Start your day here.', blocks: [
        { type: 'p', text: 'The portal checks every section and brings here only what needs you. If the list is empty, nothing is pending from your side.' },
        { type: 'table', columns: ['You may see', 'What it means'], rows: [
          w.seller ? ['Invoices in draft / waiting for approval', 'A maker has prepared an invoice. A checker has to approve it before it goes to SJVN.'] : ['Bills due within 10 days', 'Pay before the due date to avoid late payment surcharge.'],
          [w.seller ? 'Bills past the due date' : 'Bills overdue', w.seller ? 'SJVN has not paid by the due date. Surcharge is building up in your favour.' : 'The due date has passed. Surcharge is building up on the unpaid amount.'],
          ['Energy data to confirm', 'SJVN has checked the figures for a month. Accept them, or object, before the bill is made.'],
          ['Dispute resolution awaiting your answer', 'SJVN has given its decision on your dispute. Accept it or escalate.'],
          ['Reconciliation statement to sign', 'Match the statement with your books and sign.'],
          ['Documents asked for / rejected', 'SJVN needs a document, or sent one back with a reason.'],
          [`${w.seller ? 'Guarantee' : 'LC'} needs an extension`, 'It is close to expiry. Get it extended by your bank and submit the extension.'],
          ...(w.seller ? [] : [['Payment intimations waiting for approval', 'A maker has reported a payment. A checker has to pass it on to SJVN.']]),
        ] },
      ] },
      { id: 'd-money', heading: 'Reading the money cards', blocks: [
        { type: 'terms', items: [
          { term: 'Billed', def: `Total of the bills ${w.seller ? 'you raised on SJVN' : 'SJVN raised on you'} in the chosen period. The small line under it compares with the same months last year.` },
          { term: w.seller ? 'Received' : 'Paid', def: `Money that has actually ${w.seller ? 'come to you' : 'been confirmed by SJVN Finance'} in the period. TDS is shown separately.` },
          { term: 'Outstanding now', def: 'What is left on all open bills today, after payments, deductions, surcharge and disputed amounts.' },
          { term: 'Overdue', def: 'The part of the outstanding that is past its due date.' },
          { term: w.seller ? 'SJVN pays in' : 'You pay in', def: 'On average, how many days a bill took to be settled in full.' },
        ] },
        { type: 'note', tone: 'info', title: 'The period buttons', text: 'The buttons at the top right — this financial year, last 12 months, since the start — change only the money cards. The charts always show the last twelve months.' },
      ] },
      { id: 'd-faq', heading: 'Common questions', blocks: [
        { type: 'faq', items: [
          { q: 'Why is a bill in "Outstanding" but not in "Overdue"?', a: 'Because its due date has not passed yet, or SJVN has not accepted the bill yet. A bill becomes overdue only after it is accepted and its due date is over.' },
          { q: 'The numbers look different from my books. What do I do?', a: 'Open Payments & Ledger and download the statement of account. It lists every bill, payment and deduction with a running balance. If something is still wrong, raise it in Reconciliation or as a dispute.' },
          { q: 'Can I send this page to my manager?', a: 'Yes. Use "Download summary (PDF)" at the top right. It contains the same figures, the pending items and the upcoming dates.' },
        ] },
      ] },
    ],
  };
};

const mail = () => ({
  eyebrow: 'How this page works',
  title: 'Mail',
  summary: 'A mailbox inside the portal for writing to SJVN and to your own colleagues. Messages stay on the portal, so the whole conversation is on record and nothing is lost in personal email.',
  facts: [
    { label: 'You can write to', value: 'SJVN and your own team', hint: 'Not to other companies' },
    { label: 'Attachments', value: 'Up to 5 files a message', hint: 'A damaged PDF is refused' },
    { label: 'Drafts', value: 'Saved automatically', hint: 'While you type' },
    { label: 'Trash', value: 'Kept 30 days', hint: 'Then removed for good' },
  ],
  sections: [
    { id: 'm-what', heading: 'What it is for', blocks: [
      { type: 'p', text: 'Use Mail for anything you would otherwise send by email or letter to SJVN: a question on a bill, a covering note with a document, a follow-up on a request. SJVN replies here too.' },
      { type: 'note', tone: 'info', text: 'Formal contract notices — force majeure, default, termination — are sent from the Notices tab of the contract, not from Mail. A notice is a contract document; a mail is correspondence.' },
    ] },
    { id: 'm-how', heading: 'Sending a message', blocks: [
      { type: 'steps', items: [
        { title: 'Click Compose', detail: 'Start typing a name in To, Cc or Bcc. The list shows only the people you are allowed to write to.' },
        { title: 'Write the message', detail: 'You can use bold, lists and tables. Your signature is added if you have set one.' },
        { title: 'Attach files if needed', detail: 'Up to five files. If you close the window, the message is kept in Drafts with its files.' },
        { title: 'Send', detail: 'It appears in the other person\'s Inbox at once, and in your Sent box.' },
      ] },
    ] },
    { id: 'm-tools', heading: 'Useful things to know', blocks: [
      { type: 'table', columns: ['Feature', 'What it does'], rows: [
        ['Reply / Reply all / Forward', 'Reply all goes to everyone on the message. Forward can carry the original attachments.'],
        ['Unread filter and sorting', 'Show only what you have not read, or sort by date or sender.'],
        ['Star', 'Mark a message you want to find again quickly.'],
        ['Select many', 'Tick several messages to mark read, star or delete together.'],
        ['Read receipt', 'On a message you sent, you can see who has opened it and when.'],
        ['Print / PDF', 'Print a message or save it as a PDF for your file.'],
        ['Trash', 'Deleted messages can be restored for 30 days.'],
      ] },
    ] },
    { id: 'm-faq', heading: 'Common questions', blocks: [
      { type: 'faq', items: [
        { q: 'I cannot find another company in the To list.', a: 'That is by design. You can write to SJVN and to the users of your own company only.' },
        { q: 'My attachment was refused.', a: 'A PDF that is empty or damaged is not accepted, because the reader could not open it. Export or scan the document again and attach the new file.' },
        { q: 'Does the other person get an email?', a: 'They see it in their portal Inbox and on the bell icon. Whether an email alert is also sent depends on their notification settings.' },
      ] },
    ] },
  ],
});

const notifications = () => ({
  eyebrow: 'How this page works',
  title: 'Notification Board',
  summary: 'One place for everything that needs attention across your account — overdue bills, expiring guarantees, pending approvals — and for announcements from SJVN.',
  facts: [
    { label: 'Alerts', value: 'Worked out live', hint: 'From your own data only' },
    { label: 'Severity', value: 'Critical · Warning · Info', hint: 'Critical first' },
    { label: 'Acknowledge', value: 'Hides it for you', hint: 'Until something new happens' },
    { label: 'History', value: 'Kept and searchable', hint: 'With dates' },
  ],
  sections: [
    { id: 'n-what', heading: 'What you see here', blocks: [
      { type: 'p', text: 'There are two kinds of items. Alerts are raised by the portal itself when it finds something in your data — for example a bill past its due date. Broadcasts are messages SJVN posts for all sellers or all buyers, such as a holiday notice or a change in procedure.' },
      { type: 'p', text: 'Click an alert to go to the page where you can deal with it. The alert disappears on its own once the matter is settled.' },
    ] },
    { id: 'n-ack', heading: 'Acknowledge and dismiss', blocks: [
      { type: 'steps', items: [
        { title: 'Read the alert', detail: 'The card shows what it is about and how many items are affected.' },
        { title: 'Acknowledge it', detail: 'This tells the portal you have seen it. It moves out of your active list.' },
        { title: 'It returns if things change', detail: 'If the count goes up, or the same problem happens again later, the alert comes back so you do not miss it.' },
      ] },
      { type: 'note', tone: 'warn', title: 'Acknowledging is not solving', text: 'Acknowledging only hides the alert for you. The bill is still overdue and the guarantee still expires. Each user acknowledges for themselves.' },
    ] },
    { id: 'n-tools', heading: 'Search, filters and history', blocks: [
      { type: 'table', columns: ['Tool', 'Use it to'], rows: [
        ['Search box', 'Find an alert by a word in its title or detail.'],
        ['Category filters', 'See only billing, security, contracts and so on.'],
        ['History tab', 'See past alerts — when each started and when it ended.'],
        ['Preferences', 'Choose from which severity you also want an email or SMS.'],
      ] },
      { type: 'note', tone: 'info', text: 'SMS is sent only once SJVN has switched the SMS service on. Until then your SMS choice is saved but no message goes out.' },
    ] },
  ],
});

const team = (side) => {
  const w = words(side);
  return {
    eyebrow: 'How this page works',
    title: 'My Team',
    summary: `The people from ${w.you} who can sign in to this portal, the level each works at, and when they last signed in. The Company Admin or an Approver can add people, change their level, reset a password or switch an account off.`,
    facts: [
      { label: 'Levels', value: 'Maker · Checker · Approver', hint: 'Plus the Company Admin' },
      { label: 'New password', value: 'Shown once', hint: 'Must be changed at first sign-in' },
      { label: 'Switch off', value: 'Works at once', hint: 'They are signed out immediately' },
      { label: 'Seats', value: 'Limit shown on the page', hint: 'Set by SJVN' },
    ],
    sections: [
      { id: 't-levels', heading: 'The four levels', blurb: 'Two people see every submission: one prepares, another checks.', blocks: [
        { type: 'table', ...LEVELS },
        { type: 'p', text: 'The "Who can do what" tab on this page shows the same thing action by action.' },
      ] },
      { id: 't-add', heading: 'Adding a team member', blocks: [
        { type: 'steps', items: [
          { title: 'Click Add Team Member', detail: 'Enter the name, their email (this is what they sign in with), designation, phone and level.' },
          { title: 'Note the temporary password', detail: 'The portal shows it once. Give it to the person by phone or in person, not by email.' },
          { title: 'They sign in and choose their own password', detail: 'The portal does not let them continue until they set a password only they know.' },
        ] },
      ] },
      { id: 't-manage', heading: 'Changing, resetting, switching off', blocks: [
        { type: 'table', columns: ['Action', 'What happens'], rows: [
          ['Edit / change level', 'Changing the level signs the person out. The new level applies from their next sign-in.'],
          ['Reset password', 'A new temporary password is shown once. The old one stops working at once.'],
          ['Unlock', 'After several wrong passwords an account locks for a while. Unlock lets them try again now.'],
          ['Switch off', 'A reason is required. The person is signed out immediately. Their past work stays on record.'],
          ['Switch on', 'Brings a switched-off account back.'],
          ['Activity', 'Shows what the person has done on the portal recently.'],
        ] },
        { type: 'note', tone: 'warn', title: 'The Company Admin account', text: 'This is the account SJVN registered for your company. Nobody inside the company can switch it off or reset its password. If the admin is locked out or has left, write to SJVN — their administrator can reset it.' },
      ] },
      { id: 't-faq', heading: 'Common questions', blocks: [
        { type: 'faq', items: [
          { q: 'Why is there a warning at the top of the page?', a: 'The portal checks whether maker-checker can actually work. For example, if there is a maker but no checker, the maker\'s work can only be approved by the Company Admin.' },
          { q: 'Can I delete a user?', a: 'No. You switch the account off. This keeps the record of what that person did, which auditors expect.' },
          { q: 'I am a maker. What can I change here?', a: 'Your own name, phone and designation. You can see the team but cannot change anyone else.' },
        ] },
      ] },
    ],
  };
};

const documents = (side) => {
  const w = words(side);
  return {
    eyebrow: 'How this page works',
    title: 'My Documents & KYC',
    summary: `Where you give SJVN the documents that prove who ${w.you} is — registration, PAN, GST, bank details, licences — and keep your other records. SJVN checks each KYC document and marks it verified or sends it back with a reason.`,
    facts: [
      { label: 'KYC', value: 'Must be approved', hint: 'To open the other sections' },
      { label: 'Each upload', value: 'A new version', hint: 'Old versions are kept' },
      { label: 'Rejected', value: 'Reason is shown', hint: 'Upload a corrected copy' },
      { label: 'Expiry', value: 'Tracked by the portal', hint: 'You are reminded' },
    ],
    quickRef: { title: 'Statuses', items: [
      { k: 'Pending', v: 'Uploaded, SJVN has not checked yet' },
      { k: 'Verified', v: 'SJVN has accepted it' },
      { k: 'Rejected', v: 'Sent back — see the reason' },
      { k: 'Expired', v: 'Its validity date has passed' },
    ] },
    sections: [
      { id: 'k-why', heading: 'Why this page matters', blocks: [
        { type: 'p', text: `Until SJVN approves your KYC, the sections for ${w.contracts}, energy, bills, payments, disputes, security and reconciliation stay closed. The banner at the top of the portal tells you what is still missing.` },
      ] },
      { id: 'k-how', heading: 'Uploading a document', blocks: [
        { type: 'steps', items: [
          { title: 'Click Upload Document', detail: 'Pick the document type that matches — for example "PAN Card" or "GST Certificate". Add the expiry date if the document has one.' },
          { title: 'A maker\'s upload goes to the checker', detail: 'If a Level 1 user uploads a KYC document, a checker or the admin has to submit it to SJVN.' },
          { title: 'SJVN verifies', detail: 'The document shows Pending until SJVN checks it. Then it turns Verified, or Rejected with a reason.' },
          { title: 'If rejected, upload again', detail: 'Correct the problem and upload a new copy. It becomes the next version of the same document.' },
        ] },
        { type: 'note', tone: 'info', title: 'The portal reads your PAN and GSTIN', text: 'When you upload a PAN card or GST certificate as a text PDF, the portal reads the number from it and compares it with your company record. A mismatch is shown to you and to SJVN.' },
      ] },
      { id: 'k-rules', heading: 'What is not accepted', blocks: [
        { type: 'table', columns: ['The portal refuses', 'Why'], rows: [
          ['The same file that was just rejected', 'It is still the file that was turned down. Upload a corrected one.'],
          ['An empty or damaged PDF', 'Nobody could open it. Export or scan it again.'],
          ['A file already used by another company', 'It is flagged to SJVN, because one document should not belong to two companies.'],
        ] },
      ] },
      { id: 'k-req', heading: 'When SJVN asks for a document', blocks: [
        { type: 'p', text: 'SJVN can request a specific document with a due date. The request appears on this page and on your dashboard. Upload the document against the request and it closes on its own.' },
        { type: 'p', text: 'You can also download all your documents together as one ZIP file.' },
      ] },
      { id: 'k-faq', heading: 'Common questions', blocks: [
        { type: 'faq', items: [
          { q: 'Can SJVN upload my KYC document for me?', a: 'No. KYC documents must come from your company, so that the same person never uploads and verifies a document.' },
          { q: 'My document is about to expire.', a: 'Upload the renewed one as a new version before the expiry date. The portal reminds you ahead of time.' },
          { q: 'What do the watermarks in the preview mean?', a: 'Every preview is stamped with the viewer\'s name and date. It discourages screenshots being passed around.' },
        ] },
      ] },
    ],
  };
};

const contracts = (side) => {
  const w = words(side);
  return {
    eyebrow: 'How this page works',
    title: `My Contracts (${w.contracts})`,
    summary: `Your ${w.contracts} with SJVN. Each contract opens a "working file" — its documents, milestones, ${w.seller ? 'the performance guarantee, ' : ''}your requests to SJVN and the formal notices between you.`,
    facts: [
      { label: 'Terms', value: 'Read-only', hint: 'Changed only by an amendment' },
      { label: 'Milestones', value: 'You report, SJVN confirms', hint: 'With proof' },
      { label: 'Requests', value: 'SJVN approves or refuses', hint: 'With its reason' },
      { label: 'Notices', value: 'Cannot be edited once sent', hint: 'The other side acknowledges' },
    ],
    sections: [
      { id: 'c-list', heading: 'The list', blocks: [
        { type: 'p', text: 'Each row is one contract. The "Next milestone" column shows what is due next. The "Needs attention" column shows small red or amber tags when something on that contract is waiting on you. Click a row to open its working file.' },
      ] },
      { id: 'c-tabs', heading: 'Inside the working file', blocks: [
        { type: 'table', columns: ['Tab', 'What is in it'], rows: [
          ['Overview', 'The main terms — capacity, tariff, tenure, payment terms — and the billing position on this contract.'],
          ['Documents', 'The signed contract, amendments and other papers. Upload yours here.'],
          ['Milestones', 'Financial closure, SCOD, COD and so on, with due dates.'],
          ...(w.seller ? [['Guarantee (PBG)', 'Your performance guarantee: amount, expiry, and how to submit a renewal.']] : []),
          ['Requests', 'What you have asked SJVN for, and its decision.'],
          ['Notices', 'Formal notices sent by you or by SJVN.'],
          ['History', 'Everything that has happened on the contract, in order.'],
        ] },
      ] },
      { id: 'c-ms', heading: 'Reporting a milestone', blocks: [
        { type: 'steps', items: [
          { title: 'Open the Milestones tab', detail: 'A milestone close to its due date is amber; one past its due date is red.' },
          { title: 'Report it achieved', detail: 'Give the date and a short note, and attach the proof.' },
          { title: 'SJVN confirms', detail: 'Until SJVN confirms, the milestone shows as "reported". After confirmation it is closed.' },
        ] },
        { type: 'note', tone: 'warn', title: 'Need more time?', text: 'Do not wait for the date to pass. Raise a request for an extension from the Requests tab, with the reason and supporting papers.' },
      ] },
      { id: 'c-req', heading: 'Requests and notices', blocks: [
        { type: 'table', columns: ['Use', 'When'], rows: [
          ['Request — milestone extension', 'You need a later date for a milestone. SJVN may approve a different date from the one you asked for.'],
          ['Request — amendment', 'You want a term of the contract changed.'],
          ...(w.seller ? [['Request — renewed guarantee', 'Your bank has renewed the PBG and you want SJVN to take it on record.']] : []),
          ['Notice', 'A formal communication under the contract: force majeure, default, cure, termination.'],
        ] },
        { type: 'p', text: 'A request can be withdrawn while SJVN has not decided. A notice cannot be edited or withdrawn once sent; the other side acknowledges it and can reply.' },
      ] },
      { id: 'c-faq', heading: 'Common questions', blocks: [
        { type: 'faq', items: [
          { q: 'Can I change the tariff or capacity here?', a: 'No. The contract terms are shown for reference. They change only when SJVN records an amendment, which you can ask for through a request.' },
          { q: 'SJVN sent me a notice. What do I do?', a: 'Open the Notices tab, read it and click Acknowledge. If a reply date is given, reply before that date.' },
        ] },
      ] },
    ],
  };
};

const energy = (side) => {
  const w = words(side);
  return {
    eyebrow: 'How this page works',
    title: w.seller ? 'Energy Data' : 'Energy Allocation',
    summary: `The energy ${w.seller ? 'your project generated' : 'allocated to you'} each month, as recorded by SJVN from the regional energy account and meter readings. You check each month's figure and accept it — or object — before the bill is made on it.`,
    facts: [
      { label: 'Recorded by', value: 'SJVN', hint: 'From REA / SEA / JMR' },
      { label: 'Your part', value: 'Accept or object', hint: 'Before billing' },
      { label: 'Provisional', value: 'May be replaced', hint: 'By the final figure' },
      { label: 'Locked', value: 'Already billed', hint: 'Cannot be changed' },
    ],
    quickRef: { title: 'Statuses', items: [
      { k: 'Validated', v: 'SJVN has checked it; waiting for you' },
      { k: 'Accepted', v: 'You agreed with the figure' },
      { k: 'Objected', v: 'You disagreed; SJVN is to answer' },
      { k: 'Locked', v: 'Used in a bill' },
    ] },
    sections: [
      { id: 'e-what', heading: 'What you see here', blocks: [
        { type: 'p', text: `The chart shows energy month by month${w.seller ? ', with the CUF line against the minimum CUF in your contract' : ''}. Darker bars are final figures; lighter bars are provisional. The table below lists every month with its source and status.` },
        { type: 'p', text: 'Click a month to open its detail: the source document SJVN used, the 15-minute block data if it was uploaded, and the buttons to accept or object.' },
      ] },
      { id: 'e-how', heading: 'Confirming a month', blocks: [
        { type: 'steps', items: [
          { title: 'Open the month', detail: 'Look at the figure, and open the source document to compare with your own records.' },
          { title: 'If it matches, Accept', detail: 'Your acceptance is recorded with your name and time.' },
          { title: 'If it does not match, Object', detail: 'Enter the figure you claim, explain the difference and attach your document.' },
          { title: 'SJVN answers the objection', detail: 'It either corrects the record or upholds the figure with its reason. You see the outcome on the same row.' },
        ] },
        { type: 'note', tone: 'warn', title: 'Do it before the bill', text: 'Once a month is used in a bill it is locked. After that, a difference has to be raised as a dispute on the bill — the page gives you a "Raise a dispute" button for this.' },
      ] },
      { id: 'e-terms', heading: 'Words used on this page', blocks: [
        { type: 'terms', items: [
          { term: 'REA / SEA', def: 'Regional / State Energy Account — the official monthly statement of energy issued by the regional or state load despatch body.' },
          { term: 'JMR', def: 'Joint Meter Reading — the reading taken at the meter and signed by both sides.' },
          ...(w.seller ? [{ term: 'CUF', def: 'Capacity Utilisation Factor — how much your plant generated compared with what it could at full capacity. Your contract sets a minimum.' }] : []),
          { term: 'Provisional / Final', def: 'A provisional figure is an early one. When the final figure arrives it replaces the provisional one.' },
          { term: '15-minute blocks', def: 'The same energy broken into 96 time blocks a day. Useful for checking a single day.' },
        ] },
      ] },
      { id: 'e-faq', heading: 'Common questions', blocks: [
        { type: 'faq', items: [
          { q: 'I did not accept or object. Will SJVN still bill?', a: 'SJVN can bill on a validated figure. Your acceptance makes the record clean; your objection, raised in time, stops a wrong figure reaching the bill.' },
          { q: 'Can I download the data?', a: 'Yes. Export the monthly list as CSV, and the block data of a month as Excel.' },
        ] },
      ] },
    ],
  };
};

const invoices = (side) => (side === 'BUYER' ? {
  eyebrow: 'How this page works',
  title: 'Payable Invoices',
  summary: 'The bills SJVN has raised on your PSAs. For each bill you see what is left to pay and when it is due, you can download the bill, and you tell SJVN when you have paid. SJVN Finance then confirms the payment against its bank statement.',
  facts: [
    { label: 'Paid status', value: 'Only after SJVN confirms', hint: 'Not when you enter the UTR' },
    { label: 'TDS', value: 'Entered separately', hint: 'With its section' },
    { label: 'Late payment', value: 'Surcharge applies', hint: 'On the unpaid amount' },
    { label: 'Rebate', value: 'None on PSA bills', hint: 'For early payment' },
  ],
  quickRef: { title: 'Row colours', items: [
    { k: 'Red row', v: 'Past the due date' },
    { k: 'Amber row', v: 'Due within 10 days' },
    { k: 'Blue line', v: 'A payment is awaiting confirmation' },
  ] },
  sections: [
    { id: 'i-what', heading: 'What you see here', blocks: [
      { type: 'p', text: 'The cards at the top show what is to be paid, what falls due within ten days, what is overdue, the surcharge so far, and payments you have reported that SJVN has not confirmed yet. The filters above the table let you see only bills to pay, overdue bills, paid bills and so on.' },
    ] },
    { id: 'i-open', heading: 'When a bill arrives', blocks: [
      { type: 'steps', items: [
        { title: 'Open the bill', detail: 'Click the row. You see the breakdown of charges and can download the PDF.' },
        { title: 'Acknowledge receipt', detail: 'One click. It records that the bill has reached your company, with the date.' },
        { title: 'Check it', detail: 'Compare the energy and the rate with your records. If SJVN has recorded an e-invoice number (IRN) and a signed copy, they are shown here.' },
        { title: 'Pay, or dispute', detail: 'If the bill is right, pay it and tell SJVN (next section). If something is wrong, click "Raise a dispute on this bill".' },
      ] },
    ] },
    { id: 'i-pay', heading: 'Telling SJVN about a payment', blurb: 'This is the most important part of the page.', blocks: [
      { type: 'steps', items: [
        { title: 'Click "Tell SJVN about a payment"', detail: 'Enter the amount that reached SJVN\'s bank account, the date, the mode and the UTR.' },
        { title: 'Enter what you deducted', detail: 'If you deducted TDS, enter the amount and the section. Any other deduction needs a short explanation.' },
        { title: 'Attach the bank advice', detail: 'It helps Finance match the payment quickly.' },
        { title: 'A maker\'s entry goes to the checker', detail: 'A checker or the admin approves it and it goes to SJVN.' },
        { title: 'SJVN Finance confirms', detail: 'Finance finds the money in the bank statement and confirms. Only then does the bill turn Partially Paid or Paid.' },
      ] },
      { type: 'note', tone: 'warn', title: 'Until SJVN confirms, the bill is unpaid', text: 'Entering a UTR does not settle the bill. The surcharge is worked out up to the date the money actually reached SJVN, so report the true payment date.' },
      { type: 'note', tone: 'info', text: 'If Finance cannot find the payment, it returns the entry with its reason. The bill stays as it was; send the correct details again.' },
    ] },
    { id: 'i-faq', heading: 'Common questions', blocks: [
      { type: 'faq', items: [
        { q: 'One bank transfer paid three bills. How do I enter it?', a: 'Enter it on each of the three bills with the same UTR and the amount that belongs to that bill.' },
        { q: 'I paid net of TDS. Why does the bill still show a balance?', a: 'Check that you entered the TDS amount in its own field. Amount paid plus TDS is what the bill is settled by.' },
        { q: 'Can I download many bills at once?', a: 'Yes. Tick the bills and use "Download bills (ZIP)". "Export CSV" gives the list as a sheet.' },
        { q: 'Where is my receipt?', a: 'In Payment Ledger. Every confirmed payment has a receipt you can download.' },
      ] },
    ] },
  ],
} : {
  eyebrow: 'How this page works',
  title: 'My Invoices',
  summary: 'Where you raise your monthly invoice on SJVN and follow it until it is paid. A maker prepares the invoice, a checker sends it to SJVN, SJVN verifies and approves it, and payment follows on the due date.',
  facts: [
    { label: 'Maker → Checker', value: 'Two people', hint: 'Before it reaches SJVN' },
    { label: 'Energy', value: 'From validated data', hint: 'Not typed by hand' },
    { label: 'TDS', value: 'Estimate shown', hint: 'Before you submit' },
    { label: 'Rebate', value: 'If SJVN pays early', hint: 'As per your PPA' },
  ],
  quickRef: { title: 'Statuses', items: [
    { k: 'Draft', v: 'Prepared, not yet sent to SJVN' },
    { k: 'Submitted', v: 'With SJVN for verification' },
    { k: 'Approved', v: 'Accepted; payment will follow' },
    { k: 'Partially paid / Paid', v: 'Money received' },
    { k: 'Rejected', v: 'Sent back with a reason' },
    { k: 'Disputed', v: 'A dispute is open on it' },
  ] },
  sections: [
    { id: 'i-flow', heading: 'From invoice to payment', blocks: [
      { type: 'steps', items: [
        { title: 'Create the invoice', detail: 'Choose the PPA and the month. The energy comes from the validated energy data and the rate from your contract, so the amount is worked out for you.' },
        { title: 'Add what goes with it', detail: 'The e-invoice number (IRN) and QR, the digitally signed copy, and the courier details of the hard copy if you send one.' },
        { title: 'Maker sends to checker', detail: 'A maker\'s invoice is saved as a draft. The checker reviews it and submits it to SJVN.' },
        { title: 'SJVN verifies and approves', detail: 'SJVN checks the energy, rate and documents. If something is wrong it rejects the invoice with a reason.' },
        { title: 'Payment', detail: 'SJVN pays on or before the due date. The payment, with any TDS, appears in Payments & Ledger.' },
      ] },
    ] },
    { id: 'i-extras', heading: 'What goes with an invoice', blocks: [
      { type: 'table', columns: ['Item', 'What it is'], rows: [
        ['TDS estimate', 'What SJVN is likely to deduct at source on this bill, so the payment you receive is not a surprise. It is an estimate.'],
        ['E-invoice (IRN & QR)', 'The number and QR code from the GST e-invoice portal. The portal compares it with the bill and shows any mismatch.'],
        ['Digitally signed copy', 'Download the PDF, sign it with your DSC or Aadhaar e-Sign, and attach the signed file.'],
        ['Hard copy by courier', 'Enter the courier and docket number. SJVN records the date it receives the paper.'],
      ] },
      { type: 'note', tone: 'info', text: 'SJVN can make the IRN or the signed copy compulsory. If it has, the page says so and SJVN will not approve the invoice without it.' },
    ] },
    { id: 'i-bulk', heading: 'Doing several at once', blocks: [
      { type: 'p', text: 'Tick several drafts to send them to the checker together, or — as a checker — to approve and submit them together. Each one is still checked separately, and the page tells you which went through and which did not.' },
    ] },
    { id: 'i-faq', heading: 'Common questions', blocks: [
      { type: 'faq', items: [
        { q: 'The energy for the month is not available.', a: 'SJVN has not validated that month yet. Check Energy Data; once the month is validated you can raise the invoice.' },
        { q: 'SJVN rejected my invoice.', a: 'Open it to read the reason, correct it and submit again.' },
        { q: 'When does the rebate apply?', a: 'When SJVN pays within the early-payment window in your PPA. The rebate is shown on the payment advice.' },
        { q: 'I do not agree with a deduction.', a: 'Raise a dispute on that invoice from My Disputes.' },
      ] },
    ] },
  ],
});

const payments = (side) => {
  const w = words(side);
  return {
    eyebrow: 'How this page works',
    title: w.seller ? 'Payments & Ledger' : 'Payment Ledger',
    summary: `Your account with SJVN, like a bank passbook: every bill, every payment, every deduction, with a running balance. From here you download the statement of account, see how old the outstanding is, and get ${w.seller ? 'the advice for each payment' : 'a receipt for each payment'}.`,
    facts: [
      { label: 'Statement', value: 'PDF or Excel', hint: 'For any dates you choose' },
      { label: 'Ageing', value: '0–30, 31–60, 61–90, 90+', hint: 'Days past due' },
      { label: w.seller ? 'Payment advice' : 'Receipt', value: 'For each payment', hint: 'With the TDS break-up' },
      { label: 'Form 16A', value: w.seller ? 'Filed by SJVN' : 'Filed by you', hint: 'Every quarter' },
    ],
    sections: [
      { id: 'p-tabs', heading: 'The four tabs', blocks: [
        { type: 'table', columns: ['Tab', 'What it shows'], rows: [
          ['Outstanding & ageing', 'Each open bill with what is left on it, how many days it is overdue and the surcharge so far.'],
          ['Ledger', 'Every entry in date order with a running balance. Choose dates to see an opening and closing balance.'],
          ['Payments', `Each payment: how much of the bill it settled, the TDS, other deductions and the net amount ${w.seller ? 'you received' : 'SJVN received'}.`],
          ['TDS certificates', w.seller ? 'The Form 16A SJVN files for each quarter in which it deducted tax from your payments.' : 'The Form 16A you file for each quarter in which you deducted tax from your payments to SJVN.'],
        ] },
      ] },
      { id: 'p-read', heading: 'Reading the ledger', blocks: [
        { type: 'terms', items: [
          { term: 'Debit', def: w.seller ? 'An amount you billed to SJVN. It increases what SJVN owes you.' : 'An amount SJVN billed to you. It increases what you owe.' },
          { term: 'Credit', def: 'A payment, a tax deduction, a credit note' + (w.seller ? ' or a rebate' : '') + '. It reduces the balance.' },
          { term: 'Opening / closing balance', def: 'The balance before the first date you chose, and after the last.' },
          { term: 'LPS', def: 'Late Payment Surcharge — interest on an amount paid after the due date.' },
        ] },
      ] },
      { id: 'p-tds', heading: 'TDS certificates (Form 16A)', blocks: [
        ...(w.seller ? [
          { type: 'p', text: 'When SJVN deducts tax from a payment, it must give you a certificate for the quarter. The table shows each quarter in which tax was deducted. Once Finance files the certificate you can view and download it and claim the credit in your tax return.' },
          { type: 'note', tone: 'info', text: 'A quarter marked "Awaited from SJVN Finance" means tax was deducted but the certificate is not filed yet.' },
        ] : [
          { type: 'steps', items: [
            { title: 'See which quarters need a certificate', detail: 'The table lists every quarter in which you reported a TDS deduction.' },
            { title: 'Click "File a certificate"', detail: 'Choose the quarter, enter the certificate number and amount, and attach the Form 16A.' },
            { title: 'SJVN can now claim the credit', detail: 'Finance sees the certificate on its side. If the amount differs from the ledger, it is shown in red.' },
          ] },
          { type: 'note', tone: 'info', text: 'A checker, approver or the Company Admin files the certificate. A maker can view but not file.' },
        ]),
      ] },
      { id: 'p-faq', heading: 'Common questions', blocks: [
        { type: 'faq', items: [
          { q: 'My auditor wants a balance confirmation.', a: 'Download the statement of account as a PDF for the period. For a signed confirmation, use the Reconciliation section.' },
          ...(w.seller
            ? [{ q: 'The payment I received is less than the bill.', a: 'Open the payment advice. It shows the TDS, any other deduction with its reason, and any rebate.' }]
            : [{ q: 'I reported a payment but it is not in the ledger.', a: 'The ledger shows a payment only after SJVN Finance confirms it. Until then it is listed on the bill as "awaiting confirmation".' }]),
        ] },
      ] },
    ],
  };
};

const disputes = (side) => {
  const w = words(side);
  return {
    eyebrow: 'How this page works',
    title: 'My Disputes',
    summary: `When you do not agree with ${w.seller ? 'how SJVN has treated your invoice — a deduction, a rate, the energy —' : 'a bill SJVN has raised on you,'} you raise a dispute here. The page shows how much time SJVN has to answer, the surcharge at stake, and lets you accept the decision or take it further.`,
    facts: [
      { label: 'Acknowledge', value: 'Within 2 days', hint: 'SJVN\'s time limit' },
      { label: 'Resolve', value: 'Within 15 days', hint: 'SJVN\'s time limit' },
      { label: 'Only the disputed part', value: 'Is held', hint: 'The rest stays payable' },
      { label: 'Dossier', value: 'PDF or ZIP', hint: 'The whole file in one download' },
    ],
    quickRef: { title: 'The clock tag', items: [
      { k: '"12d left"', v: 'SJVN still has this many days' },
      { k: '"Overdue 3d"', v: 'SJVN has crossed its time limit' },
      { k: '"Your answer awaited"', v: 'SJVN has decided; your move' },
      { k: '"Reply awaited"', v: 'SJVN asked you for information' },
      { k: '"Escalated"', v: 'You did not accept the decision' },
    ] },
    sections: [
      { id: 'x-raise', heading: 'Raising a dispute', blocks: [
        { type: 'steps', items: [
          { title: 'Click Raise Dispute', detail: 'Tick the bill. If the same problem affects several bills, tick them all and enter the amount for each — they are linked as one group.' },
          { title: 'Say what is wrong', detail: 'Choose the reason and the charge it relates to, and describe the issue in a line or two.' },
          { title: 'Attach evidence', detail: 'A meter reading, a clause of the contract, your calculation.' },
          { title: 'Submit', detail: 'Each bill gets its own dispute number. SJVN is notified and the clock starts.' },
        ] },
        { type: 'note', tone: 'info', title: 'Dispute only the amount in question', text: `Enter only the part you disagree with. That part is set aside; the rest of the bill ${w.seller ? 'is still payable by SJVN' : 'is still payable by you'} on the due date.` },
      ] },
      { id: 'x-after', heading: 'What happens next', blocks: [
        { type: 'table', columns: ['Stage', 'What it means'], rows: [
          ['Raised', 'SJVN has received it.'],
          ['Acknowledged / Under review', 'SJVN is looking into it.'],
          ['Info requested', 'SJVN needs something from you. The clock stops until you reply in the thread.'],
          ['Resolved', 'SJVN has decided: accepted in full, accepted in part, or not accepted — with its reasons.'],
          ['Closed', 'Finished.'],
        ] },
      ] },
      { id: 'x-answer', heading: 'Answering SJVN\'s decision', blocks: [
        { type: 'steps', items: [
          { title: 'Read the resolution', detail: 'The dispute shows what was accepted, what was not, and why.' },
          { title: 'Accept', detail: 'If you agree, click "Accept resolution". The matter ends.' },
          { title: 'Or escalate', detail: 'If you do not agree, click "Escalate — not accepted", choose where you are taking it (SJVN management, conciliation, arbitration, the Commission) and give your reason.' },
        ] },
      ] },
      { id: 'x-lps', heading: 'The surcharge figure', blocks: [
        { type: 'p', text: 'The page shows an estimate of the late payment surcharge on the amount in question, and how much it grows each day. It tells you what is at stake while the dispute is open.' },
        { type: 'note', tone: 'warn', text: 'It is an estimate at simple interest. The actual surcharge is worked out by the rules in your contract when the matter is settled.' },
      ] },
      { id: 'x-faq', heading: 'Common questions', blocks: [
        { type: 'faq', items: [
          { q: 'Can I take a dispute back?', a: 'Yes, while it is open. Use Withdraw and give a reason.' },
          { q: 'What is the dossier?', a: 'One PDF with the dispute, the bill, the timeline, the messages and a list of evidence. The ZIP also contains the evidence files. Useful if the matter goes to conciliation or arbitration.' },
          { q: 'SJVN crossed its time limit. What now?', a: 'The dispute is marked as overdue and is escalated inside SJVN automatically. You can also write in the thread.' },
        ] },
      ] },
    ],
  };
};

const security = (side) => {
  const w = words(side);
  return {
    eyebrow: 'How this page works',
    title: 'Payment Security',
    summary: w.seller
      ? 'The bank guarantees you have given SJVN (EMD and PBG), and the letter of credit SJVN keeps open in your favour. The page warns you before a guarantee expires and lets you submit the bank\'s extension.'
      : 'The letters of credit you have given SJVN under your PSAs. The page warns you before an LC expires, lets you submit the bank\'s extension, and shows whether the LC is as large as the PSA requires.',
    facts: [
      { label: 'Amber', value: 'Expires within 60 days', hint: 'Start the extension' },
      { label: 'Red', value: 'Within 30 days or expired', hint: 'Act now' },
      { label: 'Counts as security', value: 'After SJVN accepts', hint: 'Not on submission' },
      { label: 'Bank confirmation', value: 'By SFMS', hint: 'Bank to bank' },
    ],
    quickRef: { title: 'Words used', items: [
      { k: 'EMD', v: 'Earnest Money Deposit, given with the bid' },
      { k: 'PBG', v: 'Performance Bank Guarantee' },
      { k: 'LC', v: 'Letter of Credit' },
      { k: 'SFMS', v: 'The banks\' secure messaging system' },
      { k: 'Claim period', v: 'Time after expiry in which a claim can still be made' },
    ] },
    sections: [
      { id: 's-what', heading: 'What you see here', blocks: [
        { type: 'p', text: `Each row is one ${w.security}. The row turns amber and then red as the expiry date comes near, and a banner at the top tells you which one needs an extension. Click a row to open it.` },
        { type: 'table', columns: ['Tab', 'What it shows'], rows: w.seller ? [
          ['My bank guarantees', 'The EMD and PBG you have given SJVN.'],
          ['SJVN LCs (My Payment Security)', 'The letter of credit SJVN has opened in your favour, its amount and validity.'],
          ['Required vs held', 'What each PPA asks for against what is in force today.'],
        ] : [
          ['My letters of credit', 'The LCs you have given SJVN.'],
          ['Required vs held', 'The LC each PSA asks for, worked out from your monthly bill, against what is in force today.'],
        ] },
      ] },
      { id: 's-extend', heading: `Extending a ${w.securityShort} before it expires`, blocks: [
        { type: 'steps', items: [
          { title: 'Get it extended by your bank', detail: 'Ask the issuing bank for the amendment extending the validity (and the claim period).' },
          { title: `Click "Submit ${w.securityShort} extension / amendment"`, detail: 'Enter the new validity date. Fill only what the bank changed.' },
          { title: 'Attach the bank\'s letter', detail: 'It is required.' },
          { title: 'SJVN accepts it', detail: 'Until SJVN accepts, nothing changes on the record. After acceptance the new date applies and the warning goes away.' },
        ] },
        ...(w.seller ? [{ type: 'note', tone: 'stop', title: 'Do not let a guarantee lapse', text: 'If a guarantee is not extended before it expires, SJVN may encash it. Start the extension as soon as the row turns amber.' }] : []),
      ] },
      { id: 's-sfms', heading: 'Bank confirmation (SFMS)', blocks: [
        { type: 'p', text: `A ${w.security} is fully valid for SJVN only when your bank confirms it directly to SJVN's bank through SFMS. When SJVN receives that message, it records the message type, date and reference, and you see "Received" here.` },
        { type: 'note', tone: 'info', text: 'If it shows "Pending", ask your issuing branch to send the SFMS message to SJVN\'s bank and share the reference with SJVN.' },
      ] },
      { id: 's-more', heading: 'Other things you can do', blocks: [
        { type: 'table', columns: ['Action', 'When'], rows: [
          [`Submit a new ${w.securityShort}`, `You have a fresh ${w.security} issued. Enter its details and attach the scan. It counts only after SJVN accepts it.`],
          [`View scanned ${w.securityShort}`, 'Open the document that is on file.'],
          ['Amendments', 'See the full chain: the original, then each amendment in order, with what changed.'],
          ['Request release', 'When the obligation is over. SJVN releases only if nothing is owed and no dispute is open — the page tells you this before you ask.'],
          ...(w.seller ? [] : [['Replenish', 'If SJVN has drawn on a revolving LC, record the amount your bank has reinstated.']]),
          ['Download register', 'All your instruments in one Excel file.'],
        ] },
      ] },
      { id: 's-faq', heading: 'Common questions', blocks: [
        { type: 'faq', items: [
          { q: 'I submitted the extension but the row is still red.', a: 'It is waiting for SJVN to accept it. The row shows "Extension with SJVN". Once accepted, the date changes.' },
          ...(w.seller ? [{ q: 'SJVN\'s LC in my favour looks too small.', a: 'The "Required vs held" tab shows the shortfall. Raise it with SJVN through a contract notice.' }] : [{ q: 'The page says my LC is short.', a: 'The PSA asks for an LC worth a set share of your monthly bill. If your bills have grown, ask your bank to raise the LC and submit the amendment.' }]),
        ] },
      ] },
    ],
  };
};

const reconciliation = (side) => {
  const w = words(side);
  return {
    eyebrow: 'How this page works',
    title: 'Reconciliation',
    summary: `Every period, SJVN and ${w.you} confirm that both sets of books agree — the energy, the bills, the payments and the balance. SJVN prepares the statement; you check it and sign. When both have signed, the period is closed.`,
    facts: [
      { label: 'Prepared by', value: 'SJVN', hint: 'Monthly, quarterly or yearly' },
      { label: 'Your part', value: 'Check and sign', hint: 'Or record what you do not agree' },
      { label: 'Closed', value: 'When both have signed', hint: 'With no open exceptions' },
      { label: 'Balance', value: 'Carried forward', hint: 'Into the next period' },
    ],
    sections: [
      { id: 'r-what', heading: 'What a statement contains', blocks: [
        { type: 'table', columns: ['Part', 'What it shows'], rows: [
          ['Matched lines', 'Energy and money items that agree between SJVN\'s records and the bills.'],
          ['Exceptions', 'Lines that did not match and need looking at.'],
          ['Roll-forward', 'Opening balance, plus billed, less paid and adjusted, equals closing balance. The closing balance becomes the next period\'s opening.'],
          ['Match %', 'How much of the statement matched automatically.'],
        ] },
      ] },
      { id: 'r-sign', heading: 'Signing a statement', blocks: [
        { type: 'steps', items: [
          { title: 'Open the statement', detail: 'Compare the closing balance and each line with your own books.' },
          { title: 'If everything agrees, sign', detail: 'Click Agree and sign. Your name, the time and a fingerprint of the figures are recorded.' },
          { title: 'If something does not agree, say so', detail: 'Sign with exceptions: list the items you do not accept and your figure for each. The rest is agreed; those items stay open.' },
          { title: 'Attach the auditor\'s certificate if asked', detail: 'For some periods SJVN requires your auditor\'s certificate before you can sign. The page tells you when.' },
          { title: 'Download the signed statement', detail: 'Once both sides have signed, download the PDF for your records.' },
        ] },
        { type: 'note', tone: 'info', title: 'About the signature', text: 'Signing here is an electronic acknowledgement. For a certificate-based digital signature, download the statement, sign it with your DSC, and upload the signed copy on the same page.' },
      ] },
      { id: 'r-status', heading: 'Statuses', blocks: [
        { type: 'table', columns: ['Status', 'Meaning'], rows: [
          ['Needs review', 'SJVN is still working through the exceptions.'],
          ['Pending sign-off', 'Ready for signatures. The "Signed" column shows 0, 1 or 2 of 2.'],
          ['Agreed', 'Both signed, but some exceptions are still open.'],
          ['Closed', 'Both signed and nothing is open.'],
        ] },
      ] },
      { id: 'r-faq', heading: 'Common questions', blocks: [
        { type: 'faq', items: [
          { q: 'Can I sign twice or change my signature?', a: 'No. A statement is signed once by each side. If something changes afterwards, ask SJVN to reopen it.' },
          { q: 'What happens to an item I did not agree?', a: 'It stays open as an exception. You can raise it as a dispute from the statement — the page has a link for it.' },
          { q: 'Who in my company should sign?', a: 'Someone authorised to confirm balances. A checker, approver or the Company Admin is the usual choice.' },
        ] },
      ] },
    ],
  };
};

const BUILDERS = { dashboard, mail, notifications, team, documents, contracts, energy, invoices, payments, disputes, security, reconciliation };

/** The guide for one section of a counterparty's portal, or null if there is none. */
export function counterpartyGuide(key, side) {
  const build = BUILDERS[key];
  return build ? build(side === 'BUYER' ? 'BUYER' : 'SELLER') : null;
}

export const COUNTERPARTY_GUIDE_KEYS = Object.keys(BUILDERS);
