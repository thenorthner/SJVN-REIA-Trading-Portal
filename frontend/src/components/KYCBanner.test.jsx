import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter } from 'react-router-dom';
import KYCBanner from './KYCBanner.jsx';
import api from '../api/client.js';
import * as AuthContext from '../context/AuthContext';

let host;
let root;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  localStorage.clear();
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

describe('KYCBanner Ack & Dismiss Feature', () => {
  it('renders the red banner for rejected documents and dismisses it when Ack is clicked', async () => {
    vi.spyOn(AuthContext, 'useAuth').mockReturnValue({
      user: {
        id: 'usr_seller_1',
        role: 'SELLER',
        entity: { id: 'ent_seller_1', status: 'APPROVED' },
      },
    });

    vi.spyOn(api.documents, 'list').mockResolvedValue([
      {
        id: 'doc_1',
        title: 'Grid Connectivity Approval',
        verification_status: 'REJECTED',
        expiry_state: 'VALID',
      },
    ]);
    vi.spyOn(api.documents, 'requests').mockResolvedValue([]);

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/notification-board']}>
          <KYCBanner />
        </MemoryRouter>
      );
    });

    // Verify banner text is present
    expect(host.textContent).toContain('1 document was rejected by SJVN');
    expect(host.textContent).toContain('Please submit updated physical copies to the SJVN REIA desk');

    // Find the Ack button
    const ackBtn = Array.from(host.querySelectorAll('button')).find((b) => b.textContent.includes('Ack'));
    expect(ackBtn).toBeTruthy();

    // Click Ack
    await act(async () => {
      ackBtn.click();
    });

    // Verify banner is dismissed
    expect(host.textContent).not.toContain('1 document was rejected by SJVN');

    // Verify persistence in localStorage
    expect(localStorage.getItem('sjvn_kyc_parts_ack_ent_seller_1')).toBeTruthy();

    // Remount component - banner should remain dismissed
    act(() => root.unmount());
    root = createRoot(host);

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/notification-board']}>
          <KYCBanner />
        </MemoryRouter>
      );
    });

    expect(host.textContent).not.toContain('1 document was rejected by SJVN');
  });

  it('renders and dismisses entity remarks banner when entity status is REJECTED', async () => {
    vi.spyOn(AuthContext, 'useAuth').mockReturnValue({
      user: {
        id: 'usr_seller_2',
        role: 'SELLER',
        entity: { id: 'ent_seller_2', status: 'REJECTED' },
      },
    });

    vi.spyOn(api.documents, 'list').mockResolvedValue([]);
    vi.spyOn(api.documents, 'requests').mockResolvedValue([]);

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/seller/dashboard']}>
          <KYCBanner />
        </MemoryRouter>
      );
    });

    expect(host.textContent).toContain('Your company KYC has remarks from SJVN');
    const ackBtn = Array.from(host.querySelectorAll('button')).find((b) => b.textContent.includes('Ack'));
    expect(ackBtn).toBeTruthy();

    await act(async () => {
      ackBtn.click();
    });

    expect(host.textContent).not.toContain('Your company KYC has remarks from SJVN');
  });
});
