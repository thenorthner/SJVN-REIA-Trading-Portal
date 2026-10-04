import fs from 'fs';

/**
 * Whether an uploaded file that is a PDF can actually be opened as one.
 *
 * The header alone is not enough: a file that starts "%PDF" and holds nothing
 * else was accepted, stored, and then failed in the viewer with the browser's
 * own "Failed to load PDF document". A real PDF ends with a cross-reference
 * pointer and an end-of-file marker, so those are looked for in its tail.
 *
 * Decided on the file's own bytes, not its name: a file that is not a PDF at all
 * is none of this check's business and returns false.
 */
export function unreadablePdf(filePath) {
  let fd;
  try {
    const size = fs.statSync(filePath).size;
    fd = fs.openSync(filePath, 'r');
    const head = Buffer.alloc(4);
    fs.readSync(fd, head, 0, 4, 0);
    if (head.toString('latin1') !== '%PDF') return false;
    const n = Math.min(size, 2048);
    const tail = Buffer.alloc(n);
    fs.readSync(fd, tail, 0, n, size - n);
    const text = tail.toString('latin1');
    return !(text.includes('startxref') && text.includes('%%EOF'));
  } catch {
    return false; // a file that cannot be read at all fails elsewhere, with its own message
  } finally {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch { /* ignore */ } }
  }
}

export const UNREADABLE_PDF_MESSAGE = 'cannot be opened — it is empty, cut short or damaged. Export or scan it again and attach the new file.';

/** The first of several uploads that is a broken PDF, by its original name; null when all are sound. */
export function firstUnreadablePdf(files = []) {
  const bad = files.find((f) => unreadablePdf(f.path));
  return bad ? bad.originalname || 'The PDF' : null;
}
