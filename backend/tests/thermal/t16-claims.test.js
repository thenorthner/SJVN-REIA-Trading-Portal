import { describe, it, expect } from 'vitest';
import db from '../../src/db/index.js';
import { makeContract } from '../helpers/reia.js';
import { addCharge } from '../../src/services/hydroClaims.js';

// Thermal QA run 16 (19-Oct-2026): a coal station's own additional charges, on real months.

describe('Additional charges', () => {
  const thermal = () => makeContract({ project_type: 'Thermal' });
  const add = (c, x) => addCharge({ contractId: c.id, chargeType: 'WATER_CHARGES', periodMonth: '2026-09', amount: 1000, ...x });

  it('take water charges on a thermal station, not hydro auxiliary consumption', () => {
    const c = thermal();
    expect(add(c, {}).charge_type).toBe('WATER_CHARGES');
    expect(() => add(c, { chargeType: 'AUX_CONSUMPTION' })).toThrow(/for this station/);
    const h = makeContract({ project_type: 'Hydro' });
    expect(() => add(h, {})).toThrow(/for this station/);
    expect(add(h, { chargeType: 'SECURITY_EXPENSES' }).charge_type).toBe('SECURITY_EXPENSES');
  });

  it('are for a real month that has begun', () => {
    const c = thermal();
    expect(() => add(c, { periodMonth: '2026-13' })).toThrow(/YYYY-MM/);
    expect(() => add(c, { periodMonth: '2099-03' })).toThrow(/has not begun/);
  });

  it('are filed under the station\'s desk in the audit lookup', () => {
    const c = thermal();
    const row = add(c, {});
    expect(db.prepare('SELECT contract_id FROM hydro_additional_charges WHERE id = ?').get(row.id).contract_id).toBe(c.id);
  });
});
