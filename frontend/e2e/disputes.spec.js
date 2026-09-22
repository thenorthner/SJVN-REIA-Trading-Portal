import { test, expect } from '@playwright/test';
import { EVIDENCE, UNRELATED_DOCUMENT } from './fixtures.js';
import { runtime, horizontalOverflow, scrollsSideways } from './support.js';

// The evidence box in a dispute listed every document on the platform — CERC
// reports included — and its table ran past the right edge of the box, taking
// the Uploaded dates with it. What was uploaded through it was never tied to
// the dispute at all.

async function openDispute(page) {
  const { disputeNo } = runtime();
  await page.goto('/reia/disputes');
  await page.locator('tbody tr', { hasText: disputeNo }).click();
  const dialog = page.getByRole('dialog', { name: new RegExp(disputeNo.replace(/\//g, '\\/')) });
  await expect(dialog).toBeVisible();
  const evidence = dialog.locator('.card').filter({ has: page.getByRole('heading', { name: 'Dispute Evidence & Resolution Notes' }) });
  await evidence.scrollIntoViewIfNeeded();
  return { dialog, evidence };
}

test('lists this dispute\'s own evidence and nothing else from the platform', async ({ page, request }) => {
  const { disputeId, token } = runtime();
  const record = await (await request.get(`/api/disputes/${disputeId}`, { headers: { Authorization: `Bearer ${token}` } })).json();
  const own = record.supporting_docs.map((d) => d.original_name);

  const { evidence } = await openDispute(page);
  await expect(evidence.locator('tbody tr')).toHaveCount(own.length);
  for (const name of own) await expect(evidence).toContainText(name);
  for (const file of EVIDENCE) await expect(evidence).toContainText(file.name);
  await expect(evidence).not.toContainText(UNRELATED_DOCUMENT.title);
});

test('the evidence table sits inside its box, dates included', async ({ page }) => {
  const { dialog, evidence } = await openDispute(page);
  expect(await horizontalOverflow(dialog)).toEqual([]);
  expect(await scrollsSideways(evidence.locator('.table-wrap')), 'the table needs a sideways scroll to be read').toBe(false);

  const box = await evidence.boundingBox();
  const dateCells = evidence.locator('tbody tr td:nth-child(3)');
  for (let i = 0; i < await dateCells.count(); i += 1) {
    const cell = await dateCells.nth(i).boundingBox();
    expect(cell.x + cell.width, `the Uploaded date in row ${i + 1} ends outside the box`).toBeLessThanOrEqual(box.x + box.width + 1);
  }
});

test('a document uploaded here is filed against the dispute and opens again', async ({ page }) => {
  const { evidence } = await openDispute(page);
  const name = `site-inspection-note-${Date.now()}.txt`;

  const saved = page.waitForResponse((r) => r.url().includes('/evidence') && r.request().method() === 'POST');
  await evidence.locator('input[type=file]').setInputFiles({ name, mimeType: 'text/plain', buffer: Buffer.from('inspected on site') });
  expect((await saved).status()).toBe(201);
  const row = evidence.locator('tbody tr').filter({ hasText: name });
  await expect(row).toBeVisible();

  const opened = page.waitForResponse((r) => r.url().includes('/evidence/') && r.request().method() === 'GET');
  const popup = page.waitForEvent('popup');
  await row.getByRole('button', { name: 'View' }).click();
  expect((await opened).status()).toBe(200);
  await (await popup).close();
});
