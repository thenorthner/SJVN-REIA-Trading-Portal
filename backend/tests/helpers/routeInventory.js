import { app } from '../../src/server.js';
import { routeInventory as inventoryOf } from '../../src/services/routeInventory.js';

/** Every API route of the running app with the roles its gates let through (see src/services/routeInventory.js). */
export function routeInventory() {
  return inventoryOf(app).map(({ method, path, roles }) => ({ method, path, roles }));
}
