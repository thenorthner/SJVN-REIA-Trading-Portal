import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { Search, Lock, Target } from 'lucide-react';
import GovStrip, { focusMain } from '../../gigw/GovStrip.jsx';
import GigwFooter from '../../gigw/GigwFooter.jsx';
import { useGigw } from '../../gigw/GigwContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { landingFor } from '../Login.jsx';
import ThemeToggle from '../../components/ThemeToggle.jsx';
import VisionModal, { VISION_OPEN_EVENT } from '../../components/VisionModal.jsx';
import PortalSearchModal, { SEARCH_OPEN_EVENT } from '../../components/PortalSearchModal.jsx';
import AudioSpeechWidget, { AUDIO_SPEECH_TOGGLE_EVENT } from '../../components/AudioSpeechWidget.jsx';
import KeyboardShortcutsModal, { SHORTCUTS_OPEN_EVENT } from '../../components/KeyboardShortcutsModal.jsx';
import BackToTopProgress from '../../components/BackToTopProgress.jsx';

/**
 * PublicShell — Frame for public portal pages
 * Compliant with GIGW 3.0, UX4G, and matches the official SJVN Portal masthead.
 */
export default function PublicShell({ title, children }) {
  const { t, lang, toggleLang, textSize, setTextSize, toggleContrast } = useGigw();
  const { user } = useAuth() || {};
  const [searchOpen, setSearchOpen] = useState(false);
  const [audioOpen, setAudioOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
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
    const handleOpenSearch = () => setSearchOpen(true);
    const handleToggleAudio = () => setAudioOpen((prev) => !prev);
    const handleOpenShortcuts = () => setShortcutsOpen(true);

    window.addEventListener(VISION_OPEN_EVENT, handleOpenVision);
    window.addEventListener(SEARCH_OPEN_EVENT, handleOpenSearch);
    window.addEventListener(AUDIO_SPEECH_TOGGLE_EVENT, handleToggleAudio);
    window.addEventListener(SHORTCUTS_OPEN_EVENT, handleOpenShortcuts);

    // Global keyboard shortcuts (Cmd+K, ?, Alt+U, Alt+A, Alt+C, Alt+L, Alt+1/Alt+S)
    function handleKeyDown(e) {
      const activeTag = document.activeElement ? document.activeElement.tagName.toLowerCase() : '';
      const isInput = ['input', 'textarea', 'select'].includes(activeTag) || document.activeElement?.isContentEditable;

      // Cmd+K / Ctrl+K
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen((prev) => !prev);
        return;
      }

      // ? key opens shortcuts cheat sheet (only when user is not typing in an input)
      if (!isInput && (e.key === '?' || (e.code === 'Slash' && e.shiftKey))) {
        e.preventDefault();
        setShortcutsOpen((prev) => !prev);
        return;
      }

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
      window.removeEventListener(SEARCH_OPEN_EVENT, handleOpenSearch);
      window.removeEventListener(AUDIO_SPEECH_TOGGLE_EVENT, handleToggleAudio);
      window.removeEventListener(SHORTCUTS_OPEN_EVENT, handleOpenShortcuts);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [textSize, setTextSize, toggleContrast, toggleLang]);

  useEffect(() => {
    document.title = title ? `${title} | ${t('org.name')}` : `${t('org.name')} | ${t('portal.name')}`;
  }, [title, t]);

  const getDashboardPath = () => (user ? landingFor(user) : '/login');

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

          <nav className="gigw-masthead-nav" aria-label="Primary">
            <button
              type="button"
              className="gigw-header-vision-btn"
              onClick={() => setVisionOpen(true)}
              aria-label={t('pub.shell.vision')}
              title={t('pub.shell.visionTitle')}
            >
              <Target size={14} style={{ color: 'var(--primary)' }} />
              <span>{t('pub.shell.vision')}</span>
            </button>

            {/* Quick Search Spotlight Trigger */}
            <button
              type="button"
              className="gigw-search-trigger-btn"
              onClick={() => setSearchOpen(true)}
              aria-label={t('pub.shell.searchPortal')}
              title={t('pub.shell.searchPortal')}
            >
              <Search size={14} />
              <span>{t('pub.shell.search')}</span>
              <kbd className="gigw-search-kbd-badge">⌘K</kbd>
            </button>

            <ThemeToggle />

            {/* Direct Sign In Button with Lock icon */}
            <Link 
              to={getDashboardPath()} 
              className="btn btn-primary gigw-header-signin-btn"
            >
              <Lock size={14} />
              <span>
                {user 
                  ? (t('pub.shell.dashboard')) 
                  : (t('pub.shell.signIn'))}
              </span>
            </Link>
          </nav>
        </div>
      </header>

      <main id="main-content" className="gigw-public-main" tabIndex={-1}>
        {children}
      </main>
      <GigwFooter />
      <VisionModal open={visionOpen} onClose={() => setVisionOpen(false)} />
      <PortalSearchModal open={searchOpen} onClose={() => setSearchOpen(false)} />
      <AudioSpeechWidget open={audioOpen} onClose={() => setAudioOpen(false)} />
      <KeyboardShortcutsModal open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      <BackToTopProgress />
    </div>
  );
}
