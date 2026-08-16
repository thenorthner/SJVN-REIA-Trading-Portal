import React from 'react';
import { useNavigate } from 'react-router-dom';

const BILL_TYPES = [
  { id: 1, name: 'Exchange Trading Margin Invoice', path: '/invoices/trading-margin' },
  { id: 2, name: 'Exchange Open Access Invoice', path: '/invoices/open-access' },
  { id: 3, name: 'Exchange Energy Settlement Invoice', path: '/invoices/exchange-energy-settlement' },
  { id: 4, name: 'Bilateral Energy Settlement Invoice', path: '/invoices/bilateral-energy-settlement' },
  { id: 5, name: 'Bilateral SLDC Consent Fee Invoice', path: '/invoices/bilateral-sldc-consent' },
  { id: 6, name: 'Bilateral Open Access Invoice', path: '/invoices/bilateral-open-access' },
];

export default function ViewBills() {
  const navigate = useNavigate();

  return (
    <div className="p-6 bg-[#f8f9fa] min-h-screen font-sans text-[13px]">
      <div className="bg-white border border-gray-200 shadow-sm max-w-[1400px] mx-auto rounded-sm">
        
        {/* Header Title */}
        <div className="bg-white px-4 py-3 text-gray-700 font-semibold border-b border-gray-200">
          SJVN - View Bills (Invoice)
        </div>

        {/* Action Bar */}
        <div className="flex justify-end items-center p-3">
          <div className="flex items-center gap-2">
            <label className="text-gray-600 font-medium">Search:</label>
            <input type="text" className="border border-gray-300 px-2 py-1 rounded-sm w-48 outline-none focus:border-blue-400" />
          </div>
        </div>

        {/* Main Data Table */}
        <div className="overflow-x-auto px-4 pb-4">
          <table className="w-full text-left border-collapse whitespace-nowrap border border-gray-200">
            <thead>
              <tr className="bg-[#66b2ff] text-white">
                <th className="px-3 py-2 border-r border-white/20 font-semibold w-24 text-center cursor-pointer hover:bg-blue-400">Sr. No. ⇕</th>
                <th className="px-3 py-2 border-r border-white/20 font-semibold cursor-pointer hover:bg-blue-400">Bill (Invoice) Name</th>
                <th className="px-3 py-2 font-semibold w-32 text-center cursor-pointer hover:bg-blue-400">Action ⇕</th>
              </tr>
            </thead>
            <tbody>
              {BILL_TYPES.map((bill) => (
                <tr key={bill.id} className="border-b border-gray-200 hover:bg-gray-50 text-gray-700">
                  <td className="px-3 py-2 border-r border-gray-200 text-center">{bill.id}.</td>
                  <td className="px-3 py-2 border-r border-gray-200">{bill.name}</td>
                  <td className="px-3 py-2 text-center">
                    <button 
                        onClick={() => bill.path !== '#' && navigate(bill.path)}
                        className="text-[#428bca] hover:text-[#2a6496] hover:underline"
                    >
                      View
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

      </div>
    </div>
  );
}
