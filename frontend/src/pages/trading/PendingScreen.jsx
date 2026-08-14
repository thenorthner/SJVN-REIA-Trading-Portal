import React from 'react';
import { useLocation } from 'react-router-dom';
import { TRADING_MENU } from '../../config/tradingMenu.js';

/**
 * Stands in for a screen ISET has and we have not built yet.
 *
 * The alternative was an empty table or a blank card, and both read as a screen
 * that is broken rather than one that is not written — which costs somebody a bug
 * report and an afternoon. This says plainly which screen it is, where it sits in
 * the menu, and that nothing is wrong.
 *
 * It carries no controls and fetches nothing. A page that half-works invites
 * someone to rely on it.
 */
export default function PendingScreen() {
  const { pathname } = useLocation();

  const found = TRADING_MENU
    .flatMap((g) => g.items.map((i) => ({ ...i, group: g.group })))
    .find((i) => i.to === pathname);

  const title = found?.label ?? 'Screen not built yet';
  const group = found?.group;

  const siblings = group
    ? (TRADING_MENU.find((g) => g.group === group)?.items ?? []).filter((i) => i.to !== pathname)
    : [];
  const built = siblings.filter((i) => !i.pending);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>{title}</h1>
          <div className="page-subtitle">{group ? `${group} — not built yet` : 'Not built yet'}</div>
        </div>
      </div>

      <div className="card">
        <div className="card-body" style={{ padding: '28px 24px', maxWidth: 720 }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 8, marginBottom: 14,
            background: '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe',
            borderRadius: 999, padding: '4px 12px', fontSize: 12, fontWeight: 600,
          }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#3b82f6' }} />
            Planned
          </div>

          <p style={{ fontSize: 14, lineHeight: 1.65, color: '#374151', margin: '0 0 12px' }}>
            <strong>{title}</strong> exists in ISET and is on our list. Nothing is broken here —
            the screen simply has not been written yet.
          </p>
          <p style={{ fontSize: 13, lineHeight: 1.65, color: '#6b7280', margin: 0 }}>
            It is listed in the menu so the structure matches ISET while we build these one at a
            time. When it is ready this placeholder is replaced by the real screen and the route
            stays the same, so any link you save now will keep working.
          </p>

          {built.length > 0 && (
            <div style={{ marginTop: 22, paddingTop: 18, borderTop: '1px solid #e5e7eb' }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#6b7280', marginBottom: 8 }}>
                Working now under {group}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {built.map((s) => (
                  <a key={s.to} href={s.to} style={{
                    fontSize: 12, color: '#1d4ed8', textDecoration: 'none',
                    border: '1px solid #dbeafe', background: '#f8fafc',
                    borderRadius: 6, padding: '5px 10px',
                  }}>
                    {s.label}
                  </a>
                ))}
              </div>
            </div>
          )}

          <div style={{ marginTop: 18, fontSize: 11, color: '#9ca3af' }}>
            Route <code style={{ background: '#f3f4f6', padding: '1px 5px', borderRadius: 3 }}>{pathname}</code>
          </div>
        </div>
      </div>
    </div>
  );
}
