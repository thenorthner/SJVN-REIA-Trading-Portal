import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  FileSignature, Gauge, ReceiptIndianRupee, Wallet, Scale, ShieldCheck,
  ClipboardCheck, Users, ArrowRight, Sun, Wind,
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

const STEPS = [
  { icon: Users, title: 'Onboard', text: 'Generators and discoms are registered with PAN, GST, bank and regulatory clearances checked before they can trade.' },
  { icon: FileSignature, title: 'Contract', text: 'Each PPA with a generator is mapped to its PSA with the discom: capacity, tariff, tenure and the SJVN margin.' },
  { icon: Gauge, title: 'Energy account', text: 'Monthly energy from REA and meter data is uploaded, validated and locked before any bill is raised.' },
  { icon: ReceiptIndianRupee, title: 'Bill', text: 'Bills are prepared by the maker, scrutinised by the checker and sanctioned by the approver.' },
  { icon: Wallet, title: 'Pay & settle', text: 'Payments, rebates, late payment surcharge, TDS and payment security are tracked against every bill.' },
  { icon: Scale, title: 'Reconcile', text: 'Disputes are raised and resolved on record; balances are confirmed with each counterparty.' },
];

const FOR_WHOM = [
  { title: 'RE generators', text: 'See your contracts, energy accounts, bills raised and payments received, and raise a query when something does not match.' },
  { title: 'Discoms', text: 'Review and accept bills, track what is due and when, and confirm balances, with your own maker and checker.' },
  { title: 'SJVN REIA desk', text: 'Run the monthly cycle end to end with maker, checker and approver controls and a full audit trail.' },
];

export default function ReiaBetaHome() {
  const { user } = useAuth() || {};
  const portalLink = user ? landingFor(user, null) : '/login?desk=REIA';

  useEffect(() => {
    const prev = document.title;
    document.title = REIA_BETA_TITLE;
    return () => { document.title = prev; };
  }, []);

  return (
    <div className="rb-root">
      <GovStrip withSkip />
      <header className="rb-header">
        <div className="rb-brand">
          <img src="/sjvn-logo.png" alt="SJVN Limited" className="rb-logo" />
          <div>
            <div className="rb-brand-name">SJVN Limited</div>
            <div className="rb-brand-sub">REIA Commercial Portal</div>
          </div>
        </div>
        <div className="rb-header-actions">
          <ThemeToggle />
          <Link to={portalLink} className="rb-btn rb-btn-primary">{user ? 'Open portal' : 'Sign in'}</Link>
        </div>
      </header>

      <main id="main-content" tabIndex={-1}>
        <section className="rb-hero" aria-labelledby="rb-hero-title">
          <div className="rb-hero-inner">
            <span className="rb-pill">Beta · by invitation</span>
            <h1 id="rb-hero-title">Renewable Energy Implementing Agency Portal</h1>
            <p className="rb-lead">
              SJVN buys renewable power from solar and wind generators and sells it on to
              distribution companies. This portal runs that business in one place: from the
              contract to the bill to the last rupee settled.
            </p>
            <div className="rb-hero-actions">
              <Link to={portalLink} className="rb-btn rb-btn-primary rb-btn-lg">
                {user ? 'Open portal' : 'Sign in to the portal'} <ArrowRight size={18} aria-hidden="true" />
              </Link>
              <a href="#how" className="rb-btn rb-btn-ghost rb-btn-lg">How it works</a>
            </div>
            <div className="rb-hero-tags" aria-hidden="true">
              <span><Sun size={16} /> Solar</span>
              <span><Wind size={16} /> Wind</span>
              <span><ShieldCheck size={16} /> Maker · Checker · Approver</span>
            </div>
          </div>
        </section>

        <section id="how" className="rb-section" aria-labelledby="rb-how-title">
          <h2 id="rb-how-title">What the portal does</h2>
          <p className="rb-section-sub">Every month, the same six steps, each one recorded and checked.</p>
          <ol className="rb-steps">
            {STEPS.map((s, i) => (
              <li key={s.title} className="rb-card">
                <div className="rb-card-head">
                  <span className="rb-step-no">{i + 1}</span>
                  <s.icon size={22} aria-hidden="true" />
                </div>
                <h3>{s.title}</h3>
                <p>{s.text}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="rb-section" aria-labelledby="rb-who-title">
          <h2 id="rb-who-title">Who it is for</h2>
          <div className="rb-who">
            {FOR_WHOM.map((w) => (
              <div key={w.title} className="rb-card">
                <h3>{w.title}</h3>
                <p>{w.text}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="rb-section rb-beta" aria-labelledby="rb-beta-title">
          <ClipboardCheck size={28} aria-hidden="true" />
          <div>
            <h2 id="rb-beta-title">About this beta</h2>
            <p>
              You have been given a login to try the portal before it goes live. Data here is for
              testing. If something looks wrong, is unclear or does not work, please tell the SJVN
              REIA team: your feedback decides what is fixed before launch.
            </p>
          </div>
        </section>
      </main>

      <GigwFooter compact />
    </div>
  );
}
