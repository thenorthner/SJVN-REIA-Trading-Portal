import React, { useState } from 'react';

export default function UpdatePortfolioID() {
  const [formData, setFormData] = useState({
    clientNameSelect: 'NTPC VIDYUT VYAPAR NIGAM LIMITED',
    exchangeNameSelect: 'IEX',
    portfolioId: '',
    portfolioName: ''
  });

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSave = () => {
    console.log('Saving portfolio mapping:', formData);
  };

  return (
    <div className="p-6 bg-[#f8f9fa] min-h-screen font-sans text-[13px]">
      <div className="bg-white border border-gray-200 shadow-sm max-w-[1400px] mx-auto rounded-sm">
        
        {/* Header Title */}
        <div className="bg-[#244b7d] text-white px-4 py-2 font-semibold">
          Update Portfolio ID
        </div>

        {/* Main Grid Content */}
        <div className="p-4 grid grid-cols-2 gap-4">
          
          {/* Left Panel: Inputs */}
          <div className="border border-gray-200 p-6 space-y-8 min-h-[400px]">
            <div>
              <label className="block text-red-600 font-medium mb-1">Client Name*</label>
              <select 
                name="clientNameSelect"
                value={formData.clientNameSelect}
                onChange={handleChange}
                className="w-full border border-gray-300 rounded-sm px-3 py-1.5 outline-none focus:border-blue-400 text-gray-700 bg-white"
              >
                <option value="">-- select an option --</option>
                <option value="Arunachal Pradesh Power Corporation Pvt. Ltd.">Arunachal Pradesh Power Corporation Pvt. Ltd.</option>
                <option value="BALRAMPUR CHINI MILLS LTD">BALRAMPUR CHINI MILLS LTD</option>
                <option value="Balrampur Chini Mills Ltd. Unit HCM">Balrampur Chini Mills Ltd. Unit HCM</option>
                <option value="CARBON RESOURCES PVT. LTD.">CARBON RESOURCES PVT. LTD.</option>
                <option value="Dikchu Hydro Electric Project (Sneha Kinetic Power Projects Pvt. Ltd.)">Dikchu Hydro Electric Project (Sneha Kinetic Power Projects Pvt. Ltd.)</option>
                <option value="DOP, Govt. of Arunachal Pradesh">DOP, Govt. of Arunachal Pradesh</option>
                <option value="ELECTROTHERM (INDIA) LIMITED">ELECTROTHERM (INDIA) LIMITED</option>
                <option value="ELOQUENT STEEL PRIVATE LIMITED">ELOQUENT STEEL PRIVATE LIMITED</option>
                <option value="Fortis Hospotel Limited">Fortis Hospotel Limited</option>
                <option value="GACL NALCO Alkalies & Chemicals Pvt Ltd Cons.No.63869">GACL NALCO Alkalies & Chemicals Pvt Ltd Cons.No.63869</option>
                <option value="Himachal Pradesh State Electricity Board Ltd.">Himachal Pradesh State Electricity Board Ltd.</option>
                <option value="HINDUSTHAN NATIONAL GLASS & INDUSTRIES LIMITED HARYANA">HINDUSTHAN NATIONAL GLASS & INDUSTRIES LIMITED HARYANA</option>
                <option value="India Power Corporation Limited">India Power Corporation Limited</option>
                <option value="Indian Oil Corporation Limited">Indian Oil Corporation Limited</option>
                <option value="Kreate Energy (I) Pvt. Ltd.">Kreate Energy (I) Pvt. Ltd.</option>
                <option value="M/s Gujarat Alkalies & Chemicals Limited">M/s Gujarat Alkalies & Chemicals Limited</option>
                <option value="M/s. GUJARAT ALKALIES AND CHEMICALS LIMITED - 13032">M/s. GUJARAT ALKALIES AND CHEMICALS LIMITED - 13032</option>
                <option value="Madhyanchal Vidyut Vitaran Nigam Ltd.">Madhyanchal Vidyut Vitaran Nigam Ltd.</option>
                <option value="New Delhi Municipal Council">New Delhi Municipal Council</option>
                <option value="NILKANTH FERRO LIMITED">NILKANTH FERRO LIMITED</option>
                <option value="NSL Krishnaveni sugars limited">NSL Krishnaveni sugars limited</option>
                <option value="NTPC Renewable Energy Limited_KPS3">NTPC Renewable Energy Limited_KPS3</option>
                <option value="NTPC VIDYUT VYAPAR NIGAM LIMITED">NTPC VIDYUT VYAPAR NIGAM LIMITED</option>
                <option value="NUVOCO VISTAS CORPORATION LIMITED(Mejia Cement Plant)">NUVOCO VISTAS CORPORATION LIMITED(Mejia Cement Plant)</option>
                <option value="Ostro Kannada Power Private Limited">Ostro Kannada Power Private Limited</option>
                <option value="ReNew Surya Ravi Private Limited">ReNew Surya Ravi Private Limited</option>
              </select>
            </div>

            <div>
              <label className="block text-red-600 font-medium mb-1">Exchange Name*</label>
              <select 
                name="exchangeNameSelect"
                value={formData.exchangeNameSelect}
                onChange={handleChange}
                className="w-full border border-blue-400 rounded-sm px-3 py-1.5 outline-none focus:border-blue-500 bg-blue-50/10 text-gray-700 shadow-[0_0_3px_rgba(59,130,246,0.2)]"
              >
                <option value="">-- select an option --</option>
                <option value="IEX">IEX</option>
                <option value="PXIL">PXIL</option>
                <option value="HPX">HPX</option>
                <option value="Bilateral">Bilateral</option>
              </select>
            </div>
          </div>

          {/* Right Panel: Mapping Details */}
          <div className="flex flex-col gap-4">
            
            {/* Read Only Details Box */}
            <div className="border border-gray-200 p-6 space-y-12 h-1/2">
               <div className="flex justify-between">
                  <div className="font-medium text-gray-700 w-1/2 text-center">Client Name</div>
                  <div className="font-medium text-gray-700 w-1/2 text-center">Ref No.</div>
               </div>
               <div className="flex justify-between">
                  <div className="font-medium text-gray-700 w-1/2 text-center">Exchange</div>
                  <div className="font-medium text-gray-700 w-1/2 text-center">Registration Id</div>
               </div>
            </div>

            {/* Editable Details Box */}
            <div className="border border-gray-200 p-6 space-y-8 h-1/2 flex flex-col justify-center">
              <div className="flex items-center">
                <label className="w-1/3 text-red-600 font-medium">Portfolio Id *</label>
                <input 
                  type="text" 
                  name="portfolioId"
                  value={formData.portfolioId}
                  onChange={handleChange}
                  className="w-2/3 border border-gray-300 rounded-sm px-3 py-1.5 outline-none focus:border-blue-400"
                />
              </div>

              <div className="flex items-center">
                <label className="w-1/3 text-red-600 font-medium">Portfolio Name *</label>
                <input 
                  type="text" 
                  name="portfolioName"
                  value={formData.portfolioName}
                  onChange={handleChange}
                  className="w-2/3 border border-gray-300 rounded-sm px-3 py-1.5 outline-none focus:border-blue-400"
                />
              </div>
            </div>

          </div>

        </div>

        {/* Footer Actions */}
        <div className="flex justify-center gap-2 pb-6 pt-2">
            <button className="bg-gray-500 hover:bg-gray-600 text-white px-6 py-1.5 rounded-sm text-sm">Close</button>
            <button onClick={handleSave} className="bg-[#007bff] hover:bg-[#0056b3] text-white px-6 py-1.5 rounded-sm text-sm">Save</button>
        </div>

      </div>
    </div>
  );
}
