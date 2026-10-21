import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { STRINGS } from './strings.js';

/**
 * Viewer preferences GIGW 3.0 asks a government portal to offer on every page:
 * the page language (Rajbhasha — English and Hindi), a three-step text size
 * (A- / A / A+) and a high-contrast scheme. Each is a per-viewer convenience, so
 * it lives in this browser's storage and is applied as an attribute on <html>,
 * where the stylesheet (gigw.css) picks it up. public/prefs-boot.js applies the
 * same attributes before React paints, so a reload does not flash the defaults.
 */

const GigwContext = createContext(null);

const KEYS = { lang: 'sjvn_lang', size: 'sjvn_text_size', contrast: 'sjvn_contrast' };
export const SUPPORTED_LANGS = ['en', 'hi', 'gu', 'mr'];
export const TEXT_SIZES = ['sm', 'md', 'lg'];

function read(key, allowed, fallback) {
  try {
    const v = localStorage.getItem(key);
    return allowed.includes(v) ? v : fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try { localStorage.setItem(key, value); } catch { /* private window: the choice lasts this page only */ }
}

export function GigwProvider({ children }) {
  const [lang, setLang] = useState(() => read(KEYS.lang, SUPPORTED_LANGS, 'en'));
  const [textSize, setTextSize] = useState(() => read(KEYS.size, TEXT_SIZES, 'md'));
  const [contrast, setContrast] = useState(() => read(KEYS.contrast, ['normal', 'high'], 'normal'));

  useEffect(() => {
    write(KEYS.lang, lang);
    document.documentElement.setAttribute('lang', lang);
  }, [lang]);
  useEffect(() => {
    write(KEYS.size, textSize);
    document.documentElement.setAttribute('data-text-size', textSize);
  }, [textSize]);
  useEffect(() => {
    write(KEYS.contrast, contrast);
    document.documentElement.setAttribute('data-contrast', contrast);
  }, [contrast]);

  const t = useCallback((key, vars) => translate(lang, key, vars), [lang]);

  const value = useMemo(() => ({
    lang, setLang, toggleLang: () => setLang((l) => (l === 'en' ? 'hi' : 'en')),
    textSize, setTextSize,
    contrast, setContrast, toggleContrast: () => setContrast((c) => (c === 'high' ? 'normal' : 'high')),
    t,
  }), [lang, textSize, contrast, t]);

  return <GigwContext.Provider value={value}>{children}</GigwContext.Provider>;
}

export function translate(lang, key, vars) {
  const entry = STRINGS[key];
  let s = entry ? (entry[lang] ?? entry.hi ?? entry.en) : key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}

/** Outside the provider (unit tests that render one component) English is used. */
export function useGigw() {
  const ctx = useContext(GigwContext);
  if (ctx) return ctx;
  return {
    lang: 'en', setLang: () => {}, toggleLang: () => {},
    textSize: 'md', setTextSize: () => {},
    contrast: 'normal', setContrast: () => {}, toggleContrast: () => {},
    t: (key, vars) => translate('en', key, vars),
  };
}
