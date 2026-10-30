import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import api from '../api/client.js';
import { screenRoles } from '../lib/rolePages.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    const raw = localStorage.getItem('sjvn_user');
    return raw ? JSON.parse(raw) : null;
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('sjvn_token');
    if (!token) { setLoading(false); return; }
    api.auth.me()
      .then((res) => setUser(res.user))
      .catch(() => { setUser(null); localStorage.removeItem('sjvn_token'); })
      .finally(() => setLoading(false));
  }, []);

  async function login(email, password) {
    const res = await api.auth.login(email, password);
    localStorage.setItem('sjvn_token', res.token);
    localStorage.setItem('sjvn_user', JSON.stringify(res.user));
    // Shown once on the dashboard: when and from where this account last signed
    // in, and whether another session is still open (CERT-In session security).
    try {
      if (res.previous_login) sessionStorage.setItem('sjvn_previous_login', JSON.stringify(res.previous_login));
      else sessionStorage.removeItem('sjvn_previous_login');
    } catch { /* ignore */ }
    setUser(res.user);
    return res.user;
  }

  /**
   * Change the signed-in user's own password.
   *
   * The server hands back a fresh token; storing it keeps the session alive, so
   * a successful change does not bounce the user to the sign-in screen.
   */
  async function changePassword(currentPassword, newPassword) {
    const res = await api.auth.changePassword(currentPassword, newPassword);
    if (res?.token) localStorage.setItem('sjvn_token', res.token);
    // A password an admin issued has now been replaced by the holder's own.
    setUser((u) => {
      if (!u?.must_change_password) return u;
      const next = { ...u, must_change_password: false };
      localStorage.setItem('sjvn_user', JSON.stringify(next));
      return next;
    });
    return res;
  }

  /**
   * End the session. The server is told first (it records the sign-out in the
   * audit log, as CERT-In asks); `silent` is for callers that have already told
   * it themselves, such as the inactivity sign-out.
   */
  function logout({ silent = false } = {}) {
    if (!silent && localStorage.getItem('sjvn_token')) api.auth.logout('USER_LOGOUT').catch(() => {});
    localStorage.removeItem('sjvn_token');
    localStorage.removeItem('sjvn_user');
    try { sessionStorage.removeItem('sjvn_acting'); } catch { /* ignore */ }
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, changePassword }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}

/**
 * Around the page itself (not the menu): the signed-in user as the screen is
 * to be drawn for — another role's, on the screens of a power an administrator
 * gave beyond the user's own role — and every role whose controls it draws
 * there (lib/rolePages.js, screenRoles and actsAs).
 */
export function ScreenRole({ children }) {
  const auth = useContext(AuthContext);
  const { pathname } = useLocation();
  const roles = screenRoles(auth?.user, pathname);
  const key = roles.join(' ');
  const value = useMemo(
    () => (auth?.user && roles.length > 1 ? { ...auth, user: { ...auth.user, role: roles[0], roles } } : auth),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` stands for `roles`
    [auth, key],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
