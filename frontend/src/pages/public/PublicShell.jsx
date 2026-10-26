import React, { useEffect, useState } from 'react';
import { Link, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { Search, UserRound, Target } from 'lucide-react';
import { NAV_LINKS } from '../../gigw/policyContent.js';
import ExternalLinkNotice from '../../gigw/ExternalLinkNotice.jsx';
import GovStrip, { focusMain } from '../../gigw/GovStrip.jsx';
import GigwFooter from '../../gigw/GigwFooter.jsx';
import { useGigw } from '../../gigw/GigwContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { landingFor } from '../Login.jsx';
import ThemeToggle from '../../components/ThemeToggle.jsx';
import VisionModal, { VISION_OPEN_EVENT } from '../../components/VisionModal.jsx';
import { openPortalSearch } from '../../components/PortalSearchModal.jsx';
import AudioSpeechWidget, { AUDIO_SPEECH_TOGGLE_EVENT } from '../../components/AudioSpeechWidget.jsx';
import { openKeyboardShortcuts } from '../../components/KeyboardShortcutsModal.jsx';
import BackToTopProgress from '../../components/BackToTopProgress.jsx';

/**
 * PublicShell — frame for the public portal pages, laid out as DBIM v3 s.5.4.3
 * "Header 3" (a PSU, which does not carry the State Emblem): the identity strip
 * and user controls, logo lockup 3B (logo, name, tagline), a highlighted search
 * bar, a profile / sign-in control, and the global navigation menu below.
 */
export default function PublicShell({ title, children }) {
  const { t, lang, toggleLang, textSize, setTextSize, toggleContrast } = useGigw();
  const { user } = useAuth() || {};
  const [audioOpen, setAudioOpen] = useState(false);
  const location = useLocation();
  const [visionOpen, setVisionOpen] = useState(() => {
    return window.location.search.includes('vision') || window.location.hash === '#vision';
  });
  const navigate = useNavigate();

  useEffect(() => {
    if (location.search.includes('vision') || location.hash === '#vision') {
      setVisionOpen(true);
    }
  }, [location.search, location.hash]);

  useEffect(() => {
    const handleOpenVision = () => setVisionOpen(true);
    const handleToggleAudio = () => setAudioOpen((prev) => !prev);

    window.addEventListener(VISION_OPEN_EVENT, handleOpenVision);
    window.addEventListener(AUDIO_SPEECH_TOGGLE_EVENT, handleToggleAudio);

    // Global keyboard shortcuts (Alt+U, Alt+A, Alt+C, Alt+L, Alt+1/Alt+S)
    function handleKeyDown(e) {
      const activeTag = document.activeElement ? document.activeElement.tagName.toLowerCase() : '';
      const isInput = ['input', 'textarea', 'select'].includes(activeTag) || document.activeElement?.isContentEditable;

      // Alt+U for UX4G text-to-speech audio reader
      if (e.altKey && e.key.toLowerCase() === 'u') {
        e.preventDefault();
        setAudioOpen((prev) => !prev);
        return;
      }

      // Alt+A for cycling font size
      if (e.altKey && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        const nextSize = textSize === 'md' ? 'lg' : textSize === 'lg' ? 'sm' : 'md';
        setTextSize(nextSize);
        return;
      }

      // Alt+C for toggling contrast mode
      if (e.altKey && e.key.toLowerCase() === 'c') {
        e.preventDefault();
        toggleContrast();
        return;
      }

      // Alt+L for toggling language
      if (e.altKey && e.key.toLowerCase() === 'l') {
        e.preventDefault();
        toggleLang();
        return;
      }

      // Alt+1 or Alt+S for skip to main content
      if (e.altKey && (e.key === '1' || e.key.toLowerCase() === 's')) {
        e.preventDefault();
        focusMain();
        return;
      }
    }
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener(VISION_OPEN_EVENT, handleOpenVision);
      window.removeEventListener(AUDIO_SPEECH_TOGGLE_EVENT, handleToggleAudio);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [textSize, setTextSize, toggleContrast, toggleLang]);

  useEffect(() => {
    document.title = title ? `${title} | ${t('org.name')}` : `${t('org.name')} | ${t('portal.name')}`;
  }, [title, t]);

  const getDashboardPath = () => (user ? landingFor(user) : '/login');
  const [q, setQ] = useState('');
  const submitSearch = (e) => { e.preventDefault(); openPortalSearch(q); setQ(''); };

  return (
    <div className="gigw-public">
      <header className="gigw-public-header" role="banner">
        <GovStrip withSkip />
        <div className="gigw-masthead">
          <Link to="/" className="gigw-masthead-brand" aria-label={`${t('org.name')} — ${t('page.home')}`}>
            <img src="/sjvn-logo.png" alt="SJVN Limited logo" width="56" height="56" />
            <span className="gigw-masthead-text">
              <strong>{t('org.name')}</strong>
              <span>{t('org.tagline1')}</span>
              <span>{t('org.tagline2')}</span>
            </span>
          </Link>

          <form className="gigw-header-search" role="search" onSubmit={submitSearch}>
            <label htmlFor="gigw-header-q" className="sr-only">{t('search.placeholder')}</label>
            <input
              id="gigw-header-q"
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t('search.placeholder')}
              autoComplete="off"
            />
            <button type="submit" title={t('search.label')}>
              <Search size={18} aria-hidden="true" />
              <span className="sr-only">{t('search.label')}</span>
            </button>
          </form>

          <div className="gigw-masthead-nav">
            <button
              type="button"
              className="gigw-header-vision-btn"
              onClick={() => setVisionOpen(true)}
              title={t('pub.shell.visionTitle')}
            >
              <Target size={16} aria-hidden="true" />
              <span>{t('pub.shell.vision')}</span>
            </button>
            <ThemeToggle />
            <Link to={getDashboardPath()} className="btn btn-primary gigw-header-signin-btn">
              <UserRound size={16} aria-hidden="true" />
              <span>{user ? t('pub.shell.dashboard') : t('pub.shell.signIn')}</span>
            </Link>
          </div>
        </div>
        <nav className="gigw-global-nav" aria-label={t('nav.global')}>
          <ul>
            {NAV_LINKS.map((l) => (
              <li key={l.to}>
                <NavLink to={l.to} end={l.to === '/'}>{t(l.key)}</NavLink>
              </li>
            ))}
          </ul>
        </nav>
      </header>

      <main id="main-content" className="gigw-public-main" tabIndex={-1}>
        {children}
      </main>
      <GigwFooter />
      <VisionModal open={visionOpen} onClose={() => setVisionOpen(false)} />
      <AudioSpeechWidget open={audioOpen} onClose={() => setAudioOpen(false)} />
      <BackToTopProgress />
      <ExternalLinkNotice />
    </div>
  );
}
