import React from 'react';

const DUMMY_DATA = [
  { sno: 1, appNo: 'SJVN/2023-24/30/07062023', fee: '5000.0', approval: 'NR/2023/13369/F', a: '38000.0', b: '0.0', c: '905920.0', d: '1453652.0', e: '19000.0', f: '19000.0', total: '2440572.0', vendor: 'GRID_INDIA' },
  { sno: 2, appNo: 'SJVN/2023-24/66/30072023', fee: '5000.0', approval: 'NR/2023/15380/C', a: '2000.0', b: '0.0', c: '68000.0', d: '26012.72', e: '1000.0', f: '1000.0', total: '103012.72', vendor: 'GRID_INDIA' },
  { sno: 3, appNo: 'SJVN/2023-24/62/29072023', fee: '5000.0', approval: 'NR/2023/15353/C', a: '2000.0', b: '0.0', c: '68000.0', d: '26012.72', e: '1000.0', f: '1000.0', total: '103012.72', vendor: 'GRID_INDIA' },
  { sno: 4, appNo: 'SJVN/2023-24/61/29072023', fee: '5000.0', approval: 'NR/2023/15355/C', a: '2000.0', b: '0.0', c: '240000.0', d: '91809.6', e: '1000.0', f: '1000.0', total: '340809.6', vendor: 'GRID_INDIA' },
  { sno: 5, appNo: 'SJVN/2023-24/60/28072023', fee: '5000.0', approval: 'NR/2023/15332/C', a: '2000.0', b: '0.0', c: '68000.0', d: '26012.72', e: '1000.0', f: '1000.0', total: '103012.72', vendor: 'GRID_INDIA' },
  { sno: 6, appNo: 'SJVN/2023-24/58/28072023', fee: '5000.0', approval: 'NR/2023/15311/D', a: '2000.0', b: '0.0', c: '240000.0', d: '91809.6', e: '1000.0', f: '1000.0', total: '340809.6', vendor: 'GRID_INDIA' },
  { sno: 7, appNo: 'SJVN/2023-24/65/30072023', fee: '5000.0', approval: 'NR/2023/15381/C', a: '2000.0', b: '0.0', c: '0.0', d: '91809.6', e: '0.0', f: '1000.0', total: '99809.6', vendor: 'GRID_INDIA' },
  { sno: 8, appNo: 'SJVN/2023-24/53/26072023', fee: '5000.0', approval: 'NR/2023/15236/D', a: '0.0', b: '0.0', c: '0.0', d: '0.0', e: '0.0', f: '0.0', total: '0.0', vendor: '' },
  { sno: 9, appNo: 'SJVN010924NR1866', fee: '5000.0', approval: 'NR/2024/22899/A', a: '0.0', b: '0.0', c: '0.0', d: '0.0', e: '0.0', f: '0.0', total: '0.0', vendor: '' },
  { sno: 10, appNo: 'SJVN/2023-24/05/14042023', fee: '5000.0', approval: 'NR/2023/11547/C', a: '0.0', b: '0.0', c: '0.0', d: '0.0', e: '0.0', f: '0.0', total: '0.0', vendor: '' },
  { sno: 11, appNo: 'SJVN290224NR1584', fee: '5000.0', approval: 'NR/2024/18701/C', a: '0.0', b: '0.0', c: '0.0', d: '0.0', e: '0.0', f: '0.0', total: '0.0', vendor: '' },
  { sno: 12, appNo: 'SJVN/2023-24/38/18072023', fee: '5000.0', approval: 'NR/2023/14915/C', a: '2000.0', b: '0.0', c: '47680.0', d: '76508.0', e: '1000.0', f: '1000.0', total: '133188.0', vendor: 'GRID_INDIA' },
];

export default function TDSSummaryLedger() {
  return (
    <div className="p-6 bg-[#f8f9fa] min-h-screen font-sans text-[12px]">
      <div className="bg-white shadow-sm border border-gray-200 rounded-sm">
        
        {/* Header Title */}
        <div className="bg-[#66b2ff] text-white px-4 py-2 flex items-center justify-center font-bold tracking-widest text-[14px]">
          TDS FORMAT REPORT
        </div>

        {/* Action Bar */}
        <div className="flex justify-between items-center p-3 border-b border-gray-200">
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
          <table className="w-full text-left border-collapse whitespace-nowrap">
            <thead>
              <tr className="bg-[#66b2ff] text-white">
                <th className="px-3 py-3 border-r border-white/20 font-semibold cursor-pointer hover:bg-blue-400">S.No. ⇕</th>
                <th className="px-3 py-3 border-r border-white/20 font-semibold cursor-pointer hover:bg-blue-400">Nodal RLDC ⇕</th>
                <th className="px-3 py-3 border-r border-white/20 font-semibold cursor-pointer hover:bg-blue-400">Application No. ⇕</th>
                <th className="px-3 py-3 border-r border-white/20 font-semibold cursor-pointer hover:bg-blue-400">
                  NOAR<br/>Application Fee ⇕
                </th>
                <th className="px-3 py-3 border-r border-white/20 font-semibold cursor-pointer hover:bg-blue-400">Approval No. ⇕</th>
                <th className="px-3 py-3 border-r border-white/20 font-semibold cursor-pointer hover:bg-blue-400">STOA Charges<br/>(POSOCO)(A)</th>
                <th className="px-3 py-3 border-r border-white/20 font-semibold cursor-pointer hover:bg-blue-400">STOA Charges<br/>(CTU)(B)</th>
                <th className="px-3 py-3 border-r border-white/20 font-semibold cursor-pointer hover:bg-blue-400">STOA Charges<br/>(Seller STU)(C)</th>
                <th className="px-3 py-3 border-r border-white/20 font-semibold cursor-pointer hover:bg-blue-400">STOA Charges<br/>(Buyer STU)(D)</th>
                <th className="px-3 py-3 border-r border-white/20 font-semibold cursor-pointer hover:bg-blue-400">STOA Charges<br/>(Seller SLDC)(E)</th>
                <th className="px-3 py-3 border-r border-white/20 font-semibold cursor-pointer hover:bg-blue-400">STOA Charges<br/>(Buyer SLDC)(F)</th>
                <th className="px-3 py-3 border-r border-white/20 font-semibold cursor-pointer hover:bg-blue-400">Total STOA Charges<br/>G=(A+B+C+D+E+F)</th>
                <th className="px-3 py-3 border-r border-white/20 font-semibold cursor-pointer hover:bg-blue-400">Payment Date ⇕</th>
                <th className="px-3 py-3 font-semibold cursor-pointer hover:bg-blue-400">Vendor Code<br/>(POSOCO)</th>
              </tr>
            </thead>
            <tbody>
              {DUMMY_DATA.map((row, idx) => (
                <tr key={idx} className="border-b border-gray-100 hover:bg-gray-50 text-gray-700">
                  <td className="px-3 py-3">{row.sno}</td>
                  <td className="px-3 py-3"></td>
                  <td className="px-3 py-3">{row.appNo}</td>
                  <td className="px-3 py-3">{row.fee}</td>
                  <td className="px-3 py-3">{row.approval}</td>
                  <td className="px-3 py-3">{row.a}</td>
                  <td className="px-3 py-3">{row.b}</td>
                  <td className="px-3 py-3">{row.c}</td>
                  <td className="px-3 py-3">{row.d}</td>
                  <td className="px-3 py-3">{row.e}</td>
                  <td className="px-3 py-3">{row.f}</td>
                  <td className="px-3 py-3">{row.total}</td>
                  <td className="px-3 py-3"></td>
                  <td className="px-3 py-3">{row.vendor}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        
        {/* Pagination Footer */}
        <div className="bg-gray-100 px-4 py-2 text-gray-500 border-t border-gray-200 flex justify-between items-center rounded-b-sm">
          <span>Showing 1 to 12 of 12 entries</span>
          {/* Mock scrollbar to emulate table width if needed */}
        </div>

      </div>
    </div>
  );
}
