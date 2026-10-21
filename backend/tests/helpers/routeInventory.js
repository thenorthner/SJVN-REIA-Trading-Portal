import { app } from '../../src/server.js';

/**
 * Every API route with the roles allowed through its requireRole gates, read
 * from the running Express app (requireRole tags each gate with `.roles`).
 * Router-level gates (router.use(requireRole(...))) and mount-level gates
 * (app.use('/api/x', requireRole(...), router)) narrow everything under them.
 *
 * `roles: null` means no role gate — public, or any signed-in user with the
 * handler deciding inline. Inline checks in handler bodies are not visible here.
 */
const srcOf = (layer) => layer.regexp.source;
const isRoot = (src) => src === '^\\/?(?=\\/|$)' || src === '^\\/?$';
const prefixOf = (layer) => (isRoot(srcOf(layer)) ? '' : srcOf(layer).replace('^\\/', '/').replace('\\/?(?=\\/|$)', '').replace(/\\\//g, '/'));
const meet = (a, b) => (a ? (b ? a.filter((r) => b.includes(r)) : a) : (b ? [...b] : null));

function walk(stack, prefix, inherited, out) {
  const gates = [];
  const applicable = (layer) => gates
    .filter((g) => isRoot(g.src) || g.src === srcOf(layer))
    .reduce((acc, g) => meet(acc, g.roles), inherited);
  for (const layer of stack) {
    if (layer.route) {
      let roles = applicable(layer);
      for (const s of layer.route.stack) if (s.handle?.roles) roles = meet(roles, s.handle.roles);
      for (const m of Object.keys(layer.route.methods)) out.push({ method: m.toUpperCase(), path: prefix + layer.route.path, roles });
    } else if (layer.name === 'router' && layer.handle?.stack) {
      walk(layer.handle.stack, prefix + prefixOf(layer), applicable(layer), out);
    } else if (layer.handle?.roles) {
      gates.push({ src: srcOf(layer), roles: layer.handle.roles });
    }
  }
}

export function routeInventory() {
  const out = [];
  walk(app._router.stack, '', null, out);
  return out;
}
