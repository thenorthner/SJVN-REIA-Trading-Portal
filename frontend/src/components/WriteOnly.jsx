import { useCanWrite } from '../lib/deskAccess.js';

/**
 * Renders its children only for someone who may change data on this desk.
 * The SJVN / IT administrators and the auditor see desk screens read-only
 * (Target #2 Phase B), so the buttons the server would refuse them are not shown.
 */
export default function WriteOnly({ children }) {
  return useCanWrite() ? children : null;
}
