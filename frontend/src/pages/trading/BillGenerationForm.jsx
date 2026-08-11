import React, { useState } from 'react';

const CLIENTS = [
  'Arunachal Pradesh Power Corporation Pvt. Ltd.',
  'BALRAMPUR CHINI MILLS LTD',
  'Balrampur Chini Mills Ltd. Unit HCM',
  'CARBON RESOURCES PVT. LTD.',
  'Dikchu Hydro Electric Project (Sneha Kinetic Power Projects Pvt. Ltd.)',
  'DOP, Govt. of Arunachal Pradesh',
  'ELECTROTHERM (INDIA) LIMITED',
  'ELOQUENT STEEL PRIVATE LIMITED',
  'Fortis Hospotel Limited',
  'GACL NALCO Alkalies & Chemicals Pvt Ltd Cons.No.63869',
  'Himachal Pradesh State Electricity Board Ltd.',
  'HINDUSTHAN NATIONAL GLASS & INDUSTRIES LIMITED HARYANA',
  'India Power Corporation Limited',
  'Indian Oil Corporation Limited',
  'Kreate Energy (I) Pvt. Ltd.'
];

export default function BillGenerationForm() {
  const [formData, setFormData] = useState({
    startDate: '',
    endDate: '',
    client: '',
    contractId: '',
    billType: '',
    lps: 'No'
  });

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    console.log('Generating bill:', formData);
    // Add logic here to generate the actual bill
  };

  return (
    <div className="p-6 bg-[#f8f9fa] min-h-screen font-sans text-[13px]">
      <div className="bg-white border border-gray-200 shadow-sm max-w-[800px] mx-auto rounded-sm">
        
        {/* Header Title */}
        <div className="bg-[#244b7d] text-white px-4 py-2 font-semibold">
          Bill Generation
        </div>

        {/* Form Body */}
        <div className="p-6">
          <form onSubmit={handleSubmit} className="space-y-4 max-w-[600px] mx-auto">
            
            {/* Start Date */}
            <div className="flex items-center">
              <label className="w-48 text-gray-700">Start Date<span className="text-red-500">*</span></label>
              <div className="flex-1">
                <input 
                  type="date" 
                  name="startDate"
                  value={formData.startDate}
                  onChange={handleChange}
                  className="w-full border border-gray-300 rounded-sm px-3 py-1.5 outline-none focus:border-blue-400 text-gray-600 uppercase"
                />
              </div>
            </div>

            {/* End Date */}
            <div className="flex items-center">
              <label className="w-48 text-gray-700">End Date<span className="text-red-500">*</span></label>
              <div className="flex-1">
                <input 
                  type="date" 
                  name="endDate"
                  value={formData.endDate}
                  onChange={handleChange}
                  className="w-full border border-gray-300 rounded-sm px-3 py-1.5 outline-none focus:border-blue-400 text-gray-600 uppercase"
                />
              </div>
            </div>

            {/* Client */}
            <div className="flex items-center">
              <label className="w-48 text-gray-700">Client<span className="text-red-500">*</span></label>
              <div className="flex-1 relative">
                <select 
                  name="client"
                  value={formData.client}
                  onChange={handleChange}
                  className="w-full border border-blue-400 rounded-sm px-3 py-1.5 outline-none focus:border-blue-500 bg-blue-50/20 text-gray-700 appearance-none shadow-[0_0_5px_rgba(59,130,246,0.3)]"
                >
                  <option value="">- select an option -</option>
                  {CLIENTS.map(client => (
                    <option key={client} value={client}>{client}</option>
                  ))}
                </select>
                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-gray-600">
                  <svg className="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z"/></svg>
                </div>
              </div>
            </div>

            {/* Contract Id */}
            <div className="flex items-center">
              <label className="w-48 text-gray-700">Contract Id<span className="text-red-500">*</span></label>
              <div className="flex-1">
                <select 
                  name="contractId"
                  value={formData.contractId}
                  onChange={handleChange}
                  className="w-full border border-blue-400 rounded-sm px-3 py-1.5 outline-none focus:border-blue-500 bg-blue-50/20 text-gray-700 appearance-none"
                >
                  <option value="">-- select an option --</option>
                  <option value="contract_1">Contract 1</option>
                  <option value="contract_2">Contract 2</option>
                </select>
              </div>
            </div>

            {/* Bill Type */}
            <div className="flex items-center">
              <label className="w-48 text-gray-700">Bill Type<span className="text-red-500">*</span></label>
              <div className="flex-1">
                <select 
                  name="billType"
                  value={formData.billType}
                  onChange={handleChange}
                  className="w-full border border-gray-300 rounded-sm px-3 py-1.5 outline-none focus:border-blue-400 text-gray-700 appearance-none"
                >
                  <option value="">-- select an option --</option>
                  <option value="Bilateral Energy Settlement">Bilateral Energy Settlement</option>
                  <option value="Bilateral Open Access">Bilateral Open Access</option>
                  <option value="Bilateral SLDC Consent Fee">Bilateral SLDC Consent Fee</option>
                  <option value="Exchange Energy Settlement">Exchange Energy Settlement</option>
                  <option value="Exchange Open Access">Exchange Open Access</option>
                  <option value="Exchange Trading Margin">Exchange Trading Margin</option>
                </select>
              </div>
            </div>

            {/* Whether LPS */}
            <div className="flex items-center">
              <label className="w-48 text-gray-700">Whether LPS<span className="text-red-500">*</span></label>
              <div className="flex-1 flex gap-4">
                <label className="flex items-center gap-1 cursor-pointer">
                  <input 
                    type="radio" 
                    name="lps" 
                    value="Yes" 
                    checked={formData.lps === 'Yes'} 
                    onChange={handleChange}
                    className="cursor-pointer"
                  />
                  Yes
                </label>
                <label className="flex items-center gap-1 cursor-pointer">
                  <input 
                    type="radio" 
                    name="lps" 
                    value="No" 
                    checked={formData.lps === 'No'} 
                    onChange={handleChange}
                    className="cursor-pointer"
                  />
                  No
                </label>
              </div>
            </div>

            {/* Submit Button */}
            <div className="flex justify-center pt-6 pb-4">
              <button 
                type="submit"
                className="bg-[#007bff] hover:bg-[#0056b3] text-white px-6 py-2 rounded-sm shadow-md font-medium transition-colors"
              >
                Generate Bill
              </button>
            </div>

          </form>
        </div>

      </div>
    </div>
  );
}
