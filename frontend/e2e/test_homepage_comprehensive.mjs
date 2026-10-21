import { chromium } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';

const BASE_URL = process.env.TEST_URL || 'http://localhost:5173';

async function testHomepage() {
  console.log('================================================================');
  console.log('   SJVN INTEGRATED ENERGY PLATFORM — HOMEPAGE TEST SUITE        ');
  console.log(`   Target URL: ${BASE_URL}                                      `);
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
  const failures = [];

  function assert(condition, name, detail = '') {
    if (condition) {
      console.log(`  ✅ PASS: ${name}${detail ? ` (${detail})` : ''}`);
      passCount++;
    } else {
      console.error(`  ❌ FAIL: ${name}${detail ? ` (${detail})` : ''}`);
      failCount++;
      failures.push({ name, detail });
    }
  }

  // TEST 1: Initial Page Load & Route Alias Testing
  console.log('\n--- 1. ROUTING & INITIAL METADATA ---');
  const res = await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  assert(res.status() === 200, 'GET / responds with HTTP 200 OK');

  const title = await page.title();
  assert(title.includes('SJVN Limited'), 'Document title contains "SJVN Limited"', title);

  const htmlLang = await page.getAttribute('html', 'lang');
  assert(htmlLang === 'en', 'HTML default lang is "en"', htmlLang);

  // Test alias /home
  const resHome = await page.goto(`${BASE_URL}/home`, { waitUntil: 'networkidle' });
  assert(resHome.status() === 200, 'GET /home responds with HTTP 200 OK');
  const heroHome = await page.$('.gigw-hero-panoramic');
  assert(heroHome !== null, '/home renders public homepage panoramic hero');

  // Return to /
  await page.goto(BASE_URL, { waitUntil: 'networkidle' });

  // TEST 2: GIGW Sovereign GovStrip & Accessibility Bar
  console.log('\n--- 2. GOVSTRIP & ACCESSIBILITY BAR CONTROLS ---');
  const skipLink = await page.$('a.gigw-skip');
  assert(skipLink !== null, 'Skip-to-content link exists');
  const skipHref = await skipLink?.getAttribute('href');
  assert(skipHref === '#main-content', 'Skip link targets anchor #main-content');

  const stripText = await page.textContent('.gigw-strip');
  assert(stripText.includes('Government of India') && stripText.includes('Ministry of Power'), 
    'National identity strip proclaims GoI and Ministry of Power');

  // Font resizers: A-, A, A+
  const btnDec = await page.$('.gigw-toolbar button:has-text("A-")');
  const btnReset = await page.$('.gigw-toolbar button:has-text("A"):not(:has-text("A+")):not(:has-text("A-"))');
  const btnInc = await page.$('.gigw-toolbar button:has-text("A+")');
  assert(btnDec !== null && btnReset !== null && btnInc !== null, 'All three text resize buttons exist (A-, A, A+)');

  if (btnInc) {
    await btnInc.click();
    await page.waitForTimeout(100);
    const sizeLg = await page.evaluate(() => document.documentElement.getAttribute('data-text-size'));
    assert(sizeLg === 'lg', 'Enlarge font sets data-text-size="lg"', sizeLg);
  }

  if (btnDec) {
    await btnDec.click();
    await page.waitForTimeout(100);
    const sizeSm = await page.evaluate(() => document.documentElement.getAttribute('data-text-size'));
    assert(sizeSm === 'sm', 'Decrease font sets data-text-size="sm"', sizeSm);
  }

  if (btnReset) {
    await btnReset.click();
    await page.waitForTimeout(100);
    const sizeMd = await page.evaluate(() => document.documentElement.getAttribute('data-text-size'));
    assert(sizeMd === 'md', 'Reset font sets data-text-size="md"', sizeMd);
  }

  // High contrast mode
  const contrastBtn = await page.$('.gigw-toolbar button.gigw-tool-contrast');
  assert(contrastBtn !== null, 'High contrast toggle button exists');
  if (contrastBtn) {
    await contrastBtn.click();
    await page.waitForTimeout(100);
    const isHigh = await page.evaluate(() => document.documentElement.getAttribute('data-contrast') === 'high');
    assert(isHigh, 'Activating contrast mode sets data-contrast="high"');

    await contrastBtn.click();
    await page.waitForTimeout(100);
    const isNormal = await page.evaluate(() => document.documentElement.getAttribute('data-contrast') === 'normal');
    assert(isNormal, 'Deactivating contrast mode reverts to "normal"');
  }

  // Bilingual switch (EN <-> HI)
  const langToggle = await page.$('.gigw-toolbar button:has-text("हिंदी"), .gigw-toolbar button:has-text("English")');
  assert(langToggle !== null, 'Bilingual language switch button exists');
  if (langToggle) {
    // Switch to Hindi
    await langToggle.click();
    await page.waitForTimeout(200);
    const langHi = await page.getAttribute('html', 'lang');
    assert(langHi === 'hi', 'Switching language sets html[lang="hi"]');
    const h1Hi = await page.textContent('h1#panoramic-hero-title');
    assert(h1Hi.includes('एसजेवीएन'), 'Homepage H1 translated to Hindi ("एसजेवीएन")', h1Hi.replace(/\s+/g, ' ').trim());

    // Switch back to English
    const langBackToggle = await page.$('.gigw-toolbar button:has-text("English")');
    if (langBackToggle) {
      await langBackToggle.click();
      await page.waitForTimeout(200);
      const langEn = await page.getAttribute('html', 'lang');
      assert(langEn === 'en', 'Switching back restores html[lang="en"]');
      const h1En = await page.textContent('h1#panoramic-hero-title');
      assert(h1En.includes('SJVN Integrated'), 'Homepage H1 restored to English');
    }
  }

  // TEST 3: Masthead, Theme & Interactive Modals
  console.log('\n--- 3. MASTHEAD, THEME & MODAL INTERACTIONS ---');
  const logo = await page.$('.gigw-masthead-brand img');
  assert(logo !== null, 'Official SJVN logo rendered in masthead');
  const logoSrc = await logo?.getAttribute('src');
  assert(logoSrc === '/sjvn-logo.png', 'Logo src is /sjvn-logo.png');

  // Theme Toggle
  const themeBtn = await page.$('.theme-toggle-btn');
  assert(themeBtn !== null, 'Theme toggle button exists in masthead');
  if (themeBtn) {
    const origTheme = await page.evaluate(() => document.documentElement.getAttribute('data-theme') || 'light');
    await themeBtn.click();
    await page.waitForTimeout(150);
    const nextTheme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    assert(nextTheme !== origTheme, 'Theme toggle alters data-theme', `${origTheme} -> ${nextTheme}`);
    // restore
    await themeBtn.click();
    await page.waitForTimeout(150);
  }

  // Vision Modal (from Masthead)
  const visionBtn = await page.$('.gigw-header-vision-btn');
  assert(visionBtn !== null, 'Masthead [Our Vision] button exists');
  if (visionBtn) {
    await visionBtn.click();
    await page.waitForTimeout(300);
    const modalEl = await page.$('.vision-modal-container');
    assert(modalEl !== null, 'Vision Modal opened on button click');

    const vTitle = await page.textContent('#vision-modal-title');
    assert(vTitle.includes('Vision'), 'Vision Modal shows title', vTitle);

    const targets = await page.$$('.vision-target-pill');
    assert(targets.length === 2, 'Vision Modal shows 2030 (25,000 MW) & 2040 (50,000 MW) milestones');

    // Close via Escape key
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    const closedModal = await page.$('.vision-modal-container');
    assert(closedModal === null, 'Vision Modal closes on Escape');
  }

  // Search Modal (Spotlight)
  const searchBtn = await page.$('.gigw-search-trigger-btn');
  assert(searchBtn !== null, 'Masthead [Search] trigger exists');
  if (searchBtn) {
    await searchBtn.click();
    await page.waitForTimeout(250);
    const searchModal = await page.$('.portal-search-modal');
    assert(searchModal !== null, 'Search spotlight modal opens on click');

    const searchInput = await page.$('.portal-search-input');
    assert(searchInput !== null, 'Search input rendered and autofocused');

    // Test queries
    await searchInput.fill('hydro');
    await page.waitForTimeout(200);
    let items = await page.$$('.portal-search-result-item');
    assert(items.length > 0, 'Search for "hydro" returns instant matching items');

    await searchInput.fill('buxar');
    await page.waitForTimeout(200);
    items = await page.$$('.portal-search-result-item');
    assert(items.length > 0, 'Search for "buxar" returns Thermal station results');

    // Close via Escape
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    const searchClosed = await page.$('.portal-search-modal');
    assert(searchClosed === null, 'Search modal closes cleanly on Escape');
  }

  // TEST 4: Panoramic Dam Hero Section, Ambient Video & Metrics
  console.log('\n--- 4. PANORAMIC DAM HERO, AMBIENT VIDEO & METRICS STRIP ---');
  const heroEl = await page.$('.gigw-hero-panoramic');
  assert(heroEl !== null, 'Panoramic Dam Hero section rendered');

  const heroH1 = await page.textContent('.gigw-panoramic-h1');
  assert(heroH1.includes('SJVN Integrated') && heroH1.includes('REIA'), 'Hero H1 displays Integrated Energy & REIA branding');

  // Video Background and Fallback Tests
  const heroVideo = await page.$('video.gigw-hero-video');
  assert(heroVideo !== null, 'Ambient video background element rendered in hero');
  const videoSrc = await page.$eval('video.gigw-hero-video source', (el) => el.getAttribute('src'));
  assert(videoSrc === '/images/sjvn-hero-panoramic.mp4', 'Hero video source points to /images/sjvn-hero-panoramic.mp4', videoSrc);

  const heroBgFallback = await page.$('.gigw-hero-panoramic-bg');
  assert(heroBgFallback !== null, 'Crisp AVIF/PNG static background fallback element present');

  // Verify clean Hero video background (no clunky motion button obstructing view)
  const videoToggleBtn = await page.$('.gigw-hero-video-toggle');
  assert(videoToggleBtn === null, 'Clunky video motion play/pause toggle button cleanly removed');

  const ctaBtn = await page.$('.btn-access-portal');
  assert(ctaBtn !== null, 'Hero CTA [Access Portal →] exists');
  const ctaHref = await ctaBtn?.getAttribute('href');
  assert(ctaHref === '/login', 'Hero CTA points to /login');

  const heroVisionBtn = await page.$('.btn-our-vision');
  assert(heroVisionBtn !== null, 'Hero [Our Vision] button exists');
  if (heroVisionBtn) {
    await heroVisionBtn.click();
    await page.waitForTimeout(200);
    const modalFromHero = await page.$('.vision-modal-container');
    assert(modalFromHero !== null, 'Hero [Our Vision] button opens Vision Modal');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
  }

  // 4 Docked Metrics
  const metricCards = await page.$$('.metric-strip-item');
  assert(metricCards.length === 4, 'Exactly 4 key national metric items docked in strip');
  const metricTexts = await Promise.all(metricCards.map((m) => m.textContent()));
  assert(metricTexts.some((t) => t.includes('2,400+ MW')), 'Metric: 2,400+ MW RE Capacity');
  assert(metricTexts.some((t) => t.includes('1,912 MW')), 'Metric: 1,912 MW Hydro Assets');
  assert(metricTexts.some((t) => t.includes('3') && t.includes('Exchanges')), 'Metric: 3 Synchronized Exchanges');
  assert(metricTexts.some((t) => t.includes('100% Digital')), 'Metric: 100% Digital PPA/PSA');

  // TEST 5: Operating Desks Gateways & Scroll Reveals
  console.log('\n--- 5. ENTERPRISE ACCESS GATEWAYS (4 CORE DESKS) ---');
  const gatewaySec = await page.$('#gateways-section');
  assert(gatewaySec !== null, 'Gateways section exists with #gateways-section');

  const deskCards = await page.$$('.gigw-desk-card');
  assert(deskCards.length === 4, '4 Operating Desk Cards rendered (REIA, Trading, Hydro, Thermal)');

  // Verify scroll reveal classes
  const deskReveal = await page.$$('.gigw-desk-card.reveal-fade-up');
  assert(deskReveal.length === 4, 'All 4 Operating Desk cards have reveal-fade-up micro-interaction class');

  const expectedDesks = [
    { title: 'REIA Portal', loginQuery: '/login?desk=REIA' },
    { title: 'Power Trading Hub', loginQuery: '/login?desk=TRADING' },
    { title: 'Hydro Commercial Desk', loginQuery: '/login?desk=HYDRO' },
    { title: 'Thermal Operations Desk', loginQuery: '/login?desk=THERMAL' },
  ];

  for (const exp of expectedDesks) {
    const card = await page.$(`.gigw-desk-card:has-text("${exp.title}")`);
    assert(card !== null, `Card for "${exp.title}" present`);
    if (card) {
      const link = await card.$eval('.gigw-desk-primary-btn', (el) => el.getAttribute('href'));
      assert(link === exp.loginQuery, `Card link points to ${exp.loginQuery}`, link);
    }
  }

  // TEST 6: Interactive GIS Asset Map & National Generation Assets
  console.log('\n--- 6. INTERACTIVE GIS ASSET MAP & GENERATION FOOTPRINT ---');
  const mapContainer = await page.$('.india-asset-map-container');
  assert(mapContainer !== null, 'Interactive India GIS Asset Map container rendered');

  const svgMap = await page.$('svg.india-svg-map');
  assert(svgMap !== null, 'SVG vector India landmass map rendered');

  // Filter Buttons
  const filterBtns = await page.$$('.map-filter-btn');
  assert(filterBtns.length === 5, '5 Sector Filter buttons rendered (All, Hydro, Thermal, Solar, Wind/REIA)');

  // Default Pin Count (14 Sites)
  let pins = await page.$$('.map-pin-group');
  assert(pins.length === 14, '14 SJVN Generation Project Pins plotted on GIS Map');

  // Test Filter Switching
  const hydroFilterBtn = await page.$('.map-filter-btn.hydro');
  if (hydroFilterBtn) {
    await hydroFilterBtn.click();
    await page.waitForTimeout(150);
    pins = await page.$$('.map-pin-group');
    assert(pins.length === 6, 'Hydro filter activates: 6 Hydro power stations displayed', `${pins.length} pins`);
    const capacityText = await page.textContent('.counter-value');
    assert(capacityText.includes('2,630'), 'Visible capacity updates for Hydro', capacityText);
  }

  const thermalFilterBtn = await page.$('.map-filter-btn.thermal');
  if (thermalFilterBtn) {
    await thermalFilterBtn.click();
    await page.waitForTimeout(150);
    pins = await page.$$('.map-pin-group');
    assert(pins.length === 1, 'Thermal filter activates: Buxar Thermal Power Plant displayed');
    const capacityText = await page.textContent('.counter-value');
    assert(capacityText.includes('1,320'), 'Visible capacity displays 1,320 MW for Thermal');
  }

  // Reset to All Assets
  const allFilterBtn = await page.$('.map-filter-btn:has-text("All"), .map-filter-btn:has-text("सभी")');
  if (allFilterBtn) {
    await allFilterBtn.click();
    await page.waitForTimeout(150);
  }

  // Test Pin Click & Inspection Drawer
  const buxarPin = await page.$('.map-pin-group[aria-label*="Buxar"]');
  assert(buxarPin !== null, 'Buxar Thermal Power pin exists on map');
  if (buxarPin) {
    await buxarPin.dispatchEvent('click');
    await page.waitForTimeout(150);
    const detailTitle = await page.textContent('.detail-asset-title');
    assert(detailTitle.includes('Buxar'), 'Clicking pin updates Inspection Card to Buxar', detailTitle);
    const detailGrid = await page.textContent('.spec-row:has-text("Grid") .spec-val, .spec-row:has-text("ग्रिड") .spec-val');
    assert(detailGrid.includes('ERPC') || detailGrid.includes('Eastern'), 'Detail card shows Eastern Regional Grid (ERPC)', detailGrid);
  }

  // Test Portfolio View Switcher
  const viewToggle = await page.$('.assets-view-toggle');
  assert(viewToggle !== null, 'Asset view switcher toggle present');
  const cardsToggleBtn = await page.$('.view-toggle-btn:has-text("Flagship Cards"), .view-toggle-btn:has-text("फ्लैगशिप कार्ड्स")');
  if (cardsToggleBtn) {
    await cardsToggleBtn.click();
    await page.waitForTimeout(150);
    const mapHidden = await page.$('.india-asset-map-container');
    assert(mapHidden === null, 'Switching to Flagship Cards view hides the GIS map');

    // Switch back to GIS Map
    const mapToggleBtn = await page.$('.view-toggle-btn:has-text("GIS"), .view-toggle-btn:has-text("मानचित्र")');
    if (mapToggleBtn) {
      await mapToggleBtn.click();
      await page.waitForTimeout(150);
      const mapRestored = await page.$('.india-asset-map-container');
      assert(mapRestored !== null, 'Switching back to GIS Asset Map restores the map');
    }
  }

  // Verify the 4 Flagship Generation Asset cards remain present
  const assetCards = await page.$$('.gigw-asset-card');
  assert(assetCards.length === 4, '4 Flagship Generation Asset cards rendered');

  const assetNames = await Promise.all(assetCards.map((c) => c.$eval('.gigw-asset-name', (el) => el.textContent.trim())));
  assert(assetNames.some((n) => n.includes('Nathpa Jhakri HPS')), 'Asset: Nathpa Jhakri HPS (1,500 MW)');
  assert(assetNames.some((n) => n.includes('Rampur Hydro Station')), 'Asset: Rampur Hydro Station (412 MW)');
  assert(assetNames.some((n) => n.includes('Buxar Thermal Power')), 'Asset: Buxar Thermal Power (1,320 MW)');
  assert(assetNames.some((n) => n.includes('REIA National Portfolio')), 'Asset: REIA National Portfolio (2,400+ MW)');

  // TEST 7: Bulletin Bar & Compliance Pillars
  console.log('\n--- 7. REGULATORY BULLETIN & COMPLIANCE PILLARS ---');
  const bulletin = await page.$('.gigw-public-bulletin-bar');
  assert(bulletin !== null, 'Public bulletin disclosure bar is visible');
  const circularLink = await page.$('.bulletin-link');
  const circHref = await circularLink?.getAttribute('href');
  assert(circHref === '/disclaimer', 'Bulletin link targets /disclaimer');

  const pillars = await page.$$('.gigw-compliance-pillars .pillar-item');
  assert(pillars.length === 4, '4 Statutory Trust Pillars displayed (GIGW, DPDP, CERC, WCAG)');

  // TEST 8: GIGW 3.0 Statutory Footer
  console.log('\n--- 8. STATUTORY GIGW 3.0 SOVEREIGN FOOTER ---');
  const footer = await page.$('.gigw-footer');
  assert(footer !== null, 'Official GIGW 3.0 footer rendered');

  const requiredLinks = [
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

  const actualLinks = await page.$$eval('.gigw-footer a', (links) => links.map((l) => l.getAttribute('href')));
  for (const req of requiredLinks) {
    assert(actualLinks.includes(req), `Footer links to statutory page: ${req}`);
  }

  // WIM Information
  const addressText = await page.textContent('address.gigw-address');
  assert(addressText.includes('Rajesh Patre') && addressText.includes('Chief General Manager'), 
    'Footer names WIM: Shri Rajesh Patre, CGM IT&C');
  assert(addressText.includes('wim.it@sjvn.in'), 'Footer displays WIM email: wim.it@sjvn.in');
  assert(addressText.includes('+91-177-2660003'), 'Footer displays HQ PBX telephone: +91-177-2660003');
  assert(addressText.includes('Shakti Sadan') && addressText.includes('Shimla - 171006'), 'Footer displays HQ corporate address');

  // External GoI Portals
  const extLinks = await page.$$eval('.gigw-footer a[target="_blank"]', (els) => els.map((a) => a.href));
  assert(extLinks.some((u) => u.includes('india.gov.in')), 'External link to india.gov.in present');
  assert(extLinks.some((u) => u.includes('powermin.gov.in')), 'External link to powermin.gov.in present');
  assert(extLinks.some((u) => u.includes('pgportal.gov.in')), 'External link to CPGRAMS pgportal.gov.in present');

  // TEST 9: Axe-Core WCAG 2.1 AA Accessibility Audit
  console.log('\n--- 9. AUTOMATED WCAG 2.1 AA AUDIT (AXE-CORE) ---');
  const axeResults = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .exclude('canvas')
    .analyze();

  const seriousViolations = axeResults.violations.filter((v) => ['serious', 'critical'].includes(v.impact));
  assert(seriousViolations.length === 0, 'Zero critical or serious WCAG 2.1 AA violations on homepage', 
    seriousViolations.map((v) => `${v.id}(${v.impact}): ${v.help}`).join('; '));

  // TEST 10: Multi-Device Responsive Layout Testing (No Horizontal Overflow)
  console.log('\n--- 10. MULTI-DEVICE RESPONSIVENESS & OVERFLOW CHECKS ---');
  const viewports = [
    { name: 'Mobile SE (375x667)', width: 375, height: 667 },
    { name: 'Mobile iPhone 14 (390x844)', width: 390, height: 844 },
    { name: 'Tablet Portrait (768x1024)', width: 768, height: 1024 },
    { name: 'Tablet Landscape (1024x768)', width: 1024, height: 768 },
    { name: 'Laptop (1280x800)', width: 1280, height: 800 },
    { name: 'Desktop (1440x900)', width: 1440, height: 900 },
    { name: 'Full HD 1080p (1920x1080)', width: 1920, height: 1080 },
    { name: 'QHD 2K (2560x1440)', width: 2560, height: 1440 },
  ];

  for (const vp of viewports) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.waitForTimeout(150);
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    assert(scrollWidth <= clientWidth, `${vp.name}: No horizontal overflow (${scrollWidth} <= ${clientWidth})`);
  }

  // TEST 11: Network & Console Integrity
  console.log('\n--- 11. CONSOLE & NETWORK INTEGRITY ---');
  assert(consoleErrors.length === 0, 'Zero browser console errors logged', consoleErrors.join('; '));
  assert(pageErrors.length === 0, 'Zero uncaught page errors or crashes', pageErrors.join('; '));
  assert(networkFailures.length === 0, 'Zero 4xx/5xx HTTP network request errors', networkFailures.join('; '));

  await browser.close();

  console.log('\n================================================================');
  console.log(`   HOMEPAGE TEST SUMMARY: ${passCount} PASSED  |  ${failCount} FAILED`);
  console.log('================================================================\n');

  if (failCount > 0) {
    process.exit(1);
  }
}

testHomepage().catch((err) => {
  console.error('Fatal Homepage Test Error:', err);
  process.exit(1);
});
