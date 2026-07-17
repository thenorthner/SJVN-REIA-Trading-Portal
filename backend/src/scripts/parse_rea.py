#!/usr/bin/env python3
"""
SJVN Energy Platform — REA & SLDC PDF Parser

Supports two parsing modes (auto-detected):
  1. NRPC REA (Regional Energy Account) — Station-level PAF + Energy
  2. State SLDC SEA (State Energy Account) — DISCOM-level allocations (BRPL, BYPL, TPDDL, etc.)

Usage:
  python parse_rea.py <pdf_path> [--mode rea|sldc]

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
    },
    'RAMPUR': {
        'name': 'Rampur HEP',
        'search_paf': r'RAMPUR\s*HEP\s+([\d\.]+)',
        'search_energy': r'TOTAL\s*RAMPUR\s*HEP\s+([\d\.]+)',
    },
    'LUHRI': {
        'name': 'Luhri HEP',
        'search_paf': r'LUHRI\s*HEP\s+([\d\.]+)',
        'search_energy': r'TOTAL\s*LUHRI\s*HEP\s+([\d\.]+)',
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


def parse_rea(text):
    """Parse NRPC REA — extract station-level energy and PAF data."""
    results = []
    
    for key, config in STATIONS.items():
        paf_match = re.search(config['search_paf'], text)
        energy_match = re.search(config['search_energy'], text)
        
        paf = float(paf_match.group(1)) if paf_match else None
        energy_lu = float(energy_match.group(1)) if energy_match else None
        
        # 1 Lakh Units (LU) = 1,00,000 kWh = 100 MWh
        energy_mwh = round(energy_lu * 100, 2) if energy_lu is not None else None
        
        if paf is not None or energy_mwh is not None:
            results.append({
                'station_id': key,
                'station_name': config['name'],
                'availability_percent': paf,
                'energy_lu': energy_lu,
                'energy_mwh': energy_mwh,
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


def main():
    if len(sys.argv) < 2:
        print(json.dumps({'success': False, 'error': 'Usage: python parse_rea.py <pdf_path> [--mode rea|sldc]'}))
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
        
        if mode == 'sldc':
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
                'data': data
            }, indent=2))
    
    except Exception as e:
        print(json.dumps({'success': False, 'error': str(e)}))
        sys.exit(1)


if __name__ == '__main__':
    main()
