import { db } from '../src/db/index.js';
import { newId } from '../src/util.js';

function seedData() {
  const periodStr = '2026-10';

  const insertCap = db.prepare('INSERT OR IGNORE INTO cea_installed_capacity (id, month_year, state, sector, capacity_mw) VALUES (?, ?, ?, ?, ?)');
  const capData = [
    ['Himachal Pradesh', 'State', 1200.5],
    ['Punjab', 'State', 2500.0],
    ['Haryana', 'State', 3100.8],
    ['Delhi', 'State', 400.2],
    ['Uttarakhand', 'State', 900.5],
  ];

  db.transaction(() => {
    for (const [state, sector, cap] of capData) {
      insertCap.run(newId('CAP'), periodStr, state, sector, cap);
    }
  })();

  const insertSup = db.prepare('INSERT OR IGNORE INTO cea_power_supply (id, month_year, state, energy_req, energy_avail, peak_demand, peak_met) VALUES (?, ?, ?, ?, ?, ?, ?)');
  const supData = [
    ['Himachal Pradesh', 500, 490, 1000, 990],
    ['Punjab', 1500, 1450, 3000, 2900],
    ['Haryana', 1200, 1180, 2500, 2400],
    ['Delhi', 800, 800, 1500, 1500],
    ['Uttarakhand', 400, 400, 800, 800],
  ];

  db.transaction(() => {
    for (const [state, req, avail, demand, met] of supData) {
      insertSup.run(newId('SUP'), periodStr, state, req, avail, demand, met);
    }
  })();

  db.prepare('INSERT OR IGNORE INTO cea_scraped_reports (id, month, year, category, file_path) VALUES (?, ?, ?, ?, ?)')
    .run(newId('CSR'), 10, 2026, 'INSTALLED_CAPACITY', 'dummy');
    
  db.prepare('INSERT OR IGNORE INTO cea_scraped_reports (id, month, year, category, file_path) VALUES (?, ?, ?, ?, ?)')
    .run(newId('CSR'), 10, 2026, 'POWER_SUPPLY', 'dummy');

  console.log('Seeded direct DB rows for CEA.');
}

seedData();
