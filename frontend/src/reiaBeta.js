// REIA beta build: the public face shows the REIA desk alone. Set
// VITE_REIA_BETA=1 at build time and "/" (signed out) opens the REIA beta home
// and the sign-in screen carries no mark of the other desks. /reia-beta always
// opens that home, flag or not, and links to /login?desk=REIA.
export const REIA_BETA = import.meta.env.VITE_REIA_BETA === '1';
export const REIA_BETA_HOME = '/reia-beta';
export const REIA_BETA_TITLE = 'SJVN Limited | REIA Commercial Portal';
// The REIA Playbook (tools/reia-playbook, served from public/reia-playbook):
// testers look up how a step works there before they report it. The file is
// named because the dev server answers a bare folder with the app.
export const REIA_PLAYBOOK_URL = '/reia-playbook/index.html';

// The signed-in screens the beta shows. The rest of the platform keeps its
// routes, roles and permissions; the beta build neither lists nor opens it, so
// a beta tester sees the REIA desk alone whatever their role (SJVN Admin too).
const BETA_PREFIXES = [
  '/reia', '/seller', '/buyer', '/mail', '/notification-board', '/settings',
  '/admin/users', '/admin/role-powers', '/admin/project-assignments', '/audit-logs', '/masters',
];

// The CERC filing calendar and Form-IV are in it since 31-Oct-2026: the REIA
// workflow has the REIA desk prepare and file the return, and the beta shows the
// desk's own PPA/PSA lines on it (the API leaves the other trades out).
export function inReiaBeta(pathname) {
  return BETA_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

// Words that name the other desks, their stations or their markets. The beta's
// search drops any entry that carries one, whatever its path.
export const OTHER_DESKS_RE = /trading|trader|hydro|thermal|\bIEX\b|\bPXIL\b|\bHPX\b|power market|nathpa|jhakri|rampur|buxar|naitwar|luhri|NJHPS|RHPS|\bPTC\b|bilateral|\bGDAM\b|\bDAM\b|\bRTM\b|\bMMR\b|\bCEA\b|portfolio|station|ट्रेडिंग|व्यापार|जल-?विद्युत|ताप|संयंत्र/i;
// Signed-in desk areas outside the beta (the public pages are not among them).
const OTHER_DESK_PATH_RE = /^\/($|dashboard|trading|hydro|thermal|erp|reports|cerc|cea|uploader|invoices|billing|compliance\/|registration|market|clients|portfolio|master\/|circulars|admin\/circulars|reconciliation\/)/;

/** Whether a portal-search entry belongs in the beta's search. */
export function inBetaSearch(item) {
  if (!REIA_BETA) return true;
  if (['station', 'trading'].includes(item.category)) return false;
  if (item.path && !inReiaBeta(item.path) && OTHER_DESK_PATH_RE.test(item.path)) return false;
  const text = [item.title?.en, item.title?.hi, item.desc?.en, item.desc?.hi, item.catLabel?.en, ...(item.keywords || [])].join(' ');
  return !OTHER_DESKS_RE.test(text);
}

/** The sidebar as the beta shows it: REIA screens only, empty sections dropped. */
export function betaNav(sections) {
  if (!REIA_BETA) return sections;
  return sections
    // Overview's only beta screen is the REIA Dashboard, which the REIA section
    // lists; the other desks' sections go whole, whatever REIA link they carry.
    .filter((s) => !['Overview', 'Power Trading', 'Hydro Billing', 'Thermal Billing'].includes(s.section))
    .map((s) => ({
      ...s,
      links: s.links?.filter((l) => inReiaBeta(l.to)),
      groups: s.groups
        ?.map((g) => ({ ...g, items: g.items.filter((i) => inReiaBeta(i.to)) }))
        .filter((g) => g.items.length),
    }))
    .filter((s) => (s.links?.length || 0) + (s.groups?.length || 0) > 0);
}

// The other desks' roles. A screen's own role list (break-glass) leaves them
// out in the beta; who may do what is unchanged.
const OTHER_DESK_ROLE_RE = /^(TRADING|COMMERCIAL|THERMAL|HYDRO)/;
export const inBetaRoles = (role) => !REIA_BETA || !OTHER_DESK_ROLE_RE.test(role || '');

/** Where a role starts in the beta: its own portal, or the REIA desk. */
export function betaLanding(role) {
  if (/^SELLER/.test(role || '')) return '/seller';
  if (/^BUYER/.test(role || '')) return '/buyer';
  if (role === 'COMPLIANCE_AUDITOR') return '/audit-logs';
  return '/reia';
}

// Quick sign-in for the beta's test accounts: every REIA role, SJVN Admin
// included. They share the seeded test password (backend seed).
export const BETA_DEMO_ACCOUNTS = [
  { group: 'SJVN REIA desk', accounts: [
    { label: 'REIA Maker', note: 'Prepares bills and data', email: 'reia@sjvn.in' },
    { label: 'REIA Checker', note: 'Scrutiny, level 1', email: 'reia.admin@sjvn.in' },
    { label: 'REIA Approver', note: 'HOD, level 3', email: 'reia.approver@sjvn.in' },
    { label: 'Finance', note: 'Settlement and postings', email: 'finance@sjvn.in' },
    { label: 'Management', note: 'Level 3 approver', email: 'management@sjvn.in' },
    { label: 'SJVN Admin', note: 'Users and governance', email: 'admin@sjvn.in' },
  ] },
  { group: 'Generator (seller)', accounts: [
    { label: 'Seller', note: 'Sunrise Solar', email: 'seller@sunrise-solar.in' },
  ] },
  { group: 'Discom (buyer)', accounts: [
    { label: 'Buyer', note: 'State discom', email: 'buyer@discom.gov.in' },
    { label: 'Buyer Maker', note: 'Discom level 1', email: 'buyer.maker@discom.gov.in' },
    { label: 'Buyer Checker', note: 'Discom level 2', email: 'buyer.checker@discom.gov.in' },
  ] },
];
export const BETA_DEMO_PASSWORD = 'password123';

// In the beta the REIA margin is called the SJVN margin, so no screen says
// "trading". The CERC regulation's own title is left as it is.
export function reiaTerm(text) {
  if (!REIA_BETA || typeof text !== 'string') return text;
  return text.replace(/Trading Margin/g, 'SJVN Margin').replace(/Trading margin/g, 'SJVN margin').replace(/trading margin/g, 'SJVN margin');
}

// Portal-wide strings that name every desk, as the REIA beta shows them.
export const BETA_STRINGS = {
  'portal.name': { en: 'REIA Commercial Portal (Beta)', hi: 'REIA वाणिज्यिक पोर्टल (बीटा)' },
  'fb.eyebrow': { en: 'REIA BETA FEEDBACK', hi: 'REIA बीटा प्रतिक्रिया', gu: 'REIA બીટા પ્રતિસાદ', mr: 'REIA बीटा अभिप्राय' },
  'fb.heroTitle': { en: 'Help us shape the REIA portal', hi: 'REIA पोर्टल को बेहतर बनाने में मदद करें', gu: 'REIA પોર્ટલને ઘડવામાં મદદ કરો', mr: 'REIA पोर्टल घडवण्यात मदत करा' },
  'fb.heroLead': { en: 'You are among the first to use the REIA portal. Tell us what works, what breaks and what is missing before it opens to everyone.', hi: 'आप REIA पोर्टल के पहले उपयोगकर्ताओं में हैं। सबके लिए खुलने से पहले बताएँ क्या ठीक है, क्या टूटता है और क्या कमी है।', gu: 'તમે REIA પોર્ટલના પ્રથમ વપરાશકર્તાઓમાં છો. બધા માટે ખૂલે તે પહેલાં જણાવો શું ચાલે છે, શું તૂટે છે અને શું ખૂટે છે.', mr: 'आपण REIA पोर्टलच्या पहिल्या वापरकर्त्यांपैकी आहात. सर्वांसाठी उघडण्यापूर्वी सांगा काय चालते, काय बिघडते आणि काय कमी आहे.' },
  'pub.sitemap.lead': { en: 'Structured directory of the SJVN REIA Commercial Portal (Beta), detailing all public pages, statutory policies and the REIA sign-in.', hi: 'एसजेवीएन REIA वाणिज्यिक पोर्टल (बीटा) की संरचित निर्देशिका: सभी सार्वजनिक पृष्ठ, वैधानिक नीतियाँ एवं REIA साइन-इन।' },
};
