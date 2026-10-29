import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { 
  Sun, LineChart, Droplets, Factory, ShieldCheck, Zap, 
  ArrowRight, CheckCircle2, ChevronRight, Lock, Building2, 
  Users, FileText, BarChart3, Scale, Award, Globe, 
  ExternalLink, HelpCircle, AlertCircle, FileCheck, Landmark, Check,
  Layers, TrendingUp, Sparkles, Leaf, Bell, Target,
  Map, LayoutGrid, Quote
} from 'lucide-react';
import PublicShell from './PublicShell.jsx';
import IndiaAssetMap from '../../components/IndiaAssetMap.jsx';
import LiveMarketTicker from '../../components/LiveMarketTicker.jsx';
import CleanEnergyCounter from '../../components/CleanEnergyCounter.jsx';
import OfflineBanner from '../../components/OfflineBanner.jsx';
import { useGigw } from '../../gigw/GigwContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { landingFor } from '../Login.jsx';
import { openVisionModal } from '../../components/VisionModal.jsx';
import { REIA_BETA_TITLE } from '../../reiaBeta.js';

/**
 * SJVN Integrated Energy Commerce & REIA Public Portal
 * Matches the official sovereign design layout.
 * Built to GIGW 3.0, DBIM v3 and the DPDP Act 2023.
 */

const HERO_STATS = [
  { 
    value: '2,400+ MW', 
    label: 'RE Capacity Tendered & Managed', 
    icon: Sun,
    colorClass: 'metric-icon-blue'
  },
  { 
    value: '1,912 MW', 
    label: 'Hydro Generating Assets (NJHPS & Rampur)', 
    icon: Droplets,
    colorClass: 'metric-icon-green'
  },
  { 
    value: '3', 
    label: 'Synchronized Exchanges (IEX, PXIL, HPX)', 
    icon: BarChart3,
    colorClass: 'metric-icon-purple'
  },
  { 
    value: '100% Digital', 
    label: 'Back-to-Back PPA & PSA Execution', 
    icon: FileCheck,
    colorClass: 'metric-icon-orange'
  },
];

// The REIA beta shows the REIA desk alone: no hydro station, exchange or other
// desk is named, so these replace the portal-wide figures.
const BETA_HERO_STATS = [
  { value: '2,400+ MW', label: 'RE Capacity Tendered & Managed', icon: Sun, colorClass: 'metric-icon-blue' },
  { value: '100% Digital', label: 'Back-to-Back PPA & PSA Execution', icon: FileCheck, colorClass: 'metric-icon-green' },
  { value: '3-Level', label: 'Maker · Checker · Approver Sign-off', icon: ShieldCheck, colorClass: 'metric-icon-purple' },
  { value: 'Beta', label: 'Pre-launch Testing by Invitation', icon: Sparkles, colorClass: 'metric-icon-orange' },
];

const BETA_NOTES = [
  'Sign in with the login shared with you by SJVN',
  'Work through your usual monthly cycle end to end',
  'Data on the beta is for testing only',
  'Note anything wrong, unclear or slow',
  'Send it through the Feedback page',
];

const NATIONAL_INITIATIVES = [
  {
    nameEn: 'Ministry of Power',
    nameHi: 'विद्युत मंत्रालय',
    descEn: 'Administrative ministry governing power generation & transmission',
    descHi: 'विद्युत उत्पादन एवं पारेषण का प्रशासनिक मंत्रालय',
    url: 'https://powermin.gov.in',
    domain: 'powermin.gov.in'
  },
  {
    nameEn: 'Ministry of New & Renewable Energy (MNRE)',
    nameHi: 'नवीन और नवीकरणीय ऊर्जा मंत्रालय',
    descEn: 'National nodal agency designating SJVN as REIA',
    descHi: 'राष्ट्रीय नोडल मंत्रालय जिसने एसजेवीएन को REIA नामित किया',
    url: 'https://mnre.gov.in',
    domain: 'mnre.gov.in'
  },
  {
    nameEn: 'Central Electricity Regulatory Commission (CERC)',
    nameHi: 'केंद्रीय विद्युत विनियामक आयोग',
    descEn: 'Statutory electricity market regulation & tariff orders',
    descHi: 'वैधानिक विद्युत बाज़ार नियमन एवं टैरिफ आदेश',
    url: 'https://cercind.gov.in',
    domain: 'cercind.gov.in'
  },
  {
    nameEn: 'Central Electricity Authority (CEA)',
    nameHi: 'केंद्रीय विद्युत प्राधिकरण',
    descEn: 'Technical standards and national power grid planning',
    descHi: 'तकनीकी मानक एवं राष्ट्रीय विद्युत ग्रिड नियोजन',
    url: 'https://cea.nic.in',
    domain: 'cea.nic.in'
  },
  {
    nameEn: 'National Portal of India',
    nameHi: 'भारत का राष्ट्रीय पोर्टल',
    descEn: 'Single window access to GoI public services & information',
    descHi: 'भारत सरकार की सभी सार्वजनिक सेवाओं का एकल प्रवेश द्वार',
    url: 'https://www.india.gov.in',
    domain: 'india.gov.in'
  },
  {
    nameEn: 'Digital India',
    nameHi: 'डिजिटल इंडिया',
    descEn: 'Flagship programme transforming India into a digitally empowered society',
    descHi: 'भारत को डिजिटल रूप से सशक्त समाज में बदलने का प्रमुख कार्यक्रम',
    url: 'https://www.digitalindia.gov.in',
    domain: 'digitalindia.gov.in'
  },
  {
    nameEn: 'MyGov: Meri Sarkar',
    nameHi: 'माईगॉव: मेरी सरकार',
    descEn: 'Citizen engagement platform for participatory governance',
    descHi: 'सहभागी शासन हेतु नागरिक संवाद एवं विचार मंच',
    url: 'https://www.mygov.in',
    domain: 'mygov.in'
  },
  {
    nameEn: 'Mission LiFE',
    nameHi: 'मिशन लाइफ (पर्यावरण अनुकूल जीवनशैली)',
    descEn: 'Global initiative for mass action to protect the environment',
    descHi: 'पर्यावरण संरक्षण हेतु जनभागीदारी की वैश्विक पहल',
    url: 'https://missionlife-moefcc.nic.in',
    domain: 'missionlife-moefcc.nic.in'
  }
];

const OPERATING_DESKS = [
  {
    key: 'REIA',
    icon: Sun,
    color: '#f59e0b',
    targetRoute: '/reia',
  },
  {
    key: 'TRADING',
    icon: LineChart,
    color: '#3b82f6',
    targetRoute: '/trading',
  },
  {
    key: 'HYDRO',
    icon: Droplets,
    color: '#06b6d4',
    targetRoute: '/hydro-thermal',
  },
  {
    key: 'THERMAL',
    icon: Factory,
    color: '#ef4444',
    targetRoute: '/thermal',
  }
];

const FLAGSHIP_ASSETS = [
  {
    key: 'NJHPS',
    name: 'Nathpa Jhakri HPS',
    capacity: '1,500 MW',
    sub: '6 × 250 MW Francis Turbines',
    basin: 'Satluj Basin · Himachal Pradesh',
    badgeColor: '#0284c7',
    icon: Droplets,
    iconColor: '#0284c7',
    grid: 'Northern Regional Grid (NRPC)'
  },
  {
    key: 'RAMPUR',
    name: 'Rampur Hydro Station',
    capacity: '412 MW',
    sub: '6 × 68.67 MW Cascade Units',
    basin: 'Shimla & Kullu · Himachal Pradesh',
    badgeColor: '#059669',
    icon: Zap,
    iconColor: '#059669',
    grid: 'NR Grid Peaking & Balancing'
  },
  {
    key: 'BUXAR',
    name: 'Buxar Thermal Power',
    capacity: '1,320 MW',
    sub: '2 × 660 MW Supercritical',
    basin: 'Chausa, Buxar · Bihar',
    badgeColor: '#ea580c',
    icon: Factory,
    iconColor: '#ea580c',
    grid: 'Eastern Regional Grid (ERPC)'
  },
  {
    key: 'REIA_PORTFOLIO',
    name: 'REIA National Portfolio',
    capacity: '2,400+ MW',
    sub: 'Solar · Wind · Hybrid ISTS',
    basin: 'Pan-India (Rajasthan, Gujarat)',
    badgeColor: '#d97706',
    icon: Sun,
    iconColor: '#d97706',
    grid: 'National Transmission Grid (ISTS)'
  }
];

export default function PublicHome({ beta = false }) {
  const { t, lang } = useGigw();
  const { user } = useAuth() || {};
  const [assetViewMode, setAssetViewMode] = useState('MAP'); // 'MAP' | 'CARDS'
  const [bannerCircular, setBannerCircular] = useState(null);

  useEffect(() => {
    fetch('/api/circulars/banner')
      .then((res) => res.json())
      .then((data) => {
        if (data?.circular) {
          setBannerCircular(data.circular);
        }
      })
      .catch((err) => console.warn('[BANNER] Failed to load banner circular:', err));
  }, []);

  useEffect(() => {
    const prefersReducedMotion = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReducedMotion) {
      document.querySelectorAll('.reveal-fade-up').forEach((el) => el.classList.add('is-revealed'));
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-revealed');
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.08, rootMargin: '0px 0px -30px 0px' }
    );

    document.querySelectorAll('.reveal-fade-up').forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [assetViewMode]);

  const getDashboardPath = () => (user ? landingFor(user) : (beta ? '/login?desk=REIA' : '/login'));
  const desks = beta ? OPERATING_DESKS.filter((d) => d.key === 'REIA') : OPERATING_DESKS;
  const heroStats = beta ? BETA_HERO_STATS : HERO_STATS;

  useEffect(() => {
    if (!beta) return undefined;
    const prev = document.title;
    document.title = REIA_BETA_TITLE;
    return () => { document.title = prev; };
  }, [beta]);

  return (
    <PublicShell beta={beta}>
      <OfflineBanner />
      {/* Panoramic Hydroelectric Dam Hero Section with Crisp Static Background */}
      <section className={`gigw-hero-panoramic${beta ? ' gigw-hero-beta' : ''}`} aria-labelledby="panoramic-hero-title">
        {/* Static panoramic dam picture. DBIM v3 s.6.1.1 caps a banner at 500 KB:
            AVIF 197 KB, WebP 454 KB; the 3.7 MB PNG is not served. */}
        {!beta && <picture className="gigw-hero-panoramic-picture" aria-hidden="true">
          <source srcSet="/images/sjvn-hero-panoramic.avif?v=njhps" type="image/avif" />
          <img
            src="/images/sjvn-hero-panoramic.webp?v=njhps"
            alt="Panoramic aerial view of SJVN Nathpa Jhakri Dam Spillway and Hydro Power Station"
            className="gigw-hero-panoramic-img"
            width="1920"
            height="1080"
            fetchpriority="high"
            decoding="async"
          />
        </picture>}
        <div className="gigw-hero-panoramic-bg" aria-hidden="true" />

        <div className="gigw-hero-panoramic-overlay" aria-hidden="true" />
        
        {/* Hero Top Content Row */}
        <div className="gigw-hero-panoramic-content">
          <div className="gigw-hero-left">
            <div className="gigw-hero-tagline">
              <span className="gigw-tagline-bar" aria-hidden="true" />
              {beta && <span className="gigw-beta-pill">BETA</span>}
              <span>
                {beta
                  ? (lang === 'hi' ? 'स्वच्छ ऊर्जा · पारदर्शी बिलिंग · हरित भारत'
                    : lang === 'gu' ? 'સ્વચ્છ ઊર્જા · પારદર્શક બિલિંગ · હરિયાળું ભારત'
                    : lang === 'mr' ? 'स्वच्छ ऊर्जा · पारदर्शक बिलिंग · हरित भारत'
                    : 'CLEAN ENERGY · TRANSPARENT BILLING · A GREENER INDIA')
                  : lang === 'hi' 
                  ? 'स्वच्छ ऊर्जा · पारदर्शी बाज़ार · हरित भारत' 
                  : lang === 'gu'
                  ? 'સ્વચ્છ ઊર્જા · પારદર્શક બજાર · હરિયાળું ભારત'
                  : lang === 'mr'
                  ? 'स्वच्छ ऊर्जा · पारदर्शक बाजारपेठ · हरित भारत'
                  : 'CLEAN ENERGY · TRANSPARENT MARKETS · A GREENER INDIA'}
              </span>
            </div>

            <h1 id="panoramic-hero-title" className="gigw-panoramic-h1">
              {beta ? (
                lang === 'hi' ? (
                  <>
                    एसजेवीएन<br />
                    <span className="text-reia-blue">REIA</span> वाणिज्यिक<br />
                    पोर्टल <span className="gigw-beta-tag">बीटा</span>
                  </>
                ) : lang === 'gu' ? (
                  <>
                    એસજેવીએન<br />
                    <span className="text-reia-blue">REIA</span> વાણિજ્યિક<br />
                    પોર્ટલ <span className="gigw-beta-tag">બીટા</span>
                  </>
                ) : lang === 'mr' ? (
                  <>
                    एसजेव्हीएन<br />
                    <span className="text-reia-blue">REIA</span> व्यावसायिक<br />
                    पोर्टल <span className="gigw-beta-tag">बीटा</span>
                  </>
                ) : (
                  <>
                    SJVN<br />
                    <span className="text-reia-blue">REIA</span> Commercial<br />
                    Portal <span className="gigw-beta-tag">Beta</span>
                  </>
                )
              ) : lang === 'hi' ? (
                <>
                  एसजेवीएन एकीकृत<br />
                  ऊर्जा वाणिज्यिक एवं<br />
                  <span className="text-reia-blue">REIA</span> पोर्टल
                </>
              ) : lang === 'gu' ? (
                <>
                  એસજેવીએન સંકલિત<br />
                  ઊર્જા વાણિજ્યિક અને<br />
                  <span className="text-reia-blue">REIA</span> પોર્ટલ
                </>
              ) : lang === 'mr' ? (
                <>
                  एसजेव्हीएन एकात्मिक<br />
                  ऊर्जा व्यावसायिक आणि<br />
                  <span className="text-reia-blue">REIA</span> पोर्टल
                </>
              ) : (
                <>
                  SJVN Integrated<br />
                  Energy Commerce &amp;<br />
                  <span className="text-reia-blue">REIA</span> Portal
                </>
              )}
            </h1>

            <p className="gigw-panoramic-lead">
              {beta
                ? (lang === 'hi'
                  ? 'नवीकरणीय ऊर्जा कार्यान्वयन एजेंसी (REIA) के रूप में एसजेवीएन उत्पादकों से सौर एवं पवन ऊर्जा खरीदकर वितरण कंपनियों को बेचता है। अनुबंध, ऊर्जा लेखा, बिलिंग, भुगतान, विवाद एवं मिलान: सब एक पोर्टल पर। यह बीटा संस्करण आमंत्रित उपयोगकर्ताओं के परीक्षण हेतु है।'
                  : lang === 'gu'
                  ? 'પુનઃપ્રાપ્ય ઊર્જા અમલીકરણ એજન્સી (REIA) તરીકે એસજેવીએન ઉત્પાદકો પાસેથી સૌર અને પવન ઊર્જા ખરીદીને વિતરણ કંપનીઓને વેચે છે. કરાર, ઊર્જા હિસાબ, બિલિંગ, ચુકવણી, વિવાદ અને મેળવણી: બધું એક પોર્ટલ પર. આ બીટા આમંત્રિત વપરાશકર્તાઓના પરીક્ષણ માટે છે.'
                  : lang === 'mr'
                  ? 'नवीकरणीय ऊर्जा अंमलबजावणी संस्था (REIA) म्हणून एसजेव्हीएन उत्पादकांकडून सौर व पवन ऊर्जा खरेदी करून वितरण कंपन्यांना विकते. करार, ऊर्जा लेखा, बिलिंग, देयके, विवाद व जुळवणी: सर्व एकाच पोर्टलवर. ही बीटा आवृत्ती आमंत्रित वापरकर्त्यांच्या चाचणीसाठी आहे.'
                  : 'As the Renewable Energy Implementing Agency, SJVN buys solar and wind power from generators and sells it to distribution companies. Contracts, energy accounts, billing, payments, disputes and reconciliation, all on one portal. This beta is open to invited users for testing before launch.')
                : lang === 'hi'
                ? 'भारत के स्वच्छ ऊर्जा परिवर्तन को सशक्त बनाने वाला केंद्रीय उद्यम मंच। अक्षय ऊर्जा कार्यान्वयन (REIA), विद्युत बाज़ार व्यापार एवं जल-ताप वाणिज्यिक निपटान का एकीकृत राष्ट्रीय पोर्टल।'
                : lang === 'gu'
                ? 'ભારતના સ્વચ્છ ઊર્જા પરિવર્તનને સશક્ત બનાવતું કેન્દ્રીય પ્લેટફોર્મ. પુનઃપ્રાપ્ય ઊર્જા (REIA), વીજ બજાર ટ્રેડિંગ અને હાઇડ્રો-થર્મલ સેટલમેન્ટનું એકીકૃત પોર્ટલ.'
                : lang === 'mr'
                ? 'भारताच्या स्वच्छ ऊर्जा परिवर्तनाला बळ देणारे मध्यवर्ती व्यासपीठ. नवीकरणीय ऊर्जा (REIA), वीज बाजार व्यापार आणि जल-औष्णिक व्यावसायिक सेटलमेंटचे एकात्मिक पोर्टल.'
                : 'A central enterprise platform empowering India\'s clean energy transition. Unified portal for Renewable Energy Implementation (REIA), Power Market Trading, and Hydro-Thermal Commercial Settlements.'}
            </p>

            <div className="gigw-hero-btn-row">
              <Link to={user ? getDashboardPath() : '/login'} className="btn-access-portal">
                <Lock size={15} />
                <span>{user ? (lang === 'hi' ? 'कार्यक्षेत्र खोलें →' : lang === 'gu' ? 'કાર્યક્ષેત્ર ખોલો →' : lang === 'mr' ? 'कार्यक्षेत्र उघडा →' : 'Access Portal →') : (lang === 'hi' ? 'पोर्टल में प्रवेश करें →' : lang === 'gu' ? 'પોર્ટલમાં પ્રવેશો →' : lang === 'mr' ? 'पोर्टलवर प्रवेश करा →' : 'Access Portal →')}</span>
              </Link>
              {beta ? (
                <Link to="/feedback" className="btn-our-vision">
                  <Bell size={16} />
                  <span>{lang === 'hi' ? 'प्रतिक्रिया दें' : lang === 'gu' ? 'પ્રતિભાવ આપો' : lang === 'mr' ? 'अभिप्राय द्या' : 'Share Feedback'}</span>
                </Link>
              ) : (
              <button 
                type="button" 
                onClick={openVisionModal} 
                className="btn-our-vision"
                aria-haspopup="dialog"
                title={t('pub.visionTitle')}
              >
                <Target size={16} />
                <span>{lang === 'hi' ? 'हमारा विज़न (Our Vision)' : lang === 'gu' ? 'અમારું વિઝન (Vision)' : lang === 'mr' ? 'आमचे व्हिजन (Vision)' : 'Our Vision'}</span>
              </button>
              )}
            </div>
          </div>
        </div>

        {/* Docked Horizontal Metric Strip (Bottom of Hero) */}
        <div className="gigw-hero-metrics-bar">
          <div className="gigw-metrics-strip-card">
            {heroStats.map((s, idx) => {
              const Icon = s.icon;
              return (
                <div key={idx} className="metric-strip-item">
                  <div className={`metric-icon-box ${s.colorClass}`}>
                    <Icon size={20} />
                  </div>
                  <div className="metric-text-box">
                    <span className="metric-value">{s.value}</span>
                    <span className="metric-label">{s.label}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Live Power Market Ticker (IEX, PXIL, HPX Real-Time Trading Telemetry) */}
      {!beta && <LiveMarketTicker />}

      {/* Enterprise Desks Grid (The Core Operational Sign-In Gateways & Fast Persona Testing) */}
      <section id="gateways-section" className="gigw-section gigw-gateways-container" aria-labelledby="gateways-heading">
        <div className="gigw-section-header">
          <span className="gigw-section-eyebrow">
            {beta ? 'BETA ACCESS GATEWAY' : t('pub.gateways.eyebrow')}
          </span>
          <h2 id="gateways-heading" className="gigw-section-title">
            {beta ? 'Sign In to the REIA Beta' : t('pub.gateways.title')}
          </h2>
          <p className="gigw-section-sub">
            {beta ? 'Your login carries your role: generator, discom or SJVN desk. Every approval follows maker, checker and approver separation.' : t('pub.gateways.sub')}
          </p>
        </div>

        <div className={`gigw-desks-grid${beta ? ' gigw-desks-grid-beta' : ''}`}>
          {desks.map((d, i) => {
            const Icon = d.icon;
            return (
              <div 
                key={d.key} 
                className={`gigw-desk-card reveal-fade-up reveal-stagger-${i + 1}`} 
                style={{ '--card-accent': d.color }}
              >
                <div className="gigw-desk-header">
                  <div className="gigw-desk-icon-wrap">
                    <Icon size={26} color={d.color} />
                  </div>
                  <div>
                    <span className="gigw-desk-badge">{t(`pub.desk.${d.key}.badge`)}</span>
                    <h3 className="gigw-desk-title">{t(`pub.desk.${d.key}.title`)}</h3>
                    <p className="gigw-desk-sub">{t(`pub.desk.${d.key}.sub`)}</p>
                  </div>
                </div>

                <p className="gigw-desk-desc">{t(`pub.desk.${d.key}.desc`)}</p>

                <div className="gigw-desk-features">
                  <div className="gigw-desk-features-header">
                    <div className="gigw-features-title-wrap">
                      <span className="gigw-features-status-dot" style={{ backgroundColor: d.color }} aria-hidden="true" />
                      <strong className="gigw-features-title">{t('pub.caps')}</strong>
                    </div>
                    <span className="gigw-features-count-badge" aria-label="5 Core Capabilities">5</span>
                  </div>
                  <ul className="gigw-features-list">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <li key={n} className="gigw-feature-item">
                        <span className="feature-check-badge" aria-hidden="true">
                          <Check size={11} strokeWidth={2.8} />
                        </span>
                        <span className="feature-text">{t(`pub.desk.${d.key}.f${n}`)}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Main Action Button */}
                <div className="gigw-desk-actions">
                  <Link 
                    to={`/login?desk=${d.key}`}
                    className="btn btn-primary gigw-desk-primary-btn"
                  >
                    <span>{t('pub.signInTo', { desk: t(`pub.desk.${d.key}.short`) })}</span>
                    <ArrowRight size={16} />
                  </Link>
                </div>
              </div>
            );
          })}

          {beta && (
            <div className="gigw-desk-card reveal-fade-up reveal-stagger-2" style={{ '--card-accent': '#10b981' }}>
              <div className="gigw-desk-header">
                <div className="gigw-desk-icon-wrap">
                  <Sparkles size={26} color="#10b981" />
                </div>
                <div>
                  <span className="gigw-desk-badge">Pre-launch · By Invitation</span>
                  <h3 className="gigw-desk-title">Beta Testing</h3>
                  <p className="gigw-desk-sub">Help us get it right before launch</p>
                </div>
              </div>
              <p className="gigw-desk-desc">You are among the first to use the REIA portal. Use it as you would at work, and tell us what does not work, is unclear, or takes too long.</p>
              <div className="gigw-desk-features">
                <div className="gigw-desk-features-header">
                  <div className="gigw-features-title-wrap">
                    <span className="gigw-features-status-dot" style={{ backgroundColor: '#10b981' }} aria-hidden="true" />
                    <strong className="gigw-features-title">How to take part:</strong>
                  </div>
                  <span className="gigw-features-count-badge" aria-label={`${BETA_NOTES.length} steps`}>{BETA_NOTES.length}</span>
                </div>
                <ul className="gigw-features-list">
                  {BETA_NOTES.map((n) => (
                    <li key={n} className="gigw-feature-item">
                      <span className="feature-check-badge" aria-hidden="true">
                        <Check size={11} strokeWidth={2.8} />
                      </span>
                      <span className="feature-text">{n}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="gigw-desk-actions">
                <Link to="/feedback" className="btn btn-primary gigw-desk-primary-btn">
                  <span>Share Beta Feedback</span>
                  <ArrowRight size={16} />
                </Link>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Audited Clean Energy & Carbon Offset ESG Telemetry */}
      {!beta && <CleanEnergyCounter />}

      {/* National Generation Assets & Capacity Portfolio Section with GIS Map */}
      <section className="gigw-section gigw-assets-section" aria-labelledby="assets-heading">
        {!beta && <div className="gigw-section-header">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '16px' }}>
            <div>
              <span className="gigw-section-eyebrow">
                {t('pub.assets.eyebrow')}
              </span>
              <h2 id="assets-heading" className="gigw-section-title">
                {t('pub.assets.title')}
              </h2>
              <p className="gigw-section-sub">
                {t('pub.assets.sub')}
              </p>
            </div>

            {/* Asset Portfolio View Switcher */}
            <div className="assets-view-toggle" role="group" aria-label="Asset portfolio view switcher">
              <button
                type="button"
                className={`view-toggle-btn ${assetViewMode === 'MAP' ? 'active' : ''}`}
                onClick={() => setAssetViewMode('MAP')}
                title={t('pub.map.title')}
              >
                <Map size={13} />
                <span>{t('pub.map.btn')}</span>
              </button>
              <button
                type="button"
                className={`view-toggle-btn ${assetViewMode === 'CARDS' ? 'active' : ''}`}
                onClick={() => setAssetViewMode('CARDS')}
                title={t('pub.cards')}
              >
                <LayoutGrid size={13} />
                <span>{t('pub.cards')}</span>
              </button>
            </div>
          </div>
        </div>}

        {/* Interactive GIS India Asset Map */}
        {!beta && assetViewMode === 'MAP' && (
          <div className="reveal-fade-up is-revealed">
            <IndiaAssetMap />
          </div>
        )}

        {/* 4 Flagship Generation Asset Cards */}
        {!beta && <div 
          className="gigw-assets-grid"
          style={{ 
            marginTop: assetViewMode === 'MAP' ? '28px' : '8px'
          }}
        >
          {FLAGSHIP_ASSETS.map((asset, i) => {
            const Icon = asset.icon;
            return (
              <div 
                key={asset.key} 
                className={`gigw-asset-card reveal-fade-up reveal-stagger-${(i % 4) + 1}`}
              >
                <div className="gigw-asset-top">
                  <div className="gigw-asset-icon" style={{ background: `${asset.iconColor}15`, color: asset.iconColor }}>
                    <Icon size={20} />
                  </div>
                  <span className="gigw-asset-badge" style={{ color: asset.badgeColor, borderColor: `${asset.badgeColor}35` }}>
                    {t(`pub.asset.${asset.key}.badge`)}
                  </span>
                </div>
                <div className="gigw-asset-capacity">{asset.capacity}</div>
                <h3 className="gigw-asset-name">{asset.name}</h3>
                <div className="gigw-asset-sub-text">{asset.sub}</div>
                <p className="gigw-asset-desc">{t(`pub.asset.${asset.key}.desc`)}</p>
                <div className="gigw-asset-meta">
                  <span>{asset.basin}</span>
                  <span className="asset-grid-tag">{asset.grid}</span>
                </div>
              </div>
            );
          })}
        </div>}

        {/* Public Bulletin & Regulatory Transparency Bar */}
        <div className="gigw-public-bulletin-bar">
          <div className="bulletin-left">
            <span className="bulletin-tag">
              <Bell size={13} />
              <span>
                {lang === 'hi' 
                  ? 'ताज़ा सूचना' 
                  : lang === 'gu'
                  ? 'તાજી સૂચના'
                  : lang === 'mr'
                  ? 'ताजी सूचना'
                  : beta ? 'BETA NOTICE' : 'LATEST DISCLOSURE'}
              </span>
            </span>
            <span className="bulletin-text">
              {beta
                ? 'This is a pre-launch beta of the REIA Commercial Portal. Found something wrong or unclear? Tell us on the Feedback page.'
                : bannerCircular
                ? (lang === 'hi' && bannerCircular.title_hi
                    ? bannerCircular.title_hi
                    : bannerCircular.title_en)
                : (lang === 'hi'
                    ? 'निविदाएं, शुद्धिपत्र एवं नियामक प्रकटीकरण सार्वजनिक परिपत्र पृष्ठ पर उपलब्ध हैं।'
                    : 'Tenders, corrigenda and statutory disclosures are available on the Public Circulars page.')}
            </span>
          </div>
          <Link to={beta ? '/feedback' : '/circulars'} className="bulletin-link">
            <span>
              {beta ? 'Share Beta Feedback →' : lang === 'hi' 
                ? 'सभी सार्वजनिक सूचनाएँ देखें →' 
                : lang === 'gu'
                ? 'બધી જાહેર સૂચનાઓ જુઓ →'
                : lang === 'mr'
                ? 'सर्व सार्वजनिक सूचना पहा →'
                : 'View Public Circulars →'}
            </span>
          </Link>
        </div>

        {/* DBIM Annexure A.4.1.2 item iv: Sector Specific Quote of Hon'ble Prime Minister */}
        <div className="gigw-pm-quote-section reveal-fade-up">
          <div className="gigw-pm-quote-card" role="region" aria-labelledby="pm-quote-heading">
            <div className="gigw-pm-quote-header">
              <span id="pm-quote-heading" className="gigw-pm-quote-badge">
                <Quote size={13} style={{ transform: 'rotate(180deg)' }} aria-hidden="true" />
                <span>{t('pub.quote.eyebrow')}</span>
              </span>
              <span className="gigw-pm-quote-context-pill">
                {t('pub.quote.context')}
              </span>
            </div>

            <div className="gigw-pm-quote-body">
              <Quote size={34} color="#d97706" style={{ flexShrink: 0, opacity: 0.35, marginTop: -4 }} aria-hidden="true" />
              <blockquote>
                “{t('pub.quote.text')}”
              </blockquote>
            </div>

            <div className="gigw-pm-quote-author-row">
              <div className="gigw-pm-author-info">
                <div className="gigw-pm-author-avatar">
                  <img 
                    src="/images/pm-narendra-modi.jpg" 
                    alt={t('pub.quote.author')}
                    className="gigw-pm-photo-img"
                    width="58"
                    height="58"
                    loading="lazy"
                  />
                </div>
                <div className="gigw-pm-author-details">
                  <span className="gigw-pm-author-name">{t('pub.quote.author')}</span>
                  <span className="gigw-pm-author-desig">{t('pub.quote.designation')}</span>
                </div>
              </div>
              <a 
                href="https://www.pmindia.gov.in" 
                target="_blank" 
                rel="noopener noreferrer" 
                className="gigw-pm-quote-source-tag"
                aria-label="Prime Minister's Office Portal pmindia.gov.in (opens in a new tab)"
              >
                <span>pmindia.gov.in</span>
                <ExternalLink size={12} aria-hidden="true" />
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            </div>
          </div>
        </div>

        {/* 4 Compliance & Trust Pillars */}
        <div className="gigw-compliance-pillars">
          <div className="pillar-item">
            <ShieldCheck size={22} color="#10b981" />
            <div>
              <strong>GIGW 3.0 &amp; UX4G aligned</strong>
              <span>Built to GoI web-guideline and accessibility norms</span>
            </div>
          </div>
          <div className="pillar-item">
            <Lock size={22} color="#3b82f6" />
            <div>
              <strong>DPDP Act 2023</strong>
              <span>Statutory digital personal data protection</span>
            </div>
          </div>
          <div className="pillar-item">
            <Scale size={22} color="#8b5cf6" />
            <div>
              <strong>CERC &amp; CVC Norms</strong>
              <span>Four-eyes validation &amp; tamper-proof trails</span>
            </div>
          </div>
          <div className="pillar-item">
            <Globe size={22} color="#f59e0b" />
            <div>
              <strong>WCAG 2.1 AA (target)</strong>
              <span>Screen-reader support, high contrast, multilingual</span>
            </div>
          </div>
        </div>

        {/* DBIM Annexure A.4.1.2 item xiv: National Initiatives & Government Portals */}
        <section className="gigw-initiatives-section" aria-labelledby="initiatives-title">
          <div className="gigw-initiatives-header">
            <div className="gigw-initiatives-eyebrow">
              <Landmark size={12} aria-hidden="true" />
              <span>{t('pub.initiatives.eyebrow')}</span>
            </div>
            <h2 id="initiatives-title" className="gigw-initiatives-title">
              {t('pub.initiatives.title')}
            </h2>
            <p className="gigw-initiatives-sub">
              {t('pub.initiatives.sub')}
            </p>
          </div>

          <div className="gigw-initiatives-grid">
            {NATIONAL_INITIATIVES.map((item) => (
              <a
                key={item.domain}
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                className="gigw-initiative-card"
                aria-label={`${lang === 'hi' ? item.nameHi : item.nameEn} - ${item.domain} (opens in a new tab)`}
              >
                <div>
                  <div className="gigw-initiative-title">
                    {lang === 'hi' ? item.nameHi : item.nameEn}
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4, lineHeight: 1.4 }}>
                    {lang === 'hi' ? item.descHi : item.descEn}
                  </div>
                </div>
                <div className="gigw-initiative-domain">
                  <span>{item.domain}</span>
                  <ExternalLink size={12} aria-hidden="true" />
                  <span className="sr-only"> (opens in a new tab)</span>
                </div>
              </a>
            ))}
          </div>
        </section>
      </section>
    </PublicShell>
  );
}
