/**
 * Module reference content, keyed by module.
 *
 * To document another module: add a file here in the shape of dsm.js, register
 * it below, and drop an <FyiTab guideKey="..." /> beside that page's own tabs.
 * No layout work — ModuleGuide renders whatever the content object holds.
 */

import cerc from './cerc.js';
import compliance from './compliance.js';
import dsm from './dsm.js';
import energy from './energy.js';
import hydro from './hydro.js';
import hydroClaims from './hydroClaims.js';
import hydroLedger from './hydroLedger.js';
import hydroPtc from './hydroPtc.js';
import monitoring from './monitoring.js';
import reconciliation from './reconciliation.js';
import security from './security.js';
import verification from './verification.js';

export const GUIDES = {
  cerc, compliance, dsm, energy, hydro,
  'hydro-claims': hydroClaims, hydroClaims,
  'hydro-ledger': hydroLedger, hydroLedger,
  'hydro-ptc': hydroPtc, hydroPtc,
  monitoring, reconciliation, security, verification,
};

export function getGuide(key) {
  return GUIDES[key] || null;
}
