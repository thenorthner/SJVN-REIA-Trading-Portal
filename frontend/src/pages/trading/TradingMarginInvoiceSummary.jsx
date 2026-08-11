import React from 'react';

export default function TradingMarginInvoiceSummary() {
  return (
    <div className="p-6 bg-[#f8f9fa] min-h-screen font-sans text-[13px]">
      <div className="bg-white border border-gray-200 shadow-sm max-w-[1400px] mx-auto rounded-sm">
        
        {/* Header Title */}
        <div className="bg-[#66b2ff] text-white px-4 py-2 font-semibold flex items-center justify-center tracking-widest text-sm relative">
          Trading Margin Invoice Summary
          <span className="absolute right-4 text-xs">▼</span>
        </div>

        {/* Action Bar */}
        <div className="flex justify-between items-center p-3 border-b border-gray-200 bg-gray-50/50">
          <div className="flex gap-2">
            <button className="bg-[#5bc0de] hover:bg-[#31b0d5] text-white px-4 py-1.5 rounded-full shadow-sm font-semibold transition-colors">CSV</button>
            <button className="bg-[#5bc0de] hover:bg-[#31b0d5] text-white px-4 py-1.5 rounded-full shadow-sm font-semibold transition-colors">Excel</button>
            <button className="bg-[#5bc0de] hover:bg-[#31b0d5] text-white px-4 py-1.5 rounded-full shadow-sm font-semibold transition-colors">PDF</button>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-gray-600 font-medium">Search:</label>
            <input type="text" className="border border-gray-300 px-2 py-1 rounded-sm w-48 outline-none focus:border-blue-400" />
          </div>
        </div>

        {/* Main Data Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-center border-collapse whitespace-nowrap">
            <thead>
              <tr className="bg-[#66b2ff] text-white">
                <th className="px-3 py-3 border-r border-white/20 font-semibold cursor-pointer hover:bg-blue-400"># ⇕</th>
                <th className="px-3 py-3 border-r border-white/20 font-semibold cursor-pointer hover:bg-blue-400">Client Name ⇕</th>
                <th className="px-3 py-3 border-r border-white/20 font-semibold cursor-pointer hover:bg-blue-400">Invoice No ⇕</th>
                <th className="px-3 py-3 border-r border-white/20 font-semibold cursor-pointer hover:bg-blue-400">Invoice Amount(INR) ⇕</th>
                <th className="px-3 py-3 border-r border-white/20 font-semibold cursor-pointer hover:bg-blue-400">Invoice Date ⇕</th>
                <th className="px-3 py-3 border-r border-white/20 font-semibold cursor-pointer hover:bg-blue-400">Invoice Due Date ⇕</th>
                <th className="px-3 py-3 border-r border-white/20 font-semibold cursor-pointer hover:bg-blue-400">Supply From Date ⇕</th>
                <th className="px-3 py-3 border-r border-white/20 font-semibold cursor-pointer hover:bg-blue-400">Supply To Date ⇕</th>
                <th className="px-3 py-3 border-r border-white/20 font-semibold cursor-pointer hover:bg-blue-400">Invoice Generated On ⇕</th>
                <th className="px-3 py-3 border-r border-white/20 font-semibold cursor-pointer hover:bg-blue-400">View ⇕</th>
                <th className="px-3 py-3 border-r border-white/20 font-semibold cursor-pointer hover:bg-blue-400">EDIT ⇕</th>
                <th className="px-3 py-3 font-semibold cursor-pointer hover:bg-blue-400">Cancel ⇕</th>
              </tr>
            </thead>
            <tbody>
                <tr className="border-b border-gray-100">
                    <td colSpan="12" className="px-3 py-6 text-center text-gray-500 bg-[#f9f9f9]">
                        No data available in table
                    </td>
                </tr>
            </tbody>
          </table>
        </div>

        {/* Pagination Footer */}
        <div className="bg-white px-4 py-2 text-gray-500 text-xs border-t border-b border-gray-200 mt-2 mb-4 mx-4">
          Showing 0 to 0 of 0 entries
        </div>

      </div>
    </div>
  );
}
