import React from 'react';

const DUMMY_DATA = [
  { id: 1, contract: 'LOAIOCLNDMC29042023', entity: 'New Delhi Municipal Council', appNo: 'AD20230602', approvalNo: 'NR/2023/13149/C', approved: 200, rea: 200, rldc: 200, status: 'Done' },
  { id: 2, contract: 'LOAIOCLNDMC29042023', entity: 'New Delhi Municipal Council', appNo: 'AD20230603', approvalNo: 'NR/2023/13223/D', approved: 400, rea: 400, rldc: 400, status: 'Done' },
  { id: 3, contract: 'LOAIOCLNDMC29042023', entity: 'New Delhi Municipal Council', appNo: 'AD20230605', approvalNo: 'NR/2023/13424/C', approved: 200, rea: 180, rldc: 180, status: 'Pending' },
  { id: 4, contract: 'LOAIOCLNDMC29042023', entity: 'New Delhi Municipal Council', appNo: 'AD20230606', approvalNo: 'NR/2023/13145/F', approved: 5000, rea: 5000, rldc: 5000, status: 'Done' },
];

export default function REAReconciliationGrid() {
  return (
    <div className="p-6 bg-[#f8f9fa] min-h-screen font-sans text-sm">
      <div className="bg-white border border-gray-200 shadow-sm max-w-6xl mx-auto rounded-sm">
        
        {/* Header Title */}
        <div className="bg-[#2b5682] text-white px-4 py-2 font-semibold tracking-wide">
          REA/SEA Reconciliation
        </div>

        {/* Filters */}
        <div className="p-4 border-b border-gray-200 flex flex-wrap gap-6 items-end">
          <div className="w-48">
            <label className="block text-red-600 mb-1 text-[12px] font-medium">Month*</label>
            <input type="text" value="June 2023" readOnly className="w-full border border-gray-300 rounded-sm px-3 py-1.5 text-gray-700 outline-none" />
          </div>
          <div className="w-48">
            <label className="block text-red-600 mb-1 text-[12px] font-medium">Year*</label>
            <input type="text" value="June 2023" readOnly className="w-full border border-gray-300 rounded-sm px-3 py-1.5 text-gray-700 outline-none" />
          </div>
          <div className="flex-1 max-w-md">
            <label className="block text-red-600 mb-1 text-[12px] font-medium">Entity Name*</label>
            <input type="text" value="New Delhi Municipal Council" readOnly className="w-full border border-gray-300 rounded-sm px-3 py-1.5 text-gray-700 outline-none" />
          </div>
          <div className="mb-0.5">
            <button className="bg-[#3399ff] hover:bg-blue-500 text-white px-6 py-1.5 rounded-sm font-medium transition-colors">
              Search
            </button>
          </div>
        </div>

        {/* Main Data Grid */}
        <div className="overflow-x-auto p-4">
          <table className="w-full text-center border-collapse whitespace-nowrap text-[13px]">
            <thead>
              <tr className="bg-[#66b2ff] text-white">
                <th className="px-3 py-3 border-r border-white/20 font-semibold cursor-pointer hover:bg-blue-400 w-12">#</th>
                <th className="px-3 py-3 border-r border-white/20 font-semibold cursor-pointer hover:bg-blue-400">Contract No</th>
                <th className="px-3 py-3 border-r border-white/20 font-semibold cursor-pointer hover:bg-blue-400">Name Of The Entity</th>
                <th className="px-3 py-3 border-r border-white/20 font-semibold cursor-pointer hover:bg-blue-400">Application Number</th>
                <th className="px-3 py-3 border-r border-white/20 font-semibold cursor-pointer hover:bg-blue-400">Approval Number</th>
                <th className="px-3 py-3 border-r border-white/20 font-semibold cursor-pointer hover:bg-blue-400">Approved Energy(MWh)</th>
                <th className="px-3 py-3 border-r border-white/20 font-semibold cursor-pointer hover:bg-blue-400">Energy As Per REA(MWh)</th>
                <th className="px-3 py-3 border-r border-white/20 font-semibold cursor-pointer hover:bg-blue-400">Current Energy As Per RLDC Schedule(MWh)</th>
                <th className="px-3 py-3 font-semibold cursor-pointer hover:bg-blue-400">Reconciliation Status</th>
              </tr>
            </thead>
            <tbody>
              {DUMMY_DATA.map((row) => (
                <tr key={row.id} className="border-b border-gray-100 hover:bg-gray-50 text-gray-700">
                  <td className="px-3 py-3 border-r border-gray-100">{row.id}</td>
                  <td className="px-3 py-3 border-r border-gray-100">{row.contract}</td>
                  <td className="px-3 py-3 border-r border-gray-100 text-left">{row.entity}</td>
                  <td className="px-3 py-3 border-r border-gray-100">{row.appNo}</td>
                  <td className="px-3 py-3 border-r border-gray-100">{row.approvalNo}</td>
                  <td className="px-3 py-3 border-r border-gray-100">{row.approved}</td>
                  <td className="px-3 py-3 border-r border-gray-100">{row.rea}</td>
                  <td className="px-3 py-3 border-r border-gray-100">{row.rldc}</td>
                  <td className="px-3 py-3 font-medium">
                    {row.status === 'Pending' ? (
                      <span className="text-amber-600">Pending</span>
                    ) : (
                      <span className="text-gray-700">{row.status}</span>
                    )}
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
