import { describe, it, expect } from 'vitest';
import { parseReceipts } from './BankTransactionsList.jsx';

describe('parseReceipts', () => {
  it('reads comma and tab separated lines, skipping a header and blank lines', () => {
    const rows = parseReceipts('utr_no,van,amount,date,portfolio\nU1, VAN1, 100.5, 2026-10-18\n\nU2\tVAN2\t50\t\tN1PF');
    expect(rows).toEqual([
      { utr_no: 'U1', van: 'VAN1', amount: '100.5', transaction_date: '2026-10-18', portfolio_id: '' },
      { utr_no: 'U2', van: 'VAN2', amount: '50', transaction_date: '', portfolio_id: 'N1PF' },
    ]);
  });
  it('gives nothing for empty input', () => {
    expect(parseReceipts('  \n ')).toEqual([]);
  });
});
