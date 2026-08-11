import React, { useState } from 'react';
import { NavLink } from 'react-router-dom';

const registrationRoutes = [
  { label: 'Pre Registration', path: '/onboarding/pre-reg', icon: '👤' },
  { label: 'Post Registration', path: '/onboarding/post-reg', icon: '👤' },
  { label: 'Update Portfolio Id', path: '/onboarding/portfolio-map', icon: '📝' },
  { label: 'Enter client Details', path: '/onboarding/client-details', icon: '📝' }
];

const bilateralRoutes = [
  { label: 'Create Bilateral Contract', path: '/bilateral/contracts/create', icon: '📝' },
  { label: 'Bilateral Contracts Summary', path: '/bilateral/contracts/summary', icon: '📊' },
  { label: 'Bilateral Bidding', path: '/bilateral/bidding', icon: '📅' },
  { label: 'Bilateral Applications', path: '/bilateral/applications', icon: '📅' }
];

const exchangeRoutes = [
  { label: 'Update Charges', path: '/exchange/update-charges', icon: '📝' },
  { label: 'ECERTS Bid Entry', path: '/exchange/ecerts', icon: '📝' },
  { label: 'Daily Schedule Entry', path: '/dispatch/daily-schedule', icon: '📝' }
];

const recRoutes = [
  { label: 'Rec Order', path: '/rec/order/new', icon: '📝' },
  { label: 'REC Order Details Report', path: '/rec/reports/details', icon: '🎴' },
  { label: 'REC Bid Entry', path: '/rec/bidding', icon: '📝' }
];

const billingRoutes = [
  { label: 'Generate Bill', path: '/billing/generate', icon: '📅' },
  { label: 'Supply Bill Entry', path: '/billing/supply-entry', icon: '📑' },
  { label: 'Report of Supply Bill', path: '/billing/reports/supply', icon: '📑' }
];

const uploaderRoutes = [
  { label: 'MMR Excel File Uploader', path: '/ingestion/mmr-excel', icon: '📑' }
];

const pxilRoutes = [
  { label: 'PXIL Order Creation', path: '/exchange/pxil/create', icon: '📝' },
  { label: 'PXIL Order Summary', path: '/exchange/pxil/summary', icon: '📑' }
];

const viewBillsRoutes = [
  { label: 'Exchange Trading Margin Invoice', path: '/finance/invoices/trading-margin', icon: '📑' },
  { label: 'Exchange Open Access Invoice', path: '/finance/invoices/open-access', icon: '📑' },
  { label: 'Exchange Energy Settlement Invoice', path: '/finance/invoices/energy-settlement', icon: '📑' },
  { label: 'Bilateral Energy Settlement Invoice', path: '/finance/invoices/bilateral-energy', icon: '📑' },
  { label: 'Bilateral SLDC Consent Fee Invoice', path: '/finance/invoices/bilateral-sldc', icon: '📑' },
  { label: 'Bilateral Open Access Invoice', path: '/finance/invoices/bilateral-open-access', icon: '📑' }
];

const reportsRoutes = [
  { label: 'Api Details Report', path: '/reports/api-details', icon: '📑' },
  { label: 'Registration Report', path: '/reports/registration', icon: '📑' },
  { label: 'Daily Schedule Report', path: '/reports/daily-schedule', icon: '📑' },
  { label: 'Day Wise Trading Transactions Report', path: '/reports/day-wise-trading', icon: '📑' }
];

const cercRoutes = [
  { label: 'CERC Form IV-A Report', path: '/compliance/cerc/form-4a', icon: '📑' },
  { label: 'CERC Form IV-B Report', path: '/compliance/cerc/form-4b', icon: '📑' },
  { label: 'CERC Form IV-C Report', path: '/compliance/cerc/form-4c', icon: '📑' }
];

const ceaRoutes = [
  { label: 'Power Supply Position Energy', path: '/reports/cea/psp-energy', icon: '📑' },
  { label: 'Power Supply Position Peak', path: '/reports/cea/psp-peak', icon: '📑' },
  { label: 'Month Wise Installed Capacity', path: '/reports/cea/month-capacity', icon: '📑' },
  { label: 'State Wise Installed Capacity', path: '/reports/cea/state-capacity', icon: '📑' }
];

const erpRoutes = [
  { label: 'DAM Orders', path: '/erp/dam-orders', icon: '📑' },
  { label: 'NOC Updation', path: '/erp/noc-updation', icon: '📑' },
  { label: 'NOC Status', path: '/erp/noc-status', icon: '📑' },
  { label: 'RTM Orders', path: '/erp/rtm-orders', icon: '📑' }
];


export default function SidebarNavigation() {
  const [openStates, setOpenStates] = useState({
    mmr: false,
    registration: false,
    bilateral: false,
    exchange: true,
    rec: false,
    bill: false,
    uploader: false,
    pxil: false,
    viewBills: false,
    reports: false,
    cerc: false,
    cea: false,
    erp: true
  });

  const toggleSection = (key) => {
    setOpenStates(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const AccordionSection = ({ title, isOpen, toggle, routes }) => (
    <div className="border-b border-[#1f2937]">
      <button
        onClick={toggle}
        className="w-full flex items-center justify-between px-4 py-2.5 bg-[#0b0c10] text-[#3b82f6] hover:bg-[#1e293b] transition-colors focus:outline-none"
      >
        <span className="font-medium text-[13px]">{title}</span>
        <svg
          className={`w-3 h-3 text-[#3b82f6] transform transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
          fill="currentColor"
          viewBox="0 0 20 20"
        >
          <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
        </svg>
      </button>

      {isOpen && (
        <div className="flex flex-col py-1 bg-[#0f172a]">
          {routes.map((route, index) => (
            <NavLink
              key={index}
              to={route.path}
              className={({ isActive }) =>
                `flex items-center gap-3 px-6 py-2 hover:bg-[#1e293b] transition-colors ${
                  isActive ? 'text-[#38bdf8] bg-[#1e293b]' : 'text-[#38bdf8]'
                }`
              }
            >
              <span className="text-[#38bdf8] opacity-90 text-[10px]">
                {route.icon}
              </span>
              <span className="leading-tight text-[12px]">{route.label}</span>
            </NavLink>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div className="w-full bg-[#0b0c10] text-gray-300 font-sans text-sm h-full overflow-y-auto pb-6 border-r border-[#1f2937]">
      
      {/* Brand Header */}
      <div className="flex items-center gap-3 px-4 py-4 bg-[#0f172a] border-b border-[#1f2937]">
        <div className="w-8 h-8 bg-white rounded flex items-center justify-center shrink-0">
          <span className="text-red-600 font-bold text-lg">⚡</span>
        </div>
        <span className="text-white text-xl font-normal tracking-wide">SJVN-ISET</span>
      </div>

      {/* Top Level Standalone Links */}
      <NavLink
        to="/dashboard"
        className={({ isActive }) =>
          `flex items-center gap-3 px-4 py-3 border-b border-[#1f2937] hover:bg-[#1e293b] transition-colors ${
            isActive ? 'text-[#fbbf24] bg-[#1e293b]' : 'text-[#fbbf24]'
          }`
        }
      >
        <span className="text-[#3b82f6]">⏱</span>
        <span className="font-medium text-[13px]">Dashboard</span>
      </NavLink>

      <NavLink
        to="/trading/power-market"
        className={({ isActive }) =>
          `flex items-center gap-3 px-4 py-3 border-b border-[#1f2937] hover:bg-[#1e293b] transition-colors ${
            isActive ? 'text-[#38bdf8] bg-[#1e293b]' : 'text-[#38bdf8]'
          }`
        }
      >
        <span className="text-[#3b82f6]">⏱</span>
        <span className="font-medium text-[13px]">Power Market Dashboard</span>
      </NavLink>

      <AccordionSection 
        title="MMR Data" 
        isOpen={openStates.mmr} 
        toggle={() => toggleSection('mmr')} 
        routes={[{ label: 'MMR Dashboard', path: '/trading/mmr-dashboard', icon: '📊' }]} 
      />

      <div className="px-4 py-3 flex items-center gap-3 border-b border-[#1f2937] hover:bg-[#1e293b] cursor-pointer">
        <span className="text-[#3b82f6]">⏱</span>
        <span className="text-[#38bdf8] font-medium text-[13px]">Modules</span>
      </div>

      <AccordionSection 
        title="Registration Request" 
        isOpen={openStates.registration} 
        toggle={() => toggleSection('registration')} 
        routes={registrationRoutes} 
      />

      <AccordionSection 
        title="Bilateral" 
        isOpen={openStates.bilateral} 
        toggle={() => toggleSection('bilateral')} 
        routes={bilateralRoutes} 
      />

      <AccordionSection 
        title="Exchange" 
        isOpen={openStates.exchange} 
        toggle={() => toggleSection('exchange')} 
        routes={exchangeRoutes} 
      />
      
      <AccordionSection 
        title="REC Order Details" 
        isOpen={openStates.rec} 
        toggle={() => toggleSection('rec')} 
        routes={recRoutes} 
      />
      
      <AccordionSection 
        title="Bill" 
        isOpen={openStates.bill} 
        toggle={() => toggleSection('bill')} 
        routes={billingRoutes} 
      />
      
      <AccordionSection 
        title="CSV File Uploader" 
        isOpen={openStates.uploader} 
        toggle={() => toggleSection('uploader')} 
        routes={uploaderRoutes} 
      />

      <AccordionSection 
        title="Pxil" 
        isOpen={openStates.pxil} 
        toggle={() => toggleSection('pxil')} 
        routes={pxilRoutes} 
      />

      <AccordionSection 
        title="View Bills" 
        isOpen={openStates.viewBills} 
        toggle={() => toggleSection('viewBills')} 
        routes={viewBillsRoutes} 
      />

      <AccordionSection 
        title="Reports" 
        isOpen={openStates.reports} 
        toggle={() => toggleSection('reports')} 
        routes={reportsRoutes} 
      />

      <AccordionSection 
        title="CERC Reports" 
        isOpen={openStates.cerc} 
        toggle={() => toggleSection('cerc')} 
        routes={cercRoutes} 
      />

      <AccordionSection 
        title="CEA Reports" 
        isOpen={openStates.cea} 
        toggle={() => toggleSection('cea')} 
        routes={ceaRoutes} 
      />

      <AccordionSection 
        title="ERP" 
        isOpen={openStates.erp} 
        toggle={() => toggleSection('erp')} 
        routes={erpRoutes} 
      />
    </div>
  );
}
