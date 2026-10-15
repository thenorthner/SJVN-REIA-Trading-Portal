import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter } from 'react-router-dom';
import Login, { landingFor } from './Login.jsx';
import * as AuthContext from '../context/AuthContext';

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
  vi.restoreAllMocks();
});

describe('Login Page Layout & Demo Accounts', () => {
  it('renders all 15 demo accounts and allows filtering by category', async () => {
    vi.spyOn(AuthContext, 'useAuth').mockReturnValue({
      login: vi.fn(),
    });

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/login']}>
          <Login />
        </MemoryRouter>
      );
    });

    // Check branding
    expect(host.textContent).toContain('RE Commercial & Trading');
    expect(host.textContent).toContain('Enterprise Management Platform');

    // Check stats bar
    expect(host.textContent).toContain('2,000+ MW');
    expect(host.textContent).toContain('Installed Capacity');

    // Check that all 15 demo buttons are present in All view
    expect(host.textContent).toContain('SJVN Admin');
    expect(host.textContent).toContain('Trading Client');
    expect(host.textContent).toContain('Buyer Checker (L2)');

    // Check category buttons
    const staffBtn = Array.from(host.querySelectorAll('button')).find((b) => b.textContent.includes('SJVN (10)'));
    const partyBtn = Array.from(host.querySelectorAll('button')).find((b) => b.textContent.includes('Counterparty (5)'));
    const allBtn = Array.from(host.querySelectorAll('button')).find((b) => b.textContent.includes('All (15)'));

    expect(staffBtn).toBeTruthy();
    expect(partyBtn).toBeTruthy();

    // Filter to Counterparties
    await act(async () => {
      partyBtn.click();
    });

    expect(host.textContent).toContain('Seller');
    expect(host.textContent).toContain('Trading Client');
    expect(host.textContent).not.toContain('Hydro Admin');

    // Filter back to All
    await act(async () => {
      allBtn.click();
    });

    expect(host.textContent).toContain('Hydro Admin');
    expect(host.textContent).toContain('Trading Client');

    // Clicking a demo account fills form
    const hydroBtn = Array.from(host.querySelectorAll('button')).find((b) => b.textContent.includes('Hydro Admin'));
    await act(async () => {
      hydroBtn.click();
    });

    const emailInput = host.querySelector('input[type="email"]');
    expect(emailInput.value).toBe('commercial@sjvn.in');
  });

  it('correctly directs users to respective landings via landingFor', () => {
    expect(landingFor({ role: 'COMMERCIAL_ADMIN' }, null)).toBe('/hydro-thermal');
    expect(landingFor({ role: 'THERMAL_ADMIN' }, null)).toBe('/thermal');
    expect(landingFor({ role: 'SELLER' }, null)).toBe('/');
  });
});
