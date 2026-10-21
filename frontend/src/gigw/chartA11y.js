/**
 * Recharts draws each pie / radial sector as <path role="img"> with no
 * accessible name (recharts 2.x, shape/Sector.js), which fails WCAG 1.1.1 on
 * every pie chart in the platform. Each sector carries its series name in a
 * `name` attribute, so this gives it that name as its label — one fix for all
 * charts instead of one per screen. The figures themselves are in the tables
 * and tooltips beside each chart.
 */
const SELECTOR = 'path.recharts-sector[role="img"]:not([aria-label])';

function label(root) {
  root.querySelectorAll?.(SELECTOR).forEach((el) => {
    el.setAttribute('aria-label', el.getAttribute('name') || 'Chart segment');
  });
}

export function installChartA11y() {
  if (typeof window === 'undefined' || !window.MutationObserver) return;
  let queued = false;
  const obs = new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; label(document); });
  });
  obs.observe(document.documentElement, { childList: true, subtree: true });
  label(document);
}
