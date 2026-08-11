import React from 'react';

const DEMO_DATA = [
  {
    id: 1,
    clientId: 'Demo Value',
    clientName: 'Demo Value',
    category: 'Demo Value',
    contactPerson: 'Demo Value',
    contactPhone: 'Demo Value',
    regOfficeAddress: 'Demo Value',
    regUnitAddress: 'Demo Value',
    phoneNumber: 'Demo Value',
    emailId: 'Demo Value',
    accountNo: 'Demo Value',
    ifscCode: 'Demo Value'
  }
];

export default function ClientDetails() {
  return (
    <div className="p-6 bg-[#f8f9fa] min-h-screen font-sans text-[13px]">
      <div className="bg-white border border-gray-200 shadow-sm w-full mx-auto rounded-sm">
        
        {/* Header Title */}
        <div className="bg-white px-4 py-3 text-gray-700 font-semibold border-b border-gray-200">
          Client Details
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
                <th className="px-3 py-2 border-r border-white/20 font-semibold cursor-pointer hover:bg-blue-400">Sr. No. ⇕</th>
                <th className="px-3 py-2 border-r border-white/20 font-semibold cursor-pointer hover:bg-blue-400">Client ID ⇕</th>
                <th className="px-3 py-2 border-r border-white/20 font-semibold cursor-pointer hover:bg-blue-400">Client Name ⇕</th>
                <th className="px-3 py-2 border-r border-white/20 font-semibold cursor-pointer hover:bg-blue-400">Category ⇕</th>
                <th className="px-3 py-2 border-r border-white/20 font-semibold cursor-pointer hover:bg-blue-400">Contact Person Name ⇕</th>
                <th className="px-3 py-2 border-r border-white/20 font-semibold cursor-pointer hover:bg-blue-400">Contact Person phone No ⇕</th>
                <th className="px-3 py-2 border-r border-white/20 font-semibold cursor-pointer hover:bg-blue-400">Registered Office Address ⇕</th>
                <th className="px-3 py-2 border-r border-white/20 font-semibold cursor-pointer hover:bg-blue-400">Registered Unit Address ⇕</th>
                <th className="px-3 py-2 border-r border-white/20 font-semibold cursor-pointer hover:bg-blue-400">Phone Number ⇕</th>
                <th className="px-3 py-2 border-r border-white/20 font-semibold cursor-pointer hover:bg-blue-400">Email Id ⇕</th>
                <th className="px-3 py-2 border-r border-white/20 font-semibold cursor-pointer hover:bg-blue-400">Account No ⇕</th>
                <th className="px-3 py-2 font-semibold cursor-pointer hover:bg-blue-400">IFSC Code ⇕</th>
              </tr>
            </thead>
            <tbody>
              {DEMO_DATA.map((row) => (
                <tr key={row.id} className="border-b border-gray-200 text-gray-700 hover:bg-gray-50">
                  <td className="px-3 py-2 border-r border-gray-200">{row.id}</td>
                  <td className="px-3 py-2 border-r border-gray-200">{row.clientId}</td>
                  <td className="px-3 py-2 border-r border-gray-200">{row.clientName}</td>
                  <td className="px-3 py-2 border-r border-gray-200">{row.category}</td>
                  <td className="px-3 py-2 border-r border-gray-200">{row.contactPerson}</td>
                  <td className="px-3 py-2 border-r border-gray-200">{row.contactPhone}</td>
                  <td className="px-3 py-2 border-r border-gray-200">{row.regOfficeAddress}</td>
                  <td className="px-3 py-2 border-r border-gray-200">{row.regUnitAddress}</td>
                  <td className="px-3 py-2 border-r border-gray-200">{row.phoneNumber}</td>
                  <td className="px-3 py-2 border-r border-gray-200">{row.emailId}</td>
                  <td className="px-3 py-2 border-r border-gray-200">{row.accountNo}</td>
                  <td className="px-3 py-2">{row.ifscCode}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

      </div>
    </div>
  );
}
