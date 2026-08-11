import React, { useState } from 'react';

const DUMMY_DATA = [
  { desc: 'SJVN/OA/APPPC/202308/083', docDate: '07.08.2023', docType: 'DW', companyCode: '1000', postingDate: '07.08.2023', currency: 'INR', reference: 'BLTR_OA-APPPC', headerText: 'SJVN/OA/APPPC/202308/083', postingKey: '01', customerNo: '1011956' },
  { desc: 'SJVN/OA/KREATE/202312/020', docDate: '25.12.2023', docType: 'DW', companyCode: '1000', postingDate: '25.12.2023', currency: 'INR', reference: 'BLTR_OA-KREATE', headerText: 'SJVN/OA/KREATE/202312/020', postingKey: '01', customerNo: '1010562' },
  { desc: 'SJVN/OA/NDMC/202308/065', docDate: '05.08.2023', docType: 'DW', companyCode: '1000', postingDate: '05.08.2023', currency: 'INR', reference: 'BLTR_OA-NDMC', headerText: 'SJVN/OA/NDMC/202308/065', postingKey: '01', customerNo: '1010' },
  { desc: 'SJVN/OA/NDMC/202308/079', docDate: '07.08.2023', docType: 'DW', companyCode: '1000', postingDate: '07.08.2023', currency: 'INR', reference: 'BLTR_OA-NDMC', headerText: 'SJVN/OA/NDMC/202308/079', postingKey: '01', customerNo: '1004872' },
  { desc: 'SJVN/OA/NDMC/202308/082', docDate: '07.08.2023', docType: 'DW', companyCode: '1000', postingDate: '07.08.2023', currency: 'INR', reference: 'BLTR_OA-NDMC', headerText: 'SJVN/OA/NDMC/202308/082', postingKey: '01', customerNo: '1004872' },
  { desc: 'SJVN/OA/NDMC/202308/133-0', docDate: '14.08.2023', docType: 'DW', companyCode: '1000', postingDate: '14.08.2023', currency: 'INR', reference: 'BLTR_OA-NDMC', headerText: 'SJVN/OA/NDMC/202308/133-0', postingKey: '01', customerNo: '1004872' },
  { desc: 'SJVN/OA/NDMC/202310/010-0', docDate: '09.10.2023', docType: 'DW', companyCode: '1000', postingDate: '09.10.2023', currency: 'INR', reference: 'BLTR_OA-NDMC', headerText: 'SJVN/OA/NDMC/202310/010-0', postingKey: '01', customerNo: '1004872' },
  { desc: 'SJVN/OA/NDMC/202403/021-0', docDate: '20.03.2024', docType: 'DW', companyCode: '1000', postingDate: '20.03.2024', currency: 'INR', reference: 'BLTR_OA-NDMC', headerText: 'SJVN/OA/NDMC/202403/021-0', postingKey: '01', customerNo: '1004872' },
  { desc: 'SJVN/OA/NDMC/202403/030-0', docDate: '21.03.2024', docType: 'DW', companyCode: '1000', postingDate: '21.03.2024', currency: 'INR', reference: 'BLTR_OA-NDMC', headerText: 'SJVN/OA/NDMC/202403/030-0', postingKey: '01', customerNo: '1004872' },
  { desc: 'SJVN/OA/NDMC/202403/068-0', docDate: '21.03.2024', docType: 'DW', companyCode: '1000', postingDate: '21.03.2024', currency: 'INR', reference: 'BLTR_OA-NDMC', headerText: 'SJVN/OA/NDMC/202403/068-0', postingKey: '01', customerNo: '1004872' },
];

export default function CustomerReceivablesTable() {
  const [date, setDate] = useState('');

  return (
    <div className="p-6 bg-[#f8f9fa] min-h-screen font-sans text-sm">
      <div className="bg-white shadow-sm border border-gray-200 rounded-sm mb-6 max-w-2xl">
        <div className="px-4 py-2 bg-gray-50 border-b border-gray-200">
          <h2 className="font-semibold text-gray-700 text-[13px]">Customer Receivables Format</h2>
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
      <div className="flex gap-2 mb-2">
        <button className="bg-[#5bc0de] hover:bg-[#31b0d5] text-white px-3 py-1 text-xs rounded-full shadow-sm">CSV</button>
        <button className="bg-[#5bc0de] hover:bg-[#31b0d5] text-white px-3 py-1 text-xs rounded-full shadow-sm">Excel</button>
      </div>

      {/* Main Table */}
      <div className="bg-white border border-gray-200 overflow-x-auto shadow-sm">
        <div className="flex justify-end p-2 border-b border-gray-200">
          <div className="flex items-center gap-2">
            <label className="text-gray-600">Search:</label>
            <input type="text" className="border border-gray-300 px-2 py-1 rounded-sm w-48 outline-none focus:border-blue-400" />
          </div>
        </div>
        <table className="w-full text-left border-collapse whitespace-nowrap">
          <thead>
            <tr className="bg-[#66b2ff] text-white">
              <th className="px-4 py-2 border-r border-white/20 font-semibold cursor-pointer hover:bg-blue-400 transition-colors">Description ⇕</th>
              <th className="px-4 py-2 border-r border-white/20 font-semibold cursor-pointer hover:bg-blue-400 transition-colors">Document Date ⇕</th>
              <th className="px-4 py-2 border-r border-white/20 font-semibold cursor-pointer hover:bg-blue-400 transition-colors">Document Type ⇕</th>
              <th className="px-4 py-2 border-r border-white/20 font-semibold cursor-pointer hover:bg-blue-400 transition-colors">Company Code ⇕</th>
              <th className="px-4 py-2 border-r border-white/20 font-semibold cursor-pointer hover:bg-blue-400 transition-colors">Posting Date ⇕</th>
              <th className="px-4 py-2 border-r border-white/20 font-semibold cursor-pointer hover:bg-blue-400 transition-colors">Currency ⇕</th>
              <th className="px-4 py-2 border-r border-white/20 font-semibold cursor-pointer hover:bg-blue-400 transition-colors">Reference ⇕</th>
              <th className="px-4 py-2 border-r border-white/20 font-semibold cursor-pointer hover:bg-blue-400 transition-colors">Document Header Text ⇕</th>
              <th className="px-4 py-2 border-r border-white/20 font-semibold cursor-pointer hover:bg-blue-400 transition-colors">Posting Key ⇕</th>
              <th className="px-4 py-2 border-r border-white/20 font-semibold cursor-pointer hover:bg-blue-400 transition-colors">SAP Customer No ⇕</th>
              <th className="px-4 py-2 border-r border-white/20 font-semibold cursor-pointer hover:bg-blue-400 transition-colors">Customer Name ⇕</th>
              <th className="px-4 py-2 border-r border-white/20 font-semibold cursor-pointer hover:bg-blue-400 transition-colors">Reference GL ⇕</th>
              <th className="px-4 py-2 font-semibold cursor-pointer hover:bg-blue-400 transition-colors">PAN ⇕</th>
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
                <td className="px-4 py-2.5">{row.customerNo}</td>
                <td className="px-4 py-2.5"></td>
                <td className="px-4 py-2.5"></td>
                <td className="px-4 py-2.5"></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
