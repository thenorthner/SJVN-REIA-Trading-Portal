import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { 
  Sun, LineChart, Droplets, Factory, ShieldCheck, Zap, 
  ArrowRight, CheckCircle2, ChevronRight, Lock, Building2, 
  Users, FileText, BarChart3, Scale, Award, Globe, 
  ExternalLink, HelpCircle, AlertCircle, FileCheck, Landmark, Check,
  Layers, TrendingUp, Sparkles, Leaf, Bell, Target,
  Map, LayoutGrid
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

/**
 * SJVN Integrated Energy Commerce & REIA Public Portal
 * Matches the official sovereign design layout.
 * Fully compliant with GoI GIGW 3.0, UX4G, and DPDP Act 2023.
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
    value: '2', 
    label: 'Power Exchanges Integrated (IEX, PXIL)', 
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

export default function PublicHome() {
  const { t, lang } = useGigw();
  const { user } = useAuth() || {};
  const [assetViewMode, setAssetViewMode] = useState('MAP'); // 'MAP' | 'CARDS'
  const videoRef = useRef(null);

  useEffect(() => {
    const prefersReducedMotion = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReducedMotion) {
      document.querySelectorAll('.reveal-fade-up').forEach((el) => el.classList.add('is-revealed'));
      if (videoRef.current) {
        videoRef.current.pause();
      }
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

  const getDashboardPath = () => (user ? landingFor(user) : '/login');

  return (
    <PublicShell>
      <OfflineBanner />
      {/* Panoramic Hydroelectric Dam Hero Section with Ambient Motion & Fallback */}
      <section className="gigw-hero-panoramic" aria-labelledby="panoramic-hero-title">
        {/* Ambient video background loop with static AVIF/WebP/PNG fallback */}
        <div className="gigw-hero-video-wrapper" aria-hidden="true">
          <video
            ref={videoRef}
            className="gigw-hero-video"
            autoPlay
            loop
            muted
            playsInline
            width="1920"
            height="1080"
            poster="/images/sjvn-hero-panoramic.avif"
          >
            <source src="/images/sjvn-hero-panoramic.mp4" type="video/mp4" />
          </video>
          <picture className="gigw-hero-panoramic-picture">
            <source srcSet="/images/sjvn-hero-panoramic.avif" type="image/avif" />
            <source srcSet="/images/sjvn-hero-panoramic.webp" type="image/webp" />
            <img
              src="/images/sjvn-hero-panoramic.png"
              alt="Panoramic aerial view of SJVN Nathpa Jhakri Dam Spillway and Hydro Power Station"
              className="gigw-hero-panoramic-img"
              width="1920"
              height="1080"
              fetchpriority="high"
              decoding="async"
            />
          </picture>
          <div className="gigw-hero-panoramic-bg" aria-hidden="true" />
        </div>

        <div className="gigw-hero-panoramic-overlay" aria-hidden="true" />
        
        {/* Hero Top Content Row */}
        <div className="gigw-hero-panoramic-content reveal-fade-up is-revealed">
          <div className="gigw-hero-left">
            <div className="gigw-hero-tagline">
              <span className="gigw-tagline-bar" aria-hidden="true" />
              <span>
                {lang === 'hi' 
                  ? 'स्वच्छ ऊर्जा · पारदर्शी बाज़ार · हरित भारत' 
                  : lang === 'gu'
                  ? 'સ્વચ્છ ઊર્જા · પારદર્શક બજાર · હરિયાળું ભારત'
                  : lang === 'mr'
                  ? 'स्वच्छ ऊर्जा · पारदर्शक बाजारपेठ · हरित भारत'
                  : 'CLEAN ENERGY · TRANSPARENT MARKETS · A GREENER INDIA'}
              </span>
            </div>

            <h1 id="panoramic-hero-title" className="gigw-panoramic-h1">
              {lang === 'hi' ? (
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
              {lang === 'hi'
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
            </div>
          </div>
        </div>

        {/* Docked Horizontal Metric Strip (Bottom of Hero) */}
        <div className="gigw-hero-metrics-bar">
          <div className="gigw-metrics-strip-card">
            {HERO_STATS.map((s, idx) => {
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
      <LiveMarketTicker />

      {/* Enterprise Desks Grid (The Core Operational Sign-In Gateways & Fast Persona Testing) */}
      <section id="gateways-section" className="gigw-section gigw-gateways-container" aria-labelledby="gateways-heading">
        <div className="gigw-section-header">
          <span className="gigw-section-eyebrow">
            {t('pub.gateways.eyebrow')}
          </span>
          <h2 id="gateways-heading" className="gigw-section-title">
            {t('pub.gateways.title')}
          </h2>
          <p className="gigw-section-sub">
            {t('pub.gateways.sub')}
          </p>
        </div>

        <div className="gigw-desks-grid">
          {OPERATING_DESKS.map((d, i) => {
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
                  <strong>{t('pub.caps')}</strong>
                  <ul>
                    {[1, 2, 3, 4, 5].map((n) => (
                      <li key={n}>
                        <Check size={14} className="feature-check" />
                        <span>{t(`pub.desk.${d.key}.f${n}`)}</span>
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
        </div>
      </section>

      {/* Audited Clean Energy & Carbon Offset ESG Telemetry */}
      <CleanEnergyCounter />

      {/* National Generation Assets & Capacity Portfolio Section with GIS Map */}
      <section className="gigw-section gigw-assets-section" aria-labelledby="assets-heading">
        <div className="gigw-section-header">
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
        </div>

        {/* Interactive GIS India Asset Map */}
        {assetViewMode === 'MAP' && (
          <div className="reveal-fade-up is-revealed">
            <IndiaAssetMap />
          </div>
        )}

        {/* 4 Flagship Generation Asset Cards */}
        <div 
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
      </section>
    </PublicShell>
  );
}
