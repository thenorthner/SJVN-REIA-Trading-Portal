import React, { useEffect, useState } from 'react';
import { AlertPopup, Modal, Field } from './ui.jsx';
import { subscribe, settle } from '../lib/dialogs.js';

const lines = (text) => <span style={{ whiteSpace: 'pre-line' }}>{text}</span>;

/** Renders the dialog in front of the queue from lib/dialogs.js. Mounted once. */
export default function DialogHost() {
  const [queue, setQueue] = useState([]);
  const [value, setValue] = useState('');
  useEffect(() => subscribe(setQueue), []);
  const d = queue[0];
  useEffect(() => { if (d?.kind === 'text') setValue(d.defaultValue); }, [d]);
  if (!d) return null;

  if (d.kind === 'alert') {
    return <AlertPopup open tone={d.tone} title={d.title} message={lines(d.message)} okLabel="OK" onClose={() => settle(undefined)} />;
  }
  if (d.kind === 'confirm') {
    return (
      <AlertPopup
        open tone={d.tone} title={d.title} message={lines(d.message)} okLabel="Cancel"
        onClose={() => settle(false)}
        actions={<button type="button" className={`btn ${d.danger ? 'btn-danger' : 'btn-primary'}`} onClick={() => settle(true)}>{d.okLabel}</button>}
      />
    );
  }
  const blank = d.required && !value.trim();
  return (
    <Modal open onClose={() => settle(null)} title={d.title} width={520}>
      <form onSubmit={(e) => { e.preventDefault(); if (!blank) settle(value); }}>
        {d.message && <p style={{ marginTop: 0 }}>{lines(d.message)}</p>}
        <Field label="Your answer">
          {d.multiline
            ? <textarea rows={3} autoFocus value={value} onChange={(e) => setValue(e.target.value)} />
            : <input autoFocus type={d.inputType} value={value} onChange={(e) => setValue(e.target.value)} />}
        </Field>
        <div className="form-actions">
          <button type="button" className="btn btn-ghost" onClick={() => settle(null)}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={blank}>{d.okLabel}</button>
        </div>
      </form>
    </Modal>
  );
}
