# Demo-data cleanup — 18-Oct-2026

Run on the main `backend/src/db/platform.db` (all dummy data, on the user's instruction). Script: `tools/data-fixes/2026-10-18-clean-demo-data.py`.

**Kept:** stakeholders Sunrise Solar (seller), Punjab State Power Corporation Ltd (buyer), SJVN Nathpa Jhakri HEP and Rampur HEP (SJVN's own stations); the four contracts between them (Sunrise PPA → PSPCL PSA, NJHPS, Rampur) and their invoices, payments, energy data, security and reconciliations; all demo logins except QA/datafix ones; all trading, hydro, CERC, NRPC and CEA data.

**Removed:** 18 stakeholders (no login, no use — Adani, GUVNL, HPPC, NDMC, NTPC RE, Jaypee, Teesta, GACL ×2, Punjab Corp duplicate, trading-ledger buyers, the two pending ones), 18 contracts (all `QA-*` runs, Adani-fed PSA/PPA set, a stray draft PSA) with their allocations, invoices, payments, credit notes, security instruments, reconciliations, documents; 4 QA/datafix users; all notifications; 3 hand-typed test mails; 2,520 orphan upload files.
Trading clients that pointed at removed stakeholders keep their rows, with the stakeholder link cleared.

**Mistake:** 4 test PDFs of kept records were deleted with the orphan files (the scan missed them); their 4 document records were removed too.

## Second pass — trading seed data (same day)

Script: `tools/data-fixes/2026-10-18-remove-trading-seed.py` (dry run by default, `--apply` to write). Backup taken first with sqlite `.backup`.

**Removed:** everything the exchange, REC, ESCert, PXIL and bilateral desk seeds created (ids containing `SEED`), the 4 `TCL-SEED-*` and 4 `TCL-EX-*` trading clients, the 3 sample bank receipts, and rows that hung off them: 47 bids (435 blocks, 185 events), 8 exchange contracts, 288 bilateral schedules, 1,152 bilateral approvals, 20 NOAR wallet entries, 16 NOAR status entries, 15 REC transactions, 14 bilateral transactions and smaller desk tables.

**Kept:** stakeholders, contracts, invoices, market rates (1,122), CERC / NRPC / CEA / hydro / REIA data, and 7 trading clients no seed script made.

**Then removed, on request:** `TCL-GACL` and `TCL-PLAIN` (duplicates of a real client name, made 16-Aug with no limits and nothing linked to them).

Re-running `npm run seed` would bring the dummy rows back.
