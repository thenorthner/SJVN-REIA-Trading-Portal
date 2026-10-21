import React from 'react';
import { Link } from 'react-router-dom';
import { Volume2, Keyboard } from 'lucide-react';
import { useGigw } from './GigwContext.jsx';
import { toggleAudioSpeech } from '../components/AudioSpeechWidget.jsx';
import { openKeyboardShortcuts } from '../components/KeyboardShortcutsModal.jsx';

/**
 * The national identity strip and accessibility toolbar GIGW 3.0 / UX4G place
 * at the very top of every page: Government of India and the Ministry, a skip
 * link, A- / A / A+, high contrast, the Hindi–English switch and screen-reader
 * help. Everything is on screen — no control hides in a dropdown.
 *
 * The skip link is rendered separately (<SkipLink />) because it has to be the
 * first focusable thing in the document, ahead of the sidebar.
 */
export function SkipLink() {
  const { t } = useGigw();
  return (
    <a className="gigw-skip" href="#main-content" onClick={focusMain}>{t('a11y.skip')}</a>
  );
}

// Moving focus as well as scrolling, so the next Tab continues from the content
// rather than from the top of the page again.
export function focusMain(e) {
  const main = document.getElementById('main-content');
  if (!main) return;
  e?.preventDefault?.();
  if (!main.hasAttribute('tabindex')) main.setAttribute('tabindex', '-1');
  main.focus();
  main.scrollIntoView?.({ block: 'start' });
}

export default function GovStrip({ withSkip = false }) {
  const { t, lang, setLang, toggleLang, textSize, setTextSize, contrast, toggleContrast } = useGigw();
  const sizes = [
    { key: 'sm', label: 'A-', aria: t('a11y.textSmaller') },
    { key: 'md', label: 'A', aria: t('a11y.textNormal') },
    { key: 'lg', label: 'A+', aria: t('a11y.textLarger') },
  ];
  return (
    <div className="gigw-strip" role="region" aria-label={`${t('gov.india')} — ${t('a11y.toolbar')}`}>
      {withSkip && <SkipLink />}
      <div className="gigw-strip-identity">
        <a href="https://www.india.gov.in" target="_blank" rel="noopener noreferrer" className="gigw-strip-gov" title={t('a11y.indiaPortal')}>
          <span className="gigw-flag" aria-hidden="true"><i /><i /><i /></span>
          <span lang="hi">भारत सरकार</span>
          <span className="gigw-sep" aria-hidden="true">|</span>
          <span lang="en">Government of India</span>
          <span className="sr-only"> — {t('a11y.indiaPortal')}</span>
        </a>
        <span className="gigw-strip-ministry">
          <span lang="hi">विद्युत मंत्रालय</span>
          <span className="gigw-sep" aria-hidden="true">|</span>
          <span lang="en">Ministry of Power</span>
        </span>
      </div>
      <div className="gigw-toolbar" role="toolbar" aria-label={t('a11y.toolbar')}>
        {!withSkip && (
          <a className="gigw-tool gigw-tool-text" href="#main-content" onClick={focusMain}>{t('a11y.skip')}</a>
        )}
        <span className="gigw-group" role="group" aria-label={t('a11y.textNormal')}>
          {sizes.map((s) => (
            <button
              key={s.key}
              type="button"
              className={`gigw-tool${textSize === s.key ? ' is-active' : ''}`}
              aria-label={s.aria}
              aria-pressed={textSize === s.key}
              onClick={() => setTextSize(s.key)}
            >{s.label}</button>
          ))}
        </span>
        <button
          type="button"
          className={`gigw-tool gigw-tool-contrast${contrast === 'high' ? ' is-active' : ''}`}
          aria-pressed={contrast === 'high'}
          aria-label={contrast === 'high' ? t('a11y.contrastOn') : t('a11y.contrast')}
          title={t('a11y.contrast')}
          onClick={toggleContrast}
        >
          <span aria-hidden="true" className="gigw-contrast-icon" />
          <span className="gigw-tool-label">{t('a11y.contrast')}</span>
        </button>
        <button
          type="button"
          className="gigw-tool gigw-tool-text"
          lang={lang === 'hi' ? 'en' : 'hi'}
          aria-label={t('a11y.languageLabel')}
          onClick={toggleLang}
        >{t('a11y.language')}</button>
        <div className="gigw-regional-lang-wrap">
          <label htmlFor="gigw-regional-lang-select" className="sr-only">
            Select Regional Language
          </label>
          <select
            id="gigw-regional-lang-select"
            className="gigw-tool gigw-lang-select"
            value={lang}
            onChange={(e) => setLang(e.target.value)}
            aria-label="Select Regional Language"
            title="Regional Language Selection / क्षेत्रीय भाषा चयन"
          >
            <option value="en">English</option>
            <option value="hi">हिन्दी (HP/Bihar)</option>
            <option value="gu">ગુજરાતી (Solar)</option>
            <option value="mr">मराठी (Wind)</option>
          </select>
        </div>
        <button
          type="button"
          className="gigw-tool gigw-tool-audio"
          aria-label={t('a11y.audioLabel')}
          title={t('a11y.audioLabel')}
          onClick={toggleAudioSpeech}
        >
          <Volume2 size={13} aria-hidden="true" style={{ marginRight: 4, verticalAlign: 'middle' }} />
          <span>{t('a11y.audio')}</span>
        </button>
        <button
          type="button"
          className="gigw-tool gigw-tool-shortcuts"
          aria-label={t('a11y.shortcutsLabel')}
          title={t('a11y.shortcutsLabel')}
          onClick={openKeyboardShortcuts}
        >
          <Keyboard size={13} aria-hidden="true" style={{ marginRight: 4, verticalAlign: 'middle' }} />
          <span>{t('a11y.shortcuts')}</span>
        </button>
        <Link className="gigw-tool gigw-tool-text" to="/screen-reader-access">{t('a11y.screenReader')}</Link>
      </div>
    </div>
  );
}
