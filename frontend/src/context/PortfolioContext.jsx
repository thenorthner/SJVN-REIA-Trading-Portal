import React, { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';
import { api } from '../api/client.js';
import { useAuth } from './AuthContext.jsx';

/**
 * The trading portfolios (clients/assets) the desk works across, and which one
 * is currently in context.
 */
const PortfolioContext = createContext(null);

const STORAGE_KEY = 'sjvn_active_portfolio';

export function PortfolioProvider({ children }) {
  const { user } = useAuth();
  const [portfolios, setPortfolios] = useState([]);
  const [activeId, setActiveIdState] = useState(() => localStorage.getItem(STORAGE_KEY) || '');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchPortfolios = useCallback(async () => {
    if (!localStorage.getItem('sjvn_token')) {
      setPortfolios([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const rows = await api.tradingClients.list({ status: 'ACTIVE' });
      const list = Array.isArray(rows) ? rows : [];
      setPortfolios(list);
      setActiveIdState((current) => (list.some((c) => c.id === current) ? current : ''));
      setError('');
    } catch (err) {
      console.error('[PortfolioContext] Failed to load trading clients:', err);
      setError('Could not load the portfolio list.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPortfolios();
  }, [user, fetchPortfolios]);

  function setActiveId(id) {
    setActiveIdState(id || '');
    if (id) localStorage.setItem(STORAGE_KEY, id);
    else localStorage.removeItem(STORAGE_KEY);
  }

  const value = useMemo(() => ({
    portfolios,
    loading,
    error,
    activeId,
    setActiveId,
    refreshPortfolios: fetchPortfolios,
    active: portfolios.find((c) => c.id === activeId) || null,
  }), [portfolios, loading, error, activeId, fetchPortfolios]);

  return <PortfolioContext.Provider value={value}>{children}</PortfolioContext.Provider>;
}

export function usePortfolios() {
  const ctx = useContext(PortfolioContext);
  if (!ctx) throw new Error('usePortfolios must be used inside a PortfolioProvider');
  return ctx;
}

/**
 * Portfolio picker bound to the shared list.
 *
 * `scope="global"` drives the context selection so the choice carries to the
 * next screen; leave it off for a filter that is local to one view.
 */
export function PortfolioSelect({
  value, onChange, scope, includeAll = false, allLabel = '-- All Portfolios --',
  className = 'input', id, ...rest
}) {
  const { portfolios, activeId, setActiveId, refreshPortfolios, loading } = usePortfolios();
  const isGlobal = scope === 'global';
  const selected = isGlobal ? activeId : (value ?? '');

  const handle = (e) => {
    const next = e.target.value;
    if (isGlobal) setActiveId(next);
    onChange?.(next);
  };

  const handleFocus = () => {
    if (portfolios.length === 0 && !loading) {
      refreshPortfolios();
    }
  };

  return (
    <select 
      id={id} 
      className={className} 
      value={selected} 
      onChange={handle} 
      onFocus={handleFocus}
      disabled={loading} 
      {...rest}
    >
      {(includeAll || !selected) && <option value="">{loading ? 'Loading portfolios…' : allLabel}</option>}
      {portfolios.map((c) => (
        <option key={c.id} value={c.id}>{c.name}</option>
      ))}
    </select>
  );
}
