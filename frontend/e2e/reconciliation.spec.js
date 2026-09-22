import { test, expect } from '@playwright/test';
import { runtime, horizontalOverflow, scrollsSideways } from './support.js';

// The reconciliation statement's Notes column was cut off at a few letters —
// "No en", "Payat", "Demo" — because every cell stayed on one line inside a box
// that clipped whatever did not fit.

async function openReconciliation(page) {
  const { reconNo } = runtime();
  await page.goto('/reia/reconciliation');
  await page.locator('tbody tr', { hasText: reconNo }).click();
  const dialog = page.getByRole('dialog', { name: new RegExp(reconNo.replace(/\//g, '\\/')) });
  await expect(dialog).toBeVisible();
  return dialog;
}

test('every note in the statement can be read in full', async ({ page, request }) => {
  const { reconId, token } = runtime();
  const detail = await (await request.get(`/api/reconciliation/${reconId}`, { headers: { Authorization: `Bearer ${token}` } })).json();
  const notes = (detail.statement?.items || []).map((i) => i.notes).filter(Boolean);
  expect(notes.length, 'the seeded reconciliation has notes to show').toBeGreaterThan(3);

  const dialog = await openReconciliation(page);
  const statement = dialog.locator('.statement-viewer');
  await statement.scrollIntoViewIfNeeded();
  const wrap = statement.locator('table').locator('..');
  expect(await scrollsSideways(wrap), 'the statement needs a sideways scroll to read').toBe(false);

  const box = await wrap.boundingBox();
  for (const note of notes) {
    const cell = statement.locator('td', { hasText: note }).first();
    await expect(cell).toHaveText(note);
    const b = await cell.boundingBox();
    expect(b.x + b.width, `"${note}" runs past the statement's edge`).toBeLessThanOrEqual(box.x + box.width + 1);
  }
});

test('nothing in the reconciliation detail runs out of its box', async ({ page }) => {
  const dialog = await openReconciliation(page);
  await expect(dialog.locator('.statement-viewer')).toBeVisible();
  expect(await horizontalOverflow(dialog)).toEqual([]);
});
