// Plays every side quest in the page, as a person would, and checks what it shows
// against the playbook's own data (TEST-PLAN.md, Layer 4). In the browser, on the
// playbook page with fresh storage:
//   await import('/e2e-quests.js?' + Date.now()).then((m) => m.run())
// The portal copy serves no e2e file: paste this module's body and call run().
// Returns { checked, failures: [...] }. It leaves every quest marked done.
export async function run({ src } = {}) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const txt = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
  const fails = []; let checked = 0;
  const ok = (cond, msg) => { checked++; if (!cond) fails.push(msg); };
  // Waits for what it clicks: a hidden pane runs the page's timers late.
  const need = async (sel, root = document) => {
    for (let k = 0; k < 60; k++) { const el = $(sel, root); if (el) return el; await sleep(50); }
    throw new Error(`${sel} never appeared, at ${location.hash} “${txt($('h1'))}”`);
  };
  const click = async (el) => { (typeof el === 'string' ? await need(el) : el).click(); await sleep(30); };
  const key = async (k) => { document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })); await sleep(30); };
  const route = async (h) => { if (location.hash !== h) location.hash = h; await sleep(80); };

  // The page's data, read the way check-labels.mjs and test-quests.mjs read it.
  // The page's own script is the truth; a fetched index.html can be a cached, older one.
  src = src || $$('script').map((s) => s.textContent).join('\n');
  if (!src.includes('data: roles')) src = await (await fetch(`${$('script[src]')?.src || 'index.html'}?${Date.now()}`, { cache: 'no-store' })).text();
  const cut = (a, b) => { const i = src.indexOf(a); return src.slice(i, src.indexOf(b, i)); };
  // eslint-disable-next-line no-new-func
  const D = new Function(`${cut('/* ───────────────────────── data: roles', '/* ───────────────────────── helpers')}\nreturn { R, QUESTS, QZONES };`)();
  const { R, QUESTS, QZONES } = D;
  const plain = (s) => String(s).replace(/`([^`]+)`/g, '$1').replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\{([A-Z][A-Z0-9_]*)\}/g, (m, t) => t.replace(/_/g, ' '));
  // A drawer section's words after its heading; a hand-off's words without its badge.
  const body = (x) => (x ? x.textContent.slice($('h4', x).textContent.length).replace(/\s+/g, ' ').trim() : '');
  const bare = (el) => { const c = el.cloneNode(true); c.querySelectorAll('.rb').forEach((e) => e.remove()); return txt(c); };
  // Who is logged in before step i: the last person to act, automatic steps passing over.
  const human = (q, i) => { for (let k = i - 1; k >= 0; k--) if (q.steps[k].who !== 'X') return q.steps[k].who; return null; };
  const logins = (q) => q.steps.filter((s, i) => s.who !== 'X' && human(q, i) !== s.who).length;
  const KEY = 'reia-playbook-v1';
  const stored = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { return {}; } };
  const errors = [];
  const onErr = (e) => errors.push(String(e.message || e.reason || e));
  window.addEventListener('error', onErr); window.addEventListener('unhandledrejection', onErr);

  let xp = 0;
  for (const [qi, q] of QUESTS.entries()) {
    const n = qi + 1; const id = 'q' + n; const at = `Q${n} ${q.short}`;
    await route('#' + id);
    // The lanes
    ok(txt($('h1')) === q.name, `${at}: heading “${txt($('h1'))}”`);
    const zone = QZONES.find(([z]) => z === q.zone)[1];
    ok(txt($('.mhead .eyebrow')) === `Side quest · ${zone} · Quest ${n} of ${QUESTS.length}`, `${at}: eyebrow “${txt($('.mhead .eyebrow'))}”`);
    const stats = $$('.mstat b').map(txt);
    ok(stats[0] === String(q.steps.length), `${at}: says ${stats[0]} steps, has ${q.steps.length}`);
    ok(stats[1] === String(logins(q)), `${at}: says ${stats[1]} log-ins, a person logs in ${logins(q)} times`);
    ok(stats[2] === String(q.steps.filter((s) => s.block).length), `${at}: wrong-role blocks ${stats[2]}`);
    const players = [...new Set(q.steps.map((s) => s.who))];
    ok($$('.lhead').length === players.length, `${at}: ${$$('.lhead').length} lanes for ${players.length} players`);
    ok($$('.step').length === q.steps.length, `${at}: ${$$('.step').length} step cards`);
    const hands = q.steps.filter((s, i) => i && q.steps[i - 1].who !== s.who);
    ok($$('.hand').length === hands.length, `${at}: ${$$('.hand').length} hand-offs, expected ${hands.length}`);
    $$('.hand .pill').forEach((p, k) => {
      const i = q.steps.indexOf(hands[k]); const s = q.steps[i]; const before = human(q, i);
      const want = s.who === 'X' ? 'Automatic' : before === s.who ? `Back to ${R[s.who].short}` : before ? `Log out, log in as ${R[s.who].short}` : `Log in as ${R[s.who].short}`;
      ok(bare(p) === want, `${at}: hand-off before step ${i + 1} reads “${bare(p)}”, expected “${want}”`);
    });
    const chips = $$('.mnav .chip');
    ok(chips.length === QUESTS.length && chips[qi]?.getAttribute('aria-current') === 'true', `${at}: chip nav`);
    ok(!!$('.mnav [data-go="quests"]'), `${at}: no way back to the board`);
    ok(JSON.stringify($$('.mfoot .alist li').map(txt)) === JSON.stringify(q.also.map((a) => plain(a).replace(/\s+/g, ' '))), `${at}: “Also on this desk” reads ${JSON.stringify($$('.mfoot .alist li').map(txt))}`);

    // Every step's drawer
    for (const [i, s] of q.steps.entries()) {
      const sa = `${at} step ${i + 1}`;
      await click(`.step[data-step="${id}:${i}"]`);
      const d = $('#drawer');
      ok(d.classList.contains('open'), `${sa}: drawer did not open`);
      ok(txt($('h2', d)) === plain(s.t).replace(/\s+/g, ' '), `${sa}: drawer title “${txt($('h2', d))}”`);
      ok(txt($('.d-top small', d)).startsWith(`Side quest ${n} · step ${i + 1} of ${q.steps.length}`), `${sa}: drawer counter`);
      const sec = Object.fromEntries($$('.dsec', d).map((x) => [txt($('h4', x)), x]));
      const before = human(q, i);
      const hint = s.who === 'X' ? 'No log-in: the platform does this on its own.'
        : R[s.who].side === 'SJVN' ? `Sign-in page › Quick Demo Login › “${R[s.who].demo}”.` : `Sign in with the ${R[s.who].short.toLowerCase()} company’s own email and password.`;
      const login = s.who === 'X' ? hint : before === s.who ? 'Same log-in as the step before.' : `${before ? `Log out of ${R[before].short}. ` : ''}${hint}`;
      ok(body(sec['Log-in']) === login, `${sa}: log-in reads “${body(sec['Log-in'])}”, expected “${login}”`);
      ok(!!sec.Where === !!s.where, `${sa}: Where section`);
      ok($$('.ui', sec.Press || d.ownerDocument.createElement('i')).length === (s.press || []).length, `${sa}: Press buttons`);
      ok($$('li', sec['Fill in'] || document.createElement('i')).length === (s.fill || []).length, `${sa}: Fill in items`);
      ok(!!sec.Result === !!s.res, `${sa}: Result section`);
      ok($$('li', sec['What the platform applies'] || document.createElement('i')).length === (s.rules || []).length, `${sa}: rules`);
      ok($$('.quote', sec['If it refuses, you see'] || document.createElement('i')).length === (s.refuse || []).length, `${sa}: refusals`);
      ok(!!sec['Blocked for the wrong role'] === !!s.block, `${sa}: block section`);
      Object.entries(s.lists || {}).forEach(([h, items]) => ok($$('li', sec[h] || document.createElement('i')).length === items.length, `${sa}: list “${h}”`));
      const next = q.steps[i + 1];
      const nextWant = next ? `${next.who !== s.who ? (next.who === 'X' ? 'The platform takes over: ' : `Hand over to ${R[next.who].name}: `) : 'Same person: '}${plain(next.t)}`
        : n < QUESTS.length ? `Quest complete. Next side quest: ${QUESTS[n].name}.` : 'That was the last side quest. The board shows which are still open.';
      ok(body(sec.Next) === nextWant.replace(/\s+/g, ' '), `${sa}: Next reads “${body(sec.Next)}”, expected “${nextWant}”`);
      const [pv, nx] = $$('.dnav .btn', d);
      ok(pv.disabled === (i === 0) && nx.disabled === !next, `${sa}: previous/next buttons`);
      if (next) { await click(nx); ok(txt($('h2', d)) === plain(next.t).replace(/\s+/g, ' '), `${sa}: “Next step →” opened “${txt($('h2', d))}”`); }
      await key('Escape');
      ok(!d.classList.contains('open'), `${sa}: Escape did not close the drawer`);
    }

    // Play it through
    await click(`[data-play="${id}"]`);
    ok(document.body.classList.contains('playing'), `${at}: play did not start`);
    let switches = 0;
    for (let i = 0; i < q.steps.length; i++) {
      const hud = $('#hud');
      ok(!hud.hidden && txt($('.hud-txt small', hud)).startsWith(`Step ${i + 1} of ${q.steps.length}`), `${at}: HUD at step ${i + 1} reads “${txt($('.hud-txt small', hud))}”`);
      ok($(`.step[data-step="${id}:${i}"]`).classList.contains('cur'), `${at}: step ${i + 1} not highlighted`);
      const last = i === q.steps.length - 1;
      ok(txt($('[data-hud="next"]')) === (last ? 'Finish' : 'Next →'), `${at}: HUD button at step ${i + 1}`);
      await click('[data-hud="next"]');
      if (last) break;
      const to = q.steps[i + 1].who; const from = human(q, i + 1);
      const sw = $('#switch'); const expect = to !== 'X' && from !== to;
      ok(!sw.hidden === expect, `${at}: switch dialog ${sw.hidden ? 'missing' : 'shown'} before step ${i + 2}`);
      if (!sw.hidden) {
        switches++;
        ok(txt($('h3', sw)) === `${from ? 'Log out, then log in' : 'Log in'} as ${R[to].name}`, `${at}: switch reads “${txt($('h3', sw))}”`);
        ok(from ? txt($('.sw-from', sw)).endsWith(R[from].short) : !$('.sw-from', sw), `${at}: switch logs out of “${txt($('.sw-from', sw))}”, expected ${from ? R[from].short : 'nobody'}`);
        await click($('[data-sw="go"]', sw));
        ok(sw.hidden, `${at}: Continue did not close the switch`);
      }
    }
    const wantSw = q.steps.filter((s, i) => i && s.who !== 'X' && human(q, i) !== s.who).length;
    ok(switches === wantSw, `${at}: ${switches} switch dialogs, expected ${wantSw}`);
    const fin = $('#switch');
    ok(!fin.hidden && txt($('.eyebrow', fin)) === `Side quest ${n} complete`, `${at}: finish dialog`);
    const gain = q.steps.length * 10;
    ok(txt($('.sw-hint', fin)) === `${q.steps.length} steps, ${logins(q)} log-ins. Marking it done adds ${gain} XP.`, `${at}: finish reads “${txt($('.sw-hint', fin))}”`);
    await click($('[data-sw="done"]', fin));
    xp += gain;
    ok(stored().done?.[id] === true, `${at}: not saved as done under ${id}`);
    const nx = QUESTS[n];
    ok(nx ? txt($('h1')) === nx.name : !!$('.sq'), `${at}: after “Mark done” the page shows “${txt($('h1'))}”`);
    ok(!document.body.classList.contains('playing') && $('#hud').hidden, `${at}: play mode left on`);
    ok($('#xp .xp-n')?.textContent.startsWith(`${xp} /`), `${at}: XP reads “${txt($('#xp .xp-n'))}”, expected ${xp}`);
  }

  // The board
  await route('#quests');
  ok($$('.sqc').length === QUESTS.length, `board: ${$$('.sqc').length} cards`);
  ok(JSON.stringify($$('h2.side-h').map(txt)) === JSON.stringify(QZONES.map(([, l]) => l)), `board: zone headings ${$$('h2.side-h').map(txt)}`);
  ok($$('.sqc.done').length === QUESTS.length, `board: ${$$('.sqc.done').length} marked done`);
  ok(txt($('.lede')).includes(`${QUESTS.length} of ${QUESTS.length} done`), 'board: done count');
  QZONES.forEach(([z], k) => {
    const grid = $$('.sq')[k]; const want = QUESTS.filter((q) => q.zone === z).map((q) => q.name);
    ok(JSON.stringify($$('h3', grid).map(txt)) === JSON.stringify(want), `board: zone ${z} lists ${$$('h3', grid).map(txt)}`);
  });
  // Toggle one back to not done from its own page
  await route('#q3'); await click('[data-done="q3"]');
  ok(stored().done?.q3 === false && txt($('[data-done="q3"]')).includes('Mark as done'), 'Mark as done does not toggle back');
  await click('[data-done="q3"]');

  // Routing
  for (const [h, want] of [['#q0', 'quests'], ['#q24', 'quests'], ['#q999', 'quests'], ['#qx', 'map'], ['#q23', 'q23']]) {
    await route(h);
    const cur = $('#tabs [aria-current="page"]')?.dataset.go;
    ok(cur === (want === 'q23' ? 'quests' : want) && (want !== 'q23' || txt($('h1')) === QUESTS[22].name), `route ${h} lands on ${cur} “${txt($('h1'))}”`);
  }
  await route('#q5'); await route('#q6'); history.back(); await sleep(150);
  ok(txt($('h1')) === QUESTS[4].name, `back from q6 shows “${txt($('h1'))}”`);

  // Keyboard play
  await route('#q2'); await click('[data-play="q2"]');
  await key('ArrowRight'); await sleep(60);
  ok(!$('#switch').hidden, 'keyboard: → did not bring the switch for the checker');
  await key('Enter');
  ok($('#switch').hidden && txt($('.hud-txt small')).startsWith('Step 2 of'), 'keyboard: Enter on the switch did not continue');
  await key('ArrowLeft');
  ok(txt($('.hud-txt small')).startsWith('Step 1 of'), 'keyboard: ← did not step back');
  await key('Escape');
  ok($('#hud').hidden && !document.body.classList.contains('playing'), 'keyboard: Escape did not stop play');

  // Players: each role's side quests
  await route('#players');
  for (const k of ['M', 'C', 'H', 'F', 'G', 'A', 'S', 'B']) {
    const card = $('#p-' + k); const want = QUESTS.filter((q) => q.steps.some((s) => s.who === k || (s.alt || []).includes(k)));
    const chips = $$('details summary', card).find((x) => txt(x).startsWith('Side quests'));
    ok(want.length ? chips && txt(chips) === `Side quests (${want.length})` : !chips, `players: ${R[k].short} lists ${chips ? txt(chips) : 'no'} side quests, expected ${want.length}`);
  }
  const chip = $('#p-F [data-go^="q"]'); const target = chip?.dataset.go;
  if (chip) { await click(chip); ok(location.hash === '#' + target, `players: chip went to ${location.hash}`); }

  window.removeEventListener('error', onErr); window.removeEventListener('unhandledrejection', onErr);
  ok(!errors.length, `page errors: ${errors.join(' | ')}`);
  return { checked, failures: fails };
}
