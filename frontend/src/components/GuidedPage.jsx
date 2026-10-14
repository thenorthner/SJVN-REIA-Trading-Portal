import React, { useEffect, useMemo, useState } from 'react';
import { LayoutGrid, BookOpen } from 'lucide-react';
import ModuleGuide from './ModuleGuide.jsx';
import { scrollPageTop } from './ui.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { counterpartyGuide } from '../content/guides/counterparty.js';

/**
 * A seller's or buyer's page with a "How it works" tab beside it.
 *
 * SJVN's own screens carry an FYI tab written for the desk. A company's user
 * meets the portal with no such help, on screens that move its money. This puts
 * a plain-language guide one click from every section — what the page is for,
 * what to do on it step by step, what the colours mean — without the user
 * leaving the page: the page stays mounted underneath, so a half-filled form is
 * still there on the way back.
 *
 * For a user who is not a seller or buyer (the shared Mail and Notification
 * Board routes) it renders the page alone.
 */
export default function GuidedPage({ guide, label, children }) {
  const { user } = useAuth() || {};
  const role = user?.role || '';
  const side = role.startsWith('SELLER') ? 'SELLER' : role.startsWith('BUYER') ? 'BUYER' : null;
  const content = useMemo(() => (side ? counterpartyGuide(guide, side) : null), [guide, side]);
  const [tab, setTab] = useState('page');

  // Leaving the guide by the sidebar and coming back should land on the page.
  useEffect(() => { setTab('page'); }, [guide]);

  if (!content) return children;
  const name = label || content.title;

  return (
    <div>
      <div className="gp-bar" role="tablist" aria-label={`${name} and its guide`}>
        <button type="button" role="tab" aria-selected={tab === 'page'} className={`gp-tab ${tab === 'page' ? 'active' : ''}`} onClick={() => setTab('page')}>
          <LayoutGrid size={15} aria-hidden /> {name}
        </button>
        <button type="button" role="tab" aria-selected={tab === 'guide'} className={`gp-tab ${tab === 'guide' ? 'active' : ''}`} onClick={() => { setTab('guide'); scrollPageTop(); }}>
          <BookOpen size={15} aria-hidden /> How it works
        </button>
      </div>
      {/* Hidden rather than unmounted, so what the user was doing is kept. */}
      <div hidden={tab !== 'page'}>{children}</div>
      {tab === 'guide' && (
        <div className="gp-guide">
          <ModuleGuide guide={content} />
          <div style={{ marginTop: 18 }}>
            <button type="button" className="btn btn-primary" onClick={() => { setTab('page'); scrollPageTop(); }}>← Back to {name}</button>
          </div>
        </div>
      )}
    </div>
  );
}
