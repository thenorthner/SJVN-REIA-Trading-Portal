import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { api } from '../api/client.js';

/**
 * The trading portfolios (clients/assets) the desk works across, and which one
 * is currently in context.
 *
 * Screens used to hard-code the portfolio list — 'N1HP0PTC0850', 'SJVN_SOLAR_001'
 * and friends were literal <option> tags in a dozen files, so adding a plant
 * meant editing every one of them, and the two spellings of the Naitwar Mori id
 * had already drifted apart between screens. The list comes from
 * trading_clients now, and the selection survives navigation the way the PTC
 * portal's own client selector does.
 *
 * The active portfolio is remembered per browser so a trader returning to the
 * desk lands on the asset they were working, not on whichever happens to sort
 * first.
 */
const PortfolioContext = createContext(null);

const STORAGE_KEY = 'sjvn_active_portfolio';

export function PortfolioProvider({ children }) {
  const [portfolios, setPortfolios] = useState([]);
  const [activeId, setActiveIdState] = useState(() => localStorage.getItem(STORAGE_KEY) || '');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    api.tradingClients.list({ status: 'ACTIVE' })
      .then((rows) => {
        if (cancelled) return;
        const list = Array.isArray(rows) ? rows : [];
        setPortfolios(list);
        // Drop a remembered id that no longer exists rather than leaving every
        // screen filtering on a portfolio the desk can't see.
        setActiveIdState((current) => (list.some((c) => c.id === current) ? current : ''));
      })
      .catch(() => { if (!cancelled) setError('Could not load the portfolio list.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

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
    active: portfolios.find((c) => c.id === activeId) || null,
  }), [portfolios, loading, error, activeId]);

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
  const { portfolios, activeId, setActiveId, loading } = usePortfolios();
  const isGlobal = scope === 'global';
  const selected = isGlobal ? activeId : (value ?? '');

  const handle = (e) => {
    const next = e.target.value;
    if (isGlobal) setActiveId(next);
    onChange?.(next);
  };

  return (
    <select id={id} className={className} value={selected} onChange={handle} disabled={loading} {...rest}>
      {(includeAll || !selected) && <option value="">{loading ? 'Loading portfolios…' : allLabel}</option>}
      {portfolios.map((c) => (
        <option key={c.id} value={c.id}>{c.name}</option>
      ))}
    </select>
  );
}
