import React from 'react';

export default function PreRegistrationRequests() {
  return (
    <div className="p-6 bg-[#f8f9fa] min-h-screen font-sans text-[13px]">
      <div className="bg-white border border-gray-200 shadow-sm w-full mx-auto rounded-sm">
        
        {/* Header Title */}
        <div className="bg-[#4682b4] text-white px-4 py-2 font-semibold">
          Pre-Registration Request for Approval
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
          <table className="w-full text-center border-collapse whitespace-nowrap border border-gray-200">
            <thead>
              <tr className="bg-[#66b2ff] text-white">
                <th className="px-3 py-2 border-r border-white/20 font-semibold cursor-pointer hover:bg-blue-400 w-16"># ⇕</th>
                <th className="px-3 py-2 border-r border-white/20 font-semibold cursor-pointer hover:bg-blue-400">Client Name ⇕</th>
                <th className="px-3 py-2 border-r border-white/20 font-semibold cursor-pointer hover:bg-blue-400">Company Name ⇕</th>
                <th className="px-3 py-2 border-r border-white/20 font-semibold cursor-pointer hover:bg-blue-400">Category ⇕</th>
                <th className="px-3 py-2 border-r border-white/20 font-semibold cursor-pointer hover:bg-blue-400">Contact Person ⇕</th>
                <th className="px-3 py-2 border-r border-white/20 font-semibold cursor-pointer hover:bg-blue-400">Mobile No ⇕</th>
                <th className="px-3 py-2 font-semibold cursor-pointer hover:bg-blue-400">Action ⇕</th>
              </tr>
            </thead>
            <tbody>
              {/* Empty state as per screenshot */}
              <tr className="border-b border-gray-200 bg-gray-50/50">
                <td colSpan={7} className="py-3 text-gray-700">No data available in table</td>
              </tr>
            </tbody>
          </table>
        </div>

      </div>
    </div>
  );
}
