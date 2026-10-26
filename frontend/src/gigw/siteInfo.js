import { useEffect, useState } from 'react';

/**
 * The officers GIGW asks the portal to name — Web Information Manager, Grievance
 * Officer, Data Protection Officer, RTI officers — and the portal's "last
 * updated" date. They are system parameters (Masters → System Parameters,
 * category GIGW), so IT can change a name when an officer moves without a
 * release. Read without signing in: the policy pages are public.
 */
// Shown only until /api/public/site-info answers. No officer is named here:
// DBIM v3 A.5.5 asks for the CIO / WIM / PIO / Appellate details to be
// accurate, so they come only from the system parameters SJVN fills in.
const DEFAULT_SITE_INFO = {
  organisation: 'SJVN Limited',
  ministry: 'Ministry of Power, Government of India',
  last_updated: null,
  contacts: { wim: {}, grievance: {}, dpo: {}, rti_cpio: {}, rti_appellate: {} },
  session: { idle_timeout_minutes: 15 },
};

let cached = null;
let inflight = null;

function mergeDefaults(live) {
  if (!live) return DEFAULT_SITE_INFO;
  return { ...DEFAULT_SITE_INFO, ...live, contacts: { ...DEFAULT_SITE_INFO.contacts, ...(live.contacts || {}) } };
}

export function loadSiteInfo() {
  if (cached) return Promise.resolve(cached);
  if (!inflight) {
    inflight = fetch('/api/public/site-info')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        cached = mergeDefaults(d);
        return cached;
      })
      .catch(() => {
        cached = DEFAULT_SITE_INFO;
        return cached;
      })
      .finally(() => { inflight = null; });
  }
  return inflight;
}

export function useSiteInfo() {
  const [info, setInfo] = useState(cached || DEFAULT_SITE_INFO);
  useEffect(() => {
    let live = true;
    loadSiteInfo().then((d) => { if (live && d) setInfo(d); });
    return () => { live = false; };
  }, []);
  return info;
}
