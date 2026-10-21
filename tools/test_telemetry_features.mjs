import pkg from '../frontend/node_modules/@playwright/test/index.js';
const { chromium } = pkg;

const BASE_URL = 'http://localhost:5173';

async function testTelemetryFeatures() {
  console.log('================================================================');
  console.log('   SJVN INTEGRATED ENERGY PLATFORM — REAL TELEMETRY VERIFICATION');
  console.log('================================================================\n');

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`  ✅ PASS: ${message}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${message}`);
      failed++;
    }
  }

  try {
    console.log('--- 1. HOMEPAGE NAVIGATION ---');
    const response = await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 15000 });
    assert(response && response.status() === 200, 'Homepage loaded with HTTP 200');

    console.log('\n--- 2. LIVE POWER MARKET TICKER (IEX / PXIL / HPX) ---');
    const tickerContainer = await page.waitForSelector('.market-ticker-container', { timeout: 6000 });
    assert(!!tickerContainer, 'LiveMarketTicker container rendered in DOM');

    const badgeTitle = await page.textContent('.ticker-badge-title');
    assert(badgeTitle && badgeTitle.includes('POWER MARKET TELEMETRY'), `Badge title rendered: "${badgeTitle}"`);

    const datePill = await page.textContent('.ticker-date-pill');
    assert(datePill && datePill.includes('Aug 2026'), `Date pill matches authentic trading date: "${datePill}"`);

    const volumePill = await page.textContent('.ticker-volume-pill');
    assert(volumePill && volumePill.includes('11,668 MW'), `Total volume pill displays authentic volume: "${volumePill}"`);

    const tickerItems = await page.$$('.market-ticker-item');
    assert(tickerItems.length >= 9, `Rendered ${tickerItems.length} ticker exchange-product items`);

    const tickerText = await page.textContent('.market-ticker-viewport');
    assert(tickerText.includes('IEX') && tickerText.includes('DAM') && tickerText.includes('₹4.03'), 'IEX DAM price ₹4.03/kWh is displayed');
    assert(tickerText.includes('PXIL') && tickerText.includes('DAM') && tickerText.includes('₹4.37'), 'PXIL DAM price ₹4.37/kWh is displayed');
    assert(tickerText.includes('HPX') && tickerText.includes('RTM') && tickerText.includes('₹4.39'), 'HPX RTM price ₹4.39/kWh is displayed');

    // Test WCAG Pause/Play toggle
    const pauseBtn = await page.$('.ticker-ctrl-btn');
    assert(!!pauseBtn, 'WCAG Pause/Resume button exists');
    await pauseBtn.click();
    const isPaused = await page.$('.market-ticker-track.is-paused');
    assert(!!isPaused, 'Ticker track receives is-paused class when clicked');

    await pauseBtn.click();
    const isRunning = await page.$('.market-ticker-track:not(.is-paused)');
    assert(!!isRunning, 'Ticker track resumes animation on second click');

    console.log('\n--- 3. CLEAN ENERGY & CARBON OFFSET TELEMETRY (ESG) ---');
    const esgSection = await page.waitForSelector('#clean-energy-telemetry', { timeout: 6000 });
    assert(!!esgSection, 'CleanEnergyCounter section rendered in DOM');

    const esgTitle = await page.textContent('#esg-telemetry-heading');
    assert(esgTitle && esgTitle.includes('Clean Energy & Carbon Offset Telemetry'), `Section title rendered: "${esgTitle}"`);

    const generationCard = await page.$('.esg-card-generation');
    assert(!!generationCard, 'Green Power Generation card exists');
    const genValue = await page.textContent('.esg-card-generation .esg-primary-stat');
    assert(genValue && genValue.includes('7,427.77'), `FY 2026-27 Clean MUs matches actual DB: ${genValue} MUs`);

    const carbonCard = await page.$('.esg-card-carbon');
    assert(!!carbonCard, 'Decarbonization Impact card exists');
    const co2Value = await page.textContent('.esg-card-carbon .esg-primary-stat');
    assert(co2Value && co2Value.includes('5,318,283'), `FY 2026-27 Avoided CO2 matches CEA calculations: ${co2Value} MT`);

    const provenanceBanner = await page.$('.esg-provenance-banner');
    assert(!!provenanceBanner, 'Regulatory Data Provenance banner exists');
    const provenanceText = await page.textContent('.esg-provenance-banner');
    assert(provenanceText.includes('100% Audited Regulatory Telemetry') && provenanceText.includes('Zero synthetic'), 'Integrity statement verified');
    assert(provenanceText.includes('CEA Grid Baseline (0.716 tCO₂/MWh)'), 'Official CEA Grid emission standard cited');

    console.log('\n--- 4. STRICT ZERO-DUMMY-DATA VERIFICATION ---');
    const pageHtml = await page.content();
    assert(!pageHtml.includes('cumecs'), 'Zero fake river flow cumecs telemetry rendered');
    assert(!pageHtml.includes('EL 1495.5') && !pageHtml.includes('FRL 1495.5'), 'Zero synthetic dam reservoir water level telemetry rendered');
    assert(!pageHtml.includes('Coal Stock Days'), 'Zero synthetic daily coal stock days telemetry rendered');

    console.log('\n================================================================');
    console.log(`   TELEMETRY TEST RESULTS: ${passed} PASSED / ${failed} FAILED`);
    console.log('================================================================\n');

  } catch (err) {
    console.error('Fatal test error:', err);
    failed++;
  } finally {
    await browser.close();
  }

  process.exit(failed > 0 ? 1 : 0);
}

testTelemetryFeatures();
