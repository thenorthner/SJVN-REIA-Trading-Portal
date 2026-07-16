import sys
import pypdf
import re
import json

def parse_rea(pdf_path):
    try:
        reader = pypdf.PdfReader(pdf_path)
        text = ""
        for page in reader.pages:
            text += page.extract_text() + "\n"
            
        results = []
        
        stations = {
            'NATHPA_JHAKRI': {
                'name': 'Nathpa Jhakri HEP',
                'search_paf': r'NATHPA\s*JHAKRI\s*HEP\s+([\d\.]+)',
                'search_energy': r'TOTAL\s*NATHPA\s*JHAKRI\s*HEP\s+([\d\.]+)',
            },
            'RAMPUR': {
                'name': 'Rampur HEP',
                'search_paf': r'RAMPUR\s*HEP\s+([\d\.]+)',
                'search_energy': r'TOTAL\s*RAMPUR\s*HEP\s+([\d\.]+)',
            }
        }
        
        for key, config in stations.items():
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
            
        print(json.dumps({'success': True, 'data': results}))
    except Exception as e:
        print(json.dumps({'success': False, 'error': str(e)}))
        sys.exit(1)

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(json.dumps({'success': False, 'error': 'No PDF file provided'}))
        sys.exit(1)
    parse_rea(sys.argv[1])
