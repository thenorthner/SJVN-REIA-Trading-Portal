import React, { useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import PublicShell from './PublicShell.jsx';
import { useGigw } from '../../gigw/GigwContext.jsx';
import { useSiteInfo } from '../../gigw/siteInfo.js';
import { fmtDate } from '../../gigw/GigwFooter.jsx';
import { POLICIES, POLICY_LINKS, HELP_LINKS, SCREEN_READERS, CONTACT_ROLES, RELATED_LINKS } from '../../gigw/policyContent.js';
import { openCookiePreferences } from '../../gigw/CookieConsent.jsx';
import { REIA_BETA } from '../../reiaBeta.js';

const POLICY_DESCS = {
  '/privacy-policy': { en: 'DPDP Act 2023 compliance, data fiduciary disclosures and data principal rights', hi: 'डीपीडीपी अधिनियम 2023 अनुपालन, डेटा न्यासी प्रकटीकरण एवं अधिकार' },
  '/terms-of-use': { en: 'Authorised usage terms, computer resource restrictions and IT Act 2000 provisions', hi: 'अधिकृत उपयोग की शर्तें एवं आईटी अधिनियम 2000 प्रावधान' },
  '/disclaimer': REIA_BETA ? { en: 'Operational accuracy and regulatory supremacy of CERC/RPC orders', hi: 'परिचालन सटीकता एवं सीईआरसी/आरपीसी आदेशों की विनियामक सर्वोच्चता' } : { en: 'Operational accuracy, regulatory supremacy of CERC/RPC orders, and power market feeds', hi: 'परिचालन सटीकता, सीईआरसी/आरपीसी आदेशों की सर्वोच्चता' },
  '/hyperlinking-policy': { en: 'Rules for inbound/outbound hyperlinks to government portals and power exchanges', hi: 'सरकारी पोर्टलों एवं पावर एक्सचेंजों के लिए हाइपरलिंकिंग नियम' },
  '/copyright-policy': { en: 'Intellectual property ownership of tender documents, billing software and data', hi: 'निविदा दस्तावेज़ों, बिलिंग सॉफ़्टवेयर एवं डेटा का बौद्धिक संपदा अधिकार' },
  '/cookie-policy': { en: 'List of essential session storage and optional performance analytics under DPDP Act', hi: 'आवश्यक सत्र संग्रहण एवं वैकल्पिक प्रदर्शन विश्लेषण की सूची' },
  '/security-policy': { en: 'CERT-In adherence, role-based controls, immutable hash-chained audit trails', hi: 'सीईआरटी-इन अनुपालन, भूमिका-आधारित नियंत्रण एवं ऑडिट ट्रेल' },
};

const HELP_DESCS = {
  '/contact-us': { en: 'Web Information Manager, desk nodal officers and registered corporate office details', hi: 'वेब सूचना प्रबंधक, डेस्क नोडल अधिकारी एवं पंजीकृत कार्यालय' },
  '/grievance-redressal': { en: 'Statutory grievance redressal, CPGRAMS portal link and RTI Act CPIO contacts', hi: 'वैधानिक शिकायत निवारण, सीपीग्राम्स पोर्टल एवं आरटीआई सीपीआईओ' },
  '/accessibility-statement': { en: 'WCAG 2.1 Level AA compliance, high contrast, text resizing and RPwD Act adherence', hi: 'WCAG 2.1 स्तर AA अनुपालन, उच्च कंट्रास्ट एवं पाठ आकार' },
  '/screen-reader-access': { en: 'Compatible screen readers list (NVDA, JAWS, Narrator, VoiceOver) and key commands', hi: 'संगत स्क्रीन रीडर्स (NVDA, JAWS, Narrator) एवं मुख्य कमांड्स' },
  '/help': REIA_BETA ? { en: 'User guide for the REIA commercial workflow', hi: 'REIA वाणिज्यिक कार्यप्रवाह हेतु उपयोगकर्ता मार्गदर्शिका' } : { en: 'Comprehensive user guides for REIA, Trading, Hydro and Thermal commercial workflows', hi: 'आरईआईए, ट्रेडिंग, हाइड्रो एवं थर्मल वाणिज्यिक कार्यप्रवाह हेतु मार्गदर्शिका' },
  '/sitemap': { en: 'Complete architectural directory and visual sitemap of all platform gateways', hi: 'प्लेटफ़ॉर्म के सभी प्रवेश द्वारों की संपूर्ण स्थापत्य निर्देशिका' },
};

/** One statutory page (privacy, terms, disclaimer …), rendered in the chosen language. */
export default function PolicyPage({ slug }) {
  const { t, lang } = useGigw();
  const info = useSiteInfo();
  const location = useLocation();
  const page = POLICIES[slug];
  const L = (x) => (x ? (x[lang] ?? x.en) : '');

  useEffect(() => {
    if (slug === 'cookie-policy' && (location.search.includes('openPreferences') || location.search.includes('manage'))) {
      openCookiePreferences();
    }
  }, [slug, location.search]);

  if (!page) {
    return (
      <PublicShell title={t('page.notFound')}>
        <article className="gigw-article">
          <h1>{t('page.notFound')}</h1>
          <p><Link to="/">{t('page.backHome')}</Link></p>
        </article>
      </PublicShell>
    );
  }

  const title = t(page.key);
  return (
    <PublicShell title={title}>
      <article className="gigw-article">
        <nav aria-label="Breadcrumb" className="gigw-breadcrumb">
          <ol>
            <li><Link to="/">{t('page.home')}</Link></li>
            <li aria-current="page">{title}</li>
          </ol>
        </nav>
        <h1>{title}</h1>
        {info?.last_updated && (
          <p className="gigw-updated">{t('footer.lastUpdated')}: <time dateTime={info.last_updated}>{fmtDate(info.last_updated, lang)}</time></p>
        )}
        {page.intro && <p className="gigw-lead">{L(page.intro)}</p>}
        {page.sections.map((s, i) => (
          <section key={i} aria-labelledby={`sec-${slug}-${i}`}>
            <h2 id={`sec-${slug}-${i}`}>{L(s.h)}</h2>
            {s.type === 'contacts' && <Contacts roles={s.roles} info={info} lang={lang} />}
            {s.type === 'screen-readers' && <ScreenReaderTable lang={lang} />}
            {s.list && <ul>{s.list.map((x, j) => <li key={j}>{L(x)}</li>)}</ul>}
            {s.p && s.p.map((x, j) => <p key={j}>{L(x)}</p>)}
            {s.links && <ExternalList links={s.links === 'RELATED' ? RELATED_LINKS : s.links} lang={lang} />}
          </section>
        ))}

        {slug === 'cookie-policy' && (
          <div style={{ marginTop: '32px', padding: '18px 20px', background: 'var(--surface-raised, rgba(2, 132, 199, 0.05))', borderRadius: '8px', border: '1px solid var(--border)' }}>
            <h3 style={{ margin: '0 0 6px', fontSize: '16px' }}>{t('pub.policy.manageCookies')}</h3>
            <p style={{ margin: '0 0 14px', fontSize: '15px', color: 'var(--text-muted)' }}>
              {t('pub.policy.cookieConsent')}
            </p>
            <button
              type="button"
              className="btn btn-primary"
              onClick={openCookiePreferences}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '9px 16px', fontWeight: 600, fontSize: '15px' }}
            >
              {t('cookie.manage')}
            </button>
          </div>
        )}
      </article>
    </PublicShell>
  );
}

/** Outbound links: the address is shown, and the new tab is announced. */
function ExternalList({ links, lang }) {
  const { t } = useGigw();
  return (
    <ul className="gigw-related-list">
      {links.map((l) => (
        <li key={l.href}>
          <a href={l.href} target="_blank" rel="noopener noreferrer">
            {l[lang] ?? l.en}<span className="sr-only"> {t('ext.newTab')}</span>
          </a>
          <span className="gigw-related-host">{new URL(l.href).host.replace(/^www\./, '')}</span>
        </li>
      ))}
    </ul>
  );
}

function Contacts({ roles, info, lang }) {
  const { t } = useGigw();
  const contacts = info?.contacts || {};
  return (
    <div className="gigw-contacts">
      {roles.map((r) => {
        const c = contacts[r] || {};
        return (
          <section key={r} className="gigw-contact-card" aria-label={(CONTACT_ROLES[r]?.[lang] ?? CONTACT_ROLES[r]?.en) || r}>
            <h3>{(CONTACT_ROLES[r]?.[lang] ?? CONTACT_ROLES[r]?.en) || r}</h3>
            <address>
              {c.name && <strong>{c.name}</strong>}
              {c.designation && <span>{c.designation}</span>}
              {(c.address || info?.office_address) && <span>{c.address || info.office_address}</span>}
              {c.email && <span>{t('pub.policy.email')}: <a href={`mailto:${c.email}`}>{c.email}</a></span>}
              {c.phone && <span>{t('pub.policy.phone')}: <a href={`tel:${c.phone.replace(/[^\d+]/g, '')}`}>{c.phone}</a></span>}
              {info?.working_hours && <span>{info.working_hours}</span>}
            </address>
          </section>
        );
      })}
    </div>
  );
}

function ScreenReaderTable({ lang }) {
  const { t } = useGigw();
  return (
    <div className="table-wrap">
      <table className="data-table">
        <caption className="sr-only">{t('pub.policy.srCaption')}</caption>
        <thead>
          <tr>
            <th scope="col">{t('pub.policy.srName')}</th>
            <th scope="col">{t('pub.policy.website')}</th>
            <th scope="col">{t('pub.policy.type')}</th>
          </tr>
        </thead>
        <tbody>
          {SCREEN_READERS.map((s) => (
            <tr key={s.name}>
              <th scope="row">{s.name}</th>
              <td><a href={s.site} target="_blank" rel="noopener noreferrer">{new URL(s.site).hostname}<span className="sr-only"> (opens in a new tab)</span></a></td>
              <td>{s.kind[lang] ?? s.kind.en}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Every public page, for visitors and for crawlers. */
export function Sitemap() {
  const { t, lang } = useGigw();
  const info = useSiteInfo();

  return (
    <PublicShell title={t('page.sitemap')}>
      <article className="gigw-article" style={{ maxWidth: '1080px' }}>
        <nav aria-label="Breadcrumb" className="gigw-breadcrumb">
          <ol>
            <li><Link to="/">{t('page.home')}</Link></li>
            <li aria-current="page">{t('page.sitemap')}</li>
          </ol>
        </nav>
        <h1>{t('page.sitemap')}</h1>
        {info?.last_updated && (
          <p className="gigw-updated">{t('footer.lastUpdated')}: <time dateTime={info.last_updated}>{fmtDate(info.last_updated, lang)}</time></p>
        )}
        <p className="gigw-lead">
          {t('pub.sitemap.lead')}
        </p>

        <div className="sitemap-grid">
          {/* Section 1: Sovereign Portals & Core Gateway */}
          <div className="sitemap-card">
            <h2>{t('pub.sitemap.core')}</h2>
            <ul>
              <li>
                <Link to="/">{t('page.home')}</Link>
                <span className="sitemap-desc">{t('pub.sitemap.coreHome')}</span>
              </li>
              <li>
                <Link to="/login">{t('page.login')}</Link>
                <span className="sitemap-desc">{t('pub.sitemap.coreLogin')}</span>
              </li>
              <li><Link to="/about-us">{t('page.about')}</Link></li>
              {!REIA_BETA && <li><Link to="/circulars">{t('page.circulars')}</Link></li>}
            </ul>
          </div>

          {/* Section 2: Statutory Website Policies */}
          <div className="sitemap-card">
            <h2>{t('footer.policies')}</h2>
            <ul>
              {POLICY_LINKS.map((l) => (
                <li key={l.to}>
                  <Link to={l.to}>{t(l.key)}</Link>
                  <span className="sitemap-desc">{(POLICY_DESCS[l.to]?.[lang] ?? POLICY_DESCS[l.to]?.en) || ''}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Section 3: Help, Citizen Support & Governance */}
          <div className="sitemap-card">
            <h2>{t('footer.help')}</h2>
            <ul>
              {HELP_LINKS.map((l) => (
                <li key={l.to}>
                  <Link to={l.to}>{t(l.key)}</Link>
                  <span className="sitemap-desc">{(HELP_DESCS[l.to]?.[lang] ?? HELP_DESCS[l.to]?.en) || ''}</span>
                </li>
              ))}
              <li>
                <button
                  type="button"
                  className="gigw-linkbtn"
                  onClick={openCookiePreferences}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', color: 'var(--primary)', fontWeight: 500, fontSize: '15px' }}
                >
                  {t('cookie.manage')} <span className="sitemap-badge">{t('pub.sitemap.interactive')}</span>
                </button>
                <span className="sitemap-desc">{t('pub.sitemap.cookieDesc')}</span>
              </li>
            </ul>
          </div>

          {/* Section 4: Enterprise Operating Desks */}
          <div className="sitemap-card">
            <h2>{t('pub.sitemap.desks')}</h2>
            <ul>
              <li>
                <Link to="/reia">
                  {t('home.reia.title')}
                  <span className="sitemap-badge">{t('pub.sitemap.restricted')}</span>
                </Link>
                <span className="sitemap-desc">{t('home.reia.body')}</span>
              </li>
              {!REIA_BETA && <>
              <li>
                <Link to="/trading">
                  {t('home.trading.title')}
                  <span className="sitemap-badge">{t('pub.sitemap.restricted')}</span>
                </Link>
                <span className="sitemap-desc">{t('home.trading.body')}</span>
              </li>
              <li>
                <Link to="/hydro-thermal">
                  {t('home.hydro.title')}
                  <span className="sitemap-badge">{t('pub.sitemap.restricted')}</span>
                </Link>
                <span className="sitemap-desc">{t('home.hydro.body')}</span>
              </li>
              <li>
                <Link to="/thermal">
                  {t('home.thermal.title')}
                  <span className="sitemap-badge">{t('pub.sitemap.restricted')}</span>
                </Link>
                <span className="sitemap-desc">{t('home.thermal.body')}</span>
              </li>
              </>}
            </ul>
          </div>
        </div>
      </article>
    </PublicShell>
  );
}

