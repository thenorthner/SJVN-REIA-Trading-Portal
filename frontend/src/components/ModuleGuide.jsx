import React, { useEffect, useMemo, useRef, useState } from 'react';

/**
 * Renders a module's reference page from a content object.
 *
 * Content is data, not markup, so writing a guide for another module means
 * adding a file under src/content/guides — no layout decisions, and every
 * module's page reads the same way. See content/guides/dsm.js for the shape.
 *
 * Blocks a section can hold: 'p', 'steps', 'table', 'note', 'terms', 'faq'.
 */

const MAX_PROSE = 74; // ch — long enough for a table row, short enough to read

function Prose({ children }) {
  return (
    <p style={{
      margin: '0 0 12px', fontSize: 15.5, lineHeight: 1.7,
      color: 'var(--text)', maxWidth: `${MAX_PROSE}ch`,
    }}>
      {children}
    </p>
  );
}

const TONES = {
  info: { fg: 'var(--blue)', bg: 'var(--blue-bg)' },
  good: { fg: 'var(--green)', bg: 'var(--green-bg)' },
  warn: { fg: 'var(--amber)', bg: 'var(--amber-bg)' },
  stop: { fg: 'var(--red)', bg: 'var(--red-bg)' },
};

function Note({ tone = 'info', title, children }) {
  const t = TONES[tone] || TONES.info;
  return (
    <div style={{
      margin: '16px 0', padding: '12px 16px',
      background: t.bg, borderLeft: `3px solid ${t.fg}`,
      borderRadius: '0 var(--radius) var(--radius) 0',
      maxWidth: `${MAX_PROSE}ch`,
    }}>
      {title && (
        <div style={{ fontSize: 14.5, fontWeight: 700, color: t.fg, marginBottom: 4 }}>{title}</div>
      )}
      <div style={{ fontSize: 15, lineHeight: 1.65, color: 'var(--text)' }}>{children}</div>
    </div>
  );
}

function Steps({ items }) {
  return (
    <ol style={{ listStyle: 'none', margin: '4px 0 8px', padding: 0, maxWidth: `${MAX_PROSE}ch` }}>
      {items.map((s, i) => (
        <li key={s.title} style={{ display: 'flex', gap: 14, paddingBottom: i === items.length - 1 ? 0 : 18 }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
            <span style={{
              width: 26, height: 26, borderRadius: '50%', display: 'grid', placeItems: 'center',
              background: 'var(--primary-light)', color: 'var(--primary)',
              fontSize: 15, fontWeight: 700,
            }}>{i + 1}</span>
            {i < items.length - 1 && (
              <span style={{ flex: 1, width: 1, background: 'var(--border)', marginTop: 4 }} />
            )}
          </div>
          <div style={{ paddingTop: 3 }}>
            <div style={{ fontSize: 15.5, fontWeight: 650, color: 'var(--text)' }}>{s.title}</div>
            <div style={{ fontSize: 15, lineHeight: 1.65, color: 'var(--text-muted)', marginTop: 3 }}>
              {s.detail}
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}

function GuideTable({ columns, rows, caption }) {
  return (
    <div style={{ margin: '4px 0 16px', overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 15 }}>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c} style={{
                textAlign: 'left', padding: '8px 12px 8px 0',
                borderBottom: '1px solid var(--border)',
                fontSize: 14.5, fontWeight: 700, letterSpacing: '.04em',
                textTransform: 'none', color: 'var(--text-muted)', whiteSpace: 'nowrap',
              }}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((cell, j) => (
                <td key={j} style={{
                  padding: '9px 12px 9px 0',
                  borderBottom: '1px solid var(--border)',
                  color: j === 0 ? 'var(--text)' : 'var(--text-muted)',
                  fontWeight: j === 0 ? 600 : 400,
                  lineHeight: 1.55,
                  verticalAlign: 'top',
                }}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {caption && (
        <div style={{ fontSize: 15, color: 'var(--text-muted)', marginTop: 8, fontStyle: 'italic' }}>
          {caption}
        </div>
      )}
    </div>
  );
}

function Terms({ items }) {
  return (
    <dl style={{ margin: '4px 0 8px', maxWidth: `${MAX_PROSE}ch` }}>
      {items.map((t) => (
        <div key={t.term} style={{ padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
          <dt style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>
            {t.term}
            {t.also && <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}> · {t.also}</span>}
          </dt>
          <dd style={{ margin: '3px 0 0', fontSize: 15, lineHeight: 1.65, color: 'var(--text-muted)' }}>
            {t.def}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** <details> rather than state: it is keyboard-reachable and findable by Ctrl+F. */
function Faq({ items }) {
  return (
    <div style={{ maxWidth: `${MAX_PROSE}ch` }}>
      {items.map((f) => (
        <details key={f.q} style={{ borderBottom: '1px solid var(--border)' }}>
          <summary style={{
            cursor: 'pointer', padding: '13px 0', fontSize: 15.5, fontWeight: 600,
            color: 'var(--text)', listStyle: 'none', display: 'flex',
            alignItems: 'flex-start', gap: 10,
          }}>
            <span aria-hidden style={{ color: 'var(--primary)', fontWeight: 700, lineHeight: 1.5 }}>›</span>
            <span>{f.q}</span>
          </summary>
          <div style={{
            fontSize: 15, lineHeight: 1.7, color: 'var(--text-muted)',
            padding: '0 0 15px 22px',
          }}>{f.a}</div>
        </details>
      ))}
    </div>
  );
}

function Block({ block }) {
  switch (block.type) {
    case 'p': return <Prose>{block.text}</Prose>;
    case 'steps': return <Steps items={block.items} />;
    case 'table': return <GuideTable {...block} />;
    case 'note': return <Note tone={block.tone} title={block.title}>{block.text}</Note>;
    case 'terms': return <Terms items={block.items} />;
    case 'faq': return <Faq items={block.items} />;
    default: return null;
  }
}

/** Highlights whichever section is currently nearest the top of the viewport. */
function useActiveSection(ids) {
  const [active, setActive] = useState(ids[0]);
  useEffect(() => {
    const onScroll = () => {
      let current = ids[0];
      for (const id of ids) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top <= 120) current = id;
      }
      setActive(current);
    };
    onScroll();
    // Captured on the document: the page scrolls inside .main-col, and scroll
    // events from an element do not bubble up to the window.
    document.addEventListener('scroll', onScroll, { passive: true, capture: true });
    return () => document.removeEventListener('scroll', onScroll, { capture: true });
  }, [ids]);
  return active;
}

export default function ModuleGuide({ guide, sections }) {
  const effectiveGuide = useMemo(() => {
    const raw = guide?.sections || sections || [];
    const normalized = raw.map((s, idx) => {
      const id = s.id || `sec-${idx}-${String(s.title || s.heading || idx).toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
      const heading = s.heading || s.title || `Section ${idx + 1}`;
      let blocks = s.blocks;
      if (!blocks || !Array.isArray(blocks)) {
        blocks = s.body ? [{ type: 'p', text: s.body }] : [];
      }
      return {
        ...s,
        id,
        heading,
        blurb: s.blurb || null,
        blocks,
      };
    });
    return {
      eyebrow: guide?.eyebrow || 'Reference Guide',
      title: guide?.title || 'Operational Reference Guide',
      summary: guide?.summary || 'Key principles, operational guidance, and regulations.',
      facts: guide?.facts || [],
      quickRef: guide?.quickRef || null,
      footnote: guide?.footnote || null,
      sections: normalized,
    };
  }, [guide, sections]);

  const ids = useMemo(() => effectiveGuide.sections.map((s) => s.id), [effectiveGuide]);
  const active = useActiveSection(ids);
  const rootRef = useRef(null);
  const [narrow, setNarrow] = useState(false);

  // The rail folds away on a narrow pane. Measured off the element rather than
  // the window, because this sits inside a layout with a fixed sidebar.
  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(([e]) => setNarrow(e.contentRect.width < 860));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={rootRef}>
      {/* Summary strip — what this is, before any detail. */}
      <div style={{
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 'var(--radius)', boxShadow: 'var(--shadow)',
        padding: '22px 24px', marginBottom: 18,
      }}>
        <div style={{
          fontSize: 14.5, fontWeight: 700, letterSpacing: '.07em',
          textTransform: 'none', color: 'var(--primary)', marginBottom: 8,
        }}>
          {effectiveGuide.eyebrow || 'Reference'}
        </div>
        <h2 style={{ margin: '0 0 8px', fontSize: 21, fontWeight: 700, color: 'var(--text)' }}>
          {effectiveGuide.title}
        </h2>
        <p style={{
          margin: 0, fontSize: 15.5, lineHeight: 1.7,
          color: 'var(--text-muted)', maxWidth: `${MAX_PROSE}ch`,
        }}>
          {effectiveGuide.summary}
        </p>

        {effectiveGuide.facts?.length > 0 && (
          <div style={{
            display: 'grid', gap: 12, marginTop: 20,
            gridTemplateColumns: `repeat(auto-fit, minmax(${narrow ? 180 : 210}px, 1fr))`,
          }}>
            {effectiveGuide.facts.map((f) => (
              <div key={f.label} style={{
                padding: '12px 14px', background: 'var(--bg)',
                borderRadius: 8, border: '1px solid var(--border)',
              }}>
                <div style={{
                  fontSize: 14, fontWeight: 700, letterSpacing: '.05em',
                  textTransform: 'none', color: 'var(--text-muted)',
                }}>{f.label}</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', margin: '4px 0 2px' }}>
                  {f.value}
                </div>
                {f.hint && (
                  <div style={{ fontSize: 15, lineHeight: 1.5, color: 'var(--text-muted)' }}>{f.hint}</div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{
        display: 'grid', gap: 22,
        gridTemplateColumns: narrow ? '1fr' : 'minmax(0, 1fr) 236px',
        alignItems: 'start',
      }}>
        <div style={{
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius)', boxShadow: 'var(--shadow)',
          padding: '4px 26px 26px',
        }}>
          {effectiveGuide.sections.map((s, i) => (
            <section
              key={s.id}
              id={s.id}
              style={{ paddingTop: 26, scrollMarginTop: 90 }}
            >
              <div style={{
                display: 'flex', alignItems: 'baseline', gap: 10,
                paddingBottom: 6, marginBottom: 12, borderBottom: '1px solid var(--border)',
              }}>
                <span style={{
                  fontSize: 14.5, fontWeight: 700, color: 'var(--text-muted)',
                  fontVariantNumeric: 'tabular-nums',
                }}>
                  {String(i + 1).padStart(2, '0')}
                </span>
                <h3 style={{ margin: 0, fontSize: 16.5, fontWeight: 700, color: 'var(--text)' }}>
                  {s.heading}
                </h3>
              </div>
              {s.blurb && (
                <p style={{
                  margin: '0 0 14px', fontSize: 15, lineHeight: 1.65,
                  color: 'var(--text-muted)', maxWidth: `${MAX_PROSE}ch`,
                }}>{s.blurb}</p>
              )}
              {s.blocks.map((b, j) => <Block key={j} block={b} />)}
            </section>
          ))}
        </div>

        {!narrow && (
          <nav aria-label="On this page" style={{ position: 'sticky', top: 16 }}>
            <div style={{
              background: 'var(--surface)', border: '1px solid var(--border)',
              borderRadius: 'var(--radius)', boxShadow: 'var(--shadow)', padding: '14px 8px 14px 14px',
            }}>
              <div style={{
                fontSize: 14, fontWeight: 700, letterSpacing: '.06em',
                textTransform: 'none', color: 'var(--text-muted)', marginBottom: 10,
              }}>On this page</div>
              {effectiveGuide.sections.map((s) => (
                <a
                  key={s.id}
                  href={`#${s.id}`}
                  style={{
                    display: 'block', padding: '6px 10px', marginBottom: 2,
                    fontSize: 15, lineHeight: 1.45, textDecoration: 'none',
                    borderLeft: `2px solid ${active === s.id ? 'var(--primary)' : 'transparent'}`,
                    color: active === s.id ? 'var(--primary)' : 'var(--text-muted)',
                    fontWeight: active === s.id ? 650 : 400,
                    background: active === s.id ? 'var(--primary-light)' : 'transparent',
                    borderRadius: '0 6px 6px 0',
                  }}
                >{s.heading}</a>
              ))}
            </div>

            {effectiveGuide.quickRef && (
              <div style={{
                background: 'var(--surface)', border: '1px solid var(--border)',
                borderRadius: 'var(--radius)', boxShadow: 'var(--shadow)',
                padding: 14, marginTop: 14,
              }}>
                <div style={{
                  fontSize: 14, fontWeight: 700, letterSpacing: '.06em',
                  textTransform: 'none', color: 'var(--text-muted)', marginBottom: 10,
                }}>{effectiveGuide.quickRef.title}</div>
                {effectiveGuide.quickRef.items.map((q) => (
                  <div key={q.k} style={{ marginBottom: 11 }}>
                    <div style={{ fontSize: 15, fontWeight: 650, color: 'var(--text)' }}>{q.k}</div>
                    <div style={{ fontSize: 15, lineHeight: 1.5, color: 'var(--text-muted)' }}>{q.v}</div>
                  </div>
                ))}
              </div>
            )}
          </nav>
        )}
      </div>

      {effectiveGuide.footnote && (
        <p style={{
          fontSize: 15, color: 'var(--text-muted)', marginTop: 16,
          maxWidth: `${MAX_PROSE}ch`, lineHeight: 1.6,
        }}>{effectiveGuide.footnote}</p>
      )}
    </div>
  );
}
