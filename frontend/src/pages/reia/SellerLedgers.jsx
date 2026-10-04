import React, { useEffect, useState } from 'react';
import api from '../../api/client.js';
import { PageHeader, Card } from '../../components/ui.jsx';
import SellerLedgerView from '../../components/SellerLedgerView.jsx';

// Any seller's or buyer's account, as that company sees it — and where Finance
// files the quarterly TDS certificates for sellers and reads the ones buyers file.
export default function SellerLedgers() {
  const [side, setSide] = useState('SELLER');
  const [parties, setParties] = useState([]);
  const [entityId, setEntityId] = useState('');

  useEffect(() => {
    setEntityId('');
    (side === 'BUYER' ? api.ledger.buyers() : api.ledger.sellers()).then(setParties).catch(() => setParties([]));
  }, [side]);
  const word = side === 'BUYER' ? 'buyer' : 'seller';

  return (
    <div>
      <PageHeader title="Counterparty Ledgers & TDS Certificates" subtitle="A seller's or buyer's statement of account, ageing, payments and Form 16A certificates" />
      <div className="filters-bar">
        <select value={side} onChange={(e) => setSide(e.target.value)} aria-label="Sellers or buyers">
          <option value="SELLER">Sellers (payable)</option>
          <option value="BUYER">Buyers (receivable)</option>
        </select>
        <select value={entityId} onChange={(e) => setEntityId(e.target.value)} aria-label={word}>
          <option value="">Choose a {word}…</option>
          {parties.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>
      {entityId
        ? <SellerLedgerView key={entityId} entityId={entityId} partySide={side} />
        : <Card><div style={{ padding: 28, textAlign: 'center', color: 'var(--text-light)' }}>Choose a {word} to open its account.</div></Card>}
    </div>
  );
}
