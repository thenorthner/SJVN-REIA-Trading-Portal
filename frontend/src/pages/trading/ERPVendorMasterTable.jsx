import React, { useState } from 'react';

const DUMMY_DATA = [
  { type: 'Discom', firstName: 'DOP, Govt. of Arunachal Pradesh', lastName: '', lang: 'EN', searchTerm: 'DOP, Govt. of Arunachal Pradesh' },
  { type: 'Discom', firstName: 'Himachal Pradesh State Electricity Board Ltd.', lastName: '', lang: 'EN', searchTerm: 'Himachal Pradesh State Electricity Board Ltd.' },
  { type: 'Generator', firstName: 'BALRAMPUR CHINI MILLS LTD', lastName: '', lang: 'EN', searchTerm: 'BALRAMPUR CHINI MILLS LTD' },
  { type: 'Generator', firstName: 'Balrampur Chini Mills Ltd. Unit HCM', lastName: '', lang: 'EN', searchTerm: 'Balrampur Chini Mills Ltd. Unit HCM' },
  { type: 'Generator', firstName: 'Dikchu Hydro Electric Project (Sneha Kinetic Power Projects Pvt. Ltd.)', lastName: '', lang: 'EN', searchTerm: 'Dikchu Hydro Electric Project (Sneha Kinetic Power Projects Pvt. Ltd.)' },
  { type: 'Generator', firstName: 'India Power Corporation Limited', lastName: '', lang: 'EN', searchTerm: 'India Power Corporation Limited' },
  { type: 'Generator', firstName: 'Indian Oil Corporation Limited', lastName: '', lang: 'EN', searchTerm: 'Indian Oil Corporation Limited' },
  { type: 'Generator', firstName: 'NSL Krishnaveni sugars limited', lastName: '', lang: 'EN', searchTerm: 'NSL Krishnaveni sugars limited' },
  { type: 'Generator', firstName: 'NTPC Renewable Energy Limited_KPS3', lastName: '', lang: 'EN', searchTerm: 'NTPC Renewable Energy Limited_KPS3' },
  { type: 'Generator', firstName: 'Ostro Kannada Power Private Limited', lastName: '', lang: 'EN', searchTerm: 'Ostro Kannada Power Private Limited' },
  { type: 'Generator', firstName: 'ReNew Surya Ravi Private Limited', lastName: '', lang: 'EN', searchTerm: 'ReNew Surya Ravi Private Limited' },
  { type: 'Generator', firstName: 'Shivashakti Sugars Limited', lastName: '', lang: 'EN', searchTerm: 'Shivashakti Sugars Limited' },
  { type: 'Generator', firstName: 'Shree Renuka Sugars Limited Athani', lastName: '', lang: 'EN', searchTerm: 'Shree Renuka Sugars Limited Athani' },
  { type: 'Generator', firstName: 'SHREE RENUKA SUGARS LIMITED HAVALGA', lastName: '', lang: 'EN', searchTerm: 'SHREE RENUKA SUGARS LIMITED HAVALGA' },
];

export default function ERPVendorMasterTable() {
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  return (
    <div className="p-6 bg-[#f8f9fa] min-h-screen font-sans text-sm">
      <div className="bg-white shadow-sm border border-gray-200 rounded-sm mb-6 max-w-2xl">
        <div className="px-4 py-2 bg-gray-50 border-b border-gray-200">
          <h2 className="font-semibold text-gray-700 text-[13px]">Vendor Format</h2>
        </div>
        <div className="p-4">
          <div className="mb-4 max-w-xs">
            <label className="block text-[12px] text-red-600 mb-1">Client Creation Date --From*</label>
            <input 
              type="date" 
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="w-full border border-gray-300 rounded px-2 py-1.5 text-gray-700 outline-none focus:border-blue-400"
            />
          </div>
          <div className="mb-4 max-w-xs">
            <label className="block text-[12px] text-red-600 mb-1">Client Creation Date --To*</label>
            <input 
              type="date" 
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="w-full border border-gray-300 rounded px-2 py-1.5 text-gray-700 outline-none focus:border-blue-400"
            />
          </div>
          <button className="bg-[#3399ff] hover:bg-blue-500 text-white px-4 py-1.5 rounded-sm font-medium transition-colors mt-2">
            Download
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

      {/* Main Data Table */}
      <div className="bg-white border border-gray-200 overflow-x-auto shadow-sm rounded-b-sm">
        <table className="w-full text-left border-collapse whitespace-nowrap text-[13px]">
          <thead>
            {/* Super Header */}
            <tr className="bg-[#66b2ff] text-white">
              <th className="px-4 py-2 border-r border-b border-white/20 font-semibold" colSpan="7">FLVN00 (FI Vendor)</th>
            </tr>
            <tr className="bg-[#66b2ff] text-white">
              <th className="px-4 py-2 border-r border-b border-white/20 font-semibold" colSpan="7">General</th>
            </tr>
            {/* Sub Headers */}
            <tr className="bg-[#66b2ff] text-white text-[12px]">
              <th className="px-4 py-2 border-r border-white/20 font-semibold cursor-pointer hover:bg-blue-400">Vendor Type ⇕</th>
              <th className="px-4 py-2 border-r border-white/20 font-semibold cursor-pointer hover:bg-blue-400">PARTNER_ROLE<br/>BP Role ⇕</th>
              <th className="px-4 py-2 border-r border-white/20 font-semibold cursor-pointer hover:bg-blue-400">CREATION_GROUP<br/>Grouping ⇕</th>
              <th className="px-4 py-2 border-r border-white/20 font-semibold cursor-pointer hover:bg-blue-400">NAME_FIRST<br/>First Name ⇕</th>
              <th className="px-4 py-2 border-r border-white/20 font-semibold cursor-pointer hover:bg-blue-400">NAME_LAST<br/>Last Name ⇕</th>
              <th className="px-4 py-2 border-r border-white/20 font-semibold cursor-pointer hover:bg-blue-400">LANGUOCORR<br/>Correspondence Lang ⇕</th>
              <th className="px-4 py-2 font-semibold cursor-pointer hover:bg-blue-400">BU_SORT1_TXT<br/>Search Term/ Old Vendor No. ⇕</th>
            </tr>
          </thead>
          <tbody>
            {DUMMY_DATA.map((row, idx) => (
              <tr key={idx} className="border-b border-gray-100 hover:bg-gray-50 text-gray-700">
                <td className="px-4 py-2.5">{row.type}</td>
                <td className="px-4 py-2.5"></td>
                <td className="px-4 py-2.5"></td>
                <td className="px-4 py-2.5">{row.firstName}</td>
                <td className="px-4 py-2.5">{row.lastName}</td>
                <td className="px-4 py-2.5">{row.lang}</td>
                <td className="px-4 py-2.5">{row.searchTerm}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
