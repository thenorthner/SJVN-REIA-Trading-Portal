/**
 * G5: the developer scorecard — generation against target, disputes, payment
 * cycle and compliance, per plant and per developer.
 */
import React, { useEffect, useState } from 'react';
import api from '../api/client.js';
import { Card, Badge, fmtNumber } from './ui.jsx';

const GRADE_TONE = { A: 'ACTIVE', B: 'VALIDATED', C: 'PENDING', D: 'REJECTED' };
const pct = (v) => (v == null ? '—' : `${fmtNumber(v)}%`);

export default function DeveloperScorecardCard({ from = null, to = null }) {
  const [data, setData] = useState(null);
  const [by, setBy] = useState('plant');
  useEffect(() => {
    const call = api.reports?.developerScorecard;
    if (!call) return;
    const params = {};
    if (from) params.from = from;
    if (to) params.to = to;
    Promise.resolve(call(params)).then(setData).catch(() => setData(null));
  }, [from, to]);
  if (!data || !data.plants?.length) return null;
  return (
    <Card title="Developer scorecard">
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' }}>
        <select value={by} onChange={(e) => setBy(e.target.value)} aria-label="Scorecard by">
          <option value="plant">By plant (PPA)</option>
          <option value="developer">By developer</option>
        </select>
        <span style={{ fontSize: 14, color: 'var(--slate-500)' }}>
          Score = generation {data.weights.generation} + compliance {data.weights.compliance} + disputes {data.weights.disputes}. Target is the PPA's minimum CUF on possible energy (curtailment taken out). Indicative, not a contractual rating.
        </span>
      </div>
      <div className="report-table-wrap">
        <table className="report-table">
          <thead>
            {by === 'plant'
              ? <tr><th>Plant</th><th>Developer</th><th>Actual / target (MWh)</th><th>Achievement</th><th>Disputes</th><th>Avg payment cycle</th><th>Compliance</th><th>Score</th></tr>
              : <tr><th>Developer</th><th>Plants</th><th>Actual / target (MWh)</th><th>Achievement</th><th>Disputes</th><th>Avg payment cycle</th><th>Score</th></tr>}
          </thead>
          <tbody>
            {by === 'plant' ? data.plants.map((p) => (
              <tr key={p.contract_id}>
                <td>{p.contract_no}<div style={{ fontSize: 13.5, color: 'var(--slate-500)' }}>{p.project_type} · {fmtNumber(p.capacity_mw)} MW · {p.months} mo</div></td>
                <td>{p.developer}</td>
                <td>{fmtNumber(p.energy_mwh)} / {p.target_mwh == null ? '—' : fmtNumber(p.target_mwh)}</td>
                <td>{pct(p.achievement_pct)}</td>
                <td>{p.disputes}{p.disputes_open ? ` (${p.disputes_open} open)` : ''}</td>
                <td>{p.avg_payment_days == null ? '—' : `${fmtNumber(p.avg_payment_days)} days (${p.paid_bills} bills)`}</td>
                <td>{pct(p.compliance_score)}</td>
                <td>{p.score == null ? '—' : <><strong>{p.score}</strong> <Badge status={GRADE_TONE[p.grade]} label={p.grade} /></>}</td>
              </tr>
            )) : data.developers.map((d) => (
              <tr key={d.developer_id || d.developer}>
                <td>{d.developer}</td>
                <td>{d.plants} · {fmtNumber(d.capacity_mw)} MW</td>
                <td>{fmtNumber(d.energy_mwh)} / {fmtNumber(d.target_mwh)}</td>
                <td>{pct(d.achievement_pct)}</td>
                <td>{d.disputes}{d.disputes_open ? ` (${d.disputes_open} open)` : ''}</td>
                <td>{d.avg_payment_days == null ? '—' : `${fmtNumber(d.avg_payment_days)} days`}</td>
                <td>{d.score ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
