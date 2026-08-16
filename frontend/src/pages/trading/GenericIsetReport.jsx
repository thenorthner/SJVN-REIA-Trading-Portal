import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../../api/client.js';
import IsetReportTable from './IsetReportTable.jsx';

/**
 * Loads title/columns from /api/iset-reports/meta catalogs, then rows for `kind`.
 * Used for remaining Reports / CERC / CEA / ERP / MMR screens.
 */
export default function GenericIsetReport({ kind: kindProp }) {
  const params = useParams();
  const kind = kindProp || params.kind;
  const [meta, setMeta] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setError('');
    setMeta(null);
    api.isetReports.meta()
      .then((m) => {
        const cat = m?.catalogs?.[kind];
        if (!cat) {
          setError(`Unknown report: ${kind}`);
          return;
        }
        setMeta(cat);
      })
      .catch(() => setError('Failed to load report metadata'));
  }, [kind]);

  if (error) {
    return <div style={{ padding: 20, color: '#b91c1c' }}>{error}</div>;
  }
  if (!meta) {
    return <div className="page-loading" style={{ padding: 20 }}>Loading…</div>;
  }

  return (
    <IsetReportTable
      kind={kind}
      title={meta.title}
      columns={meta.columns}
      showSr={meta.showSr !== false}
    />
  );
}
