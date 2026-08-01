import React, { useEffect, useState } from 'react';
import { api } from '../../api/client.js';
import { usePortfolios } from '../../context/PortfolioContext.jsx';

/**
 * Standing-clearance state and the next certificate trading windows.
 *
 * This was static JSX: a fixed entity name, "Remaining 20 Days for REC bid",
 * "Remaining 5 Days for ESCERT bid" and a permanent red "NOC Expired". It said
 * the same thing forever — a renewed clearance still read as expired, and the
 * countdowns never moved — while sitting above screens where those figures look
 * like live compliance status.
 *
 * Everything below is derived from records. REC session dates follow the CERC
 * rule (2nd and last Wednesday); ESCert sessions have no calendar rule, so they
 * come from master data and read "not scheduled" until the BEE dates are
 * entered rather than inventing a countdown.
 */

const CLEARANCE_TONE = {
  ACTIVE: 'ok',
  RENEWAL_DUE: 'warn',
  EXPIRED: 'danger',
  NOT_ON_RECORD: '',
};

function clearanceLabel(c) {
  if (!c) return { text: 'Clearance unknown', tone: '' };
  switch (c.state) {
    case 'ACTIVE':
      return { text: `NOC valid · ${c.days_left}d`, tone: 'ok' };
    case 'RENEWAL_DUE':
      return { text: `NOC renewal due · ${c.days_left}d`, tone: 'warn' };
    case 'EXPIRED':
      return { text: `NOC expired · ${Math.abs(c.days_left)}d ago`, tone: 'danger' };
    default:
      return { text: 'No NOC on record', tone: '' };
  }
}

/** "in 11 days" / "today" / "tomorrow", so a countdown of 0 does not read as absent. */
function countdown(days) {
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  return `in ${days} days`;
}

export default function ComplianceStatusBar() {
  const { activeId, active } = usePortfolios();
  const [ticker, setTicker] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    api.alerts.complianceTicker(activeId || undefined)
      .then((d) => { if (!cancelled) setTicker(d); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [activeId]);

  // Better to show nothing than a stale or invented compliance state.
  if (failed || !ticker) return null;

  const clearance = ticker.clearance;
  const status = clearanceLabel(clearance);
  // Without a portfolio in context the endpoint reports the worst state on the
  // desk. Naming that client here would read as the asset in context, so the
  // entity chip says so plainly and the status chip names whose NOC it is.
  const entityName = active?.name || 'All portfolios';

  return (
    <div className="compliance-ticker" role="status" aria-label="Compliance status">
      <div className="compliance-ticker__chip compliance-ticker__chip--entity">
        <span aria-hidden="true">🏢</span> {entityName}
      </div>

      <div className="compliance-ticker__chip">
        <span aria-hidden="true">⏱️</span>
        {ticker.rec_session ? (
          <>REC session <span className="compliance-ticker__value">{countdown(ticker.rec_session.days_away)}</span></>
        ) : (
          <>REC session <span className="compliance-ticker__muted">not scheduled</span></>
        )}
      </div>

      <div className="compliance-ticker__chip">
        <span aria-hidden="true">⏱️</span>
        {ticker.escert_session ? (
          <>ESCert session <span className="compliance-ticker__value">{countdown(ticker.escert_session.days_away)}</span></>
        ) : (
          <>ESCert session <span className="compliance-ticker__muted">not scheduled</span></>
        )}
      </div>

      <div
        className={`compliance-ticker__chip compliance-ticker__chip--status${status.tone ? ` compliance-ticker__chip--${status.tone}` : ''}`}
        title={clearance && !activeId ? `Most pressing on the desk: ${clearance.client_name}` : undefined}
      >
        {/* A shield would read as "protected" on a portfolio whose NOC has
            never been captured, which is the one case we cannot vouch for. */}
        <span aria-hidden="true">
          {status.tone === 'danger' ? '⚠️' : status.tone === 'warn' ? '⏳' : status.tone === 'ok' ? '🛡️' : '❓'}
        </span>
        {status.text}
        {clearance && !activeId && (
          <span className="compliance-ticker__muted"> · {clearance.client_name}</span>
        )}
      </div>
    </div>
  );
}
