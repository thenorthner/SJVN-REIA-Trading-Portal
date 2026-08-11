import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';

const INVOICE_DATA = {
  'SJVN_EXCHANGE_OA_NDMC_202412_040': {
    clientName: 'New Delhi Municipal Council',
    clientAddress: 'New Delhi Municipal Council',
    clientGSTIN: '07AAALN2075Q1ZK',
    clientState: 'Delhi',
    clientStateCode: '07',
    portfolioCode: 'IEXNDMC123',
    invoiceNo: 'SJVN/EXCHANGE/OA/NDMC/202412/040',
    invoiceDate: '30-Dec-2024',
    dueDate: '06-Jan-2025',
    periodOfSupply: '27-Dec-2024 to 27-Dec-2024',
    source: 'IEX',
    productCode: 'DAM',
    description: 'Open Access Charges for Exchange Transactions (IEX- DAM) from 27-Dec-2024 to 27-Dec-2024',
    amount: '0.0',
    enclosures: 'i) Obligation Reports from 27-Dec-2024 to 27-Dec-2024.'
  },
  'SJVN_EXCHANGE_OA_NDMC_202411_002': {
    clientName: 'New Delhi Municipal Council',
    clientAddress: 'New Delhi Municipal Council',
    clientGSTIN: '07AAALN2075Q1ZK',
    clientState: 'Delhi',
    clientStateCode: '07',
    portfolioCode: 'IEXNDMC123',
    invoiceNo: 'SJVN/EXCHANGE/OA/NDMC/202411/002',
    invoiceDate: '18-Nov-2024',
    dueDate: '25-Nov-2024',
    periodOfSupply: '09-Nov-2024 to 15-Nov-2024',
    source: 'IEX',
    productCode: 'DAM',
    description: 'Open Access Charges for Exchange Transactions (IEX- DAM)- from 09-Nov-2024 to 15-Nov-2024',
    amount: '0.0',
    enclosures: 'i) Obligation Reports from 09-Nov-2024 to 15-Nov-2024.'
  },
  'SJVN_EXCHANGE_OA_KREATE_202412_025': {
    clientName: 'Kreate Energy (I) Pvt. Ltd.',
    clientAddress: 'Kreate Energy (I) Pvt. Ltd.',
    clientGSTIN: '06AABCM8569N1ZS',
    clientState: 'Delhi',
    clientStateCode: '07',
    portfolioCode: 'N/A',
    invoiceNo: 'SJVN/EXCHANGE/OA/KREATE/202412/025',
    invoiceDate: '16-Dec-2024',
    dueDate: '23-Dec-2024',
    periodOfSupply: '09-Dec-2024 to 15-Dec-2024',
    source: 'IEX',
    productCode: 'DAM',
    description: 'Open Access Charges for Exchange Transactions (IEX- DAM)- from 09-Dec-2024 to 15-Dec-2024',
    amount: '0.0',
    enclosures: 'i) Obligation Reports from 09-Dec-2024 to 15-Dec-2024.'
  }
};

export default function OpenAccessInvoiceDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const data = INVOICE_DATA[id] || INVOICE_DATA['SJVN_EXCHANGE_OA_NDMC_202412_040']; // Fallback

  return (
    <div className="p-6 bg-[#f8f9fa] min-h-screen font-serif text-[12px] text-black flex justify-center">
      
      {/* PDF Container */}
      <div className="bg-white border-2 border-black w-[1000px] shadow-lg relative">
        
        {/* Back Button (Non-printable UI) */}
        <button 
          onClick={() => navigate('/invoices/open-access')}
          className="absolute -top-12 left-0 bg-blue-500 text-white px-4 py-1.5 rounded text-sans font-sans text-sm hover:bg-blue-600 print:hidden"
        >
          ← Back to List
        </button>

        {/* Action Buttons (Non-printable UI) */}
        <div className="absolute -top-12 right-0 flex gap-2 print:hidden">
            <button className="bg-gray-500 text-white px-4 py-1.5 rounded text-sans font-sans text-sm hover:bg-gray-600">Download PDF</button>
            <button className="bg-green-600 text-white px-4 py-1.5 rounded text-sans font-sans text-sm hover:bg-green-700">Print</button>
        </div>

        {/* Company Header */}
        <div className="flex border-b-2 border-black items-center">
          <div className="w-48 p-4 border-r-2 border-black flex items-center justify-center">
            {/* Logo Placeholder */}
            <div className="w-16 h-20 border-2 border-red-500 flex flex-col items-center justify-center text-red-500 font-bold">
                <span className="text-2xl">ϟ</span>
                <span>SJVN</span>
            </div>
          </div>
          <div className="flex-1 text-center py-4 font-bold">
            <div className="text-base">SJVN Limited</div>
            <div>(A Mini Ratna & Schedule- "A" PSU)</div>
            <div>BDE & Power Trading Department, New Delhi</div>
            <div>CIN: L40101HP1988GOI008409</div>
          </div>
        </div>

        {/* Invoice Title */}
        <div className="text-center font-bold py-1 border-b-2 border-black">
          Exchange Open Access Invoice
        </div>

        {/* Bill To & Bill By Headers */}
        <div className="flex border-b-2 border-black">
          <div className="w-1/3 border-r-2 border-black p-1 font-bold">Bill to Client</div>
          <div className="w-1/3 border-r-2 border-black p-1 font-bold">Bill By SJVN LIMITED</div>
          <div className="w-1/3 p-1 font-bold">Invoice No- {data.invoiceNo}</div>
        </div>

        {/* Names */}
        <div className="flex border-b border-black min-h-[30px]">
          <div className="w-1/3 border-r-2 border-black p-1">Name: {data.clientName}</div>
          <div className="w-1/3 border-r-2 border-black p-1">Name: SJVN Limited</div>
          <div className="w-1/3 flex">
            <div className="w-1/3 border-r border-black p-1">Invoice Date</div>
            <div className="w-2/3 p-1">{data.invoiceDate}</div>
          </div>
        </div>

        {/* Addresses */}
        <div className="flex border-b border-black min-h-[50px]">
          <div className="w-1/3 border-r-2 border-black p-1">Address: {data.clientAddress}</div>
          <div className="w-1/3 border-r-2 border-black p-1">Address: 6th Floor, Office block-1, NBCC Complex, Kidwai nagar East</div>
          <div className="w-1/3 flex flex-col">
            <div className="flex border-b border-black flex-1">
               <div className="w-1/3 border-r border-black p-1">Due Date</div>
               <div className="w-2/3 p-1">{data.dueDate}</div>
            </div>
            <div className="flex flex-1">
               <div className="w-1/3 border-r border-black p-1">Period of Supply</div>
               <div className="w-2/3 p-1">{data.periodOfSupply}</div>
            </div>
          </div>
        </div>

        {/* GSTIN & State */}
        <div className="flex border-b border-black">
          <div className="w-1/3 border-r-2 border-black">
            <div className="p-1 border-b border-black">GSTIN: {data.clientGSTIN}</div>
            <div className="flex">
                <div className="w-1/2 p-1 border-r border-black">State: {data.clientState}</div>
                <div className="w-1/2 p-1">Code:{data.clientStateCode}</div>
            </div>
          </div>
          <div className="w-1/3 border-r-2 border-black">
            <div className="p-1 border-b border-black">GSTIN: 07AAICS1307F1ZO</div>
            <div className="flex">
                <div className="w-1/2 p-1 border-r border-black">State: </div>
                <div className="w-1/2 p-1">Code:07</div>
            </div>
          </div>
          <div className="w-1/3 flex flex-col">
            <div className="flex border-b border-black flex-1">
               <div className="w-1/3 border-r border-black p-1">Source</div>
               <div className="w-2/3 p-1">{data.source}</div>
            </div>
            <div className="flex flex-1">
               <div className="w-1/3 border-r border-black p-1">Product Code:</div>
               <div className="w-2/3 p-1">{data.productCode}</div>
            </div>
          </div>
        </div>

        {/* Portfolio Code */}
        <div className="flex border-b-2 border-black">
          <div className="w-1/3 border-r-2 border-black p-1">Portfolio Code:</div>
          <div className="w-1/3 border-r-2 border-black p-1 font-bold">{data.portfolioCode}</div>
          <div className="w-1/3"></div>
        </div>

        {/* Line Items Table Header */}
        <div className="flex border-b-2 border-black font-bold text-center">
            <div className="w-16 border-r-2 border-black p-1">Sr. No.</div>
            <div className="flex-1 border-r-2 border-black p-1">Description</div>
            <div className="w-48 p-1">Amount</div>
        </div>

        {/* Line Items */}
        <div className="flex border-b-2 border-black min-h-[60px]">
            <div className="w-16 border-r-2 border-black p-1 text-center">1</div>
            <div className="flex-1 border-r-2 border-black p-1">{data.description}</div>
            <div className="w-48 p-1 text-right">{data.amount}</div>
        </div>

        {/* Total */}
        <div className="flex border-b-2 border-black font-bold">
            <div className="flex-1 border-r-2 border-black p-1 text-center">Total</div>
            <div className="w-48 p-1 text-right">0.00</div>
        </div>

        {/* Amount in Words */}
        <div className="flex border-b-2 border-black font-bold">
            <div className="w-1/2 border-r-2 border-black p-1 text-center">Total Invoice Amount (In Words)</div>
            <div className="w-1/2 p-1 text-center">Rupees Only.</div>
        </div>

        {/* Enclosures */}
        <div className="border-b-2 border-black p-1 min-h-[60px]">
            <span className="font-bold">Enclosure's:</span><br/>
            {data.enclosures}
        </div>

        {/* Bank & Signatory Headers */}
        <div className="flex border-b-2 border-black font-bold">
            <div className="w-1/2 border-r-2 border-black p-1 text-center">Bank Details</div>
            <div className="w-1/2 p-1 text-center">For & On Behalf of SJVN Limited</div>
        </div>

        {/* Bank Details & Signature Box */}
        <div className="flex border-b-2 border-black min-h-[120px]">
            <div className="w-1/2 border-r-2 border-black p-1 text-[11px]">
                Payment may please be remitted to SJVN through RTGS:<br/>
                Beneficiary Name: SJVN LIMITED<br/>
                Bank Name: SBI<br/>
                Bank Account No: 00000041178306699<br/>
                IFSC Code: SBIN0003219<br/>
                Branch Name: NEW DELHI
            </div>
            <div className="w-1/2 p-1 flex items-end justify-center">
                <span className="text-gray-300 font-bold mb-4">Authorised Signatory</span>
            </div>
        </div>

        {/* Corporate Footer */}
        <div className="p-2 text-center text-[11px] text-blue-800 font-sans">
            SJVN Limited | 6th Floor, Office Block-1, NBCC Complex, Kidwai Nagar East, New Delhi. 110023<br/>
            Registered Office Address: SJVN Corporate Office Complex, Shanan, Shimla, Himachal Pradesh, 171006<br/>
            P: +91 1161901901 | Email: power.trading@sjvn.nic.in | Website: www.sjvn.nic.in
        </div>

      </div>
    </div>
  );
}
