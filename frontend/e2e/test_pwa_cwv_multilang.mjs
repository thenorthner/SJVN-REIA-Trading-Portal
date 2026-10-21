import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import assert from 'node:assert';

const BASE_URL = process.env.TEST_URL || 'http://localhost:5173';

console.log('================================================================');
console.log('   SJVN PWA, CORE WEB VITALS & MULTI-REGIONAL LANGUAGES SUITE  ');
console.log(`   Target URL: ${BASE_URL}                                      `);
console.log('================================================================\n');

let passCount = 0;
let failCount = 0;

function reportPass(desc) {
  passCount++;
  console.log(`  ✅ PASS: ${desc}`);
}

function reportFail(desc, err) {
  failCount++;
  console.error(`  ❌ FAIL: ${desc}`);
  if (err) console.error('     Error:', err?.message || err);
}

async function runSuite() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  // SECTION 1: Web App Manifest & PWA Metadata
  console.log('--- 1. PWA MANIFEST & METADATA ---');
  try {
    const manifestRes = await page.goto(`${BASE_URL}/manifest.json`);
    assert(manifestRes.status() === 200, 'Manifest HTTP 200');
    const manifest = await manifestRes.json();
    assert(manifest.name.includes('SJVN'), 'Manifest name includes SJVN');
    assert(manifest.short_name === 'SJVN Energy', 'Short name is SJVN Energy');
    assert(manifest.display === 'standalone', 'Display is standalone');
    assert(manifest.start_url === '/', 'Start URL is /');
    assert(manifest.theme_color === '#0369a1', 'Theme color is #0369a1');
    assert(manifest.icons.length >= 4, 'At least 4 icons configured');
    assert(manifest.icons.some(i => i.purpose === 'maskable'), 'Maskable icon provided');
    assert(manifest.shortcuts.length === 4, '4 Operating desk shortcuts configured');
    reportPass('Web App Manifest is valid and conforms to PWA installability requirements');
  } catch (err) {
    reportFail('PWA Manifest validation', err);
  }

  // SECTION 2: Service Worker & Offline Fallback Page
  console.log('\n--- 2. SERVICE WORKER & OFFLINE DIRECTORY ---');
  try {
    const swRes = await page.goto(`${BASE_URL}/sw.js`);
    assert(swRes.status() === 200, 'sw.js HTTP 200');
    const swText = await swRes.text();
    assert(swText.includes('sjvn-pwa-v1'), 'Service worker contains cache name');
    assert(swText.includes('/offline.html'), 'Service worker references offline fallback page');
    reportPass('Service Worker script is served and configured correctly');

    const offlineRes = await page.goto(`${BASE_URL}/offline.html`);
    assert(offlineRes.status() === 200, 'offline.html HTTP 200');
    const offlineTitle = await page.textContent('h1');
    assert(offlineTitle.includes('SJVN'), 'Offline page title contains SJVN');
    const pbxText = await page.textContent('.directory-box');
    assert(pbxText.includes('+91-177-2660003'), 'Offline page lists HQ PBX telephone');
    assert(pbxText.includes('wim.it@sjvn.in'), 'Offline page lists WIM email');
    assert(pbxText.includes('1800-11-0023'), 'Offline page lists National Grid emergency number');
    reportPass('Self-contained Offline Fallback Page exists with verified emergency directory');
  } catch (err) {
    reportFail('Service Worker & Offline Fallback', err);
  }

  // SECTION 3: Core Web Vitals & Hero Resource Optimization
  console.log('\n--- 3. CORE WEB VITALS & RESOURCE OPTIMIZATION ---');
  try {
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });

    // Check Preload in head
    const preloadEl = await page.$('link[rel="preload"][as="image"][href*="sjvn-hero-panoramic.avif"]');
    assert(preloadEl !== null, 'High-priority AVIF preload link present in document head');
    const fetchpriority = await preloadEl?.getAttribute('fetchpriority');
    assert(fetchpriority === 'high', 'Preload link has fetchpriority="high"');
    reportPass('LCP Hero AVIF image is preloaded with fetchpriority="high"');

    // Check Hero Image explicit dimensions
    const heroImg = await page.$('.gigw-hero-panoramic-img');
    assert(heroImg !== null, 'Hero fallback picture img rendered');
    const imgWidth = await heroImg?.getAttribute('width');
    const imgHeight = await heroImg?.getAttribute('height');
    assert(imgWidth === '1920' && imgHeight === '1080', 'Hero image has explicit 1920x1080 dimensions');
    const imgPriority = await heroImg?.getAttribute('fetchpriority');
    assert(imgPriority === 'high', 'Hero img element has fetchpriority="high"');
    reportPass('Hero image specifies explicit width/height and fetchpriority="high" (Zero CLS)');

    // Check Hero Video explicit dimensions
    const heroVideo = await page.$('.gigw-hero-video');
    const vidWidth = await heroVideo?.getAttribute('width');
    const vidHeight = await heroVideo?.getAttribute('height');
    assert(vidWidth === '1920' && vidHeight === '1080', 'Hero video has explicit 1920x1080 dimensions');
    reportPass('Hero video specifies explicit width/height to reserve aspect ratio');

    // Check content-visibility on off-screen sections
    const cvSection = await page.evaluate(() => {
      const footer = document.querySelector('.gigw-footer');
      if (!footer) return null;
      return window.getComputedStyle(footer).contentVisibility;
    });
    assert(cvSection === 'auto', `Off-screen sections apply content-visibility: auto (got ${cvSection})`);
    reportPass('Off-screen sections apply content-visibility: auto to optimize rendering');

    // Check Cumulative Layout Shift (CLS)
    const clsScore = await page.evaluate(() => {
      return new Promise((resolve) => {
        let cls = 0;
        try {
          const observer = new PerformanceObserver((entryList) => {
            for (const entry of entryList.getEntries()) {
              if (!entry.hadRecentInput) {
                cls += entry.value;
              }
            }
          });
          observer.observe({ type: 'layout-shift', buffered: true });
          setTimeout(() => {
            observer.disconnect();
            resolve(cls);
          }, 350);
        } catch {
          resolve(0);
        }
      });
    });
    assert(clsScore < 0.05, `Cumulative Layout Shift is zero or near-zero (CLS: ${clsScore})`);
    reportPass(`Verified Core Web Vitals: CLS score is ${clsScore.toFixed(4)} (< 0.05 threshold)`);
  } catch (err) {
    reportFail('Core Web Vitals & Optimization', err);
  }

  // SECTION 4: Multi-Regional Languages Expansion
  console.log('\n--- 4. MULTI-REGIONAL LANGUAGES EXPANSION ---');
  try {
    // Check Language Select Dropdown
    const langSelect = await page.$('#gigw-regional-lang-select');
    assert(langSelect !== null, 'Regional language dropdown exists in GovStrip toolbar');

    const options = await page.$$eval('#gigw-regional-lang-select option', (opts) => opts.map(o => o.value));
    assert(options.includes('en'), 'Supports English (en)');
    assert(options.includes('hi'), 'Supports Hindi (hi)');
    assert(options.includes('gu'), 'Supports Gujarati (gu - Solar)');
    assert(options.includes('mr'), 'Supports Marathi (mr - Wind)');
    reportPass('GovStrip includes Pan-India regional languages: English, Hindi, Gujarati, Marathi');

    // Switch to Gujarati (Gujarat Solar Projects: Khavda, Raghanesda, Dholera)
    await page.selectOption('#gigw-regional-lang-select', 'gu');
    await page.waitForTimeout(200);
    const htmlLangGu = await page.getAttribute('html', 'lang');
    assert(htmlLangGu === 'gu', 'Switching language sets html[lang="gu"]');
    const heroTitleGu = await page.textContent('h1#panoramic-hero-title');
    assert(heroTitleGu.includes('એસજેવીએન'), 'Hero H1 translates to Gujarati ("એસજેવીએન")', heroTitleGu.replace(/\s+/g, ' '));
    const taglineGu = await page.textContent('.gigw-hero-tagline');
    assert(taglineGu.includes('સ્વચ્છ ઊર્જા'), 'Tagline translates to Gujarati ("સ્વચ્છ ઊર્જા")', taglineGu.replace(/\s+/g, ' '));
    reportPass('Gujarati translation renders flawlessly for Gujarat Solar stakeholders');

    // Switch to Marathi (Maharashtra Wind Projects: Khirvire, Sadawaghapur)
    await page.selectOption('#gigw-regional-lang-select', 'mr');
    await page.waitForTimeout(200);
    const htmlLangMr = await page.getAttribute('html', 'lang');
    assert(htmlLangMr === 'mr', 'Switching language sets html[lang="mr"]');
    const heroTitleMr = await page.textContent('h1#panoramic-hero-title');
    assert(heroTitleMr.includes('एसजेव्हीएन'), 'Hero H1 translates to Marathi ("एसजेव्हीएन")', heroTitleMr.replace(/\s+/g, ' '));
    const taglineMr = await page.textContent('.gigw-hero-tagline');
    assert(taglineMr.includes('स्वच्छ ऊर्जा'), 'Tagline translates to Marathi ("स्वच्छ ऊर्जा")', taglineMr.replace(/\s+/g, ' '));
    reportPass('Marathi translation renders flawlessly for Western Grid wind stakeholders');

    // Switch to Hindi
    await page.selectOption('#gigw-regional-lang-select', 'hi');
    await page.waitForTimeout(200);
    const htmlLangHi = await page.getAttribute('html', 'lang');
    assert(htmlLangHi === 'hi', 'Switching language sets html[lang="hi"]');
    const heroTitleHi = await page.textContent('h1#panoramic-hero-title');
    assert(heroTitleHi.includes('एसजेवीएन'), 'Hero H1 translates to Hindi ("एसजेवीएन")');
    reportPass('Hindi translation renders flawlessly for Northern & Eastern Grid stakeholders');

    // Quick Bilingual Button switch back to English
    const quickToggle = await page.$('.gigw-toolbar button.gigw-tool-text[lang]');
    assert(quickToggle !== null, 'Quick bilingual toggle button exists');
    await quickToggle?.click();
    await page.waitForTimeout(200);
    const htmlLangEn = await page.getAttribute('html', 'lang');
    assert(htmlLangEn === 'en', 'Quick toggle restores html[lang="en"]');
    reportPass('Quick bilingual button preserves backwards-compatible EN<->HI instant toggle');
  } catch (err) {
    reportFail('Multi-Regional Languages', err);
  }

  // SECTION 5: Offline State Emulation & Offline Banner
  console.log('\n--- 5. OFFLINE STATUS EMULATION ---');
  try {
    // Go offline
    await context.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event('offline')));
    await page.waitForTimeout(300);

    const offlineBanner = await page.$('.gigw-offline-banner');
    assert(offlineBanner !== null, 'Offline banner appears when disconnected');
    const bannerText = await offlineBanner?.textContent();
    assert(bannerText.includes('Offline Mode') || bannerText.includes('ऑफ़लाइन'), 'Banner proclaims Offline Mode');
    const dirLink = await page.$('.offline-btn-directory');
    const dirHref = await dirLink?.getAttribute('href');
    assert(dirHref === '/offline.html', 'Banner links to /offline.html emergency directory');
    reportPass('Offline Banner triggers immediately upon network disconnection');

    // Restore online
    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await page.waitForTimeout(300);

    const bannerGone = await page.$('.gigw-offline-banner');
    assert(bannerGone === null, 'Offline banner disappears once connection is restored');
    reportPass('Offline Banner auto-dismisses upon network restoration');
  } catch (err) {
    reportFail('Offline Emulation', err);
  }

  // SECTION 6: WCAG 2.1 AA Accessibility on New Controls
  console.log('\n--- 6. WCAG 2.1 AA ACCESSIBILITY AUDIT ---');
  try {
    const axeResults = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .exclude('canvas')
      .analyze();
    const serious = axeResults.violations.filter(v => ['serious', 'critical'].includes(v.impact));
    assert(serious.length === 0, `Zero critical/serious violations (found ${serious.length})`);
    reportPass('Zero critical or serious WCAG 2.1 AA violations with PWA & regional controls active');
  } catch (err) {
    reportFail('WCAG 2.1 AA Audit', err);
  }

  await browser.close();

  console.log('\n================================================================');
  console.log(`   TEST RESULT: ${passCount} PASSED  |  ${failCount} FAILED`);
  console.log('================================================================\n');

  if (failCount > 0) process.exit(1);
}

runSuite().catch((err) => {
  console.error('Fatal Test Error:', err);
  process.exit(1);
});
