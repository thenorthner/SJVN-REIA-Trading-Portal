import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  FileSignature, Gauge, ReceiptIndianRupee, Wallet, Scale, ShieldCheck,
  Users, ArrowRight, Sun, Wind, Building2, Factory, CheckCircle2,
  Fingerprint, History, Landmark, MessageSquareText, Menu, X,
} from 'lucide-react';
import GovStrip from '../../gigw/GovStrip.jsx';
import GigwFooter from '../../gigw/GigwFooter.jsx';
import ThemeToggle from '../../components/ThemeToggle.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { landingFor } from '../Login.jsx';
import { REIA_BETA_TITLE } from '../../reiaBeta.js';
import './ReiaBetaHome.css';

// The REIA beta's public home. Beta testers see the REIA desk and nothing else:
// no other desk, market or station is named here.

const NAV = [
  { href: '#rb-model', label: 'How REIA works' },
  { href: '#rb-cycle', label: 'Monthly cycle' },
  { href: '#rb-controls', label: 'Controls' },
  { href: '#rb-who', label: 'Who it is for' },
];

const CYCLE = [
  { icon: Users, title: 'Onboard', text: 'Generators and discoms are registered once, with PAN, GST, bank and regulatory clearances verified.' },
  { icon: FileSignature, title: 'Contract', text: 'Each PPA is mapped to its PSA: capacity, tariff, tenure and the SJVN margin.' },
  { icon: Gauge, title: 'Energy account', text: 'Monthly energy from REA and meter data is uploaded, validated and locked.' },
  { icon: ReceiptIndianRupee, title: 'Bill', text: 'Bills on both legs are prepared, scrutinised and sanctioned before they go out.' },
  { icon: Wallet, title: 'Pay & settle', text: 'Payments, rebates, surcharge, TDS and payment security are tracked bill by bill.' },
  { icon: Scale, title: 'Reconcile', text: 'Disputes are resolved on record and balances confirmed with every counterparty.' },
];

const CONTROLS = [
  { icon: ShieldCheck, title: 'Maker, checker, approver', text: 'No one person prepares and approves the same bill. Every decision carries a name and a time.' },
  { icon: Fingerprint, title: 'Verified counterparties', text: 'KYC, bank account and clearances are checked before a company can be billed or paid.' },
  { icon: History, title: 'Complete audit trail', text: 'Every change to a contract, energy figure or bill is kept, with who made it and why.' },
  { icon: Landmark, title: 'Payment security', text: 'Letters of credit and guarantees are tracked against what each discom owes.' },
];

const WHO = [
  {
    icon: Factory, title: 'RE generators',
    points: ['See your contracts and energy accounts', 'Track bills raised and payments received', 'Raise a query when figures do not match'],
  },
  {
    icon: Building2, title: 'Discoms',
    points: ['Review and accept bills online', 'See what is due, and when', 'Confirm balances with your own maker and checker'],
  },
  {
    icon: ShieldCheck, title: 'SJVN REIA desk',
    points: ['Run the monthly cycle end to end', 'Approve with clear separation of duties', 'Report on margin, dues and collections'],
  },
];

export default function ReiaBetaHome() {
  const { user } = useAuth() || {};
  const portalLink = user ? landingFor(user, null) : '/login?desk=REIA';
  const portalLabel = user ? 'Open portal' : 'Sign in';
  const scroller = useRef(null);
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const prev = document.title;
    document.title = REIA_BETA_TITLE;
    return () => { document.title = prev; };
  }, []);

  // The app shell locks the window, so this page scrolls in its own box.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return undefined;
    const onScroll = () => setScrolled(el.scrollTop > 8);
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  function jump(e, href) {
    e.preventDefault();
    setMenuOpen(false);
    const target = document.querySelector(href);
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    target.focus({ preventScroll: true });
  }

  return (
    <div className="rb-root" ref={scroller}>
      <GovStrip withSkip />

      <header className={`rb-header${scrolled ? ' is-scrolled' : ''}`}>
        <div className="rb-wrap rb-header-inner">
          <Link to="/reia-beta" className="rb-brand" aria-label="SJVN REIA Commercial Portal, home">
            <span className="rb-logo-tile"><img src="/sjvn-logo.png" alt="" /></span>
            <span>
              <span className="rb-brand-name">SJVN Limited</span>
              <span className="rb-brand-sub">REIA Commercial Portal</span>
            </span>
          </Link>
          <nav className={`rb-nav${menuOpen ? ' is-open' : ''}`} aria-label="Page sections">
            {NAV.map((n) => <a key={n.href} href={n.href} onClick={(e) => jump(e, n.href)}>{n.label}</a>)}
          </nav>
          <div className="rb-header-actions">
            <ThemeToggle />
            <Link to={portalLink} className="rb-btn rb-btn-primary">{portalLabel}</Link>
            <button
              type="button"
              className="rb-menu-btn"
              aria-label={menuOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((v) => !v)}
            >
              {menuOpen ? <X size={22} /> : <Menu size={22} />}
            </button>
          </div>
        </div>
      </header>

      <main id="main-content" tabIndex={-1}>
        {/* Hero */}
        <section className="rb-hero" aria-labelledby="rb-hero-title">
          <div className="rb-hero-glow" aria-hidden="true" />
          <div className="rb-wrap rb-hero-grid">
            <div className="rb-hero-copy">
              <span className="rb-eyebrow"><span className="rb-dot" /> Beta · by invitation</span>
              <h1 id="rb-hero-title">
                Renewable power,<br />
                <span className="rb-grad-text">billed and settled in one place.</span>
              </h1>
              <p className="rb-lead">
                As a Renewable Energy Implementing Agency, SJVN buys solar and wind power from
                generators and sells it to distribution companies. This portal runs that business,
                from the contract to the last rupee settled.
              </p>
              <div className="rb-hero-actions">
                <Link to={portalLink} className="rb-btn rb-btn-light rb-btn-lg">
                  {user ? 'Open the portal' : 'Sign in to the portal'} <ArrowRight size={18} aria-hidden="true" />
                </Link>
                <a href="#rb-model" className="rb-btn rb-btn-outline rb-btn-lg" onClick={(e) => jump(e, '#rb-model')}>
                  How it works
                </a>
              </div>
              <ul className="rb-hero-points">
                <li><CheckCircle2 size={18} aria-hidden="true" /> Back-to-back PPA and PSA</li>
                <li><CheckCircle2 size={18} aria-hidden="true" /> Three-level approval</li>
                <li><CheckCircle2 size={18} aria-hidden="true" /> Full audit trail</li>
              </ul>
            </div>

            {/* The REIA model at a glance: generator → SJVN → discom */}
            <div className="rb-flow-card" aria-hidden="true">
              <div className="rb-flow-head">
                <span>Power and money, both ways</span>
                <span className="rb-live"><span className="rb-dot" /> Monthly cycle</span>
              </div>
              <div className="rb-flow">
                <div className="rb-node">
                  <div className="rb-node-icons"><Sun size={22} /><Wind size={22} /></div>
                  <strong>RE generator</strong>
                  <small>Solar · Wind</small>
                </div>
                <div className="rb-link"><span>PPA</span><i /></div>
                <div className="rb-node rb-node-hub">
                  <div className="rb-hub-logo"><img src="/sjvn-logo.png" alt="" /></div>
                  <strong>SJVN</strong>
                  <small>REIA</small>
                </div>
                <div className="rb-link"><span>PSA</span><i /></div>
                <div className="rb-node">
                  <div className="rb-node-icons"><Building2 size={22} /></div>
                  <strong>Discom</strong>
                  <small>Buyer</small>
                </div>
              </div>
              <div className="rb-flow-legs">
                <div><span className="rb-leg rb-leg-a" />Energy flows to the discom</div>
                <div><span className="rb-leg rb-leg-b" />Payment flows back to the generator</div>
              </div>
              <div className="rb-flow-steps">
                {['Energy locked', 'Bill sanctioned', 'Payment received', 'Balance confirmed'].map((s, i) => (
                  <div key={s} className="rb-mini">
                    <span className="rb-mini-no">{i + 1}</span>{s}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* The model */}
        <section id="rb-model" className="rb-section" tabIndex={-1} aria-labelledby="rb-model-title">
          <div className="rb-wrap rb-model">
            <div>
              <span className="rb-kicker">How REIA works</span>
              <h2 id="rb-model-title">One contract in, one contract out</h2>
              <p className="rb-section-lead">
                Every power purchase agreement with a generator is matched by a power sale agreement
                with a discom on the same terms. SJVN stands in the middle: it pays the generator,
                bills the discom, and keeps a small, regulated margin for doing so.
              </p>
            </div>
            <div className="rb-model-cards">
              <div className="rb-model-card">
                <span className="rb-pill rb-pill-a">PPA</span>
                <h3>Power Purchase Agreement</h3>
                <p>SJVN buys power from the generator at the tariff discovered in the auction, for the full tenure.</p>
              </div>
              <div className="rb-model-card">
                <span className="rb-pill rb-pill-b">PSA</span>
                <h3>Power Sale Agreement</h3>
                <p>SJVN sells the same power to the discom at that tariff plus the SJVN margin, back to back.</p>
              </div>
            </div>
          </div>
        </section>

        {/* Monthly cycle */}
        <section id="rb-cycle" className="rb-section rb-section-tint" tabIndex={-1} aria-labelledby="rb-cycle-title">
          <div className="rb-wrap">
            <div className="rb-section-head">
              <span className="rb-kicker">Monthly cycle</span>
              <h2 id="rb-cycle-title">Six steps, every month, each one checked</h2>
            </div>
            <ol className="rb-cycle">
              {CYCLE.map((s, i) => (
                <li key={s.title} className="rb-cycle-item">
                  <div className="rb-cycle-icon"><s.icon size={24} aria-hidden="true" /></div>
                  <span className="rb-cycle-no">Step {i + 1}</span>
                  <h3>{s.title}</h3>
                  <p>{s.text}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Controls */}
        <section id="rb-controls" className="rb-section" tabIndex={-1} aria-labelledby="rb-controls-title">
          <div className="rb-wrap">
            <div className="rb-section-head">
              <span className="rb-kicker">Controls</span>
              <h2 id="rb-controls-title">Built for public money</h2>
              <p className="rb-section-lead">The checks a CPSE needs are part of the workflow, not an afterthought.</p>
            </div>
            <div className="rb-controls">
              {CONTROLS.map((c) => (
                <div key={c.title} className="rb-control">
                  <div className="rb-control-icon"><c.icon size={24} aria-hidden="true" /></div>
                  <div>
                    <h3>{c.title}</h3>
                    <p>{c.text}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Who */}
        <section id="rb-who" className="rb-section rb-section-tint" tabIndex={-1} aria-labelledby="rb-who-title">
          <div className="rb-wrap">
            <div className="rb-section-head">
              <span className="rb-kicker">Who it is for</span>
              <h2 id="rb-who-title">One portal, three sides of the bill</h2>
            </div>
            <div className="rb-who">
              {WHO.map((w) => (
                <div key={w.title} className="rb-who-card">
                  <div className="rb-who-icon"><w.icon size={26} aria-hidden="true" /></div>
                  <h3>{w.title}</h3>
                  <ul>
                    {w.points.map((p) => <li key={p}><CheckCircle2 size={17} aria-hidden="true" />{p}</li>)}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Beta */}
        <section className="rb-section" aria-labelledby="rb-beta-title">
          <div className="rb-wrap">
            <div className="rb-beta">
              <div className="rb-beta-icon"><MessageSquareText size={30} aria-hidden="true" /></div>
              <div className="rb-beta-copy">
                <h2 id="rb-beta-title">You are part of the beta</h2>
                <p>
                  You have been given a login to try the portal before it goes live. The data is for
                  testing. If something looks wrong, is unclear or does not work, tell the SJVN REIA
                  team: your feedback decides what is fixed before launch.
                </p>
              </div>
              <Link to={portalLink} className="rb-btn rb-btn-light rb-btn-lg">
                {portalLabel} <ArrowRight size={18} aria-hidden="true" />
              </Link>
            </div>
          </div>
        </section>
      </main>

      <GigwFooter compact />
    </div>
  );
}
