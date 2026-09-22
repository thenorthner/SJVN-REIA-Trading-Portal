import { test, expect } from '@playwright/test';
import { CONTRACTS, ENTITIES } from './fixtures.js';
import { runtime } from './support.js';

const hydro = CONTRACTS.hydro;

// The form's fields wrap their control in the label, so a select's accessible
// name carries its options too ("Contract Type PPA (Seller → SJVN)" matches
// "Seller"). This finds a field by its label text alone — a required field's
// label also carries " * (required)".
const field = (scope, label) => scope.locator('label.field')
  .filter({ has: scope.page().locator('.field-label', { hasText: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}(\\s*\\*.*)?$`) }) })
  .locator('input, select, textarea')
  .first();

// The server began refusing an amendment without the date it takes effect from;
// the form was never given a field for it, so every amendment failed with
// "effective_from (YYYY-MM-DD) is required".
test.describe('Amend Contract', () => {
  // A contract of its own for each test: an amendment adds a version, and a
  // second run against the shared hydro PPA would find two rows with its number.
  let contract;
  test.beforeEach(async ({ request }) => {
    const { token } = runtime();
    const res = await request.post('/api/contracts', {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        ...hydro, id: undefined, status: 'ACTIVE', billing_cycle: 'MONTHLY', payment_terms_days: 45,
        contract_no: `PPA/E2E/AMEND/${Date.now()}`,
      },
    });
    expect(res.status(), await res.text()).toBe(201);
    contract = await res.json();
  });

  async function openAmend(page) {
    await page.goto('/reia/contracts');
    await page.locator('tbody tr', { hasText: contract.contract_no }).click();
    await page.getByRole('dialog', { name: `Contract: ${contract.contract_no}` }).getByRole('button', { name: 'Amend Contract' }).click();
    const dialog = page.getByRole('dialog', { name: `Amend Contract: ${contract.contract_no}` });
    await expect(dialog).toBeVisible();
    return dialog;
  }

  test('asks for the date the amendment applies from, within the contract\'s tenure', async ({ page }) => {
    const dialog = await openAmend(page);
    const effective = dialog.getByLabel('Effective From');
    await expect(effective).toBeVisible();
    await expect(effective).toHaveValue('');
    await expect(effective).toHaveAttribute('min', hydro.tenure_start);
    await expect(effective).toHaveAttribute('max', hydro.tenure_end);

    // Left blank, the form does not send anything for the server to refuse.
    let sent = false;
    page.on('request', (r) => { if (r.url().includes('/amend')) sent = true; });
    await dialog.getByLabel('Amendment Reason').fill('Tariff order');
    await dialog.getByRole('button', { name: /Submit Amendment/ }).click();
    expect(await effective.evaluate((el) => el.validity.valueMissing)).toBe(true);
    expect(sent).toBe(false);
  });

  test('files an amendment as the next version, dated from the day given', async ({ page, request }) => {
    const dialog = await openAmend(page);
    await dialog.getByLabel('Effective From').fill('2026-10-01');
    await dialog.getByLabel('Tariff (₹/unit)').fill('1.30');
    await dialog.getByLabel('Amendment Reason').fill('CERC tariff order for FY 2026-27');

    const saved = page.waitForResponse((r) => r.url().includes(`/api/contracts/${contract.id}/amend`));
    await dialog.getByRole('button', { name: /Submit Amendment/ }).click();
    const res = await saved;
    expect(res.status(), await res.text()).toBeLessThan(300);
    await expect(dialog).toBeHidden();

    const { token } = runtime();
    const list = await (await request.get('/api/contracts', { headers: { Authorization: `Bearer ${token}` } })).json();
    const v2 = list.find((c) => c.contract_no === contract.contract_no && c.version === 2);
    expect(v2, 'the amendment created version 2').toBeTruthy();
    expect(v2.amendment_effective_from).toBe('2026-10-01');
    expect(Number(v2.tariff_per_unit)).toBe(1.3);
  });
});

// Hydro — SJVN's own generation — was missing from the project types a new
// contract could be given, though existing contracts carried it and the form had
// a hydro section waiting for it.
test.describe('New Contract', () => {
  async function openCreate(page) {
    await page.goto('/reia/contracts');
    await page.getByRole('button', { name: '+ New Contract' }).click();
    const dialog = page.getByRole('dialog', { name: 'Create New Contract' });
    await expect(dialog).toBeVisible();
    return dialog;
  }

  test('offers every project type the platform bills, Hydro included', async ({ page }) => {
    const dialog = await openCreate(page);
    const types = await dialog.getByLabel('Project Type').locator('option').evaluateAll((os) => os.map((o) => o.value));
    expect(types).toEqual(expect.arrayContaining(['Solar', 'Wind', 'Hybrid', 'FDRE', 'Hydro', 'PSP', 'Storage']));
  });

  test('creates a hydro PPA from the form', async ({ page, request }) => {
    const dialog = await openCreate(page);
    const contractNo = `PPA/E2E/HYDRO/${Date.now()}`;
    await dialog.getByLabel('Contract No.').fill(contractNo);
    await field(dialog, 'Seller').selectOption(ENTITIES.hydroSeller.id);
    await dialog.getByLabel('Project Type').selectOption('Hydro');
    await expect(dialog.getByRole('heading', { name: /Hydro-Specific Parameters/ })).toBeVisible();
    await dialog.getByLabel('Total Capacity (MW)').fill('800');
    await dialog.getByLabel('Base Tariff (₹/unit)').fill('1.80');
    await dialog.getByLabel('Tenure Start').fill('2026-10-01');
    await dialog.getByLabel('Tenure End').fill('2061-09-30');

    const saved = page.waitForResponse((r) => r.url().endsWith('/api/contracts') && r.request().method() === 'POST');
    await dialog.getByRole('button', { name: 'Create Draft Contract' }).click();
    const res = await saved;
    expect(res.status(), await res.text()).toBeLessThan(300);
    await expect(dialog).toBeHidden();
    await expect(page.locator('tbody tr', { hasText: contractNo })).toBeVisible();

    const { token } = runtime();
    const list = await (await request.get('/api/contracts', { headers: { Authorization: `Bearer ${token}` } })).json();
    expect(list.find((c) => c.contract_no === contractNo)?.project_type).toBe('Hydro');
  });
});
