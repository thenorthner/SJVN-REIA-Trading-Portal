import React from 'react';

export default function PortalLevel1Dashboard() {
  const sections = [
    {
      title: "Client Registration",
      items: ["New Client Requests for Login", "New Registration Requests", "Update Portfolio ID", "Client Report"]
    },
    {
      title: "Billing",
      items: ["Generate Bills", "View/download Bills", "Bill of Supply Entry", "Verify Supply Bills", "SEA/ REA Reconciliation", "ERP Data sharing"]
    },
    {
      title: "MIS Analytics",
      items: ["NOAR Approvals", "Impl. Schedule Reports", "PX Obligation Reports", "TDS Breakup Report", "Market Clearing Price"]
    },
    {
      title: "Bilateral Trading",
      items: ["Create Applications( Format I & II)", "View Applications", "Curtailment/ Surrender"]
    },
    {
      title: "Exchange Trading",
      items: ["Create Exchange Bid", "View Exchange Bid- (Status)"]
    },
    {
      title: "Contracts and Tender Management",
      items: ["Create Bilateral Contracts", "Create Exchange Contracts", "View Bilateral Contracts", "View Exchange Contracts", "Verify Bilateral Contracts", "Verify Exchange Contracts", "Tender Management"]
    }
  ];

  return (
    <div className="p-6 bg-[#f8f9fa] min-h-screen font-sans">
      <div className="max-w-7xl mx-auto grid grid-cols-3 gap-6 items-start">
        {sections.map((sec, idx) => (
          <div key={idx} className="bg-white border border-gray-200 shadow-sm rounded-sm overflow-hidden flex flex-col h-full">
            <div className="bg-[#5da5da] px-4 py-2 text-sm font-semibold text-white">
              {sec.title}
            </div>
            
            <div className="flex bg-[#f2f2f2] border-b border-gray-200 px-4 py-2 text-xs font-semibold text-gray-700">
               <div className="w-8">#</div>
               <div className="flex-1">Desc.</div>
               <div className="w-8 text-right">Link</div>
            </div>

            <ul className="flex-1">
              {sec.items.map((item, itemIdx) => (
                <li key={itemIdx} className="flex justify-between items-center px-4 py-3 border-b border-gray-100 hover:bg-blue-50 cursor-pointer group text-[13px] text-gray-700">
                  <div className="flex items-center w-full">
                     <div className="w-8 text-gray-500">{itemIdx + 1}</div>
                     <div className="flex-1">{item}</div>
                     <div className="w-8 text-right text-gray-400 group-hover:text-blue-500 font-bold">→</div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
