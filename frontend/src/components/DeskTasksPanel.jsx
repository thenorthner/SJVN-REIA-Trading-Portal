/**
 * D4: open root-cause tasks on a desk — raised when SJVN accepts a dispute
 * whose cause was this desk's (an energy figure, a tariff on record).
 */
import React, { useCallback, useEffect, useState } from 'react';
import api from '../api/client.js';
import { Card, Modal, Field, AlertPopup } from './ui.jsx';
import { fmtDate } from '../datetime.js';

export default function DeskTasksPanel({ desk, canWrite }) {
  const [data, setData] = useState(null);
  const [closing, setClosing] = useState(null);
  const [popup, setPopup] = useState(null);
  const load = useCallback(() => {
    // A screen rendered without this desk's API (a test stub) simply shows no tasks.
    if (!api.deskTasks?.list) return;
    Promise.resolve(api.deskTasks.list({ desk })).then(setData).catch(() => setData(null));
  }, [desk]);
  useEffect(() => { load(); }, [load]);
  if (!data || !data.rows.length) return null;
  return (
    <Card title={`Root-cause tasks from resolved disputes — ${data.totals.open} open`}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {data.rows.map((t) => (
          <div key={t.id} style={{ borderLeft: '3px solid var(--amber-strong)', paddingLeft: 10 }}>
            <div style={{ fontWeight: 600 }}>{t.task_no} · {t.title}</div>
            <div style={{ fontSize: 13, color: 'var(--slate-600)', margin: '2px 0 4px' }}>{t.detail}</div>
            <div style={{ fontSize: 12, color: 'var(--slate-500)' }}>
              {t.dispute_no} · {t.invoice_no} · raised {fmtDate(t.created_at)}
              {canWrite && (
                <>
                  <button type="button" className="btn btn-sm btn-outline" style={{ marginLeft: 8 }} onClick={() => setClosing({ id: t.id, task_no: t.task_no, status: 'DONE', note: '' })}>Mark done</button>
                  <button type="button" className="btn btn-sm btn-ghost" style={{ marginLeft: 4 }} onClick={() => setClosing({ id: t.id, task_no: t.task_no, status: 'DROPPED', note: '' })}>Drop</button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
      <Modal open={!!closing} onClose={() => setClosing(null)} title={closing ? `${closing.status === 'DONE' ? 'Close' : 'Drop'} ${closing.task_no}` : ''} width={480}>
        {closing && (
          <form noValidate onSubmit={async (e) => {
            e.preventDefault();
            if (closing.note.trim().length < 10) { setPopup({ tone: 'error', title: 'Say what was done', message: 'At least 10 characters — it is what an auditor will read.' }); return; }
            try { await api.deskTasks.close(closing.id, { status: closing.status, note: closing.note }); setClosing(null); load(); } catch (err) {
              setPopup({ tone: 'error', title: 'Not saved', message: err?.response?.data?.error || 'Could not close the task.' });
            }
          }}>
            <Field label={closing.status === 'DONE' ? 'What was corrected' : 'Why it is dropped'} required>
              <textarea rows={3} value={closing.note} onChange={(e) => setClosing({ ...closing, note: e.target.value })} />
            </Field>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button type="button" className="btn btn-outline" onClick={() => setClosing(null)}>Cancel</button>
              <button type="submit" className="btn btn-primary">Save</button>
            </div>
          </form>
        )}
      </Modal>
      <AlertPopup open={!!popup} {...(popup || {})} onClose={() => setPopup(null)} />
    </Card>
  );
}
