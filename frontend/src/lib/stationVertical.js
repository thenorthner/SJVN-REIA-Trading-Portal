import { ROLE_GROUPS } from '../roles.js';

/**
 * The hydro and thermal desks run the same station-billing screens, each on its
 * own stations and with its own write roles and menu paths.
 */
export const writeRolesFor = (vertical) => (vertical === 'THERMAL' ? ROLE_GROUPS.THERMAL_WRITE : ROLE_GROUPS.HYDRO_THERMAL_WRITE);

const PATHS = {
  HYDRO: { billing: '/hydro-thermal/hydro-billing', ledger: '/hydro-thermal/hydro-ledger', notes: '/hydro-thermal/notes' },
  THERMAL: { billing: '/thermal/billing', ledger: '/thermal/ledger', notes: '/thermal/notes' },
};
export const pathFor = (vertical, key) => (PATHS[vertical] || PATHS.HYDRO)[key];
export const deskLabel = (vertical) => (vertical === 'THERMAL' ? 'Thermal' : 'Hydro');
