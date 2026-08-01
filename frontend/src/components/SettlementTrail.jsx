import React, { useEffect, useState } from 'react';
import api from '../api/client.js';
import { Badge, fmtCurrency, fmtNumber } from './ui.jsx';

/**
 * Period Settlement Trail — provisional energy/invoice/paid ↔ final true-up.
 * Pass any of: bfr | invoiceId | energyId | { contractId, periodMonth, direction }
 */
export function SettlementTrailPanel({
  bfr,
  invoiceId,
  energyId,
  contractId,
  periodMonth,
  direction,
  compact = false,
}) {
  const [trail, setTrail] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    const params = {};
    if (bfr) params.bfr = bfr;
    else if (invoiceId) params.invoice_id = invoiceId;
    else if (energyId) params.energy_id = energyId;
    else if (contractId && periodMonth) {
      params.contract_id = contractId;
      params.period_month = periodMonth;
      if (direction) params.direction = direction;
    } else {
      setLoading(false);
      setError('No lookup key');
      return;
    }

    api.billingTrail.get(params)
      .then((data) => { if (!cancelled) setTrail(data); })
      .catch((err) => { if (!cancelled) setError(err.response?.data?.error || 'Failed to load settlement trail'); })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [bfr, invoiceId, energyId, contractId, periodMonth, direction]);

  if (loading) {
    return <div style={{ padding: 12, color: 'var(--slate-500)', fontSize: 13 }}>Loading settlement trail…</div>;
  }
  if (error) {
    return <div style={{ padding: 12, color: 'var(--red-deep)', fontSize: 13 }}>{error}</div>;
  }
  if (!trail) return null;

  const s = trail.summary || {};

  return (
    <div style={{
      marginTop: compact ? 0 : 16,
      padding: 16,
      background: 'var(--slate-50)',
      border: '1px solid var(--slate-200)',
      borderRadius: 8,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 12 }}>
        <div>
          <h4 style={{ margin: '0 0 4px 0', color: 'var(--slate-700)' }}>Period Settlement Trail</h4>
          <code style={{ fontSize: 12, color: '#4f46e5', wordBreak: 'break-all' }}>{trail.billing_family_ref}</code>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {s.has_provisional_energy ? <Badge status="ACTIVE" label="Prov Energy" /> : <Badge status="DRAFT" label="No Prov Energy" />}
          {s.has_final_energy ? <Badge status="ACTIVE" label="Final Energy" /> : <Badge status="PENDING" label="Awaiting Final" />}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 14 }}>
        <Stat label="Period" value={trail.billing_period} />
        <Stat label="Already paid" value={fmtCurrency(trail.already_paid)} />
        <Stat label="Δ Energy" value={trail.delta_mwh != null ? `${fmtNumber(trail.delta_mwh)} MWh` : '—'} />
        <Stat label="Net due (final)" value={trail.net_due != null ? fmtCurrency(trail.net_due) : '—'} />
        {trail.frequency_beta && (
          <Stat
            label="Freq. β"
            value={trail.frequency_beta.status === 'CERTIFIED'
              ? Number(trail.frequency_beta.beta_value).toFixed(2)
              : 'Pending'}
          />
        )}
      </div>

      {trail.frequency_beta && (
        <TrailBlock title="Frequency Response Performance (β)" style={{ marginBottom: 12 }}>
          {trail.frequency_beta.status === 'CERTIFIED' ? (
            <>
              <div>
                β = <strong>{Number(trail.frequency_beta.beta_value).toFixed(2)}</strong>
                {trail.frequency_beta.station_code ? ` · ${trail.frequency_beta.station_code}` : ''}
                {trail.frequency_beta.station_name ? ` (${trail.frequency_beta.station_name})` : ''}
                {' · '}<Badge status="ACTIVE" label={trail.frequency_beta.source || 'NRPC'} />
              </div>
              <div style={{ fontSize: 12, color: 'var(--slate-500)', marginTop: 4 }}>
                {trail.frequency_beta.certified_on ? `Certified ${trail.frequency_beta.certified_on} · ` : ''}
                Incentive {fmtCurrency(trail.frequency_beta.computed_incentive || 0)}
                {trail.frequency_beta.already_billed_incentive
                  ? ` · billed ${fmtCurrency(trail.frequency_beta.already_billed_incentive)}`
                  : ''}
                {trail.frequency_beta.true_up_delta
                  ? ` · true-up Δ ${fmtCurrency(trail.frequency_beta.true_up_delta)}`
                  : ''}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginTop: 2 }}>{trail.frequency_beta.incentive_reason}</div>
            </>
          ) : (
            <span style={{ color: 'var(--text-subtle)' }}>Awaiting NRPC β certificate — provisional bills exclude incentive; true-up when certified</span>
          )}
        </TrailBlock>
      )}

      {trail.direction === 'SJVN_TO_BUYER' && (
        <div style={{ fontSize: 12, color: 'var(--slate-500)', marginBottom: 10, padding: '6px 10px', background: '#eef2ff', borderRadius: 6 }}>
          Energy shown below is the <strong>source PPA</strong> generation for this period. The PSA bill uses the allocated share (see invoice breakdown: Source PPA Energy × Allocation %).
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <TrailBlock title="Provisional Energy">
          {trail.provisional_energy ? (
            <>
              <div>{fmtNumber(trail.provisional_energy.energy_mwh)} MWh · {trail.provisional_energy.source}</div>
              <div style={{ fontSize: 12, color: 'var(--slate-500)' }}><Badge status={trail.provisional_energy.status} /> · {trail.provisional_energy.id}</div>
            </>
          ) : <span style={{ color: 'var(--text-subtle)' }}>None</span>}
        </TrailBlock>
        <TrailBlock title="Final Energy">
          {trail.final_energy ? (
            <>
              <div>{fmtNumber(trail.final_energy.energy_mwh)} MWh · {trail.final_energy.source}</div>
              <div style={{ fontSize: 12, color: 'var(--slate-500)' }}>
                <Badge status={trail.final_energy.status} />
                {trail.final_energy.supersedes_energy_id && ` · supersedes ${trail.final_energy.supersedes_energy_id}`}
              </div>
            </>
          ) : <span style={{ color: 'var(--text-subtle)' }}>Awaiting CERC final</span>}
        </TrailBlock>
      </div>

      <TrailBlock title="Provisional Invoices" style={{ marginTop: 12 }}>
        {trail.provisional_invoices?.length ? (
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
            {trail.provisional_invoices.map((inv) => (
              <li key={inv.id}>
                {inv.invoice_no} · {fmtCurrency(inv.total_amount)} · <Badge status={inv.status} />
              </li>
            ))}
          </ul>
        ) : <span style={{ color: 'var(--text-subtle)' }}>None</span>}
        <div style={{ marginTop: 6, fontSize: 12, color: 'var(--slate-500)' }}>
          Billed {fmtCurrency(trail.provisional_billed)} · Paid {fmtCurrency(trail.already_paid)}
        </div>
      </TrailBlock>

      <TrailBlock title="Final / True-up Invoices" style={{ marginTop: 12 }}>
        {trail.final_invoices?.length ? (
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
            {trail.final_invoices.map((inv) => (
              <li key={inv.id}>
                {inv.invoice_no} ({inv.invoice_type}) · Net {fmtCurrency(inv.total_amount)}
                {inv.other_adjustments ? ` · adj ${fmtCurrency(inv.other_adjustments)}` : ''}
                {inv.parent_invoice_id ? ` · parent ${inv.parent_invoice_id}` : ''}
                {' · '}<Badge status={inv.status} />
              </li>
            ))}
          </ul>
        ) : <span style={{ color: 'var(--text-subtle)' }}>Not generated yet</span>}
      </TrailBlock>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div style={{ background: '#fff', border: '1px solid var(--slate-200)', borderRadius: 6, padding: '8px 10px' }}>
      <div style={{ fontSize: 11, color: 'var(--slate-500)', textTransform: 'uppercase', letterSpacing: 0.3 }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--slate-900)', marginTop: 2 }}>{value}</div>
    </div>
  );
}

function TrailBlock({ title, children, style }) {
  return (
    <div style={{ background: '#fff', border: '1px solid var(--slate-200)', borderRadius: 6, padding: 12, ...style }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--slate-600)', marginBottom: 6 }}>{title}</div>
      {children}
    </div>
  );
}

/** Clickable BFR chip that opens the trail via onOpen(bfr). */
export function BfrChip({ bfr, onClick }) {
  if (!bfr) return <span style={{ color: 'var(--text-subtle)' }}>—</span>;
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick?.(bfr); }}
      title={bfr}
      style={{
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: 11,
        padding: '2px 8px',
        borderRadius: 4,
        border: '1px solid #c7d2fe',
        background: '#eef2ff',
        color: '#4338ca',
        cursor: onClick ? 'pointer' : 'default',
        maxWidth: 220,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}
    >
      {bfr}
    </button>
  );
}
