import React from 'react';

const DEMO_DATA = [
  {
    id: 1,
    clientName: 'NTPC VIDYUT VYAPAR NIGAM LIMITED',
    companyName: 'NTPC VIDYUT VYAPAR NIGAM LIMITED',
    category: 'Trader',
    exchange: 'Bilateral',
    segment: '',
    contactPerson: 'PK Jena',
    mobileNo: '7091850568'
  },
  {
    id: 2,
    clientName: 'NTPC VIDYUT VYAPAR NIGAM LIMITED',
    companyName: 'NTPC VIDYUT VYAPAR NIGAM LIMITED',
    category: 'Trader',
    exchange: 'Bilateral',
    segment: '',
    contactPerson: 'PK Jena',
    mobileNo: '7091850568'
  }
];

export default function RegistrationRequests() {
  return (
    <div className="p-6 bg-[#f8f9fa] min-h-screen font-sans text-[13px]">
      <div className="bg-white border border-gray-200 shadow-sm w-full mx-auto rounded-sm">
        
        {/* Header Title */}
        <div className="bg-[#244b7d] text-white px-4 py-2 font-semibold text-center text-sm">
          Requests Submitted for Approval
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
                <th className="px-3 py-2 border-r border-white/20 font-semibold cursor-pointer hover:bg-blue-400">
                  <div className="flex items-center justify-between">Client Name <span className="text-[10px]">▲</span></div>
                </th>
                <th className="px-3 py-2 border-r border-white/20 font-semibold cursor-pointer hover:bg-blue-400">
                   <div className="flex items-center justify-between">Company Name <span className="text-[10px]">▲</span></div>
                </th>
                <th className="px-3 py-2 border-r border-white/20 font-semibold cursor-pointer hover:bg-blue-400">
                   <div className="flex items-center justify-between">Category <span className="text-[10px]">⇕</span></div>
                </th>
                <th className="px-3 py-2 border-r border-white/20 font-semibold cursor-pointer hover:bg-blue-400">
                   <div className="flex items-center justify-between">Exchange <span className="text-[10px]">⇕</span></div>
                </th>
                <th className="px-3 py-2 border-r border-white/20 font-semibold cursor-pointer hover:bg-blue-400">
                   <div className="flex items-center justify-between">Segment <span className="text-[10px]">⇕</span></div>
                </th>
                <th className="px-3 py-2 border-r border-white/20 font-semibold cursor-pointer hover:bg-blue-400">
                   <div className="flex items-center justify-between">Contact Person <span className="text-[10px]">⇕</span></div>
                </th>
                <th className="px-3 py-2 border-r border-white/20 font-semibold cursor-pointer hover:bg-blue-400">
                   <div className="flex items-center justify-between">Mobile No <span className="text-[10px]">⇕</span></div>
                </th>
                <th className="px-3 py-2 font-semibold cursor-pointer hover:bg-blue-400">
                   <div className="flex items-center justify-between">Action <span className="text-[10px]">⇕</span></div>
                </th>
              </tr>
            </thead>
            <tbody>
              {DEMO_DATA.map((row) => (
                <tr key={row.id} className="border-b border-gray-200 text-gray-700 hover:bg-gray-50">
                  <td className="px-3 py-2 border-r border-gray-200">{row.clientName}</td>
                  <td className="px-3 py-2 border-r border-gray-200">{row.companyName}</td>
                  <td className="px-3 py-2 border-r border-gray-200">{row.category}</td>
                  <td className="px-3 py-2 border-r border-gray-200">{row.exchange}</td>
                  <td className="px-3 py-2 border-r border-gray-200">{row.segment}</td>
                  <td className="px-3 py-2 border-r border-gray-200">{row.contactPerson}</td>
                  <td className="px-3 py-2 border-r border-gray-200">{row.mobileNo}</td>
                  <td className="px-3 py-2">
                    <button className="text-blue-500 hover:underline">Action</button>
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
