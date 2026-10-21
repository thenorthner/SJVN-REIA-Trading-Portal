import { useCallback, useEffect, useRef, useState } from 'react';

const pad = (n) => String(n).padStart(2, '0');

/** Seconds -> "08m 42s" (or "1h 05m 12s" past an hour). */
export function formatCountdown(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}h ${pad(m)}m ${pad(sec)}s` : `${pad(m)}m ${pad(sec)}s`;
}

/**
 * Count down to a gate the server named.
 *
 * `load()` returns { gate_closes_at, server_time, ... }. The hook keeps only the
 * offset between the server's clock and the browser's and counts against that, so
 * a wrong laptop clock cannot show a gate open after it has closed. When the gate
 * passes it asks again, which moves the screen on to the next gate.
 */
export function useServerCountdown(load) {
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);
  const [left, setLeft] = useState(null);
  const offsetMs = useRef(0);
  const loadRef = useRef(load);
  loadRef.current = load;

  const fetchGate = useCallback(() => {
    loadRef.current()
      .then((s) => {
        offsetMs.current = new Date(s.server_time).getTime() - Date.now();
        setData(s);
        setFailed(false);
      })
      .catch(() => { setData(null); setLeft(null); setFailed(true); });
  }, []);

  useEffect(() => { fetchGate(); }, [fetchGate, load]);

  useEffect(() => {
    if (!data) return undefined;
    const closeAt = new Date(data.gate_closes_at).getTime();
    let reloading = false;
    const tick = () => {
      const remaining = Math.ceil((closeAt - (Date.now() + offsetMs.current)) / 1000);
      setLeft(Math.max(0, remaining));
      if (remaining <= 0 && !reloading) { reloading = true; setTimeout(fetchGate, 1500); }
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [data, fetchGate]);

  return { data, left, failed };
}
