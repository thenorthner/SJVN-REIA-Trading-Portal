// REIA beta build: the public face shows the REIA desk alone. Set
// VITE_REIA_BETA=1 at build time and "/" (signed out) opens the REIA beta home
// and the sign-in screen carries no mark of the other desks. /reia-beta always
// opens that home, flag or not, and links to /login?desk=REIA.
export const REIA_BETA = import.meta.env.VITE_REIA_BETA === '1';
export const REIA_BETA_HOME = '/reia-beta';
export const REIA_BETA_TITLE = 'SJVN Limited | REIA Commercial Portal';

// In the beta the REIA margin is called the SJVN margin, so no screen says
// "trading". The CERC regulation's own title is left as it is.
export function reiaTerm(text) {
  if (!REIA_BETA || typeof text !== 'string') return text;
  return text.replace(/Trading Margin/g, 'SJVN Margin').replace(/Trading margin/g, 'SJVN margin').replace(/trading margin/g, 'SJVN margin');
}

// Portal-wide strings that name every desk, as the REIA beta shows them.
export const BETA_STRINGS = {
  'portal.name': { en: 'REIA Commercial Portal (Beta)', hi: 'REIA वाणिज्यिक पोर्टल (बीटा)' },
  'pub.sitemap.lead': { en: 'Structured directory of the SJVN REIA Commercial Portal (Beta), detailing all public pages, statutory policies and the REIA sign-in.', hi: 'एसजेवीएन REIA वाणिज्यिक पोर्टल (बीटा) की संरचित निर्देशिका: सभी सार्वजनिक पृष्ठ, वैधानिक नीतियाँ एवं REIA साइन-इन।' },
};
