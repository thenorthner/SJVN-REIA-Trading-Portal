/**
 * One test invoice to SAP and back, from the command line.
 *
 *     npm run sap:test
 *
 * Proves the REIA → SAP path end to end without a posting in the database:
 * it builds the FI lines of a made-up sale invoice with the same code the
 * "Push to SAP" button uses (reiaSapLines.buildInvoiceLines), sends them as one
 * changeset, sends them again to see SAP refuse the duplicate, and reads them
 * back.
 *
 * Reads SAP_* from backend/.env. Writes only to SAP (the test lines, invoice
 * TEST/<run id>), never to the platform database. Point it at SAP DEV only.
 */
import '../loadEnv.js';
import { buildInvoiceLines, sapPostingConfig, istStamp } from '../services/reiaSapLines.js';
import { sapConfig, ping, openSession, postChangeset, readEntities } from '../services/sapOdata.js';

const say = (s) => console.log(`\n== ${s}`);

async function main() {
  const sap = sapConfig();
  if (!sap.ready) throw new Error(`Set ${sap.missing.join(', ')} in backend/.env`);
  const cfg = sapPostingConfig();
  if (cfg.missing.length) throw new Error(`Set ${cfg.missing.join(', ')} in backend/.env`);

  say(`1. Reaching ${new URL(sap.url).host}, client ${sap.client || '(default)'}`);
  const health = await ping();
  console.log(`   OK, service answers: ${health.entity_sets.join(', ')}`);

  const timestamp = istStamp();
  const belnr = `RE9${timestamp.slice(-7)}`;
  const today = timestamp.slice(0, 8).replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3');
  const line = {
    doc_no: `TEST/${timestamp.slice(2, 12)}`,
    total_amount: 3095000, energy_amount: 3000000, margin_amount: 70000,
    pass_through_amount: 25000, tax_amount: 0, adjustment_amount: 0,
  };
  const lines = buildInvoiceLines({
    line, posting: { period_month: today.slice(0, 7) }, bldat: today, belnr, timestamp, cfg,
  });

  say(`2. Push: invoice ${line.doc_no}, Belnr ${belnr}, ${lines.length} lines`);
  for (const l of lines) console.log(`   CPOS ${l.Cpos}  key ${l.Newbs}  GL ${l.Hkont}  ${l.Dmbtr}`);
  const session = await openSession();
  const first = await postChangeset(session, 'FiLineSet', lines);
  if (!first.ok) throw new Error(`SAP refused the push: ${first.error}`);
  console.log(`   OK, SAP created ${first.created} line(s)`);

  say('3. Same push again (SAP must refuse it)');
  const again = await postChangeset(session, 'FiLineSet', lines);
  console.log(again.ok ? '   !! SAP accepted a duplicate' : `   OK, refused: ${again.error}`);

  say('4. Pull: reading the lines back');
  const rows = await readEntities('FiLineSet', `Timestamp eq '${timestamp}' and Belnr eq '${belnr}'`);
  for (const r of rows) {
    console.log(`   CPOS ${r.Cpos}  key ${r.Newbs}  GL ${r.Hkont}  ${r.Dmbtr}  posted=${r.Flag}  FI doc=${r.ErpFiDocNum || '-'}`);
  }
  console.log(rows.length === lines.length ? '\nPUSH + PULL WORK.' : `\n!! Expected ${lines.length} lines back, got ${rows.length}`);
}

main().catch((err) => {
  console.error(`\nFAILED: ${err.message}`);
  process.exit(1);
});
