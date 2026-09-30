/**
 * NRPC DSM scraper — not built yet.
 *
 * The intent is a weekly job that discovers NRPC's latest deviation account,
 * downloads the PDF, parses the scheduled/actual/rate figures per station and
 * lays down DRAFT deviation_settlements rows for the desk to review. None of
 * that exists. What stood here instead was a two-second setTimeout followed by
 * hardcoded MWh figures, returned as `success: true` with the message
 * "Successfully extracted data from latest NRPC PDF" and a sourceUrl that was
 * never fetched.
 *
 * That is worse than nothing here. The UI wrote those figures straight into the
 * add-week form, and three clicks later they became a SUPPLEMENTARY invoice
 * carrying a real rupee amount into the L1 approval queue, with nothing in the
 * audit trail recording that the numbers were invented. So this now refuses,
 * and the refusal is the honest answer until the real pipeline is written.
 *
 * Since then the work has been done a level up. NRPC does not publish anything
 * per plant: it publishes one weekly Deviation Settlement Account covering every
 * entity in the region, and SJVN's stations are sections inside it. So the
 * import is of the whole statement — see nrpcDsa.js for the parser and
 * nrpcDsaIngest.js for the store — and a per-plant fetch has no source to read.
 *
 * What that import will not do is convert anything. The statement's figures are
 * in Lakh Units and Rs Lakh, its sign convention is the opposite of this
 * module's, and its amounts are priced per 15-minute block against grid
 * frequency rather than by any rate times a volume. Mapping them into
 * deviation_settlements is a separate, still-open piece of work, and until it is
 * done nothing should be reaching an invoice from here.
 */

export const NRPC_SCRAPER_STATUS = {
  implemented: false,
  reason: 'NRPC_SCRAPER_NOT_IMPLEMENTED',
  message:
    'There is no automatic per-plant fetch from NRPC. The weekly Deviation '
    + 'Settlement Account is imported whole instead: POST the PDF to '
    + '/api/nrpc-dsa/upload, or pull an archive week with '
    + '/api/nrpc-dsa/archive/fetch. The figures then read back per station from '
    + '/api/nrpc-dsa/entities/:name/weeks, in the statement\'s own units and sign.',
};

/**
 * Always refuses. Kept as the seam the old per-plant caller speaks to, so the
 * route and the client have something to talk to while that caller is moved
 * over to the statement-level import.
 */
export async function scrapeLatestDSM(plantCode) {
  console.warn(
    `[NRPC Scraper] Refused per-plant fetch for ${plantCode || '(none)'} — import the weekly `
    + 'Deviation Settlement Account via /api/nrpc-dsa instead.',
  );
  return { success: false, ...NRPC_SCRAPER_STATUS };
}
