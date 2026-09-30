import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import api from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { PageHeader, Modal, Field } from '../components/ui.jsx';

// In-portal mail. What one person writes lands in the other's inbox here; it is
// never sent out of the portal. Who may write to whom is decided by the server
// (services/mail.js) — the address book only ever offers people this user may
// reach, so a seller never sees another company's names.

const FOLDERS = [
  { key: 'INBOX', label: 'Inbox' },
  { key: 'SENT', label: 'Sent' },
  { key: 'ARCHIVE', label: 'Archive' },
];

const MAX_FILES = 5;
const MAX_FILE_MB = 10;

function when(iso) {
  if (!iso) return '';
  // SQLite's datetime('now') is UTC without a zone; say so before parsing.
  const d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso.replace(' ', 'T')}Z`);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay
    ? d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
}

const fullWhen = (iso) => {
  if (!iso) return '';
  const d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso.replace(' ', 'T')}Z`);
  return d.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
};

const person = (p) => (p.company && p.company !== 'SJVN' ? `${p.name} (${p.company})` : p.name);

const kb = (n) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** Pick people from the address book, as chips. */
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
          <span key={v.id} className="mail-chip">
            {person(v)}
            <button type="button" aria-label={`Remove ${v.name}`} onClick={() => onChange(value.filter((x) => x.id !== v.id))}>×</button>
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

function Compose({ draft, onClose, onSent }) {
  const [to, setTo] = useState(draft.to || []);
  const [cc, setCc] = useState(draft.cc || []);
  const [showCc, setShowCc] = useState((draft.cc || []).length > 0);
  const [subject, setSubject] = useState(draft.subject || '');
  const [body, setBody] = useState(draft.body || '');
  const [files, setFiles] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  function addFiles(list) {
    const next = [...files, ...Array.from(list || [])];
    const big = next.find((f) => f.size > MAX_FILE_MB * 1024 * 1024);
    if (big) { setError(`${big.name} is over ${MAX_FILE_MB} MB`); return; }
    if (next.length > MAX_FILES) { setError(`At most ${MAX_FILES} attachments`); return; }
    setError('');
    setFiles(next);
  }

  async function submit(e) {
    e.preventDefault();
    setError('');
    if (!to.length) { setError('Choose at least one person to send to'); return; }
    setBusy(true);
    try {
      await api.mail.send({
        to: to.map((x) => x.id), cc: cc.map((x) => x.id), subject, body, replyTo: draft.replyTo, files,
      });
      onSent();
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={draft.replyTo ? 'Reply' : 'New message'} width={720}>
      <form onSubmit={submit} className="mail-compose">
        {error && <div className="alert alert-error" role="alert">{error}</div>}
        <Field label="To" htmlFor="mail-to">
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <div style={{ flex: 1 }}>
              <RecipientPicker id="mail-to" value={to} onChange={setTo} placeholder="Type a name, email or company" />
            </div>
            {!showCc && <button type="button" className="btn-link" onClick={() => setShowCc(true)}>Cc</button>}
          </div>
        </Field>
        {showCc && (
          <Field label="Cc" htmlFor="mail-cc">
            <RecipientPicker id="mail-cc" value={cc} onChange={setCc} placeholder="Copy someone in" />
          </Field>
        )}
        <Field label="Subject" required htmlFor="mail-subject">
          <input id="mail-subject" required maxLength={200} value={subject} onChange={(e) => setSubject(e.target.value)} />
        </Field>
        <Field label="Message" required htmlFor="mail-body">
          <textarea id="mail-body" required rows={10} maxLength={20000} value={body} onChange={(e) => setBody(e.target.value)} />
        </Field>
        <div className="mail-files">
          {files.map((f, i) => (
            <span key={`${f.name}-${i}`} className="mail-chip">
              📎 {f.name} <small>{kb(f.size)}</small>
              <button type="button" aria-label={`Remove ${f.name}`} onClick={() => setFiles(files.filter((_, j) => j !== i))}>×</button>
            </span>
          ))}
          <label className="btn btn-sm" style={{ cursor: 'pointer' }}>
            Attach files
            <input type="file" multiple hidden onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
          </label>
          <small style={{ color: 'var(--text-light)' }}>Up to {MAX_FILES} files, {MAX_FILE_MB} MB each</small>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Sending…' : 'Send'}</button>
          <button type="button" className="btn" onClick={onClose}>Discard</button>
        </div>
      </form>
    </Modal>
  );
}

export default function Mail() {
  const { user } = useAuth();
  const [folder, setFolder] = useState('INBOX');
  const [q, setQ] = useState('');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState(null);
  const [thread, setThread] = useState(null);
  const [compose, setCompose] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    api.mail.list({ box: folder, q: q || undefined })
      .then((r) => { setItems(r || []); setError(''); })
      .catch((e) => setError(e.response?.data?.error || e.message))
      .finally(() => setLoading(false));
  }, [folder, q]);

  useEffect(() => {
    const t = setTimeout(load, q ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  // New mail turns up without a reload.
  useEffect(() => {
    const i = setInterval(() => { if (!document.hidden) load(); }, 30000);
    return () => clearInterval(i);
  }, [load]);

  const tellHeader = () => window.dispatchEvent(new Event('mail:changed'));

  async function openMessage(id) {
    setOpenId(id);
    setThread(null);
    try {
      const t = await api.mail.get(id);
      setThread(t);
      setItems((list) => list.map((m) => (m.id === id ? { ...m, is_read: true } : m)));
      tellHeader();
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    }
  }

  async function act(fn, msg) {
    try {
      await fn();
      setNotice(msg);
      setOpenId(null); setThread(null);
      load(); tellHeader();
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    }
  }

  async function download(a) {
    try {
      const blob = await api.mail.attachment(a.id);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = a.filename;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setError(e.response?.status === 404 ? 'That attachment is no longer available' : e.message);
    }
  }

  const last = thread?.messages?.[thread.messages.length - 1];

  const replyDraft = useMemo(() => {
    if (!last) return null;
    const subject = /^re:/i.test(last.subject) ? last.subject : `Re: ${last.subject}`;
    const quoted = `\n\n— On ${fullWhen(last.created_at)}, ${last.sender_name} wrote:\n${last.body.split('\n').map((l) => `> ${l}`).join('\n')}`;
    const sender = { id: last.sender_id, name: last.sender_name, email: last.sender_email };
    const others = last.recipients.filter((r) => r.id !== user?.id && r.id !== last.sender_id);
    return {
      reply: {
        replyTo: last.id, subject, body: quoted,
        to: last.sender_id === user?.id ? last.recipients.filter((r) => r.kind === 'TO') : [sender],
      },
      replyAll: {
        replyTo: last.id, subject, body: quoted,
        to: last.sender_id === user?.id ? last.recipients.filter((r) => r.kind === 'TO') : [sender, ...others.filter((r) => r.kind === 'TO')],
        cc: others.filter((r) => r.kind === 'CC'),
      },
    };
  }, [last, user?.id]);

  return (
    <div>
      <PageHeader title="Mail" subtitle="Messages between people on the portal. Nothing here is sent outside it." />

      {error && <div className="alert alert-error" role="alert">{error}</div>}
      {notice && <div className="alert alert-success" role="status">{notice}</div>}

      <div className="mail-shell">
        <aside className="mail-folders">
          <button type="button" className="btn btn-primary" style={{ width: '100%' }} onClick={() => { setNotice(''); setCompose({}); }}>
            New message
          </button>
          <nav aria-label="Mail folders">
            {FOLDERS.map((f) => (
              <button
                type="button" key={f.key}
                className={`mail-folder${folder === f.key ? ' active' : ''}`}
                aria-current={folder === f.key ? 'page' : undefined}
                onClick={() => { setFolder(f.key); setOpenId(null); setThread(null); }}
              >
                {f.label}
                {f.key === 'INBOX' && folder === 'INBOX' && items.some((m) => !m.is_read) && (
                  <span className="mail-count">{items.filter((m) => !m.is_read).length}</span>
                )}
              </button>
            ))}
          </nav>
        </aside>

        <section className={`mail-list${openId ? ' has-open' : ''}`} aria-label={`${folder.toLowerCase()} messages`}>
          <div className="mail-search">
            <input type="search" placeholder="Search subject, text or sender" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search mail" />
          </div>
          {loading && !items.length && <div className="mail-empty">Loading…</div>}
          {!loading && !items.length && (
            <div className="mail-empty">
              {q ? 'Nothing matches that search.' : folder === 'INBOX' ? 'Your inbox is empty.' : folder === 'SENT' ? 'You have not sent anything yet.' : 'Nothing archived.'}
            </div>
          )}
          {items.map((m) => (
            <button
              type="button" key={m.id}
              className={`mail-row${m.is_read || folder === 'SENT' ? '' : ' unread'}${openId === m.id ? ' active' : ''}`}
              onClick={() => openMessage(m.id)}
            >
              <div className="mail-row-top">
                <span className="mail-row-who">
                  {folder === 'SENT' ? `To: ${m.recipients.map((r) => r.name).join(', ') || '—'}` : m.sender_name}
                </span>
                <span className="mail-row-when">{when(m.created_at)}</span>
              </div>
              <div className="mail-row-subject">
                {m.attachment_count > 0 && <span aria-label="has attachments">📎 </span>}
                {m.subject}
              </div>
              <div className="mail-row-preview">{m.preview}</div>
            </button>
          ))}
        </section>

        <section className={`mail-read${openId ? ' open' : ''}`} aria-label="Message">
          {!openId && <div className="mail-empty">Choose a message to read it.</div>}
          {openId && !thread && <div className="mail-empty">Loading…</div>}
          {thread && (
            <>
              <div className="mail-read-bar">
                <button type="button" className="btn btn-sm mail-back" onClick={() => { setOpenId(null); setThread(null); }}>← Back</button>
                <h2>{last?.subject}</h2>
                <div className="mail-read-actions">
                  <button type="button" className="btn btn-sm" onClick={() => setCompose(replyDraft.reply)}>Reply</button>
                  {(last?.recipients.length || 0) > 1 && (
                    <button type="button" className="btn btn-sm" onClick={() => setCompose(replyDraft.replyAll)}>Reply all</button>
                  )}
                  {thread.box === 'INBOX' && (
                    <button
                      type="button" className="btn btn-sm"
                      onClick={() => act(() => api.mail.setArchived(thread.id, !thread.archived), thread.archived ? 'Moved back to the inbox.' : 'Archived.')}
                    >
                      {thread.archived ? 'Move to inbox' : 'Archive'}
                    </button>
                  )}
                  {thread.box === 'INBOX' && (
                    <button type="button" className="btn btn-sm" onClick={() => act(() => api.mail.setRead(thread.id, false), 'Marked unread.')}>
                      Mark unread
                    </button>
                  )}
                  <button
                    type="button" className="btn btn-sm"
                    onClick={() => {
                      if (window.confirm('Remove this message from your mail? Everyone else keeps their copy.')) {
                        act(() => api.mail.remove(thread.id), 'Removed from your mail.');
                      }
                    }}
                  >
                    Delete
                  </button>
                </div>
              </div>
              {thread.messages.map((m) => (
                <article key={m.id} className="mail-message">
                  <header>
                    <div>
                      <strong>{m.sender_name}</strong> <span className="mail-addr">&lt;{m.sender_email}&gt;</span>
                      <div className="mail-addr">
                        To: {m.recipients.filter((r) => r.kind === 'TO').map(person).join(', ') || '—'}
                        {m.recipients.some((r) => r.kind === 'CC') && (
                          <> · Cc: {m.recipients.filter((r) => r.kind === 'CC').map(person).join(', ')}</>
                        )}
                      </div>
                    </div>
                    <span className="mail-addr">{fullWhen(m.created_at)}</span>
                  </header>
                  <div className="mail-body">{m.body}</div>
                  {m.attachments.length > 0 && (
                    <div className="mail-files">
                      {m.attachments.map((a) => (
                        <button type="button" key={a.id} className="mail-chip mail-chip-btn" onClick={() => download(a)}>
                          📎 {a.filename} <small>{kb(a.size_bytes)}</small>
                        </button>
                      ))}
                    </div>
                  )}
                </article>
              ))}
            </>
          )}
        </section>
      </div>

      {compose && (
        <Compose
          draft={compose}
          onClose={() => setCompose(null)}
          onSent={() => {
            setCompose(null);
            setNotice('Sent.');
            if (openId) openMessage(openId);
            load();
          }}
        />
      )}
    </div>
  );
}
