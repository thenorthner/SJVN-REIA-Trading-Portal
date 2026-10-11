// The tree as both outputs read it: numbered, with a status on every leaf.
// build.mjs prints it as the full PDF; build-deck.mjs as the summary deck.

import reia from './data/reia.mjs';
import hydro from './data/hydro.mjs';
import trading from './data/trading.mjs';

export const DOC_DATE = '1 October 2026';

function parseStatus(st) {
  if (!st) return { kind: 'live', note: '' };
  const m = /^(pending|partial):\s*(.*)$/s.exec(st);
  if (!m) throw new Error(`Unreadable status: ${st}`);
  return { kind: m[1], note: m[2] };
}

export const verticals = [reia, hydro, trading].map((v, vi) => {
  const no = String(vi + 1);
  const modules = v.modules.map((m, mi) => {
    const mno = `${no}.${mi + 1}`;
    const fns = m.fns.map((fn, fi) => ({ ...fn, no: `${mno}.${fi + 1}`, status: parseStatus(fn.st) }));
    const kinds = fns.map((x) => x.status.kind);
    const status = kinds.every((k) => k === 'live') ? 'live' : kinds.every((k) => k === 'pending') ? 'pending' : 'partial';
    return { ...m, no: mno, id: `m-${mno.replace('.', '-')}`, fns, status, vertical: v.short };
  });
  return { ...v, no, modules };
});

export const allFns = verticals.flatMap((v) => v.modules.flatMap((m) => m.fns.map((fn) => ({ ...fn, module: m, vertical: v }))));

const count = (list, kind) => list.filter((x) => x.status.kind === kind).length;

export const totals = {
  modules: verticals.reduce((a, v) => a + v.modules.length, 0),
  fns: allFns.length,
  live: count(allFns, 'live'),
  partial: count(allFns, 'partial'),
  pending: count(allFns, 'pending'),
};

/** Leaves of one vertical by status. */
export const statusOf = (v) => {
  const fns = v.modules.flatMap((m) => m.fns);
  return { fns: fns.length, live: count(fns, 'live'), partial: count(fns, 'partial'), pending: count(fns, 'pending') };
};
