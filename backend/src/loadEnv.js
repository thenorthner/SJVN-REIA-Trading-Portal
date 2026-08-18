/**
 * Load backend/.env before any other local module reads process.env.
 * Skipped under Vitest so unit tests cannot pick up a developer's SMTP inbox.
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

if (!process.env.VITEST) {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  dotenv.config({ path: path.join(dir, '..', '.env') });
}
