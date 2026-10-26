import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { 
  FileText, Download, Search, Bell, ShieldCheck, ArrowLeft, Star
} from 'lucide-react';
import PublicShell from './PublicShell.jsx';
import { useGigw } from '../../gigw/GigwContext.jsx';

const CATEGORIES = [
  { id: 'ALL', labelEn: 'All Disclosures', labelHi: 'सभी प्रकटीकरण' },
  { id: 'REIA_TENDER', labelEn: 'REIA Tenders (RfS)', labelHi: 'आरईआईए निविदाएं' },
  { id: 'CORRIGENDUM', labelEn: 'Corrigendum & Addenda', labelHi: 'शुद्धिपत्र / संशोधन' },
  { id: 'CERC_FORM_IV', labelEn: 'CERC Form-IV Returns', labelHi: 'सीईआरसी फॉर्म-IV' },
  { id: 'POWER_MARKET', labelEn: 'Power Market Notices', labelHi: 'विद्युत बाजार सूचनाएं' },
  { id: 'REGULATORY_ORDER', labelEn: 'Regulatory Orders', labelHi: 'नियामक आदेश' },
  { id: 'GENERAL', labelEn: 'General Circulars', labelHi: 'सामान्य परिपत्र' },
];

const CATEGORY_BADGES = {
  REIA_TENDER: 'badge-amber',
  CORRIGENDUM: 'badge-blue',
  CERC_FORM_IV: 'badge-green',
  POWER_MARKET: 'badge-blue',
  REGULATORY_ORDER: 'badge-red',
  GENERAL: 'badge-gray',
};

// GIGW: a download link names the file's format and size.
function formatFileSize(bytes, url) {
  const ext = (url || '').split('?')[0].split('.').pop().toLowerCase();
  const kind = /^https?:/i.test(url || '') && !bytes ? 'Link' : ({ pdf: 'PDF', xls: 'XLS', xlsx: 'XLSX', doc: 'DOC', docx: 'DOCX', zip: 'ZIP' }[ext] || 'File');
  if (!bytes) return kind;
  if (bytes < 1024 * 1024) return `${kind}, ${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${kind}, ${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(isoStr) {
  if (!isoStr) return '—';
  try {
    const d = new Date(isoStr);
    return d.toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric'
    });
  } catch {
    return isoStr;
  }
}

export default function PublicCirculars() {
  const { lang } = useGigw();
  const [circulars, setCirculars] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeCategory, setActiveCategory] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    fetchCirculars();
  }, [activeCategory]);

  const fetchCirculars = () => {
    setLoading(true);
    const url = activeCategory === 'ALL' 
      ? '/api/circulars/public' 
      : `/api/circulars/public?category=${activeCategory}`;
    
    fetch(url)
      .then((res) => res.json())
      .then((data) => {
        setCirculars(data?.circulars || []);
        setLoading(false);
      })
      .catch((err) => {
        console.error('Failed to load circulars:', err);
        setLoading(false);
      });
  };

  const filteredCirculars = circulars.filter((c) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      (c.circular_no && c.circular_no.toLowerCase().includes(q)) ||
      (c.title_en && c.title_en.toLowerCase().includes(q)) ||
      (c.title_hi && c.title_hi.toLowerCase().includes(q))
    );
  });

  return (
    <PublicShell>
      <div className="gigw-article" style={{ maxWidth: '1240px', margin: '0 auto', padding: '28px 20px 60px' }}>
        {/* Breadcrumb Navigation */}
        <nav aria-label="Breadcrumb" className="gigw-breadcrumb" style={{ marginBottom: '16px' }}>
          <Link to="/" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
            <ArrowLeft size={14} />
            <span>{lang === 'hi' ? 'मुख्य पृष्ठ (Home)' : 'Home'}</span>
          </Link>
          <span style={{ margin: '0 8px', color: 'var(--slate-400)' }}>/</span>
          <span style={{ fontWeight: 700, color: 'var(--slate-800)' }}>
            {lang === 'hi' ? 'सार्वजनिक परिपत्र एवं नियामक प्रकटीकरण' : 'Public Circulars & Statutory Disclosures'}
          </span>
        </nav>

        {/* Page Card Header */}
        <div className="card" style={{ marginBottom: '24px', overflow: 'hidden' }}>
          <div className="card-body" style={{ padding: '28px 24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '16px' }}>
              <div>
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '4px 10px', background: 'var(--blue-bg)', color: 'var(--on-blue)', borderRadius: '999px', fontSize: '13.5px', fontWeight: 700, marginBottom: '12px' }}>
                  <Bell size={13} />
                  <span>{lang === 'hi' ? 'आधिकारिक नियामक प्रकटीकरण' : 'Official Statutory Disclosures'}</span>
                </div>
                <h1 style={{ fontSize: '26px', fontWeight: 800, margin: '0 0 8px', color: 'var(--slate-900)', letterSpacing: '-0.02em' }}>
                  {lang === 'hi' 
                    ? 'सार्वजनिक परिपत्र, निविदाएं एवं नियामक विवरणिका' 
                    : 'Public Circulars, Tenders & Statutory Disclosures'}
                </h1>
                <p style={{ margin: 0, fontSize: '15.5px', color: 'var(--slate-600)', maxWidth: '850px', lineHeight: 1.5 }}>
                  {lang === 'hi'
                    ? 'एसजेवीएन लिमिटेड (विद्युत मंत्रालय, भारत सरकार) द्वारा जारी अक्षय ऊर्जा (REIA) निविदाएं, शुद्धिपत्र, सीईआरसी फॉर्म-IV मासिक व्यापार विवरणिका एवं नियामक अधिसूचनाओं का आधिकारिक सार्वजनिक संग्रह।'
                    : 'Official statutory repository of Renewable Energy (REIA) tenders, corrigenda, CERC Form-IV power trading returns, and regulatory notifications published by SJVN Limited (Ministry of Power, Govt. of India).'}
                </p>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 16px', background: 'var(--slate-50)', border: '1px solid var(--slate-200)', borderRadius: '8px' }}>
                <ShieldCheck size={24} style={{ color: 'var(--green-strong)' }} />
                <div>
                  <div style={{ fontSize: '14px', fontWeight: 800, color: 'var(--slate-800)' }}>GIGW 3.0 &amp; CERC</div>
                  <div style={{ fontSize: '13px', color: 'var(--slate-500)' }}>Public Transparency Archive</div>
                </div>
              </div>
            </div>

            {/* Filter Controls Bar */}
            <div style={{ marginTop: '24px', paddingTop: '20px', borderTop: '1px solid var(--slate-200)' }}>
              <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center', marginBottom: '16px' }}>
                <div style={{ position: 'relative', flex: 1, minWidth: '280px' }}>
                  <Search size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--slate-400)' }} />
                  <input
                    type="text"
                    className="input"
                    style={{ width: '100%', paddingLeft: '36px', height: '40px', fontSize: '15px' }}
                    placeholder={lang === 'hi' ? 'परिपत्र संख्या, निविदा या विषय से खोजें...' : 'Search by Circular Ref No, Tender title, or keyword...'}
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                </div>
                {searchQuery && (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSearchQuery('')}>
                    {lang === 'hi' ? 'रीसेट (Clear)' : 'Clear'}
                  </button>
                )}
              </div>

              {/* Category Filter Buttons */}
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {CATEGORIES.map((cat) => {
                  const active = activeCategory === cat.id;
                  return (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => setActiveCategory(cat.id)}
                      className={`btn btn-sm ${active ? 'btn-primary' : 'btn-outline'}`}
                      style={{ fontSize: '14px', padding: '6px 14px' }}
                    >
                      {lang === 'hi' ? cat.labelHi : cat.labelEn}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {/* Circulars Table */}
        <div className="card">
          <div className="table-wrap">
            {loading ? (
              <div style={{ padding: '48px 20px', textAlign: 'center', color: 'var(--slate-500)' }}>
                <p>{lang === 'hi' ? 'परिपत्र लोड हो रहे हैं...' : 'Loading circulars & disclosures...'}</p>
              </div>
            ) : filteredCirculars.length === 0 ? (
              <div style={{ padding: '48px 20px', textAlign: 'center', color: 'var(--slate-500)' }}>
                <FileText size={40} style={{ margin: '0 auto 12px', color: 'var(--slate-300)' }} />
                <p style={{ fontSize: '16px', fontWeight: 700, margin: 0, color: 'var(--slate-700)' }}>
                  {lang === 'hi' ? 'कोई परिपत्र नहीं मिला' : 'No circulars found'}
                </p>
                <p style={{ fontSize: '14px', color: 'var(--slate-500)', marginTop: '4px' }}>
                  {lang === 'hi' ? 'कृपया अन्य श्रेणी चुनें या खोज शब्द बदलें।' : 'Try selecting a different category or clearing search query.'}
                </p>
              </div>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th style={{ width: '120px' }}>{lang === 'hi' ? 'दिनांक' : 'Date'}</th>
                    <th style={{ width: '220px' }}>{lang === 'hi' ? 'परिपत्र संदर्भ सं.' : 'Circular Ref No.'}</th>
                    <th style={{ width: '160px' }}>{lang === 'hi' ? 'श्रेणी' : 'Category'}</th>
                    <th>{lang === 'hi' ? 'विषय एवं विवरण' : 'Subject & Description'}</th>
                    <th style={{ width: '130px', textAlign: 'right' }}>{lang === 'hi' ? 'दस्तावेज़' : 'Document'}</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCirculars.map((c) => {
                    const title = (lang === 'hi' && c.title_hi) ? c.title_hi : c.title_en;
                    const badgeClass = CATEGORY_BADGES[c.category] || 'badge-gray';
                    const catObj = CATEGORIES.find(k => k.id === c.category);
                    const catLabel = lang === 'hi' ? (catObj?.labelHi || c.category) : (catObj?.labelEn || c.category);

                    return (
                      <tr key={c.id}>
                        <td style={{ whiteSpace: 'nowrap', fontSize: '14px', fontFamily: 'monospace', color: 'var(--slate-600)' }}>
                          {formatDate(c.issue_date)}
                        </td>
                        <td style={{ whiteSpace: 'nowrap', fontSize: '14px', fontFamily: 'monospace', fontWeight: 700 }}>
                          <span>{c.circular_no}</span>
                          {c.is_pinned === 1 && (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', marginLeft: '6px', padding: '2px 6px', background: 'var(--t-amber-100)', color: 'var(--on-amber)', borderRadius: '4px', fontSize: '13px', fontWeight: 700 }}>
                              <Star size={12} fill="currentColor" aria-hidden="true" /> Pinned
                            </span>
                          )}
                        </td>
                        <td style={{ whiteSpace: 'nowrap' }}>
                          <span className={`badge ${badgeClass}`}>
                            {catLabel}
                          </span>
                        </td>
                        <td>
                          <div style={{ fontWeight: 600, color: 'var(--slate-900)' }}>{title}</div>
                          {lang === 'hi' && c.title_en && (
                            <div style={{ fontSize: '13.5px', color: 'var(--slate-500)', marginTop: '2px' }}>{c.title_en}</div>
                          )}
                        </td>
                        <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                          {c.file_url ? (
                            <a
                              href={c.file_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="btn btn-outline btn-sm"
                              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '13.5px', textDecoration: 'none' }}
                              title={`Download ${c.file_name || 'Document'}`}
                            >
                              <Download size={13} />
                              <span>{formatFileSize(c.file_size_bytes, c.file_url)}</span>
                            </a>
                          ) : (
                            <span style={{ fontSize: '13.5px', color: 'var(--slate-400)', fontStyle: 'italic' }}>
                              {lang === 'hi' ? 'जल्द उपलब्ध' : 'Available Soon'}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Legal Disclaimer Footer */}
        <div style={{ marginTop: '28px', textAlign: 'center', fontSize: '14px', color: 'var(--slate-500)', lineHeight: 1.5 }}>
          <p>
            {lang === 'hi'
              ? 'आधिकारिक सूचना: सभी परिपत्र एवं निविदाएं केवल सार्वजनिक पारदर्शिता एवं सूचनात्मक प्रयोजन हेतु प्रकाशित की जाती हैं। प्राधिकृत हस्ताक्षरित प्रति आधिकारिक रिकॉर्ड में मान्य होगी।'
              : 'Statutory Notice: All circulars and disclosures are published for public transparency under CERC & GIGW 3.0 norms. Duly signed records maintained by SJVN Limited shall prevail in case of any discrepancy.'}
          </p>
        </div>
      </div>
    </PublicShell>
  );
}
