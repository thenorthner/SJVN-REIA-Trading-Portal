import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';

export default function ClientRegistrationApproval() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [remarks, setRemarks] = useState('');

  return (
    <div className="p-6 bg-[#f8f9fa] min-h-screen font-sans text-[13px]">
      <div className="bg-white border border-gray-200 shadow-[0_2px_10px_rgba(0,0,0,0.1)] max-w-5xl mx-auto rounded-sm overflow-hidden">
        
        {/* Header */}
        <div className="bg-[#4682b4] text-white px-4 py-2 font-medium flex justify-between items-center">
          <span>Client Registration</span>
          <span className="text-xs bg-white/20 px-2 py-0.5 rounded">ID: {id || 'R2603261013TR'}</span>
        </div>

        {/* Client Details Section */}
        <div className="p-4 grid grid-cols-2 gap-x-12 gap-y-4">
          <div className="grid grid-cols-[120px_1fr] gap-2">
            <span className="text-gray-600 font-medium">Client Name</span>
            <span className="text-gray-800">NTPC VIDYUT VYAPAR NIGAM LIMITED</span>
          </div>
          <div className="grid grid-cols-[120px_1fr] gap-2">
            <span className="text-gray-600 font-medium">Company Name</span>
            <span className="text-gray-800">NTPC VIDYUT VYAPAR NIGAM LIMITED</span>
          </div>
          
          <div className="grid grid-cols-[120px_1fr] gap-2">
            <span className="text-gray-600 font-medium">Client Category</span>
            <span className="text-gray-800">Trader</span>
          </div>
          <div className="grid grid-cols-[120px_1fr] gap-2">
            <span className="text-gray-600 font-medium">Company Address</span>
            <span className="text-gray-800 leading-snug">
              A-8A, NTPC LIMITED ENGINEERING OFFICE COMPLEX, SECTOR-24, NOIDA, GAUTAM BUDDHA NAGAR, UTTAR PRADESH, 201301
            </span>
          </div>

          <div className="grid grid-cols-[120px_1fr] gap-2">
            <span className="text-gray-600 font-medium">Unit Address</span>
            <span className="text-gray-800"></span>
          </div>
        </div>

        {/* Contact Details Section */}
        <div className="bg-[#5da5da] text-white px-4 py-1.5 font-medium mt-2">
          Contact Details
        </div>
        <div className="p-4 grid grid-cols-2 gap-x-12 gap-y-4 bg-gray-50/50">
          <div className="grid grid-cols-[120px_1fr] gap-2">
            <span className="text-gray-600 font-medium">Name</span>
            <span className="text-gray-800">PK Jena</span>
          </div>
          <div className="grid grid-cols-[120px_1fr] gap-2">
            <span className="text-gray-600 font-medium">Designation</span>
            <span className="text-gray-800"></span>
          </div>
          
          <div className="grid grid-cols-[120px_1fr] gap-2">
            <span className="text-gray-600 font-medium">Email</span>
            <span className="text-gray-800">power.trading@sjvn.nic.in</span>
          </div>
          <div className="grid grid-cols-[120px_1fr] gap-2">
            <span className="text-gray-600 font-medium">Alternate Email</span>
            <span className="text-gray-800"></span>
          </div>

          <div className="grid grid-cols-[120px_1fr] gap-2">
            <span className="text-gray-600 font-medium">Mobile No</span>
            <span className="text-gray-800">7091850568</span>
          </div>
          <div className="grid grid-cols-[120px_1fr] gap-2">
            <span className="text-gray-600 font-medium">Alternate Mobile No</span>
            <span className="text-gray-800"></span>
          </div>

          <div className="grid grid-cols-[120px_1fr] gap-2 col-span-2">
            <span className="text-gray-600 font-medium">Contact Address</span>
            <span className="text-gray-800">
              A-8A, NTPC LIMITED ENGINEERING OFFICE COMPLEX, SECTOR-24, NOIDA, GAUTAM BUDDHA NAGAR, UTTAR PRADESH, 201301
            </span>
          </div>
        </div>

        {/* Bank Details Section */}
        <div className="bg-[#5da5da] text-white px-4 py-1.5 font-medium mt-2">
          Bank Details
        </div>
        <div className="p-4 grid grid-cols-2 gap-x-12 gap-y-4">
          <div className="grid grid-cols-[120px_1fr] gap-2 border-b border-gray-100 pb-2">
            <span className="text-gray-600 font-medium">Account No</span>
            <span className="text-gray-800"></span>
            <span className="text-gray-600 font-medium mt-1">IFSC Code</span>
            <span className="text-gray-800 mt-1"></span>
          </div>
          <div className="grid grid-cols-[120px_1fr] gap-2 border-b border-gray-100 pb-2">
            <span className="text-gray-600 font-medium">Bank Name</span>
            <span className="text-gray-800"></span>
            <span className="text-gray-600 font-medium mt-1">Account Holder</span>
            <span className="text-gray-800 mt-1"></span>
          </div>

          <div className="grid grid-cols-[120px_1fr] gap-2 pt-2">
            <span className="text-gray-600 font-medium">GST</span>
            <span className="text-gray-800">09AABCN7433J1Z8</span>
          </div>
          <div className="grid grid-cols-[120px_1fr] gap-2 pt-2">
            <span className="text-gray-600 font-medium">CIN</span>
            <span className="text-gray-800">U40108DL2002GOI117584</span>
          </div>

          <div className="grid grid-cols-[120px_1fr] gap-2">
            <span className="text-gray-600 font-medium">TAN</span>
            <span className="text-gray-800">DELN05873A</span>
          </div>
          <div className="grid grid-cols-[120px_1fr] gap-2">
            <span className="text-gray-600 font-medium">PAN</span>
            <span className="text-gray-800">AABCN7433J</span>
          </div>
        </div>

        {/* Registration Sought For Section */}
        <div className="bg-[#5da5da] text-white px-4 py-1.5 font-medium mt-2">
          Registration Sought For
        </div>
        <div className="p-4 grid grid-cols-2 gap-x-12 gap-y-4 bg-gray-50/50">
          <div className="grid grid-cols-[120px_1fr] gap-2 items-center">
            <span className="text-gray-600 font-medium">Segment</span>
            <div className="flex items-center gap-2">
              <input type="checkbox" checked readOnly className="w-4 h-4 text-blue-600 rounded border-gray-300" />
              <span className="text-gray-800">Electricity</span>
            </div>
          </div>
          <div></div>

          <div className="grid grid-cols-[120px_1fr] gap-2">
            <span className="text-gray-600 font-medium">Level_1 Remarks</span>
            <span className="text-gray-800"></span>
          </div>
          <div className="grid grid-cols-[120px_1fr] gap-2">
            <span className="text-gray-600 font-medium">Level_2 Remarks</span>
            <span className="text-gray-800"></span>
          </div>
        </div>

        {/* Documents Uploaded Section */}
        <div className="bg-[#5da5da] text-white px-4 py-1.5 font-medium mt-2">
          Documents Uploaded
        </div>
        <div className="p-4">
          <table className="w-full text-center border-collapse">
            <thead>
              <tr className="bg-[#66b2ff] text-white">
                <th className="px-3 py-2 font-medium border-r border-white/20 w-16">S.No.</th>
                <th className="px-3 py-2 font-medium border-r border-white/20">Name</th>
                <th className="px-3 py-2 font-medium border-r border-white/20">segment</th>
                <th className="px-3 py-2 font-medium border-r border-white/20">Upload Time</th>
                <th className="px-3 py-2 font-medium">View</th>
              </tr>
            </thead>
            <tbody>
              {/* Empty state as per screenshot */}
              <tr className="border-b border-gray-200">
                <td colSpan={5} className="py-8 text-gray-400 italic bg-gray-50/50">No documents uploaded</td>
              </tr>
            </tbody>
          </table>

          {/* Remarks Input */}
          <div className="mt-6 flex items-start gap-4">
            <label className="text-gray-600 font-medium w-16 pt-2">Remarks</label>
            <textarea 
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              className="border border-gray-300 rounded-sm p-2 w-96 h-20 outline-none focus:border-blue-400 resize-none text-gray-700"
            />
          </div>

          {/* Action Buttons */}
          <div className="flex justify-between items-center mt-12 mb-2">
            <button 
              onClick={() => navigate(-1)}
              className="bg-gray-500 hover:bg-gray-600 text-white px-6 py-1.5 rounded-sm shadow-sm font-medium transition-colors"
            >
              Close
            </button>
            <div className="flex gap-3">
              <button className="bg-[#dc3545] hover:bg-[#c82333] text-white px-6 py-1.5 rounded-sm shadow-sm font-medium transition-colors">
                Reject
              </button>
              <button className="bg-[#28a745] hover:bg-[#218838] text-white px-6 py-1.5 rounded-sm shadow-sm font-medium transition-colors">
                Approve
              </button>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
