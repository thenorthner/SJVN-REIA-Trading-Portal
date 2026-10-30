import pathToRegexp from 'path-to-regexp';

/**
 * Every API route with the roles allowed through its requireRole gates, read
 * from the running Express app (requireRole tags each gate with `.roles`).
 * Router-level gates (router.use(requireRole(...))) and mount-level gates
 * (app.use('/api/x', requireRole(...), router)) narrow everything under them.
 *
 * `roles: null` means no role gate — public, or any signed-in user with the
 * handler deciding inline. Inline checks in handler bodies are not visible here.
 *
 * The list is in the order Express tries the routes, and each entry carries a
 * pattern for its full path, so the first entry a request matches is the route
 * that serves it. The role-matrix test reads it to prove every action has an
 * owner; the role powers read it to know what a power covers and who holds it.
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
      // router.post(['/a', '/b'], …) is one route answering two paths.
      const paths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];
      for (const p of paths) {
        const path = prefix + p;
        const pattern = pathToRegexp(path, [], { end: true, strict: false });
        for (const m of Object.keys(layer.route.methods)) out.push({ method: m.toUpperCase(), path, roles, pattern });
      }
    } else if (layer.name === 'router' && layer.handle?.stack) {
      walk(layer.handle.stack, prefix + prefixOf(layer), applicable(layer), out);
    } else if (layer.handle?.roles) {
      gates.push({ src: srcOf(layer), roles: layer.handle.roles });
    }
  }
}

export function routeInventory(app) {
  const out = [];
  walk(app._router.stack, '', null, out);
  return out;
}
