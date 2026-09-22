/**
 * Load backend/.env before any other local module reads process.env.
 * Skipped under Vitest so unit tests cannot pick up a developer's SMTP inbox,
 * and under SJVN_SKIP_DOTENV so the browser suite's server runs on the
 * environment it was handed — no live SMTP, IEX or PXIL credentials.
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

if (!process.env.VITEST && !process.env.SJVN_SKIP_DOTENV) {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  dotenv.config({ path: path.join(dir, '..', '.env') });
}
