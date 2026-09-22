import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

// A note needs a second person: its maker sees it waiting, anyone else with the
// right role can approve or reject it. Issued notes print; drafts do not.

const state = vi.hoisted(() => ({ notes: [], calls: [] }));
vi.mock('../../api/client.js', () => {
  const api = {
    notes: {
      list: () => Promise.resolve(state.notes),
      approve: (id) => { state.calls.push(['approve', id]); return Promise.resolve({}); },
      reject: (id, reason) => { state.calls.push(['reject', id, reason]); return Promise.resolve({}); },
      create: (b) => { state.calls.push(['create', b]); return Promise.resolve({}); },
      cancel: () => Promise.resolve({}),
      downloadPdf: () => Promise.resolve(new Blob()),
    },
    invoices: { list: () => Promise.resolve([]) },
  };
  return { api, default: api };
});

const { default: NotesPanel, isOwnNote } = await import('./NotesPanel.jsx');

const INVOICE = { id: 'INV-1', contract_id: 'C-1', direction: 'SJVN_TO_BUYER', invoice_no: 'PSA/1' };
const DRAFT = {
  id: 'N-1', note_no: 'DRAFT-N-1', note_type: 'DEBIT', status: 'DRAFT', effective_status: 'DRAFT', model: 'V2',
  amount: 11800, tax_amount: 1800, tax_label: 'IGST 18%', reason_code: 'REVISED_REA', reason_label: 'Revised / amended REA',
  created_by: 'Asha', created_by_id: 'U-MAKER', credit_applications: [], unapplied_credit: 0,
};

let container; let root;
beforeEach(() => {
  state.calls = [];
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

async function render(user, notes) {
  state.notes = notes;
  await act(async () => { root.render(<NotesPanel invoice={INVOICE} user={user} canWrite />); });
  await act(async () => { await Promise.resolve(); });
}
const buttons = () => [...container.querySelectorAll('button')].map((b) => b.textContent.trim());

describe('NotesPanel', () => {
  it('tells the maker the draft waits for someone else, and offers no Approve', async () => {
    await render({ id: 'U-MAKER', name: 'Asha' }, [DRAFT]);
    expect(buttons()).not.toContain('Approve');
    expect(container.textContent).toMatch(/awaiting another approver/);
  });

  it('lets a different user approve the draft', async () => {
    await render({ id: 'U-CHECKER', name: 'Ravi' }, [DRAFT]);
    const approve = [...container.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Approve');
    await act(async () => { approve.click(); });
    expect(state.calls).toContainEqual(['approve', 'N-1']);
  });

  it('shows the tax, and does not print a draft', async () => {
    await render({ id: 'U-CHECKER', name: 'Ravi' }, [DRAFT]);
    expect(container.textContent).toMatch(/IGST 18%/);
    expect(buttons()).not.toContain('PDF');
  });

  it('prints an issued note under its own number', async () => {
    await render({ id: 'U-CHECKER', name: 'Ravi' }, [{ ...DRAFT, status: 'ISSUED', effective_status: 'ISSUED', note_no: 'DN/2026-27/00001' }]);
    expect(buttons()).toContain('PDF');
    expect(buttons()).not.toContain('Approve');
    expect(container.textContent).toMatch(/DN\/2026-27\/00001/);
  });

  it('matches the maker by id, and by name only for notes that predate ids', () => {
    expect(isOwnNote({ created_by_id: 'U-1', created_by: 'X' }, { id: 'U-1', name: 'Y' })).toBe(true);
    expect(isOwnNote({ created_by_id: 'U-1', created_by: 'X' }, { id: 'U-2', name: 'X' })).toBe(false);
    expect(isOwnNote({ created_by: 'X' }, { id: 'U-2', name: 'X' })).toBe(true);
  });
});
