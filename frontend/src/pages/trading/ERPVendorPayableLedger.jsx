import React, { useState } from 'react';

const DUMMY_DATA = [
  { desc: 'Energy Bill Invoice by Kreate 09-Aug-23 to 15-Aug-23', docDate: '16.08.2023', docType: 'PW', companyCode: '1000', postingDate: '22.08.2023', currency: 'INR', reference: 'KEIPL/SOP/340', headerText: 'KEIPL/SOP/340', postingKey: '31', vendorNo: '1010562', vendorName: '', refGL: '', pan: '' },
];

export default function ERPVendorPayableLedger() {
  const [date, setDate] = useState('');

  return (
    <div className="p-6 bg-[#f8f9fa] min-h-screen font-sans text-sm">
      <div className="bg-white shadow-sm border border-gray-200 rounded-sm mb-6 max-w-2xl">
        <div className="px-4 py-2 bg-gray-50 border-b border-gray-200">
          <h2 className="font-semibold text-gray-700 text-[13px]">Vendor Payable Format</h2>
        </div>
        <div className="p-4">
          <div className="mb-4 max-w-xs">
            <label className="block text-[12px] text-red-600 mb-1">Document Date *</label>
            <input 
              type="date" 
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full border border-gray-300 rounded px-2 py-1.5 text-gray-700 outline-none focus:border-blue-400"
            />
          </div>
          <button className="bg-[#3399ff] hover:bg-blue-500 text-white px-4 py-1.5 rounded-sm font-medium transition-colors">
            Show Report
          </button>
        </div>
      </div>

      {/* Action Bar */}
      <div className="flex justify-between items-center bg-white border border-b-0 border-gray-200 p-2 shadow-sm rounded-t-sm">
        <div className="flex gap-2">
          <button className="bg-[#5bc0de] hover:bg-[#31b0d5] text-white px-4 py-1.5 text-xs rounded-full shadow-sm font-semibold transition-colors">CSV</button>
          <button className="bg-[#5bc0de] hover:bg-[#31b0d5] text-white px-4 py-1.5 text-xs rounded-full shadow-sm font-semibold transition-colors">Excel</button>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-gray-600 font-medium text-xs">Search:</label>
          <input type="text" className="border border-gray-300 px-2 py-1 rounded-sm w-48 outline-none focus:border-blue-400" />
        </div>
      </div>

      {/* Main Table */}
      <div className="bg-white border border-gray-200 overflow-x-auto shadow-sm rounded-b-sm">
        <table className="w-full text-left border-collapse whitespace-nowrap text-[13px]">
          <thead>
            <tr className="bg-[#66b2ff] text-white">
              <th className="px-4 py-2.5 border-r border-white/20 font-semibold cursor-pointer hover:bg-blue-400 transition-colors">Description ⇕</th>
              <th className="px-4 py-2.5 border-r border-white/20 font-semibold cursor-pointer hover:bg-blue-400 transition-colors">Document Date ⇕</th>
              <th className="px-4 py-2.5 border-r border-white/20 font-semibold cursor-pointer hover:bg-blue-400 transition-colors">Document Type ⇕</th>
              <th className="px-4 py-2.5 border-r border-white/20 font-semibold cursor-pointer hover:bg-blue-400 transition-colors">Company Code ⇕</th>
              <th className="px-4 py-2.5 border-r border-white/20 font-semibold cursor-pointer hover:bg-blue-400 transition-colors">Posting Date ⇕</th>
              <th className="px-4 py-2.5 border-r border-white/20 font-semibold cursor-pointer hover:bg-blue-400 transition-colors">Currency ⇕</th>
              <th className="px-4 py-2.5 border-r border-white/20 font-semibold cursor-pointer hover:bg-blue-400 transition-colors">Reference ⇕</th>
              <th className="px-4 py-2.5 border-r border-white/20 font-semibold cursor-pointer hover:bg-blue-400 transition-colors">Document Header Text ⇕</th>
              <th className="px-4 py-2.5 border-r border-white/20 font-semibold cursor-pointer hover:bg-blue-400 transition-colors">Posting Key ⇕</th>
              <th className="px-4 py-2.5 border-r border-white/20 font-semibold cursor-pointer hover:bg-blue-400 transition-colors">SAP Vendor No ⇕</th>
              <th className="px-4 py-2.5 border-r border-white/20 font-semibold cursor-pointer hover:bg-blue-400 transition-colors">Vendor Name ⇕</th>
              <th className="px-4 py-2.5 border-r border-white/20 font-semibold cursor-pointer hover:bg-blue-400 transition-colors">Reference GL ⇕</th>
              <th className="px-4 py-2.5 font-semibold cursor-pointer hover:bg-blue-400 transition-colors">PAN ⇕</th>
            </tr>
          </thead>
          <tbody>
            {DUMMY_DATA.map((row, idx) => (
              <tr key={idx} className="border-b border-gray-100 hover:bg-gray-50 text-gray-700">
                <td className="px-4 py-2.5">{row.desc}</td>
                <td className="px-4 py-2.5">{row.docDate}</td>
                <td className="px-4 py-2.5">{row.docType}</td>
                <td className="px-4 py-2.5">{row.companyCode}</td>
                <td className="px-4 py-2.5">{row.postingDate}</td>
                <td className="px-4 py-2.5">{row.currency}</td>
                <td className="px-4 py-2.5">{row.reference}</td>
                <td className="px-4 py-2.5">{row.headerText}</td>
                <td className="px-4 py-2.5">{row.postingKey}</td>
                <td className="px-4 py-2.5">{row.vendorNo}</td>
                <td className="px-4 py-2.5">{row.vendorName}</td>
                <td className="px-4 py-2.5">{row.refGL}</td>
                <td className="px-4 py-2.5">{row.pan}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
