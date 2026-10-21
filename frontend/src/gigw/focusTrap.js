import { useEffect } from 'react';

const FOCUSABLE = [
  'a[href]', 'area[href]', 'button:not([disabled])', 'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])', 'textarea:not([disabled])', 'iframe', '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]',
].join(',');

/**
 * Keep Tab and Shift+Tab inside an open dialog (WCAG 2.1.2 / 2.4.3), and hand
 * focus back to whatever had it when the dialog closes. Only the topmost open
 * dialog traps: a dialog opened over another takes the keyboard until it closes.
 */
const stack = [];

export function useFocusTrap(ref, active) {
  useEffect(() => {
    if (!active) return undefined;
    const node = ref.current;
    if (!node) return undefined;
    const returnTo = document.activeElement;
    stack.push(node);

    function onKey(e) {
      if (e.key !== 'Tab' || stack[stack.length - 1] !== node) return;
      const items = [...node.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null || el === document.activeElement);
      if (items.length === 0) { e.preventDefault(); node.focus(); return; }
      const first = items[0];
      const last = items[items.length - 1];
      const inside = node.contains(document.activeElement);
      if (e.shiftKey && (document.activeElement === first || !inside || document.activeElement === node)) {
        e.preventDefault(); last.focus();
      } else if (!e.shiftKey && (document.activeElement === last || !inside)) {
        e.preventDefault(); first.focus();
      }
    }
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      const i = stack.lastIndexOf(node);
      if (i >= 0) stack.splice(i, 1);
      if (returnTo && typeof returnTo.focus === 'function' && document.contains(returnTo)) returnTo.focus();
    };
  }, [ref, active]);
}
