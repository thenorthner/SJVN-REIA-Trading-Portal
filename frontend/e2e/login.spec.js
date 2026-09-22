import { test, expect } from '@playwright/test';
import { LOGIN_USER } from './fixtures.js';

// Every other spec starts already signed in; this one goes through the form.
test.use({ storageState: { cookies: [], origins: [] } });

test('signs in through the login form and lands in the app', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill(LOGIN_USER.email);
  await page.getByLabel('Password').fill(LOGIN_USER.password);
  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(page.locator('.user-chip')).toContainText(`Welcome, ${LOGIN_USER.name}`);
  await expect(page).not.toHaveURL(/\/login/);
});

test('refuses a wrong password and stays on the login page', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill(LOGIN_USER.email);
  await page.getByLabel('Password').fill('not-the-password');
  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(page.getByText(/invalid credentials/i)).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
});
