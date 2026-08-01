import React, { useState } from 'react';
import { Modal, Field } from '../../components/ui.jsx';

// The 96 fifteen-minute blocks of a delivery day, labelled as the window they
// cover ("09:00-09:15"). This must match what the NOAR/WBES sync writes into
// bilateral_schedules — a bare start time would file manual and pulled
// schedules under different labels for the same block, so they never reconcile.
const fmtMin = (m) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const BLOCKS_96 = Array.from({ length: 96 }, (_, i) => `${fmtMin(i * 15)}-${fmtMin(i * 15 + 15)}`);

export function ScheduleGridModal({ tx, onClose, onSubmit }) {
  const [scheduleDate, setScheduleDate] = useState(new Date().toISOString().split('T')[0]);
  const [blocks, setBlocks] = useState(BLOCKS_96.map(b => ({ time_block: b, approved_mw: '' })));
  const [bulkMw, setBulkMw] = useState('');
  const [error, setError] = useState('');

  // A schedule may not exceed the contracted quantum — that power was never sold.
  const contracted = Number(tx.quantum_mw) || 0;
  const overBlocks = blocks.filter((b) => Number(b.approved_mw) > contracted + 1e-9);

  const handleApplyAll = () => {
    if (!bulkMw) return;
    setBlocks(blocks.map(b => ({ ...b, approved_mw: bulkMw })));
  };

  const handleApplyPeak = () => {
    if (!bulkMw) return;
    // Indian peak windows: morning 06:00-10:00 (blocks 24-39) and
    // evening 18:00-22:00 (blocks 72-87). Off-peak blocks are left untouched.
    setBlocks(blocks.map((b, i) => {
      if ((i >= 24 && i <= 39) || (i >= 72 && i <= 87)) {
        return { ...b, approved_mw: bulkMw };
      }
      return b;
    }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    setError('');
    if (overBlocks.length) {
      setError(`${overBlocks.length} block(s) exceed the contracted ${contracted} MW — the highest is ${Math.max(...overBlocks.map(b => Number(b.approved_mw)))} MW.`);
      return;
    }
    const payload = blocks.map(b => ({
      time_block: b.time_block,
      approved_mw: Number(b.approved_mw) || 0,
      schedule_date: scheduleDate
    }));
    onSubmit(payload);
  };

  return (
    <Modal open={true} onClose={onClose} title={`96-Block Schedule: ${tx.id}`} width={900}>
      <form onSubmit={handleSubmit}>
        <div style={{ display: 'flex', gap: 15, marginBottom: 20, alignItems: 'flex-end' }}>
          <Field label="Schedule Date" required>
            <input type="date" className="input" value={scheduleDate} onChange={e => setScheduleDate(e.target.value)} required />
          </Field>
          
          <div style={{ borderLeft: '1px solid #ccc', paddingLeft: 15, display: 'flex', gap: 10, alignItems: 'flex-end' }}>
            <Field label="Bulk Fill (MW)">
              <input type="number" step="0.1" className="input" value={bulkMw} onChange={e => setBulkMw(e.target.value)} placeholder="e.g. 50" style={{ width: 120 }} />
            </Field>
            <button type="button" className="btn btn-outline" onClick={handleApplyAll}>Apply to All 96</button>
            <button type="button" className="btn btn-outline" onClick={handleApplyPeak}>Apply to Peak (6-10 AM/PM)</button>
          </div>
        </div>

        <div style={{ maxHeight: 400, overflowY: 'auto', border: '1px solid var(--slate-200)', borderRadius: 4 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead style={{ position: 'sticky', top: 0, background: 'var(--slate-50)', borderBottom: '2px solid var(--slate-200)' }}>
              <tr>
                <th scope="col" style={{ padding: '8px 12px' }}>Block #</th>
                <th scope="col" style={{ padding: '8px 12px' }}>Time Range</th>
                <th scope="col" style={{ padding: '8px 12px' }}>Approved MW</th>
              </tr>
            </thead>
            <tbody>
              {blocks.map((b, i) => (
                <tr key={i} style={{ borderBottom: '1px solid var(--slate-200)' }}>
                  <td style={{ padding: '4px 12px', color: 'var(--slate-500)' }}>{i + 1}</td>
                  <td style={{ padding: '4px 12px', fontWeight: '500' }}>{b.time_block}</td>
                  <td style={{ padding: '4px 12px' }}>
                    <input 
                      type="number" 
                      step="0.1" 
                      className="input" 
                      style={{ padding: '4px 8px', height: 'auto', width: 120 }}
                      value={b.approved_mw}
                      onChange={e => setBlocks(blocks.map((row, idx) => (
                        idx === i ? { ...row, approved_mw: e.target.value } : row
                      )))}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {error && (
          <div style={{ marginTop: 12, padding: '8px 12px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 4, color: 'var(--red-deep)', fontSize: 13 }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginTop: 20 }}>
          <span style={{ fontSize: 12, color: 'var(--slate-500)' }}>
            Contracted quantum: <strong>{contracted} MW</strong> — no block may exceed this.
          </span>
          <div style={{ display: 'flex', gap: 10 }}>
            <button type="button" className="btn btn-outline" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary">Save Grid Schedule</button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
