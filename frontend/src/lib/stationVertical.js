import { ROLE_GROUPS } from '../roles.js';

/**
 * The hydro and thermal desks run the same station-billing screens, each on its
 * own stations and with its own write roles and menu paths.
 */
export const writeRolesFor = (vertical) => (vertical === 'THERMAL' ? ROLE_GROUPS.THERMAL_WRITE : ROLE_GROUPS.HYDRO_THERMAL_WRITE);

const PATHS = {
  HYDRO: {
    billing: '/hydro-thermal/hydro-billing', ledger: '/hydro-thermal/hydro-ledger', notes: '/hydro-thermal/notes',
    finance: '/hydro-thermal/hydro-finance', disputes: '/hydro-thermal/disputes', reconciliation: '/hydro-thermal/reconciliation',
    advances: '/hydro-thermal/advances', approvals: '/hydro-thermal/approvals',
  },
  THERMAL: {
    billing: '/thermal/billing', ledger: '/thermal/ledger', notes: '/thermal/notes',
    finance: '/thermal/finance', disputes: '/thermal/disputes', reconciliation: '/thermal/reconciliation',
    advances: '/thermal/advances', approvals: '/thermal/approvals',
  },
};
export const pathFor = (vertical, key) => (PATHS[vertical] || PATHS.HYDRO)[key];
export const deskLabel = (vertical) => (vertical === 'THERMAL' ? 'Thermal' : 'Hydro');
