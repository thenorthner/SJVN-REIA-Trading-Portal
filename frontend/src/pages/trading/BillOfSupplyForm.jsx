import React, { useState } from 'react';

export default function BillOfSupplyForm() {
  const [formData, setFormData] = useState({
    clientName: '',
    sellerName: '',
    buyerName: '',
    contractNo: '',
    invoiceDate: '',
    invoiceDueDate: '',
    supplyPeriodFrom: '',
    supplyPeriodTo: '',
    invoiceNo: '',
    description: '',
    hsnCode: '',
    quantity: '',
    unit: '',
    rate: '',
    rebate: '',
  });

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const amount = (parseFloat(formData.quantity) || 0) * (parseFloat(formData.rate) || 0);
  const amountAfterRebate = amount * (1 - (parseFloat(formData.rebate) || 0) / 100);

  return (
    <div className="p-6 bg-[#f8f9fa] min-h-screen font-sans text-[13px]">
      <div className="bg-white border border-gray-200 shadow-sm max-w-5xl mx-auto">
        
        {/* Header */}
        <div className="bg-[#2b5682] text-white px-4 py-2 font-semibold tracking-wide">
          Bill Of Supply
        </div>

        <div className="p-8 pb-12">
          {/* Party Details Row */}
          <div className="grid grid-cols-3 gap-6 mb-8">
            <div>
              <label className="block text-red-600 mb-1 font-medium">Client Name*</label>
              <select name="clientName" value={formData.clientName} onChange={handleChange} className="w-full border border-gray-300 rounded-sm px-3 py-2 text-gray-700 outline-none focus:border-blue-400">
                <option value="">Select Client</option>
                <option value="Arunachal Pradesh Power Corporation Pvt. Ltd.">Arunachal Pradesh Power Corporation Pvt. Ltd.</option>
                <option value="BALRAMPUR CHINI MILLS LTD">BALRAMPUR CHINI MILLS LTD</option>
                <option value="Balrampur Chini Mills Ltd. Unit HCM">Balrampur Chini Mills Ltd. Unit HCM</option>
                <option value="CARBON RESOURCES PVT. LTD.">CARBON RESOURCES PVT. LTD.</option>
                <option value="Dikchu Hydro Electric Project">Dikchu Hydro Electric Project (Sneha Kinetic Power Projects Pvt. Ltd.)</option>
                <option value="DOP, Govt. of Arunachal Pradesh">DOP, Govt. of Arunachal Pradesh</option>
                <option value="ELECTROTHERM (INDIA) LIMITED">ELECTROTHERM (INDIA) LIMITED</option>
              </select>
            </div>
            <div>
              <label className="block text-red-600 mb-1 font-medium">Seller Name*</label>
              <select name="sellerName" value={formData.sellerName} onChange={handleChange} className="w-full border border-gray-300 rounded-sm px-3 py-2 text-gray-700 outline-none focus:border-blue-400">
                <option value="">Select Seller</option>
              </select>
            </div>
            <div>
              <label className="block text-red-600 mb-1 font-medium">Buyer Name*</label>
              <select name="buyerName" value={formData.buyerName} onChange={handleChange} className="w-full border border-gray-300 rounded-sm px-3 py-2 text-gray-700 outline-none focus:border-blue-400">
                <option value="">Select Buyer</option>
              </select>
            </div>
          </div>

          {/* Contract Info */}
          <div className="mb-8">
            <label className="block text-red-600 mb-1 font-medium">Contract No*</label>
            <select name="contractNo" value={formData.contractNo} onChange={handleChange} className="w-1/2 border border-gray-300 rounded-sm px-3 py-2 text-gray-700 outline-none focus:border-blue-400">
              <option value="">Select Contract</option>
              <option value="SJVN/CC/PT&BDE/NDMC/111">SJVN/CC/PT&BDE/NDMC/111 19.05.2023 IPCL-NDMC</option>
              <option value="SJVNNDMC190523RE25">SJVNNDMC190523RE25</option>
              <option value="NSLKSL-NDMC">NSLKSL-NDMC 04.01.2024</option>
              <option value="KEPLSJVN280324RE55">KEPLSJVN280324RE55</option>
              <option value="SJVNSTPLDAMBLOCK198MW">SJVNSTPLDAMBLOCK198MW</option>
              <option value="KEPLSJVN190523RE25">KEPLSJVN190523RE25</option>
              <option value="SJVN/CC/PT&BDE/NDMC/114">SJVN/CC/PT&BDE/NDMC/114 19.07.2023 IOCL-NDMC</option>
            </select>
          </div>

          {/* Dates Row */}
          <div className="grid grid-cols-4 gap-6 mb-8">
            <div>
              <label className="block text-red-600 mb-1 font-medium">Invoice Date*</label>
              <input type="date" name="invoiceDate" value={formData.invoiceDate} onChange={handleChange} className="w-full border border-gray-300 rounded-sm px-3 py-2 text-gray-700 outline-none focus:border-blue-400" />
            </div>
            <div>
              <label className="block text-red-600 mb-1 font-medium">Invoice Due Date*</label>
              <input type="date" name="invoiceDueDate" value={formData.invoiceDueDate} onChange={handleChange} className="w-full border border-gray-300 rounded-sm px-3 py-2 text-gray-700 outline-none focus:border-blue-400" />
            </div>
            <div>
              <label className="block text-red-600 mb-1 font-medium">Supply Period From*</label>
              <input type="date" name="supplyPeriodFrom" value={formData.supplyPeriodFrom} onChange={handleChange} className="w-full border border-gray-300 rounded-sm px-3 py-2 text-gray-700 outline-none focus:border-blue-400" />
            </div>
            <div>
              <label className="block text-red-600 mb-1 font-medium">Supply Period To*</label>
              <input type="date" name="supplyPeriodTo" value={formData.supplyPeriodTo} onChange={handleChange} className="w-full border border-gray-300 rounded-sm px-3 py-2 text-gray-700 outline-none focus:border-blue-400" />
            </div>
          </div>

          {/* Invoice Line Row */}
          <div className="grid grid-cols-3 gap-6 mb-8">
            <div>
              <label className="block text-red-600 mb-1 font-medium">Invoice No*</label>
              <input type="text" name="invoiceNo" placeholder="Invoice No" value={formData.invoiceNo} onChange={handleChange} className="w-full border border-gray-300 rounded-sm px-3 py-2 text-gray-700 outline-none focus:border-blue-400" />
            </div>
            <div>
              <label className="block text-red-600 mb-1 font-medium">Description*</label>
              <input type="text" name="description" placeholder="Description" value={formData.description} onChange={handleChange} className="w-full border border-gray-300 rounded-sm px-3 py-2 text-gray-700 outline-none focus:border-blue-400" />
            </div>
            <div>
              <label className="block text-red-600 mb-1 font-medium">HSN Code*</label>
              <input type="text" name="hsnCode" placeholder="HSN Code" value={formData.hsnCode} onChange={handleChange} className="w-full border border-gray-300 rounded-sm px-3 py-2 text-gray-700 outline-none focus:border-blue-400" />
            </div>
          </div>

          {/* Financials Row */}
          <div className="grid grid-cols-4 gap-6 mb-8">
            <div>
              <label className="block text-red-600 mb-1 font-medium">Quantity*</label>
              <input type="number" name="quantity" placeholder="Quantity" value={formData.quantity} onChange={handleChange} className="w-full border border-gray-300 rounded-sm px-3 py-2 text-gray-700 outline-none focus:border-blue-400" />
            </div>
            <div>
              <label className="block text-red-600 mb-1 font-medium">Unit*</label>
              <input type="text" name="unit" placeholder="Unit" value={formData.unit} onChange={handleChange} className="w-full border border-gray-300 rounded-sm px-3 py-2 text-gray-700 outline-none focus:border-blue-400" />
            </div>
            <div>
              <label className="block text-red-600 mb-1 font-medium">Rate(INR)*</label>
              <input type="number" name="rate" placeholder="Rate" value={formData.rate} onChange={handleChange} className="w-full border border-gray-300 rounded-sm px-3 py-2 text-gray-700 outline-none focus:border-blue-400" />
            </div>
            <div>
              <label className="block text-red-600 mb-1 font-medium">Amount(INR)*</label>
              <input type="text" name="amount" placeholder="Amount" value={amount.toFixed(2)} readOnly className="w-full border border-gray-300 rounded-sm px-3 py-2 text-gray-500 bg-gray-50 outline-none cursor-not-allowed" />
            </div>
          </div>

          {/* Rebate and Upload Row */}
          <div className="grid grid-cols-3 gap-6 mb-12">
            <div>
              <label className="block text-red-600 mb-1 font-medium">Rebate(%)*</label>
              <input type="number" name="rebate" placeholder="Rebate(%)" value={formData.rebate} onChange={handleChange} className="w-full border border-gray-300 rounded-sm px-3 py-2 text-gray-700 outline-none focus:border-blue-400" />
            </div>
            <div>
              <label className="block text-gray-700 mb-1 font-medium">Amount After Rebate*</label>
              <input type="text" name="amountAfterRebate" placeholder="Amount After Rebate" value={amountAfterRebate.toFixed(2)} readOnly className="w-full border border-blue-400 rounded-sm px-3 py-2 text-blue-600 bg-blue-50 outline-none cursor-not-allowed" />
            </div>
            <div>
              <label className="block text-red-600 mb-1 font-medium">Upload Bill Of Supply Invoice In PDF Format*</label>
              <div className="flex border border-gray-300 rounded-sm overflow-hidden bg-white">
                <label className="bg-gray-100 hover:bg-gray-200 px-3 py-2 border-r border-gray-300 cursor-pointer text-gray-700 font-medium whitespace-nowrap">
                  Choose File
                  <input type="file" className="hidden" accept=".pdf" />
                </label>
                <span className="px-3 py-2 text-gray-500 flex-1 truncate">No file chosen</span>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex justify-center gap-2">
            <button className="bg-gray-500 hover:bg-gray-600 text-white px-6 py-2 rounded-sm font-medium transition-colors">Close</button>
            <button className="bg-[#3399ff] hover:bg-blue-500 text-white px-6 py-2 rounded-sm font-medium transition-colors">Submit</button>
          </div>

        </div>
      </div>
    </div>
  );
}
