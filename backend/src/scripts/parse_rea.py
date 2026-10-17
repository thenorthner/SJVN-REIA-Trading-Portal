#!/usr/bin/env python3
"""
SJVN Energy Platform — REA & SLDC PDF Parser

Supports two parsing modes (auto-detected):
  1. NRPC REA (Regional Energy Account) — Station-level PAF + Energy
  2. State SLDC SEA (State Energy Account) — DISCOM-level allocations (BRPL, BYPL, TPDDL, etc.)

and one that is only ever asked for by name:
  3. delhi_sea — Delhi SLDC's State Energy Account, Annexure-2 table C: each
     Delhi licensee's weighted average entitlement in the ISGS stations.

Usage:
  python parse_rea.py <pdf_path> [--mode rea|sldc|delhi_sea]

Output: JSON to stdout
"""
import sys
import re
import json

try:
    import pypdf
except ImportError:
    try:
        import PyPDF2 as pypdf
    except ImportError:
        print(json.dumps({'success': False, 'error': 'Neither pypdf nor PyPDF2 installed. Run: pip install pypdf'}))
        sys.exit(1)

# ──── Known SJVN Stations ────
STATIONS = {
    'NATHPA_JHAKRI': {
        'name': 'Nathpa Jhakri HEP',
        'search_paf': r'NATHPA\s*JHAKRI\s*HEP\s+([\d\.]+)',
        'search_energy': r'TOTAL\s*NATHPA\s*JHAKRI\s*HEP\s+([\d\.]+)',
        'd2_block': r'NATHPA\s*JHAKRI\s*HEP\s*:-([\s\S]*?)TOTAL\s*NATHPA',
        'c1_row': r'NATHPA\s*JHAKRI\s*HEP',
    },
    'RAMPUR': {
        'name': 'Rampur HEP',
        'search_paf': r'RAMPUR\s*HEP\s+([\d\.]+)',
        'search_energy': r'TOTAL\s*RAMPUR\s*HEP\s+([\d\.]+)',
        'd2_block': r'RAMPUR\s*HEP\s*:-([\s\S]*?)TOTAL\s*RAMPUR',
        'c1_row': r'RAMPUR\s*HEP',
    },
    'LUHRI': {
        'name': 'Luhri HEP',
        'search_paf': r'LUHRI\s*HEP\s+([\d\.]+)',
        'search_energy': r'TOTAL\s*LUHRI\s*HEP\s+([\d\.]+)',
        'd2_block': r'LUHRI\s*HEP\s*:-([\s\S]*?)TOTAL\s*LUHRI',
        'c1_row': r'LUHRI\s*HEP',
    }
}

# ──── Known DISCOMs in Delhi (from SEA Annexure-3 style tables) ────
DELHI_DISCOMS = ['BRPL', 'BYPL', 'TPDDL', 'NDMC', 'MES', 'DMRC']
# Other states can be added here
NR_DISCOMS = ['UPPCL', 'PSPCL', 'HPSEBL', 'JKPDD', 'JVVNL', 'AVVNL', 'JDVVNL', 'UHBVNL', 'DHBVN']


def extract_text(pdf_path):
    """Extract all text from a PDF."""
    reader = pypdf.PdfReader(pdf_path)
    text = ""
    for page in reader.pages:
        extracted = page.extract_text()
        if extracted:
            text += extracted + "\n"
    return text


def detect_mode(text):
    """Auto-detect whether this is a REA or SLDC SEA document."""
    text_upper = text.upper()
    
    # SLDC SEA indicators
    sldc_keywords = ['STATE ENERGY ACCOUNT', 'ANNEXURE', 'SCHEDULED TO THE LICENSEES',
                     'BRPL', 'BYPL', 'TPDDL', 'DISCOM']
    sldc_score = sum(1 for kw in sldc_keywords if kw in text_upper)
    
    # NRPC REA indicators
    rea_keywords = ['REGIONAL ENERGY ACCOUNT', 'NRPC', 'PLANT AVAILABILITY',
                    'NATHPA JHAKRI', 'RAMPUR']
    rea_score = sum(1 for kw in rea_keywords if kw in text_upper)
    
    if sldc_score > rea_score:
        return 'sldc'
    return 'rea'


MONTHS = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY',
          'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER']


PERIOD_RE = re.compile(r'for\s+the\s+Month\s+of\s+([A-Za-z]+)\s*,?\s*(\d{4})', re.I)


def _mentions(text):
    """(YYYY-MM, month word as printed) for each "for the Month of X, YYYY"."""
    return [('%s-%02d' % (y, MONTHS.index(m.upper()) + 1), m)
            for m, y in PERIOD_RE.findall(text) if m.upper() in MONTHS]


def account_periods(text):
    """Every month the REA names ("REA for the Month of DECEMBER, 2025"), as YYYY-MM, most often named first."""
    from collections import Counter
    return [p for p, _ in Counter(p for p, _ in _mentions(text)).most_common()]


def account_period(text):
    """The month the REA itself says it is for, as YYYY-MM (the most often named: its page headers)."""
    periods = account_periods(text)
    return periods[0] if periods else None


def account_period_conflict(text):
    """
    Months the account's own titles name when none of them names its header month.

    Every page carries an upper-case running header ("for the Month of AUGUST,
    2026"); the cover letter and some table titles are typed in mixed case
    ("for the month of August 2026"). The "September 2026" REA imported on
    16 Oct 2026 was August's account with the headers relabelled: 478 said
    SEPTEMBER, the four titles still said August, and none said September.

    A genuine account can carry one stray month — NRPC's cover letters have
    named the previous month (May 2026's says April) and Nov 2025 has one title
    saying October — but its titles always name its own month as well. So the
    test is not "one month only" but "the titles agree with the header at least
    once". Returns the other months, or None when there is no conflict.
    """
    header = account_period(text)
    titled = {p for p, word in _mentions(text) if not word.isupper()}
    if not header or not titled or header in titled:
        return None
    return sorted(titled)


def parse_c1_entitlements(text):
    """
    Table C1 — each utility's weighted average entitlement in the month, in %.

    The bill apportions on these figures, and they move from month to month (a
    state's share is surrendered, re-allocated, restored), so they are read off
    the account the energy came from rather than carried from an earlier sheet.

    The table runs over several pages, each with its own header: one utility per
    line after the word "Station". A station's row is matched to the header of
    the page it sits on, and a row whose figures do not line up with that header
    one for one is left out — a wrong column is worse than no column.
    """
    start = text.find('Table - C1')
    end = text.find('Table - C2')
    if start < 0:
        return {}
    section = text[start:end if end > start else len(text)]
    out = {}
    header = []
    reading_header = False
    row_re = re.compile(r'^(.*?)\s+((?:\d+\.\d+\s*)+)$')
    for raw in section.split('\n'):
        line = raw.strip()
        if line == 'Station':
            header = []
            reading_header = True
            continue
        if not line:
            continue
        m = row_re.match(line)
        if m:
            reading_header = False
            for key, config in STATIONS.items():
                if key in out:
                    continue
                if not re.fullmatch(config['c1_row'], m.group(1).strip()):
                    continue
                figures = [float(x) for x in m.group(2).split()]
                if len(figures) != len(header):
                    continue
                out[key] = {name: pct for name, pct in zip(header, figures) if pct > 0}
            continue
        if reading_header:
            header.append(re.sub(r'\s+', ' ', line).upper())
    return out


def parse_d2_schedule(block_text):
    """Each beneficiary's scheduled energy in a station's Table D2 block, in LU."""
    out = {}
    for name, lu in re.findall(r'^\s*([A-Z][A-Z &().-]*?)\s+(\d+\.\d+)(?:\s+\d+\.\d+)?\s*$', block_text, re.M):
        out[re.sub(r'\s+', ' ', name).strip()] = float(lu)
    return out


def parse_rea(text):
    """Parse NRPC REA — extract station-level energy and PAF data."""
    results = []
    entitlements = parse_c1_entitlements(text)
    
    for key, config in STATIONS.items():
        paf_match = re.search(config['search_paf'], text)
        energy_match = re.search(config['search_energy'], text)
        
        paf = float(paf_match.group(1)) if paf_match else None
        energy_lu = float(energy_match.group(1)) if energy_match else None
        
        # 1 Lakh Units (LU) = 1,00,000 kWh = 100 MWh
        energy_mwh = round(energy_lu * 100, 2) if energy_lu is not None else None

        # Table D2 lists each beneficiary's scheduled energy; the home state's
        # free power is the second figure on its row ("GOHP NJHEP 877.390350
        # 877.390350"). The bill's E2 is this figure, not FEHS% of E1.
        free_lu = None
        scheduled = {}
        block = re.search(config.get('d2_block', r'(?!)'), text)
        if block:
            scheduled = parse_d2_schedule(block.group(1))
            rows = re.findall(r'^\s*[A-Z][A-Z &().-]*?\s+([\d.]+)\s+([\d.]+)\s*$', block.group(1), re.M)
            if rows:
                free_lu = round(sum(float(b) for _, b in rows), 6)
        free_mwh = round(free_lu * 100, 4) if free_lu is not None else None
        
        if paf is not None or energy_mwh is not None:
            results.append({
                'station_id': key,
                'station_name': config['name'],
                'availability_percent': paf,
                'energy_lu': energy_lu,
                'energy_mwh': energy_mwh,
                'free_energy_lu': free_lu,
                'free_energy_mwh': free_mwh,
                # Table C1 (% by utility) and Table D2 (LU by beneficiary): what
                # the month's allocation sheet is derived from and checked against.
                'entitlement_pct': entitlements.get(key),
                'scheduled_lu': scheduled or None,
            })
    
    return results


def parse_sldc_sea(text):
    """
    Parse SLDC State Energy Account — extract DISCOM-level energy allocations.
    
    The Delhi SEA typically has tables like:
      "Details of Energy Scheduled to the Licensees from ISGS"
    with columns for each DISCOM (BRPL, BYPL, TPDDL, etc.)
    
    Strategy:
      1. Look for station names (NATHPA JHAKRI, RAMPUR, etc.) in the text
      2. For each station line, extract numbers that follow it
      3. Map numbers to DISCOM columns based on the header row
    """
    results = []
    all_discoms = DELHI_DISCOMS + NR_DISCOMS
    
    # Try to find DISCOM header row to determine column order
    detected_discoms = []
    for discom in all_discoms:
        if discom in text.upper():
            detected_discoms.append(discom)
    
    # Extract station-wise DISCOM allocations
    # Pattern: Look for station name followed by numbers
    station_patterns = [
        ('NATHPA_JHAKRI', r'(?:NATHPA|NJHPS|N\.?J\.?H\.?P\.?S)'),
        ('RAMPUR', r'(?:RAMPUR|RHEP)'),
        ('LUHRI', r'(?:LUHRI|LHEP)'),
    ]
    
    lines = text.split('\n')
    
    for station_id, pattern in station_patterns:
        for i, line in enumerate(lines):
            if re.search(pattern, line, re.IGNORECASE):
                # Extract all numbers from this line and nearby lines
                numbers = re.findall(r'([\d]+\.[\d]+|[\d]+)', line)
                
                if len(numbers) >= 2:
                    # First number is usually total, rest are DISCOM splits
                    station_entry = {
                        'station_id': station_id,
                        'station_name': STATIONS.get(station_id, {}).get('name', station_id),
                        'raw_numbers': [float(n) for n in numbers],
                        'discom_allocations': {}
                    }
                    
                    # Try to map numbers to discoms
                    # Skip the first number (usually serial/total), map rest to detected discoms
                    data_numbers = [float(n) for n in numbers]
                    for j, discom in enumerate(detected_discoms):
                        if j + 1 < len(data_numbers):
                            energy_lu = data_numbers[j + 1]
                            station_entry['discom_allocations'][discom] = {
                                'energy_lu': energy_lu,
                                'energy_mwh': round(energy_lu * 100, 2)
                            }
                    
                    results.append(station_entry)
                    break  # Found this station, move to next
    
    # Also extract total state-level data if available
    total_patterns = [
        r'TOTAL\s+(?:ENERGY|SCHEDULED)\s*:?\s*([\d\.]+)',
        r'GRAND\s+TOTAL\s*:?\s*([\d\.]+)',
    ]
    
    for pattern in total_patterns:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            results.append({
                'station_id': 'TOTAL',
                'station_name': 'Grand Total',
                'energy_lu': float(match.group(1)),
                'energy_mwh': round(float(match.group(1)) * 100, 2),
            })
            break
    
    return {
        'detected_discoms': detected_discoms,
        'station_allocations': results
    }


DELHI_SEA_STATIONS = {
    'NATHPA_JHAKRI': r'NATHPA\s*JHAKRI',
    'RAMPUR': r'RAMPUR',
}
DELHI_SEA_LICENSEES = ['BRPL', 'BYPL', 'TPDDL', 'NDMC', 'MES']


def delhi_sea_period(text):
    """The month a Delhi State Energy Account says it is for, as YYYY-MM."""
    m = re.search(r'for\s+the\s+month\s+of\s+([A-Za-z]+)[\s\'’`-]*(\d{4}|\d{2})\b', text, re.I)
    if not m or m.group(1).upper() not in MONTHS:
        return None
    year = m.group(2)
    if len(year) == 2:
        year = '20' + year
    return '%s-%02d' % (year, MONTHS.index(m.group(1).upper()) + 1)


def parse_delhi_sea(text):
    """
    Annexure-2, table C of Delhi SLDC's State Energy Account: the month's
    weighted average entitlement of each Delhi licensee in the ISGS stations.

    NRPC's account gives Delhi one figure per station; this is where that figure
    is divided among BRPL, BYPL and TPDDL, to the same six decimals. Table D
    (cumulative for the year) follows it with the same station names, so only
    the text between the two headings is read.
    """
    start = re.search(r'C\)\s*Weighted\s+Avg\.?\s+entitlement\s+of\s+Distribution\s+Licensees\s+from\s+ISGS', text, re.I)
    if not start:
        return {}
    rest = text[start.end():]
    stop = re.search(r'D\)\s*Cum', rest, re.I)
    section = rest[:stop.start()] if stop else rest
    out = {}
    for key, pattern in DELHI_SEA_STATIONS.items():
        m = re.search(r'^\s*' + pattern + r'\s+((?:\d+\.\d+\s*)+)$', section, re.I | re.M)
        if not m:
            continue
        figures = [float(x) for x in m.group(1).split()]
        if len(figures) < 2:
            continue
        row = {'total': figures[0]}
        for i, name in enumerate(DELHI_SEA_LICENSEES):
            row[name] = figures[i + 1] if i + 1 < len(figures) else 0.0
        out[key] = row
    return out


def main():
    if len(sys.argv) < 2:
        print(json.dumps({'success': False, 'error': 'Usage: python parse_rea.py <pdf_path> [--mode rea|sldc|delhi_sea]'}))
        sys.exit(1)
    
    pdf_path = sys.argv[1]
    
    # Parse optional --mode flag
    forced_mode = None
    if '--mode' in sys.argv:
        mode_idx = sys.argv.index('--mode')
        if mode_idx + 1 < len(sys.argv):
            forced_mode = sys.argv[mode_idx + 1]
    
    try:
        text = extract_text(pdf_path)
        
        if not text.strip():
            print(json.dumps({'success': False, 'error': 'Could not extract any text from PDF. File may be scanned/image-based.'}))
            sys.exit(1)
        
        mode = forced_mode or detect_mode(text)
        
        if mode == 'delhi_sea':
            print(json.dumps({
                'success': True,
                'mode': 'delhi_sea',
                'description': 'Delhi State Energy Account (licensee entitlement in ISGS stations)',
                'period': delhi_sea_period(text),
                'data': parse_delhi_sea(text)
            }, indent=2))
        elif mode == 'sldc':
            data = parse_sldc_sea(text)
            print(json.dumps({
                'success': True,
                'mode': 'sldc',
                'description': 'State Energy Account (DISCOM-level allocations)',
                'data': data
            }, indent=2))
        else:
            data = parse_rea(text)
            print(json.dumps({
                'success': True,
                'mode': 'rea',
                'description': 'Regional Energy Account (Station-level)',
                'period': account_period(text),
                'periods_named': account_periods(text),
                'period_conflict': account_period_conflict(text),
                'data': data
            }, indent=2))
    
    except Exception as e:
        print(json.dumps({'success': False, 'error': str(e)}))
        sys.exit(1)


if __name__ == '__main__':
    main()
