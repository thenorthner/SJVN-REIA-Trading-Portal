import React from 'react';
import { useNavigate } from 'react-router-dom';

const DUMMY_DATA = [
  { id: 1, client: 'New Delhi Municipal Council', invoiceNo: 'SJVN/EXCHANGE/OA/NDMC/202412/040', amount: '0.00', invoiceDate: '30-Dec-2024', dueDate: '06-Jan-2025', supplyFrom: '27-Dec-2024', supplyTo: '27-Dec-2024', generatedOn: '30-Dec-2024 03:02', detailId: 'SJVN_EXCHANGE_OA_NDMC_202412_040' },
  { id: 2, client: 'New Delhi Municipal Council', invoiceNo: 'SJVN/EXCHANGE/OA/NDMC/202411/002', amount: '0.00', invoiceDate: '18-Nov-2024', dueDate: '25-Nov-2024', supplyFrom: '09-Nov-2024', supplyTo: '15-Nov-2024', generatedOn: '18-Nov-2024 10:16', detailId: 'SJVN_EXCHANGE_OA_NDMC_202411_002' },
  { id: 3, client: 'Kreate Energy (I) Pvt. Ltd.', invoiceNo: 'SJVN/EXCHANGE/OA/KREATE/202412/025', amount: '0.00', invoiceDate: '16-Dec-2024', dueDate: '23-Dec-2024', supplyFrom: '09-Dec-2024', supplyTo: '15-Dec-2024', generatedOn: '16-Dec-2024 03:04', detailId: 'SJVN_EXCHANGE_OA_KREATE_202412_025' },
  { id: 4, client: 'New Delhi Municipal Council', invoiceNo: 'SJVN/EXCHANGE/OA/NDMC/202308/067', amount: '0.00', invoiceDate: '06-Aug-2023', dueDate: '13-Aug-2023', supplyFrom: '04-Aug-2023', supplyTo: '06-Aug-2023', generatedOn: '06-Aug-2023 11:37', detailId: 'SJVN_EXCHANGE_OA_NDMC_202308_067' },
];

export default function OpenAccessInvoiceViewer() {
  const navigate = useNavigate();

  return (
    <div className="p-6 bg-[#f8f9fa] min-h-screen font-sans text-[13px]">
      <div className="bg-white border border-gray-200 shadow-sm max-w-[1400px] mx-auto rounded-sm">
        
        {/* Header Title */}
        <div className="bg-[#66b2ff] text-white px-4 py-2 font-semibold flex items-center justify-center tracking-widest text-sm">
          Buyer :: Invoice Details
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
                <th className="px-3 py-3 border-r border-white/20 font-semibold">View</th>
                <th className="px-3 py-3 border-r border-white/20 font-semibold">Edit</th>
                <th className="px-3 py-3 font-semibold">Cancel</th>
              </tr>
            </thead>
            <tbody>
              {DUMMY_DATA.map((row) => (
                <tr key={row.id} className="border-b border-gray-100 hover:bg-gray-50 text-gray-700">
                  <td className="px-3 py-3 border-r border-gray-100">{row.id}</td>
                  <td className="px-3 py-3 border-r border-gray-100 text-left font-medium">{row.client}</td>
                  <td className="px-3 py-3 border-r border-gray-100 text-left">{row.invoiceNo}</td>
                  <td className="px-3 py-3 border-r border-gray-100">{row.amount}</td>
                  <td className="px-3 py-3 border-r border-gray-100">{row.invoiceDate}</td>
                  <td className="px-3 py-3 border-r border-gray-100">{row.dueDate}</td>
                  <td className="px-3 py-3 border-r border-gray-100">{row.supplyFrom}</td>
                  <td className="px-3 py-3 border-r border-gray-100">{row.supplyTo}</td>
                  <td className="px-3 py-3 border-r border-gray-100">{row.generatedOn}</td>
                  <td className="px-3 py-3 border-r border-gray-100">
                    <button 
                      onClick={() => navigate(`/invoices/open-access/${row.detailId}`)}
                      className="text-blue-500 hover:text-blue-700 flex items-center justify-center w-full" title="View PDF">
                      👁️
                    </button>
                  </td>
                  <td className="px-3 py-3 border-r border-gray-100">
                    <button className="text-blue-500 hover:text-blue-700" title="Edit">
                      Edit
                    </button>
                  </td>
                  <td className="px-3 py-3">
                    <button className="text-blue-500 hover:text-blue-700 flex items-center justify-center w-full" title="Cancel">
                      👁️ {/* Assuming eye icon for cancel in screenshot logic, though usually cross */}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination Footer */}
        <div className="bg-gray-50 px-4 py-2 text-gray-500 text-xs border-t border-gray-200 rounded-b-sm">
          Showing 1 to {DUMMY_DATA.length} of {DUMMY_DATA.length} entries
        </div>

      </div>
    </div>
  );
}
