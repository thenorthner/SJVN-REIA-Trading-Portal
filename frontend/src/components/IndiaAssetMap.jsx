import React, { useState, useId } from 'react';
import { 
  Droplets, Factory, Sun, Wind, Layers, MapPin, 
  ChevronRight, Compass, Maximize2, RotateCcw
} from 'lucide-react';
import { useGigw } from '../gigw/GigwContext.jsx';
import { INDIA_OUTLINE_PATH, INDIA_STATES } from './indiaMapData.js';

/**
 * SJVN National Generation GIS Asset Map
 * Official Survey of India (SOI) compliant boundary projection.
 * Interactive vector-based map of India showing all operating & under-construction
 * generation assets with real-world geo-coordinates, sector filters, and technical popups.
 * 100% vector SVG — ultra-fast, zero external tile dependencies, CSP compliant.
 */

export const SJVN_ASSETS = [
  {
    id: 'NJHPS',
    name: 'Nathpa Jhakri HPS',
    hindiName: 'नाथपा झाकड़ी जलविद्युत स्टेशन',
    type: 'HYDRO',
    capacity: '1,500 MW',
    capacityNum: 1500,
    config: '6 × 250 MW Francis Turbines',
    location: 'Shimla & Kinnaur, Himachal Pradesh',
    basin: 'Satluj River Basin',
    grid: 'Northern Regional Grid (NRPC)',
    status: 'Operational · Flagship',
    statusColor: '#10b981',
    designEnergy: '6,950 MUs / year',
    beneficiaries: 'Punjab, Haryana, Delhi, HP, Rajasthan, UP, J&K, Chandigarh',
    coords: { x: 223.4, y: 151.0 },
    tagOffset: { x: 14, y: -14 },
    hpTagOffset: { x: 2.0, y: -3.8 },
    color: '#0284c7',
    icon: Droplets,
    description: "India's premier underground hydro station on the Satluj."
  },
  {
    id: 'RHPS',
    name: 'Rampur Hydro Station',
    hindiName: 'रामपुर जलविद्युत स्टेशन',
    type: 'HYDRO',
    capacity: '412 MW',
    capacityNum: 412,
    config: '6 × 68.67 MW Francis Cascade',
    location: 'Shimla & Kullu, Himachal Pradesh',
    basin: 'Satluj River (Tandem Cascade)',
    grid: 'Northern Regional Grid (NRPC)',
    status: 'Operational',
    statusColor: '#10b981',
    designEnergy: '1,878 MUs / year',
    beneficiaries: 'Northern Region Beneficiary States',
    coords: { x: 217.0, y: 153.3 },
    tagOffset: { x: 14, y: -14 },
    hpTagOffset: { x: -14.5, y: -3.6 },
    color: '#0284c7',
    icon: Droplets,
    description: 'Eco-friendly cascade utilizing tailrace discharge from Nathpa Jhakri with zero reservoir requirement.'
  },
  {
    id: 'LUHRI',
    name: 'Luhri Hydro Project (Stage-I)',
    hindiName: 'लूहरी जलविद्युत परियोजना (चरण-1)',
    type: 'HYDRO',
    capacity: '210 MW',
    capacityNum: 210,
    config: 'Run-of-River Dam Scheme',
    location: 'Shimla & Kullu, Himachal Pradesh',
    basin: 'Satluj River',
    grid: 'NRPC Grid Interconnection',
    status: 'Under Construction',
    statusColor: '#f59e0b',
    designEnergy: '758 MUs / year',
    beneficiaries: 'Himachal Pradesh & Northern Grid',
    coords: { x: 213.0, y: 155.7 },
    tagOffset: { x: 14, y: -14 },
    hpTagOffset: { x: -14.5, y: 0.2 },
    color: '#0284c7',
    icon: Droplets,
    description: 'Key upcoming clean baseload project advancing towards scheduled commissioning.'
  },
  {
    id: 'SUNNI',
    name: 'Sunni Dam Hydro Project',
    hindiName: 'सुन्नी बांध जलविद्युत परियोजना',
    type: 'HYDRO',
    capacity: '382 MW',
    capacityNum: 382,
    config: 'Run-of-the-River with Diurnal Pondage',
    location: 'Shimla & Mandi, Himachal Pradesh',
    basin: 'Satluj River',
    grid: 'NRPC Interconnection',
    status: 'Under Construction',
    statusColor: '#f59e0b',
    designEnergy: '1,382 MUs / year',
    beneficiaries: 'Northern Grid Discoms',
    coords: { x: 207.4, y: 157.4 },
    tagOffset: { x: 14, y: 12 },
    hpTagOffset: { x: -6.0, y: 3.4 },
    color: '#0284c7',
    icon: Droplets,
    description: 'High-head hydro project balancing renewable integration in the Northern Regional Grid.'
  },
  {
    id: 'DHAULASIDH',
    name: 'Dhaulasidh Hydro Project',
    hindiName: 'धौलासिद्ध जलविद्युत परियोजना',
    type: 'HYDRO',
    capacity: '66 MW',
    capacityNum: 66,
    config: '2 × 33 MW Kaplan Units',
    location: 'Hamirpur, Himachal Pradesh',
    basin: 'Beas River Basin',
    grid: 'HP State Grid / NRPC',
    status: 'Under Construction',
    statusColor: '#f59e0b',
    designEnergy: '247 MUs / year',
    beneficiaries: 'HP State Electricity Board',
    coords: { x: 195.5, y: 145.6 },
    tagOffset: { x: -160, y: -14 },
    hpTagOffset: { x: 1.5, y: -1.6 },
    color: '#0284c7',
    icon: Droplets,
    description: 'Vital regional hydro project supplying clean peaking energy to Himachal Pradesh.'
  },
  {
    id: 'NAITWAR',
    name: 'Naitwar Mori HPS',
    hindiName: 'नैटवाड़ मोरी जलविद्युत स्टेशन',
    type: 'HYDRO',
    capacity: '60 MW',
    capacityNum: 60,
    config: '2 × 30 MW Francis Units',
    location: 'Uttarkashi, Uttarakhand',
    basin: 'Tons River (Yamuna Basin)',
    grid: 'NRPC Grid Connection',
    status: 'Operational',
    statusColor: '#10b981',
    designEnergy: '265 MUs / year',
    beneficiaries: 'Uttarakhand Power Corp & Home State',
    coords: { x: 224.9, y: 161.7 },
    tagOffset: { x: 14, y: 8 },
    hpTagOffset: { x: 2.0, y: 2.0 },
    color: '#0284c7',
    icon: Droplets,
    description: 'Run-of-the-river hydroelectric scheme in Uttarakhand with dedicated evacuation system.'
  },
  {
    id: 'BUXAR',
    name: 'Buxar Thermal Power Plant',
    hindiName: 'बक्सर थर्मल पावर प्लांट (1320 MW)',
    type: 'THERMAL',
    capacity: '1,320 MW',
    capacityNum: 1320,
    config: '2 × 660 MW Supercritical Boilers',
    location: 'Chausa, Buxar, Bihar',
    basin: 'Ganga Plains (Eastern India)',
    grid: 'Eastern Regional Grid (ERPC)',
    status: 'Unit-1 Synchronized · Commissioning',
    statusColor: '#f97316',
    designEnergy: '9,828 MUs / year',
    beneficiaries: 'Bihar Discoms (85%), Eastern Grid',
    coords: { x: 333.0, y: 280.6 },
    tagOffset: { x: 14, y: -10 },
    color: '#ea580c',
    icon: Factory,
    description: 'Ultra-modern supercritical coal-fired baseload powerhouse featuring low-emission FGD and high thermal efficiency.'
  },
  {
    id: 'BIKANER',
    name: 'Bikaner Solar Power Project',
    hindiName: 'बीकानेर 1000 MW सौर ऊर्जा पार्क',
    type: 'SOLAR',
    capacity: '1,000 MW',
    capacityNum: 1000,
    config: 'High-Efficiency Bifacial Solar Modules',
    location: 'Bikaner, Rajasthan',
    basin: 'Thar High-Irradiance Zone',
    grid: 'National ISTS Grid (Northern Grid)',
    status: 'Under Execution · CPSU Scheme',
    statusColor: '#f59e0b',
    designEnergy: '2,450 MUs / year',
    beneficiaries: 'Pan-India Discoms under MNRE CPSU Scheme',
    coords: { x: 133.7, y: 222.4 },
    tagOffset: { x: 14, y: -10 },
    color: '#eab308',
    icon: Sun,
    description: "One of India's largest single-location utility solar projects directly evacuating through 765 kV ISTS network."
  },
  {
    id: 'KHAVDA',
    name: 'Khavda Renewable Energy Park',
    hindiName: 'खावड़ा 700 MW नवीकरणीय पार्क',
    type: 'SOLAR',
    capacity: '700 MW',
    capacityNum: 700,
    config: 'Utility Photovoltaic Array',
    location: 'Kutch, Gujarat',
    basin: 'Rann of Kutch Hybrid Zone',
    grid: 'Western Regional Grid (WRPC / ISTS)',
    status: 'In Active Development',
    statusColor: '#f59e0b',
    designEnergy: '1,720 MUs / year',
    beneficiaries: 'National Grid / GUVNL',
    coords: { x: 60.2, y: 307.1 },
    tagOffset: { x: 14, y: -10 },
    color: '#eab308',
    icon: Sun,
    description: "SJVN's flagship allocation inside the World's largest Hybrid Renewable Energy Park in Khavda."
  },
  {
    id: 'RAGHANESDA',
    name: 'Raghanesda Solar Park',
    hindiName: 'राघनेस्दा 100 MW सौर ऊर्जा परियोजना',
    type: 'SOLAR',
    capacity: '100 MW',
    capacityNum: 100,
    config: 'Ground Mounted Utility Solar',
    location: 'Banaskantha, Gujarat',
    basin: 'North Gujarat Solar Belt',
    grid: 'GUVNL / WRPC Network',
    status: 'Operational',
    statusColor: '#10b981',
    designEnergy: '240 MUs / year',
    beneficiaries: 'Gujarat Urja Vikas Nigam Ltd (GUVNL)',
    coords: { x: 87.2, y: 299.8 },
    tagOffset: { x: 14, y: -14 },
    color: '#eab308',
    icon: Sun,
    description: 'Fully commissioned grid-tied utility project generating reliable green power.'
  },
  {
    id: 'DHOLERA',
    name: 'Dholera Solar Park',
    hindiName: 'धोलेरा 100 MW सौर ऊर्जा संयंत्र',
    type: 'SOLAR',
    capacity: '100 MW',
    capacityNum: 100,
    config: 'Smart Inverter Ground Array',
    location: 'Dholera SIR, Gujarat',
    basin: 'Gulf of Khambhat Industrial Region',
    grid: 'WRPC / GUVNL Network',
    status: 'Operational',
    statusColor: '#10b981',
    designEnergy: '228 MUs / year',
    beneficiaries: 'GUVNL & Western Grid Offtakers',
    coords: { x: 105.1, y: 344.8 },
    tagOffset: { x: 14, y: 8 },
    color: '#eab308',
    icon: Sun,
    description: 'Pioneering solar development in Gujarat Special Investment Region.'
  },
  {
    id: 'UP_SOLAR',
    name: 'Parasan, Gurhah & Gujrai Solar',
    hindiName: 'परासन, गुरहा एवं गुजराई सौर क्लस्टर',
    type: 'SOLAR',
    capacity: '175 MW',
    capacityNum: 175,
    config: '75 MW + 50 MW + 50 MW Utility Solar',
    location: 'Jalaun & Kanpur Dehat, Uttar Pradesh',
    basin: 'Bundelkhand Sun Corridor',
    grid: 'UPPCL State Grid / NRPC',
    status: 'Operational',
    statusColor: '#10b981',
    designEnergy: '385 MUs / year',
    beneficiaries: 'Uttar Pradesh Power Corp (UPPCL)',
    coords: { x: 246.4, y: 266.5 },
    tagOffset: { x: 14, y: -10 },
    color: '#eab308',
    icon: Sun,
    description: 'Tri-project solar cluster energizing the Bundelkhand clean energy transmission highway.'
  },
  {
    id: 'WIND_SITES',
    name: 'Sadla & Jaisalmer Wind Stations',
    hindiName: 'सादला एवं जैसलमेर पवन ऊर्जा केंद्र',
    type: 'WIND',
    capacity: '97.6 MW',
    capacityNum: 97.6,
    config: 'High-Hub Height Wind Turbine Generators',
    location: 'Surendranagar (GJ) & Jaisalmer (RJ)',
    basin: 'Western High-Wind Regimes',
    grid: 'State Discom Grids',
    status: 'Operational',
    statusColor: '#10b981',
    designEnergy: '210 MUs / year',
    beneficiaries: 'GUVNL & Rajasthan Discoms',
    coords: { x: 86.2, y: 275.0 },
    tagOffset: { x: 14, y: -10 },
    color: '#10b981',
    icon: Wind,
    description: 'High-performing commercial wind assets feeding round-the-clock green electrons.'
  },
  {
    id: 'REIA_ISTS',
    name: 'REIA Pan-India Bidding Mandate',
    hindiName: 'REIA राष्ट्रीय नवीकरणीय निविदा पोर्टफोलियो',
    type: 'REIA',
    capacity: '2,400+ MW',
    capacityNum: 2400,
    config: 'Solar · Wind · RTC Hybrid ISTS Tenders',
    location: 'Pan-India ISTS Sub-stations (RJ, GJ, MP, MH)',
    basin: 'National Clean Energy Footprint',
    grid: 'National Transmission Grid (ISTS)',
    status: 'MNRE Mandate · Active Tendering',
    statusColor: '#3b82f6',
    designEnergy: 'Over 5,800 MUs contracted',
    beneficiaries: 'Multiple State Discoms & Offtakers nationwide',
    coords: { x: 207.7, y: 327.6 },
    tagOffset: { x: 14, y: -10 },
    color: '#6366f1',
    icon: Layers,
    description: 'Designated Renewable Energy Implementing Agency (REIA) by Ministry of Power / MNRE for utility-scale procurement and tariff management.'
  }
];

export default function IndiaAssetMap() {
  const { lang } = useGigw();
  const [selectedAsset, setSelectedAsset] = useState(SJVN_ASSETS[0]);
  const [activeFilter, setActiveFilter] = useState('ALL');
  const [hoveredAsset, setHoveredAsset] = useState(null);
  const [viewMode, setViewMode] = useState('NATIONAL'); // 'NATIONAL' | 'HP_ZOOM'
  const detailId = useId();

  const filteredAssets = SJVN_ASSETS.filter((a) => {
    if (activeFilter === 'ALL') return true;
    if (activeFilter === 'HYDRO') return a.type === 'HYDRO';
    if (activeFilter === 'THERMAL') return a.type === 'THERMAL';
    if (activeFilter === 'SOLAR') return a.type === 'SOLAR';
    if (activeFilter === 'WIND_REIA') return a.type === 'WIND' || a.type === 'REIA';
    return true;
  });

  // The REIA pin is the tendered mandate, not a plant: counting it beside the
  // parks it covers would double-count, so the total skips it unless it is the filter.
  const totalFilteredCapacity = filteredAssets
    .filter((a) => activeFilter === 'WIND_REIA' || a.id !== 'REIA_ISTS')
    .reduce((acc, curr) => acc + curr.capacityNum, 0);

  // Auto-switch to HP_ZOOM if hydro filter is clicked, or allow manual toggle
  const handleFilterClick = (filter) => {
    setActiveFilter(filter);
    if (filter === 'HYDRO' && viewMode === 'NATIONAL') {
      setViewMode('HP_ZOOM');
    } else if (filter !== 'HYDRO' && filter !== 'ALL' && viewMode === 'HP_ZOOM') {
      setViewMode('NATIONAL');
    }
  };

  const isHpZoom = viewMode === 'HP_ZOOM';

  return (
    <div className="india-asset-map-container" role="region" aria-label="SJVN National Asset Map">
      {/* Map Control Bar & Filters */}
      <div className="map-toolbar">
        <div className="map-filters" role="tablist" aria-label="Filter generation assets by fuel sector">
          <button
            type="button"
            role="tab"
            aria-selected={activeFilter === 'ALL'}
            className={`map-filter-btn ${activeFilter === 'ALL' ? 'active' : ''}`}
            onClick={() => handleFilterClick('ALL')}
          >
            <Layers size={14} />
            <span>{lang === 'hi' ? 'सभी परियोजनाएं (All Assets)' : 'All Assets (14 Sites)'}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeFilter === 'HYDRO'}
            className={`map-filter-btn hydro ${activeFilter === 'HYDRO' ? 'active' : ''}`}
            onClick={() => handleFilterClick('HYDRO')}
          >
            <Droplets size={14} />
            <span>{lang === 'hi' ? 'जलविद्युत (Hydro - 2,630+ MW)' : 'Hydro (2,630+ MW)'}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeFilter === 'THERMAL'}
            className={`map-filter-btn thermal ${activeFilter === 'THERMAL' ? 'active' : ''}`}
            onClick={() => handleFilterClick('THERMAL')}
          >
            <Factory size={14} />
            <span>{lang === 'hi' ? 'सुपरक्रिटिकल थर्मल (Thermal - 1,320 MW)' : 'Thermal (1,320 MW)'}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeFilter === 'SOLAR'}
            className={`map-filter-btn solar ${activeFilter === 'SOLAR' ? 'active' : ''}`}
            onClick={() => handleFilterClick('SOLAR')}
          >
            <Sun size={14} />
            <span>{lang === 'hi' ? 'सौर ऊर्जा (Solar - 2,075 MW)' : 'Solar (2,075 MW)'}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeFilter === 'WIND_REIA'}
            className={`map-filter-btn reia ${activeFilter === 'WIND_REIA' ? 'active' : ''}`}
            onClick={() => handleFilterClick('WIND_REIA')}
          >
            <Wind size={14} />
            <span>{lang === 'hi' ? 'पवन व REIA (Wind & ISTS - 2,497 MW)' : 'Wind & REIA (2,497+ MW)'}</span>
          </button>
        </div>

        <div className="map-capacity-counter">
          <span className="counter-label">{lang === 'hi' ? 'प्रदर्शित क्षमता:' : 'Visible Capacity:'}</span>
          <strong className="counter-value">{Math.round(totalFilteredCapacity).toLocaleString('en-IN')}+ MW</strong>
        </div>
      </div>

      {/* Main Map + Details Layout */}
      <div className="map-main-stage">
        {/* Vector SVG India Map Canvas */}
        <div className="map-canvas-card">
          {/* Top Controls Overlay */}
          {!isHpZoom ? (
            <div className="map-legend-overlay">
              <div className="legend-item"><span className="legend-dot hydro" /> Hydro Baseload</div>
              <div className="legend-item"><span className="legend-dot thermal" /> Supercritical Thermal</div>
              <div className="legend-item"><span className="legend-dot solar" /> Solar PV Parks</div>
              <div className="legend-item"><span className="legend-dot wind" /> Wind &amp; REIA Hubs</div>
            </div>
          ) : (
            <div className="map-legend-overlay hp-badge">
              <div className="legend-item">
                <span className="legend-dot hydro" />
                <span>{lang === 'hi' ? 'सतलुज एवं ब्यास बेसिन जलविद्युत श्रृंखला' : 'Satluj & Beas Hydro Cascade'}</span>
              </div>
            </div>
          )}

          {/* View Mode Switcher Button (National Map vs HP Hydro Basin Focus) */}
          <div className="map-view-switcher">
            <button
              type="button"
              className={`view-toggle-btn ${!isHpZoom ? 'active' : ''}`}
              onClick={() => setViewMode('NATIONAL')}
              title="View full sovereign Indian territory"
            >
              <Compass size={13} />
              <span>{lang === 'hi' ? 'अखिल भारतीय नक्शा' : 'All-India Map'}</span>
            </button>
            <button
              type="button"
              className={`view-toggle-btn ${isHpZoom ? 'active' : ''}`}
              onClick={() => setViewMode('HP_ZOOM')}
              title="Focus on Himachal Pradesh Satluj Basin Hydro Cascade"
            >
              <Maximize2 size={13} />
              <span>{lang === 'hi' ? 'हिमाचल हाइड्रो बेसिन' : 'HP Hydro Basin (Zoom)'}</span>
            </button>
          </div>

          <svg 
            viewBox={isHpZoom ? "182 133 52 38" : "0 0 620 700"} 
            className={`india-svg-map ${isHpZoom ? 'zoomed-hp' : ''}`}
            aria-label="Official Survey of India compliant GIS Map illustrating SJVN power plant installations across India"
          >
            <defs>
              <linearGradient id="mapBgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="var(--surface-sunken, #0b1120)" />
                <stop offset="100%" stopColor="var(--surface, #111827)" />
              </linearGradient>

              <filter id="soiGlow" x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation="3" result="glow" />
                <feMerge>
                  <feMergeNode in="glow" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>

            {/* Official Survey of India (SOI) All 36 States & Union Territories */}
            <g id="soi-states" className="states-group">
              {INDIA_STATES.map((state) => (
                <path
                  key={state.id}
                  id={state.id}
                  className={`india-state-path ${state.hasAssets ? 'has-asset' : ''}`}
                  d={state.d}
                >
                  <title>{state.name}</title>
                </path>
              ))}
            </g>

            {/* Official Sovereign National Boundary Glow */}
            {!isHpZoom && (
              <path
                className="india-outer-boundary"
                d={INDIA_OUTLINE_PATH}
                filter="url(#soiGlow)"
              />
            )}

            {/* Regional Power Committee Grid Zones (NRPC, WRPC, ERPC, SRPC, NERPC) */}
            {!isHpZoom && (
              <g className="map-grid-corridors">
                {/* 765 kV / 400 kV National Transmission ISTS Highways */}
                <path className="grid-corridor-line" d="M223,151 L195,145 L133,222 L86,275 L60,307 L105,344" />
                <path className="grid-corridor-line" d="M133,222 L246,266 L333,280" />
                <path className="grid-corridor-line" d="M223,151 L207,327 L230,500" />
                <path className="grid-corridor-line" d="M207,327 L333,280" />

                {/* Regional RPC Labels */}
                <text x="210" y="105" className="map-region-label">NRPC (Northern Grid)</text>
                <text x="130" y="380" className="map-region-label">WRPC (Western Grid)</text>
                <text x="390" y="275" className="map-region-label">ERPC (Eastern Grid)</text>
                <text x="225" y="520" className="map-region-label">SRPC (Southern Grid)</text>
                <text x="495" y="240" className="map-region-label">NERPC (North-Eastern)</text>
                <text x="235" y="610" className="map-region-label subtle">National ISTS Green Energy Corridors</text>
              </g>
            )}

            {/* Satluj River Basin Schematic Flow Line (in HP Zoom mode) */}
            {isHpZoom && (
              <g className="hp-river-basin">
                <path 
                  className="river-satluj-path" 
                  d="M226,149 Q220,152 215,154 T208,157 T201,155 T195,145" 
                />
                <text x="206" y="148" className="river-label">Satluj River Basin</text>
                <text x="193" y="142" className="river-label">Beas Basin</text>
              </g>
            )}

            {/* Generation Assets & Operational Hotspots */}
            {filteredAssets.map((asset) => {
              const isSelected = selectedAsset?.id === asset.id;
              const isHovered = hoveredAsset?.id === asset.id;
              const showTag = isHovered || isSelected || isHpZoom;

              // In HP Zoom mode, skip non-HP assets to keep view focused
              if (isHpZoom && !['NJHPS', 'RHPS', 'LUHRI', 'SUNNI', 'DHAULASIDH', 'NAITWAR'].includes(asset.id)) {
                return null;
              }

              const pinScale = isHpZoom ? 0.09 : 1;

              return (
                <g 
                  key={asset.id} 
                  className={`map-pin-group ${isSelected ? 'selected' : ''} ${isHovered ? 'hovered' : ''}`}
                  transform={`translate(${asset.coords.x}, ${asset.coords.y})`}
                  onClick={() => setSelectedAsset(asset)}
                  onMouseEnter={() => setHoveredAsset(asset)}
                  onMouseLeave={() => setHoveredAsset(null)}
                  tabIndex={0}
                  role="button"
                  aria-pressed={isSelected}
                  aria-label={`${asset.name}, ${asset.capacity}, ${asset.location}`}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setSelectedAsset(asset);
                    }
                  }}
                >
                  {/* Transparent generous hit target for mouse and touch */}
                  <circle r={isHpZoom ? 2.5 : 18} fill="transparent" style={{ pointerEvents: 'all' }} />

                  {/* Pulsing Radar Beacon */}
                  <circle
                    r={isSelected ? (isHpZoom ? 2.2 : 16) : (isHpZoom ? 1.4 : 11)}
                    className="pin-pulse-beacon"
                    style={{ fill: asset.color, stroke: asset.color, pointerEvents: 'none' }}
                  />

                  {/* Core Indicator Beacon */}
                  <circle
                    r={isSelected ? (isHpZoom ? 0.9 : 6.5) : (isHpZoom ? 0.6 : 4.5)}
                    className="pin-core-dot"
                    style={{ fill: asset.color, stroke: '#ffffff', strokeWidth: isHpZoom ? 0.2 : 1.5, pointerEvents: 'none' }}
                  />

                  {/* Pin Selection Highlight Ring */}
                  {isSelected && (
                    <circle
                      r={isHpZoom ? 1.4 : 9.5}
                      fill="none"
                      stroke="#38bdf8"
                      strokeWidth={isHpZoom ? 0.3 : 2}
                      style={{ pointerEvents: 'none' }}
                    />
                  )}

                  {/* High-visibility Callout Tag */}
                  {showTag && (
                    <g 
                      className="map-pin-tag-group"
                      style={{ pointerEvents: 'none' }}
                      transform={
                        isHpZoom 
                          ? `translate(${asset.hpTagOffset?.x || 1.2}, ${asset.hpTagOffset?.y || -1.8})` 
                          : `translate(${asset.tagOffset?.x || 14}, ${asset.tagOffset?.y || -10})`
                      }
                    >
                      {isHpZoom ? (
                        <>
                          <rect
                            rx="0.4"
                            className="map-pin-tag-bg hp"
                            width="13.5"
                            height="2.8"
                            y="-1.3"
                          />
                          <text x="0.5" y="-0.2" className="map-pin-tag-text hp-title">
                            {asset.name}
                          </text>
                          <text x="0.5" y="0.9" className="map-pin-tag-text hp-sub">
                            {asset.capacity} · {asset.config}
                          </text>
                        </>
                      ) : (
                        <>
                          <rect
                            rx="4"
                            className="map-pin-tag-bg"
                            width={asset.name.length * 7.5 + 46}
                            height="24"
                            y="-14"
                          />
                          <text x="8" y="2" className="map-pin-tag-text">
                            {asset.name} ({asset.capacity})
                          </text>
                        </>
                      )}
                    </g>
                  )}
                </g>
              );
            })}
          </svg>
        </div>

        {/* Selected Project Live Telemetry & Details Card */}
        {selectedAsset && (
          <aside className="asset-detail-card" aria-labelledby={detailId}>
            <div className="detail-card-header">
              <div className="detail-badge-row">
                <span className={`detail-sector-badge sector-${selectedAsset.type.toLowerCase()}`}>
                  {selectedAsset.type}
                </span>
                <span className="detail-status-pill">
                  <span className="live-status-dot" style={{ background: selectedAsset.statusColor }} />
                  {selectedAsset.status}
                </span>
              </div>

              <h3 id={detailId} className="detail-asset-title">
                {lang === 'hi' ? selectedAsset.hindiName : selectedAsset.name}
              </h3>
              <p className="detail-asset-location">
                <MapPin size={14} className="location-pin-icon" />
                <span>{selectedAsset.location}</span>
              </p>
            </div>

            <div className="detail-metric-highlight">
              <div className="metric-box">
                <span className="m-label">{lang === 'hi' ? 'स्थापित क्षमता' : 'Installed Capacity'}</span>
                <strong className="m-val">{selectedAsset.capacity}</strong>
              </div>
              <div className="metric-box">
                <span className="m-label">{lang === 'hi' ? 'वार्षिक ऊर्जा उत्पादन' : 'Design Energy'}</span>
                <strong className="m-val">{selectedAsset.designEnergy}</strong>
              </div>
            </div>

            <p className="detail-asset-description">{selectedAsset.description}</p>

            <div className="detail-specs-table">
              <div className="spec-row">
                <span className="spec-key">{lang === 'hi' ? 'संयंत्र विन्यास:' : 'Technical Config:'}</span>
                <span className="spec-val">{selectedAsset.config}</span>
              </div>
              <div className="spec-row">
                <span className="spec-key">{lang === 'hi' ? 'नदी बेसिन / क्षेत्र:' : 'Basin / Geography:'}</span>
                <span className="spec-val">{selectedAsset.basin}</span>
              </div>
              <div className="spec-row">
                <span className="spec-key">{lang === 'hi' ? 'क्षेत्रीय ग्रिड (RPC):' : 'Grid Interconnection:'}</span>
                <span className="spec-val font-semibold">{selectedAsset.grid}</span>
              </div>
              <div className="spec-row">
                <span className="spec-key">{lang === 'hi' ? 'लाभार्थी राज्य:' : 'Beneficiary Offtakers:'}</span>
                <span className="spec-val">{selectedAsset.beneficiaries}</span>
              </div>
            </div>

            <div className="detail-footer-action">
              {['NJHPS', 'RHPS', 'LUHRI', 'SUNNI', 'DHAULASIDH', 'NAITWAR'].includes(selectedAsset.id) && !isHpZoom && (
                <button 
                  type="button" 
                  className="btn btn-secondary detail-zoom-btn"
                  onClick={() => setViewMode('HP_ZOOM')}
                >
                  <Maximize2 size={14} />
                  <span>{lang === 'hi' ? 'हिमाचल बेसिन में ज़ूम करें' : 'Zoom Himachal Basin'}</span>
                </button>
              )}

              <button 
                type="button" 
                className="btn btn-primary detail-action-btn"
                onClick={() => {
                  const targetDesk = selectedAsset.type === 'THERMAL' ? 'THERMAL' : (selectedAsset.type === 'HYDRO' ? 'HYDRO' : 'REIA');
                  window.location.href = `/login?desk=${targetDesk}`;
                }}
              >
                <span>{lang === 'hi' ? 'डेस्क में लॉग इन करें' : 'Open Operational Desk'}</span>
                <ChevronRight size={15} />
              </button>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
