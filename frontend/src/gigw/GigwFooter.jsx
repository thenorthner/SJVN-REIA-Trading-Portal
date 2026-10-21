import React from 'react';
import { Link } from 'react-router-dom';
import { useGigw } from './GigwContext.jsx';
import { useSiteInfo } from './siteInfo.js';
import { POLICY_LINKS, HELP_LINKS } from './policyContent.js';
import { openCookiePreferences } from './CookieConsent.jsx';

/**
 * The footer GIGW 3.0 requires on every page: the website policies, help and
 * contact (Web Information Manager), ownership statement, last-updated date and
 * copyright. Automated checkers look for these links by their anchor text, so
 * the English names are the standard ones.
 *
 * `compact` is the single-row version for the sign-in screen and the signed-in
 * shell, where a four-column footer would push the work off the screen.
 */
export default function GigwFooter({ compact = false }) {
  const { t, lang } = useGigw();
  const info = useSiteInfo();
  const year = new Date().getFullYear();
  const updated = info?.last_updated ? fmtDate(info.last_updated, lang) : null;
  const wim = info?.contacts?.wim;

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
        <p className="gigw-footer-meta">
          {t('footer.copyright', { year })}
          {updated && <> · {t('footer.lastUpdated')}: <time dateTime={info.last_updated}>{updated}</time></>}
        </p>
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
          <h2 id="gigw-f-help" className="gigw-footer-h">{t('footer.help')}</h2>
          <ul>
            {HELP_LINKS.map((l) => <li key={l.to}><Link to={l.to}>{t(l.key)}</Link></li>)}
            <li><button type="button" className="gigw-linkbtn" onClick={openCookiePreferences}>{t('cookie.manage')}</button></li>
          </ul>
        </nav>
        <div>
          <h2 className="gigw-footer-h">{t('page.contact')}</h2>
          <address className="gigw-address">
            {wim?.name && <strong>{wim.name}</strong>}
            {wim?.designation && <span>{wim.designation}</span>}
            <span>{t('pub.footer.wim')}</span>
            {info?.office_address && <span>{info.office_address}</span>}
            {wim?.email && <a href={`mailto:${wim.email}`}>{wim.email}</a>}
            {wim?.phone && <a href={`tel:${wim.phone.replace(/[^\d+]/g, '')}`}>{wim.phone}</a>}
            {info?.working_hours && <span>{info.working_hours}</span>}
          </address>
          <p className="gigw-footer-small">{t('footer.queries')}</p>
        </div>
        <div>
          <h2 className="gigw-footer-h">{t('org.name')}</h2>
          <p className="gigw-footer-small">{t('footer.owned')}</p>
          <p className="gigw-footer-small">{t('footer.bestViewed')}</p>
          <ul className="gigw-footer-ext">
            <li><a href="https://www.india.gov.in" target="_blank" rel="noopener noreferrer">india.gov.in<span className="sr-only"> (opens in a new tab)</span></a></li>
            <li><a href="https://powermin.gov.in" target="_blank" rel="noopener noreferrer">powermin.gov.in<span className="sr-only"> (opens in a new tab)</span></a></li>
            <li><a href="https://pgportal.gov.in" target="_blank" rel="noopener noreferrer">CPGRAMS — pgportal.gov.in<span className="sr-only"> (opens in a new tab)</span></a></li>
          </ul>
        </div>
      </div>
      <p className="gigw-footer-meta">
        {t('footer.copyright', { year })}
        {updated && <> · {t('footer.lastUpdated')}: <time dateTime={info.last_updated}>{updated}</time></>}
      </p>
    </footer>
  );
}

export function fmtDate(iso, lang) {
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00+05:30`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(({ hi: 'hi-IN', gu: 'gu-IN', mr: 'mr-IN' }[lang] || 'en-IN'), { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' });
}
