import React, { useEffect, useState } from 'react';
import api from '../../api/client.js';
import { Card } from '../../components/ui.jsx';

// Shared by the market widgets that read the CERC monthly report: the month's
// figures, a month picker that offers only the months the report has, and the
// card a widget shows for a figure the platform does not hold.

export const periodLabel = (period) => {
  if (!period) return '—';
  const [y, m] = period.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-IN', { month: 'short', year: 'numeric', timeZone: 'UTC' });
};

export const mu = (v) => (v == null ? '—' : Number(v).toLocaleString('en-IN', { maximumFractionDigits: 1 }));

export function useCercMonth() {
  const [period, setPeriod] = useState('');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    setError('');
    api.cercMarket.marketMonth(period || undefined)
      .then((d) => { if (live) setData(d); })
      .catch((err) => { if (live) setError(err?.response?.data?.error || 'Could not load the CERC report.'); });
    return () => { live = false; };
  }, [period]);

  return { data, error, setPeriod };
}

export function PeriodSelect({ data, onChange }) {
  if (!data?.periods?.length) return null;
  return (
    <label className="report-search">
      Report month
      <select className="input" value={data.period} onChange={(e) => onChange(e.target.value)}>
        {data.periods.map((p) => <option key={p} value={p}>{periodLabel(p)}</option>)}
      </select>
    </label>
  );
}

/** A report month the platform has not loaded, said plainly. */
export function NoReport() {
  return (
    <Card>
      <div className="audit-placeholder">
        No CERC monthly market report has been loaded yet. Reports are fetched on the 15th and 25th, or from CERC Monthly Intelligence.
      </div>
    </Card>
  );
}

/** A figure the platform has no source for — named, not drawn. */
export function NotHeld({ title, children }) {
  return (
    <Card title={title}>
      <div className="audit-placeholder">{children}</div>
    </Card>
  );
}
