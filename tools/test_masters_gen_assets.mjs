import pkg from '../frontend/node_modules/@playwright/test/index.js';
const { chromium } = pkg;
import fs from 'fs';
import path from 'path';

const ARTIFACT_DIR = '/Users/kshitijsharma/.gemini/antigravity/brain/0667821d-0c0e-48ab-841e-5af992886366';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  console.log('1. Logging in as SJVN Admin...');
  await page.goto('http://localhost:5173/login', { waitUntil: 'networkidle' });
  await page.fill('input[type="email"], input[name="email"]', 'admin@sjvn.in');
  await page.fill('input[type="password"]', 'password123');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(1500);

  console.log('2. Navigating to Masters Hub (/masters)...');
  await page.goto('http://localhost:5173/masters?tab=generation_assets', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  // Take screenshot of the Masters Hub Generation Assets Tab
  const tabShotPath = path.join(ARTIFACT_DIR, 'masters_generation_assets_hub.png');
  await page.screenshot({ path: tabShotPath, fullPage: false });
  console.log('Saved screenshot of Masters Hub generation assets to:', tabShotPath);

  console.log('3. Opening Add Power Station Modal...');
  const addBtn = page.locator('button:has-text("+ Add SJVN Power Station / Asset")');
  await addBtn.click();
  await page.waitForTimeout(600);

  const modalShotPath = path.join(ARTIFACT_DIR, 'masters_add_plant_modal.png');
  await page.screenshot({ path: modalShotPath, fullPage: false });
  console.log('Saved screenshot of Add Plant Modal to:', modalShotPath);

  console.log('4. Checking GIS Asset Map for Super Admin shortcut button on /home...');
  await page.goto('http://localhost:5173/home', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  const cookieBtn = page.locator('button:has-text("Accept all"), button:has-text("Essential only")');
  if (await cookieBtn.count() > 0) {
    await cookieBtn.first().click();
    await page.waitForTimeout(400);
  }

  const mapShotPath = path.join(ARTIFACT_DIR, 'gis_map_super_admin_manage_btn.png');
  const toolbar = page.locator('.map-toolbar');
  if (await toolbar.count() > 0) {
    await toolbar.scrollIntoViewIfNeeded();
    await page.waitForTimeout(800);
    await page.screenshot({ path: mapShotPath, fullPage: false });
    console.log('Saved screenshot of GIS map toolbar with Super Admin shortcut to:', mapShotPath);
  } else {
    console.log('Toolbar element not found on /home');
  }

  await browser.close();
  console.log('All tests completed successfully!');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
