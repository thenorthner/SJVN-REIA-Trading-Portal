// Builds the functional-tree PDF: vertical → module → functionality, each
// functionality opened out to input / who / output / rules.
//
//   node tools/functional-tree/build.mjs
//
// Two passes. The first lays the document out and reads back which page each
// module landed on; the second prints those page numbers into the tree, so the
// printed copy can be navigated the way the PDF's links can.

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { verticals, allFns, totals, DOC_DATE } from './model.mjs';
import { systems, roles, glossary, sources } from './data/appendix.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const BUILD = path.join(HERE, '.build');
const OUT_PDF = path.join(ROOT, 'docs', 'SJVN_Platform_Functional_Tree_2026-10-01.pdf');
const CHROME = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

/* ---------------------------------------------------------------- model */

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const MARK = { live: '●', partial: '◐', pending: '○' };
const WORD = { live: 'In the platform', partial: 'Partly in place', pending: 'Not yet live' };

/* ----------------------------------------------------------------- html */

const pg = (pages, key) => (pages[key] ? String(pages[key]) : '–');
const list = (items) => `<ul>${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`;
const firstSentence = (s) => { const m = /^(.*?[.!?])(\s|$)/s.exec(s); return m ? m[1] : s; };

function cover() {
  return `
<section class="cover">
  <div class="cover-rule"></div>
  <p class="cover-org">SJVN Limited</p>
  <h1>Integrated RE Commercial, Billing, Settlement and Power Trading Platform</h1>
  <p class="cover-title">Functional tree</p>
  <p class="cover-sub">Vertical → module → functionality, with the input, the person responsible, the output and the governing rules of each</p>
  <table class="cover-facts">
    <tr><td>Verticals</td><td>3 — REIA, Hydro billing, Power trading</td></tr>
    <tr><td>Modules</td><td>${totals.modules} (a module used by more than one vertical is shown in each)</td></tr>
    <tr><td>Functionalities</td><td>${totals.fns}</td></tr>
    <tr><td>Basis</td><td>Committee scope CP-11-43 (sections 3A–3D), workflows CP-53-57 and CP-83-85, CERC regulations, and the platform as built</td></tr>
    <tr><td>Position as on</td><td>${DOC_DATE}, test server</td></tr>
    <tr><td>Status of this paper</td><td>Draft for review</td></tr>
  </table>
  <div class="cover-rule bottom"></div>
</section>`;
}

function about() {
  return `
<section class="page about">
  <div class="kicker">FRONT MATTER A</div>
  <h2>How to read this document</h2>
  <div class="about-grid">
    <div>
      <h3>What it is</h3>
      <p>The platform is set out as a tree with three levels. A <b>vertical</b> is a line of SJVN's business. A <b>module</b> is a
      branch of that vertical — one area of work. A <b>functionality</b> is a leaf — one thing the module does or has to do.</p>
      <p>Screens, layouts and menu names are left out on purpose, because they will change. What is listed is what each module
      does: what goes in, who does it, what comes out, and the rule that governs it.</p>
      <h3>How to find something</h3>
      <ol>
        <li>Go to <b>the tree</b> on the next page and pick the vertical.</li>
        <li>Pick the module under it. The page number is printed beside it; in the PDF the name is also a link.</li>
        <li>The module page opens with a summary, then a table with one row per functionality.</li>
      </ol>
      <p>Numbering follows the tree: <b>1</b> is a vertical, <b>1.12</b> a module, <b>1.12.4</b> a functionality. A reference such as 1.12.4
      can be quoted in a note or a meeting and found again.</p>
      <h3>Modules shared between verticals</h3>
      <p>Where the same module serves more than one vertical — deviation settlement, debit and credit notes, finance posting,
      notifications, users and audit, master data and others — it is printed in full under <b>each</b> vertical that uses it, worded for
      that vertical, and marked <span class="tag shared">◆ shared</span>. The table after the tree lists them.</p>
    </div>
    <div>
      <h3>What each module page holds</h3>
      <table class="plain">
        <tr><td>Purpose</td><td>Why the module exists.</td></tr>
        <tr><td>Scope reference</td><td>The clause of the committee scope, or the regulation, it answers to.</td></tr>
        <tr><td>Who does it</td><td>The roles involved.</td></tr>
        <tr><td>Inputs / Outputs</td><td>What the module takes in and produces.</td></tr>
        <tr><td>Governing rules</td><td>The rules that hold across the module.</td></tr>
        <tr><td>Takes from / Feeds</td><td>The modules before and after it.</td></tr>
        <tr><td>Functionalities</td><td>One row each: what it does, input, done by, output, rules and controls.</td></tr>
      </table>
      <h3>Status marks</h3>
      <table class="plain">
        <tr><td><span class="mk">●</span> In the platform</td><td>Built and running on the test server.</td></tr>
        <tr><td><span class="mk">◐</span> Partly in place</td><td>Works, with a stated gap.</td></tr>
        <tr><td><span class="mk">○</span> Not yet live</td><td>In scope; waiting on an outside party or a decision. The reason is given in the row.</td></tr>
      </table>
      <p class="fine">Of ${totals.fns} functionalities: ${totals.live} in the platform, ${totals.partial} partly in place, ${totals.pending} not yet live.
      A module shared by three verticals is counted three times in these figures.</p>
      <p class="fine"><b>Basis of the status.</b> The position is taken from the status notes of 11–28 September 2026 and from the
      software itself, as on ${DOC_DATE}, on the test server. Each line was not re-tested for this paper, and none of it is
      in production use yet. Appendix B gathers every item that is not yet live.</p>
    </div>
  </div>
</section>`;
}

function masterTree(pages) {
  const col = (v) => `
    <div class="tcol v-${v.id}">
      <a class="vbox" href="#v-${v.no}"><span class="vno">${v.no}</span><span class="vname">${esc(v.short)}</span><span class="vpg">p. ${pg(pages, `V${v.no}`)}</span></a>
      <ul class="branches">
        ${v.modules.map((m) => `
        <li><a href="#${m.id}"><span class="bno">${m.no}</span><span class="bname">${esc(m.name)}${m.sharedWith?.length ? ' <span class="dia">◆</span>' : ''}</span><span class="bmk">${MARK[m.status]}</span><span class="bpg">${pg(pages, `M${m.no}`)}</span></a></li>`).join('')}
      </ul>
    </div>`;
  return `
<section class="page tree-page">
  <div class="kicker">FRONT MATTER B</div>
  <h2>The tree — verticals and their modules</h2>
  <p class="lead">Each line is a module; the number on the right is its page. ◆ marks a module shared with another vertical.
  ● in the platform · ◐ partly in place · ○ not yet live.</p>
  <div class="tree">
    <div class="root">SJVN commercial and trading platform</div>
    <div class="tcols">${verticals.map(col).join('')}</div>
  </div>
</section>`;
}

function sharedMatrix(pages) {
  const names = new Map();
  for (const v of verticals) for (const m of v.modules) {
    if (!m.sharedWith?.length) continue;
    const key = m.name.replace(/ — .*$/, '').replace(/\s*\(.*\)$/, '').replace(/^Dashboards.*$/, 'Dashboards, MIS and reports').replace(/^Finance.*$/, 'Finance posting and SAP').replace(/^Reconciliation.*$/, 'Reconciliation');
    if (!names.has(key)) names.set(key, {});
    names.get(key)[v.id] = m;
  }
  const cell = (m) => (m ? `<a href="#${m.id}">${m.no}</a> <span class="pgref">p. ${pg(pages, `M${m.no}`)}</span>` : '<span class="na">—</span>');
  const rows = [...names.entries()].map(([k, o]) => `<tr><td>${esc(k)}</td><td>${cell(o.reia)}</td><td>${cell(o.hydro)}</td><td>${cell(o.trading)}</td></tr>`).join('');
  const apx = [
    ['A', 'External systems and interfaces'],
    ['B', 'Items not yet live, and what each waits on'],
    ['C', 'Roles'],
    ['D', 'Glossary'],
    ['E', 'Sources'],
  ];
  return `
<section class="page">
  <div class="kicker">FRONT MATTER C</div>
  <h2>Modules shared between verticals, and the appendices</h2>
  <div class="two">
    <div>
      <p class="lead">A shared module is printed under every vertical that uses it. This table shows where each one appears.</p>
      <table class="grid matrix">
        <thead><tr><th>Shared module</th><th>REIA</th><th>Hydro billing</th><th>Power trading</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div>
      <p class="lead">Appendices at the end of the document.</p>
      <table class="grid">
        <thead><tr><th style="width:14mm">App.</th><th>Contents</th><th style="width:16mm">Page</th></tr></thead>
        <tbody>${apx.map(([k, t]) => `<tr><td><a href="#apx-${k}">${k}</a></td><td>${esc(t)}</td><td>${pg(pages, `A${k}`)}</td></tr>`).join('')}</tbody>
      </table>
      <p class="lead" style="margin-top:6mm">Sections of each vertical.</p>
      <table class="grid">
        <thead><tr><th>Vertical</th><th style="width:22mm">Overview</th><th style="width:22mm">Branch map</th><th style="width:26mm">Modules from</th></tr></thead>
        <tbody>${verticals.map((v) => `<tr><td>${v.no} ${esc(v.short)}</td><td>p. ${pg(pages, `V${v.no}`)}</td><td>p. ${pg(pages, `B${v.no}`)}</td><td>p. ${pg(pages, `M${v.modules[0].no}`)}</td></tr>`).join('')}</tbody>
      </table>
    </div>
  </div>
</section>`;
}

function verticalOverview(v, pages) {
  const fnCount = v.modules.reduce((a, m) => a + m.fns.length, 0);
  return `
<section class="page v-${v.id} voverview" id="v-${v.no}">
  <div class="kicker">VERTICAL ${v.no}</div>
  <h2 class="vtitle">${esc(v.name)}</h2>
  <div class="vmeta"><b>${v.modules.length}</b> modules · <b>${fnCount}</b> functionalities</div>
  <div class="two wide-left">
    <div>
      <h3>What this vertical is</h3>
      <p>${esc(v.purpose)}</p>
      <h3>Basis</h3>
      <p>${esc(v.basis)}</p>
    </div>
    <div>
      <h3>Who is involved</h3>
      <table class="plain actors">${v.actors.map(([a, b]) => `<tr><td>${esc(a)}</td><td>${esc(b)}</td></tr>`).join('')}</table>
    </div>
  </div>
  <h3>The work from end to end</h3>
  <div class="flow">${v.flow.map(([t, d], i) => `<div class="step"><div class="sn">${i + 1}</div><div class="st">${esc(t)}</div><div class="sd">${esc(d)}</div></div>`).join('<div class="arrow">▸</div>')}</div>
</section>
<section class="page v-${v.id}">
  <div class="kicker">VERTICAL ${v.no} · MODULES</div>
  <h2>${esc(v.short)} — the modules</h2>
  <table class="grid modlist">
    <thead><tr><th style="width:11mm">No.</th><th style="width:66mm">Module</th><th>What it is for</th><th style="width:30mm">Scope reference</th><th style="width:13mm">Leaves</th><th style="width:12mm">Status</th><th style="width:11mm">Page</th></tr></thead>
    <tbody>${v.modules.map((m) => `
      <tr><td>${m.no}</td><td><a href="#${m.id}">${esc(m.name)}</a>${m.sharedWith?.length ? ' <span class="dia">◆</span>' : ''}</td><td>${esc(firstSentence(m.purpose))}</td><td class="sm">${esc(m.scope.split(';')[0])}</td><td class="c">${m.fns.length}</td><td class="c mk">${MARK[m.status]}</td><td class="c">${pg(pages, `M${m.no}`)}</td></tr>`).join('')}
    </tbody>
  </table>
</section>`;
}

function branchMap(v, pages) {
  return `
<section class="page v-${v.id} bmap" id="b-${v.no}">
  <div class="kicker">BRANCH MAP ${v.no}</div>
  <h2>${esc(v.short)} — every branch and its leaves</h2>
  <p class="lead">Modules with the functionalities under each. The detail of every leaf is on the module's page.</p>
  <div class="bcols">
    ${v.modules.map((m) => `
    <div class="bmod">
      <a class="bhead" href="#${m.id}"><span class="bno">${m.no}</span><span class="bname">${esc(m.name)}${m.sharedWith?.length ? ' ◆' : ''}</span><span class="bpg">p. ${pg(pages, `M${m.no}`)}</span></a>
      <ul>${m.fns.map((fn) => `<li><span class="lno">${fn.no}</span><span class="lname">${esc(fn.name)}</span><span class="lmk">${fn.status.kind === 'live' ? '' : MARK[fn.status.kind]}</span></li>`).join('')}</ul>
    </div>`).join('')}
  </div>
</section>`;
}

function modulePage(v, m) {
  const shared = m.sharedWith?.length ? `<span class="tag shared">◆ shared with ${esc(m.sharedWith.join(' and '))}</span>` : '';
  const related = m.relatedIn?.length ? `<p class="related"><b>See also:</b> ${esc(m.relatedIn.join('; '))}.</p>` : '';
  const open = m.open?.length ? `<p class="related"><b>Decision open:</b> ${esc(m.open.join(' '))}</p>` : '';
  return `
<section class="module v-${v.id}" id="${m.id}">
  <div class="mhead">
    <div class="crumb">MODULE ${m.no} <span class="sep">·</span> ${esc(v.short)}</div>
    <h2>${esc(m.name)}</h2>
    <div class="chips"><span class="tag">${esc(m.scope)}</span>${shared}<span class="tag st-${m.status}">${MARK[m.status]} ${WORD[m.status]}</span></div>
  </div>
  <div class="msum">
    <div class="box purpose"><h4>Purpose</h4><p>${esc(m.purpose)}</p>${related}${open}</div>
    <div class="box rules"><h4>Governing rules</h4>${list(m.rules)}</div>
    <div class="box"><h4>Who does it</h4>${list(m.who)}</div>
    <div class="box"><h4>Inputs</h4>${list(m.inputs)}</div>
    <div class="box"><h4>Outputs</h4>${list(m.outputs)}</div>
    <div class="box links"><h4>Takes from</h4><p>${esc(m.dependsOn.join(' · '))}</p><h4>Feeds</h4><p>${esc(m.feedsInto.join(' · '))}</p></div>
  </div>
  <div class="strip"><span class="node">${m.no}</span>${m.fns.map((fn) => `<span class="leaf"><b>${fn.no.split('.').pop()}</b> ${esc(fn.name)}${fn.status.kind === 'live' ? '' : ` <i>${MARK[fn.status.kind]}</i>`}</span>`).join('')}</div>
  <table class="grid fns">
    <colgroup><col class="c-no"><col class="c-name"><col class="c-what"><col class="c-in"><col class="c-who"><col class="c-out"><col class="c-rule"></colgroup>
    <thead>
      <tr class="cont"><th colspan="7">${m.no} ${esc(m.name)} — functionalities</th></tr>
      <tr><th class="c-no">No.</th><th class="c-name">Functionality</th><th class="c-what">What it does</th><th class="c-in">Input</th><th class="c-who">Done by</th><th class="c-out">Output</th><th class="c-rule">Rules and controls</th></tr>
    </thead>
    <tbody>${m.fns.map((fn) => `
      <tr class="${fn.status.kind}">
        <td class="c-no">${fn.no}<div class="rowmk">${MARK[fn.status.kind]}</div></td>
        <td class="c-name">${esc(fn.name)}</td>
        <td>${esc(fn.what)}</td>
        <td>${esc(fn.input)}</td>
        <td>${esc(fn.who)}</td>
        <td>${esc(fn.output)}</td>
        <td>${esc(fn.rules)}${fn.status.kind === 'live' ? '' : `<div class="stnote"><b>${fn.status.kind === 'pending' ? 'Not yet live' : 'Partly in place'}:</b> ${esc(fn.status.note)}.</div>`}</td>
      </tr>`).join('')}
    </tbody>
  </table>
</section>`;
}

function appendixSystems() {
  return `
<section class="page apx" id="apx-A">
  <div class="kicker">APPENDIX A</div>
  <h2>External systems and interfaces</h2>
  <p class="lead">Every outside system the platform talks to or will talk to, and where each stands on ${DOC_DATE}.</p>
  <table class="grid">
    <thead><tr><th style="width:44mm">System</th><th style="width:58mm">Used for</th><th style="width:30mm">Verticals</th><th style="width:26mm">Direction</th><th>Position</th><th style="width:52mm">Waiting on</th></tr></thead>
    <tbody>${systems.map((s) => `<tr><td><b>${esc(s[0])}</b></td><td>${esc(s[1])}</td><td>${esc(s[2])}</td><td>${esc(s[3])}</td><td><span class="mk">${MARK[s[4]]}</span> ${esc(s[5])}</td><td>${esc(s[6])}</td></tr>`).join('')}</tbody>
  </table>
</section>`;
}

function appendixOpen() {
  const groups = new Map();
  for (const x of allFns.filter((y) => y.status.kind !== 'live')) {
    const key = `${x.name}|${x.status.note}`;
    if (!groups.has(key)) groups.set(key, { ...x, refs: [] });
    groups.get(key).refs.push(x.no);
  }
  const rows = [...groups.values()].sort((a, b) => (a.status.kind === b.status.kind ? 0 : a.status.kind === 'pending' ? -1 : 1));
  return `
<section class="page apx" id="apx-B">
  <div class="kicker">APPENDIX B</div>
  <h2>Items not yet live, and what each waits on</h2>
  <p class="lead">Gathered from the module pages. An item shared by several verticals is listed once with all its references.</p>
  <table class="grid">
    <thead><tr><th style="width:9mm"></th><th style="width:38mm">Reference</th><th style="width:62mm">Functionality</th><th style="width:60mm">Module</th><th>What it waits on</th></tr></thead>
    <tbody>${rows.map((x) => `<tr><td class="c mk">${MARK[x.status.kind]}</td><td>${x.refs.join(', ')}</td><td>${esc(x.name)}</td><td>${esc(x.module.name)}</td><td>${esc(x.status.note.charAt(0).toUpperCase() + x.status.note.slice(1))}</td></tr>`).join('')}</tbody>
  </table>
</section>`;
}

function appendixRest() {
  return `
<section class="page apx" id="apx-C">
  <div class="kicker">APPENDIX C</div>
  <h2>Roles</h2>
  <p class="lead">The roles the platform recognises. What a role may do is enforced on the server for every request.</p>
  <table class="grid">
    <thead><tr><th style="width:46mm">Role</th><th style="width:40mm">Belongs to</th><th>What the role does</th></tr></thead>
    <tbody>${roles.map((r) => `<tr><td><b>${esc(r[0])}</b></td><td>${esc(r[1])}</td><td>${esc(r[2])}</td></tr>`).join('')}</tbody>
  </table>
</section>
<section class="page apx" id="apx-D">
  <div class="kicker">APPENDIX D</div>
  <h2>Glossary</h2>
  <div class="gloss">${glossary.map((g) => `<p><b>${esc(g[0])}</b> — ${esc(g[1])}</p>`).join('')}</div>
</section>
<section class="page apx" id="apx-E">
  <div class="kicker">APPENDIX E</div>
  <h2>Sources</h2>
  <table class="grid">
    <thead><tr><th style="width:80mm">Source</th><th>What was taken from it</th></tr></thead>
    <tbody>${sources.map((s) => `<tr><td><b>${esc(s[0])}</b></td><td>${esc(s[1])}</td></tr>`).join('')}</tbody>
  </table>
</section>`;
}

const CSS = `
@page { size: A4 landscape; margin: 12mm 12mm 14mm 12mm;
  @bottom-left { content: "SJVN platform — functional tree · draft of ${DOC_DATE}"; font: 7.5pt "Helvetica Neue", Arial, sans-serif; color: #666; }
  @bottom-right { content: "Page " counter(page) " of " counter(pages); font: 7.5pt "Helvetica Neue", Arial, sans-serif; color: #666; } }
@page cover { margin: 0; @bottom-left { content: none; } @bottom-right { content: none; } }
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin: 0; font: 8.6pt/1.36 "Helvetica Neue", Arial, sans-serif; color: #1c1c1c; }
a { color: inherit; text-decoration: none; }
h1, h2, h3 { font-family: Georgia, "Times New Roman", serif; font-weight: normal; margin: 0; }
h2 { font-size: 17pt; line-height: 1.15; margin-bottom: 2.5mm; }
h3 { font-size: 10.5pt; margin: 4mm 0 1.2mm; font-weight: bold; }
h4 { font: bold 7pt/1.2 "Helvetica Neue", Arial, sans-serif; margin: 0 0 1mm; color: #555; }
p { margin: 0 0 1.8mm; }
ul, ol { margin: 0; padding-left: 4mm; }
li { margin-bottom: 0.7mm; }
.page { break-before: page; }
.kicker { font: bold 7.2pt/1 "Helvetica Neue", Arial, sans-serif; color: #666; margin-bottom: 1.6mm; }
.lead { color: #444; margin-bottom: 3mm; }
.fine { font-size: 7.8pt; color: #444; }
.two { display: grid; grid-template-columns: 1fr 1fr; gap: 9mm; }
.two.wide-left { grid-template-columns: 1.15fr 1fr; }
.mk { font-size: 9pt; }
.c { text-align: center; }
.sm { font-size: 7.4pt; color: #444; }
.tag { display: inline-block; border: 0.6pt solid #999; border-radius: 2pt; padding: 0.5mm 1.6mm; font-size: 7.3pt; margin: 0 1.5mm 1mm 0; background: #fff; }
.tag.shared { border-color: #333; font-weight: bold; }
.tag.st-live { border-color: #2c6e49; }
.tag.st-partial { border-color: #8a6d1b; }
.tag.st-pending { border-color: #8a2c2c; }
.dia { font-size: 7pt; }

/* vertical accents */
.v-reia { --acc: #1f6f5c; --tint: #eaf3f0; }
.v-hydro { --acc: #1d4e89; --tint: #e9eff7; }
.v-trading { --acc: #8a4b14; --tint: #f6eee6; }

/* cover */
.cover { page: cover; height: 210mm; padding: 34mm 30mm 0; position: relative; break-after: page; }
.cover-rule { height: 1.6mm; background: #1c1c1c; width: 60mm; margin-bottom: 14mm; }
.cover-rule.bottom { position: absolute; bottom: 22mm; left: 30mm; width: 237mm; height: 0.5mm; margin: 0; }
.cover-org { font: bold 10pt "Helvetica Neue", Arial, sans-serif; margin-bottom: 4mm; }
.cover h1 { font-size: 19pt; max-width: 190mm; line-height: 1.2; color: #333; }
.cover-title { font: normal 46pt/1 Georgia, serif; margin: 10mm 0 5mm; }
.cover-sub { font-size: 11pt; max-width: 180mm; color: #333; margin-bottom: 14mm; }
.cover-facts { border-collapse: collapse; font-size: 9.5pt; }
.cover-facts td { padding: 1.6mm 8mm 1.6mm 0; vertical-align: top; border-top: 0.4pt solid #bbb; }
.cover-facts td:first-child { font-weight: bold; width: 44mm; }

/* about */
.about-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10mm; font-size: 9.2pt; }
table.plain { border-collapse: collapse; width: 100%; }
table.plain td { padding: 1.1mm 3mm 1.1mm 0; vertical-align: top; border-top: 0.4pt solid #ccc; }
table.plain td:first-child { font-weight: bold; width: 38mm; }
table.actors td:first-child { width: 36mm; }

/* master tree */
.tree { margin-top: 2mm; }
.root { width: 92mm; margin: 0 auto; text-align: center; border: 1pt solid #1c1c1c; padding: 1.8mm; font: bold 10pt Georgia, serif; position: relative; }
.root::after { content: ""; position: absolute; left: 50%; bottom: -4.5mm; height: 4.5mm; border-left: 1pt solid #1c1c1c; }
.tcols { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6mm; margin-top: 9mm; position: relative; }
.tcols::before { content: ""; position: absolute; top: -4.5mm; left: 16.2%; right: 16.2%; border-top: 1pt solid #1c1c1c; }
.tcol { position: relative; }
.tcol::before { content: ""; position: absolute; top: -4.5mm; left: 50%; height: 4.5mm; border-left: 1pt solid #1c1c1c; }
.vbox { display: flex; align-items: baseline; gap: 2mm; background: var(--acc); color: #fff; padding: 1.7mm 2.5mm; font: bold 10pt Georgia, serif; }
.vbox .vname { flex: 1; }
.vbox .vpg { font: 7.5pt "Helvetica Neue", Arial, sans-serif; }
ul.branches { list-style: none; margin: 0 0 0 3mm; padding: 1.2mm 0 0 0; border-left: 0.9pt solid var(--acc); }
ul.branches li { margin: 0; position: relative; padding-left: 4mm; }
ul.branches li::before { content: ""; position: absolute; left: 0; top: 2.25mm; width: 3mm; border-top: 0.9pt solid var(--acc); }
ul.branches a { display: flex; align-items: baseline; gap: 1.5mm; font-size: 8pt; line-height: 1.5; border-bottom: 0.3pt dotted #bbb; }
.bno { font-weight: bold; min-width: 7.5mm; color: var(--acc); }
.bname { flex: 1; }
.bmk { font-size: 7.5pt; width: 3mm; text-align: center; }
.bpg { min-width: 6mm; text-align: right; font-variant-numeric: tabular-nums; }

/* tables */
table.grid { border-collapse: collapse; width: 100%; }
table.grid th { background: #ececec; text-align: left; font: bold 7.4pt/1.2 "Helvetica Neue", Arial, sans-serif; padding: 1.3mm 1.5mm; border: 0.5pt solid #9a9a9a; }
table.grid td { padding: 1.2mm 1.5mm; border: 0.5pt solid #b5b5b5; vertical-align: top; }
table.grid tr { break-inside: avoid; }
table.grid thead { display: table-header-group; }
.matrix td:not(:first-child) { white-space: nowrap; }
.pgref { color: #555; font-size: 7.6pt; }
.na { color: #999; }
.modlist td { font-size: 8.2pt; }

/* vertical overview */
.voverview .vtitle { border-left: 3mm solid var(--acc); padding-left: 3mm; }
.vmeta { margin: 0 0 2mm 6mm; color: #444; }
.flow { display: flex; align-items: stretch; gap: 0.8mm; margin-top: 1.5mm; }
.step { flex: 1 1 0; min-width: 0; border: 0.6pt solid var(--acc); background: var(--tint); padding: 1.6mm 1.6mm 1.8mm; }
.step .sn { font: bold 7pt "Helvetica Neue", Arial, sans-serif; color: var(--acc); }
.step .st { font: bold 8.6pt Georgia, serif; margin: 0.4mm 0 0.8mm; }
.step .sd { font-size: 7.3pt; line-height: 1.28; color: #333; }
.arrow { align-self: center; color: var(--acc); font-size: 7pt; flex: 0 0 auto; }

/* branch map */
.bcols { column-count: 3; column-gap: 7mm; }
.bmod { break-inside: avoid; margin-bottom: 3mm; }
.bhead { display: flex; gap: 1.5mm; align-items: baseline; background: var(--tint); border-left: 1.4mm solid var(--acc); padding: 0.9mm 1.5mm; font-weight: bold; font-size: 8.2pt; }
.bmod ul { list-style: none; margin: 0 0 0 2mm; padding: 0.6mm 0 0; border-left: 0.7pt solid var(--acc); }
.bmod li { margin: 0; padding-left: 3.5mm; position: relative; display: flex; gap: 1.5mm; font-size: 7.5pt; line-height: 1.42; }
.bmod li::before { content: ""; position: absolute; left: 0; top: 1.8mm; width: 2.6mm; border-top: 0.7pt solid var(--acc); }
.lno { min-width: 9.5mm; color: #555; font-variant-numeric: tabular-nums; }
.lname { flex: 1; }
.lmk { font-size: 7pt; }

/* module */
.module { break-before: page; }
.mhead { border-left: 3mm solid var(--acc); padding-left: 3mm; margin-bottom: 2.5mm; }
.crumb { font: bold 7.4pt/1 "Helvetica Neue", Arial, sans-serif; color: var(--acc); margin-bottom: 1.2mm; }
.crumb .sep { color: #999; margin: 0 1mm; }
.mhead h2 { margin-bottom: 1.6mm; }
.msum { display: grid; grid-template-columns: repeat(4, 1fr); gap: 2mm; margin-bottom: 2.5mm; }
.box { border: 0.5pt solid #b5b5b5; padding: 1.6mm 2mm; font-size: 8pt; break-inside: avoid; }
.box p { margin-bottom: 1mm; }
.box.purpose { grid-column: span 2; background: var(--tint); border-color: var(--acc); font-size: 8.6pt; }
.box.rules { grid-column: span 2; }
.related { font-size: 7.6pt; color: #333; margin-top: 1.5mm; }
.strip { display: flex; flex-wrap: wrap; align-items: center; gap: 1mm 1.2mm; margin-bottom: 2.2mm; padding-left: 0; break-inside: avoid; }
.strip .node { background: var(--acc); color: #fff; font-weight: bold; padding: 0.7mm 2mm; font-size: 8pt; margin-right: 1mm; }
.strip .leaf { border: 0.5pt solid var(--acc); padding: 0.4mm 1.4mm; font-size: 7.1pt; background: #fff; }
.strip .leaf b { color: var(--acc); margin-right: 0.6mm; }
.strip .leaf i { font-style: normal; }
table.fns { font-size: 7.9pt; line-height: 1.32; table-layout: fixed; }
table.fns tr.cont th { background: var(--acc); color: #fff; border-color: var(--acc); font-size: 7.6pt; }
col.c-no { width: 13mm; } col.c-name { width: 33mm; } col.c-what { width: 54mm; } col.c-in { width: 41mm; } col.c-who { width: 30mm; } col.c-out { width: 43mm; }
td.c-no { font-weight: bold; color: var(--acc); font-variant-numeric: tabular-nums; }
td.c-name { font-weight: bold; }
.rowmk { font-weight: normal; color: #1c1c1c; font-size: 8.5pt; margin-top: 0.6mm; }
.stnote { margin-top: 1.2mm; padding: 0.9mm 1.4mm; border-left: 1mm solid #8a2c2c; background: #f7efef; font-size: 7.5pt; }
tr.partial .stnote { border-left-color: #8a6d1b; background: #f8f4e6; }

/* appendix */
.gloss { column-count: 3; column-gap: 8mm; font-size: 8.3pt; }
.gloss p { break-inside: avoid; margin-bottom: 1.6mm; }
`;

function render(pages = {}) {
  const body = [
    cover(),
    about(),
    masterTree(pages),
    sharedMatrix(pages),
    ...verticals.flatMap((v) => [verticalOverview(v, pages), branchMap(v, pages), ...v.modules.map((m) => modulePage(v, m))]),
    appendixSystems(),
    appendixOpen(),
    appendixRest(),
  ].join('\n');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>SJVN platform — functional tree</title><style>${CSS}</style></head><body>${body}</body></html>`;
}

/* ---------------------------------------------------------------- build */

function printPdf(html, pdfPath) {
  const htmlPath = path.join(BUILD, 'functional-tree.html');
  writeFileSync(htmlPath, html);
  execFileSync(CHROME, [
    '--headless=new', '--disable-gpu', '--no-pdf-header-footer', '--hide-scrollbars',
    `--print-to-pdf=${pdfPath}`, pathToFileURL(htmlPath).href,
  ], { stdio: ['ignore', 'ignore', 'ignore'] });
}

/** Which page each anchor landed on, read back from the laid-out PDF. */
function readPages(pdfPath) {
  const text = execFileSync('pdftotext', ['-layout', pdfPath, '-'], { maxBuffer: 256 * 1024 * 1024 }).toString();
  const pageTexts = text.split('\f');
  const find = (re) => { const i = pageTexts.findIndex((t) => re.test(t)); return i < 0 ? null : i + 1; };
  const reNo = (label, no) => new RegExp(`${label} ${no.replace(/\./g, '\\.')}(?![\\d.])`);
  const pages = { total: pageTexts.filter((t) => t.trim()).length };
  for (const v of verticals) {
    pages[`V${v.no}`] = find(new RegExp(`VERTICAL ${v.no}\\s*$`, 'm'));
    pages[`B${v.no}`] = find(reNo('BRANCH MAP', v.no));
    for (const m of v.modules) pages[`M${m.no}`] = find(reNo('MODULE', m.no));
  }
  for (const k of ['A', 'B', 'C', 'D', 'E']) pages[`A${k}`] = find(new RegExp(`APPENDIX ${k}\\b`));
  const missing = Object.entries(pages).filter(([, p]) => p == null).map(([k]) => k);
  if (missing.length) throw new Error(`No page found for: ${missing.join(', ')}`);
  return pages;
}

if (!existsSync(CHROME)) throw new Error(`Chrome not found at ${CHROME} — set CHROME_BIN`);
mkdirSync(BUILD, { recursive: true });
mkdirSync(path.dirname(OUT_PDF), { recursive: true });

const draft = path.join(BUILD, 'pass.pdf');
let pages = {};
for (let pass = 1; pass <= 4; pass += 1) {
  printPdf(render(pages), draft);
  const next = readPages(draft);
  const settled = JSON.stringify(next) === JSON.stringify(pages);
  pages = next;
  if (settled) break;
  if (pass === 4) throw new Error('Page numbers did not settle after four passes');
}
printPdf(render(pages), OUT_PDF);

console.log(`${path.relative(ROOT, OUT_PDF)} — ${pages.total} pages; ${verticals.length} verticals, ${totals.modules} modules, ${totals.fns} functionalities (${totals.live} live, ${totals.partial} partial, ${totals.pending} pending)`);
