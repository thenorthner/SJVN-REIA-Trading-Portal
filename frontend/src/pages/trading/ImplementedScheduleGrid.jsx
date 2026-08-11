import React from 'react';

export default function ImplementedScheduleGrid() {
  return (
    <div className="p-6 bg-[#f8f9fa] min-h-screen font-sans text-sm">
      <div className="bg-white border border-gray-200 overflow-x-auto shadow-sm max-w-7xl mx-auto rounded-sm">
        
        {/* Header Title */}
        <div className="bg-[#66b2ff] text-white px-4 py-2 flex items-center justify-center font-semibold tracking-wide border-b border-white/20">
          Implemented Schedule
        </div>

        {/* Action Bar */}
        <div className="flex justify-between items-center p-3 border-b border-gray-200">
          <div className="flex gap-2">
            <button className="bg-[#5bc0de] hover:bg-[#31b0d5] text-white px-4 py-1.5 text-xs rounded-full shadow-sm transition-colors">CSV</button>
            <button className="bg-[#5bc0de] hover:bg-[#31b0d5] text-white px-4 py-1.5 text-xs rounded-full shadow-sm transition-colors">Excel</button>
            <button className="bg-[#5bc0de] hover:bg-[#31b0d5] text-white px-4 py-1.5 text-xs rounded-full shadow-sm transition-colors">PDF</button>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-gray-600 text-xs font-medium">Search:</label>
            <input type="text" className="border border-gray-300 px-2 py-1 rounded-sm w-48 outline-none focus:border-blue-400" />
          </div>
        </div>

        {/* Main Data Grid */}
        <table className="w-full text-center border-collapse whitespace-nowrap">
          <thead>
            <tr className="bg-[#66b2ff] text-white text-[13px]">
              <th className="px-4 py-3 border-r border-white/20 font-semibold cursor-pointer hover:bg-blue-400 transition-colors w-16">Sr. No. ⇕</th>
              <th className="px-4 py-3 border-r border-white/20 font-semibold cursor-pointer hover:bg-blue-400 transition-colors">Reading Date ⇕</th>
              <th className="px-4 py-3 border-r border-white/20 font-semibold cursor-pointer hover:bg-blue-400 transition-colors">Seller Name ⇕</th>
              <th className="px-4 py-3 border-r border-white/20 font-semibold cursor-pointer hover:bg-blue-400 transition-colors">Buyer Name ⇕</th>
              <th className="px-4 py-3 border-r border-white/20 font-semibold cursor-pointer hover:bg-blue-400 transition-colors w-1/4">
                Seller Schedule<br/>(at Regional Periphery (MWh)) ⇕
              </th>
              <th className="px-4 py-3 font-semibold cursor-pointer hover:bg-blue-400 transition-colors w-1/4">
                Buyer Schedule<br/>(at Regional Periphery (MWh))
              </th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-gray-100 bg-[#f2f2f2] font-semibold text-gray-700">
              <td className="px-4 py-3 border-r border-gray-200" colSpan="4">Total</td>
              <td className="px-4 py-3 border-r border-gray-200">0.0</td>
              <td className="px-4 py-3">0.0</td>
            </tr>
            {/* Empty state mimicking the screenshot */}
            <tr>
              <td colSpan="6" className="px-4 py-2 text-left text-xs text-gray-500 bg-white border-t-2 border-blue-200">
                Showing 1 to 1 of 1 entries
              </td>
            </tr>
          </tbody>
        </table>

      </div>
    </div>
  );
}
