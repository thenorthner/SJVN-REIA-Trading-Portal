import React from 'react';
import { Link } from 'react-router-dom';
import { useGigw } from './GigwContext.jsx';
import { useSiteInfo } from './siteInfo.js';
import { POLICY_LINKS, HELP_LINKS, RELATED_LINKS, SOCIAL_LINKS } from './policyContent.js';
import { openCookiePreferences } from './CookieConsent.jsx';

/**
 * The footer GIGW 3.0 and DBIM v3 s.5.6 require on every page: website
 * policies, sitemap, related links, help, feedback, contact us, last updated
 * on, social media, and the lineage sentence for a Public Sector Undertaking.
 * It sits on the key colour of SJVN's DBIM colour group (#162F6A) in every
 * theme. Automated checkers look for these links by their anchor text, so the
 * English names are the standard ones.
 *
 * `compact` is the single-row version for the sign-in screen and the signed-in
 * shell, where a four-column footer would push the work off the screen.
 */
const CONNECT_PATHS = ['/contact-us', '/feedback', '/grievance-redressal'];
const FOOTER_RELATED = ['https://www.india.gov.in', 'https://powermin.gov.in', 'https://sjvn.nic.in', 'https://pgportal.gov.in'];

export default function GigwFooter({ compact = false }) {
  const { t, lang } = useGigw();
  const info = useSiteInfo();
  const year = new Date().getFullYear();
  const updated = info?.last_updated ? fmtDate(info.last_updated, lang) : null;
  const wim = info?.contacts?.wim;
  const helpLinks = HELP_LINKS.filter((l) => !CONNECT_PATHS.includes(l.to) && l.to !== '/related-links');
  const connectLinks = HELP_LINKS.filter((l) => CONNECT_PATHS.includes(l.to));
  const meta = (
    <p className="gigw-footer-meta">
      {t('footer.copyright', { year })}
      {updated && <> · {t('footer.lastUpdatedOn')}: <time dateTime={info.last_updated}>{updated}</time></>}
    </p>
  );

  if (compact) {
    return (
      <footer className="gigw-footer gigw-footer-compact" role="contentinfo">
        <nav aria-label={t('footer.policies')}>
          <ul className="gigw-footer-inline">
            {[...POLICY_LINKS, ...HELP_LINKS].map((l) => (
              <li key={l.to}><Link to={l.to}>{t(l.key)}</Link></li>
            ))}
            <li><button type="button" className="gigw-linkbtn" onClick={openCookiePreferences}>{t('cookie.manage')}</button></li>
          </ul>
        </nav>
        {meta}
      </footer>
    );
  }

  return (
    <footer className="gigw-footer" role="contentinfo">
      <div className="gigw-footer-grid">
        <nav aria-labelledby="gigw-f-pol">
          <h2 id="gigw-f-pol" className="gigw-footer-h">{t('footer.policies')}</h2>
          <ul>{POLICY_LINKS.map((l) => <li key={l.to}><Link to={l.to}>{t(l.key)}</Link></li>)}</ul>
        </nav>
        <nav aria-labelledby="gigw-f-help">
          <h2 id="gigw-f-help" className="gigw-footer-h">{t('footer.helpOnly')}</h2>
          <ul>
            {helpLinks.map((l) => <li key={l.to}><Link to={l.to}>{t(l.key)}</Link></li>)}
            <li><button type="button" className="gigw-linkbtn" onClick={openCookiePreferences}>{t('cookie.manage')}</button></li>
          </ul>
        </nav>
        <div>
          <nav aria-labelledby="gigw-f-connect">
            <h2 id="gigw-f-connect" className="gigw-footer-h">{t('footer.connect')}</h2>
            <ul>{connectLinks.map((l) => <li key={l.to}><Link to={l.to}>{t(l.key)}</Link></li>)}</ul>
          </nav>
          <address className="gigw-address">
            {wim?.name && <strong>{wim.name}</strong>}
            {wim?.designation && <span>{wim.designation}</span>}
            <span>{t('pub.footer.wim')}</span>
            {info?.office_address && <span>{info.office_address}</span>}
            {wim?.email && <a href={`mailto:${wim.email}`}>{wim.email}</a>}
            {wim?.phone && <a href={`tel:${wim.phone.replace(/[^\d+]/g, '')}`}>{wim.phone}</a>}
            {info?.working_hours && <span>{info.working_hours}</span>}
          </address>
        </div>
        <nav aria-labelledby="gigw-f-related">
          <h2 id="gigw-f-related" className="gigw-footer-h">{t('footer.related')}</h2>
          <ul>
            {RELATED_LINKS.filter((l) => FOOTER_RELATED.includes(l.href)).map((l) => (
              <li key={l.href}>
                <a href={l.href} target="_blank" rel="noopener noreferrer">{l[lang] ?? l.en}<span className="sr-only"> {t('ext.newTab')}</span></a>
              </li>
            ))}
            <li><Link to="/related-links">{t('page.related')}</Link></li>
          </ul>
          <h2 className="gigw-footer-h gigw-footer-h-social">{t('footer.social')}</h2>
          <ul className="gigw-footer-social">
            {SOCIAL_LINKS.map((s) => (
              <li key={s.href}>
                <a href={s.href} target="_blank" rel="noopener noreferrer" className="gigw-social-icon-btn" title={s.name}>
                  <SocialIcon name={s.icon} />
                  <span className="sr-only">SJVN on {s.name} {t('ext.newTab')}</span>
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </div>
      <div className="gigw-footer-bottom">
        <p className="gigw-footer-small">{t('footer.lineage')}</p>
        <p className="gigw-footer-small">{t('footer.bestViewed')}</p>
        {meta}
      </div>
    </footer>
  );
}

// Filled glyphs in inclusive white (DBIM s.3.7: icons in the key colour or
// white). Paths are the platforms' own published marks, drawn at 24 px.
function SocialIcon({ name }) {
  const paths = {
    x: 'M18.24 2.25h3.31l-7.23 8.26 8.5 11.24h-6.66l-5.21-6.82-5.97 6.82H1.67l7.73-8.84L1.25 2.25h6.83l4.71 6.23 5.45-6.23Zm-1.16 17.52h1.83L7.08 4.13H5.12l11.96 15.64Z',
    facebook: 'M24 12.07C24 5.4 18.63 0 12 0S0 5.4 0 12.07C0 18.1 4.39 23.1 10.13 24v-8.44H7.08v-3.49h3.05V9.41c0-3.02 1.79-4.69 4.53-4.69 1.31 0 2.68.24 2.68.24v2.97h-1.51c-1.49 0-1.96.93-1.96 1.89v2.26h3.33l-.53 3.49h-2.8V24C19.61 23.1 24 18.1 24 12.07Z',
    youtube: 'M23.5 6.19a3.02 3.02 0 0 0-2.12-2.14C19.5 3.55 12 3.55 12 3.55s-7.5 0-9.38.5A3.02 3.02 0 0 0 .5 6.19C0 8.08 0 12 0 12s0 3.92.5 5.81a3.02 3.02 0 0 0 2.12 2.14c1.88.5 9.38.5 9.38.5s7.5 0 9.38-.5a3.02 3.02 0 0 0 2.12-2.14C24 15.92 24 12 24 12s0-3.92-.5-5.81ZM9.55 15.57V8.43L15.82 12l-6.27 3.57Z',
  };
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path fill="currentColor" d={paths[name]} />
    </svg>
  );
}

/** DBIM v3 A.5.6(viii): the day comes before the month. */
export function fmtDate(iso, lang) {
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00+05:30`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(({ hi: 'hi-IN', gu: 'gu-IN', mr: 'mr-IN' }[lang] || 'en-IN'), { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' });
}
