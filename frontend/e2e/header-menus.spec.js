import { test, expect } from '@playwright/test';
import { LOGIN_USER } from './fixtures.js';

// The bell and the account menu stayed open until their own button was clicked
// again, and both could be open at once, one over the other.

test.beforeEach(async ({ page }) => {
  await page.goto('/reia');
  await page.waitForLoadState('networkidle');
});

const bell = (page) => page.getByRole('button', { name: 'Notifications' });
const account = (page) => page.locator('.user-chip');
const inbox = (page) => page.locator('.notif-dropdown', { hasText: 'Inbox & System Alerts' });
const accountMenu = (page) => page.locator('.notif-dropdown', { hasText: 'My Account' });

test('the notifications panel closes on a click elsewhere', async ({ page }) => {
  await bell(page).click();
  await expect(inbox(page)).toBeVisible();
  await page.locator('main.content').click({ position: { x: 20, y: 300 } });
  await expect(inbox(page)).toBeHidden();
});

test('the account menu closes on a click elsewhere, and on Escape', async ({ page }) => {
  await account(page).click();
  await expect(accountMenu(page)).toBeVisible();
  await page.locator('.topbar-title').click();
  await expect(accountMenu(page)).toBeHidden();

  await account(page).click();
  await expect(accountMenu(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(accountMenu(page)).toBeHidden();
});

test('opening one menu closes the other', async ({ page }) => {
  await bell(page).click();
  await expect(inbox(page)).toBeVisible();
  await account(page).click();
  await expect(accountMenu(page)).toBeVisible();
  await expect(inbox(page)).toBeHidden();
});

test('an item in the account menu still works, and the menu closes behind it', async ({ page }) => {
  await account(page).click();
  await accountMenu(page).getByText('My Account').click();
  await expect(page).toHaveURL(/\/settings\/user-profile/);
  await expect(accountMenu(page)).toBeHidden();
});

// "Manage Portfolio" sent every role to the trading desk's client list, which a
// REIA user, a seller or a buyer is not allowed to open — they landed on
// "Access restricted". It is offered only where it leads somewhere now.
test('Manage Portfolio opens a screen the admin can use', async ({ page }) => {
  await account(page).click();
  await accountMenu(page).getByText('Manage Portfolio').click();
  await expect(page).toHaveURL(/\/trading\/clients/);
  await expect(page.getByText('Access restricted')).toHaveCount(0);
});

test.describe('as a REIA user', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('is not offered Manage Portfolio, which it could not open', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill(LOGIN_USER.email);
    await page.getByLabel('Password').fill(LOGIN_USER.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.locator('.user-chip')).toBeVisible();
    await account(page).click();
    await expect(accountMenu(page)).toBeVisible();
    await expect(accountMenu(page).getByText('Manage Portfolio')).toHaveCount(0);
  });
});
