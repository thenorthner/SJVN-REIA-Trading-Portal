import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Search, X, ArrowRight, ExternalLink, Sun, Zap, Droplets, Factory, 
  ShieldCheck, FileText, Lock, Users, HelpCircle, Map, Target, 
  PhoneCall, CornerDownLeft, Eye, Cookie, BookOpen, ScrollText, 
  FileCheck, Layers, Sparkles
} from 'lucide-react';
import { useGigw } from '../gigw/GigwContext.jsx';
import { openVisionModal } from './VisionModal.jsx';

export const SEARCH_OPEN_EVENT = 'sjvn:open-search';

export function openPortalSearch() {
  window.dispatchEvent(new CustomEvent(SEARCH_OPEN_EVENT));
}

// Category filter tabs definition
export const SEARCH_CATEGORIES = [
  { id: 'all', label: { en: 'All Items', hi: 'सभी परिणाम' } },
  { id: 'desk', label: { en: 'Desks & Portals', hi: 'वाणिज्यिक डेस्क' } },
  { id: 'regulation', label: { en: 'CERC Regulations', hi: 'सीईआरसी विनियम' } },
  { id: 'tender', label: { en: 'REIA Tenders', hi: 'आरईआईए निविदाएं' } },
  { id: 'form', label: { en: 'Stakeholder Forms', hi: 'हितधारक प्रपत्र' } },
  { id: 'glossary', label: { en: 'Market Glossary', hi: 'ऊर्जा शब्दावली' } },
  { id: 'policy', label: { en: 'Statutory Policies', hi: 'संवैधानिक नीतियां' } },
];

// Comprehensive sovereign portal searchable index
export const SEARCH_INDEX = [
  // Enterprise Gateways & Commercial Desks
  {
    id: 'desk-reia',
    category: 'desk',
    catLabel: { en: 'Enterprise Desk', hi: 'विभागीय प्रवेश' },
    title: { en: 'REIA Commercial Portal (Renewables)', hi: 'आरईआईए वाणिज्यिक पोर्टल (नवीकरणीय)' },
    desc: { 
      en: 'Utility-scale ISTS Solar/Wind procurement, 25-year PPAs/PSAs, tariff billing & deviation settlements.',
      hi: 'ISTS सौर/पवन ऊर्जा खरीद, 25-वर्षीय पीपीए/पीएसए, टैरिफ बिलिंग एवं विचलन निपटान।'
    },
    path: '/login?desk=REIA',
    action: 'navigate',
    icon: Sun,
    keywords: ['reia', 'solar', 'wind', 'renewable', 'ppa', 'psa', 'tender', 'bidding', 'mnre', 'seller', 'buyer', 'clean energy']
  },
  {
    id: 'desk-trading',
    category: 'desk',
    catLabel: { en: 'Enterprise Desk', hi: 'विभागीय प्रवेश' },
    title: { en: 'Power Trading Hub (IEX · PXIL · HPX)', hi: 'विद्युत व्यापार केंद्र (आईईएक्स · पीएक्सआईएल · एचपीएक्स)' },
    desc: { 
      en: 'Synchronized power market operations across Day-Ahead (DAM), Real-Time (RTM), GDAM & bilateral trades.',
      hi: 'डे-अहेड (DAM), रियल-टाइम (RTM), GDAM एवं द्विपक्षीय अनुबंधों में समन्वित ऊर्जा व्यापार।'
    },
    path: '/login?desk=TRADING',
    action: 'navigate',
    icon: Zap,
    keywords: ['trading', 'iex', 'pxil', 'hpx', 'dam', 'rtm', 'gdam', 'market', 'exchange', 'bidding', 'cerc', 'power', 'trader', 'open access']
  },
  {
    id: 'desk-hydro',
    category: 'desk',
    catLabel: { en: 'Enterprise Desk', hi: 'विभागीय प्रवेश' },
    title: { en: 'Hydro Commercial Desk (Nathpa Jhakri & Rampur)', hi: 'जल विद्युत वाणिज्यिक डेस्क (नाथपा झाकड़ी एवं रामपुर)' },
    desc: { 
      en: 'Monthly REA energy accounting, CERC capacity & energy billing, PAF, and beneficiary state allocation.',
      hi: 'मासिक आरईए ऊर्जा लेखांकन, सीईआरसी क्षमता एवं ऊर्जा बिलिंग, पीएएफ तथा लाभार्थी राज्य आवंटन।'
    },
    path: '/login?desk=HYDRO',
    action: 'navigate',
    icon: Droplets,
    keywords: ['hydro', 'nathpa jhakri', 'rampur', 'rea', 'billing', 'cerc', 'settlement', 'paf', 'commercial', 'discom', 'capacity charge']
  },
  {
    id: 'desk-thermal',
    category: 'desk',
    catLabel: { en: 'Enterprise Desk', hi: 'विभागीय प्रवेश' },
    title: { en: 'Thermal Operations Desk (Buxar 1,320 MW)', hi: 'ताप विद्युत संचालन डेस्क (बक्सर 1,320 मेगावाट)' },
    desc: { 
      en: 'Supercritical baseload plant billing, coal-to-busbar Energy Charge Rate (ECR), and ERPC grid scheduling.',
      hi: 'सुपरक्रिटिकल ताप विद्युत बिलिंग, कोल-टू-बसबार ऊर्जा प्रभार दर (ECR) एवं ईआरपीसी ग्रिड शेड्यूलिंग।'
    },
    path: '/login?desk=THERMAL',
    action: 'navigate',
    icon: Factory,
    keywords: ['thermal', 'buxar', 'coal', 'ecr', 'energy charge', 'erpc', 'supercritical', 'bihar', 'chausa', 'generation']
  },
  {
    id: 'persona-seller',
    category: 'desk',
    catLabel: { en: 'Access Portal', hi: 'प्रवेश द्वार' },
    title: { en: 'Power Producer / Seller Portal', hi: 'विद्युत उत्पादक / विक्रेता पोर्टल' },
    desc: { 
      en: 'Direct submission of monthly generation invoices, JMR telemetry upload, and escrow payment tracking.',
      hi: 'मासिक विद्युत उत्पादन चालान जमा, जेएमआर टेलीमेट्री अपलोड एवं एस्क्रो भुगतान ट्रैकिंग।'
    },
    path: '/login?desk=REIA',
    action: 'navigate',
    icon: Sun,
    keywords: ['seller', 'generator', 'ipp', 'solar developer', 'invoice upload', 'jmr', 'telemetry', 'escrow', 'payment']
  },
  {
    id: 'persona-buyer',
    category: 'desk',
    catLabel: { en: 'Access Portal', hi: 'प्रवेश द्वार' },
    title: { en: 'State Discom / Buyer Portal', hi: 'राज्य डिस्कॉम / क्रेता पोर्टल' },
    desc: { 
      en: 'Beneficiary allocation inspection, monthly PSA power invoice download, rebate verification & letter of credit.',
      hi: 'लाभार्थी कोटा निरीक्षण, मासिक पीएसए ऊर्जा चालान डाउनलोड, छूट सत्यापन एवं साख पत्र (LC)।'
    },
    path: '/login?desk=REIA',
    action: 'navigate',
    icon: Users,
    keywords: ['buyer', 'discom', 'state utility', 'psa', 'rebate', 'letter of credit', 'lc', 'payment security', 'grid']
  },

  // CERC Regulations (Statutory Grid, Market & Tariff Rules)
  {
    id: 'reg-iegc',
    category: 'regulation',
    catLabel: { en: 'CERC Regulation', hi: 'सीईआरसी विनियम' },
    title: { en: 'CERC Indian Electricity Grid Code (IEGC 2023)', hi: 'सीईआरसी भारतीय विद्युत ग्रिड संहिता (IEGC 2023)' },
    desc: { 
      en: 'Statutory grid operations, 49.90–50.05 Hz frequency band, unit commitment, spinning reserves & dynamic ramp rates.',
      hi: 'वैधानिक ग्रिड संचालन, 49.90–50.05 Hz आवृत्ति बैंड, यूनिट प्रतिबद्धता, कताई भंडार एवं गतिशील रैंप दरें।'
    },
    path: '/trading',
    action: 'navigate',
    icon: BookOpen,
    keywords: ['iegc', 'grid code', 'frequency', 'cerc', 'operating reserves', 'ramp rate', 'regulation', 'grid', 'posoco', 'grid-india']
  },
  {
    id: 'reg-dsm',
    category: 'regulation',
    catLabel: { en: 'CERC Regulation', hi: 'सीईआरसी विनियम' },
    title: { en: 'CERC Deviation Settlement Mechanism (DSM) Regulations', hi: 'सीईआरसी विचलन निपटान तंत्र (DSM) विनियम' },
    desc: { 
      en: 'Commercial deviation pricing, real-time frequency-linked surcharges, volume limits and over/under-injection settlement.',
      hi: 'व्यावसायिक विचलन मूल्य निर्धारण, आवृत्ति-संबद्ध अधिभार, मात्रा सीमा एवं अधि/न्यून-इंजेक्शन निपटान।'
    },
    path: '/trading',
    action: 'navigate',
    icon: BookOpen,
    keywords: ['dsm', 'deviation', 'settlement', 'frequency', 'penalty', 'over-injection', 'under-injection', 'cerc', 'deviation settlement']
  },
  {
    id: 'reg-gna',
    category: 'regulation',
    catLabel: { en: 'CERC Regulation', hi: 'सीईआरसी विनियम' },
    title: { en: 'CERC General Network Access (GNA) Regulations', hi: 'सीईआरसी सामान्य नेटवर्क पहुंच (GNA) विनियम' },
    desc: { 
      en: 'ISTS open access framework, GNA/T-GNA transmission allocations, national standing clearances, and CTUIL corridor access.',
      hi: 'ISTS खुली पहुंच ढांचा, GNA/T-GNA पारेषण आवंटन, राष्ट्रीय स्थायी मंजूरी एवं CTUIL कॉरिडोर पहुंच।'
    },
    path: '/reia',
    action: 'navigate',
    icon: BookOpen,
    keywords: ['gna', 't-gna', 'general network access', 'transmission', 'ists', 'ctuil', 'access', 'standing clearance', 'cerc']
  },
  {
    id: 'reg-pmr',
    category: 'regulation',
    catLabel: { en: 'CERC Regulation', hi: 'सीईआरसी विनियम' },
    title: { en: 'CERC Power Market Regulations (PMR) 2021', hi: 'सीईआरसी विद्युत बाज़ार विनियम (PMR) 2021' },
    desc: { 
      en: 'Exchange collective trading rules, bilateral OTC contracts, market coupling provisions, and power trading fee caps.',
      hi: 'एक्सचेंज सामूहिक व्यापार नियम, द्विपक्षीय ओटीसी अनुबंध, बाज़ार युग्मन प्रावधान एवं ट्रेडिंग शुल्क सीमा।'
    },
    path: '/trading',
    action: 'navigate',
    icon: BookOpen,
    keywords: ['pmr', 'power market', 'market regulations', 'coupling', 'exchange', 'collective', 'bilateral', 'cerc', 'iex', 'pxil', 'hpx']
  },
  {
    id: 'reg-tariff',
    category: 'regulation',
    catLabel: { en: 'CERC Regulation', hi: 'सीईआरसी विनियम' },
    title: { en: 'CERC Tariff Regulations (Generation & Commercials)', hi: 'सीईआरसी टैरिफ विनियम (उत्पादन एवं वाणिज्यिक)' },
    desc: { 
      en: 'Normative PAFM calculations, Hydro & Thermal multi-year tariff determination, auxiliary consumption, and ROE caps.',
      hi: 'मानक PAFM गणना, हाइड्रो एवं थर्मल बहु-वर्षीय टैरिफ निर्धारण, सहायक खपत एवं आरओई सीमाएं।'
    },
    path: '/hydro-thermal',
    action: 'navigate',
    icon: BookOpen,
    keywords: ['tariff', 'terms and conditions', 'roe', 'return on equity', 'auxiliary', 'pafm', 'depreciation', 'cerc', 'hydro tariff', 'thermal tariff']
  },

  // REIA Tenders & Bidding Documents
  {
    id: 'tender-solar-1200',
    category: 'tender',
    catLabel: { en: 'REIA Tender', hi: 'आरईआईए निविदा' },
    title: { en: 'Tender: SJVN/REIA/2026/SOLAR-1200MW (ISTS Solar)', hi: 'निविदा: SJVN/REIA/2026/SOLAR-1200MW (ISTS सौर ऊर्जा)' },
    desc: { 
      en: 'Selection of Solar Power Developers for 1,200 MW ISTS-connected Solar PV Power Projects with 25-Year PPA/PSA.',
      hi: '25-वर्षीय पीपीए/पीएसए के साथ 1,200 मेगावाट आईएसटीएस-संबद्ध सौर पीवी परियोजनाओं हेतु डेवलपर्स का चयन।'
    },
    path: '/reia',
    action: 'navigate',
    icon: ScrollText,
    keywords: ['tender', 'solar', '1200mw', '1200 mw', 'sjvn/reia/2026/solar-1200mw', 'ists', 'bidding', 'rfs', 'reia', 'developer', 'auction']
  },
  {
    id: 'tender-wind-600',
    category: 'tender',
    catLabel: { en: 'REIA Tender', hi: 'आरईआईए निविदा' },
    title: { en: 'Tender: SJVN/REIA/2026/WIND-600MW (ISTS Wind)', hi: 'निविदा: SJVN/REIA/2026/WIND-600MW (ISTS पवन ऊर्जा)' },
    desc: { 
      en: 'Tariff-based competitive bidding for setting up 600 MW Inter-State connected Wind Power Projects pan-India.',
      hi: 'अखिल भारतीय स्तर पर 600 मेगावाट अंतर-राज्यीय पवन ऊर्जा परियोजनाओं की स्थापना हेतु प्रतिस्पर्धी बोली।'
    },
    path: '/reia',
    action: 'navigate',
    icon: ScrollText,
    keywords: ['tender', 'wind', '600mw', '600 mw', 'sjvn/reia/2026/wind-600mw', 'wind energy', 'bidding', 'reia', 'ists']
  },
  {
    id: 'tender-hybrid-1000',
    category: 'tender',
    catLabel: { en: 'REIA Tender', hi: 'आरईआईए निविदा' },
    title: { en: 'Tender: SJVN/REIA/2026/HYBRID-1000MW (Tranche-IV)', hi: 'निविदा: SJVN/REIA/2026/HYBRID-1000MW (ट्रेंच-IV हाइब्रिड)' },
    desc: { 
      en: '1,000 MW Wind-Solar Hybrid Tranche-IV procurement with minimum 33% resource mix commitment and green corridor access.',
      hi: '1,000 मेगावाट पवन-सौर हाइब्रिड ट्रेंच-IV खरीद, न्यूनतम 33% संसाधन मिश्रण एवं ग्रीन कॉरिडोर पहुंच।'
    },
    path: '/reia',
    action: 'navigate',
    icon: ScrollText,
    keywords: ['tender', 'hybrid', '1000mw', '1000 mw', 'sjvn/reia/2026/hybrid-1000mw', 'wind solar hybrid', 'tranche', 'reia', 'bidding']
  },
  {
    id: 'tender-fdre-500',
    category: 'tender',
    catLabel: { en: 'REIA Tender', hi: 'आरईआईए निविदा' },
    title: { en: 'Tender: SJVN/REIA/2026/FDRE-500MW (Firm & Dispatchable RE)', hi: 'निविदा: SJVN/REIA/2026/FDRE-500MW (नियमित एवं डिस्पैचेबल आरई)' },
    desc: { 
      en: '500 MW Firm and Dispatchable Renewable Energy (FDRE) from ISTS-connected projects with Battery/Pumped Storage backup.',
      hi: 'बैटरी/पम्प्ड स्टोरेज बैकअप के साथ 500 मेगावाट दृढ़ एवं प्रेषण-योग्य नवीकरणीय ऊर्जा (FDRE) निविदा।'
    },
    path: '/reia',
    action: 'navigate',
    icon: ScrollText,
    keywords: ['tender', 'fdre', '500mw', '500 mw', 'sjvn/reia/2026/fdre-500mw', 'firm dispatchable', 'storage', 'bess', 'battery', 'round the clock', 'rtc']
  },

  // Stakeholder Forms & Compliance Slips
  {
    id: 'form-cerc-iv',
    category: 'form',
    catLabel: { en: 'Regulatory Form', hi: 'नियामक प्रपत्र' },
    title: { en: 'Form: CERC Form-IV (Monthly Trader Volume Return)', hi: 'प्रपत्र: सीईआरसी फॉर्म-IV (मासिक ट्रेडर वॉल्यूम विवरणी)' },
    desc: { 
      en: 'Statutory monthly filing format for Day-Ahead, Term-Ahead, Real-Time, and Bilateral volumes & weighted average price.',
      hi: 'डे-अहेड, टर्म-अहेड, रियल-टाइम एवं द्विपक्षीय वॉल्यूम तथा भारित औसत मूल्य हेतु मासिक वैधानिक फाइलिंग।'
    },
    path: '/trading',
    action: 'navigate',
    icon: FileCheck,
    keywords: ['form-iv', 'form 4', 'form iv', 'cerc form iv', 'statutory return', 'trader return', 'volume', 'weighted average price', 'reporting']
  },
  {
    id: 'form-cerc-v',
    category: 'form',
    catLabel: { en: 'Regulatory Form', hi: 'नियामक प्रपत्र' },
    title: { en: 'Form: CERC Form-V (Annual Trading Compliance & Net Worth)', hi: 'प्रपत्र: सीईआरसी फॉर्म-V (वार्षिक ट्रेडिंग अनुपालन एवं निवल मूल्य)' },
    desc: { 
      en: 'Category-I power trading licensee annual balance sheet verification, capital adequacy, and performance audit slip.',
      hi: 'श्रेणी-I विद्युत व्यापार लाइसेंसधारी का वार्षिक बैलेंस शीट सत्यापन, पूंजी पर्याप्तता एवं प्रदर्शन ऑडिट प्रपत्र।'
    },
    path: '/trading',
    action: 'navigate',
    icon: FileCheck,
    keywords: ['form-v', 'form 5', 'form v', 'cerc form v', 'annual compliance', 'category-1', 'net worth', 'capital adequacy', 'trader audit']
  },
  {
    id: 'form-rea-verify',
    category: 'form',
    catLabel: { en: 'Operational Form', hi: 'परिचालन प्रपत्र' },
    title: { en: 'Form: REA Verification Sheet & Discom Energy Slip', hi: 'प्रपत्र: आरईए सत्यापन पत्रक एवं डिस्कॉम ऊर्जा पर्ची' },
    desc: { 
      en: 'Monthly Regional Energy Account (REA) reconciliation certificate for State Discoms and Open Access bilateral approvals.',
      hi: 'राज्य डिस्कॉम एवं ओपन एक्सेस द्विपक्षीय अनुमोदनों के लिए मासिक क्षेत्रीय ऊर्जा लेखा (REA) समाधान प्रमाण पत्र।'
    },
    path: '/hydro-thermal',
    action: 'navigate',
    icon: FileCheck,
    keywords: ['rea verification', 'rea slip', 'regional energy account', 'discom noc', 'standing clearance', 'reconciliation', 'energy slip', 'form']
  },
  {
    id: 'form-ps-lc-bg',
    category: 'form',
    catLabel: { en: 'Commercial Form', hi: 'वाणिज्यिक प्रपत्र' },
    title: { en: 'Form: Payment Security LC & Bank Guarantee Template', hi: 'प्रपत्र: भुगतान सुरक्षा एलसी एवं बैंक गारंटी प्रारूप' },
    desc: { 
      en: 'Standard formats for Irrevocable Revolving Letter of Credit (LC) and Bank Guarantees for PPA/PSA default protection.',
      hi: 'पीपीए/पीएसए डिफॉल्ट सुरक्षा हेतु अपरिवर्तनीय परिक्रामी साख पत्र (LC) एवं बैंक गारंटी मानक प्रारूप।'
    },
    path: '/reia',
    action: 'navigate',
    icon: FileCheck,
    keywords: ['letter of credit', 'lc', 'bank guarantee', 'bg', 'payment security', 'default', 'escrow', 'format', 'template']
  },

  // Energy Market Glossary & Acronyms
  {
    id: 'glossary-ppa',
    category: 'glossary',
    catLabel: { en: 'Market Glossary', hi: 'बाज़ार शब्दावली' },
    title: { en: 'Glossary: PPA (Power Purchase Agreement)', hi: 'शब्दावली: पीपीए (विद्युत क्रय अनुबंध)' },
    desc: { 
      en: '25-year legally binding procurement agreement between SJVN (REIA) and RE generators fixing tariff, supply schedule, and escrow default terms.',
      hi: 'एसजेवीएन (आरईआईए) और नवीकरणीय ऊर्जा उत्पादकों के बीच टैरिफ, आपूर्ति अनुसूची एवं सुरक्षा शर्तों का 25-वर्षीय कानूनी अनुबंध।'
    },
    path: '/reia',
    action: 'navigate',
    icon: HelpCircle,
    keywords: ['ppa', 'power purchase agreement', '25 year', 'generator', 'tariff', 'contract', 'procurement', 'glossary']
  },
  {
    id: 'glossary-psa',
    category: 'glossary',
    catLabel: { en: 'Market Glossary', hi: 'बाज़ार शब्दावली' },
    title: { en: 'Glossary: PSA (Power Sale Agreement)', hi: 'शब्दावली: पीएसए (विद्युत विक्रय अनुबंध)' },
    desc: { 
      en: 'Back-to-back off-take contract between SJVN and State Discoms mirroring PPA conditions with standard 7 paise/kWh trading margin.',
      hi: 'एसजेवीएन और राज्य डिस्कॉम्स के बीच पीपीए शर्तों को प्रतिबिंबित करने वाला बैक-टू-बैक आपूर्ति अनुबंध।'
    },
    path: '/reia',
    action: 'navigate',
    icon: HelpCircle,
    keywords: ['psa', 'power sale agreement', 'discom', 'back to back', 'trading margin', 'offtaker', 'glossary']
  },
  {
    id: 'glossary-ecr',
    category: 'glossary',
    catLabel: { en: 'Market Glossary', hi: 'बाज़ार शब्दावली' },
    title: { en: 'Glossary: ECR (Energy Charge Rate)', hi: 'शब्दावली: ईसीआर (ऊर्जा प्रभार दर)' },
    desc: { 
      en: 'Variable cost per kWh reflecting landed fuel (coal) price and station heat rate for thermal baseload power at Buxar (1,320 MW).',
      hi: 'बक्सर (1,320 मेगावाट) थर्मल प्लांट में लैंडेड कोयला मूल्य एवं स्टेशन हीट रेट पर आधारित प्रति यूनिट परिवर्तनीय ऊर्जा लागत।'
    },
    path: '/thermal',
    action: 'navigate',
    icon: HelpCircle,
    keywords: ['ecr', 'energy charge rate', 'variable cost', 'fuel', 'coal', 'thermal', 'buxar', 'kwh', 'glossary']
  },
  {
    id: 'glossary-pafm',
    category: 'glossary',
    catLabel: { en: 'Market Glossary', hi: 'बाज़ार शब्दावली' },
    title: { en: 'Glossary: PAFM (Plant Availability Factor for the Month)', hi: 'शब्दावली: पीएएफएम (माह के लिए संयंत्र उपलब्धता अनुपात)' },
    desc: { 
      en: 'Declared hydro capacity availability ratio determining full recovery of annual fixed capacity charges per CERC norms.',
      hi: 'सीईआरसी मानकों के अनुसार वार्षिक निश्चित क्षमता प्रभारों की पूर्ण वसूली निर्धारित करने वाला घोषित संयंत्र उपलब्धता अनुपात।'
    },
    path: '/hydro-thermal',
    action: 'navigate',
    icon: HelpCircle,
    keywords: ['pafm', 'paf', 'plant availability factor', 'capacity charge', 'recovery', 'normative', 'availability', 'hydro', 'glossary']
  },
  {
    id: 'glossary-rtm',
    category: 'glossary',
    catLabel: { en: 'Market Glossary', hi: 'बाज़ार शब्दावली' },
    title: { en: 'Glossary: RTM (Real-Time Market)', hi: 'शब्दावली: आरटीएम (रियल-टाइम मार्केट)' },
    desc: { 
      en: '15-minute time block power exchange bidding mechanism conducted half-hourly to enable discoms & generators to balance real-time grid deviations.',
      hi: 'डिस्कॉम्स एवं जनरेटरों को वास्तविक समय में ग्रिड विचलन संतुलित करने हेतु प्रत्येक आधे घंटे में आयोजित 15-मिनट की एक्सचेंज नीलामी।'
    },
    path: '/trading',
    action: 'navigate',
    icon: HelpCircle,
    keywords: ['rtm', 'real-time market', 'real time', '15 minute', 'exchange', 'iex', 'balancing', 'time block', 'glossary']
  },
  {
    id: 'glossary-noar',
    category: 'glossary',
    catLabel: { en: 'Market Glossary', hi: 'बाज़ार शब्दावली' },
    title: { en: 'Glossary: NOAR (National Open Access Registry)', hi: 'शब्दावली: एनओएआर (राष्ट्रीय खुली पहुंच रजिस्ट्री)' },
    desc: { 
      en: 'Centralized pan-India electronic platform operated by Grid-India (POSOCO) for short-term open access (STOA) electronic standing clearances.',
      hi: 'अल्पकालिक खुली पहुंच (STOA) स्थायी मंजूरियों के लिए ग्रिड-इंडिया (POSOCO) द्वारा संचालित केंद्रीकृत इलेक्ट्रॉनिक पोर्टल।'
    },
    path: '/trading',
    action: 'navigate',
    icon: HelpCircle,
    keywords: ['noar', 'national open access registry', 'standing clearance', 'posoco', 'grid controller', 'open access', 'glossary']
  },
  {
    id: 'glossary-dsm',
    category: 'glossary',
    catLabel: { en: 'Market Glossary', hi: 'बाज़ार शब्दावली' },
    title: { en: 'Glossary: DSM (Deviation Settlement Mechanism)', hi: 'शब्दावली: डीएसएम (विचलन निपटान तंत्र)' },
    desc: { 
      en: 'Regulatory settlement structure penalizing frequency-incompatible power drawals or injections against scheduled dispatch.',
      hi: 'शेड्यूल प्रेषण के विरुद्ध आवृत्ति-असंगत ऊर्जा निकासी या इंजेक्शन पर वित्तीय जुर्माना लगाने वाली नियामक व्यवस्था।'
    },
    path: '/trading',
    action: 'navigate',
    icon: HelpCircle,
    keywords: ['dsm', 'deviation settlement', 'frequency', 'imbalance', 'penalty', 'grid', 'settlement', 'glossary']
  },

  // Corporate Profile & Vision
  {
    id: 'corp-vision',
    category: 'corporate',
    catLabel: { en: 'Corporate', hi: 'कॉर्पोरेट' },
    title: { en: 'Our Vision, Mission & Shared Horizon', hi: 'हमारा विज़न, मिशन एवं दीर्घकालिक लक्ष्य' },
    desc: { 
      en: 'Official SJVN targets: 25,000 MW by 2030, 50,000 MW by 2040, 4 mission pillars & 5 institutional core values.',
      hi: 'एसजेवीएन आधिकारिक लक्ष्य: 2030 तक 25,000 मेगावाट, 2040 तक 50,000 मेगावाट, 4 मिशन स्तंभ एवं 5 मूल मूल्य।'
    },
    path: null,
    action: 'modal',
    icon: Target,
    keywords: ['vision', 'mission', 'targets', '2030', '2040', '25000 mw', '50000 mw', 'core values', 'corporate', 'goal', 'lakshya']
  },

  // Statutory Policies & Legal
  {
    id: 'policy-privacy',
    category: 'policy',
    catLabel: { en: 'Statutory Policy', hi: 'संवैधानिक नीति' },
    title: { en: 'Privacy Policy (DPDP Act, 2023)', hi: 'गोपनीयता नीति (डीपीडीपी अधिनियम, 2023)' },
    desc: { 
      en: 'Digital Personal Data Protection compliance, purpose limitation, sovereign retention, and Data Principal rights.',
      hi: 'डिजिटल व्यक्तिगत डेटा संरक्षण अनुपालन, उद्देश्य सीमा, संप्रभु डेटा संरक्षण एवं नागरिक अधिकार।'
    },
    path: '/privacy-policy',
    action: 'navigate',
    icon: ShieldCheck,
    keywords: ['privacy', 'dpdp', 'data protection', 'gopniyata', 'security', 'consent', 'retention', 'data principal']
  },
  {
    id: 'policy-terms',
    category: 'policy',
    catLabel: { en: 'Statutory Policy', hi: 'संवैधानिक नीति' },
    title: { en: 'Terms of Use & Authorized Access', hi: 'उपयोग की शर्तें एवं अधिकृत प्रवेश' },
    desc: { 
      en: 'Authorized enterprise access terms, IT Act 2000 provisions, audit logging, and credential confidentiality.',
      hi: 'अधिकृत एंटरप्राइज पहुंच शर्तें, आईटी अधिनियम 2000 के प्रावधान, ऑडिट लॉगिंग एवं साख सुरक्षा।'
    },
    path: '/terms-of-use',
    action: 'navigate',
    icon: FileText,
    keywords: ['terms', 'use', 'rules', 'it act', 'authorized', 'conditions', 'legal', 'credentials']
  },
  {
    id: 'policy-disclaimer',
    category: 'policy',
    catLabel: { en: 'Statutory Policy', hi: 'संवैधानिक नीति' },
    title: { en: 'Disclaimer & Regulatory Notice', hi: 'अस्वीकरण एवं नियामक सूचना' },
    desc: { 
      en: 'Regulatory tariff reconciliation, provisional settlement disclosures, and market clearing price notices.',
      hi: 'नियामक टैरिफ समाधान, अनंतिम निपटान प्रकटीकरण एवं बाज़ार समाशोधन मूल्य संबंधी सूचनाएं।'
    },
    path: '/disclaimer',
    action: 'navigate',
    icon: FileText,
    keywords: ['disclaimer', 'asveekaran', 'regulatory', 'provisional', 'tariff', 'notice', 'liability']
  },
  {
    id: 'policy-hyperlink',
    category: 'policy',
    catLabel: { en: 'Statutory Policy', hi: 'संवैधानिक नीति' },
    title: { en: 'Hyperlinking Policy', hi: 'हाइपरलिंकिंग नीति' },
    desc: { 
      en: 'Rules governing outbound links to GoI ministries and prior approval conditions for inbound links.',
      hi: 'सरकारी मंत्रालयों के बाहरी लिंक एवं पोर्टल पर इनबाउंड लिंक स्थापित करने की पूर्व अनुमति नियम।'
    },
    path: '/hyperlinking-policy',
    action: 'navigate',
    icon: ExternalLink,
    keywords: ['hyperlink', 'links', 'external', 'inbound', 'permission', 'outbound', 'gov.in']
  },
  {
    id: 'policy-copyright',
    category: 'policy',
    catLabel: { en: 'Statutory Policy', hi: 'कॉपीराइट नीति' },
    title: { en: 'Copyright Policy', hi: 'कॉपीराइट नीति' },
    desc: { 
      en: 'Content ownership by SJVN Limited & Ministry of Power, authorized reproduction for non-commercial research.',
      hi: 'एसजेवीएन एवं विद्युत मंत्रालय का सामग्री स्वामित्व, गैर-वाणिज्यिक शोध हेतु उपयोग के नियम।'
    },
    path: '/copyright-policy',
    action: 'navigate',
    icon: FileText,
    keywords: ['copyright', 'ownership', 'intellectual property', 'content', 'reproduction', 'power ministry']
  },
  {
    id: 'policy-cookie',
    category: 'policy',
    catLabel: { en: 'Statutory Policy', hi: 'संवैधानिक नीति' },
    title: { en: 'Cookie & Telemetry Policy', hi: 'कुकी एवं टेलीमेट्री नीति' },
    desc: { 
      en: 'Strictly essential session cookies and GIGW 3.0 zero commercial tracker architecture.',
      hi: 'सख्त आवश्यक सत्र कुकीज़ एवं GIGW 3.0 शून्य व्यावसायिक ट्रैकर व्यवस्था।'
    },
    path: '/cookie-policy',
    action: 'navigate',
    icon: Cookie,
    keywords: ['cookie', 'telemetry', 'storage', 'tracking', 'session', 'preferences']
  },
  {
    id: 'policy-security',
    category: 'policy',
    catLabel: { en: 'Statutory Policy', hi: 'संवैधानिक नीति' },
    title: { en: 'Information Security Policy', hi: 'सूचना सुरक्षा नीति' },
    desc: { 
      en: 'CERT-In compliance, TLS 1.3 encryption, ISO/IEC 27001 posture, and Indian Cyber Crime reporting.',
      hi: 'सीईआरटी-इन अनुपालन, टीएलएस 1.3 एन्क्रिप्शन, आईएसओ 27001 सुरक्षा मानक एवं साइबर अपराध रिपोर्टिंग।'
    },
    path: '/security-policy',
    action: 'navigate',
    icon: Lock,
    keywords: ['security', 'cert-in', 'encryption', 'tls', 'iso 27001', 'cyber', 'vulnerability', 'safety']
  },

  // Contact, Grievance & RTI
  {
    id: 'contact-wim',
    category: 'contact',
    catLabel: { en: 'Help & Contact', hi: 'सहायता एवं संपर्क' },
    title: { en: 'Web Information Manager & Corporate Contacts', hi: 'वेब सूचना प्रबंधक एवं कॉर्पोरेट संपर्क' },
    desc: { 
      en: 'Shri Rajesh Patre (CGM IT&C), Shakti Sadan Shimla HQ PBX: +91-177-2660003, Email: wim.it@sjvn.in.',
      hi: 'श्री राजेश पत्रे (मुख्य महाप्रबंधक आईटी एवं संचार), शक्ति सदन शिमला मुख्यालय दूरभाष एवं ईमेल संपर्क।'
    },
    path: '/contact-us',
    action: 'navigate',
    icon: PhoneCall,
    keywords: ['contact', 'wim', 'web information manager', 'rajesh patre', 'phone', 'email', 'shimla', 'headquarters', 'shakti sadan', 'address']
  },
  {
    id: 'contact-grievance',
    category: 'contact',
    catLabel: { en: 'Help & Contact', hi: 'सहायता एवं संपर्क' },
    title: { en: 'Grievance Redressal & Right to Information (RTI)', hi: 'शिकायत निवारण एवं सूचना का अधिकार (RTI)' },
    desc: { 
      en: 'Designated Grievance Officer, RTI First Appellate Authority (Sh. Baljeet Singh), CPGRAMS portal link.',
      hi: 'नामित शिकायत निवारण अधिकारी, आरटीआई प्रथम अपीलीय प्राधिकारी (श्री बलजीत सिंह), सीपीग्राम्स लिंक।'
    },
    path: '/grievance-redressal',
    action: 'navigate',
    icon: Users,
    keywords: ['grievance', 'rti', 'shikayat', 'baljeet singh', 'appellate authority', 'cpgrams', 'pgportal', 'complaint']
  },

  // Accessibility & Directory
  {
    id: 'a11y-statement',
    category: 'a11y',
    catLabel: { en: 'Accessibility', hi: 'सुगमता' },
    title: { en: 'Accessibility Statement (GIGW 3.0 · WCAG 2.1 AA)', hi: 'सुगमता विवरण (GIGW 3.0 · WCAG 2.1 AA)' },
    desc: { 
      en: 'Compliance commitment, contrast ratios, keyboard accessibility, and UX4G design standard conformity.',
      hi: 'सुगमता प्रतिबद्धता, रंग कंट्रास्ट, कीबोर्ड संचालन एवं UX4G डिज़ाइन मानक अनुरूपता।'
    },
    path: '/accessibility-statement',
    action: 'navigate',
    icon: Eye,
    keywords: ['accessibility', 'a11y', 'sugamya', 'wcag', 'gigw', 'ux4g', 'contrast', 'keyboard']
  },
  {
    id: 'a11y-screenreader',
    category: 'a11y',
    catLabel: { en: 'Accessibility', hi: 'सुगमता' },
    title: { en: 'Screen Reader Access & Shortcuts', hi: 'स्क्रीन रीडर पहुंच एवं शॉर्टकट' },
    desc: { 
      en: 'Guide to NVDA, JAWS, VoiceOver compatibility, skip-to-content links, and ARIA landmark navigation.',
      hi: 'एनवीडीए, जॉज़, वॉइसओवर संगतता, मुख्य सामग्री पर जाने के शॉर्टकट एवं एआरआईए नेविगेशन गाइड।'
    },
    path: '/screen-reader-access',
    action: 'navigate',
    icon: Eye,
    keywords: ['screen reader', 'nvda', 'jaws', 'voiceover', 'shortcut', 'aria', 'blind', 'assistive']
  },
  {
    id: 'help-desk',
    category: 'a11y',
    catLabel: { en: 'Help & Guide', hi: 'सहायता एवं निर्देश' },
    title: { en: 'Portal Help Desk & Step-by-Step Guides', hi: 'पोर्टल सहायता केंद्र एवं चरणबद्ध निर्देश' },
    desc: { 
      en: 'Operational walkthroughs for REIA bidding, exchange order placement, hydro bill verification & maker-checker.',
      hi: 'आरईआईए निविदा, एक्सचेंज ऑर्डर, हाइड्रो बिल सत्यापन एवं मेकर-चेकर संचालन निर्देश।'
    },
    path: '/help',
    action: 'navigate',
    icon: HelpCircle,
    keywords: ['help', 'guide', 'instructions', 'sahayata', 'how to', 'faq', 'support', 'manual']
  },
  {
    id: 'site-sitemap',
    category: 'a11y',
    catLabel: { en: 'Directory', hi: 'निर्देशिका' },
    title: { en: 'Portal Sitemap & Architecture', hi: 'पोर्टल साइटमैप एवं वास्तुकला' },
    desc: { 
      en: 'Complete hierarchical directory of all operational desks, statutory policies, public portals, and compliance tools.',
      hi: 'सभी परिचालन डेस्क, वैधानिक नीतियों, सार्वजनिक पोर्टलों एवं अनुपालन उपकरणों की पूर्ण निर्देशिका।'
    },
    path: '/sitemap',
    action: 'navigate',
    icon: Map,
    keywords: ['sitemap', 'directory', 'index', 'all pages', 'navigation', 'map', 'architecture']
  }
];

export default function PortalSearchModal({ open, onClose }) {
  const { lang } = useGigw();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState('all');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef(null);
  const resultsRef = useRef(null);

  // Focus input whenever modal opens
  useEffect(() => {
    if (open) {
      setQuery('');
      setActiveCategory('all');
      setSelectedIndex(0);
      setTimeout(() => {
        inputRef.current?.focus();
      }, 50);
    }
  }, [open]);

  // Global ESC key and Arrow navigation
  useEffect(() => {
    if (!open) return;

    function handleKeyDown(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  // Filtered & Ranked Results
  const results = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    
    // Category filter predicate
    const matchesCategory = (item) => {
      if (activeCategory === 'all') return true;
      return item.category === activeCategory;
    };

    if (!trimmed) {
      if (activeCategory === 'all') {
        // Return top popular suggestions when query is empty and on "All"
        return [
          SEARCH_INDEX.find((i) => i.id === 'desk-reia'),
          SEARCH_INDEX.find((i) => i.id === 'desk-trading'),
          SEARCH_INDEX.find((i) => i.id === 'desk-hydro'),
          SEARCH_INDEX.find((i) => i.id === 'reg-iegc'),
          SEARCH_INDEX.find((i) => i.id === 'tender-solar-1200'),
          SEARCH_INDEX.find((i) => i.id === 'glossary-ppa'),
          SEARCH_INDEX.find((i) => i.id === 'form-cerc-iv'),
          SEARCH_INDEX.find((i) => i.id === 'policy-privacy'),
        ].filter(Boolean);
      } else {
        // Return all items in the selected category
        return SEARCH_INDEX.filter(matchesCategory).slice(0, 10);
      }
    }

    const tokens = trimmed.split(/\s+/).filter(Boolean);

    const scored = [];
    for (const item of SEARCH_INDEX) {
      if (!matchesCategory(item)) continue;

      let score = 0;
      const titleEn = item.title.en.toLowerCase();
      const titleHi = item.title.hi.toLowerCase();
      const descEn = item.desc.en.toLowerCase();
      const descHi = item.desc.hi.toLowerCase();
      const cat = item.category.toLowerCase();
      const keywords = item.keywords || [];

      // Check each token
      let allTokensMatch = true;
      for (const t of tokens) {
        let tokenMatch = false;
        if (titleEn.includes(t)) {
          score += 20;
          if (titleEn.startsWith(t)) score += 30;
          tokenMatch = true;
        }
        if (titleHi.includes(t)) {
          score += 20;
          tokenMatch = true;
        }
        if (keywords.some((k) => k.includes(t))) {
          score += 15;
          if (keywords.some((k) => k === t)) score += 25;
          tokenMatch = true;
        }
        if (descEn.includes(t) || descHi.includes(t)) {
          score += 5;
          tokenMatch = true;
        }
        if (cat.includes(t)) {
          score += 5;
          tokenMatch = true;
        }
        if (!tokenMatch) {
          allTokensMatch = false;
          break;
        }
      }

      if (allTokensMatch && score > 0) {
        scored.push({ item, score });
      }
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.map((s) => s.item).slice(0, 10);
  }, [query, activeCategory]);

  // Keep selected index in bounds
  useEffect(() => {
    setSelectedIndex(0);
  }, [results, activeCategory]);

  function handleSelect(item) {
    onClose();
    if (item.action === 'modal') {
      openVisionModal();
    } else if (item.action === 'external' && item.path) {
      window.open(item.path, '_blank', 'noopener,noreferrer');
    } else if (item.path) {
      navigate(item.path);
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (results.length === 0 ? 0 : (prev + 1) % results.length));
      scrollActiveIntoView((selectedIndex + 1) % results.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (results.length === 0 ? 0 : (prev - 1 + results.length) % results.length));
      scrollActiveIntoView((selectedIndex - 1 + results.length) % results.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (results[selectedIndex]) {
        handleSelect(results[selectedIndex]);
      }
    }
  }

  function scrollActiveIntoView(idx) {
    if (!resultsRef.current) return;
    const items = resultsRef.current.querySelectorAll('.portal-search-result-item');
    if (items[idx]) {
      items[idx].scrollIntoView({ block: 'nearest' });
    }
  }

  if (!open) return null;

  return (
    <div 
      className="portal-search-overlay" 
      onClick={onClose}
      role="presentation"
    >
      <div 
        className="portal-search-modal" 
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={lang === 'hi' ? 'एसजेवीएन पोर्टल खोज' : 'SJVN Portal Quick Search'}
      >
        {/* Search Header Input Field */}
        <div className="portal-search-input-wrapper">
          <Search size={20} className="portal-search-lens" />
          <input
            ref={inputRef}
            type="text"
            className="portal-search-input"
            placeholder={lang === 'hi' 
              ? 'पोर्टल, सीईआरसी विनियम, निविदा संख्या, फॉर्म, ग्लॉसरी (PPA, ECR, RTM) खोजें...' 
              : 'Search desks, CERC regulations, tenders, forms, glossary (PPA, PSA, ECR, RTM)...'}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            aria-autocomplete="list"
          />
          {query && (
            <button
              type="button"
              className="portal-search-clear-btn"
              onClick={() => {
                setQuery('');
                inputRef.current?.focus();
              }}
              title={lang === 'hi' ? 'हटाएं' : 'Clear search'}
            >
              <X size={16} />
            </button>
          )}
          <kbd className="portal-search-kbd">ESC</kbd>
        </div>

        {/* Category Filter Pills */}
        <div className="portal-search-categories-bar" role="tablist" aria-label="Search Categories">
          {SEARCH_CATEGORIES.map((cat) => {
            const isActive = activeCategory === cat.id;
            const labelText = cat.label[lang] || cat.label.en;
            return (
              <button
                key={cat.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                className={`portal-search-cat-pill ${isActive ? 'is-active' : ''}`}
                onClick={() => {
                  setActiveCategory(cat.id);
                  inputRef.current?.focus();
                }}
              >
                {labelText}
              </button>
            );
          })}
        </div>

        {/* Results Container */}
        <div className="portal-search-body" ref={resultsRef}>
          <div className="portal-search-section-label">
            {query.trim() 
              ? (lang === 'hi' ? `खोज परिणाम (${results.length})` : `Search Results (${results.length})`)
              : (activeCategory !== 'all'
                  ? (lang === 'hi' ? `श्रेणी परिणाम (${results.length})` : `Category Index (${results.length})`)
                  : (lang === 'hi' ? 'लोकप्रिय खोजें एवं मुख्य पृष्ठ' : 'Popular Searches & Quick Navigation'))}
          </div>

          {results.length === 0 ? (
            <div className="portal-search-empty">
              <HelpCircle size={36} style={{ color: 'var(--text-muted)', marginBottom: 8 }} />
              <h4>{lang === 'hi' ? 'कोई परिणाम नहीं मिला' : 'No matching results found'}</h4>
              <p>
                {lang === 'hi' 
                  ? `"${query}" के लिए कोई मॉड्यूल, विनियम या प्रपत्र उपलब्ध नहीं है। साइटमैप में पूरी सूची देखें।` 
                  : `No regulation, tender, form or policy matched "${query}". You can inspect the complete hierarchy in the Sitemap.`}
              </p>
              <button 
                type="button" 
                onClick={() => { onClose(); navigate('/sitemap'); }}
                className="portal-search-empty-btn"
              >
                <Map size={14} />
                <span>{lang === 'hi' ? 'पोर्टल साइटमैप खोलें →' : 'View Portal Sitemap →'}</span>
              </button>
            </div>
          ) : (
            <ul className="portal-search-results-list" role="listbox">
              {results.map((item, idx) => {
                const Icon = item.icon || FileText;
                const isSelected = idx === selectedIndex;
                const titleText = item.title[lang] || item.title.en;
                const descText = item.desc[lang] || item.desc.en;
                const catText = item.catLabel[lang] || item.catLabel.en;

                return (
                  <li
                    key={item.id}
                    role="option"
                    aria-selected={isSelected}
                    className={`portal-search-result-item ${isSelected ? 'selected' : ''}`}
                    onClick={() => handleSelect(item)}
                    onMouseEnter={() => setSelectedIndex(idx)}
                  >
                    <div className="portal-search-item-icon">
                      <Icon size={18} />
                    </div>
                    <div className="portal-search-item-content">
                      <div className="portal-search-item-top">
                        <span className="portal-search-item-title">{titleText}</span>
                        <span className={`portal-search-item-tag tag-${item.category}`}>
                          {catText}
                        </span>
                      </div>
                      <div className="portal-search-item-desc">{descText}</div>
                    </div>
                    <div className="portal-search-item-action">
                      {isSelected && (
                        <span className="portal-search-enter-hint">
                          <span>Enter</span>
                          <CornerDownLeft size={12} />
                        </span>
                      )}
                      <ArrowRight size={14} className="portal-search-arrow" />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Footer shortcuts */}
        <div className="portal-search-footer">
          <div className="portal-search-footer-left">
            <span>
              <kbd>↑</kbd> <kbd>↓</kbd> {lang === 'hi' ? 'चुनें' : 'Navigate'}
            </span>
            <span>
              <kbd>↵</kbd> {lang === 'hi' ? 'खोलें' : 'Select'}
            </span>
            <span>
              <kbd>ESC</kbd> {lang === 'hi' ? 'बंद करें' : 'Close'}
            </span>
          </div>
          <div className="portal-search-footer-right">
            <span>SJVN Deep Sovereign Index · CERC · REIA · GIGW 3.0</span>
          </div>
        </div>
      </div>
    </div>
  );
}
