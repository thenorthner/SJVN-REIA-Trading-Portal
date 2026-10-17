/**
 * Letters and certificates a desk files against its own record — a bank's
 * answer to an LC/BG claim (S2), an auditor's balance certificate (R5). Kept
 * under uploads/desk-docs/<kind>, served only through the owning route's
 * access check. SJVN_DESK_DOC_DIR moves them for a test run.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import multer from 'multer';
import { unreadablePdf, UNREADABLE_PDF_MESSAGE } from './fileChecks.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = () => process.env.SJVN_DESK_DOC_DIR || path.join(__dirname, '../../uploads/desk-docs');
export const LETTER_TYPES = ['.pdf', '.png', '.jpg', '.jpeg', '.doc', '.docx'];

export function deskDir(kind) {
  const dir = path.join(root(), kind);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function deskUpload(kind) {
  const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, deskDir(kind)),
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`),
  });
  return multer({ storage, limits: { fileSize: 8 * 1024 * 1024 } });
}

/** Why an uploaded letter cannot be filed, or null; the file is removed when refused. */
export function letterProblem(file) {
  if (!file) return 'Attach the letter (PDF, image or Word).';
  const ext = path.extname(file.originalname || '').toLowerCase();
  let problem = null;
  if (!LETTER_TYPES.includes(ext)) problem = `${file.originalname}: a letter is ${LETTER_TYPES.join(', ')}.`;
  else if (ext === '.pdf' && unreadablePdf(file.path)) problem = `${file.originalname} ${UNREADABLE_PDF_MESSAGE}`;
  if (problem) { try { fs.unlinkSync(file.path); } catch { /* gone */ } }
  return problem;
}

export function deskFilePath(kind, name) {
  const file = path.join(deskDir(kind), path.basename(String(name || '')));
  return fs.existsSync(file) ? file : null;
}

/** Drop an upload the route turned away for another reason. */
export function discardUpload(file) {
  if (file?.path) { try { fs.unlinkSync(file.path); } catch { /* gone */ } }
}
