import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsDir = path.join(__dirname, '../uploads');
const dbPath = path.join(__dirname, '../src/db/platform.db');
const db = new Database(dbPath);

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const logos = {
  'ndmc-logo.svg': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">
    <rect width="100" height="100" rx="20" fill="#1e3a8a"/>
    <circle cx="50" cy="46" r="32" fill="#ffffff" opacity="0.1"/>
    <circle cx="50" cy="46" r="26" fill="none" stroke="#fbbf24" stroke-width="2.5"/>
    <path d="M50 24 L53 36 L65 36 L55 43 L59 55 L50 48 L41 55 L45 43 L35 36 L47 36 Z" fill="#fbbf24"/>
    <text x="50" y="86" text-anchor="middle" fill="#ffffff" font-family="system-ui, sans-serif" font-weight="800" font-size="13" letter-spacing="1.5">NDMC</text>
  </svg>`,

  'hppc-logo.svg': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">
    <rect width="100" height="100" rx="20" fill="#047857"/>
    <circle cx="50" cy="46" r="28" fill="#10b981" opacity="0.2"/>
    <path d="M53 22 L36 48 L48 48 L45 70 L64 44 L52 44 Z" fill="#fef08a" stroke="#ca8a04" stroke-width="1.5" stroke-linejoin="round"/>
    <text x="50" y="86" text-anchor="middle" fill="#ffffff" font-family="system-ui, sans-serif" font-weight="800" font-size="12" letter-spacing="1.5">HPPC</text>
  </svg>`,

  'pspcl-logo.svg': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">
    <rect width="100" height="100" rx="20" fill="#1d4ed8"/>
    <circle cx="50" cy="46" r="28" fill="#3b82f6" opacity="0.2"/>
    <path d="M50 22 L62 62 L50 56 L38 62 Z" fill="#60a5fa"/>
    <path d="M54 26 L42 46 L50 46 L46 64 L58 44 L50 44 Z" fill="#ffffff"/>
    <text x="50" y="86" text-anchor="middle" fill="#ffffff" font-family="system-ui, sans-serif" font-weight="800" font-size="12" letter-spacing="1">PSPCL</text>
  </svg>`,

  'guvnl-logo.svg': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">
    <rect width="100" height="100" rx="20" fill="#c2410c"/>
    <circle cx="50" cy="46" r="28" fill="#ea580c" opacity="0.25"/>
    <circle cx="50" cy="46" r="16" fill="#fef08a"/>
    <path d="M50 20 L50 28 M50 64 L50 72 M24 46 L32 46 M68 46 L76 46 M32 28 L38 34 M62 58 L68 64 M32 64 L38 58 M62 34 L68 28" stroke="#fef08a" stroke-width="3" stroke-linecap="round"/>
    <text x="50" y="86" text-anchor="middle" fill="#ffffff" font-family="system-ui, sans-serif" font-weight="800" font-size="11" letter-spacing="1">GUVNL</text>
  </svg>`,

  'ntpc-logo.svg': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">
    <rect width="100" height="100" rx="20" fill="#0284c7"/>
    <circle cx="50" cy="46" r="26" fill="#ffffff"/>
    <path d="M50 28 C42 34 38 42 44 54 C47 50 49 46 50 42 C51 46 53 50 56 54 C62 42 58 34 50 28 Z" fill="#16a34a"/>
    <text x="50" y="86" text-anchor="middle" fill="#ffffff" font-family="system-ui, sans-serif" font-weight="800" font-size="12" letter-spacing="1.5">NTPC</text>
  </svg>`,

  'adani-logo.svg': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">
    <rect width="100" height="100" rx="20" fill="#0f172a"/>
    <circle cx="50" cy="44" r="24" fill="none" stroke="#22c55e" stroke-width="4"/>
    <path d="M40 50 C40 38 50 30 60 40 C52 40 48 44 48 50 Z" fill="#38bdf8"/>
    <circle cx="50" cy="44" r="8" fill="#eab308"/>
    <text x="50" y="86" text-anchor="middle" fill="#ffffff" font-family="system-ui, sans-serif" font-weight="800" font-size="12" letter-spacing="1.5">ADANI</text>
  </svg>`,

  'teesta-logo.svg': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">
    <rect width="100" height="100" rx="20" fill="#0891b2"/>
    <circle cx="50" cy="46" r="26" fill="#ffffff" opacity="0.15"/>
    <path d="M30 48 Q40 36 50 48 T70 48 Q60 60 50 48 T30 48 Z" fill="#a5f3fc"/>
    <path d="M30 56 Q40 44 50 56 T70 56" fill="none" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round"/>
    <text x="50" y="86" text-anchor="middle" fill="#ffffff" font-family="system-ui, sans-serif" font-weight="800" font-size="11" letter-spacing="1">TEESTA</text>
  </svg>`,

  'jaypee-logo.svg': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">
    <rect width="100" height="100" rx="20" fill="#4338ca"/>
    <circle cx="50" cy="46" r="26" fill="#ffffff" opacity="0.12"/>
    <polygon points="50,24 68,46 50,68 32,46" fill="#818cf8"/>
    <polygon points="50,30 62,46 50,62 38,46" fill="#ffffff"/>
    <text x="50" y="86" text-anchor="middle" fill="#ffffff" font-family="system-ui, sans-serif" font-weight="800" font-size="11" letter-spacing="1.5">JAYPEE</text>
  </svg>`,

  'bikaner-solar-logo.svg': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">
    <rect width="100" height="100" rx="20" fill="#b45309"/>
    <circle cx="50" cy="44" r="20" fill="#fde047"/>
    <circle cx="50" cy="44" r="26" fill="none" stroke="#fbbf24" stroke-width="2" stroke-dasharray="4,3"/>
    <path d="M36 54 L64 54 L58 66 L42 66 Z" fill="#0284c7" stroke="#ffffff" stroke-width="1"/>
    <text x="50" y="86" text-anchor="middle" fill="#ffffff" font-family="system-ui, sans-serif" font-weight="800" font-size="11" letter-spacing="1">BIKANER</text>
  </svg>`,

  'upcl-logo.svg': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">
    <rect width="100" height="100" rx="20" fill="#15803d"/>
    <polygon points="50,22 68,54 32,54" fill="#86efac"/>
    <polygon points="50,22 40,54 32,54" fill="#4ade80"/>
    <polygon points="50,34 62,58 38,58" fill="#ffffff"/>
    <path d="M52 38 L44 50 L49 50 L46 62 L56 48 L50 48 Z" fill="#eab308"/>
    <text x="50" y="86" text-anchor="middle" fill="#ffffff" font-family="system-ui, sans-serif" font-weight="800" font-size="12" letter-spacing="1.5">UPCL</text>
  </svg>`,
};

for (const [filename, content] of Object.entries(logos)) {
  fs.writeFileSync(path.join(uploadsDir, filename), content.trim());
}
console.log(`Generated ${Object.keys(logos).length} SVG logos in backend/uploads/`);

// Map entities to logos
const entityLogos = [
  { id: 'ENT-EX-NDMC', logo_url: '/uploads/ndmc-logo.svg' },
  { id: 'ENT-EX-HPPC', logo_url: '/uploads/hppc-logo.svg' },
  { id: 'ENT-EX-PSPCL', logo_url: '/uploads/pspcl-logo.svg' },
  { id: 'ENT-EX-GUVNL', logo_url: '/uploads/guvnl-logo.svg' },
  { id: 'ENT-EX-NTPCRE', logo_url: '/uploads/ntpc-logo.svg' },
  { id: 'ENT-EX-ADANI', logo_url: '/uploads/adani-logo.svg' },
  { id: 'ENT-EX-TEESTA', logo_url: '/uploads/teesta-logo.svg' },
  { id: 'ENT-EX-JAYPEE', logo_url: '/uploads/jaypee-logo.svg' },
  { id: 'SEL-NJHPS', logo_url: '/uploads/sjvn-logo.png' },
  { id: 'SEL-RHPS', logo_url: '/uploads/sjvn-logo.png' },
  { id: 'BUY-e4c7ccec', logo_url: '/uploads/pspcl-logo.svg' },
  { id: 'ENT-PENDING-SOLAR', logo_url: '/uploads/bikaner-solar-logo.svg' },
  { id: 'ENT-PENDING-DISCOM', logo_url: '/uploads/upcl-logo.svg' },
];

const updateStmt = db.prepare('UPDATE entities SET logo_url = ? WHERE id = ?');
for (const item of entityLogos) {
  updateStmt.run(item.logo_url, item.id);
}

console.log('Successfully updated logo_url for all key entities!');
