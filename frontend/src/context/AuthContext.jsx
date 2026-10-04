import React, { createContext, useContext, useEffect, useState } from 'react';
import api from '../api/client.js';

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

  function logout() {
    localStorage.removeItem('sjvn_token');
    localStorage.removeItem('sjvn_user');
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
