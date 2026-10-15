import React, { act } from 'react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import { MemoryRouter } from 'react-router-dom';
import HydroWaterToWirePipeline3D from './HydroWaterToWirePipeline3D.jsx';
import HydroBeneficiaryWaterfall3D from './HydroBeneficiaryWaterfall3D.jsx';
import HydroAdjustmentCorridor3D from './HydroAdjustmentCorridor3D.jsx';
import HydroSecurityCoverageVault3D from './HydroSecurityCoverageVault3D.jsx';
import ThermalCoalToBusbarECR3D from './ThermalCoalToBusbarECR3D.jsx';
import ThermalCapacityRecoveryGate3D from './ThermalCapacityRecoveryGate3D.jsx';
import ThermalCoalBlendingInflow3D from './ThermalCoalBlendingInflow3D.jsx';
import ThermalUrsMarketDiversion3D from './ThermalUrsMarketDiversion3D.jsx';
import SjvnMacroEnergyCorridor3D from './SjvnMacroEnergyCorridor3D.jsx';
import LatePaymentSurchargeLadder3D from './LatePaymentSurchargeLadder3D.jsx';
import ThermalTariffArchitectureDoc3D from './ThermalTariffArchitectureDoc3D.jsx';
import ThermalAdjustmentCorridor3D from './ThermalAdjustmentCorridor3D.jsx';

let host;
let root;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const render = (ui) => act(() => root.render(ui));

describe('Hydro & Thermal 10 3D Settlement & Operations Pipelines', () => {
  describe('1. HydroWaterToWirePipeline3D', () => {
    it('renders with default fallback benchmark', () => {
      render(<HydroWaterToWirePipeline3D />);
      expect(host.textContent).toContain('Hydro Water-to-Wire Two-Part Tariff Settlement Pipeline');
      expect(host.textContent).toContain('STAGE 1: HYDROLOGY');
      expect(host.textContent).toContain('STAGE 2: AUX & FREE POWER');
      expect(host.textContent).toContain('STAGE 3: TWO-PART TARIFF');
      expect(host.textContent).toContain('STAGE 4: COMMITTED BILL');
    });

    it('reacts dynamically to live station and bill props', () => {
      const mockBill = {
        station_name: 'Nathpa Jhakri HPS',
        a1_afc: 16000000000,
        a2_design_energy_mwh: 6612000,
        a3_aux_pct: 1.2,
        a4_fehs_pct: 13.0,
        a11_napaf_pct: 90.0,
        a12_ecr: 1.65,
        c1_pafm_pct: 99.8,
        c5_total_capacity_charge: 133333333,
        e1_ex_bus_scheduled_kwh: 350000000,
        e2_free_power_kwh: 45500000,
        e3_saleable_scheduled_kwh: 304500000,
        ee1_energy_charge: 50242500,
        total_charges: 183575833,
      };
      render(<HydroWaterToWirePipeline3D bill={mockBill} />);
      expect(host.textContent).toContain('Nathpa Jhakri');
      expect(host.textContent).toContain('PAFM 99.8%');
    });
  });

  describe('2. HydroBeneficiaryWaterfall3D', () => {
    it('renders with standard NRPC Table D2 beneficiaries', () => {
      render(<HydroBeneficiaryWaterfall3D />);
      expect(host.textContent).toContain('Hydro Beneficiary Allocation & Regional Wheeling Waterfall');
      expect(host.textContent).toContain('HPSEBL');
      expect(host.textContent).toContain('UPPCL');
      expect(host.textContent).toContain('JKPDD');
      expect(host.textContent).toContain('PSPCL');
    });

    it('filters beneficiaries dynamically on button click', () => {
      render(<HydroBeneficiaryWaterfall3D />);
      const hpBtn = Array.from(host.querySelectorAll('button')).find((b) => b.textContent.includes('Himachal'));
      expect(hpBtn).toBeDefined();
      act(() => hpBtn.click());
      expect(host.textContent).toContain('HPSEBL');
    });
  });

  describe('3. HydroAdjustmentCorridor3D', () => {
    it('renders with default sample case', () => {
      render(<HydroAdjustmentCorridor3D />);
      expect(host.textContent).toContain('Hydro True-Up & Supplementary Adjustment Corridor');
      expect(host.textContent).toContain('STAGE 1: BASELINE');
      expect(host.textContent).toContain('STAGE 4: ARREAR BILL');
    });

    it('binds live preview differential calculation and order reference', () => {
      const mockPreview = {
        from_month: '2026-04',
        to_month: '2026-09',
        months: ['2026-04', '2026-05', '2026-06'],
        total_differential: 45000000,
        beneficiaries: [
          { beneficiary_name: 'HPSEBL (HP)', pct_proportionate: 37.64, differential: 16938000 },
          { beneficiary_name: 'UPPCL (UP)', pct_proportionate: 14.73, differential: 6628500 },
        ],
      };
      const mockArrear = { reason: 'CERC True-up Order Petition 55/GT/2026' };
      render(<HydroAdjustmentCorridor3D preview={mockPreview} arrearForm={mockArrear} />);
      expect(host.textContent).toContain('CERC True-up Order Petition 55/GT/2026');
      expect(host.textContent).toContain('2026-04 to 2026-09 (3 mos)');
      expect(host.textContent).toContain('Across 2 Beneficiaries');
    });
  });

  describe('4. HydroSecurityCoverageVault3D', () => {
    it('renders with default coverage metrics and beneficiaries', () => {
      render(<HydroSecurityCoverageVault3D />);
      expect(host.textContent).toContain('Hydro Payment Security & LC Coverage Vault');
      expect(host.textContent).toContain('Total Required Collateral');
      expect(host.textContent).toContain('Live LC Vault Strength');
      expect(host.textContent).toContain('HPSEBL (Himachal)');
    });

    it('binds live rows and instruments with 3-tier status evaluation', () => {
      const mockRows = [
        { beneficiary_name: 'UPPCL', average_monthly_billing: 20000000, required: 21000000, live_cover: 15000000, shortfall: 6000000, status: 'SHORT' },
        { beneficiary_name: 'HPSEBL', average_monthly_billing: 50000000, required: 52500000, live_cover: 60000000, shortfall: 0, status: 'COVERED' },
      ];
      const mockInstruments = [
        { beneficiary_name: 'UPPCL', instrument_no: 'LC-UP-001', issuing_bank: 'PNB', days_to_expiry: 15, expiring_soon: true },
      ];
      render(<HydroSecurityCoverageVault3D rows={mockRows} instruments={mockInstruments} coverPct={105} />);
      expect(host.textContent).toContain('UPPCL');
      expect(host.textContent).toContain('SHORTFALL');
    });

    it('renders thermal payment security title and thermal off-takers when vertical=THERMAL', () => {
      render(<HydroSecurityCoverageVault3D vertical="THERMAL" />);
      expect(host.textContent).toContain('Thermal Payment Security & LC Coverage Vault');
      expect(host.textContent).toContain('NBPDCL (North Bihar)');
      expect(host.textContent).toContain('SBPDCL (South Bihar)');
    });
  });

  describe('5. ThermalCoalToBusbarECR3D', () => {
    it('renders with default supercritical thermal unit parameters', () => {
      render(<ThermalCoalToBusbarECR3D />);
      expect(host.textContent).toContain('Thermal Coal-to-Busbar ECR & Heat-Rate Corridor');
      expect(host.textContent).toContain('STAGE 1: FUEL INPUT');
      expect(host.textContent).toContain('STAGE 2: THERMODYNAMICS');
      expect(host.textContent).toContain('STAGE 3: CERC ECR ENGINE');
      expect(host.textContent).toContain('STAGE 4: COMMITTED ENERGY');
    });

    it('dynamically computes ECR when fuel and tariff props change', () => {
      const mockFuel = { coal_rs_per_tonne: 4200, gcv_kcal_per_kg: 3500, oil_rs_per_kl: 65000 };
      const mockTariff = { gross_heat_rate: 2250, aux_pct: 5.75, sfc_ml_per_kwh: 0.50, cv_secondary_kcal_per_ml: 10.0 };
      render(<ThermalCoalToBusbarECR3D fuel={mockFuel} tariff={mockTariff} />);
      expect(host.textContent).toContain('₹4,200');
      expect(host.textContent).toContain('3,500 kCal/kg');
    });
  });

  describe('6. ThermalCapacityRecoveryGate3D', () => {
    it('renders with default annual fixed cost pool and availability gate', () => {
      render(<ThermalCapacityRecoveryGate3D />);
      expect(host.textContent).toContain('Thermal Capacity Charge & PAFM vs NAPAF Recovery Gate');
      expect(host.textContent).toContain('STAGE 1: AFC POOL');
      expect(host.textContent).toContain('STAGE 2: AVAILABILITY GATE');
      expect(host.textContent).toContain('STAGE 3: INCENTIVE ENGINE');
      expect(host.textContent).toContain('STAGE 4: COMMITTED CHARGE');
    });

    it('dynamically responds to bill PAFM and NAPAF values', () => {
      const mockBill = {
        a1_afc: 19000000000,
        a11_napaf_pct: 85.0,
        c1_pafm_pct: 91.2,
        c5_total_capacity_charge: 158333333,
      };
      render(<ThermalCapacityRecoveryGate3D bill={mockBill} />);
      expect(host.textContent).toContain('91.2%');
      expect(host.textContent).toContain('NAPAF 85%');
      expect(host.textContent).toContain('FULL RECOVERY');
    });
  });

  describe('7. ThermalCoalBlendingInflow3D', () => {
    it('renders with default 10% blending preset', () => {
      render(<ThermalCoalBlendingInflow3D />);
      expect(host.textContent).toContain('Coal Blending & Domestic vs Imported Fuel Inflow');
      expect(host.textContent).toContain('STAGE 1: DUAL INFLOW');
      expect(host.textContent).toContain('STAGE 2: BUNKER BLEND');
      expect(host.textContent).toContain('STAGE 3: DISPATCH MERIT');
    });

    it('switches blend presets and recalculates weighted parameters', () => {
      render(<ThermalCoalBlendingInflow3D />);
      const domBtn = Array.from(host.querySelectorAll('button')).find((b) => b.textContent.includes('100% Domestic'));
      expect(domBtn).toBeDefined();
      act(() => domBtn.click());
      expect(host.textContent).toContain('Linkage Ratio: 100% / 0%');
    });
  });

  describe('8. ThermalUrsMarketDiversion3D', () => {
    it('renders with default URS surrender case', () => {
      render(<ThermalUrsMarketDiversion3D />);
      expect(host.textContent).toContain('Thermal Beneficiary Dispatch & URS Power Market Diversion');
      expect(host.textContent).toContain('STAGE 1: SURRENDER GATE');
      expect(host.textContent).toContain('STAGE 2: EXCHANGE DISPATCH');
      expect(host.textContent).toContain('STAGE 3: 50:50 SHARING');
    });

    it('toggles between NBPDCL and SBPDCL URS cases', () => {
      render(<ThermalUrsMarketDiversion3D />);
      const sbpdclBtn = Array.from(host.querySelectorAll('button')).find((b) => b.textContent.includes('SBPDCL'));
      expect(sbpdclBtn).toBeDefined();
      act(() => sbpdclBtn.click());
      expect(host.textContent).toContain('120 MW');
    });
  });

  describe('9. SjvnMacroEnergyCorridor3D', () => {
    it('renders full operating fleet and aggregate metrics', () => {
      render(<SjvnMacroEnergyCorridor3D />);
      expect(host.textContent).toContain('SJVN Fleet-Wide Hydro-Thermal Macro Energy Corridor');
      expect(host.textContent).toContain('Nathpa Jhakri HPS');
      expect(host.textContent).toContain('Rampur HPS');
      expect(host.textContent).toContain('Luhri Stage-I HEP');
      expect(host.textContent).toContain('Buxar Thermal Power Project');
    });

    it('filters fleet between ALL, HYDRO, and THERMAL', () => {
      render(<SjvnMacroEnergyCorridor3D />);
      const hydroBtn = Array.from(host.querySelectorAll('button')).find((b) => b.textContent.includes('Hydro Fleet'));
      expect(hydroBtn).toBeDefined();
      act(() => hydroBtn.click());
      expect(host.textContent).toContain('Nathpa Jhakri');
      expect(host.textContent).not.toContain('Buxar Thermal Power Project');
    });
  });

  describe('10. LatePaymentSurchargeLadder3D', () => {
    it('renders 4 statutory tiers under MoP LPS Rules 2022', () => {
      render(<LatePaymentSurchargeLadder3D />);
      expect(host.textContent).toContain('Late Payment Surcharge (LPS) & Escalation Ladder');
      expect(host.textContent).toContain('TIER 1: PROMPT REBATE');
      expect(host.textContent).toContain('TIER 2: NET DUE DATE');
      expect(host.textContent).toContain('TIER 3: LPS TRIGGER');
      expect(host.textContent).toContain('TIER 4: REGULATION & LC');
    });

    it('calculates rebate in Tier 1 and surcharge in Tier 3 based on active day', () => {
      render(<LatePaymentSurchargeLadder3D invoiceAmount={1000000000} />);
      // Click Day 5 (Rebate)
      const day5Btn = Array.from(host.querySelectorAll('button')).find((b) => b.textContent.includes('Day 5'));
      act(() => day5Btn.click());
      expect(host.textContent).toContain('Rebate Earned');
      expect(host.textContent).toContain('1.5%');

      // Click Day 60 (LPS)
      const day60Btn = Array.from(host.querySelectorAll('button')).find((b) => b.textContent.includes('Day 60'));
      act(() => day60Btn.click());
      expect(host.textContent).toContain('LPS Surcharge');
    });
  });

  describe('11. ThermalTariffArchitectureDoc3D', () => {
    it('renders CERC two-part tariff formulas (Capacity Charge Reg 42 & Energy Charge Reg 43)', () => {
      render(
        <MemoryRouter>
          <ThermalTariffArchitectureDoc3D />
        </MemoryRouter>
      );
      expect(host.textContent).toContain('CERC Two-Part Tariff Settlement Architecture');
      expect(host.textContent).toContain('1. Fixed Capacity Charge (AFC Recovery)');
      expect(host.textContent).toContain('2. Variable Energy Charge (Fuel Cost Pass-Through)');
      expect(host.textContent).toContain('CERC Reg 42');
      expect(host.textContent).toContain('CERC Reg 43');
      expect(host.textContent).toContain('Monthly Capacity Charge =');
      expect(host.textContent).toContain('Energy Charge = ECR × Ex-Bus Scheduled Generation');
    });

    it('switches between Formula, Annual/Monthly Setup, and Live Simulator tabs', () => {
      render(
        <MemoryRouter>
          <ThermalTariffArchitectureDoc3D />
        </MemoryRouter>
      );

      // Switch to Annual vs Monthly Setup tab
      const lifecycleBtn = Array.from(host.querySelectorAll('button')).find((b) => b.textContent.includes('Annual vs Monthly'));
      act(() => lifecycleBtn.click());
      expect(host.textContent).toContain('Step 1: Annual Baseline Norms');
      expect(host.textContent).toContain('Step 2: Monthly Operational Inflow');
      expect(host.textContent).toContain('CERC Section 62 Tariff Order');
      expect(host.textContent).toContain('Station Fuel Audit Statement (CERC Form 15)');

      // Switch to Live Tariff Simulator tab
      const simulatorBtn = Array.from(host.querySelectorAll('button')).find((b) => b.textContent.includes('Live Tariff Simulator'));
      act(() => simulatorBtn.click());
      expect(host.textContent).toContain('Interactive Thermal Tariff & Recovery Simulator');
      expect(host.textContent).toContain('Capacity Recovery Ratio');
      expect(host.textContent).toContain('Energy Charge Rate (ECR)');
      expect(host.textContent).toContain('Total Monthly Discom Bill');
    });
  });

  describe('12. ThermalAdjustmentCorridor3D', () => {
    it('renders with default STPP Buxar case and Bihar beneficiaries', () => {
      render(<ThermalAdjustmentCorridor3D />);
      expect(host.textContent).toContain('Thermal True-Up & Supplementary Adjustment Corridor');
      expect(host.textContent).toContain('CERC THERMAL TRUE-UP (REG 10 & 42)');
      expect(host.textContent).toContain('STAGE 1: BASELINE');
      expect(host.textContent).toContain('STAGE 2: CERC DELTA');
      expect(host.textContent).toContain('STAGE 3: CARRYING COST');
      expect(host.textContent).toContain('STAGE 4: ARREAR BILL');
      expect(host.textContent).toContain('NBPDCL (North Bihar)');
      expect(host.textContent).toContain('SBPDCL (South Bihar)');
      expect(host.textContent).toContain('GRIDCO (Odisha)');
    });

    it('binds live preview differential calculation and order reference for thermal', () => {
      const mockPreview = {
        from_month: '2026-04',
        to_month: '2026-09',
        months: ['2026-04', '2026-05'],
        total_differential: 65000000,
        beneficiaries: [
          { beneficiary_name: 'NBPDCL (North Bihar)', pct_proportionate: 50.0, differential: 32500000 },
          { beneficiary_name: 'SBPDCL (South Bihar)', pct_proportionate: 35.0, differential: 22750000 },
        ],
      };
      const mockArrear = { reason: 'CERC True-up Order STPP Buxar Petition 28/GT/2026' };
      render(<ThermalAdjustmentCorridor3D preview={mockPreview} arrearForm={mockArrear} />);
      expect(host.textContent).toContain('CERC True-up Order STPP Buxar Petition 28/GT/2026');
      expect(host.textContent).toContain('Across 2 Thermal Off-takers');
    });
  });
});

