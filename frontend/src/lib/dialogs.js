// In-page replacements for window.alert / confirm / prompt.
//
// The browser's own dialogs block the page (and any assistive or automated
// browser driving it), ignore the theme and the type scale, and cannot be read
// by the GIGW focus handling. These open the platform's own popup instead,
// rendered by <DialogHost /> (mounted once in main.jsx), and return a promise:
//
//   await showAlert('Saved.');                       → undefined
//   if (!(await askConfirm('Cancel INV-1?'))) return; → true / false
//   const why = await askText('Why is it rejected?'); → string, or null if cancelled

let listener = null;
const queue = [];

function open(dialog) {
  return new Promise((resolve) => {
    queue.push({ ...dialog, resolve });
    listener?.([...queue]);
  });
}

/** For DialogHost: hears the queue whenever it changes. */
export function subscribe(fn) {
  listener = fn;
  fn([...queue]);
  return () => { if (listener === fn) listener = null; };
}

/** For DialogHost: settle the dialog in front and show the next one. */
export function settle(value) {
  const head = queue.shift();
  head?.resolve(value);
  listener?.([...queue]);
}

const FAILED = /\b(fail|failed|error|could not|couldn't|unable|cannot|invalid)\b/i;

export function showAlert(message, { title, tone } = {}) {
  const t = tone || (FAILED.test(String(message)) ? 'error' : 'info');
  return open({ kind: 'alert', message: String(message ?? ''), title: title || (t === 'error' ? 'That did not go through' : 'Please note'), tone: t });
}

// What cannot be taken back is asked with a red button.
const DESTRUCTIVE = /\b(delete|remove|permanently|cancel|withdraw|reverse|purge)\b/i;

export function askConfirm(message, { title = 'Please confirm', okLabel = 'Confirm', tone = 'warning', danger } = {}) {
  const text = String(message ?? '');
  return open({ kind: 'confirm', message: text, title, okLabel, tone, danger: danger ?? DESTRUCTIVE.test(text) });
}

export function askText(message, { title = 'A few words, please', defaultValue = '', okLabel = 'OK', required = true, multiline = false, inputType = 'text' } = {}) {
  return open({ kind: 'text', message: String(message ?? ''), title, defaultValue: String(defaultValue ?? ''), okLabel, required, multiline, inputType });
}
