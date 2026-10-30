// Role powers (30-Oct-2026): an administrator may give a role a power or take
// one away. For a role that has been changed, the server sends with the user
// each power that lists pages, whether the role still holds it, and whether it
// was given (backend/src/services/rolePowers.js, pagesFor). A role nobody has
// changed has `pages: null` and keeps the menu as the code writes it.

const covers = (pattern, path) => (pattern.endsWith('/**')
  ? path === pattern.slice(0, -3) || path.startsWith(pattern.slice(0, -2))
  : path === pattern);

/**
 * Whether `user` may open `path`, whose menu entry or route names `roles`.
 * A page a given power covers opens; a page the menu already offers stays
 * unless every power covering it has been taken away.
 */
export function pageOpen(user, path, roles) {
  const byRole = !roles || roles.includes(user?.role);
  const powers = user?.pages;
  if (!Array.isArray(powers) || !path) return byRole;
  const covering = powers.filter((p) => p.pages.some((pattern) => covers(pattern, path)));
  if (!covering.length) return byRole;
  if (covering.some((p) => p.given)) return true;
  return byRole && covering.some((p) => p.held);
}

/**
 * Whether the role's powers, not the menu, keep `user` out of `path`: the
 * menu offers the page but an administrator took away every power behind it.
 */
export function pageWithdrawn(user, path, roles) {
  return (!roles || roles.includes(user?.role)) && !pageOpen(user, path, roles);
}

/**
 * The first page a changed role can still open, for landing there instead of
 * on a page its powers no longer reach. `allow` narrows the choice (the beta
 * passes its own address check). Null for an unchanged role.
 */
export function firstOpenPage(user, allow = () => true) {
  if (!Array.isArray(user?.pages)) return null;
  for (const power of user.pages) {
    if (!power.held && !power.given) continue;
    const page = power.pages.find((p) => !p.endsWith('/**') && allow(p) && pageOpen(user, p));
    if (page) return page;
  }
  return null;
}

/**
 * The role a screen is drawn for. Where an administrator gave the role a power
 * its own role does not draw buttons for (a Finance-like role approving bills),
 * the server lists the screens and the role to draw them as (`user.screens`,
 * backend rolePowers.js screensFor); elsewhere the user's own role.
 */
export function screenRole(user, path) {
  return screenRoles(user, path)[0];
}

/**
 * Every role a screen draws the controls of: the one it is drawn as first,
 * then the roles of the other powers given on it and the user's own role. A
 * Finance-like role given the first-level approval of bills sees both the
 * checker's buttons and Finance's own on the bills screen (actsAs). Reading
 * the whole desk is not a role to draw: it would only take buttons away.
 */
export function screenRoles(user, path) {
  // How closely a list of patterns names the page: an exact address beats any prefix, a longer prefix a shorter one.
  const closeness = (patterns = []) => Math.max(-1, ...patterns.filter((p) => covers(p, path)).map((p) => (p.endsWith('/**') ? p.length : 10000)));
  const on = (user?.screens || []).filter((s) => closeness(s.pages) >= 0);
  const hit = on.find((s) => closeness(s.pages) >= closeness(s.except));
  const first = hit ? hit.role : user?.role;
  const others = on.map((s) => s.role).filter((r) => r !== 'COMPLIANCE_AUDITOR');
  return [...new Set([first, ...others, user?.role].filter(Boolean))];
}

/**
 * Whether the screen draws `roles`' controls for `user`: the user's role is
 * one of them, or — on a screen of a power given to a role made here — one of
 * the roles that screen is drawn for (context/AuthContext.jsx, ScreenRole).
 */
export function actsAs(user, roles) {
  return roles.includes(user?.role) || !!user?.roles?.some((r) => roles.includes(r));
}
