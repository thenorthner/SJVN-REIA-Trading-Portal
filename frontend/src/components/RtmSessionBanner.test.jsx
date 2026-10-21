import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

vi.mock('../api/client.js', () => ({ api: { bids: { rtmSession: vi.fn() } } }));
import { api } from '../api/client.js';
import RtmSessionBanner, { formatCountdown } from './RtmSessionBanner.jsx';

const session = (over = {}) => ({
  session_no: 26, delivery_date: '2026-08-20', delivery_from: '12:30', delivery_to: '13:00',
  gate_closes_at: '2026-08-20T06:00:00.000Z', server_time: '2026-08-20T05:58:04.000Z', ...over,
});

describe('formatCountdown', () => {
  it('shows minutes and seconds, adding hours past an hour', () => {
    expect(formatCountdown(116)).toBe('01m 56s');
    expect(formatCountdown(3725)).toBe('1h 02m 05s');
    expect(formatCountdown(-4)).toBe('00m 00s');
  });
});

let host;
let root;
const text = () => host.textContent;
const mount = () => act(async () => { root.render(<RtmSessionBanner />); await Promise.resolve(); });

describe('RtmSessionBanner', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'Date'] });
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('counts down against the server clock, not the browser clock', async () => {
    // Browser clock is an hour wrong; the server says the gate is 1m56s away.
    vi.setSystemTime(new Date('2026-08-20T06:58:04.000Z'));
    api.bids.rtmSession.mockResolvedValue(session());
    await mount();
    expect(text()).toMatch(/session #26/i);
    expect(text()).toContain('01m 56s');
    await act(async () => { vi.advanceTimersByTime(3000); });
    expect(text()).toContain('01m 53s');
    expect(text()).toMatch(/closing soon/i);
  });

  it('asks for the next session once the gate has closed', async () => {
    vi.setSystemTime(new Date('2026-08-20T05:59:58.000Z'));
    api.bids.rtmSession.mockResolvedValueOnce(session({ server_time: '2026-08-20T05:59:58.000Z' }));
    api.bids.rtmSession.mockResolvedValue(session({
      session_no: 27, delivery_from: '13:00', delivery_to: '13:30',
      gate_closes_at: '2026-08-20T06:30:00.000Z', server_time: '2026-08-20T06:00:02.000Z',
    }));
    await mount();
    await act(async () => { vi.advanceTimersByTime(4000); });
    await act(async () => { await Promise.resolve(); });
    expect(api.bids.rtmSession).toHaveBeenCalledTimes(2);
    expect(text()).toMatch(/session #27/i);
  });

  it('says so when the clock cannot be fetched', async () => {
    api.bids.rtmSession.mockRejectedValue(new Error('down'));
    await mount();
    expect(text()).toMatch(/clock unavailable/i);
  });
});
