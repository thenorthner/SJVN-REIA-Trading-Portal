import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactQuill from 'react-quill-new';
import 'react-quill-new/dist/quill.snow.css';
import { useLocation, useNavigate } from 'react-router-dom';
import api from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { PageHeader, Modal, Field } from '../components/ui.jsx';
import {
  Inbox, Send, Archive, Search, Reply, ReplyAll, Forward, ArchiveRestore, Trash2, Paperclip, X,
  Mail as MailIcon, MailOpen, Plus, FileText, Settings, ArrowDownUp, Star, RotateCcw, Printer,
  Table as TableIcon, Download, CheckCheck, AlertTriangle, Info, ShieldAlert, Scale,
} from 'lucide-react';
import './Mail-elite.css';

const FOLDERS = [
  { key: 'INBOX', label: 'Inbox', icon: Inbox },
  { key: 'STARRED', label: 'Starred', icon: Star },
  { key: 'DRAFTS', label: 'Drafts', icon: FileText },
  { key: 'SENT', label: 'Sent', icon: Send },
  { key: 'ARCHIVE', label: 'Archive', icon: Archive },
  { key: 'TRASH', label: 'Trash', icon: Trash2 },
];

// What the server keeps of a formatted body; the toolbar offers nothing else.
const EDITOR_MODULES = {
  toolbar: [
    [{ header: [1, 2, 3, false] }],
    ['bold', 'italic', 'underline', 'strike'],
    [{ list: 'ordered' }, { list: 'bullet' }, { indent: '-1' }, { indent: '+1' }],
    ['blockquote', 'link'],
    ['clean'],
  ],
  table: true,
};
const EDITOR_FORMATS = [
  'header', 'bold', 'italic', 'underline', 'strike', 'list', 'indent', 'blockquote', 'link',
  'table', 'table-row', 'table-body', 'table-container',
];

const MAX_FILES = 5;
const MAX_FILE_MB = 10;
const AUTOSAVE_MS = 1500;
const PAGE = 50;
const TRASH_DAYS = 30;

const asDate = (iso) => new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso.replace(' ', 'T')}Z`);

function when(iso) {
  if (!iso) return '';
  const d = asDate(iso);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay
    ? d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
}

const fullWhen = (iso) => (iso ? asDate(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '');

const person = (p) => (p.company && p.company !== 'SJVN' ? `${p.name} (${p.company})` : p.name);

const kb = (n) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

const esc = (t) => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const linesToHtml = (text) => String(text || '').split('\n').map((l) => `<p>${esc(l) || '<br>'}</p>`).join('');

const htmlOf = (m) => m.body_html || linesToHtml(m.body);

// Quill quotes line by line, so each paragraph of the original becomes its own quoted line.
const quoteHtml = (html) => html.replace(/<p(\s[^>]*)?>/g, '<blockquote>').replace(/<\/p>/g, '</blockquote>');

const signatureHtml = (signature) => (signature ? `<p><br></p><p>--</p>${linesToHtml(signature)}` : '');

const names = (list, kind) => list.filter((r) => r.kind === kind).map(person).join(', ');

// The editor's own account of what was written, as plain tags: real nested
// lists and tables, and a blank line that still takes up a line when read.
const writtenHtml = (quill) => quill.getSemanticHTML().replace(/&nbsp;/g, ' ').replace(/<p><\/p>/g, '<p><br></p>');

// What can be shown in the page without downloading. The type is decided here,
// from the name — never taken from the upload — so nothing else is ever rendered.
const PREVIEW_TYPES = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };
const previewType = (filename) => PREVIEW_TYPES[String(filename || '').split('.').pop().toLowerCase()] || null;

function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** A conversation as a page for the printer — or for the browser's "Save as PDF". */
function printThread(thread, printedBy) {
  const subject = thread.messages[thread.messages.length - 1]?.subject || '';
  const messages = thread.messages.map((m) => `
    <section>
      <table class="head">
        <tr><th>From</th><td>${esc(m.sender_name)} &lt;${esc(m.sender_email)}&gt;</td></tr>
        <tr><th>To</th><td>${esc(names(m.recipients, 'TO') || '—')}</td></tr>
        ${names(m.recipients, 'CC') ? `<tr><th>Cc</th><td>${esc(names(m.recipients, 'CC'))}</td></tr>` : ''}
        ${names(m.recipients, 'BCC') ? `<tr><th>Bcc</th><td>${esc(names(m.recipients, 'BCC'))}</td></tr>` : ''}
        <tr><th>Date</th><td>${esc(fullWhen(m.created_at))}</td></tr>
        <tr><th>Subject</th><td>${esc(m.subject)}</td></tr>
        ${m.attachments.length ? `<tr><th>Attachments</th><td>${esc(m.attachments.map((a) => `${a.filename} (${kb(a.size_bytes)})`).join(', '))}</td></tr>` : ''}
      </table>
      <div class="body">${htmlOf(m)}</div>
    </section>`).join('');
  const doc = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(subject)}</title><style>
    body { font: 12pt/1.5 Georgia, 'Times New Roman', serif; color: #000; margin: 18mm; }
    header { border-bottom: 2px solid #000; padding-bottom: 6px; margin-bottom: 14px; }
    header small { display: block; font: 9pt Arial, sans-serif; color: #444; }
    h1 { font-size: 15pt; margin: 0; }
    section { border-bottom: 1px solid #999; padding: 10px 0 14px; }
    table.head { border-collapse: collapse; font: 10pt Arial, sans-serif; margin-bottom: 10px; }
    table.head th { text-align: left; padding: 1px 14px 1px 0; vertical-align: top; color: #444; font-weight: normal; }
    .body p, .body h1, .body h2, .body h3 { margin: 0; }
    .body blockquote { margin: 0; padding-left: 10px; border-left: 2px solid #999; color: #444; }
    .body table { border-collapse: collapse; margin: 6px 0; }
    .body td, .body th { border: 1px solid #000; padding: 3px 8px; }
    footer { margin-top: 12px; font: 9pt Arial, sans-serif; color: #444; }
  </style></head><body>
    <header><small>SJVN — RE Commercial &amp; Trading Platform · Quick Connect (Informal Operational Facility)</small><h1>${esc(subject)}</h1></header>
    ${messages}
    <footer>
      <div style="margin: 12px 0 6px; padding: 8px 12px; border: 1px dashed #777; font-size: 10.5pt; color: #444; background: #fafafa; border-radius: 4px;">
        <strong>Legal &amp; Contractual Notice:</strong> Quick Connect is an in-portal operational coordination facility and does NOT constitute an official, statutory, or legal mode of communication under PPA/PSA agreements or CERC regulations. Formal contractual notices must be served through designated official channels.
      </div>
      Printed by ${esc(printedBy)} on ${esc(new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }))} · ${thread.messages.length} message${thread.messages.length === 1 ? '' : 's'}
    </footer>
  </body></html>`;

  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.className = 'mail-print-frame';
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  frame.onload = () => {
    frame.contentWindow.focus();
    frame.contentWindow.print();
    setTimeout(() => frame.remove(), 60000);
  };
  frame.srcdoc = doc;
  document.body.appendChild(frame);
}

const Avatar = ({ name }) => {
  const initials = name ? name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase() : '?';
  const hash = name ? name.split('').reduce((acc, char) => char.charCodeAt(0) + ((acc << 5) - acc), 0) : 0;
  const h = Math.abs(hash) % 360;
  return (
    <div className="mail-avatar" style={{ background: `linear-gradient(135deg, hsl(${h}, 70%, 55%), hsl(${(h+40)%360}, 80%, 45%))` }}>
      {initials}
    </div>
  );
};

function RecipientPicker({ id, value, onChange, placeholder }) {
  const [q, setQ] = useState('');
  const [options, setOptions] = useState([]);
  const [open, setOpen] = useState(false);
  const wrap = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    let live = true;
    const t = setTimeout(() => {
      api.mail.directory(q).then((r) => { if (live) setOptions(r || []); }).catch(() => {});
    }, 150);
    return () => { live = false; clearTimeout(t); };
  }, [q, open]);

  useEffect(() => {
    function onDown(e) { if (wrap.current && !wrap.current.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  const chosen = new Set(value.map((v) => v.id));
  const shown = options.filter((o) => !chosen.has(o.id)).slice(0, 12);

  return (
    <div className="mail-picker" ref={wrap}>
      <div className="mail-chips" onClick={() => wrap.current?.querySelector('input')?.focus()}>
        {value.map((v) => (
          <span key={v.id} className="mail-chip" style={{ background: 'var(--mail-surface)' }}>
            {person(v)}
            <button type="button" aria-label={`Remove ${v.name}`} onClick={() => onChange(value.filter((x) => x.id !== v.id))}><X size={14} /></button>
          </span>
        ))}
        <input
          id={id}
          value={q}
          placeholder={value.length ? '' : placeholder}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Backspace' && !q && value.length) onChange(value.slice(0, -1));
            if (e.key === 'Enter' && shown[0]) { e.preventDefault(); onChange([...value, shown[0]]); setQ(''); setOpen(false); }
            if (e.key === 'Escape') setOpen(false);
          }}
          autoComplete="off"
        />
      </div>
      {open && shown.length > 0 && (
        <div className="mail-options" role="listbox">
          {shown.map((o) => (
            <button
              type="button" key={o.id} role="option" aria-selected="false" className="mail-option"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { onChange([...value, o]); setQ(''); setOpen(false); }}
            >
              <span className="mail-option-name">{o.name}</span>
              <span className="mail-option-meta">{o.company} · {o.email}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Compose({ draft, onClose, onSent, onOpenDisclaimer }) {
  const [to, setTo] = useState(draft.to || []);
  const [cc, setCc] = useState(draft.cc || []);
  const [bcc, setBcc] = useState(draft.bcc || []);
  const [showCc, setShowCc] = useState((draft.cc || []).length > 0);
  const [showBcc, setShowBcc] = useState((draft.bcc || []).length > 0);
  const [subject, setSubject] = useState(draft.subject || '');
  const [body, setBody] = useState(draft.bodyHtml || '');
  const [kept, setKept] = useState(draft.forwardAttachments || []);
  const [files, setFiles] = useState(draft.files || []);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(draft.id ? 'Draft' : '');
  const editor = useRef(null);

  // Autosave: one save at a time, each carrying whatever is on screen when it runs.
  const draftId = useRef(draft.id || null);
  const dirty = useRef(false);
  const stopped = useRef(false);
  const chain = useRef(Promise.resolve());
  const timer = useRef(null);
  const fields = useRef(null);
  fields.current = { to, cc, bcc, subject, kept };

  const quill = () => editor.current?.getEditor();

  const payload = () => {
    const f = fields.current;
    return {
      to: f.to.map((x) => x.id), cc: f.cc.map((x) => x.id), bcc: f.bcc.map((x) => x.id),
      subject: f.subject, body_html: quill() ? writtenHtml(quill()) : '',
      reply_to: draft.replyTo || null, forward_attachments: f.kept.map((a) => a.id),
    };
  };

  const save = useCallback(() => {
    chain.current = chain.current.then(async () => {
      if (stopped.current || !dirty.current) return;
      dirty.current = false;
      try {
        const d = draftId.current
          ? await api.mail.updateDraft(draftId.current, payload())
          : await api.mail.createDraft(payload());
        draftId.current = d.id;
        setSaved(`Draft saved ${new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`);
      } catch {
        dirty.current = true;
        setSaved('Draft not saved — will retry');
      }
    });
    return chain.current;
  // payload reads refs only, so the one save function serves the whole life of the composer.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const touch = useCallback(() => {
    dirty.current = true;
    clearTimeout(timer.current);
    timer.current = setTimeout(save, AUTOSAVE_MS);
  }, [save]);

  useEffect(() => () => clearTimeout(timer.current), []);

  const edit = (set) => (v) => { set(v); touch(); };

  // A file is uploaded to the draft as soon as it is chosen, so it is still
  // there if the message is finished another day.
  async function addFiles(list) {
    const chosen = Array.from(list || []);
    if (!chosen.length) return;
    const big = chosen.find((f) => f.size > MAX_FILE_MB * 1024 * 1024);
    if (big) { setError(`${big.name} is over ${MAX_FILE_MB} MB`); return; }
    if (files.length + chosen.length > MAX_FILES) { setError(`At most ${MAX_FILES} attachments`); return; }
    setError('');
    setUploading(true);
    try {
      if (!draftId.current) { dirty.current = true; await save(); }
      if (!draftId.current) throw new Error('The draft could not be saved, so the file was not attached');
      const d = await api.mail.addDraftFiles(draftId.current, chosen);
      setFiles(d.files);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setUploading(false);
    }
  }

  async function removeFile(f) {
    try {
      const d = await api.mail.removeDraftFile(draftId.current, f.id);
      setFiles(d.files);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    }
  }

  // The table buttons act on wherever the cursor is; mousedown is held back so
  // pressing one does not take the cursor out of the editor first.
  const table = (fn) => (e) => {
    e.preventDefault();
    const q = quill();
    if (!q) return;
    q.focus();
    fn(q.getModule('table'));
  };

  // Closing keeps what was written; only Discard throws it away.
  async function close() {
    clearTimeout(timer.current);
    await save();
    onClose(draftId.current ? 'Saved to Drafts.' : '');
  }

  async function discard() {
    stopped.current = true;
    clearTimeout(timer.current);
    await chain.current;
    if (draftId.current) await api.mail.removeDraft(draftId.current).catch(() => {});
    onClose(draftId.current ? 'Draft discarded.' : '');
  }

  async function submit(e) {
    e.preventDefault();
    setError('');
    if (!to.length) { setError('Choose at least one person to send to'); return; }
    const q = quill();
    if (!q.getText().trim()) { setError('A message needs a body'); return; }
    setBusy(true);
    stopped.current = true;
    clearTimeout(timer.current);
    try {
      await chain.current;
      const p = payload();
      await api.mail.send({
        to: p.to, cc: p.cc, bcc: p.bcc, subject, bodyHtml: p.body_html,
        replyTo: draft.replyTo, forwardAttachments: p.forward_attachments, draftId: draftId.current,
      });
      onSent();
    } catch (err) {
      stopped.current = false;
      setError(err.response?.data?.error || err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={close} title={draft.title || 'New message'} width={760}>
      <form onSubmit={submit} className="mail-compose">
        {error && <div className="alert alert-error" role="alert">{error}</div>}

        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '6px 12px',
          background: 'var(--slate-100)',
          border: '1px solid var(--slate-200)',
          borderRadius: '6px',
          fontSize: '13px',
          color: 'var(--slate-500)',
          marginBottom: '12px'
        }}>
          <span>Informal operational facility — not a legal/contractual communication mode.</span>
          {onOpenDisclaimer && (
            <button
              type="button"
              className="btn-link"
              style={{ fontSize: '13px', padding: 0, textDecoration: 'underline', color: 'var(--on-blue)' }}
              onClick={onOpenDisclaimer}
            >
              Disclaimer
            </button>
          )}
        </div>

        <Field label="To" htmlFor="mail-to">
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <div style={{ flex: 1 }}>
              <RecipientPicker id="mail-to" value={to} onChange={edit(setTo)} placeholder="Type a name, email or company" />
            </div>
            {!showCc && <button type="button" className="btn-link" onClick={() => setShowCc(true)}>Cc</button>}
            {!showBcc && <button type="button" className="btn-link" onClick={() => setShowBcc(true)}>Bcc</button>}
          </div>
        </Field>
        {showCc && (
          <Field label="Cc" htmlFor="mail-cc">
            <RecipientPicker id="mail-cc" value={cc} onChange={edit(setCc)} placeholder="Copy someone in" />
          </Field>
        )}
        {showBcc && (
          <Field label="Bcc" htmlFor="mail-bcc">
            <RecipientPicker id="mail-bcc" value={bcc} onChange={edit(setBcc)} placeholder="Copy someone in without the others seeing" />
          </Field>
        )}
        <Field label="Subject" required htmlFor="mail-subject">
          <input id="mail-subject" className="form-control" required maxLength={200} value={subject} onChange={(e) => edit(setSubject)(e.target.value)} />
        </Field>
        {/* Quill renders a contenteditable, not a form control, so the region
            carries the name instead of a <label htmlFor>. */}
        <div className="field">
          <span className="field-label" id="mail-body-label">
            Message<span aria-hidden="true" style={{ color: 'var(--red)' }}> *</span>
          </span>
          <div role="group" aria-labelledby="mail-body-label" className="mail-editor">
            <ReactQuill
              ref={editor}
              theme="snow"
              value={body}
              onChange={(v, _delta, source) => { setBody(v); if (source === 'user') touch(); }}
              modules={EDITOR_MODULES}
              formats={EDITOR_FORMATS}
            />
            <div className="mail-table-tools" role="toolbar" aria-label="Table">
              <TableIcon size={14} aria-hidden="true" />
              <button type="button" onMouseDown={table((t) => t.insertTable(3, 3))}>Insert table</button>
              <span className="sep" />
              <button type="button" onMouseDown={table((t) => t.insertRowBelow())}>+ Row</button>
              <button type="button" onMouseDown={table((t) => t.insertColumnRight())}>+ Column</button>
              <button type="button" onMouseDown={table((t) => t.deleteRow())}>− Row</button>
              <button type="button" onMouseDown={table((t) => t.deleteColumn())}>− Column</button>
              <button type="button" onMouseDown={table((t) => t.deleteTable())}>Delete table</button>
            </div>
          </div>
        </div>
        <div className="mail-files" style={{ padding: '0 4px' }}>
          {kept.map((a) => (
            <span key={a.id} className="mail-chip" style={{ background: 'var(--mail-surface)' }}>
              <Paperclip size={14} /> {a.filename} <small>{kb(a.size_bytes)}</small>
              <button type="button" aria-label={`Remove ${a.filename}`} onClick={() => edit(setKept)(kept.filter((x) => x.id !== a.id))}><X size={14} /></button>
            </span>
          ))}
          {files.map((f) => (
            <span key={f.id} className="mail-chip" style={{ background: 'var(--mail-surface)' }}>
              <Paperclip size={14} /> {f.filename} <small>{kb(f.size_bytes)}</small>
              <button type="button" aria-label={`Remove ${f.filename}`} onClick={() => removeFile(f)}><X size={14} /></button>
            </span>
          ))}
          <label className="btn btn-sm" style={{ cursor: 'pointer', background: 'var(--mail-surface)', border: '1px solid var(--border)' }}>
            <Paperclip size={14} style={{ marginRight: 6 }} /> {uploading ? 'Attaching…' : 'Attach files'}
            <input type="file" multiple hidden disabled={uploading} onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
          </label>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 24, alignItems: 'center' }}>
          <button type="submit" className="btn btn-primary" disabled={busy || uploading}>
            {busy ? 'Sending…' : 'Send Message'}
          </button>
          <button type="button" className="btn" onClick={close} disabled={busy || uploading}>Save &amp; close</button>
          <button type="button" className="btn" onClick={discard} disabled={busy || uploading}>Discard</button>
          <span className="mail-draft-note" role="status" style={{ marginLeft: 'auto' }}>{saved}</span>
        </div>
      </form>
    </Modal>
  );
}

function SignatureSettings({ value, onClose, onSaved }) {
  const [text, setText] = useState(value);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api.mail.saveSettings({ signature: text });
      onSaved(r.signature);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="Quick Connect settings" width={560}>
      <form onSubmit={submit}>
        {error && <div className="alert alert-error" role="alert">{error}</div>}
        <Field label="Signature">
          <textarea
            rows={6} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)}
            placeholder={'Your name\nDesignation, department\nPhone'}
          />
        </Field>
        <div className="mail-draft-note">Added under every new message, reply and forward. Leave it empty for none.</div>
        <div className="mail-draft-note" style={{ marginTop: 6, fontSize: '13px', color: 'var(--slate-500)' }}>
          Note: Quick Connect is an informal operational facility for day-to-day desk queries, not an official legal communication channel.
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
          <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </Modal>
  );
}

function DisclaimerModal({ open, onClose }) {
  if (!open) return null;
  return (
    <Modal open onClose={onClose} title="Quick Connect — Operational & Legal Disclaimer" width={600}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, color: 'var(--slate-700)', fontSize: '13.5px', lineHeight: 1.6 }}>
        <div style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 12,
          padding: '12px 16px',
          background: 'rgba(245, 158, 11, 0.08)',
          border: '1px solid rgba(245, 158, 11, 0.28)',
          borderRadius: 8,
          color: 'var(--on-amber)'
        }}>
          <AlertTriangle size={20} style={{ color: 'var(--on-amber)', flexShrink: 0, marginTop: 2 }} />
          <div>
            <strong style={{ display: 'block', marginBottom: 2, color: 'var(--amber-strong)', fontSize: '14px' }}>
              Notice on Non-Legal / Non-Contractual Status
            </strong>
            Quick Connect is strictly an informal in-portal operational coordination facility. It does <strong>NOT</strong> constitute an official, statutory, or legal mode of communication under PPA/PSA contracts, CERC regulations, or Indian contract law.
          </div>
        </div>

        <div>
          <h4 style={{ margin: '0 0 6px 0', fontSize: '14px', fontWeight: 600, color: 'var(--slate-900)' }}>
            1. Purpose of Quick Connect
          </h4>
          <p style={{ margin: 0 }}>
            This messaging feature is provided solely for rapid operational desk-to-desk coordination, technical queries, daily clarifications, and convenient communication between registered stakeholders (SJVN internal desks, sellers, buyers, and trading clients).
          </p>
        </div>

        <div>
          <h4 style={{ margin: '0 0 6px 0', fontSize: '14px', fontWeight: 600, color: 'var(--slate-900)' }}>
            2. Formal &amp; Contractual Notices
          </h4>
          <p style={{ margin: 0 }}>
            Any formal contractual notices, statutory dispute intimations, default notices, event of default / force majeure claims, commercial invoices, or termination notices <strong>must NOT be served via Quick Connect</strong>. All such binding communications must strictly follow the formal modes stipulated in the respective Power Purchase Agreements (PPAs) or Power Sale Agreements (PSAs) (e.g., registered speed post, official authorized corporate email, or formal letter).
          </p>
        </div>

        <div>
          <h4 style={{ margin: '0 0 6px 0', fontSize: '14px', fontWeight: 600, color: 'var(--slate-900)' }}>
            3. Evidentiary Limitation
          </h4>
          <p style={{ margin: 0 }}>
            Messages, attachments, and informal exchanges made within Quick Connect carry no contractual force and shall not be construed as contractual admissions, waivers, or amendments to any PPA/PSA terms.
          </p>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
          <button type="button" className="btn btn-primary" onClick={onClose} style={{ padding: '8px 20px' }}>
            Understood &amp; Close
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** A PDF or picture shown in the page, with the download still one click away. */
function AttachmentPreview({ file, onClose }) {
  const [url, setUrl] = useState('');
  const [blob, setBlob] = useState(null);
  const [error, setError] = useState('');
  const type = previewType(file.filename);

  useEffect(() => {
    let made = '';
    let live = true;
    api.mail.attachment(file.id)
      .then((b) => {
        if (!live) return;
        made = URL.createObjectURL(new Blob([b], { type }));
        setBlob(b);
        setUrl(made);
      })
      .catch((e) => { if (live) setError(e.response?.status === 404 ? 'That attachment is no longer available' : e.message); });
    return () => { live = false; if (made) URL.revokeObjectURL(made); };
  }, [file.id, type]);

  return (
    <Modal open onClose={onClose} title={file.filename} width={980}>
      {error && <div className="alert alert-error" role="alert">{error}</div>}
      {!url && !error && <div className="mail-empty">Loading…</div>}
      {url && (
        <div className="mail-preview">
          {type === 'application/pdf'
            ? <iframe src={url} title={file.filename} />
            : <img src={url} alt={file.filename} />}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        <button type="button" className="btn btn-primary" disabled={!blob} onClick={() => saveBlob(blob, file.filename)}>
          <Download size={14} style={{ marginRight: 6 }} /> Download
        </button>
        <button type="button" className="btn" onClick={onClose}>Close</button>
      </div>
    </Modal>
  );
}

/** For the sender: who has opened the message, and when. */
function Receipts({ recipients }) {
  const opened = recipients.filter((r) => r.opened_at);
  return (
    <details className="mail-receipts">
      <summary>
        <CheckCheck size={14} /> Opened by {opened.length} of {recipients.length}
      </summary>
      <ul>
        {recipients.map((r) => (
          <li key={r.id} className={r.opened_at ? 'opened' : ''}>
            <span>{person(r)}</span>
            <span>{r.opened_at ? fullWhen(r.opened_at) : 'Not opened yet'}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

const EMPTY = {
  INBOX: 'You have no new messages.',
  STARRED: 'Nothing starred. Star a message to keep it close at hand.',
  DRAFTS: 'No drafts. A message you start and do not send is kept here.',
  SENT: 'You have not sent anything yet.',
  ARCHIVE: 'Nothing archived.',
  TRASH: 'The trash is empty.',
};

export default function Mail() {
  const { user } = useAuth();
  const [folder, setFolder] = useState('INBOX');
  const [q, setQ] = useState('');
  const [items, setItems] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [shown, setShown] = useState(PAGE);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState(null);
  const [thread, setThread] = useState(null);
  const [compose, setCompose] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [onlyUnread, setOnlyUnread] = useState(false);
  const [sort, setSort] = useState('newest');
  const [counts, setCounts] = useState({ unread: 0, drafts: 0 });
  const [signature, setSignature] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [disclaimerOpen, setDisclaimerOpen] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const [preview, setPreview] = useState(null);

  const isDrafts = folder === 'DRAFTS';
  const isTrash = folder === 'TRASH';
  const canFilterUnread = folder === 'INBOX' || folder === 'ARCHIVE';

  const load = useCallback(() => {
    setLoading(true);
    const list = folder === 'DRAFTS'
      ? api.mail.drafts({ q: q || undefined })
      : api.mail.list({
        box: folder, q: q || undefined, sort, limit: shown + 1,
        unread: onlyUnread && (folder === 'INBOX' || folder === 'ARCHIVE') ? 1 : undefined,
      });
    list
      .then((r) => {
        const rows = r || [];
        // One more than a page is asked for, to know whether there is another page.
        const page = folder === 'DRAFTS' ? rows : rows.slice(0, shown);
        setItems(page);
        setHasMore(folder !== 'DRAFTS' && rows.length > shown);
        // A message that has left the folder cannot stay ticked.
        setSelected((sel) => {
          const here = new Set(page.map((m) => m.id));
          const next = new Set([...sel].filter((id) => here.has(id)));
          return next.size === sel.size ? sel : next;
        });
        setError('');
      })
      .catch((e) => setError(e.response?.data?.error || e.message))
      .finally(() => setLoading(false));
    api.mail.unreadCount().then(setCounts).catch(() => {});
  }, [folder, q, sort, onlyUnread, shown]);

  useEffect(() => {
    api.mail.settings().then((r) => setSignature(r.signature || '')).catch(() => {});
  }, []);

  useEffect(() => {
    const t = setTimeout(load, q ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  useEffect(() => {
    const i = setInterval(() => { if (!document.hidden) load(); }, 30000);
    return () => clearInterval(i);
  }, [load]);

  // A different folder, search or filter starts again from the first page.
  useEffect(() => { setShown(PAGE); setSelected(new Set()); }, [folder, q, sort, onlyUnread]);

  const tellHeader = () => window.dispatchEvent(new Event('mail:changed'));
  const fail = (e) => setError(e.response?.data?.error || e.message);
  const closeReader = () => { setOpenId(null); setThread(null); };

  async function openMessage(id) {
    setOpenId(id);
    setThread(null);
    try {
      const t = await api.mail.get(id);
      setThread(t);
      setItems((list) => list.map((m) => (m.id === id ? { ...m, is_read: true } : m)));
      api.mail.unreadCount().then(setCounts).catch(() => {});
      tellHeader();
    } catch (e) {
      fail(e);
    }
  }

  async function act(fn, msg) {
    try {
      await fn();
      setNotice(msg);
      closeReader();
      load(); tellHeader();
    } catch (e) {
      fail(e);
    }
  }

  async function toggleStar(id, starred) {
    try {
      await api.mail.setStarred(id, starred);
      setItems((list) => (folder === 'STARRED' && !starred
        ? list.filter((m) => m.id !== id)
        : list.map((m) => (m.id === id ? { ...m, is_starred: starred } : m))));
      setThread((t) => (t && t.id === id ? { ...t, starred } : t));
    } catch (e) {
      fail(e);
    }
  }

  async function bulk(action, msg) {
    const ids = [...selected];
    if (action === 'purge' && !window.confirm(`Delete ${ids.length} message${ids.length === 1 ? '' : 's'} for good? This cannot be undone.`)) return;
    try {
      const r = await api.mail.bulk(ids, action);
      setNotice(`${r.done} message${r.done === 1 ? '' : 's'} ${msg}.`);
      setSelected(new Set());
      if (ids.includes(openId)) closeReader();
      load(); tellHeader();
    } catch (e) {
      fail(e);
    }
  }

  const toggleSelected = (id) => setSelected((sel) => {
    const next = new Set(sel);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const allSelected = items.length > 0 && items.every((m) => selected.has(m.id));

  async function openAttachment(a) {
    if (previewType(a.filename)) { setPreview(a); return; }
    try {
      saveBlob(await api.mail.attachment(a.id), a.filename);
    } catch (e) {
      setError(e.response?.status === 404 ? 'That attachment is no longer available' : e.message);
    }
  }

  const last = thread?.messages?.[thread.messages.length - 1];

  // Reply, reply to all and forward, each opening on the last message of the thread.
  const drafts = useMemo(() => {
    if (!last) return null;
    const sig = signatureHtml(signature);
    const reSubject = /^re:/i.test(last.subject) ? last.subject : `Re: ${last.subject}`;
    const quoted = `<p><br></p>${sig}<p><br></p><p>On ${esc(fullWhen(last.created_at))}, ${esc(last.sender_name)} wrote:</p>${quoteHtml(htmlOf(last))}`;
    const mine = last.sender_id === user?.id;
    const sender = { id: last.sender_id, name: last.sender_name, email: last.sender_email };
    // A blind copy stays blind: it is never carried into a reply.
    const others = last.recipients.filter((r) => r.kind !== 'BCC' && r.id !== user?.id && r.id !== last.sender_id);
    const to = (list) => list.filter((r) => r.kind === 'TO');
    const cc = others.filter((r) => r.kind === 'CC');
    const forwarded = [
      '<p><br></p>', sig, '<p><br></p>',
      '<p>---------- Forwarded message ----------</p>',
      `<p>From: ${esc(last.sender_name)}</p>`,
      `<p>Date: ${esc(fullWhen(last.created_at))}</p>`,
      `<p>Subject: ${esc(last.subject)}</p>`,
      `<p>To: ${esc(names(last.recipients, 'TO') || '—')}</p>`,
      names(last.recipients, 'CC') ? `<p>Cc: ${esc(names(last.recipients, 'CC'))}</p>` : '',
      '<p><br></p>', htmlOf(last),
    ].join('');
    return {
      reply: {
        title: 'Reply', replyTo: last.id, subject: reSubject, bodyHtml: quoted,
        to: mine ? to(last.recipients.filter((r) => r.id !== user?.id)) : [sender],
      },
      replyAll: {
        title: 'Reply to all', replyTo: last.id, subject: reSubject, bodyHtml: quoted,
        to: mine ? to(others) : [sender, ...to(others)],
        cc,
      },
      forward: {
        title: 'Forward', subject: /^fwd?:/i.test(last.subject) ? last.subject : `Fwd: ${last.subject}`,
        bodyHtml: forwarded, forwardAttachments: last.attachments,
      },
      // Reply-all is only worth offering when it reaches someone Reply does not.
      hasOthers: others.length > 0 && !(mine && cc.length === 0),
    };
  }, [last, user?.id, signature]);

  const startCompose = (d) => { setNotice(''); setCompose(d); };

  // Another screen can open the composer ready-written (navigate('/mail', { state: { compose } })).
  const routeLocation = useLocation();
  const routeNavigate = useNavigate();
  useEffect(() => {
    const preset = routeLocation.state?.compose;
    if (!preset) return;
    startCompose(preset);
    routeNavigate(routeLocation.pathname, { replace: true, state: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeLocation.state]);

  const openDraft = (d) => startCompose({
    id: d.id, title: 'Draft', to: d.to, cc: d.cc, bcc: d.bcc, subject: d.subject,
    bodyHtml: d.body_html || linesToHtml(d.body), replyTo: d.reply_to,
    forwardAttachments: d.forward_attachments, files: d.files,
  });

  return (
    <div>
      <PageHeader
        title="Quick Connect"
        subtitle="In-portal messaging for operational coordination and desk queries."
        actions={
          <button
            type="button"
            className="btn btn-outline"
            onClick={() => setDisclaimerOpen(true)}
            title="View Quick Connect operational & legal disclaimer"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 12px',
              fontSize: '13.5px',
              fontWeight: 500,
              borderRadius: '6px',
              color: 'var(--slate-600)',
              border: '1px solid var(--slate-300)',
              background: 'var(--surface)',
              cursor: 'pointer'
            }}
          >
            <Scale size={14} style={{ color: 'var(--slate-500)' }} />
            <span>Disclaimer</span>
          </button>
        }
      />

      {error && <div className="alert alert-error" role="alert">{error}</div>}
      {notice && <div className="alert alert-success" role="status">{notice}</div>}

      <div className="elite-mail-wrapper">
        <aside className="mail-sidebar">
          <button type="button" className="mail-compose-btn" onClick={() => startCompose({ bodyHtml: signature ? `<p><br></p>${signatureHtml(signature)}` : '' })}>
            <Plus size={18} />
            <span>New Message</span>
          </button>

          <div className="mail-nav-title">Folders</div>
          <nav aria-label="Quick Connect folders">
            {FOLDERS.map((f) => (
              <div
                key={f.key}
                className={`mail-nav-item ${folder === f.key ? 'active' : ''}`}
                onClick={() => { setItems([]); setHasMore(false); setFolder(f.key); closeReader(); }}
              >
                <div className="left">
                  <f.icon size={18} />
                  <span>{f.label}</span>
                </div>
                {f.key === 'INBOX' && counts.unread > 0 && <div className="mail-nav-badge">{counts.unread}</div>}
                {f.key === 'DRAFTS' && counts.drafts > 0 && <div className="mail-nav-badge muted">{counts.drafts}</div>}
              </div>
            ))}
          </nav>

          <div className="mail-nav-item mail-nav-settings" onClick={() => setSettingsOpen(true)}>
            <div className="left">
              <Settings size={18} />
              <span>Signature</span>
            </div>
          </div>
        </aside>

        <section className="mail-list-col">
          <div className="mail-list-header">
            <h2>{FOLDERS.find(f => f.key === folder)?.label}</h2>
            <div className="mail-search-box">
              <Search size={16} />
              <input type="search" placeholder="Search messages..." value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search mail" />
            </div>
            {!isDrafts && (
              <div className="mail-list-tools">
                <input
                  type="checkbox" className="mail-check" aria-label="Select all shown"
                  checked={allSelected} disabled={!items.length}
                  onChange={() => setSelected(allSelected ? new Set() : new Set(items.map((m) => m.id)))}
                />
                {canFilterUnread && (
                  <>
                    <button type="button" className={`mail-filter ${onlyUnread ? '' : 'active'}`} aria-pressed={!onlyUnread} onClick={() => setOnlyUnread(false)}>All</button>
                    <button type="button" className={`mail-filter ${onlyUnread ? 'active' : ''}`} aria-pressed={onlyUnread} onClick={() => setOnlyUnread(true)}>Unread</button>
                  </>
                )}
                <button type="button" className="mail-filter mail-sort" onClick={() => setSort(sort === 'newest' ? 'oldest' : 'newest')} title="Change the order">
                  <ArrowDownUp size={13} /> {sort === 'newest' ? 'Newest first' : 'Oldest first'}
                </button>
              </div>
            )}
            {selected.size > 0 && (
              <div className="mail-bulk" role="toolbar" aria-label="Actions on the selected messages">
                <strong>{selected.size} selected</strong>
                {isTrash ? (
                  <>
                    <button type="button" onClick={() => bulk('restore', 'restored')}><RotateCcw size={13} /> Restore</button>
                    <button type="button" className="danger" onClick={() => bulk('purge', 'deleted for good')}><Trash2 size={13} /> Delete forever</button>
                  </>
                ) : (
                  <>
                    {folder !== 'SENT' && <button type="button" onClick={() => bulk('read', 'marked read')}><MailOpen size={13} /> Read</button>}
                    {folder !== 'SENT' && <button type="button" onClick={() => bulk('unread', 'marked unread')}><MailIcon size={13} /> Unread</button>}
                    {folder === 'INBOX' && <button type="button" onClick={() => bulk('archive', 'archived')}><Archive size={13} /> Archive</button>}
                    {folder === 'ARCHIVE' && <button type="button" onClick={() => bulk('unarchive', 'moved to the inbox')}><ArchiveRestore size={13} /> To inbox</button>}
                    <button type="button" onClick={() => bulk(folder === 'STARRED' ? 'unstar' : 'star', folder === 'STARRED' ? 'unstarred' : 'starred')}><Star size={13} /> {folder === 'STARRED' ? 'Unstar' : 'Star'}</button>
                    <button type="button" className="danger" onClick={() => bulk('trash', 'moved to the trash')}><Trash2 size={13} /> Delete</button>
                  </>
                )}
              </div>
            )}
          </div>

          <div className="mail-list-scroll">
            {isTrash && items.length > 0 && (
              <div className="mail-trash-note">Messages are removed from the trash after {TRASH_DAYS} days.</div>
            )}
            {loading && !items.length && <div className="mail-empty">Loading messages...</div>}
            {!loading && !items.length && (
              <div className="mail-empty">
                {q ? 'Nothing matches that search.' : onlyUnread && canFilterUnread ? 'Nothing unread.' : EMPTY[folder]}
              </div>
            )}
            {isDrafts && items.map((d) => (
              <div key={d.id} className="mail-item" onClick={() => openDraft(d)}>
                <div className="mail-item-header">
                  <span className="mail-item-sender">
                    <span className="mail-draft-tag">Draft</span> {d.to?.length ? `To: ${d.to.map((r) => r.name).join(', ')}` : 'No recipient yet'}
                  </span>
                  <span className="mail-item-time">{when(d.updated_at)}</span>
                </div>
                <div className="mail-item-subject">
                  {(d.files?.length > 0 || d.forward_attachments?.length > 0) && <Paperclip size={12} style={{ display: 'inline', marginRight: 4 }} />}
                  {d.subject || '(no subject)'}
                </div>
                <div className="mail-item-preview">{d.preview}</div>
              </div>
            ))}
            {!isDrafts && items.map((m) => (
              <div
                key={m.id}
                className={`mail-item with-check ${m.is_read || m.box === 'SENT' ? '' : 'unread'} ${openId === m.id ? 'active' : ''} ${selected.has(m.id) ? 'selected' : ''}`}
                onClick={() => openMessage(m.id)}
              >
                <input
                  type="checkbox" className="mail-check" aria-label={`Select ${m.subject}`}
                  checked={selected.has(m.id)} onClick={(e) => e.stopPropagation()} onChange={() => toggleSelected(m.id)}
                />
                <div className="mail-item-main">
                  <div className="mail-item-header">
                    <span className="mail-item-sender">
                      {m.box === 'SENT' ? `To: ${m.recipients.map((r) => r.name).join(', ') || '—'}` : m.sender_name}
                    </span>
                    <span className="mail-item-time">{when(m.created_at)}</span>
                  </div>
                  <div className="mail-item-subject">
                    {m.attachment_count > 0 && <Paperclip size={12} style={{ display: 'inline', marginRight: 4 }} />}
                    {m.subject}
                  </div>
                  <div className="mail-item-preview">{m.preview}</div>
                </div>
                {!isTrash && (
                  <button
                    type="button" className={`mail-star ${m.is_starred ? 'on' : ''}`}
                    aria-label={m.is_starred ? 'Remove star' : 'Star'} aria-pressed={!!m.is_starred}
                    onClick={(e) => { e.stopPropagation(); toggleStar(m.id, !m.is_starred); }}
                  >
                    <Star size={15} fill={m.is_starred ? 'currentColor' : 'none'} />
                  </button>
                )}
              </div>
            ))}
            {hasMore && (
              <button type="button" className="mail-more" disabled={loading} onClick={() => setShown(shown + PAGE)}>
                {loading ? 'Loading…' : 'Load more'}
              </button>
            )}
          </div>
        </section>

        <section className="mail-read-col">
          {!openId && (
            <div className="mail-read-empty">
              <MailIcon size={64} strokeWidth={1} />
              <p>Select a message to read</p>
            </div>
          )}
          {openId && !thread && (
            <div className="mail-read-empty">
              <p>Loading thread...</p>
            </div>
          )}
          {thread && (
            <>
              <div className="mail-read-header">
                <h2 className="mail-read-subject">{last?.subject}</h2>
                <div className="mail-read-actions">
                  {!thread.trashed && (
                    <>
                      <button className="mail-action-btn" title="Reply" onClick={() => startCompose(drafts.reply)}><Reply size={18} /></button>
                      {drafts.hasOthers && (
                        <button className="mail-action-btn" title="Reply to all" onClick={() => startCompose(drafts.replyAll)}><ReplyAll size={18} /></button>
                      )}
                      <button className="mail-action-btn" title="Forward" onClick={() => startCompose(drafts.forward)}><Forward size={18} /></button>
                      <button className={`mail-action-btn ${thread.starred ? 'starred' : ''}`} title={thread.starred ? 'Remove star' : 'Star'} onClick={() => toggleStar(thread.id, !thread.starred)}>
                        <Star size={18} fill={thread.starred ? 'currentColor' : 'none'} />
                      </button>
                      {thread.box === 'INBOX' && (
                        <button className="mail-action-btn" title="Mark as unread" onClick={() => act(() => api.mail.setRead(thread.id, false), 'Marked unread.')}><MailOpen size={18} /></button>
                      )}
                      {thread.box === 'INBOX' && (
                        <button className="mail-action-btn" title={thread.archived ? "Move to inbox" : "Archive"} onClick={() => act(() => api.mail.setArchived(thread.id, !thread.archived), thread.archived ? 'Moved back to the inbox.' : 'Archived.')}>
                          <ArchiveRestore size={18} />
                        </button>
                      )}
                    </>
                  )}
                  <button className="mail-action-btn" title="Print or save as PDF" onClick={() => printThread(thread, user?.name || '')}><Printer size={18} /></button>
                  {thread.trashed ? (
                    <>
                      <button className="mail-action-btn" title="Restore" onClick={() => act(() => api.mail.restore(thread.id), 'Restored.')}><RotateCcw size={18} /></button>
                      <button className="mail-action-btn delete" title="Delete forever" onClick={() => {
                          if (window.confirm('Delete this message for good? This cannot be undone. Everyone else keeps their copy.')) {
                            act(() => api.mail.purge(thread.id), 'Deleted for good.');
                          }
                        }}>
                        <Trash2 size={18} />
                      </button>
                    </>
                  ) : (
                    <button className="mail-action-btn delete" title="Delete" onClick={() => act(() => api.mail.remove(thread.id), 'Moved to the trash.')}>
                      <Trash2 size={18} />
                    </button>
                  )}
                </div>
              </div>

              <div className="mail-thread">
                {thread.messages.map((m) => (
                  <div key={m.id} className="mail-message-bubble">
                    <div className="mail-message-header">
                      <div className="mail-message-sender-info">
                        <Avatar name={m.sender_name} />
                        <div className="mail-message-meta">
                          <h4>{m.sender_name}</h4>
                          <div>To: {names(m.recipients, 'TO') || '—'}
                          {names(m.recipients, 'CC') && <span> · Cc: {names(m.recipients, 'CC')}</span>}
                          {names(m.recipients, 'BCC') && <span> · Bcc: {names(m.recipients, 'BCC')}</span>}</div>
                          {m.sender_id === user?.id && m.recipients.length > 0 && <Receipts recipients={m.recipients} />}
                        </div>
                      </div>
                      <div className="mail-message-time">{fullWhen(m.created_at)}</div>
                    </div>

                    {/* body_html is cleaned by the server to a short list of tags before it is stored. */}
                    {m.body_html
                      ? <div className="mail-message-body mail-html" dangerouslySetInnerHTML={{ __html: m.body_html }} />
                      : <div className="mail-message-body">{m.body}</div>}

                    {m.attachments.length > 0 && (
                      <div className="mail-attachments">
                        {m.attachments.map((a) => (
                          <div key={a.id} className="mail-attachment-chip" onClick={() => openAttachment(a)} title={previewType(a.filename) ? 'Preview' : 'Download'}>
                            <Paperclip size={14} />
                            <span>{a.filename}</span>
                            <small style={{ color: 'var(--mail-muted)' }}>{kb(a.size_bytes)}</small>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              <div style={{
                margin: '12px 0 8px',
                textAlign: 'center',
                fontSize: '13px',
                color: '#94a3b8'
              }}>
                Quick Connect is an informal operational facility ·{' '}
                <button
                  type="button"
                  className="btn-link"
                  style={{ fontSize: '13px', padding: 0, textDecoration: 'underline', color: 'var(--slate-500)' }}
                  onClick={() => setDisclaimerOpen(true)}
                >
                  Disclaimer
                </button>
              </div>

              {!thread.trashed && (
                <div className="mail-reply-box">
                  <button type="button" className="mail-reply-btn" onClick={() => startCompose(drafts.reply)}>
                    <Reply size={18} />
                    <span>Reply</span>
                  </button>
                  {drafts.hasOthers && (
                    <button type="button" className="mail-reply-btn" onClick={() => startCompose(drafts.replyAll)}>
                      <ReplyAll size={18} />
                      <span>Reply all</span>
                    </button>
                  )}
                  <button type="button" className="mail-reply-btn" onClick={() => startCompose(drafts.forward)}>
                    <Forward size={18} />
                    <span>Forward</span>
                  </button>
                </div>
              )}
            </>
          )}
        </section>
      </div>

      {compose && (
        <Compose
          draft={compose}
          onClose={(msg) => { setCompose(null); setNotice(msg || ''); load(); }}
          onSent={() => {
            setCompose(null);
            setNotice('Sent.');
            if (openId) openMessage(openId);
            load();
          }}
          onOpenDisclaimer={() => setDisclaimerOpen(true)}
        />
      )}

      {settingsOpen && (
        <SignatureSettings
          value={signature}
          onClose={() => setSettingsOpen(false)}
          onSaved={(sig) => { setSignature(sig); setSettingsOpen(false); setNotice('Signature saved.'); }}
        />
      )}

      {disclaimerOpen && (
        <DisclaimerModal
          open={disclaimerOpen}
          onClose={() => setDisclaimerOpen(false)}
        />
      )}

      {preview && <AttachmentPreview file={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}
