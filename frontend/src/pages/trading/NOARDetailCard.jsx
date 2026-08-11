import React from 'react';
import { useParams } from 'react-router-dom';

export default function NOARDetailCard() {
  const { id } = useParams();

  const applicationDetails = {
    applicationNo: id || 'SJVN010424NR1690',
    applicantName: 'SJVN Limited',
    sellerName: 'ReNew Surya Ravi Private Limited',
    buyerName: 'New Delhi Municipal Council',
    primaryRoute: 'NR-NR',
    alternateRoute: '',
    fromDate: '01-April-2024',
    toDate: '01-April-2024',
    appliedCapacity: '437.775',
    approvedCapacity: '437.775',
    paidAmount: '207322.0',
    tdsPaid: '20732.0',
  };

  const chargesDetails = [
    { id: 1, name: 'APP FEES', payable: '5000.0', paid: '4500.0', tds: '500.0', due: '04-April-2024' },
    { id: 2, name: 'Delhi ISTS', payable: '202322.0', paid: '182090.0', tds: '20232.0', due: '04-April-2024' },
  ];

  return (
    <div className="p-6 bg-[#f8f9fa] min-h-screen font-sans text-sm">
      <div className="bg-white border border-gray-200 shadow-sm rounded-sm max-w-6xl mx-auto">
        
        {/* Header */}
        <div className="bg-[#66b2ff] text-white px-4 py-2 flex items-center justify-center font-semibold tracking-wide">
          NOAR Approvals Details
        </div>

        {/* Top Overview Grid */}
        <div className="p-0 border-b border-gray-200">
          <div className="grid grid-cols-3 divide-x divide-y divide-gray-200">
            {/* Row 1 */}
            <div className="flex border-t-0 border-l-0">
              <div className="w-1/3 bg-[#f2f2f2] p-2 font-semibold text-gray-700 flex items-center">Application No:</div>
              <div className="w-2/3 p-2 flex items-center text-gray-600">{applicationDetails.applicationNo}</div>
            </div>
            <div className="flex border-t-0">
              <div className="w-1/3 bg-[#f2f2f2] p-2 font-semibold text-gray-700 flex items-center">Applicant Name:</div>
              <div className="w-2/3 p-2 flex items-center text-gray-600">{applicationDetails.applicantName}</div>
            </div>
            <div className="flex border-t-0">
              <div className="w-1/3 bg-[#f2f2f2] p-2 font-semibold text-gray-700 flex items-center">Seller Name:</div>
              <div className="w-2/3 p-2 flex items-center text-gray-600">{applicationDetails.sellerName}</div>
            </div>

            {/* Row 2 */}
            <div className="flex border-l-0">
              <div className="w-1/3 bg-[#f2f2f2] p-2 font-semibold text-gray-700 flex items-center">Buyer Name:</div>
              <div className="w-2/3 p-2 flex items-center text-gray-600">{applicationDetails.buyerName}</div>
            </div>
            <div className="flex">
              <div className="w-1/3 bg-[#f2f2f2] p-2 font-semibold text-gray-700 flex items-center">Primary Route:</div>
              <div className="w-2/3 p-2 flex items-center text-gray-600">{applicationDetails.primaryRoute}</div>
            </div>
            <div className="flex">
              <div className="w-1/3 bg-[#f2f2f2] p-2 font-semibold text-gray-700 flex items-center">Alternate Route:</div>
              <div className="w-2/3 p-2 flex items-center text-gray-600">{applicationDetails.alternateRoute}</div>
            </div>

            {/* Row 3 */}
            <div className="flex border-l-0">
              <div className="w-1/3 bg-[#f2f2f2] p-2 font-semibold text-gray-700 flex items-center">From Date:</div>
              <div className="w-2/3 p-2 flex items-center text-gray-600">{applicationDetails.fromDate}</div>
            </div>
            <div className="flex">
              <div className="w-1/3 bg-[#f2f2f2] p-2 font-semibold text-gray-700 flex items-center">To Date:</div>
              <div className="w-2/3 p-2 flex items-center text-gray-600">{applicationDetails.toDate}</div>
            </div>
            <div className="flex">
              <div className="w-1/3 bg-[#f2f2f2] p-2 font-semibold text-gray-700 flex items-center">Applied Capacity (MWh):</div>
              <div className="w-2/3 p-2 flex items-center text-gray-600">{applicationDetails.appliedCapacity}</div>
            </div>

            {/* Row 4 */}
            <div className="flex border-l-0 border-b-0">
              <div className="w-1/3 bg-[#f2f2f2] p-2 font-semibold text-gray-700 flex items-center">Approved Capacity (MWh):</div>
              <div className="w-2/3 p-2 flex items-center text-gray-600">{applicationDetails.approvedCapacity}</div>
            </div>
            <div className="flex border-b-0">
              <div className="w-1/3 bg-[#f2f2f2] p-2 font-semibold text-gray-700 flex items-center">Paid Amount:</div>
              <div className="w-2/3 p-2 flex items-center text-gray-600">{applicationDetails.paidAmount}</div>
            </div>
            <div className="flex border-b-0">
              <div className="w-1/3 bg-[#f2f2f2] p-2 font-semibold text-gray-700 flex items-center">TDS Paid:</div>
              <div className="w-2/3 p-2 flex items-center text-gray-600">{applicationDetails.tdsPaid}</div>
            </div>
          </div>
        </div>

        {/* Secondary Header */}
        <div className="bg-[#66b2ff] text-white px-4 py-2 flex items-center justify-center font-semibold tracking-wide">
          Charges Details
        </div>

        {/* Charges Table */}
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-[#66b2ff] text-white">
              <th className="px-4 py-2 font-semibold border-r border-white/20">#</th>
              <th className="px-4 py-2 font-semibold border-r border-white/20">Charge Name</th>
              <th className="px-4 py-2 font-semibold border-r border-white/20">Payable Amount</th>
              <th className="px-4 py-2 font-semibold border-r border-white/20">Amount Paid</th>
              <th className="px-4 py-2 font-semibold border-r border-white/20">TDS Paid</th>
              <th className="px-4 py-2 font-semibold">Due Date</th>
            </tr>
          </thead>
          <tbody>
            {chargesDetails.map((charge, idx) => (
              <tr key={idx} className="border-b border-gray-100 text-gray-700 hover:bg-gray-50">
                <td className="px-4 py-3">{charge.id}</td>
                <td className="px-4 py-3">{charge.name}</td>
                <td className="px-4 py-3">{charge.payable}</td>
                <td className="px-4 py-3">{charge.paid}</td>
                <td className="px-4 py-3">{charge.tds}</td>
                <td className="px-4 py-3">{charge.due}</td>
              </tr>
            ))}
            {/* Total Row */}
            <tr className="bg-gray-50 font-semibold text-gray-700 border-b-4 border-gray-200">
              <td className="px-4 py-3" colSpan="2">Total</td>
              <td className="px-4 py-3">207322.0</td>
              <td className="px-4 py-3">186590.0</td>
              <td className="px-4 py-3">20732.0</td>
              <td className="px-4 py-3"></td>
            </tr>
          </tbody>
        </table>

      </div>
    </div>
  );
}
