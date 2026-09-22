// Finds everything clickable on a screen, presses one thing on a freshly
// loaded page, and records what happened — then says whether that counts as the
// button working. See AUDIT_PLAN.md for what each outcome means.

export const OUTCOME = {
  OK: 'OK',
  BROKEN: 'BROKEN',
  REFUSED: 'REFUSED',
  PLACEHOLDER: 'PLACEHOLDER',
  DEAD: 'DEAD',
  // Does nothing, and says nothing, until the fields it needs are filled in.
  SILENT: 'SILENT',
  SKIPPED: 'SKIPPED',
};

const NEVER_PRESS = /\b(log ?out|sign ?out)\b/i;
// Text a demo stub shows instead of doing its job.
const STUB_TEXT = /(coming soon|not (yet )?(implemented|available|built)|under (construction|development)|placeholder|\bTODO\b|modal opened|opened!|dummy|mock(ed)? (action|data)|demo (only|mode))/i;
const ERROR_SCREEN = 'This screen failed to load';
export const WRITE_CALL = /calls[^;]*\b(POST|PUT|PATCH|DELETE) \//;

const MAX_PER_SCREEN = 70;
const MAX_CHILDREN = 30;

/**
 * Runs in the page. Marks each clickable element in the scope with a
 * data-audit-id and returns a description of it. `scope` is 'main' for the
 * screen's content area or 'dialog' for the topmost open dialog.
 */
function collectInPage(scope) {
  const root = scope === 'dialog'
    ? [...document.querySelectorAll('[role=dialog]')].filter((d) => d.getClientRects().length).pop()
    : scope === 'header' ? document.querySelector('.topbar-actions') : document.querySelector('main.content');
  if (!root) return [];
  // Marks from an earlier look (the screen behind a dialog, say) would share
  // ids with this one and send the click to the wrong element.
  document.querySelectorAll('[data-audit-id]').forEach((e) => e.removeAttribute('data-audit-id'));
  const SEL = [
    'button', 'a[href]', '[role=button]', '[role=tab]', '[role=menuitem]', '[role=link]',
    'input[type=button]', 'input[type=submit]', 'input[type=reset]', 'input[type=checkbox]', 'input[type=radio]',
    'summary', 'label.btn', '[onclick]',
  ].join(',');
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const s = getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.05;
  };
  // A table's rows repeat the same actions, so only its first row is looked
  // at — and the rest are skipped whole, which is what keeps a report with
  // thousands of rows from taking minutes to scan.
  const firstRowOf = new Map();
  const firstRow = (body) => {
    if (!firstRowOf.has(body)) firstRowOf.set(body, [...body.children].find((r) => r.getClientRects().length) || null);
    return firstRowOf.get(body);
  };
  const POINTER_TAGS = new Set(['DIV', 'SPAN', 'LI', 'TD', 'TH', 'TR', 'IMG', 'svg', 'H2', 'H3', 'H4', 'P', 'STRONG', 'SECTION', 'ARTICLE']);
  // The same goes for any run of eight or more look-alike siblings — a
  // timeline, a feed, a row of sortable column headings: it is data repeating
  // one control, so its first two are pressed and the rest stand for them. (The
  // audit log's timeline grows with every press the audit makes; without this
  // the screen never ran out of "new" entries.)
  const sig = (n) => `${n.tagName}|${n.getAttribute('class') || ''}`;
  const groups = new Map();
  const beyondRepeat = (n) => {
    const p = n.parentElement;
    if (!p || p === root.parentElement) return false;
    let g = groups.get(p);
    if (!g) {
      const counts = new Map();
      for (const c of p.children) counts.set(sig(c), (counts.get(sig(c)) || 0) + 1);
      g = { counts, seen: new Map() };
      groups.set(p, g);
    }
    const k = sig(n);
    if ((g.counts.get(k) || 0) < 8) return false;
    const nth = (g.seen.get(k) || 0) + 1;
    g.seen.set(k, nth);
    return nth > 2;
  };
  const found = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
    acceptNode(n) {
      if (n.tagName === 'TR' && n.parentElement?.tagName === 'TBODY' && firstRow(n.parentElement) !== n) return NodeFilter.FILTER_REJECT;
      // A row's cells look alike but hold different actions; they are never a repeat.
      if (n.tagName !== 'TR' && n.tagName !== 'TD' && beyondRepeat(n)) return NodeFilter.FILTER_REJECT;
      if (n.tagName === 'SELECT' || n.tagName === 'OPTION' || n.tagName === 'TEXTAREA') return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  for (let el = walker.nextNode(); el; el = walker.nextNode()) {
    if (el.matches(SEL)) { found.push(el); continue; }
    // Elements made clickable in script (a div with an onClick) show only as a
    // pointer cursor. The cursor is inherited, so take the outermost element of
    // each pointer region that is not already inside something listed.
    if (!POINTER_TAGS.has(el.tagName) || getComputedStyle(el).cursor !== 'pointer') continue;
    const parent = el.parentElement;
    if (parent && parent !== root && getComputedStyle(parent).cursor === 'pointer') continue;
    if (el.closest(SEL)) continue;
    found.push(el);
  }
  const seen = new Map();
  const out = [];
  let i = 0;
  for (const el of found) {
    if (!visible(el)) continue;
    // A label wrapping a checkbox is the same control twice.
    if (el.tagName === 'INPUT' && el.closest('label.btn')) continue;
    const tag = el.tagName.toLowerCase();
    const role = el.getAttribute('role');
    const kind = tag === 'a' ? 'link'
      : role === 'tab' ? 'tab'
        : (tag === 'tr' || (role === 'button' && tag === 'tr')) ? 'row'
          : tag === 'input' && /checkbox|radio/.test(el.type) ? 'toggle'
            : (tag === 'button' || role === 'button' || tag === 'input' || tag === 'summary' || el.matches('label.btn')) ? 'button'
              : 'clickable';
    let label = (el.getAttribute('aria-label') || el.innerText || el.getAttribute('title') || el.value || el.getAttribute('alt') || '')
      .replace(/\s+/g, ' ').trim();
    if (kind === 'toggle') {
      const lab = el.closest('label') || (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`));
      label = (lab?.innerText || el.name || el.value || 'checkbox').replace(/\s+/g, ' ').trim();
    }
    if (!label) label = el.querySelector('svg') ? '(icon)' : `(${tag})`;
    label = label.slice(0, 80);
    const base = `${kind}:${label}`;
    const n = (seen.get(base) || 0) + 1;
    seen.set(base, n);
    const href = tag === 'a' ? el.getAttribute('href') : null;
    const disabled = el.disabled || el.getAttribute('aria-disabled') === 'true';
    el.setAttribute('data-audit-id', String(i));
    out.push({ id: i, key: n > 1 ? `${base} #${n}` : base, kind, label, href, disabled, target: el.getAttribute('target') });
    i += 1;
  }
  return out;
}

export async function collect(page, scope = 'main') {
  return page.evaluate(collectInPage, scope);
}

/** Wait until the page has made no API call for a moment (capped). */
async function settle(page, inflight, { quiet = 400, cap = 6000 } = {}) {
  const start = Date.now();
  let calmSince = Date.now();
  while (Date.now() - start < cap) {
    await page.waitForTimeout(100);
    if (inflight.size > 0) calmSince = Date.now();
    else if (Date.now() - calmSince >= quiet) return;
  }
}

/** Load a screen from scratch and let it finish its first requests. */
export async function openScreen(page, url, inflight) {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  // The screen's code is a lazy chunk that asks for its data once mounted;
  // network idle covers both, where watching only API calls could stop between them.
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
  await settle(page, inflight, { quiet: 250, cap: 5000 });
}

/**
 * Wires the listeners one click is judged by. Returns the live record and a
 * function that detaches them.
 */
export function watch(page, context) {
  const rec = {
    api: [], errors: [], dialogs: [], downloads: 0, popups: [], fileChooser: false, inflight: new Set(), consoleErrors: [],
  };
  const onRequest = (r) => { if (new URL(r.url()).pathname.startsWith('/api/')) rec.inflight.add(r); };
  const onDone = async (r) => {
    if (!rec.inflight.delete(r)) return;
    const res = await r.response().catch(() => null);
    const entry = { method: r.method(), path: new URL(r.url()).pathname, status: res ? res.status() : 0 };
    if (res && res.status() >= 400) {
      try { entry.error = String((await res.json()).error || '').slice(0, 160); } catch { /* not JSON */ }
    }
    rec.api.push(entry);
  };
  const onPageError = (e) => rec.errors.push(e.message.slice(0, 200));
  const onConsole = (m) => { if (m.type() === 'error') rec.consoleErrors.push(m.text().slice(0, 200)); };
  const onDialog = async (d) => {
    rec.dialogs.push({ type: d.type(), message: d.message().slice(0, 200) });
    // Confirm and prompt are accepted so the action they guard is exercised
    // too; the database is the suite's own.
    if (d.type() === 'prompt') await d.accept('Audit test').catch(() => {});
    else await d.accept().catch(() => {});
  };
  const onDownload = () => { rec.downloads += 1; };
  const onPopup = (p) => { rec.popups.push(p.url()); p.close().catch(() => {}); };
  const onFileChooser = () => { rec.fileChooser = true; };
  page.on('request', onRequest);
  page.on('requestfinished', onDone);
  page.on('requestfailed', onDone);
  page.on('pageerror', onPageError);
  page.on('console', onConsole);
  page.on('dialog', onDialog);
  page.on('download', onDownload);
  page.on('filechooser', onFileChooser);
  context.on('page', onPopup);
  const stop = () => {
    page.off('request', onRequest);
    page.off('requestfinished', onDone);
    page.off('requestfailed', onDone);
    page.off('pageerror', onPageError);
    page.off('console', onConsole);
    page.off('dialog', onDialog);
    page.off('download', onDownload);
    page.off('filechooser', onFileChooser);
    context.off('page', onPopup);
  };
  return { rec, stop };
}

function reset(rec) {
  rec.api.length = 0; rec.errors.length = 0; rec.dialogs.length = 0; rec.popups.length = 0; rec.consoleErrors.length = 0;
  rec.downloads = 0; rec.fileChooser = false;
}

/**
 * Fill the empty text, number and date fields (and unchosen selects) in the
 * scope with plausible values. Returns whether anything was filled.
 */
async function fillEmptyFields(page, scope) {
  return page.evaluate((sc) => {
    const root = sc === 'dialog'
      ? [...document.querySelectorAll('[role=dialog]')].filter((d) => d.getClientRects().length).pop()
      : sc === 'header' ? document.querySelector('.topbar-actions') : document.querySelector('main.content');
    if (!root) return false;
    const setValue = (el, value) => {
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype
        : el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    let filled = 0;
    for (const el of root.querySelectorAll('input, textarea, select')) {
      if (!el.getClientRects().length || el.disabled || el.readOnly || el.value) continue;
      const t = (el.type || '').toLowerCase();
      if (el.tagName === 'SELECT') {
        const opt = [...el.options].find((o) => o.value && !o.disabled);
        if (opt) { setValue(el, opt.value); filled += 1; }
      } else if (el.tagName === 'TEXTAREA' || ['text', 'search', ''].includes(t)) {
        setValue(el, 'Audit test'); filled += 1;
      } else if (t === 'number') {
        setValue(el, el.min && Number(el.min) > 1 ? el.min : '1'); filled += 1;
      } else if (t === 'date') {
        setValue(el, el.min || '2026-09-01'); filled += 1;
      } else if (t === 'month') {
        setValue(el, '2026-08'); filled += 1;
      } else if (t === 'email') {
        setValue(el, 'audit@example.com'); filled += 1;
      } else if (t === 'tel') {
        setValue(el, '9876543210'); filled += 1;
      }
    }
    return filled > 0;
  }, scope).catch(() => false);
}

async function snapshot(page) {
  return page.evaluate((errorText) => ({
    url: location.pathname + location.search,
    dialogs: [...document.querySelectorAll('[role=dialog]')].filter((d) => d.getClientRects().length).length,
    errorScreen: document.body.innerText.includes(errorText),
    printed: window.__auditPrinted || 0,
  }), ERROR_SCREEN);
}

/**
 * Press the element with this key (found fresh by collect) and judge it.
 * `scope` is where to look for it. Returns the outcome and, when the press
 * opened a dialog or revealed new controls, where to look for its children.
 */
export async function press(page, rec, scope, key, beforeKeys = null, { retried = false, menuItem = false } = {}) {
  const items = await collect(page, scope);
  const item = items.find((x) => x.key === key);
  if (!item) return { outcome: OUTCOME.SKIPPED, detail: 'not on the page after a fresh load (depends on earlier state)' };
  if (item.disabled) return { outcome: OUTCOME.SKIPPED, detail: 'disabled' };
  if (NEVER_PRESS.test(item.label)) return { outcome: OUTCOME.SKIPPED, detail: 'signs the user out' };
  if (item.href && /^https?:\/\//.test(item.href) && !item.href.includes('127.0.0.1') && !item.href.includes('localhost')) {
    return { outcome: OUTCOME.SKIPPED, detail: `external link to ${item.href}` };
  }

  const el = page.locator(`[data-audit-id="${item.id}"]`).first();
  // A submit button over a form that is not filled in is stopped by the
  // browser's own required-field check; that is the button working.
  const formInvalid = await el.evaluate((node) => {
    const form = node.form || node.closest('form');
    const submits = node.type === 'submit' || (node.tagName === 'BUTTON' && !node.getAttribute('type'));
    return !!(form && submits && !form.checkValidity());
  }).catch(() => false);

  await page.evaluate(() => {
    window.__auditMutations = 0;
    window.__auditObserver?.disconnect();
    window.__auditObserver = new MutationObserver((list) => { window.__auditMutations += list.length; });
    window.__auditObserver.observe(document.body, {
      subtree: true, childList: true, characterData: true, attributes: true,
      attributeFilter: ['class', 'open', 'hidden', 'aria-expanded', 'aria-selected', 'aria-pressed', 'aria-checked', 'disabled', 'value'],
    });
  });
  // A tab, filter chip or radio that is already the selected one changes
  // nothing when pressed again, and that is it working.
  const alreadySelected = await el.evaluate((node) => {
    const on = (v) => v === 'true' || v === 'page';
    if (on(node.getAttribute('aria-selected')) || on(node.getAttribute('aria-pressed')) || on(node.getAttribute('aria-current'))) return true;
    if (node.type === 'radio' && node.checked) return true;
    if (/(^|[\s_-])(active|selected|is-active|current)(\s|$)/i.test(node.className || '')) return true;
    // A segmented group that marks its choice only by style: every other
    // button in the group shares one class, and this one's differs.
    // In a pair each differs from the other, so a pair also needs the chosen
    // one to be the filled style and the other the outline one.
    const sibs = [...(node.parentElement?.children || [])].filter((n) => n !== node && n.tagName === node.tagName);
    if (!sibs.length || sibs.length > 11 || new Set(sibs.map((n) => n.className)).size !== 1 || sibs[0].className === node.className) return false;
    if (sibs.length >= 2) return true;
    return /navy|primary|solid|filled|dark/i.test(node.className) && /outline|ghost|light/i.test(sibs[0].className);
  }).catch(() => false);
  const before = await snapshot(page);
  const checkedBefore = item.kind === 'toggle' ? await el.isChecked().catch(() => null) : null;
  reset(rec);

  try {
    await el.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
    await el.click({ timeout: 5000 });
  } catch (err) {
    // Covered by something else, or detached as it was reached.
    return { outcome: OUTCOME.SKIPPED, detail: `could not be clicked: ${err.message.split('\n')[0].slice(0, 140)}` };
  }
  await settle(page, rec.inflight, { quiet: 350, cap: 5000 });

  const after = await snapshot(page).catch(() => ({ url: page.url(), dialogs: 0, errorScreen: false, printed: 0 }));
  const mutations = await page.evaluate(() => window.__auditMutations || 0).catch(() => 0);

  const effects = [];
  if (after.url !== before.url) effects.push(`opens ${after.url}`);
  if (after.dialogs > before.dialogs) effects.push('opens a dialog');
  if (after.dialogs < before.dialogs) effects.push('closes the dialog');
  if (rec.downloads) effects.push('downloads a file');
  if (rec.popups.length) effects.push(`opens a new tab (${rec.popups[0].slice(0, 80)})`);
  if (rec.fileChooser) effects.push('opens a file picker');
  if (after.printed > before.printed) effects.push('prints');
  const okCalls = rec.api.filter((c) => c.status && c.status < 400);
  if (okCalls.length) effects.push(`calls ${[...new Set(okCalls.map((c) => `${c.method} ${c.path}`))].slice(0, 3).join(', ')}`);
  for (const d of rec.dialogs) effects.push(`${d.type}: "${d.message}"`);
  if (item.kind === 'toggle') {
    const checkedAfter = await el.isChecked().catch(() => null);
    if (checkedAfter !== null && checkedAfter !== checkedBefore) effects.push(checkedAfter ? 'ticks' : 'unticks');
  }
  // A menu closing itself is not the item doing anything; for a menu item only
  // a real effect (navigation, dialog, request, message) counts.
  if (mutations > 0 && !effects.length && !menuItem) effects.push('changes the screen');

  // The test server has no internet (offline.cjs). A button whose server call
  // failed only because of that is not broken; it needs a check with the network.
  const offline = rec.api.filter((c) => c.status >= 500 && /outbound network is blocked/.test(c.error || ''));
  const serverErrors = rec.api.filter((c) => c.status >= 500 && !offline.includes(c));
  const refused = rec.api.filter((c) => c.status >= 400 && c.status < 500);
  const stub = rec.dialogs.find((d) => STUB_TEXT.test(d.message));

  let result;
  if (after.url.startsWith('/login')) {
    result = { outcome: OUTCOME.BROKEN, detail: 'the session was lost — the user was sent back to the login page' };
  } else if (rec.errors.length || serverErrors.length || (after.errorScreen && !before.errorScreen)) {
    const why = [
      ...rec.errors.map((e) => `uncaught error: ${e}`),
      ...serverErrors.map((c) => `${c.status} from ${c.method} ${c.path}${c.error ? ` — ${c.error}` : ''}`),
      ...(after.errorScreen && !before.errorScreen ? ['shows "This screen failed to load"'] : []),
    ];
    result = { outcome: OUTCOME.BROKEN, detail: why.join('; ') };
  } else if (offline.length) {
    result = { outcome: OUTCOME.SKIPPED, detail: `needs the internet, which the test server does not have: ${offline.map((c) => `${c.method} ${c.path}`).join(', ')}` };
  } else if (stub) {
    result = { outcome: OUTCOME.PLACEHOLDER, detail: `${stub.type}: "${stub.message}"` };
  } else if (refused.length) {
    // A refusal the user is told about is the screen working. One that leaves
    // the screen as it was, with no message, is the finding.
    const told = await page.evaluate((messages) => {
      const text = document.body.innerText;
      return messages.every((m) => !m || text.includes(m.slice(0, 40)));
    }, refused.map((c) => c.error || '')).catch(() => false)
      || rec.dialogs.some((d) => refused.some((c) => c.error && d.message.includes(c.error.slice(0, 40))));
    const why = refused.map((c) => `${c.status} from ${c.method} ${c.path}${c.error ? ` — ${c.error}` : ''}`).join('; ');
    result = told && refused.every((c) => c.error)
      ? { outcome: OUTCOME.OK, detail: `refused, and the screen says why: ${why}` }
      : { outcome: OUTCOME.REFUSED, detail: `${why} — and the reason is not shown on screen`, effects };
  } else if (effects.length) {
    result = { outcome: OUTCOME.OK, detail: effects.join('; ') };
  } else if (alreadySelected) {
    result = { outcome: OUTCOME.OK, detail: 'already the selected one; pressing it again changes nothing' };
  } else if (formInvalid) {
    result = { outcome: OUTCOME.OK, detail: 'stopped by the form\'s required fields (nothing filled in)' };
  } else if (!retried && await fillEmptyFields(page, scope)) {
    // Try once more with the scope's empty fields filled: a button that works
    // then was waiting for input, and said nothing about it.
    const again = await press(page, rec, scope, key, beforeKeys, { retried: true });
    result = again.outcome === OUTCOME.DEAD || again.outcome === OUTCOME.SKIPPED
      ? { outcome: OUTCOME.DEAD, detail: 'nothing happened, even with its fields filled in' }
      : again.outcome === OUTCOME.OK
        // Only a press that saves something once filled in is a finding: it
        // ignored the empty form without saying so. A "Clear" with nothing to
        // clear, or an option that was already chosen, is just idle.
        ? (WRITE_CALL.test(again.detail)
          ? { outcome: OUTCOME.SILENT, detail: `does nothing while its fields are empty, and shows no message; filled in, it ${again.detail}` }
          : { outcome: OUTCOME.OK, detail: `idle with its fields empty; with them filled in, it ${again.detail}` })
        : { ...again, detail: `with its fields filled in: ${again.detail}` };
  } else {
    result = { outcome: OUTCOME.DEAD, detail: 'nothing happened: no request, no navigation, no dialog, no change on screen' };
  }

  // Where this press leads, for the next level down.
  if (after.url === before.url && !after.url.startsWith('/login')) {
    if (after.dialogs > before.dialogs) {
      result.childScope = 'dialog';
    } else if (mutations > 0 && beforeKeys) {
      const now = await collect(page, scope).catch(() => []);
      const fresh = now.filter((x) => !beforeKeys.has(x.key)).map((x) => x.key);
      if (fresh.length) { result.childScope = scope; result.childKeys = fresh; }
    }
  }
  result.consoleErrors = [...rec.consoleErrors];
  return result;
}

export { MAX_PER_SCREEN, MAX_CHILDREN };
