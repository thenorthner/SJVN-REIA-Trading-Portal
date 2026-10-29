import React, { useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  Accessibility, ArrowRight, Check, CheckCircle2, Copy, FileText, Hash, Languages,
  Lightbulb, Mail, MessageSquareText, Send, ShieldCheck, UserRound, Wrench,
} from 'lucide-react';
import PublicShell from './PublicShell.jsx';
import { useGigw, translate } from '../../gigw/GigwContext.jsx';
import { AlertPopup } from '../../components/ui.jsx';
import { REIA_BETA } from '../../reiaBeta.js';
import './PublicFeedback.css';

/**
 * Public Feedback form (GIGW 3.0 quality guideline 11, DBIM v3 s.5.6). Laid
 * out the way DBIM Annexure B asks: instructions first, one field per line,
 * labels above their fields, required fields marked *, radio buttons for the
 * five categories with one already chosen, and a primary button that shows
 * progress and cannot be pressed twice. Problems are shown in a popup when a
 * field is left and again, all together, on submit. The server checks the
 * same rules (routes/publicInfo.js).
 */
const CATEGORIES = [
  { key: 'content', Icon: FileText },
  { key: 'accessibility', Icon: Accessibility },
  { key: 'technical', Icon: Wrench },
  { key: 'translation', Icon: Languages },
  { key: 'suggestion', Icon: Lightbulb },
];
// The part of the portal the feedback is about: a fixed set, so a dropdown.
// The beta names the REIA screens; the full portal names its public pages and desks.
const AREAS = REIA_BETA
  ? ['home', 'signin', 'dashboard', 'contracts', 'energy', 'billing', 'payments', 'disputes', 'reports', 'help', 'other']
  : ['home', 'signin', 'circulars', 'desks', 'help', 'other'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MIN = 20;
const MAX = 2000;

function validate(f) {
  const e = {};
  if (f.name.trim().length < 2 || f.name.trim().length > 100) e.name = 'fb.err.name';
  if (!EMAIL_RE.test(f.email.trim())) e.email = 'fb.err.email';
  if (f.message.trim().length < MIN || f.message.trim().length > MAX) e.message = 'fb.err.message';
  if (!f.consent) e.consent = 'fb.err.consent';
  return e;
}

export default function PublicFeedback() {
  const { t, lang } = useGigw();
  const location = useLocation();
  const from = location.state?.from || '';
  const blank = { name: '', email: '', category: 'content', area: from ? 'here' : '', message: '', consent: false };
  const [form, setForm] = useState(blank);
  const [errors, setErrors] = useState({});
  const [popup, setPopup] = useState(null);
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(null);
  const [copied, setCopied] = useState(false);
  const refs = { name: useRef(null), email: useRef(null), message: useRef(null), consent: useRef(null) };

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  // On leaving a field: only that field's problem, and only once it has text.
  function onBlur(k) {
    if (k !== 'consent' && !String(form[k]).trim()) return;
    const err = validate(form)[k];
    setErrors((prev) => ({ ...prev, [k]: err }));
    if (err) setPopup({ title: t(`fb.${k === 'consent' ? 'submit' : k}`), message: t(err), focus: k });
  }

  // What is stored as page_url: the page the visitor came from, or the English
  // name of the part they chose, so the admin queue reads the same in any language.
  function pageUrl() {
    if (form.area === 'here') return from;
    if (!form.area) return '';
    return translate('en', `fb.area.${form.area}`);
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
        body: JSON.stringify({
          name: form.name, email: form.email, category: form.category,
          page_url: pageUrl(), message: form.message, consent: form.consent, lang,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const items = body.fields ? Object.values(body.fields) : [body.error || t('fb.err.server')];
        setPopup({ title: t('fb.submit'), items });
        return;
      }
      setDone({ ref: body.reference_no, email: form.email.trim() });
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

  async function copyRef() {
    try {
      await navigator.clipboard.writeText(done.ref);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard blocked: the number stays on screen to copy by hand */ }
  }

  function startAgain() {
    setForm({ ...blank, name: form.name, email: form.email });
    setErrors({});
    setDone(null);
  }

  const req = <span className="gigw-req" aria-hidden="true"> *</span>;
  const errId = (k) => (errors[k] ? `fb-${k}-err` : undefined);
  const len = form.message.trim().length;

  return (
    <PublicShell title={t('page.feedback')}>
      <section className="fbx-hero" aria-labelledby="fbx-title">
        <div className="fbx-hero-inner">
          <nav aria-label="Breadcrumb" className="fbx-breadcrumb">
            <ol>
              <li><Link to="/">{t('page.home')}</Link></li>
              <li aria-current="page">{t('page.feedback')}</li>
            </ol>
          </nav>
          <p className="fbx-eyebrow">{t('fb.eyebrow')}</p>
          <h1 id="fbx-title">{t('fb.heroTitle')}</h1>
          <p className="fbx-hero-lead">{t('fb.heroLead')}</p>
          <ul className="fbx-chips">
            <li><Hash size={15} aria-hidden="true" />{t('fb.chip.ref')}</li>
            <li><MessageSquareText size={15} aria-hidden="true" />{t('fb.chip.read')}</li>
            <li><ShieldCheck size={15} aria-hidden="true" />{t('fb.chip.private')}</li>
          </ul>
        </div>
      </section>

      <div className="fbx-body">
        <div className="fbx-main">
          {done ? (
            <div className="fbx-card fbx-done" role="status">
              <span className="fbx-done-icon"><CheckCircle2 size={36} aria-hidden="true" /></span>
              <h2>{t('fb.doneTitle')}</h2>
              <p className="fbx-ref-label">{t('fb.refLabel')}</p>
              <div className="fbx-ref">
                <code>{done.ref}</code>
                <button type="button" className="fbx-copy" onClick={copyRef}>
                  {copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
                  {copied ? t('fb.copied') : t('fb.copy')}
                </button>
              </div>
              <p className="fbx-done-next">{t('fb.doneNext', { email: done.email })}</p>
              <div className="fbx-done-actions">
                <Link to="/" className="btn btn-primary fbx-btn">{t('fb.backHome')}</Link>
                <button type="button" className="btn btn-secondary fbx-btn" onClick={startAgain}>{t('fb.another')}</button>
              </div>
            </div>
          ) : (
            <form className="fbx-card fbx-form" onSubmit={submit} noValidate>
              <p className="fbx-required">{t('fb.required')} {t('fb.noSecrets')}</p>

              <section className="fbx-section" aria-labelledby="fbx-sec-you">
                <h2 id="fbx-sec-you" className="fbx-section-title"><span className="fbx-step">1</span><UserRound size={18} aria-hidden="true" />{t('fb.sec.you')}</h2>
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
              </section>

              <section className="fbx-section" aria-labelledby="fbx-sec-topic">
                <h2 id="fbx-sec-topic" className="fbx-section-title"><span className="fbx-step">2</span><FileText size={18} aria-hidden="true" />{t('fb.sec.topic')}</h2>
                <fieldset className="gigw-field">
                  <legend>{t('fb.category')}{req}</legend>
                  <div className="fbx-tiles">
                    {CATEGORIES.map(({ key, Icon }) => (
                      <label key={key} className={`fbx-tile${form.category === key ? ' is-on' : ''}`}>
                        <input type="radio" name="fb-category" value={key} checked={form.category === key} onChange={set('category')} />
                        <span className="fbx-tile-icon"><Icon size={20} aria-hidden="true" /></span>
                        <span className="fbx-tile-text">
                          <strong>{t(`fb.cat.${key}`)}</strong>
                          <small>{t(`fb.catHelp.${key}`)}</small>
                        </span>
                        <span className="fbx-tile-tick" aria-hidden="true"><Check size={14} /></span>
                      </label>
                    ))}
                  </div>
                </fieldset>
                <div className="gigw-field">
                  <label htmlFor="fb-area">{t('fb.area')}</label>
                  <select id="fb-area" className="fbx-select" value={form.area} onChange={set('area')}>
                    <option value="">{t('fb.area.none')}</option>
                    {from && <option value="here">{t('fb.area.here', { page: from })}</option>}
                    {AREAS.map((a) => <option key={a} value={a}>{t(`fb.area.${a}`)}</option>)}
                  </select>
                </div>
              </section>

              <section className="fbx-section" aria-labelledby="fbx-sec-message">
                <h2 id="fbx-sec-message" className="fbx-section-title"><span className="fbx-step">3</span><MessageSquareText size={18} aria-hidden="true" />{t('fb.sec.message')}</h2>
                <div className="gigw-field">
                  <label htmlFor="fb-message">{t('fb.message')}{req}</label>
                  <textarea id="fb-message" ref={refs.message} rows={7} required maxLength={MAX}
                    placeholder={t('fb.placeholder')}
                    value={form.message} onChange={set('message')} onBlur={() => onBlur('message')}
                    aria-invalid={!!errors.message} aria-describedby={`fb-message-help${errors.message ? ' fb-message-err' : ''}`} />
                  <p id="fb-message-help" className="gigw-field-help fbx-count">
                    <span className={len > 0 && len < MIN ? 'fbx-short' : ''}>{len < MIN ? t('fb.needMore', { n: MIN - len }) : t('fb.messageHelp')}</span>
                    <span>{len.toLocaleString('en-IN')} / 2,000</span>
                  </p>
                  {errors.message && <p id="fb-message-err" className="gigw-field-err">{t(errors.message)}</p>}
                </div>

                <div className="gigw-field">
                  <label className={`gigw-check fbx-consent${form.consent ? ' is-on' : ''}`}>
                    <input ref={refs.consent} type="checkbox" checked={form.consent} onChange={set('consent')}
                      aria-invalid={!!errors.consent} aria-describedby={errId('consent')} />
                    <span>{t('fb.consent')}{req}</span>
                  </label>
                  {errors.consent && <p id="fb-consent-err" className="gigw-field-err">{t(errors.consent)}</p>}
                </div>
              </section>

              <div className="fbx-actions">
                <button type="submit" className="btn btn-primary fbx-btn fbx-submit" disabled={sending} aria-busy={sending}>
                  <Send size={17} aria-hidden="true" />
                  {sending ? t('fb.sending') : t('fb.submit')}
                </button>
              </div>
            </form>
          )}
        </div>

        <aside className="fbx-aside" aria-label={t('fb.next.title')}>
          <div className="fbx-card fbx-side">
            <h2>{t('fb.next.title')}</h2>
            <ol className="fbx-steps">
              <li><span>1</span>{t('fb.next.1')}</li>
              <li><span>2</span>{t('fb.next.2')}</li>
              <li><span>3</span>{t('fb.next.3')}</li>
            </ol>
          </div>
          <div className="fbx-card fbx-side">
            <h2><ShieldCheck size={18} aria-hidden="true" />{t('fb.privacy.title')}</h2>
            <p>{t('fb.privacy.body')}</p>
          </div>
          <div className="fbx-card fbx-side">
            <h2><Mail size={18} aria-hidden="true" />{t('fb.talk.title')}</h2>
            <Link to="/contact-us" className="fbx-link">{t('fb.talk.link')}<ArrowRight size={16} aria-hidden="true" /></Link>
          </div>
        </aside>
      </div>

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
