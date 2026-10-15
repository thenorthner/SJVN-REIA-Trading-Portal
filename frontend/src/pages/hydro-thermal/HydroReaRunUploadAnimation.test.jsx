import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import ReaDraftingCorridor3D from '../../components/ReaDraftingCorridor3D.jsx';

describe('ReaDraftingCorridor3D pipeline component', () => {
  it('renders all 5 pipeline stages accurately', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(
        <ReaDraftingCorridor3D 
          running={true}
          stageIndex={1}
          mode="UPLOAD"
          fileName="REA_NRPC_2026-08.pdf"
        />
      );
    });

    // All 5 stages should be present in the corridor
    expect(host.textContent).toContain('Document Ingestion & Integrity Check');
    expect(host.textContent).toContain('Table D2 Availability & Generation Extraction');
    expect(host.textContent).toContain('Multi-State Beneficiary Apportionment');
    expect(host.textContent).toContain('CERC Two-Part Tariff Calculation Engine');
    expect(host.textContent).toContain('Settlement Inscription & Draft Bill Generation');

    // Mode and file name badge should be visible
    expect(host.textContent).toContain('REA PDF Upload Corridor');
    expect(host.textContent).toContain('REA_NRPC_2026-08.pdf');

    await act(async () => root.unmount());
    host.remove();
  });

  it('displays completed result state with draft bills count and reset trigger', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const mockReset = vi.fn();
    const resultData = {
      bills: [
        { bill_no: 'HB/2026-08/NJHPS-001' },
        { bill_no: 'HB/2026-08/RAMPUR-002' }
      ],
      months_processed: ['2026-08'],
      pafm_pct: 104.25,
      napaf_pct: 85.0
    };

    await act(async () => {
      root.render(
        <ReaDraftingCorridor3D 
          running={false}
          result={resultData}
          mode="UPLOAD"
          fileName="REA_NRPC_2026-08.pdf"
          onReset={mockReset}
        />
      );
    });

    expect(host.textContent).toContain('REA Ingestion & Draft Generation Complete');
    expect(host.textContent).toContain('Draft Bills Generated');
    expect(host.textContent).toContain('HB/2026-08/NJHPS-001');
    expect(host.textContent).toContain('HB/2026-08/RAMPUR-002');

    const resetBtn = host.querySelector('button');
    expect(resetBtn).not.toBeNull();
    await act(async () => {
      resetBtn.click();
    });
    expect(mockReset).toHaveBeenCalledTimes(1);

    await act(async () => root.unmount());
    host.remove();
  });

  it('renders error state clearly if processing fails', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const mockReset = vi.fn();

    await act(async () => {
      root.render(
        <ReaDraftingCorridor3D 
          running={false}
          error="Corrupt PDF: Table D2 header not found in uploaded file"
          mode="UPLOAD"
          onReset={mockReset}
        />
      );
    });

    expect(host.textContent).toContain('Processing Interrupted');
    expect(host.textContent).toContain('Corrupt PDF: Table D2 header not found in uploaded file');

    const retryBtn = host.querySelector('button');
    expect(retryBtn).not.toBeNull();
    await act(async () => {
      retryBtn.click();
    });
    expect(mockReset).toHaveBeenCalledTimes(1);

    await act(async () => root.unmount());
    host.remove();
  });
});
