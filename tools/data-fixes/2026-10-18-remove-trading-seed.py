#!/usr/bin/env python3
"""Remove the seeded (dummy) trading rows that fill the trading dashboards.

What goes: rows whose id contains SEED in the exchange / REC / ESCert / PXIL /
bilateral desks, the four seeded trading clients (TCL-SEED-*) and the four
bilateral-desk clients (TCL-EX-*), the three sample bank receipts (bt_1..bt_3),
and anything that only exists because of those (children found through the
foreign keys). Stakeholders (entities), contracts, invoices, hydro, thermal,
CERC, NRPC, CEA, REIA and market rates are never touched: if a delete would
reach one of those, the script stops and changes nothing.

Usage:  2026-10-18-remove-trading-seed.py DB [--apply]
Without --apply it reports what it would delete and rolls back.
"""
import sqlite3, sys

DB = sys.argv[1]
APPLY = '--apply' in sys.argv

SEED_TABLES = [
    'bids', 'bid_blocks', 'bid_events', 'exchange_contracts', 'exchange_biddings', 'exchange_bidding_latest',
    'iex_bid_book', 'exchange_applications', 'escert_orders', 'rec_orders', 'rec_bids', 'rec_ledger',
    'rec_transactions', 'noar_wallet_txns', 'bilateral_transactions', 'bilateral_biddings',
    'bilateral_applications', 'pxil_orders', 'trading_client_exchanges', 'trading_clients',
]
CLIENT_WHERE = "id LIKE 'TCL-SEED-%' OR id LIKE 'TCL-EX-%'"
# A cascade must stay inside these; anything else means a real record hangs off dummy data.
PROTECTED = {'entities', 'contracts', 'invoices', 'users', 'payments', 'documents', 'energy_data',
             'market_rates', 'hydro_stations', 'cerc_market_reports'}

con = sqlite3.connect(DB, timeout=30)
con.execute('PRAGMA foreign_keys = OFF')
tables = [r[0] for r in con.execute("select name from sqlite_master where type='table' and name not like 'sqlite_%'")]
children = {}  # parent -> [(child, child_col, parent_col)]
for t in tables:
    for fk in con.execute(f'pragma foreign_key_list("{t}")'):
        parent, child_col, parent_col = fk[2], fk[3], fk[4]
        children.setdefault(parent, []).append((t, child_col, parent_col or 'id'))

deleted = {}

def delete(table, where, params=()):
    """Delete matching rows after deleting everything that references them."""
    ids = [r[0] for r in con.execute(f'select rowid from "{table}" where {where}', params)]
    if not ids:
        return
    for child, ccol, pcol in children.get(table, []):
        if child == table:
            continue
        sub = f'"{ccol}" in (select "{pcol}" from "{table}" where {where})'
        if con.execute(f'select count(*) from "{child}" where {sub}', params).fetchone()[0]:
            if child in PROTECTED:
                raise SystemExit(f'STOP: {child} has rows hanging off {table}; not touching it.')
            delete(child, sub, params)
    n = con.execute(f'delete from "{table}" where {where}', params).rowcount
    deleted[table] = deleted.get(table, 0) + n

try:
    con.execute('BEGIN')
    # Children before parents, so the generic cascade has little left to do.
    for t in SEED_TABLES:
        if t == 'trading_clients':
            delete(t, CLIENT_WHERE)
        elif t == 'trading_client_exchanges':
            delete(t, "id LIKE '%SEED%' OR client_id IN (select id from trading_clients where id LIKE 'TCL-SEED-%' OR id LIKE 'TCL-EX-%')")
        else:
            delete(t, "id LIKE '%SEED%'")
    delete('bank_transactions', "id IN ('bt_1','bt_2','bt_3')")
    for t, n in sorted(deleted.items(), key=lambda x: -x[1]):
        print(f'{n:6d}  {t}')
    if APPLY:
        con.execute('COMMIT'); print('APPLIED')
    else:
        con.execute('ROLLBACK'); print('dry run, nothing changed')
except BaseException:
    con.execute('ROLLBACK'); raise
