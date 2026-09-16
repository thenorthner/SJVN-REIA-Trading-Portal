import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

// parse_rea.py's state-energy-account mode takes the first line naming a
// station — in Delhi SLDC's account that is Annexure-2's entitlement share — and
// reports the percentages as energy. On the June 2026 account it returned
// Nathpa Jhakri's 5.85% share to BRPL as "585.14 MWh"; Annexure-3 schedules
// 42.79 MU (42,786 MWh). The route must not pass that on as energy.
//
// The script needs python3 and pypdf, which a test machine need not have, so
// its output is stood in for here — exactly what it printed for that account.

const script = vi.hoisted(() => ({ stdout: '' }));
vi.mock('child_process', async (importOriginal) => {
  const real = await importOriginal();
  return { ...real, exec: (_cmd, cb) => cb(null, script.stdout, '') };
});

const { app } = await import('../src/server.js');
const { tokenFor, auth } = await import('./helpers/reia.js');

let reia;
beforeEach(() => { reia = tokenFor('REIA_USER'); });

const upload = () => request(app).post('/api/energy-data/parse-rea').set(auth(reia))
  .attach('file', Buffer.from('%PDF-1.4 stand-in'), 'Delhi SEA june.pdf');

describe('REA PDF upload given a state energy account', () => {
  it('refuses the percentages the SEA mode reads, and points at the table upload', async () => {
    script.stdout = JSON.stringify({
      success: true,
      mode: 'sldc',
      data: {
        detected_discoms: ['BRPL', 'BYPL', 'TPDDL', 'NDMC', 'MES'],
        station_allocations: [{
          station_id: 'NATHPA_JHAKRI',
          raw_numbers: [11.162216, 5.851416, 2.4054, 2.9054, 0],
          discom_allocations: { BRPL: { energy_lu: 5.851416, energy_mwh: 585.14 } },
        }],
      },
    });
    const r = await upload();
    expect(r.status).toBe(422);
    expect(r.body.error).toMatch(/state energy account, not a regional one/);
    expect(r.body.use).toBe('/api/energy-data/upload-account');
    expect(JSON.stringify(r.body)).not.toMatch(/585/);
  });

  it('still reads a regional energy account as before', async () => {
    script.stdout = JSON.stringify({
      success: true,
      mode: 'rea',
      data: [{ station_id: 'NATHPA_JHAKRI', station_name: 'Nathpa Jhakri HEP', availability_percent: 96.4, energy_lu: 816.16, energy_mwh: 81616 }],
    });
    const r = await upload();
    expect(r.status).toBe(200);
    expect(r.body[0]).toMatchObject({ station_name: 'Nathpa Jhakri HEP', energy_mwh: 81616 });
  });
});
