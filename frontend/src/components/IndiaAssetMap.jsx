import React, { useState, useId, useMemo, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { 
  Droplets, Factory, Sun, Wind, Layers, MapPin, 
  ChevronRight, Compass, Maximize2, Zap, Search,
  Filter, CheckCircle2, Clock, Sparkles, Building2
} from 'lucide-react';
import { useGigw } from '../gigw/GigwContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { ROLE_GROUPS } from '../roles.js';
import { INDIA_OUTLINE_PATH, INDIA_STATES } from './indiaMapData.js';

/**
 * SJVN National Generation GIS Asset Map
 * Official Survey of India (SOI) compliant boundary projection.
 * Interactive vector-based map of India showing all operating & under-construction
 * generation assets with real-world geo-coordinates, sector filters, and technical popups.
 * 100% vector SVG — ultra-fast, zero external tile dependencies, CSP compliant.
 */

export const SJVN_ASSETS = [
  // ── HYDRO POWER FLEET (HIMACHAL PRADESH, UTTARAKHAND, CROSS-BORDER NEPAL) ──
  {
    id: 'NJHPS',
    name: 'Nathpa Jhakri HPS',
    hindiName: 'नाथपा झाकड़ी जलविद्युत स्टेशन',
    type: 'HYDRO',
    capacity: '1,500 MW',
    capacityNum: 1500,
    config: '6 × 250 MW Francis Turbines',
    location: 'Shimla & Kinnaur, Himachal Pradesh',
    state: 'Himachal Pradesh',
    stateCode: 'HP',
    basin: 'Satluj River Basin',
    grid: 'Northern Regional Grid (NRPC)',
    status: 'Operational · Flagship',
    statusCategory: 'OPERATIONAL',
    statusColor: '#10b981',
    designEnergy: '6,950 MUs / year',
    beneficiaries: 'Punjab, Haryana, Delhi, HP, Rajasthan, UP, J&K, Chandigarh',
    coords: { x: 223.4, y: 151.0 },
    tagOffset: { x: 14, y: -14 },
    hpTagOffset: { x: 2.0, y: -3.8 },
    color: '#0284c7',
    icon: Droplets,
    description: "India's premier underground hydro station on the Satluj river with one of the world's largest deep desilting chambers."
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
    state: 'Himachal Pradesh',
    stateCode: 'HP',
    basin: 'Satluj River (Tandem Cascade)',
    grid: 'Northern Regional Grid (NRPC)',
    status: 'Operational',
    statusCategory: 'OPERATIONAL',
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
    config: 'Run-of-River Dam Scheme (2 × 80 MW + 2 × 25 MW)',
    location: 'Shimla & Kullu, Himachal Pradesh',
    state: 'Himachal Pradesh',
    stateCode: 'HP',
    basin: 'Satluj River Basin',
    grid: 'NRPC Grid Interconnection',
    status: 'Under Construction',
    statusCategory: 'UNDER_CONSTRUCTION',
    statusColor: '#f59e0b',
    designEnergy: '758 MUs / year',
    beneficiaries: 'Himachal Pradesh & Northern Grid',
    coords: { x: 213.0, y: 155.7 },
    tagOffset: { x: 14, y: -14 },
    hpTagOffset: { x: -14.5, y: 0.2 },
    color: '#0284c7',
    icon: Droplets,
    description: 'Key upcoming clean baseload project advancing towards scheduled commissioning on the Satluj.'
  },
  {
    id: 'LUHRI_2',
    name: 'Luhri Hydro Project (Stage-II)',
    hindiName: 'लूहरी जलविद्युत परियोजना (चरण-2)',
    type: 'HYDRO',
    capacity: '172 MW',
    capacityNum: 172,
    config: 'Run-of-River Scheme',
    location: 'Shimla & Mandi, Himachal Pradesh',
    state: 'Himachal Pradesh',
    stateCode: 'HP',
    basin: 'Satluj River Basin',
    grid: 'NRPC Interconnection',
    status: 'In Development',
    statusCategory: 'DEVELOPMENT',
    statusColor: '#38bdf8',
    designEnergy: '620 MUs / year',
    beneficiaries: 'Northern Regional Grid Discoms',
    coords: { x: 209.8, y: 154.2 },
    tagOffset: { x: 14, y: -14 },
    hpTagOffset: { x: -14.5, y: 4.0 },
    color: '#0284c7',
    icon: Droplets,
    description: 'Downstream cascade project on Satluj optimizing hydroelectric potential between Luhri-I and Sunni Dam.'
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
    state: 'Himachal Pradesh',
    stateCode: 'HP',
    basin: 'Satluj River Basin',
    grid: 'NRPC Interconnection',
    status: 'Under Construction',
    statusCategory: 'UNDER_CONSTRUCTION',
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
    capacity: "69.5 MW",
    capacityNum: 69.5,
    config: "Run-of-River Scheme",
    location: 'Hamirpur & Kangra, Himachal Pradesh',
    state: 'Himachal Pradesh',
    stateCode: 'HP',
    basin: 'Beas River Basin',
    grid: 'HP State Grid / NRPC',
    status: 'Under Construction',
    statusCategory: 'UNDER_CONSTRUCTION',
    statusColor: '#f59e0b',
    designEnergy: '247 MUs / year',
    beneficiaries: 'HP State Electricity Board & Northern Grid',
    coords: { x: 195.5, y: 145.6 },
    tagOffset: { x: -160, y: -14 },
    hpTagOffset: { x: 1.5, y: -1.6 },
    color: '#0284c7',
    icon: Droplets,
    description: 'Vital regional hydro project supplying clean peaking energy on the Beas River.'
  },
  {
    id: 'JANGI',
    name: 'Jangi Thopan Powari Hydro Project',
    hindiName: 'जंगी थोपन पोवारी जलविद्युत परियोजना',
    type: 'HYDRO',
    capacity: '804 MW',
    capacityNum: 804,
    config: 'Run-of-River High Head Scheme',
    location: 'Kinnaur, Himachal Pradesh',
    state: 'Himachal Pradesh',
    stateCode: 'HP',
    basin: 'Upper Satluj Basin',
    grid: 'NRPC / National Grid',
    status: 'In Development',
    statusCategory: 'DEVELOPMENT',
    statusColor: '#38bdf8',
    designEnergy: '3,200 MUs / year',
    beneficiaries: 'Northern Region States',
    coords: { x: 229.5, y: 147.2 },
    tagOffset: { x: 14, y: -14 },
    hpTagOffset: { x: 2.0, y: -2.0 },
    color: '#0284c7',
    icon: Droplets,
    description: 'Major upcoming high-capacity hydro asset on the upper reaches of the Satluj river.'
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
    state: 'Uttarakhand',
    stateCode: 'UK',
    basin: 'Tons River (Yamuna Basin)',
    grid: 'NRPC Grid Connection',
    status: 'Operational',
    statusCategory: 'OPERATIONAL',
    statusColor: '#10b981',
    designEnergy: '265 MUs / year',
    beneficiaries: 'Uttarakhand Power Corp & Home State',
    coords: { x: 224.9, y: 161.7 },
    tagOffset: { x: 14, y: 8 },
    hpTagOffset: { x: 2.0, y: 2.0 },
    color: '#0284c7',
    icon: Droplets,
    description: 'Commissioned run-of-the-river hydroelectric scheme in Uttarakhand with dedicated 220 kV evacuation line.'
  },
  {
    id: 'DEVSARI',
    name: 'Devsari Hydro Electric Project',
    hindiName: 'देवसारी जलविद्युत परियोजना',
    type: 'HYDRO',
    capacity: '252 MW',
    capacityNum: 252,
    config: '3 × 84 MW Underground Francis Turbines',
    location: 'Chamoli, Uttarakhand',
    state: 'Uttarakhand',
    stateCode: 'UK',
    basin: 'Pindar River (Alaknanda Basin)',
    grid: 'NRPC Interconnection',
    status: 'In Development',
    statusCategory: 'DEVELOPMENT',
    statusColor: '#38bdf8',
    designEnergy: '910 MUs / year',
    beneficiaries: 'Uttarakhand & Northern Regional Discoms',
    coords: { x: 252.0, y: 176.0 },
    tagOffset: { x: 14, y: -10 },
    color: '#0284c7',
    icon: Droplets,
    description: 'Environment-friendly run-of-river scheme on Pindar River in Uttarakhand.'
  },
  {
    id: 'ARUN_3',
    name: 'Arun-3 Hydro Electric Project (Cross-Border)',
    hindiName: 'अरुण-3 जलविद्युत परियोजना (900 MW नेपाल)',
    type: 'HYDRO',
    capacity: '900 MW',
    capacityNum: 900,
    config: '4 × 225 MW Vertical Francis Turbines',
    location: 'Sankhuwasabha, Nepal (Evacuating to Sitamarhi, Bihar)',
    state: 'Cross-Border (Nepal-India)',
    stateCode: 'NP',
    basin: 'Arun River Basin',
    grid: 'ERPC / 400 kV Cross-Border D/C Line to India',
    status: 'Under Construction · Flagship SAPDC',
    statusCategory: 'UNDER_CONSTRUCTION',
    statusColor: '#f59e0b',
    designEnergy: '4,018 MUs / year',
    beneficiaries: 'Nepal (21.9% free energy), balance to Indian National Grid (ERPC/NRPC)',
    coords: { x: 395.0, y: 228.0 },
    tagOffset: { x: 14, y: -10 },
    color: '#0284c7',
    icon: Droplets,
    description: "SJVN's premier cross-border venture via SAPDC with dedicated 400 kV D/C transmission corridor into Sitamarhi, Bihar."
  },
  {
    id: 'LOWER_ARUN',
    name: 'Lower Arun Hydro Project',
    hindiName: 'लोअर अरुण जलविद्युत परियोजना',
    type: 'HYDRO',
    capacity: '669 MW',
    capacityNum: 669,
    config: 'Tandem Cascade Scheme below Arun-3',
    location: 'Sankhuwasabha & Bhojpur, Nepal',
    state: 'Cross-Border (Nepal-India)',
    stateCode: 'NP',
    basin: 'Arun River Basin',
    grid: 'ERPC Interconnection',
    status: 'In Development · SLPDC',
    statusCategory: 'DEVELOPMENT',
    statusColor: '#38bdf8',
    designEnergy: '2,900 MUs / year',
    beneficiaries: 'Indian Grid & Nepal',
    coords: { x: 402.0, y: 232.0 },
    tagOffset: { x: 14, y: 10 },
    color: '#0284c7',
    icon: Droplets,
    description: 'Downstream cascade harnessing tailrace outflow of Arun-3 with zero reservoir inundation.'
  },

  // ── SUPERCRITICAL THERMAL FLEET (BIHAR) ──
  {
    id: 'BUXAR',
    name: 'Buxar Thermal Power Plant',
    hindiName: 'बक्सर सुपरक्रिटिकल थर्मल पावर प्लांट',
    type: 'THERMAL',
    capacity: '1,320 MW',
    capacityNum: 1320,
    config: '2 × 660 MW Supercritical Boilers',
    location: 'Chausa, Buxar, Bihar',
    state: 'Bihar',
    stateCode: 'BR',
    basin: 'Ganga Plains (Eastern India)',
    grid: 'Eastern Regional Grid (ERPC)',
    status: "Operational · Unit-1 COD Nov 2025, Unit-2 COD Sep 2026",
    statusCategory: "OPERATIONAL",
    statusColor: "#10b981",
    designEnergy: '9,828 MUs / year',
    beneficiaries: 'Bihar Discoms (85%), Eastern Grid',
    coords: { x: 333.0, y: 280.6 },
    tagOffset: { x: -180, y: -10 },
    color: '#ea580c',
    icon: Factory,
    description: 'Ultra-modern supercritical coal-fired baseload powerhouse featuring low-emission FGD and high thermal efficiency via STPL.'
  },

  // ── SOLAR POWER FLEET (RAJASTHAN, GUJARAT, UP, MP, BIHAR, ASSAM) ──
  {
    id: 'BIKANER',
    name: 'Bikaner Solar Power Project',
    hindiName: 'बीकानेर 1000 MW सौर ऊर्जा पार्क',
    type: 'SOLAR',
    capacity: '1,000 MW',
    capacityNum: 1000,
    config: 'High-Efficiency Bifacial Solar Modules',
    location: 'Bikaner, Rajasthan',
    state: 'Rajasthan',
    stateCode: 'RJ',
    basin: 'Thar High-Irradiance Zone',
    grid: 'National ISTS Grid (Northern Grid)',
    status: 'Operational · CPSU Scheme',
    statusCategory: 'OPERATIONAL',
    statusColor: '#10b981',
    designEnergy: '2,450 MUs / year',
    beneficiaries: 'Pan-India Discoms under MNRE CPSU Scheme',
    coords: { x: 133.7, y: 222.4 },
    tagOffset: { x: 14, y: -10 },
    color: '#eab308',
    icon: Sun,
    description: "One of India's largest single-location utility solar projects directly evacuating through 765 kV ISTS network."
  },
  {
    id: 'OMKARESHWAR',
    name: 'Omkareshwar Floating Solar Project',
    hindiName: 'ओंकारेश्वर 90 MW फ्लोटिंग सोलर प्लांट',
    type: 'SOLAR',
    capacity: '90 MW',
    capacityNum: 90,
    config: 'Reservoir Floating Solar PV Array',
    location: 'Khandwa, Madhya Pradesh',
    state: 'Madhya Pradesh',
    stateCode: 'MP',
    basin: 'Narmada River Reservoir',
    grid: 'WRPC / MPPMCL State Grid',
    status: 'Operational',
    statusCategory: 'OPERATIONAL',
    statusColor: '#10b981',
    designEnergy: '196 MUs / year',
    beneficiaries: 'MP Power Management Company Ltd (MPPMCL)',
    coords: { x: 182.0, y: 358.0 },
    tagOffset: { x: 14, y: -10 },
    color: '#eab308',
    icon: Sun,
    description: "Landmark floating solar installation on Omkareshwar reservoir conserving land and reducing water evaporation."
  },
  {
    id: 'KHAVDA',
    name: "Khavda Solar Project",
    hindiName: "खावड़ा 200 MW सौर परियोजना",
    type: 'SOLAR',
    capacity: "200 MW",
    capacityNum: 200,
    config: "Utility-scale solar PV, 200 MW (AC)",
    location: 'Kutch, Gujarat',
    state: 'Gujarat',
    stateCode: 'GJ',
    basin: 'Rann of Kutch Hybrid Zone',
    grid: 'Western Regional Grid (WRPC / ISTS)',
    status: 'Under Construction',
    statusCategory: 'UNDER_CONSTRUCTION',
    statusColor: '#f59e0b',
    designEnergy: "",
    beneficiaries: "Gujarat Urja Vikas Nigam Ltd (GUVNL)",
    coords: { x: 60.2, y: 307.1 },
    tagOffset: { x: 14, y: -10 },
    color: '#eab308',
    icon: Sun,
    description: "200 MW (AC) at Khavda Solar Park, Kutch, by SJVN Green Energy; the power goes to GUVNL under a PPA."
  },
  {
    id: 'RAGHANESDA',
    name: "Radhanesda Solar Project",
    hindiName: "राधनेसडा 100 MW सौर ऊर्जा परियोजना",
    type: 'SOLAR',
    capacity: '100 MW',
    capacityNum: 100,
    config: 'Ground Mounted Utility Solar',
    location: 'Banaskantha, Gujarat',
    state: 'Gujarat',
    stateCode: 'GJ',
    basin: 'North Gujarat Solar Belt',
    grid: 'GUVNL / WRPC Network',
    status: 'Operational',
    statusCategory: 'OPERATIONAL',
    statusColor: '#10b981',
    designEnergy: '240 MUs / year',
    beneficiaries: 'Gujarat Urja Vikas Nigam Ltd (GUVNL)',
    coords: { x: 87.2, y: 299.8 },
    tagOffset: { x: 14, y: -14 },
    color: '#eab308',
    icon: Sun,
    description: 'Fully commissioned grid-tied utility project generating reliable green power for Gujarat.'
  },
  {
    id: 'CHARANKA',
    name: 'Charanka Solar Power Station',
    hindiName: "चारणका 5.6 MW सौर ऊर्जा केंद्र (पहला सौर संयंत्र)",
    type: 'SOLAR',
    capacity: "5.6 MW",
    capacityNum: 5.6,
    config: 'Crystalline PV Array (SJVN Maiden Solar)',
    location: 'Patan, Gujarat',
    state: 'Gujarat',
    stateCode: 'GJ',
    basin: 'Patan Solar Park',
    grid: 'GETCO / GUVNL Grid',
    status: 'Operational · Pioneer',
    statusCategory: 'OPERATIONAL',
    statusColor: '#10b981',
    designEnergy: '8.5 MUs / year',
    beneficiaries: 'Gujarat Discoms',
    coords: { x: 90.5, y: 308.0 },
    tagOffset: { x: 14, y: -10 },
    color: '#eab308',
    icon: Sun,
    description: "SJVN's foundational utility solar installation marking entry into the renewable energy sector."
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
    state: 'Gujarat',
    stateCode: 'GJ',
    basin: 'Gulf of Khambhat Industrial Region',
    grid: 'WRPC / GUVNL Network',
    status: "Awarded 2020 · commissioning not confirmed",
    statusCategory: "UNDER_CONSTRUCTION",
    statusColor: "#f59e0b",
    designEnergy: '228 MUs / year',
    beneficiaries: 'GUVNL & Western Grid Offtakers',
    coords: { x: 105.1, y: 344.8 },
    tagOffset: { x: 14, y: 8 },
    color: '#eab308',
    icon: Sun,
    description: "100 MW won in the GUVNL Dholera tender (2020) at ₹2.80/unit. SJVN reports no commissioning yet, and its FY26 operating total does not include it."
  },
  {
    id: 'PARASAN',
    name: 'Parasan Solar Power Plant',
    hindiName: 'परासन 75 MW सौर ऊर्जा संयंत्र',
    type: 'SOLAR',
    capacity: '75 MW',
    capacityNum: 75,
    config: 'Fixed Tilt Utility Ground Mount Array',
    location: 'Jalaun, Uttar Pradesh',
    state: 'Uttar Pradesh',
    stateCode: 'UP',
    basin: 'Bundelkhand Sun Corridor',
    grid: 'UPPCL / NRPC Network',
    status: 'Operational',
    statusCategory: 'OPERATIONAL',
    statusColor: '#10b981',
    designEnergy: '165 MUs / year',
    beneficiaries: 'Uttar Pradesh Power Corp (UPPCL)',
    coords: { x: 246.4, y: 266.5 },
    tagOffset: { x: -160, y: -10 },
    color: '#eab308',
    icon: Sun,
    description: 'Operational solar park energizing the Bundelkhand clean energy transmission highway.'
  },
  {
    id: 'GURAH',
    name: 'Gurah Solar Power Plant',
    hindiName: 'गुरहा 75 MW सौर ऊर्जा संयंत्र',
    type: 'SOLAR',
    capacity: '75 MW',
    capacityNum: 75,
    config: 'High-Efficiency Multi-String Inverter Array',
    location: 'Jalaun, Uttar Pradesh',
    state: 'Uttar Pradesh',
    stateCode: 'UP',
    basin: 'Bundelkhand Clean Energy Highway',
    grid: 'UPPCL / NRPC Network',
    status: 'Operational',
    statusCategory: 'OPERATIONAL',
    statusColor: '#10b981',
    designEnergy: '165 MUs / year',
    beneficiaries: 'UPPCL State Discoms',
    coords: { x: 254.0, y: 270.0 },
    tagOffset: { x: 14, y: -10 },
    color: '#eab308',
    icon: Sun,
    description: 'Commissioned utility solar station feeding stable renewable power into Uttar Pradesh.'
  },
  {
    id: 'GUJRAI',
    name: 'Gujrai Solar Power Plant',
    hindiName: 'गुजराई 50 MW सौर ऊर्जा संयंत्र',
    type: 'SOLAR',
    capacity: '50 MW',
    capacityNum: 50,
    config: 'Smart Monofacial PV Ground Installation',
    location: 'Kanpur Dehat, Uttar Pradesh',
    state: 'Uttar Pradesh',
    stateCode: 'UP',
    basin: 'Central UP Green Corridor',
    grid: 'UPPCL Network',
    status: 'Operational',
    statusCategory: 'OPERATIONAL',
    statusColor: '#10b981',
    designEnergy: '110 MUs / year',
    beneficiaries: 'UPPCL Offtakers',
    coords: { x: 265.0, y: 264.0 },
    tagOffset: { x: 14, y: -10 },
    color: '#eab308',
    icon: Sun,
    description: 'Operational solar plant in Kanpur Dehat delivering clean green electrons under long-term PPA.'
  },
  {
    id: 'JAMUI',
    name: 'Jamui Solar Power Project',
    hindiName: "जमुई 75 MW सौर ऊर्जा परियोजना",
    type: 'SOLAR',
    capacity: "75 MW",
    capacityNum: 75,
    config: "Ground-mounted solar PV (SJVN Green Energy)",
    location: 'Jamui, Bihar',
    state: 'Bihar',
    stateCode: 'BR',
    basin: 'South Bihar Green Corridor',
    grid: 'BSPHCL / Eastern Grid (ERPC)',
    status: "Operational · COD Aug 2026",
    statusCategory: 'OPERATIONAL',
    statusColor: '#10b981',
    designEnergy: "90 MUs (first year)",
    beneficiaries: 'Bihar State Power Holding Company Ltd (BSPHCL)',
    coords: { x: 372.0, y: 292.0 },
    tagOffset: { x: 14, y: -10 },
    color: '#eab308',
    icon: Sun,
    description: "75 MW at Kakanchor, Jamui, built by SJVN Green Energy for the Bihar discoms."
  },
  {
    id: 'BANKA',
    name: 'Banka Solar Power Project',
    hindiName: 'बांका 75 MW सौर ऊर्जा परियोजना',
    type: 'SOLAR',
    capacity: '75 MW',
    capacityNum: 75,
    config: 'Ground Mounted Grid-tied PV Park',
    location: 'Banka, Bihar',
    state: 'Bihar',
    stateCode: 'BR',
    basin: 'Eastern Bihar Renewable Basin',
    grid: 'BSPHCL / ERPC Network',
    status: 'Under Construction',
    statusCategory: 'UNDER_CONSTRUCTION',
    statusColor: '#f59e0b',
    designEnergy: '165 MUs / year',
    beneficiaries: 'Bihar State Discoms',
    coords: { x: 388.0, y: 294.0 },
    tagOffset: { x: 14, y: 10 },
    color: '#eab308',
    icon: Sun,
    description: 'Under-construction solar project advancing renewable procurement targets in Bihar.'
  },
  {
    id: 'DHUBRI',
    name: 'Dhubri Solar Power Project',
    hindiName: "धुबरी 70 MW सौर ऊर्जा परियोजना",
    type: 'SOLAR',
    capacity: '70 MW',
    capacityNum: 70,
    config: "Ground-mounted solar PV (SJVN Green Energy)",
    location: 'Dhubri, Assam',
    state: 'Assam',
    stateCode: 'AS',
    basin: 'Brahmaputra Valley Corridor',
    grid: 'NERPC (North-Eastern Regional Grid)',
    status: "Operational · COD Feb 2026",
    statusCategory: 'OPERATIONAL',
    statusColor: '#10b981',
    designEnergy: "141 MUs (first year)",
    beneficiaries: 'Assam Power Distribution Company Ltd (APDCL)',
    coords: { x: 456.0, y: 272.0 },
    tagOffset: { x: 14, y: -10 },
    color: '#eab308',
    icon: Sun,
    description: "Assam's first utility-scale solar plant, built by SJVN Green Energy on land leased from APDCL; APDCL buys the power at ₹3.92/unit."
  },

  // ── WIND ENERGY FLEET (MAHARASHTRA & GUJARAT & RAJASTHAN) ──
  {
    id: 'KHIRVIRE_WIND',
    name: 'Khirvire Wind Power Project',
    hindiName: 'खिड़विरे 47.6 MW पवन ऊर्जा संयंत्र',
    type: 'WIND',
    capacity: '47.6 MW',
    capacityNum: 47.6,
    config: '56 × 850 kW Gamesa Wind Turbines',
    location: 'Ahmednagar, Maharashtra',
    state: 'Maharashtra',
    stateCode: 'MH',
    basin: 'Western Ghats Wind Corridor',
    grid: 'MSEDCL / Western Grid (WRPC)',
    status: 'Operational',
    statusCategory: 'OPERATIONAL',
    statusColor: '#10b981',
    designEnergy: '90 MUs / year',
    beneficiaries: 'Maharashtra State Electricity Distribution Co (MSEDCL)',
    coords: { x: 145.0, y: 432.0 },
    tagOffset: { x: 14, y: -10 },
    color: '#10b981',
    icon: Wind,
    description: "SJVN's high-performing commercial wind farm situated along the high-wind ridgelines of Maharashtra."
  },
  {
    id: 'SADLA_WIND',
    name: 'Sadla Wind Power Project',
    hindiName: 'सादला 50 MW पवन ऊर्जा संयंत्र',
    type: 'WIND',
    capacity: '50 MW',
    capacityNum: 50,
    config: '25 × 2.0 MW Suzlon Wind Turbine Generators',
    location: 'Surendranagar, Gujarat',
    state: 'Gujarat',
    stateCode: 'GJ',
    basin: 'Saurashtra High-Wind Regimes',
    grid: 'GUVNL / WRPC Network',
    status: 'Operational',
    statusCategory: 'OPERATIONAL',
    statusColor: '#10b981',
    designEnergy: '115 MUs / year',
    beneficiaries: 'Gujarat Urja Vikas Nigam Ltd (GUVNL)',
    coords: { x: 93.0, y: 332.0 },
    tagOffset: { x: 14, y: -10 },
    color: '#10b981',
    icon: Wind,
    description: 'High-availability wind generating asset in Saurashtra feeding green energy into the Western Grid.'
  },

  // ── PUMPED STORAGE PROJECTS (PSP) & ENERGY STORAGE ──
  {
    id: 'MAHA_PSP',
    name: 'Maharashtra Pumped Storage Portfolio',
    hindiName: 'महाराष्ट्र 8,100 MW पंप्ड स्टोरेज प्रोजेक्ट्स',
    type: 'PSP',
    capacity: '8,100 MW',
    capacityNum: 8100,
    config: "5 PSPs: Kolmondapada 800, Sidgarh 1,500, Chornai 2,000, Baitarni 1,800, Jalvara 2,000 MW",
    location: 'Western Ghats, Maharashtra',
    state: 'Maharashtra',
    stateCode: 'MH',
    basin: 'Sahyadri Hydro-Peaking Corridors',
    grid: 'Western Regional Grid (WRPC)',
    status: 'In Development · MoU Signed',
    statusCategory: 'DEVELOPMENT',
    statusColor: '#8b5cf6',
    designEnergy: "",
    beneficiaries: 'Govt. of Maharashtra, National Grid Storage Mandate',
    coords: { x: 155.0, y: 450.0 },
    tagOffset: { x: 14, y: 10 },
    color: '#8b5cf6',
    icon: Zap,
    description: "MoU with the Govt. of Maharashtra (Water Resources Dept., Sept 2024) for five pumped storage projects; estimated investment ₹48,000 crore."
  },
  {
    id: 'DARZO_PSP',
    name: "Darzo Lui Pumped Storage Project",
    hindiName: "दार्ज़ो लुई 2,400 MW पंप्ड स्टोरेज परियोजना",
    type: 'PSP',
    capacity: "2,400 MW",
    capacityNum: 2400,
    config: 'Reversible Pump Turbine Units',
    location: "Mizoram",
    state: 'Mizoram',
    stateCode: 'MZ',
    basin: "Darzo Nallah (tributary of the Tuipui)",
    grid: 'NERPC Interconnection',
    status: "In Development · LoI from Govt. of Mizoram (Jul 2024)",
    statusCategory: 'DEVELOPMENT',
    statusColor: '#8b5cf6',
    designEnergy: "",
    beneficiaries: 'Govt. of Mizoram & North-Eastern Grid',
    coords: { x: 508.0, y: 335.0 },
    tagOffset: { x: -180, y: -10 },
    color: '#8b5cf6',
    icon: Zap,
    description: "Letter of Intent from the Govt. of Mizoram in July 2024; estimated cost ₹13,947.50 crore at April 2023 prices."
  },

  // ── REIA CENTRAL BIDDING MANDATE ──
  {
    id: 'REIA_ISTS',
    name: 'REIA Pan-India Bidding Mandate',
    hindiName: 'REIA राष्ट्रीय नवीकरणीय निविदा पोर्टफोलियो',
    type: 'REIA',
    capacity: '2,400+ MW',
    capacityNum: 2400,
    config: 'Solar · Wind · RTC Hybrid ISTS Tenders',
    location: 'Pan-India ISTS Sub-stations (RJ, GJ, MP, MH, AP, TN)',
    state: 'Pan-India (ISTS)',
    stateCode: 'ISTS',
    basin: 'National Clean Energy Footprint',
    grid: 'National Transmission Grid (ISTS)',
    status: 'MNRE Mandate · Active Tendering',
    statusCategory: 'OPERATIONAL',
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
  const { user } = useAuth();
  const canManageMasters = ROLE_GROUPS.MASTERS_WRITE.includes(user?.role);
  const [assets, setAssets] = useState(SJVN_ASSETS);
  const [selectedAsset, setSelectedAsset] = useState(SJVN_ASSETS[0]);
  const [activeFilter, setActiveFilter] = useState('ALL');
  const [activeStatusFilter, setActiveStatusFilter] = useState('ALL');
  const [activeStateFilter, setActiveStateFilter] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [hoveredAsset, setHoveredAsset] = useState(null);
  const [viewMode, setViewMode] = useState('NATIONAL'); // 'NATIONAL' | 'HP_ZOOM'
  const detailId = useId();

  // Dynamically synchronize assets with database master
  useEffect(() => {
    let active = true;
    fetch('/api/public/generation-assets')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (active && Array.isArray(data) && data.length > 0) {
          const mapped = data.map((d) => {
            const existing = SJVN_ASSETS.find((a) => a.id === d.id);
            const icon =
              d.type === 'HYDRO'
                ? Droplets
                : d.type === 'THERMAL'
                ? Factory
                : d.type === 'SOLAR'
                ? Sun
                : d.type === 'WIND'
                ? Wind
                : d.type === 'PSP'
                ? Zap
                : Layers;
            return {
              id: d.id,
              name: d.name,
              hindiName: d.hindi_name || d.name,
              type: d.type,
              capacity: d.capacity,
              capacityNum: Number(d.capacity_num) || parseFloat(String(d.capacity).replace(/[^0-9.]/g, '')) || 0,
              config: d.config || '',
              location: d.location || d.state,
              state: d.state,
              stateCode: d.state_code,
              basin: d.basin || '',
              grid: d.grid || 'National Grid',
              status: d.status || 'Operational',
              statusCategory: d.status_category || 'OPERATIONAL',
              statusColor: d.status_color || '#10b981',
              designEnergy: d.design_energy || '',
              beneficiaries: d.beneficiaries || '',
              coords: { x: Number(d.coords_x) || 200, y: Number(d.coords_y) || 300 },
              tagOffset: existing?.tagOffset || { x: 14, y: -10 },
              hpTagOffset: existing?.hpTagOffset || null,
              color: d.color || existing?.color || '#0284c7',
              icon: existing?.icon || icon,
              description: d.description || '',
            };
          });
          setAssets(mapped);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  // Distinct states for quick filter chips
  const stateSummary = useMemo(() => {
    const counts = {};
    assets.forEach(a => {
      const st = a.stateCode || a.state;
      counts[st] = (counts[st] || 0) + 1;
    });
    return counts;
  }, [assets]);

  const filteredAssets = useMemo(() => {
    return assets.filter((a) => {
      // Sector filter
      if (activeFilter === 'HYDRO' && a.type !== 'HYDRO') return false;
      if (activeFilter === 'THERMAL' && a.type !== 'THERMAL') return false;
      if (activeFilter === 'SOLAR' && a.type !== 'SOLAR') return false;
      if (activeFilter === 'WIND_PSP' && a.type !== 'WIND' && a.type !== 'PSP') return false;
      if (activeFilter === 'REIA' && a.type !== 'REIA') return false;

      // Status filter
      if (activeStatusFilter === 'OPERATIONAL' && a.statusCategory !== 'OPERATIONAL') return false;
      if (activeStatusFilter === 'UNDER_CONSTRUCTION' && a.statusCategory !== 'UNDER_CONSTRUCTION') return false;
      if (activeStatusFilter === 'DEVELOPMENT' && a.statusCategory !== 'DEVELOPMENT') return false;

      // State filter
      if (activeStateFilter !== 'ALL' && a.stateCode !== activeStateFilter && a.state !== activeStateFilter) return false;

      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const match = 
          a.name.toLowerCase().includes(q) ||
          a.hindiName.toLowerCase().includes(q) ||
          a.location.toLowerCase().includes(q) ||
          a.state.toLowerCase().includes(q) ||
          a.basin.toLowerCase().includes(q) ||
          a.type.toLowerCase().includes(q) ||
          a.capacity.toLowerCase().includes(q);
        if (!match) return false;
      }

      return true;
    });
  }, [assets, activeFilter, activeStatusFilter, activeStateFilter, searchQuery]);

  // Capacity, kept apart by stage: a plant running is not the same megawatt as
  // one under construction or only under an MoU. The REIA mandate is tendering
  // done for others, never SJVN's own capacity, so it is counted under its own tab only.
  const mwOf = (list, stage) => list
    .filter((a) => a.type !== 'REIA' && (!stage || a.statusCategory === stage))
    .reduce((acc, curr) => acc + curr.capacityNum, 0);
  const visibleOperating = useMemo(() => mwOf(filteredAssets, 'OPERATIONAL'), [filteredAssets]);
  const visiblePipeline = useMemo(() => mwOf(filteredAssets) - visibleOperating, [filteredAssets, visibleOperating]);
  const sectorLabel = useMemo(() => {
    const fmtMw = (n) => Math.round(n).toLocaleString('en-IN');
    const of = (types) => assets.filter((a) => types.includes(a.type));
    return (types) => {
      const list = of(types);
      return { sites: list.length, operating: fmtMw(mwOf(list, 'OPERATIONAL')) };
    };
  }, [assets]);
  const fleetSites = assets.filter((a) => a.type !== 'REIA').length;

  // Auto-synchronize selected asset when filter or search changes
  useEffect(() => {
    if (filteredAssets.length > 0 && !filteredAssets.some((a) => a.id === selectedAsset?.id)) {
      setSelectedAsset(filteredAssets[0]);
    }
  }, [filteredAssets, selectedAsset]);

  const handleSectorClick = (filter) => {
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
        {/* Main Sector Filters */}
        <div className="map-filters" role="tablist" aria-label="Filter generation assets by fuel sector">
          <button
            type="button"
            role="tab"
            aria-selected={activeFilter === 'ALL'}
            className={`map-filter-btn ${activeFilter === 'ALL' ? 'active' : ''}`}
            onClick={() => handleSectorClick('ALL')}
          >
            <Layers size={14} />
            <span>{lang === 'hi' ? `सभी ${fleetSites} परियोजनाएं` : `All Projects (${fleetSites} Sites)`}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeFilter === 'HYDRO'}
            className={`map-filter-btn hydro ${activeFilter === 'HYDRO' ? 'active' : ''}`}
            onClick={() => handleSectorClick('HYDRO')}
          >
            <Droplets size={14} />
            <span>{lang === 'hi' ? `जलविद्युत (${sectorLabel(['HYDRO']).operating} MW चालू)` : `Hydro (${sectorLabel(['HYDRO']).operating} MW operating)`}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeFilter === 'THERMAL'}
            className={`map-filter-btn thermal ${activeFilter === 'THERMAL' ? 'active' : ''}`}
            onClick={() => handleSectorClick('THERMAL')}
          >
            <Factory size={14} />
            <span>{lang === 'hi' ? `थर्मल (${sectorLabel(['THERMAL']).operating} MW चालू)` : `Thermal (${sectorLabel(['THERMAL']).operating} MW operating)`}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeFilter === 'SOLAR'}
            className={`map-filter-btn solar ${activeFilter === 'SOLAR' ? 'active' : ''}`}
            onClick={() => handleSectorClick('SOLAR')}
          >
            <Sun size={14} />
            <span>{lang === 'hi' ? `सौर ऊर्जा (${sectorLabel(['SOLAR']).operating} MW चालू)` : `Solar (${sectorLabel(['SOLAR']).operating} MW operating)`}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeFilter === 'WIND_PSP'}
            className={`map-filter-btn reia ${activeFilter === 'WIND_PSP' ? 'active' : ''}`}
            onClick={() => handleSectorClick('WIND_PSP')}
          >
            <Wind size={14} />
            <span>{lang === 'hi' ? `पवन व पंप्ड स्टोरेज (${sectorLabel(['WIND', 'PSP']).operating} MW चालू)` : `Wind & PSP (${sectorLabel(['WIND', 'PSP']).operating} MW operating)`}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeFilter === 'REIA'}
            className={`map-filter-btn ${activeFilter === 'REIA' ? 'active' : ''}`}
            onClick={() => handleSectorClick('REIA')}
          >
            <Zap size={14} />
            <span>{lang === 'hi' ? 'REIA निविदा (2,400+ MW)' : 'REIA Mandate'}</span>
          </button>
        </div>

        {/* Total Visible Capacity Counter & Super Admin Shortcut */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {canManageMasters && (
            <Link
              to="/masters?tab=generation_assets"
              className="btn btn-sm btn-primary"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                fontSize: '12px',
                padding: '5px 12px',
                borderRadius: '6px',
                textDecoration: 'none',
                background: 'linear-gradient(135deg, #0284c7, #0369a1)',
                border: '1px solid #38bdf8',
                color: '#ffffff',
                fontWeight: 600,
                boxShadow: '0 2px 4px rgba(0,0,0,0.2)'
              }}
              title="Add or Edit SJVN Generation Assets in Master Data"
            >
              ⚙️ {lang === 'hi' ? 'मास्टर में प्लांट जोड़ें / प्रबंधित करें' : 'Manage Plants Master'}
            </Link>
          )}
          <div className="map-capacity-counter">
            {activeFilter === 'REIA' ? (
              <>
                <span className="counter-label">{lang === 'hi' ? 'REIA के रूप में निविदा:' : 'Tendered as REIA:'}</span>
                <strong className="counter-value">{filteredAssets.filter((a) => a.type === 'REIA').map((a) => a.capacity).join(', ') || '—'}</strong>
              </>
            ) : (
              <>
                <span className="counter-label">{lang === 'hi' ? 'चालू क्षमता:' : 'Operating:'}</span>
                <strong className="counter-value">{Math.round(visibleOperating).toLocaleString('en-IN')} MW</strong>
              </>
            )}
            {activeFilter !== 'REIA' && visiblePipeline > 0 && (
              <span className="counter-label" title={lang === 'hi' ? 'निर्माणाधीन एवं विकासाधीन परियोजनाएं (MoU / LoI सहित)' : 'Under construction and in development, MoU / LoI stage included'}>
                {lang === 'hi' ? ` · पाइपलाइन ${Math.round(visiblePipeline).toLocaleString('en-IN')} MW` : ` · pipeline ${Math.round(visiblePipeline).toLocaleString('en-IN')} MW`}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Quick Search & Sub-Filter Bar */}
      <div className="map-sub-toolbar" style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '10px',
        padding: '10px 14px',
        background: 'var(--surface, #1e293b)',
        borderRadius: '8px',
        marginBottom: '14px',
        border: '1px solid var(--border, #334155)'
      }}>
        {/* Search input */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: '1 1 240px', minWidth: '220px' }}>
          <Search size={15} style={{ color: 'var(--text-muted, #94a3b8)' }} />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={lang === 'hi' ? 'परियोजना, राज्य, या नदी खोजें (उदा. ओंकारेश्वर, बिहार, असम, पवन)...' : 'Search projects, states, rivers (e.g. Omkareshwar, Assam, Buxar)...'}
            style={{
              width: '100%',
              padding: '6px 10px',
              fontSize: '13px',
              borderRadius: '6px',
              border: '1px solid var(--border, #475569)',
              background: 'var(--surface-sunken, #0f172a)',
              color: 'var(--text, #f8fafc)',
              outline: 'none'
            }}
          />
          {searchQuery && (
            <button 
              type="button" 
              onClick={() => setSearchQuery('')}
              style={{ background: 'transparent', border: 'none', color: 'var(--text-muted, #94a3b8)', cursor: 'pointer', fontSize: '12px' }}
            >
              ✕
            </button>
          )}
        </div>

        {/* Status Filter Pills */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted, #94a3b8)' }}>
            {lang === 'hi' ? 'स्थिति:' : 'Status:'}
          </span>
          {[
            { id: 'ALL', label: lang === 'hi' ? 'सभी' : 'All' },
            { id: 'OPERATIONAL', label: lang === 'hi' ? 'चालू (Operational)' : 'Operational', color: '#10b981' },
            { id: 'UNDER_CONSTRUCTION', label: lang === 'hi' ? 'निर्माणाधीन' : 'Under Construction', color: '#f59e0b' },
            { id: 'DEVELOPMENT', label: lang === 'hi' ? 'विकासधीन' : 'In Pipeline', color: '#38bdf8' }
          ].map(st => (
            <button
              key={st.id}
              type="button"
              onClick={() => setActiveStatusFilter(st.id)}
              style={{
                fontSize: '11.5px',
                padding: '3px 8px',
                borderRadius: '12px',
                border: activeStatusFilter === st.id ? '1px solid #38bdf8' : '1px solid rgba(255,255,255,0.1)',
                background: activeStatusFilter === st.id ? 'rgba(56, 189, 248, 0.18)' : 'transparent',
                color: activeStatusFilter === st.id ? '#38bdf8' : 'var(--text-muted, #cbd5e1)',
                cursor: 'pointer',
                fontWeight: activeStatusFilter === st.id ? 600 : 400
              }}
            >
              {st.label}
            </button>
          ))}
        </div>

        {/* State Quick Chips */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '5px', flexWrap: 'wrap', width: '100%', paddingTop: '4px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
          <span style={{ fontSize: '11px', color: 'var(--text-muted, #94a3b8)' }}>
            {lang === 'hi' ? 'राज्य चुनें:' : 'Filter State:'}
          </span>
          <button
            type="button"
            onClick={() => setActiveStateFilter('ALL')}
            style={{
              fontSize: '11px',
              padding: '2px 7px',
              borderRadius: '4px',
              border: activeStateFilter === 'ALL' ? '1px solid #38bdf8' : '1px solid transparent',
              background: activeStateFilter === 'ALL' ? '#0369a1' : 'rgba(255,255,255,0.05)',
              color: '#ffffff',
              cursor: 'pointer'
            }}
          >
            {lang === 'hi' ? `सभी राज्य (${assets.length})` : `All States (${assets.length})`}
          </button>
          {['HP', 'BR', 'GJ', 'UP', 'RJ', 'MH', 'MP', 'AS', 'UK', 'MZ', 'NP'].map(code => (
            <button
              key={code}
              type="button"
              onClick={() => setActiveStateFilter(activeStateFilter === code ? 'ALL' : code)}
              style={{
                fontSize: '11px',
                padding: '2px 7px',
                borderRadius: '4px',
                border: activeStateFilter === code ? '1px solid #38bdf8' : '1px solid rgba(255,255,255,0.08)',
                background: activeStateFilter === code ? 'rgba(56, 189, 248, 0.2)' : 'rgba(255,255,255,0.04)',
                color: activeStateFilter === code ? '#38bdf8' : 'var(--text-muted, #94a3b8)',
                cursor: 'pointer',
                fontWeight: activeStateFilter === code ? 600 : 400
              }}
            >
              {code} ({stateSummary[code] || 0})
            </button>
          ))}
        </div>
      </div>

      {/* Main Map + Details Layout */}
      <div className="map-main-stage">
        {/* Vector SVG India Map Canvas */}
        <div className="map-canvas-card">
          {/* Top Controls Overlay */}
          {!isHpZoom ? (
            <div className="map-legend-overlay" style={{ minWidth: '175px' }}>
              <div className="legend-item" style={{ whiteSpace: 'nowrap' }}>
                <span className="legend-dot hydro" /> <span>Hydro Baseload</span>
              </div>
              <div className="legend-item" style={{ whiteSpace: 'nowrap' }}>
                <span className="legend-dot thermal" /> <span>Supercritical Thermal</span>
              </div>
              <div className="legend-item" style={{ whiteSpace: 'nowrap' }}>
                <span className="legend-dot solar" /> <span>Solar PV &amp; Floating</span>
              </div>
              <div className="legend-item" style={{ whiteSpace: 'nowrap' }}>
                <span className="legend-dot wind" /> <span>Wind Energy</span>
              </div>
              <div className="legend-item" style={{ whiteSpace: 'nowrap' }}>
                <span className="legend-dot" style={{ background: '#8b5cf6', boxShadow: '0 0 6px #8b5cf6' }} /> <span>Pumped Storage (PSP)</span>
              </div>
            </div>
          ) : (
            <div className="map-legend-overlay hp-badge">
              <div className="legend-item">
                <span className="legend-dot hydro" />
                <span>{lang === 'hi' ? 'सतलुज एवं ब्यास बेसिन जलविद्युत श्रृंखला' : 'Satluj & Beas Hydro Cascade (7 Plants)'}</span>
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
                />
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
                <path className="grid-corridor-line" d="M223,151 L195,145 L133,222 L95,248 L87,300 L60,307 L93,332 L105,344" />
                <path className="grid-corridor-line" d="M133,222 L246,266 L265,264 L333,280 L372,292 L388,294" />
                <path className="grid-corridor-line" d="M223,151 L207,327 L182,358 L145,432 L155,450 L230,500" />
                <path className="grid-corridor-line" d="M207,327 L333,280 L372,292 L456,272 L508,335" />
                <path className="grid-corridor-line" d="M395,228 L333,280" strokeDasharray="3 3" />

                {/* Regional RPC Labels */}
                <text x="210" y="105" className="map-region-label">NRPC (Northern Grid)</text>
                <text x="130" y="380" className="map-region-label">WRPC (Western Grid)</text>
                <text x="390" y="275" className="map-region-label">ERPC (Eastern Grid)</text>
                <text x="225" y="520" className="map-region-label">SRPC (Southern Grid)</text>
                <text x="495" y="240" className="map-region-label">NERPC (North-Eastern)</text>
                <text x="390" y="215" className="map-region-label subtle" style={{ fill: '#38bdf8' }}>Cross-Border (Nepal/SAPDC)</text>
                <text x="235" y="610" className="map-region-label subtle">National ISTS Green Energy Corridors</text>
              </g>
            )}

            {/* Satluj River Basin Schematic Flow Line (in HP Zoom mode) */}
            {isHpZoom && (
              <g className="hp-river-basin">
                <path 
                  className="river-satluj-path" 
                  d="M232,146 Q226,149 220,152 T213,155 T207,157 T195,145" 
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

              // In HP Zoom mode, show HP and adjacent basin assets
              if (isHpZoom && !['NJHPS', 'RHPS', 'LUHRI', 'LUHRI_2', 'SUNNI', 'DHAULASIDH', 'JANGI', 'NAITWAR'].includes(asset.id)) {
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
                  {/* Transparent hit target for mouse and touch */}
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
                            width="14.5"
                            height="2.8"
                            y="-1.3"
                          />
                          <text x="0.5" y="-0.2" className="map-pin-tag-text hp-title">
                            {asset.name}
                          </text>
                          <text x="0.5" y="0.9" className="map-pin-tag-text hp-sub">
                            {asset.capacity} · {asset.status}
                          </text>
                        </>
                      ) : (
                        <>
                          <rect
                            rx="4"
                            className="map-pin-tag-bg"
                            width={asset.name.length * 7.2 + 46}
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
                <span style={{ 
                  fontSize: '11px', 
                  padding: '2px 7px', 
                  borderRadius: '10px', 
                  background: 'rgba(255,255,255,0.08)',
                  color: 'var(--text-muted, #94a3b8)',
                  marginLeft: 'auto'
                }}>
                  {selectedAsset.state}
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
                <span className="m-label">{lang === 'hi' ? 'स्थापित क्षमता' : 'Project Capacity'}</span>
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
              {['NJHPS', 'RHPS', 'LUHRI', 'LUHRI_2', 'SUNNI', 'DHAULASIDH', 'JANGI', 'NAITWAR'].includes(selectedAsset.id) && !isHpZoom && (
                <button 
                  type="button" 
                  className="btn btn-secondary detail-zoom-btn"
                  onClick={() => setViewMode('HP_ZOOM')}
                >
                  <Maximize2 size={14} />
                  <span>{lang === 'hi' ? 'हिमाचल बेसिन ज़ूम' : 'Zoom HP Basin'}</span>
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

      {/* Interactive Project Directory Drawer / Gallery */}
      <div style={{ marginTop: '20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
          <h4 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text, #f8fafc)', margin: 0, display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Building2 size={15} style={{ color: '#38bdf8' }} />
            <span>{lang === 'hi' ? `SJVN राष्ट्रीय परियोजना सूची (${assets.length} परियोजनाएं)` : `SJVN National Project Portfolio (${assets.length} Assets)`}</span>
          </h4>
          <span style={{ fontSize: '12px', color: 'var(--text-muted, #94a3b8)' }}>
            {filteredAssets.length} {lang === 'hi' ? 'परियोजनाएं प्रदर्शित' : 'projects displayed'}
          </span>
        </div>

        <div 
          role="region"
          aria-label={lang === 'hi' ? 'SJVN परियोजना निर्देशिका' : 'SJVN Project Portfolio Gallery'}
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
            gap: '12px',
            padding: '12px',
            borderRadius: '10px',
            background: 'var(--surface-sunken, #0b1120)',
            border: '1px solid var(--border, #1e293b)'
          }}
        >
          {filteredAssets.map(asset => {
            const isSelected = selectedAsset?.id === asset.id;
            const Icon = asset.icon;
            return (
              <div
                key={asset.id}
                role="button"
                tabIndex={0}
                aria-pressed={isSelected}
                aria-label={`${asset.name}, ${asset.capacity}, ${asset.state}`}
                onClick={() => setSelectedAsset(asset)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setSelectedAsset(asset);
                  }
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  padding: '12px 14px',
                  borderRadius: '8px',
                  background: isSelected ? 'rgba(56, 189, 248, 0.16)' : 'var(--surface, #1e293b)',
                  border: isSelected ? '1px solid #38bdf8' : '1px solid rgba(255, 255, 255, 0.07)',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  boxShadow: isSelected ? '0 0 14px rgba(56, 189, 248, 0.18)' : 'none'
                }}
              >
                <div style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: '6px',
                  background: `${asset.color}20`,
                  color: asset.color,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0
                }}>
                  <Icon size={16} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '4px' }}>
                    <span style={{ fontSize: '12.5px', fontWeight: 600, color: isSelected ? '#38bdf8' : 'var(--text, #f1f5f9)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {asset.name}
                    </span>
                    <span style={{ fontSize: '11px', fontWeight: 700, color: asset.color, flexShrink: 0 }}>
                      {asset.capacity}
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-muted, #94a3b8)', marginTop: '2px' }}>
                    <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{asset.state}</span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '3px', color: asset.statusColor, flexShrink: 0 }}>
                      <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: asset.statusColor }} />
                      {asset.statusCategory === 'OPERATIONAL' ? 'Live' : (asset.statusCategory === 'UNDER_CONSTRUCTION' ? 'Under Const.' : 'Pipeline')}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
