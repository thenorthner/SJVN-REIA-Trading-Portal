import { useEffect, useState } from 'react';
import { api } from '../../api/client.js';

/**
 * Title, column layout and rows for one ERP upload format.
 *
 * The Vendor and Vendor Payable screens used to carry their rows inline — real
 * counterparty names and a real SAP vendor number transcribed from the live ISET
 * portal, in tracked source. Both now read the same register as every other
 * pending report, so a fresh clone renders the layout with no rows.
 */
export default function useErpFormat(kind) {
  const [state, setState] = useState({ columns: [], title: '', rows: [], loading: true, error: '' });

  useEffect(() => {
    let live = true;
    Promise.all([api.isetReports.meta(), api.isetReports.list(kind)])
      .then(([meta, rows]) => {
        if (!live) return;
        const cat = meta?.catalogs?.[kind];
        if (!cat) {
          setState({ columns: [], title: '', rows: [], loading: false, error: `Unknown report: ${kind}` });
          return;
        }
        setState({
          columns: cat.columns || [],
          title: cat.title || '',
          rows: Array.isArray(rows) ? rows : [],
          loading: false,
          error: '',
        });
      })
      .catch(() => {
        if (live) setState((s) => ({ ...s, loading: false, error: 'Could not load this format.' }));
      });
    return () => { live = false; };
  }, [kind]);

  return state;
}
