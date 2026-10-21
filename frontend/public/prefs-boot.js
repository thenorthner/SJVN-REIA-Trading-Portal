/*
 * Applied before the app paints, so a reload does not flash the default look:
 * theme, and the GIGW viewer preferences (language, text size, contrast) that
 * src/gigw/GigwContext.jsx manages afterwards. A file rather than an inline
 * script, so the Content-Security-Policy can refuse inline script entirely.
 */
(function () {
  try {
    var root = document.documentElement;
    var saved = localStorage.getItem('sjvn_theme');
    var theme = (saved === 'dark' || saved === 'light') ? saved : (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    root.setAttribute('data-theme', theme);
    var lang = localStorage.getItem('sjvn_lang');
    if (lang === 'hi' || lang === 'en' || lang === 'gu' || lang === 'mr') root.setAttribute('lang', lang);
    var size = localStorage.getItem('sjvn_text_size');
    root.setAttribute('data-text-size', (size === 'sm' || size === 'lg') ? size : 'md');
    root.setAttribute('data-contrast', localStorage.getItem('sjvn_contrast') === 'high' ? 'high' : 'normal');
  } catch (e) { /* storage blocked: defaults apply */ }
})();
