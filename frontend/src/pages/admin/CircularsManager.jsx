import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Star, Eye, EyeOff, Pencil, Trash2, ExternalLink } from 'lucide-react';
import api from '../../api/client.js';
import { PageHeader, Card, Table, Badge, Modal, Field, AlertPopup } from '../../components/ui.jsx';

// Publishing desk for the public /circulars page and the homepage disclosure bar.
// Only what is meant for the public goes here — never a counterparty's bill,
// ledger, BG/LC copy or bank details; those stay behind sign-in.

const CATEGORIES = [
  { id: 'REIA_TENDER', label: 'REIA Tender (RfS)', tone: 'amber' },
  { id: 'CORRIGENDUM', label: 'Corrigendum & Addenda', tone: 'blue' },
  { id: 'CERC_FORM_IV', label: 'CERC Form-IV Monthly Return', tone: 'green' },
  { id: 'POWER_MARKET', label: 'Power Market Notice', tone: 'blue' },
  { id: 'REGULATORY_ORDER', label: 'Regulatory Order (CERC/MoP)', tone: 'red' },
  { id: 'GENERAL', label: 'General Circular', tone: 'gray' },
];
const categoryOf = (id) => CATEGORIES.find((c) => c.id === id) || { label: id, tone: 'gray' };

const ACCEPT = '.pdf,.xlsx,.xls,.docx,.doc,.zip';
const MAX_BYTES = 25 * 1024 * 1024;

function formatFileSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const today = () => new Date().toISOString().slice(0, 10);
const EMPTY = { circular_no: '', title_en: '', title_hi: '', category: 'REIA_TENDER', issue_date: today(), is_pinned: false, is_active: true, external_url: '' };

export default function CircularsManager({ embedded = false }) {
  const [circulars, setCirculars] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterCat, setFilterCat] = useState('ALL');
  const [notice, setNotice] = useState(null);
  const [popup, setPopup] = useState(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [file, setFile] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const fail = (err, fallback) => setPopup({ title: fallback, message: err?.response?.data?.error || err?.message || fallback });
  const flash = (text) => { setNotice(text); setTimeout(() => setNotice(null), 4000); };

  const load = () => {
    setLoading(true);
    api.circulars.list()
      .then((d) => setCirculars(d.circulars || []))
      .catch((err) => fail(err, 'Could not load circulars'))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const openCreate = () => { setEditing(null); setForm({ ...EMPTY, issue_date: today() }); setFile(null); setModalOpen(true); };
  const openEdit = (c) => {
    setEditing(c);
    setForm({
      circular_no: c.circular_no, title_en: c.title_en, title_hi: c.title_hi || '', category: c.category,
      issue_date: c.issue_date, is_pinned: c.is_pinned === 1, is_active: c.is_active === 1,
      // Only a web link is editable here; an uploaded file is replaced by choosing a new one.
      external_url: /^https?:\/\//i.test(c.file_url || '') ? c.file_url : '',
    });
    setFile(null);
    setModalOpen(true);
  };

  const pickFile = (e) => {
    const f = e.target.files?.[0] || null;
    if (f && f.size > MAX_BYTES) {
      setPopup({ title: 'File too large', message: `${f.name} is ${formatFileSize(f.size)}. The limit is 25 MB.` });
      e.target.value = '';
      return;
    }
    setFile(f);
  };

  const save = async (e) => {
    e.preventDefault();
    const missing = [
      !form.circular_no.trim() && 'Circular reference number',
      !form.title_en.trim() && 'Subject (English)',
      !form.issue_date && 'Issue date',
    ].filter(Boolean);
    if (form.external_url.trim() && !/^https?:\/\//i.test(form.external_url.trim())) missing.push('External link must start with http:// or https://');
    if (missing.length) {
      setPopup({ title: 'Please complete the form', items: missing });
      return;
    }

    const fd = new FormData();
    for (const k of ['circular_no', 'title_en', 'title_hi', 'category', 'issue_date']) fd.append(k, form[k].trim());
    fd.append('is_pinned', form.is_pinned ? '1' : '0');
    fd.append('is_active', form.is_active ? '1' : '0');
    if (form.external_url.trim()) fd.append('external_url', form.external_url.trim());
    if (file) fd.append('file', file);

    setSubmitting(true);
    try {
      if (editing) await api.circulars.update(editing.id, fd);
      else await api.circulars.create(fd);
      flash(editing ? 'Circular updated.' : (form.is_active ? 'Circular published.' : 'Circular saved as draft.'));
      setModalOpen(false);
      load();
    } catch (err) {
      fail(err, 'Could not save the circular');
    } finally {
      setSubmitting(false);
    }
  };

  const act = (fn, fallback) => async (c) => {
    try {
      const d = await fn(c.id);
      flash(d.message || 'Done.');
      load();
    } catch (err) {
      fail(err, fallback);
    }
  };
  const togglePin = act(api.circulars.togglePin, 'Could not change the homepage banner');
  const toggleActive = act(api.circulars.toggleActive, 'Could not change the status');
  const remove = async () => {
    const c = confirmDelete;
    setConfirmDelete(null);
    await act(api.circulars.remove, 'Could not delete the circular')(c);
  };

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return circulars.filter((c) => (filterCat === 'ALL' || c.category === filterCat)
      && (!q || [c.circular_no, c.title_en, c.title_hi].some((v) => v && v.toLowerCase().includes(q))));
  }, [circulars, search, filterCat]);

  const columns = [
    { key: 'issue_date', header: 'Date', render: (c) => <span style={{ whiteSpace: 'nowrap' }}>{c.issue_date}</span> },
    {
      key: 'circular_no', header: 'Reference',
      render: (c) => (
        <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>
          {c.circular_no}
          {c.is_pinned === 1 && <span style={{ marginLeft: 6 }}><Badge type="warning" label="Homepage" /></span>}
        </span>
      ),
    },
    { key: 'category', header: 'Category', render: (c) => <span className={`badge badge-${categoryOf(c.category).tone}`}>{categoryOf(c.category).label}</span> },
    {
      key: 'title_en', header: 'Subject',
      render: (c) => (
        <div>
          <div style={{ fontWeight: 600 }}>{c.title_en}</div>
          {c.title_hi && <div style={{ fontSize: 13.5, color: 'var(--slate-500)' }}>{c.title_hi}</div>}
        </div>
      ),
    },
    {
      key: 'file', header: 'Document',
      render: (c) => (c.file_url
        ? <a href={c.file_url} target="_blank" rel="noopener noreferrer">{c.file_name || 'Link'} {formatFileSize(c.file_size_bytes) && `(${formatFileSize(c.file_size_bytes)})`} <ExternalLink size={12} aria-hidden="true" /></a>
        : <span style={{ color: 'var(--slate-500)' }}>None</span>),
    },
    { key: 'is_active', header: 'Status', render: (c) => <span className={`badge badge-${c.is_active ? 'green' : 'gray'}`}>{c.is_active ? 'Published' : 'Draft'}</span> },
    {
      key: 'actions', header: 'Actions',
      render: (c) => (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'nowrap' }}>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => togglePin(c)} disabled={!c.is_active && !c.is_pinned}
            title={c.is_pinned ? 'Remove from homepage bar' : 'Show on homepage bar'} aria-label={c.is_pinned ? `Remove ${c.circular_no} from homepage bar` : `Show ${c.circular_no} on homepage bar`}>
            <Star size={14} fill={c.is_pinned ? 'currentColor' : 'none'} />
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => toggleActive(c)}
            title={c.is_active ? 'Unpublish (make draft)' : 'Publish'} aria-label={c.is_active ? `Unpublish ${c.circular_no}` : `Publish ${c.circular_no}`}>
            {c.is_active ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => openEdit(c)} title="Edit" aria-label={`Edit ${c.circular_no}`}>
            <Pencil size={14} />
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmDelete(c)} title="Delete" aria-label={`Delete ${c.circular_no}`}>
            <Trash2 size={14} />
          </button>
        </div>
      ),
    },
  ];

  const actions = (
    <>
      <Link to="/circulars" target="_blank" className="btn btn-outline">View public page</Link>
      <button type="button" className="btn btn-primary" onClick={openCreate}>+ Publish circular</button>
    </>
  );

  return (
    <div>
      {!embedded && (
        <PageHeader
          title="Public Circulars & Disclosures"
          subtitle="Tenders, corrigenda, CERC Form-IV returns and notices on the public /circulars page. The starred circular shows in the homepage disclosure bar."
          actions={actions}
        />
      )}

      {notice && <div className="alert alert-success" role="status" style={{ marginBottom: 12 }}>{notice}</div>}

      <Card title={embedded ? 'Public Circulars & Disclosures' : undefined} actions={embedded ? <div style={{ display: 'flex', gap: 8 }}>{actions}</div> : undefined}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          <input
            className="input"
            type="search"
            placeholder="Search reference or subject"
            aria-label="Search circulars"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ flex: '1 1 240px' }}
          />
          <select className="input" aria-label="Filter by category" value={filterCat} onChange={(e) => setFilterCat(e.target.value)} style={{ flex: '0 1 240px' }}>
            <option value="ALL">All categories</option>
            {CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </div>
        <Table columns={columns} rows={rows} loading={loading} emptyMessage="No circulars yet." caption="Public circulars" />
      </Card>

      <Modal open={modalOpen} onClose={() => !submitting && setModalOpen(false)} title={editing ? `Edit ${editing.circular_no}` : 'Publish circular'} width={640}>
        <form onSubmit={save} noValidate>
          <div className="form-grid">
            <Field label="Circular reference number" required>
              <input className="input" value={form.circular_no} onChange={set('circular_no')} placeholder="SJVN/REIA/2026/..." />
            </Field>
            <Field label="Category" required>
              <select className="input" value={form.category} onChange={set('category')}>
                {CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </Field>
            <Field label="Issue date" required>
              <input className="input" type="date" value={form.issue_date} onChange={set('issue_date')} />
            </Field>
          </div>
          <Field label="Subject (English)" required>
            <textarea className="input" rows={2} value={form.title_en} onChange={set('title_en')} />
          </Field>
          <Field label="विषय (Hindi)">
            <textarea className="input" rows={2} value={form.title_hi} onChange={set('title_hi')} lang="hi" />
          </Field>
          <Field label={editing?.file_name ? `Replace document (now: ${editing.file_name})` : 'Document (PDF, Excel, Word or ZIP, up to 25 MB)'}>
            <input className="input" type="file" accept={ACCEPT} onChange={pickFile} />
          </Field>
          <Field label="Or link to a document hosted elsewhere (e.g. CPPP / eProcure)">
            <input className="input" type="url" value={form.external_url} onChange={set('external_url')} placeholder="https://" disabled={!!file} />
          </Field>
          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', margin: '8px 0 16px' }}>
            <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
              <input type="checkbox" checked={form.is_active} onChange={set('is_active')} /> Published (visible to the public)
            </label>
            <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
              <input type="checkbox" checked={form.is_pinned} onChange={set('is_pinned')} /> Show on homepage disclosure bar
            </label>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button type="button" className="btn btn-outline" onClick={() => setModalOpen(false)} disabled={submitting}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={submitting}>{submitting ? 'Saving…' : editing ? 'Save changes' : 'Save'}</button>
          </div>
        </form>
      </Modal>

      <AlertPopup
        open={!!confirmDelete}
        tone="warning"
        title="Delete this circular?"
        message={confirmDelete ? `${confirmDelete.circular_no} and its document will be removed from the public page. To take it down but keep it, unpublish it instead.` : ''}
        actions={<button type="button" className="btn btn-danger" onClick={remove}>Delete</button>}
        okLabel="Cancel"
        onClose={() => setConfirmDelete(null)}
      />
      <AlertPopup open={!!popup} title={popup?.title} message={popup?.message} items={popup?.items} onClose={() => setPopup(null)} />
    </div>
  );
}
