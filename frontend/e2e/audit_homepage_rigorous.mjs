import { chromium } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';

const BASE_URL = 'http://localhost:5173';

async function runHomepageAudit() {
  console.log('================================================================');
  console.log('   SJVN INTEGRATED ENERGY PLATFORM — HOMEPAGE RIGOROUS AUDIT   ');
  console.log('================================================================\n');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  });

  const page = await context.newPage();

  const consoleErrors = [];
  const pageErrors = [];
  const networkFailures = [];

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });

  page.on('pageerror', (err) => {
    pageErrors.push(err.message);
  });

  page.on('response', (res) => {
    if (res.status() >= 400 && !res.url().includes('favicon.ico')) {
      networkFailures.push(`${res.status()} ${res.url()}`);
    }
  });

  let passCount = 0;
  let failCount = 0;

  function assert(condition, name, detail = '') {
    if (condition) {
      console.log(`  ✅ PASS: ${name}${detail ? ` (${detail})` : ''}`);
      passCount++;
    } else {
      console.error(`  ❌ FAIL: ${name}${detail ? ` (${detail})` : ''}`);
      failCount++;
    }
  }

  // 1. Initial Page Load
  console.log('\n--- 1. INITIAL PAGE LOAD & METADATA ---');
  const response = await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  assert(response.status() === 200, 'Homepage responds with HTTP 200 OK');

  const title = await page.title();
  assert(title.includes('SJVN Limited'), 'Page title contains "SJVN Limited"', title);

  const langAttr = await page.getAttribute('html', 'lang');
  assert(langAttr === 'en', 'HTML tag default lang is "en"', langAttr);

  // 2. GovStrip & Accessibility Controls
  console.log('\n--- 2. TOP GOVSTRIP & ACCESSIBILITY BAR ---');
  const skipLink = await page.$('a.gigw-skip');
  assert(skipLink !== null, 'Skip link exists');
  const skipHref = await skipLink?.getAttribute('href');
  assert(skipHref === '#main-content', 'Skip link targets #main-content');

  const govText = await page.textContent('.gigw-strip');
  assert(govText.includes('Government of India') && govText.includes('Ministry of Power'), 
    'National identity strip contains GoI & Ministry of Power text');

  // Text resizing test
  const btnLarge = await page.$('.gigw-toolbar button:has-text("A+")');
  assert(btnLarge !== null, 'Font enlargement button A+ exists');
  if (btnLarge) {
    await btnLarge.click();
    await page.waitForTimeout(100);
    const size = await page.evaluate(() => document.documentElement.getAttribute('data-text-size'));
    assert(size === 'lg', 'Font size updates to data-text-size="lg" on A+ click', size);
    
    const btnReset = await page.$('.gigw-toolbar button:has-text("A"):not(:has-text("A+")):not(:has-text("A-"))');
    if (btnReset) {
      await btnReset.click();
      await page.waitForTimeout(100);
      const sizeReset = await page.evaluate(() => document.documentElement.getAttribute('data-text-size'));
      assert(sizeReset === 'md', 'Font size resets to data-text-size="md" on A click', sizeReset);
    }
  }

  // High contrast test
  const contrastBtn = await page.$('.gigw-toolbar button.gigw-tool-contrast');
  assert(contrastBtn !== null, 'High contrast toggle button exists');
  if (contrastBtn) {
    await contrastBtn.click();
    await page.waitForTimeout(100);
    const isHigh = await page.evaluate(() => document.documentElement.getAttribute('data-contrast') === 'high');
    assert(isHigh, 'High contrast mode activates data-contrast="high"');
    await contrastBtn.click();
    await page.waitForTimeout(100);
    const contrastVal = await page.evaluate(() => document.documentElement.getAttribute('data-contrast'));
    assert(contrastVal === 'normal', 'High contrast mode deactivates to "normal" on second click', contrastVal);
  }

  // Language switch test
  const langToggle = await page.$('.gigw-toolbar button:has-text("हिंदी"), .gigw-toolbar button:has-text("English")');
  assert(langToggle !== null, 'Language toggle button exists');
  if (langToggle) {
    await langToggle.click();
    await page.waitForTimeout(200);
    const currentLang = await page.getAttribute('html', 'lang');
    assert(currentLang === 'hi', 'Switching to Hindi updates html[lang="hi"]');
    const heroH1Hi = await page.textContent('h1#panoramic-hero-title');
    assert(heroH1Hi.includes('एसजेवीएन'), 'H1 text updates to Hindi ("एसजेवीएन")', heroH1Hi.replace(/\s+/g, ' ').trim());

    // Switch back to English
    const langBackToggle = await page.$('.gigw-toolbar button:has-text("English")');
    if (langBackToggle) {
      await langBackToggle.click();
      await page.waitForTimeout(200);
      const backToEn = await page.getAttribute('html', 'lang');
      assert(backToEn === 'en', 'Switching back updates html[lang="en"]');
    }
  }

  // 3. Masthead & Header Buttons
  console.log('\n--- 3. MASTHEAD, SEARCH & MODALS ---');
  const logo = await page.$('.gigw-masthead-brand img');
  assert(logo !== null, 'SJVN Official Logo rendered in masthead');
  const logoSrc = await logo?.getAttribute('src');
  assert(logoSrc === '/sjvn-logo.png', 'Logo source points to /sjvn-logo.png');

  // Test Vision Modal
  const visionBtn = await page.$('.gigw-header-vision-btn');
  assert(visionBtn !== null, 'Header [Our Vision] button exists');
  if (visionBtn) {
    await visionBtn.click();
    await page.waitForTimeout(300);
    const visionModal = await page.$('.vision-modal-container');
    assert(visionModal !== null, 'Vision modal opens upon clicking header button');
    
    const visionTitle = await page.textContent('#vision-modal-title');
    assert(visionTitle.includes('Vision'), 'Vision modal displays official title', visionTitle);

    const visionTargets = await page.$$('.vision-target-pill');
    assert(visionTargets.length === 2, 'Vision modal displays both 2030 (25k MW) and 2040 (50k MW) targets');

    // Close modal via Escape
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    const modalClosed = await page.$('.vision-modal-container');
    assert(modalClosed === null, 'Vision modal closes cleanly upon pressing Escape');
  }

  // Test Search Modal
  const searchBtn = await page.$('.gigw-search-trigger-btn');
  assert(searchBtn !== null, 'Header [Search] button exists');
  if (searchBtn) {
    await searchBtn.click();
    await page.waitForTimeout(300);
    const searchModal = await page.$('.portal-search-modal');
    assert(searchModal !== null, 'Search spotlight modal opens upon clicking Search button');

    // Test live search query
    const searchInput = await page.$('.portal-search-input');
    assert(searchInput !== null, 'Search input field is rendered');
    
    await searchInput.fill('hydro');
    await page.waitForTimeout(200);
    let results = await page.$$('.portal-search-result-item');
    assert(results.length > 0, 'Searching "hydro" returns results');
    const firstResultText = await results[0]?.textContent();
    assert(firstResultText.includes('Hydro'), 'First result matches Hydro Desk', firstResultText.slice(0, 50));

    await searchInput.fill('privacy');
    await page.waitForTimeout(200);
    results = await page.$$('.portal-search-result-item');
    const privText = await results[0]?.textContent();
    assert(privText.includes('Privacy Policy'), 'Searching "privacy" matches Privacy Policy', privText.slice(0, 50));

    // Keyboard navigation
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(100);
    const selectedItem = await page.$('.portal-search-result-item.selected');
    assert(selectedItem !== null, 'ArrowDown activates selection in search results');

    // Close via Escape
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    const searchClosed = await page.$('.portal-search-modal');
    assert(searchClosed === null, 'Search modal closes cleanly on Escape');
  }

  // Test Cmd+K / Ctrl+K shortcut
  await page.keyboard.press('Meta+k');
  await page.waitForTimeout(200);
  let shortcutOpened = await page.$('.portal-search-modal');
  if (!shortcutOpened) {
    await page.keyboard.press('Control+k');
    await page.waitForTimeout(200);
    shortcutOpened = await page.$('.portal-search-modal');
  }
  assert(shortcutOpened !== null, 'Global Cmd+K / Ctrl+K shortcut opens search modal');
  if (shortcutOpened) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
  }

  // Test Theme Toggle
  const themeBtn = await page.$('.theme-toggle-btn');
  assert(themeBtn !== null, 'Theme toggle button exists');
  if (themeBtn) {
    const initialTheme = await page.evaluate(() => document.documentElement.getAttribute('data-theme') || 'light');
    await themeBtn.click();
    await page.waitForTimeout(150);
    const toggledTheme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    assert(toggledTheme !== initialTheme, 'Theme toggle changes data-theme successfully', `${initialTheme} -> ${toggledTheme}`);
  }

  // 4. Hero Section & Metrics
  console.log('\n--- 4. PANORAMIC HERO SECTION & METRICS STRIP ---');
  const heroSection = await page.$('.gigw-hero-panoramic');
  assert(heroSection !== null, 'Panoramic hero section rendered');

  const heroBg = await page.$('.gigw-hero-panoramic-bg');
  assert(heroBg !== null, 'Hero panoramic background element present');

  const heroH1 = await page.textContent('.gigw-panoramic-h1');
  assert(heroH1.includes('SJVN Integrated') && heroH1.includes('REIA'), 'H1 title contains expected portal name');

  const ctaBtn = await page.$('.btn-access-portal');
  assert(ctaBtn !== null, 'Hero CTA [Access Portal →] exists');
  const ctaHref = await ctaBtn?.getAttribute('href');
  assert(ctaHref === '/login', 'Hero CTA points to /login');

  const heroVisionBtn = await page.$('.btn-our-vision');
  assert(heroVisionBtn !== null, 'Hero [Our Vision] button exists');

  // Verify the 4 Docked Metrics
  const metricItems = await page.$$('.metric-strip-item');
  assert(metricItems.length === 4, 'Exactly 4 key national metric items docked in strip');
  const metricValues = await Promise.all(metricItems.map((m) => m.$eval('.metric-value', (el) => el.textContent.trim())));
  assert(metricValues.includes('2,400+ MW'), 'Metric contains 2,400+ MW');
  assert(metricValues.includes('1,912 MW'), 'Metric contains 1,912 MW');
  assert(metricValues.includes('3'), 'Metric contains 3 Exchanges');
  assert(metricValues.includes('100% Digital'), 'Metric contains 100% Digital Execution');

  // 5. Enterprise Access Gateways
  console.log('\n--- 5. ENTERPRISE ACCESS GATEWAYS (4 CORE DESKS) ---');
  const gatewaysSec = await page.$('#gateways-section');
  assert(gatewaysSec !== null, 'Enterprise Access Gateways section exists with id="gateways-section"');

  const deskCards = await page.$$('.gigw-desk-card');
  assert(deskCards.length === 4, 'Exactly 4 official desk cards rendered in row');

  const deskTitles = await Promise.all(deskCards.map((c) => c.$eval('.gigw-desk-title', (el) => el.textContent.trim())));
  assert(deskTitles.includes('REIA Portal'), 'Contains REIA Portal desk card');
  assert(deskTitles.includes('Power Trading Hub'), 'Contains Power Trading Hub desk card');
  assert(deskTitles.includes('Hydro Commercial Desk'), 'Contains Hydro Commercial Desk card');
  assert(deskTitles.includes('Thermal Operations Desk'), 'Contains Thermal Operations Desk card');

  const deskLinks = await Promise.all(deskCards.map((c) => c.$eval('.gigw-desk-primary-btn', (el) => el.getAttribute('href'))));
  assert(deskLinks.includes('/login?desk=REIA'), 'REIA desk card has direct login link (/login?desk=REIA)');
  assert(deskLinks.includes('/login?desk=TRADING'), 'Trading desk card has direct login link (/login?desk=TRADING)');
  assert(deskLinks.includes('/login?desk=HYDRO'), 'Hydro desk card has direct login link (/login?desk=HYDRO)');
  assert(deskLinks.includes('/login?desk=THERMAL'), 'Thermal desk card has direct login link (/login?desk=THERMAL)');

  // 6. National Assets & Generation Footprint
  console.log('\n--- 6. NATIONAL GENERATION ASSETS & CAPACITY ---');
  const assetCards = await page.$$('.gigw-asset-card');
  assert(assetCards.length === 4, 'Exactly 4 flagship generation asset cards rendered');

  const assetNames = await Promise.all(assetCards.map((c) => c.$eval('.gigw-asset-name', (el) => el.textContent.trim())));
  assert(assetNames.some((n) => n.includes('Nathpa Jhakri')), 'Contains Nathpa Jhakri HPS card');
  assert(assetNames.some((n) => n.includes('Rampur')), 'Contains Rampur HPS card');
  assert(assetNames.some((n) => n.includes('Buxar')), 'Contains Buxar Thermal Power Plant card');
  assert(assetNames.some((n) => n.includes('REIA National Portfolio')), 'Contains REIA Portfolio card');

  // 7. Transparency Bar & Compliance Pillars
  console.log('\n--- 7. REGULATORY BULLETIN & COMPLIANCE PILLARS ---');
  const bulletin = await page.$('.gigw-public-bulletin-bar');
  assert(bulletin !== null, 'Public bulletin disclosure bar rendered');
  const circularsLink = await page.$('.bulletin-link');
  const circularsHref = await circularsLink?.getAttribute('href');
  assert(circularsHref === '/disclaimer', 'Bulletin link targets /disclaimer', circularsHref);

  const pillars = await page.$$('.gigw-compliance-pillars .pillar-item');
  assert(pillars.length === 4, 'Exactly 4 compliance pillars rendered (GIGW, DPDP, CERC, WCAG)');

  // 8. Statutory GIGW 3.0 Footer
  console.log('\n--- 8. STATUTORY GIGW 3.0 SOVEREIGN FOOTER ---');
  const footer = await page.$('.gigw-footer');
  assert(footer !== null, 'Official GIGW 3.0 footer rendered');

  const requiredFooterLinks = [
    '/privacy-policy',
    '/terms-of-use',
    '/disclaimer',
    '/hyperlinking-policy',
    '/copyright-policy',
    '/cookie-policy',
    '/security-policy',
    '/contact-us',
    '/grievance-redressal',
    '/accessibility-statement',
    '/screen-reader-access',
    '/help',
    '/sitemap',
  ];

  const footerHrefs = await page.$$eval('.gigw-footer a', (links) => links.map((l) => l.getAttribute('href')));
  for (const req of requiredFooterLinks) {
    assert(footerHrefs.includes(req), `Footer links to statutory route ${req}`);
  }

  // WIM Card verification
  const wimText = await page.textContent('address.gigw-address');
  assert(wimText.includes('Rajesh Patre') && wimText.includes('Chief General Manager'), 
    'Footer displays official Web Information Manager: Shri Rajesh Patre, CGM IT&C');
  assert(wimText.includes('Shakti Sadan') && wimText.includes('Shimla - 171006'), 
    'Footer displays official SJVN Corporate HQ address: Shakti Sadan, Shanan, Shimla');
  assert(wimText.includes('wim.it@sjvn.in') && wimText.includes('+91-177-2660003'), 
    'Footer displays verified WIM email & HQ PBX');

  // GoI External Links
  const goiLinks = await page.$$eval('.gigw-footer a[target="_blank"]', (links) => links.map((l) => l.href));
  assert(goiLinks.some((l) => l.includes('india.gov.in')), 'Footer contains link to india.gov.in');
  assert(goiLinks.some((l) => l.includes('powermin.gov.in')), 'Footer contains link to powermin.gov.in');
  assert(goiLinks.some((l) => l.includes('pgportal.gov.in')), 'Footer contains link to pgportal.gov.in');

  // 9. Axe-core WCAG 2.1 AA Audit
  console.log('\n--- 9. AXE-CORE WCAG 2.1 AA ACCESSIBILITY AUDIT ---');
  const axeResults = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .exclude('canvas')
    .analyze();

  const seriousViolations = axeResults.violations.filter((v) => ['serious', 'critical'].includes(v.impact));
  assert(seriousViolations.length === 0, 'Zero serious or critical WCAG 2.1 AA violations', 
    seriousViolations.map((v) => `${v.id}(${v.impact}): ${v.help}`).join('; '));

  // 10. Console Errors & Network Failures
  console.log('\n--- 10. CONSOLE & NETWORK INTEGRITY ---');
  assert(consoleErrors.length === 0, 'Zero runtime browser console errors', consoleErrors.join('; '));
  assert(pageErrors.length === 0, 'Zero uncaught page errors / crashes', pageErrors.join('; '));
  assert(networkFailures.length === 0, 'Zero HTTP 4xx/5xx network failures', networkFailures.join('; '));

  // 11. Multi-Viewport Layout Testing
  console.log('\n--- 11. MULTI-DEVICE RESPONSIVENESS ---');
  const viewports = [
    { name: 'Mobile (iPhone 390x844)', width: 390, height: 844 },
    { name: 'Tablet (iPad 768x1024)', width: 768, height: 1024 },
    { name: 'Desktop (MacBook 1440x900)', width: 1440, height: 900 },
    { name: 'Wide 4K (1920x1080)', width: 1920, height: 1080 },
  ];

  for (const vp of viewports) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.waitForTimeout(150);
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    assert(scrollWidth <= clientWidth, `${vp.name}: No horizontal overflow / horizontal scrollbar (scrollWidth: ${scrollWidth} <= clientWidth: ${clientWidth})`);
  }

  await browser.close();

  console.log('\n================================================================');
  console.log(`   AUDIT RESULTS:  ${passCount} PASSED  |  ${failCount} FAILED   `);
  console.log('================================================================\n');

  if (failCount > 0) {
    process.exit(1);
  }
}

runHomepageAudit().catch((err) => {
  console.error('Fatal audit failure:', err);
  process.exit(1);
});
