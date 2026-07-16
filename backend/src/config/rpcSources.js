/**
 * RPC Source Configurations
 * 
 * Each Regional Power Committee has its own website structure.
 * This config file makes it easy to add new RPCs without touching core scraper logic.
 * 
 * To add a new RPC:
 * 1. Add a new key below with listing_url, url builders, dropdown info, and station mapping
 * 2. Create a parser script in ../scripts/ if the PDF format differs
 */

export const RPC_SOURCES = {
  NRPC: {
    name: 'Northern Regional Power Committee',
    listing_url: 'https://nrpc.gov.in/comm/rea.html',
    
    // URL builders — given MMYY code, construct PDF URL
    provisional_url: (mmyy) => `https://nrpc.gov.in/comm/2021-22/REA/REA${mmyy}_P.pdf`,
    final_url: (mmyy) => `https://nrpc.gov.in/comm/2021-22/REA/Rea${mmyy}_F.pdf`,
    supporting_url: (mmyy) => `https://nrpc.gov.in/comm/2021-22/REA/Supporting_files_at_cr${mmyy}.xlsx`,
    
    // How to parse the listing page dropdown
    dropdown_name: 'reanew',  // <select name="reanew">
    
    // Station name → internal entity mapping
    // key = internal ID, search_name = regex pattern in the PDF, entity_hint = display name
    station_mapping: {
      'NATHPA_JHAKRI': {
        search_paf: 'NATHPA\\s*JHAKRI\\s*HEP\\s+([\\d\\.]+)',
        search_energy: 'TOTAL\\s*NATHPA\\s*JHAKRI\\s*HEP\\s+([\\d\\.]+)',
        entity_hint: 'Nathpa Jhakri HEP',
      },
      'RAMPUR': {
        search_paf: 'RAMPUR\\s*HEP\\s+([\\d\\.]+)',
        search_energy: 'TOTAL\\s*RAMPUR\\s*HEP\\s+([\\d\\.]+)',
        entity_hint: 'Rampur HEP',
      },
    },
    
    // Python parser script name
    parser_script: 'parse_rea.py',
  },
  
  // Future RPCs — add configs here:
  // WRPC: { name: 'Western Regional Power Committee', listing_url: 'https://wrpc.gov.in/...', ... },
  // SRPC: { name: 'Southern Regional Power Committee', listing_url: 'https://srpc.gov.in/...', ... },
  // ERPC: { name: 'Eastern Regional Power Committee', listing_url: 'https://erpc.gov.in/...', ... },
  // NERPC: { name: 'North-Eastern Regional Power Committee', listing_url: 'https://nerpc.gov.in/...', ... },
};

/**
 * Convert MMYY dropdown value to YYYY-MM period format
 * e.g., '0626' → '2026-06', '1225' → '2025-12'
 */
export function mmyyToYYYYMM(mmyy) {
  const mm = mmyy.slice(0, 2);
  const yy = mmyy.slice(2, 4);
  return `20${yy}-${mm}`;
}

/**
 * Convert YYYY-MM to MMYY for URL construction
 * e.g., '2026-06' → '0626'
 */
export function yyyymmToMMYY(yyyymm) {
  const [yyyy, mm] = yyyymm.split('-');
  return `${mm}${yyyy.slice(2)}`;
}
