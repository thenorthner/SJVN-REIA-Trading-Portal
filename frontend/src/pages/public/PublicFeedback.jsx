import React, { useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import PublicShell from './PublicShell.jsx';
import { useGigw } from '../../gigw/GigwContext.jsx';
import { AlertPopup } from '../../components/ui.jsx';

/**
 * Public Feedback form (GIGW 3.0 quality guideline 11, DBIM v3 s.5.6). Laid
 * out the way DBIM Annexure B asks: instructions first, one field per line,
 * labels above their fields, required fields marked *, radio buttons for the
 * five categories with one already chosen, and a primary button that shows
 * progress and cannot be pressed twice. Problems are shown in a popup when a
 * field is left and again, all together, on submit. The server checks the
 * same rules (routes/publicInfo.js).
 */
const CATEGORIES = ['content', 'accessibility', 'technical', 'translation', 'suggestion'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function validate(f) {
  const e = {};
  if (f.name.trim().length < 2 || f.name.trim().length > 100) e.name = 'fb.err.name';
  if (!EMAIL_RE.test(f.email.trim())) e.email = 'fb.err.email';
  if (f.message.trim().length < 20 || f.message.trim().length > 2000) e.message = 'fb.err.message';
  if (!f.consent) e.consent = 'fb.err.consent';
  return e;
}

export default function PublicFeedback() {
  const { t, lang } = useGigw();
  const location = useLocation();
  const [form, setForm] = useState({
    name: '', email: '', category: 'content',
    page_url: location.state?.from || '', message: '', consent: false,
  });
  const [errors, setErrors] = useState({});
  const [popup, setPopup] = useState(null);
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(null);
  const refs = { name: useRef(null), email: useRef(null), message: useRef(null), consent: useRef(null) };

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  // On leaving a field: only that field's problem, and only once it has text.
  function onBlur(k) {
    if (k !== 'consent' && !String(form[k]).trim()) return;
    const err = validate(form)[k];
    setErrors((prev) => ({ ...prev, [k]: err }));
    if (err) setPopup({ title: t(`fb.${k === 'consent' ? 'submit' : k}`), message: t(err), focus: k });
  }

  async function submit(e) {
    e.preventDefault();
    if (sending) return;
    const errs = validate(form);
    setErrors(errs);
    const keys = Object.keys(errs);
    if (keys.length) {
      setPopup({ title: t('fb.submit'), items: keys.map((k) => t(errs[k])), focus: keys[0] });
      return;
    }
    setSending(true);
    try {
      const res = await fetch('/api/public/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, lang }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const items = body.fields ? Object.values(body.fields) : [body.error || t('fb.err.server')];
        setPopup({ title: t('fb.submit'), items });
        return;
      }
      setDone(body.reference_no);
    } catch {
      setPopup({ title: t('fb.submit'), message: t('fb.err.server') });
    } finally {
      setSending(false);
    }
  }

  function closePopup() {
    const k = popup?.focus;
    setPopup(null);
    if (k) setTimeout(() => refs[k]?.current?.focus(), 0);
  }

  const req = <span className="gigw-req" aria-hidden="true"> *</span>;
  const errId = (k) => (errors[k] ? `fb-${k}-err` : undefined);

  return (
    <PublicShell title={t('page.feedback')}>
      <article className="gigw-article">
        <nav aria-label="Breadcrumb" className="gigw-breadcrumb">
          <ol>
            <li><Link to="/">{t('page.home')}</Link></li>
            <li aria-current="page">{t('page.feedback')}</li>
          </ol>
        </nav>
        <h1>{t('page.feedback')}</h1>

        {done ? (
          <p className="gigw-form-done" role="status">{t('fb.done', { ref: done })}</p>
        ) : (
          <form className="gigw-form" onSubmit={submit} noValidate>
            <p className="gigw-lead">{t('fb.lead')}</p>

            <div className="gigw-field">
              <label htmlFor="fb-name">{t('fb.name')}{req}</label>
              <input id="fb-name" ref={refs.name} type="text" autoComplete="name" required maxLength={100}
                value={form.name} onChange={set('name')} onBlur={() => onBlur('name')}
                aria-invalid={!!errors.name} aria-describedby={errId('name')} />
              {errors.name && <p id="fb-name-err" className="gigw-field-err">{t(errors.name)}</p>}
            </div>

            <div className="gigw-field">
              <label htmlFor="fb-email">{t('fb.email')}{req}</label>
              <input id="fb-email" ref={refs.email} type="email" autoComplete="email" inputMode="email" required maxLength={200}
                value={form.email} onChange={set('email')} onBlur={() => onBlur('email')}
                aria-invalid={!!errors.email} aria-describedby={errId('email')} />
              {errors.email && <p id="fb-email-err" className="gigw-field-err">{t(errors.email)}</p>}
            </div>

            <fieldset className="gigw-field">
              <legend>{t('fb.category')}{req}</legend>
              {CATEGORIES.map((c) => (
                <label key={c} className="gigw-radio">
                  <input type="radio" name="fb-category" value={c} checked={form.category === c} onChange={set('category')} />
                  <span>{t(`fb.cat.${c}`)}</span>
                </label>
              ))}
            </fieldset>

            <div className="gigw-field">
              <label htmlFor="fb-page">{t('fb.page')}</label>
              <input id="fb-page" type="text" maxLength={300} value={form.page_url} onChange={set('page_url')} placeholder="/circulars" />
            </div>

            <div className="gigw-field">
              <label htmlFor="fb-message">{t('fb.message')}{req}</label>
              <textarea id="fb-message" ref={refs.message} rows={6} required maxLength={2000}
                value={form.message} onChange={set('message')} onBlur={() => onBlur('message')}
                aria-invalid={!!errors.message} aria-describedby={`fb-message-help${errors.message ? ' fb-message-err' : ''}`} />
              <p id="fb-message-help" className="gigw-field-help">{t('fb.messageHelp')} ({form.message.trim().length} / 2,000)</p>
              {errors.message && <p id="fb-message-err" className="gigw-field-err">{t(errors.message)}</p>}
            </div>

            <div className="gigw-field">
              <label className="gigw-check">
                <input ref={refs.consent} type="checkbox" checked={form.consent} onChange={set('consent')}
                  aria-invalid={!!errors.consent} aria-describedby={errId('consent')} />
                <span>{t('fb.consent')}{req}</span>
              </label>
              {errors.consent && <p id="fb-consent-err" className="gigw-field-err">{t(errors.consent)}</p>}
            </div>

            <div className="gigw-form-actions">
              <button type="submit" className="btn btn-primary" disabled={sending} aria-busy={sending}>
                {sending ? t('fb.sending') : t('fb.submit')}
              </button>
            </div>
          </form>
        )}
      </article>
      <AlertPopup
        open={!!popup}
        tone="error"
        title={popup?.title}
        message={popup?.message}
        items={popup?.items}
        onClose={closePopup}
      />
    </PublicShell>
  );
}
