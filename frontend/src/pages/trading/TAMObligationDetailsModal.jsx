import React from 'react';
import { Card, Table, fmtNumber } from '../../components/ui.jsx';

export default function TAMObligationDetailsModal({ record, onClose }) {
  if (!record) return null;

  // Derive granular mock data based on the parent record
  // According to the domain logic: Gross - STOA - Fees - Taxes = Net Total.
  const grossInvoice = record.grossValue;
  const stoaCharges = 0;
  // Based on screenshot, fee is 20 Rs/MWh -> ~0.02 Rs/kWh -> record.margin
  const fees = record.margin;
  const igst = record.igst; 
  const sgst = 0;
  const cgst = 0;
  const utgst = 0;
  const netTotal = grossInvoice - stoaCharges - fees - igst - sgst - cgst - utgst;

  const financialData = [{
    gross: grossInvoice,
    stoa: stoaCharges,
    fees: -fees,
    igst: -igst,
    sgst: sgst,
    cgst: cgst,
    utgst: utgst,
    net: netTotal
  }];

  const financialCols = [
    { key: 'gross', label: 'Invoice (Gross ₹)', render: r => fmtNumber(r.gross) },
    { key: 'stoa', label: 'STOA Charges', render: r => fmtNumber(r.stoa) },
    { key: 'fees', label: 'Fees', render: r => <span style={{ color: '#c0392b' }}>{fmtNumber(r.fees)}</span> },
    { key: 'igst', label: 'IGST', render: r => <span style={{ color: '#c0392b' }}>{fmtNumber(r.igst)}</span> },
    { key: 'sgst', label: 'SGST', render: r => fmtNumber(r.sgst) },
    { key: 'cgst', label: 'CGST', render: r => fmtNumber(r.cgst) },
    { key: 'utgst', label: 'UTGST', render: r => fmtNumber(r.utgst) },
    { key: 'net', label: 'Net Total', render: r => <span style={{ fontWeight: 'bold' }}>{fmtNumber(r.net)}</span> }
  ];

  // Derive mock TAM block schedule data matching the 819 MWh example from the prompt 
  // or scaled to the record's MUs if we want it dynamic. We'll use the prompt's exact structural split.
  // We'll scale the blocks proportionally to the record's actual energy.
  const totalMWh = record.energyMUs * 1000;
  
  // Roughly 49% of energy in block 1, 51% in block 2 as per the prompt (403 vs 416 out of 819)
  const block1MWh = totalMWh * (403 / 819);
  const block2MWh = totalMWh * (416 / 819);
  
  const block1MW = block1MWh / 7.75;
  const block2MW = block2MWh / 8.00;

  const scheduleData = [
    {
      sno: 1,
      fromDate: '2025-08-23',
      toDate: '2025-08-23',
      fromTime: '00:00',
      toTime: '07:45',
      mw: block1MW,
      mwh: block1MWh,
      route: 'NR-ER-SR'
    },
    {
      sno: 2,
      fromDate: '2025-08-23',
      toDate: '2025-08-23',
      fromTime: '16:00',
      toTime: '24:00',
      mw: block2MW,
      mwh: block2MWh,
      route: 'NR-ER-SR'
    }
  ];

  const scheduleCols = [
    { key: 'sno', label: 'S.No.' },
    { key: 'fromDate', label: 'From Date' },
    { key: 'toDate', label: 'To Date' },
    { key: 'fromTime', label: 'From Time' },
    { key: 'toTime', label: 'To Time' },
    { key: 'mw', label: 'Scheduled Qty (MW)', render: r => r.mw.toFixed(2) },
    { key: 'mwh', label: 'Scheduled Qty (MWh)', render: r => r.mwh.toFixed(4) },
    { key: 'route', label: 'Route', render: r => <span style={{ fontFamily: 'monospace' }}>{r.route}</span> }
  ];

  const transmissionCols = [
    { key: 'charge', label: 'Charge Category' },
    { key: 'lineItem', label: 'Line Item' },
    { key: 'rate', label: 'Rate' },
    { key: 'amount', label: 'Amount (₹)' }
  ];
  
  const transmissionData = [
    { charge: 'Transmission Charges', lineItem: 'NORHPO_POC_INJ', rate: '0.00', amount: '0.00' },
    { charge: '', lineItem: 'H.P._Intra State_INJ', rate: '0.00', amount: '0.00' },
    { charge: 'Operating Charges', lineItem: 'RLDC/SLDC (HPO / NRLDC)', rate: '0.00', amount: '0.00' },
    { charge: 'Non-Refundable Application Fees', lineItem: '-', rate: '-', amount: '0.00' }
  ];

  const marginCols = [
    { key: 'margin', label: 'Margin Schedule' },
    { key: 'amount', label: 'Amount (₹)' }
  ];

  const marginData = [
    { margin: 'Initial Margin', amount: '0.00' },
    { margin: 'Initial Margin Release', amount: '0.00' }
  ];

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000
    }}>
      <div style={{ background: '#fff', borderRadius: 8, width: 1000, maxHeight: '90vh', overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '15px 20px', borderBottom: '1px solid #ddd', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#f8f9fa', borderRadius: '8px 8px 0 0' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 18, color: '#333' }}>Final Sell Report (TAM Obligation)</h2>
            <div style={{ fontSize: 12, color: '#666', marginTop: 4 }}>IEX Settlement & Open Access Approval Voucher</div>
          </div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', fontSize: 24, cursor: 'pointer', color: '#888' }}>&times;</button>
        </div>

        <div style={{ padding: 20 }}>
          {/* Corridor Route Visual Badge */}
          <div style={{ marginBottom: 20, display: 'inline-flex', alignItems: 'center', background: '#fff3e0', border: '1px solid #ffe0b2', padding: '6px 12px', borderRadius: 4, fontSize: 13, color: '#e65100', fontWeight: 'bold' }}>
            <span style={{ marginRight: 8 }}>Grid Transmission Corridor:</span>
            <span style={{ fontFamily: 'monospace', letterSpacing: 0.5 }}>[ NR (Gen) ⚡ ──&gt; ER ──&gt; SR (Buyer) ]</span>
          </div>

          {/* Metadata Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '15px 20px', marginBottom: 30 }}>
            <div style={{ gridColumn: 'span 2' }}>
              <div style={{ fontSize: 11, color: '#666', fontWeight: 'bold', textTransform: 'uppercase' }}>Application No</div>
              <div style={{ fontSize: 14, fontFamily: 'monospace' }}>IEX_250822_02654</div>
            </div>
            <div style={{ gridColumn: 'span 2' }}>
              <div style={{ fontSize: 11, color: '#666', fontWeight: 'bold', textTransform: 'uppercase' }}>Acceptance No</div>
              <div style={{ fontSize: 14, fontFamily: 'monospace' }}>SR/2025/20064/C/R /0</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: '#666', fontWeight: 'bold', textTransform: 'uppercase' }}>Portfolio Id</div>
              <div style={{ fontSize: 14 }}>N1HP0PTC0850</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: '#666', fontWeight: 'bold', textTransform: 'uppercase' }}>Participant Id</div>
              <div style={{ fontSize: 14 }}>N2DL0PTC0000</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: '#666', fontWeight: 'bold', textTransform: 'uppercase' }}>Contract</div>
              <div style={{ fontSize: 14 }}>Day Ahead</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: '#666', fontWeight: 'bold', textTransform: 'uppercase' }}>Trade Date</div>
              <div style={{ fontSize: 14 }}>22-08-2025</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: '#666', fontWeight: 'bold', textTransform: 'uppercase' }}>Delivery Date</div>
              <div style={{ fontSize: 14 }}>23-08-2025</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: '#666', fontWeight: 'bold', textTransform: 'uppercase' }}>Created On</div>
              <div style={{ fontSize: 14 }}>24-08-2025 12:19</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: '#666', fontWeight: 'bold', textTransform: 'uppercase' }}>Total (MWh)</div>
              <div style={{ fontSize: 14, fontWeight: 'bold' }}>{totalMWh.toFixed(4)} MWh</div>
            </div>
            <div style={{ gridColumn: 'span 3' }}>
              <div style={{ fontSize: 11, color: '#666', fontWeight: 'bold', textTransform: 'uppercase' }}>Total</div>
              <div style={{ fontSize: 14, fontWeight: 'bold' }}>{grossInvoice.toFixed(2)}</div>
            </div>
          </div>

          {/* Financial Waterfall */}
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 20, marginBottom: 30 }}>
            <div>
              <h3 style={{ fontSize: 16, borderBottom: '1px solid #eee', paddingBottom: 5, marginBottom: 15, color: '#2c3e50' }}>Cash Transaction</h3>
              <Table columns={financialCols} data={financialData} />
            </div>
            <div>
              <h3 style={{ fontSize: 16, borderBottom: '1px solid #eee', paddingBottom: 5, marginBottom: 15, color: '#2c3e50' }}>Margin Schedule</h3>
              <Table columns={marginCols} data={marginData} />
            </div>
          </div>
          
          {/* Transmission Charges */}
          <h3 style={{ fontSize: 16, borderBottom: '1px solid #eee', paddingBottom: 5, marginBottom: 15, color: '#2c3e50' }}>Transmission & Operating Charges</h3>
          <div style={{ marginBottom: 30 }}>
            <Table columns={transmissionCols} data={transmissionData} />
          </div>

          {/* Schedule Table */}
          <h3 style={{ fontSize: 16, borderBottom: '1px solid #eee', paddingBottom: 5, marginBottom: 15, color: '#2c3e50' }}>Open Access Scheduling Accepted (TAM Obligation Hourly List)</h3>
          <div style={{ marginBottom: 10 }}>
            <Table columns={scheduleCols} data={scheduleData} />
          </div>
          
          <div style={{ background: '#e3f2fd', padding: 15, borderRadius: 6, fontSize: 13, color: '#0d47a1', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <span style={{ fontSize: 18 }}>ℹ️</span>
            <div>
              <strong>Time-Block Aggregation Notice:</strong> Unlike DAM/RTM which mandates a strict 96-block continuous table, this TAM contract groups identical continuous delivery hours into defined time blocks. 
              Notice the peaking/non-delivery gap between 07:45 and 16:00 where Scheduled Qty is 0.00 MW.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
