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

  function logout() {
    localStorage.removeItem('sjvn_token');
    localStorage.removeItem('sjvn_user');
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
