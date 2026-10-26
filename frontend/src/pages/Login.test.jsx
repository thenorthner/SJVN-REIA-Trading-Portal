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
  it('renders the sign-in form with no demo login shortcuts', async () => {
    vi.spyOn(AuthContext, 'useAuth').mockReturnValue({ login: vi.fn() });

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/login']}>
          <Login />
        </MemoryRouter>
      );
    });

    expect(host.querySelector('input[type="email"]')).toBeTruthy();
    expect(host.querySelector('#login-password')).toBeTruthy();
    expect(host.querySelector('#quick-demo-select')).toBeNull();
    expect(host.textContent).not.toContain('Quick Demo Login');
  });

  it('correctly directs users to respective landings via landingFor', () => {
    expect(landingFor({ role: 'COMMERCIAL_ADMIN' }, null)).toBe('/hydro-thermal');
    expect(landingFor({ role: 'THERMAL_ADMIN' }, null)).toBe('/thermal');
    expect(landingFor({ role: 'SELLER' }, null)).toBe('/');
  });
});
