import { useEffect, useState } from 'react';

/**
 * The officers GIGW asks the portal to name — Web Information Manager, Grievance
 * Officer, Data Protection Officer, RTI officers — and the portal's "last
 * updated" date. They are system parameters (Masters → System Parameters,
 * category GIGW), so IT can change a name when an officer moves without a
 * release. Read without signing in: the policy pages are public.
 */
const DEFAULT_SITE_INFO = {
  organisation: 'SJVN Limited',
  ministry: 'Ministry of Power, Government of India',
  office_address: 'Shakti Sadan, SJVN Corporate Office Complex, Shanan, P.O. Sanjauli, Shimla - 171006 (H.P.)',
  working_hours: 'Monday to Friday, 09:30 AM – 06:00 PM IST (Excluding Gazetted Holidays)',
  last_updated: new Date().toISOString().slice(0, 10),
  contacts: {
    wim: {
      name: 'Shri Rajesh Patre',
      designation: 'Chief General Manager (IT & C)',
      email: 'wim.it@sjvn.in',
      phone: '+91-177-2660003',
    },
    grievance: {
      name: 'Sh. Soumendra Das',
      designation: 'Company Secretary & Grievance Officer',
      email: 'investor.relations@sjvn.nic.in',
      phone: '+91-177-2660075',
    },
    dpo: {
      name: 'General Manager (Legal)',
      designation: 'Data Protection Officer (DPO)',
      email: 'dpo@sjvn.nic.in',
      phone: '+91-177-2660004',
    },
    rti_cpio: {
      name: 'Central Public Information Officer',
      designation: 'CPIO (Corporate Office)',
      email: 'cpio@sjvn.nic.in',
      phone: '+91-177-2660005',
    },
    rti_appellate: {
      name: 'Sh. Baljeet Singh',
      designation: 'Chief General Manager (HR) / First Appellate Authority (RTI)',
      email: 'hod.corporatehr@sjvn.nic.in',
      phone: '+91-177-2660270',
    },
  },
  session: { idle_timeout_minutes: 15 },
};

let cached = null;
let inflight = null;

function mergeDefaults(live) {
  if (!live) return DEFAULT_SITE_INFO;
  return {
    ...DEFAULT_SITE_INFO,
    ...live,
    contacts: {
      ...DEFAULT_SITE_INFO.contacts,
      ...(live.contacts || {}),
      wim: { ...DEFAULT_SITE_INFO.contacts.wim, ...(live.contacts?.wim || {}) },
      grievance: { ...DEFAULT_SITE_INFO.contacts.grievance, ...(live.contacts?.grievance || {}) },
      dpo: { ...DEFAULT_SITE_INFO.contacts.dpo, ...(live.contacts?.dpo || {}) },
    },
  };
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
