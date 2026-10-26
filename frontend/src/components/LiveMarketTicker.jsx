import React, { useState, useEffect } from 'react';
import { TrendingUp, TrendingDown, Minus, Play, Pause, RefreshCw, BarChart2, ShieldCheck, Activity } from 'lucide-react';
import { useGigw } from '../gigw/GigwContext.jsx';

/**
 * Live Power Market Ticker (IEX / PXIL / HPX MCP Ticker)
 * Fetches verified trading records from /api/public/market-ticker.
 * Displays real-time Market Clearing Prices (MCP ₹/kWh), cleared volume (MW),
 * and day-over-day price movements (▲ / ▼).
 *
 * Compliant with WCAG 2.2.2 (Pause / Stop / Hide for scrolling content)
 * and GIGW 3.0 / UX4G accessibility standards.
 */
export default function LiveMarketTicker() {
  const { lang } = useGigw();
  const [data, setData] = useState({ rates: [], latest_date: null, prev_date: null, total_volume_mw: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isPaused, setIsPaused] = useState(false);

  useEffect(() => {
    let mounted = true;
    async function fetchTicker() {
      try {
        setLoading(true);
        const res = await fetch('/api/public/market-ticker');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (mounted) {
          setData(json);
          setError(null);
        }
      } catch (err) {
        if (mounted) setError(err.message);
      } finally {
        if (mounted) setLoading(false);
      }
    }
    fetchTicker();
    // Refresh periodically (every 60s)
    const interval = setInterval(fetchTicker, 60000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  // Format date helper (e.g., "18 Aug 2026")
  const formatDate = (isoStr) => {
    if (!isoStr) return '';
    try {
      const d = new Date(isoStr);
      return d.toLocaleDateString(lang === 'hi' ? 'hi-IN' : 'en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric'
      });
    } catch {
      return isoStr;
    }
  };

  const getExchangeColor = (exchange) => {
    switch (exchange) {
      case 'IEX': return { bg: '#e0f2fe', text: '#0369a1', border: '#bae6fd', badge: '#0369a1' };
      case 'PXIL': return { bg: '#ffedd5', text: '#c2410c', border: '#fed7aa', badge: '#c2410c' };
      case 'HPX': return { bg: '#dcfce7', text: '#15803d', border: '#bbf7d0', badge: '#15803d' };
      default: return { bg: '#f1f5f9', text: '#334155', border: '#cbd5e1', badge: '#475569' };
    }
  };

  if (loading && !data.rates.length) {
    return (
      <div className="market-ticker-skeleton" aria-live="polite">
        <Activity size={16} className="animate-spin text-sky-600" />
        <span>{lang === 'hi' ? 'लाइव पावर मार्केट डेटा लोड हो रहा है...' : 'Loading verified exchange market telemetry...'}</span>
      </div>
    );
  }

  if (error && !data.rates.length) {
    return null; // Silently hide if offline and no cached rates
  }

  const { rates = [], latest_date, total_volume_mw } = data;
  if (!rates.length) return null;

  return (
    <div 
      className="market-ticker-container" 
      role="region" 
      aria-label={lang === 'hi' ? 'लाइव पावर मार्केट दर टिकर' : 'Live Power Market Rates Ticker'}
    >
      <div className="market-ticker-shell">
        {/* Sovereign Header Badge */}
        <div className="market-ticker-badge">
          <div className="ticker-pulse-dot" aria-hidden="true" />
          <span className="ticker-badge-title">
            {lang === 'hi' 
              ? 'पावर मार्केट टेलीमेट्री' 
              : lang === 'gu'
              ? 'પાવર માર્કેટ ટેલિમેટ્રી'
              : lang === 'mr'
              ? 'पॉवर मार्केट टेलिमेट्री'
              : 'POWER MARKET TELEMETRY'}
          </span>
          <span className="ticker-date-pill" title={`Cleared date: ${latest_date}`}>
            {formatDate(latest_date)}
          </span>
          {total_volume_mw > 0 && (
            <span className="ticker-volume-pill" title="Total cleared volume today">
              {lang === 'hi' ? `वॉल्यूम: ${total_volume_mw.toLocaleString()} MW` : `Vol: ${total_volume_mw.toLocaleString()} MW`}
            </span>
          )}
        </div>

        {/* Marquee Ticker Track */}
        <div 
          className="market-ticker-viewport"
          onMouseEnter={() => setIsPaused(true)}
          onMouseLeave={() => setIsPaused(false)}
          onFocus={() => setIsPaused(true)}
          onBlur={() => setIsPaused(false)}
        >
          <div 
            className={`market-ticker-track ${isPaused ? 'is-paused' : ''}`}
            aria-live="off"
          >
            {/* Duplicated for smooth infinite scroll */}
            {[...rates, ...rates].map((item, idx) => {
              const colors = getExchangeColor(item.exchange);
              const diffVal = Number(item.diff);
              const isUp = diffVal > 0;
              const isDown = diffVal < 0;

              return (
                <div 
                  key={`${item.exchange}-${item.product}-${idx}`} 
                  className="market-ticker-item"
                  title={`${item.exchange} ${item.product} | MCP: ₹${item.mcp_rate}/kWh | Volume: ${item.volume_mw} MW | Min: ₹${item.min_rate || '—'}, Max: ₹${item.max_rate || '—'}`}
                >
                  <span 
                    className="ticker-exchange-tag"
                    style={{ backgroundColor: colors.badge }}
                  >
                    {item.exchange}
                  </span>

                  <span className="ticker-product-tag">
                    {item.product}
                  </span>

                  <span className="ticker-mcp-val">
                    ₹{item.mcp_rate.toFixed(2)}
                    <span className="ticker-unit">/kWh</span>
                  </span>

                  {diffVal !== 0 ? (
                    <span className={`ticker-delta ${isUp ? 'is-up' : 'is-down'}`}>
                      {isUp ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
                      <span>{isUp ? `+₹${diffVal.toFixed(2)}` : `-₹${Math.abs(diffVal).toFixed(2)}`}</span>
                    </span>
                  ) : (
                    <span className="ticker-delta is-flat">
                      <Minus size={13} />
                      <span>₹0.00</span>
                    </span>
                  )}

                  <span className="ticker-vol-tag">
                    {Math.round(item.volume_mw).toLocaleString()} MW
                  </span>

                  <span className="ticker-divider" aria-hidden="true">•</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Ticker Controls (WCAG 2.2.2 Pause/Resume button) */}
        <div className="market-ticker-controls">
          <button
            type="button"
            className="ticker-ctrl-btn"
            onClick={() => setIsPaused(!isPaused)}
            aria-label={isPaused ? (lang === 'hi' ? 'स्क्रोलिंग शुरू करें' : 'Resume ticker scrolling') : (lang === 'hi' ? 'स्क्रोलिंग रोकें' : 'Pause ticker scrolling')}
            title={isPaused ? 'Resume ticker scrolling' : 'Pause ticker scrolling'}
          >
            {isPaused ? <Play size={13} /> : <Pause size={13} />}
          </button>
        </div>
      </div>
    </div>
  );
}
