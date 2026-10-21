import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/client.js';
import { Card } from './ui.jsx';

// What is waiting on SJVN across every desk, and what falls due in the next
// thirty days — the same list a seller or buyer gets on its own landing page.

const KIND = { PAYMENT: 'To pay', RECEIPT: 'To receive', SECURITY: 'Security', MILESTONE: 'Milestone', NOTICE: 'Notice' };

export default function SjvnDeskCard() {
  const [d, setD] = useState(null);
  const navigate = useNavigate();
  useEffect(() => {
    // A courtesy on the dashboard: if it cannot load, the dashboard stands without it.
    Promise.resolve(api.sjvnDesk?.()).then((r) => setD(r || null)).catch(() => setD(null));
  }, []);
  if (!d) return null;

  return (
    <div className="ch-grid" style={{ marginTop: 0, marginBottom: 16 }}>
      <Card title={d.todo.length ? `Waiting on SJVN (${d.todo.length})` : 'Waiting on SJVN'}>
        {d.todo.length === 0 && <div className="ps-alert green" style={{ marginBottom: 0 }}>Nothing is waiting on SJVN.</div>}
        {d.counts.red > 0 && <p style={{ margin: '0 0 10px', fontSize: 13, color: 'var(--red-deep)' }}>{d.counts.red} of these {d.counts.red === 1 ? 'is' : 'are'} overdue, or holding up a counterparty.</p>}
        {d.todo.map((t) => (
          <button key={t.key} type="button" className={`ch-todo ${t.level}`} onClick={() => navigate(t.link)}>
            <div><strong>{t.title}</strong><span>{t.group} · {t.detail}</span></div>
            <div className="ch-go">Open →</div>
          </button>
        ))}
      </Card>
      <Card title="Coming up — next 30 days">
        {d.calendar.length === 0 && <p style={{ margin: 0, fontSize: 13, color: 'var(--text-light)' }}>Nothing falls due in the next 30 days.</p>}
        {d.calendar.slice(0, 10).map((e, i) => {
          const dt = new Date(`${e.date}T00:00:00`);
          return (
            <div key={`${e.date}-${i}`} className="ch-cal" role="button" tabIndex={0} onClick={() => navigate(e.link)} onKeyDown={(ev) => { if (ev.key === 'Enter') navigate(e.link); }}>
              <div className="ch-date"><b>{dt.getDate()}</b><small>{dt.toLocaleDateString('en-IN', { month: 'short' })}</small></div>
              <div><div style={{ fontWeight: 600 }}>{e.title}</div><div style={{ fontSize: 13.5, color: 'var(--text-light)' }}>{KIND[e.kind]}{e.detail ? ` · ${e.detail}` : ''}</div></div>
              <div className={`ch-in ${e.days <= 7 ? 'soon' : ''}`}>{e.days === 0 ? 'Today' : e.days === 1 ? 'Tomorrow' : `in ${e.days} days`}</div>
            </div>
          );
        })}
        {d.calendar.length > 10 && <p style={{ margin: '8px 0 0', fontSize: 13.5, color: 'var(--text-light)' }}>and {d.calendar.length - 10} more.</p>}
      </Card>
    </div>
  );
}
