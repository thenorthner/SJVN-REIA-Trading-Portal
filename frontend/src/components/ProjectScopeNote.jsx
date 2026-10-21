import React, { useEffect, useState } from 'react';
import api from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';

/**
 * Tells a REIA officer on SELECTED projects which ones they are, so a project
 * missing from a list reads as "not mine" rather than "lost" (Target #2 Phase C).
 */
export default function ProjectScopeNote() {
  const { user } = useAuth();
  const [mine, setMine] = useState(null);
  const tier = ['REIA_MAKER', 'REIA_CHECKER', 'REIA_APPROVER'].includes(user?.role);
  useEffect(() => {
    if (!tier) return;
    api.projectScope.me().then(setMine).catch(() => setMine(null));
  }, [tier, user?.id]);
  if (!tier || mine?.scope !== 'SELECTED') return null;
  return (
    <div className="inline-note" role="status" style={{ marginBottom: 12 }}>
      You work on {mine.projects.length} assigned project{mine.projects.length === 1 ? '' : 's'}: {mine.projects.map((p) => p.contract_no).join(', ') || 'none yet'}. Lists show these only; ask the SJVN Administrator to add another.
    </div>
  );
}
