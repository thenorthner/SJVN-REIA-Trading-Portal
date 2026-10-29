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
  'fb.eyebrow': { en: 'REIA BETA FEEDBACK', hi: 'REIA बीटा प्रतिक्रिया', gu: 'REIA બીટા પ્રતિસાદ', mr: 'REIA बीटा अभिप्राय' },
  'fb.heroTitle': { en: 'Help us shape the REIA portal', hi: 'REIA पोर्टल को बेहतर बनाने में मदद करें', gu: 'REIA પોર્ટલને ઘડવામાં મદદ કરો', mr: 'REIA पोर्टल घडवण्यात मदत करा' },
  'fb.heroLead': { en: 'You are among the first to use the REIA portal. Tell us what works, what breaks and what is missing before it opens to everyone.', hi: 'आप REIA पोर्टल के पहले उपयोगकर्ताओं में हैं। सबके लिए खुलने से पहले बताएँ क्या ठीक है, क्या टूटता है और क्या कमी है।', gu: 'તમે REIA પોર્ટલના પ્રથમ વપરાશકર્તાઓમાં છો. બધા માટે ખૂલે તે પહેલાં જણાવો શું ચાલે છે, શું તૂટે છે અને શું ખૂટે છે.', mr: 'आपण REIA पोर्टलच्या पहिल्या वापरकर्त्यांपैकी आहात. सर्वांसाठी उघडण्यापूर्वी सांगा काय चालते, काय बिघडते आणि काय कमी आहे.' },
  'pub.sitemap.lead': { en: 'Structured directory of the SJVN REIA Commercial Portal (Beta), detailing all public pages, statutory policies and the REIA sign-in.', hi: 'एसजेवीएन REIA वाणिज्यिक पोर्टल (बीटा) की संरचित निर्देशिका: सभी सार्वजनिक पृष्ठ, वैधानिक नीतियाँ एवं REIA साइन-इन।' },
};
