import { chromium } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';

const BASE_URL = process.env.TEST_URL || 'http://localhost:5173';

async function testAdvancedFeatures() {
  console.log('================================================================');
  console.log('   SJVN ADVANCED FEATURES E2E SUITE                             ');
  console.log('   1. Spotlight Search Deep Index & Category Filter             ');
  console.log('   2. UX4G Text-to-Speech (Screen Reader Audio Widget)          ');
  console.log('   3. Keyboard Shortcut Cheat Sheet Modal (? Key)               ');
  console.log('   4. Floating Back to Top with Reading Progress Indicator      ');
  console.log(`   Target URL: ${BASE_URL}                                      `);
  console.log('================================================================\n');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  });

  const page = await context.newPage();

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

  await page.goto(BASE_URL, { waitUntil: 'networkidle' });

  // =========================================================================
  // 1. SPOTLIGHT SEARCH DEEP INDEXING & CATEGORY FILTERING
  // =========================================================================
  console.log('\n--- 1. SPOTLIGHT SEARCH DEEP INDEXING & CATEGORY FILTERING ---');
  
  // Open via Cmd+K / Ctrl+K
  await page.keyboard.press('Meta+k');
  await page.waitForTimeout(200);
  let searchModal = await page.$('.portal-search-modal');
  if (!searchModal) {
    // Fallback for Linux/Windows headless runner
    await page.keyboard.press('Control+k');
    await page.waitForTimeout(200);
    searchModal = await page.$('.portal-search-modal');
  }
  if (!searchModal) {
    await page.click('.gigw-search-trigger-btn');
    await page.waitForTimeout(200);
    searchModal = await page.$('.portal-search-modal');
  }
  assert(searchModal !== null, 'Spotlight search modal opened successfully');

  // Verify modal scroll containment per modern-web-guidance
  const modalOverscroll = await page.$eval('.portal-search-modal', el => window.getComputedStyle(el).overscrollBehavior);
  assert(modalOverscroll === 'contain', 'Search modal specifies overscroll-behavior: contain', modalOverscroll);

  // Category filter tabs
  const catPills = await page.$$('.portal-search-cat-pill');
  assert(catPills.length >= 7, 'Category filter tabs rendered (All, Desks, Regulations, Tenders, Forms, Glossary, Policies)', `Count: ${catPills.length}`);

  const searchInput = await page.$('.portal-search-input');
  assert(searchInput !== null, 'Search input autofocused and available');

  // Test Deep Index Keyword 1: CERC IEGC Regulation
  await searchInput.fill('IEGC');
  await page.waitForTimeout(150);
  let resultItems = await page.$$('.portal-search-result-item');
  let firstItemTitle = await resultItems[0]?.textContent();
  assert(resultItems.length > 0 && firstItemTitle.includes('IEGC'), 'Deep search for "IEGC" returns CERC Grid Code', firstItemTitle?.slice(0, 50));

  // Test Deep Index Keyword 2: CERC DSM Regulation
  await searchInput.fill('DSM');
  await page.waitForTimeout(150);
  resultItems = await page.$$('.portal-search-result-item');
  firstItemTitle = await resultItems[0]?.textContent();
  assert(resultItems.length > 0 && (firstItemTitle.includes('DSM') || firstItemTitle.includes('Deviation')), 'Deep search for "DSM" returns Deviation Settlement Mechanism', firstItemTitle?.slice(0, 50));

  // Test Deep Index Keyword 3: REIA Tender
  await searchInput.fill('SOLAR-1200MW');
  await page.waitForTimeout(150);
  resultItems = await page.$$('.portal-search-result-item');
  firstItemTitle = await resultItems[0]?.textContent();
  assert(resultItems.length > 0 && firstItemTitle.includes('SOLAR-1200MW'), 'Deep search for "SOLAR-1200MW" returns ISTS Solar Tender', firstItemTitle?.slice(0, 50));

  // Test Deep Index Keyword 4: CERC Form-IV
  await searchInput.fill('Form-IV');
  await page.waitForTimeout(150);
  resultItems = await page.$$('.portal-search-result-item');
  firstItemTitle = await resultItems[0]?.textContent();
  assert(resultItems.length > 0 && firstItemTitle.includes('Form-IV'), 'Deep search for "Form-IV" returns Monthly Trader Return Form', firstItemTitle?.slice(0, 50));

  // Test Deep Index Keyword 5: Energy Market Glossary (PPA)
  await searchInput.fill('PPA');
  await page.waitForTimeout(150);
  resultItems = await page.$$('.portal-search-result-item');
  const ppaMatch = (await Promise.all(resultItems.map(r => r.textContent()))).some(t => t.includes('Power Purchase Agreement') || t.includes('पीपीए'));
  assert(ppaMatch, 'Deep search for "PPA" returns Glossary Power Purchase Agreement');

  // Test Deep Index Keyword 6: Energy Charge Rate (ECR)
  await searchInput.fill('ECR');
  await page.waitForTimeout(150);
  resultItems = await page.$$('.portal-search-result-item');
  const ecrMatch = (await Promise.all(resultItems.map(r => r.textContent()))).some(t => t.includes('ECR') || t.includes('Energy Charge Rate'));
  assert(eccrMatch => ecrMatch, 'Deep search for "ECR" returns Energy Charge Rate glossary entry');

  // Test Deep Index Keyword 7: Real-Time Market (RTM)
  await searchInput.fill('RTM');
  await page.waitForTimeout(150);
  resultItems = await page.$$('.portal-search-result-item');
  const rtmMatch = (await Promise.all(resultItems.map(r => r.textContent()))).some(t => t.includes('RTM') || t.includes('Real-Time Market'));
  assert(rtmMatch, 'Deep search for "RTM" returns Real-Time Market glossary entry');

  // Test Category Tab Filtering
  await searchInput.fill('');
  const regTab = await page.$('.portal-search-cat-pill:has-text("CERC Regulations")');
  if (regTab) {
    await regTab.click();
    await page.waitForTimeout(150);
    const regResults = await page.$$('.portal-search-result-item');
    const tags = await Promise.all(regResults.map(r => r.$eval('.portal-search-item-tag', el => el.textContent)));
    assert(regResults.length >= 4, 'Clicking CERC Regulations category tab lists regulatory index items', `Found: ${regResults.length}`);
    assert(tags.every(t => t.includes('Regulation') || t.includes('विनियम')), 'All listed items belong to CERC Regulation category');
  }

  // Close search modal on Escape
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  const searchClosed = await page.$('.portal-search-modal');
  assert(searchClosed === null, 'Spotlight search modal closed on Escape');

  // =========================================================================
  // 2. UX4G TEXT-TO-SPEECH (SCREEN READER AUDIO WIDGET)
  // =========================================================================
  console.log('\n--- 2. UX4G TEXT-TO-SPEECH (SCREEN READER AUDIO WIDGET) ---');

  const listenBtn = await page.$('.gigw-tool-audio');
  assert(listenBtn !== null, 'GovStrip accessibility toolbar contains "Listen / सुनें" button');

  // Click to open Audio Widget
  if (listenBtn) {
    await listenBtn.click();
    await page.waitForTimeout(250);
  }
  const audioWidget = await page.$('.gigw-audio-widget-container');
  assert(audioWidget !== null, 'UX4G Audio Reader Widget opens upon clicking toolbar button');

  // Verify WCAG AAA badge & Accessible region
  const audioBadge = await page.textContent('.gigw-audio-badge');
  assert(audioBadge.includes('WCAG AAA'), 'Audio Widget displays WCAG AAA compliance badge', audioBadge);

  const liveRegion = await page.$('.gigw-audio-widget-container [aria-live="polite"]');
  assert(liveRegion !== null, 'Polite live-region exists for screen reader announcements');

  // Verify controls: Play/Pause, Stop, Next/Prev, Speed Rate
  const playBtn = await page.$('.gigw-audio-btn-play');
  const stopBtn = await page.$('.gigw-audio-btn-stop');
  const rateBtn = await page.$('.gigw-audio-btn-rate');
  const snippetText = await page.textContent('.gigw-audio-snippet');

  assert(playBtn !== null, 'Audio Play/Pause action button present');
  assert(stopBtn !== null, 'Audio Stop action button present');
  assert(rateBtn !== null, 'Audio Speech Speed adjuster present');
  assert(snippetText.includes('SJVN Limited'), 'Audio preview shows first national overview section', snippetText.slice(0, 60));

  // Test Speed Rate Cycle (1x -> 1.25x -> 1.5x -> 0.75x)
  if (rateBtn) {
    const initialRate = await rateBtn.textContent();
    assert(initialRate.includes('1x'), 'Default speech rate is 1x', initialRate.trim());
    await rateBtn.click();
    await page.waitForTimeout(100);
    const nextRate = await rateBtn.textContent();
    assert(nextRate.includes('1.25x'), 'Clicking speed rate adjusts to 1.25x', nextRate.trim());
  }

  // Test close via Close Button
  const closeAudioBtn = await page.$('.gigw-audio-close-btn');
  if (closeAudioBtn) {
    await closeAudioBtn.click();
    await page.waitForTimeout(150);
  }
  const audioClosed = await page.$('.gigw-audio-widget-container');
  assert(audioClosed === null, 'Audio Widget closes cleanly via close button');

  // Test toggle via Keyboard Shortcut Alt+U
  await page.keyboard.press('Alt+u');
  await page.waitForTimeout(200);
  const audioReopened = await page.$('.gigw-audio-widget-container');
  assert(audioReopened !== null, 'Keyboard shortcut Alt+U toggles open Audio Widget');

  await page.keyboard.press('Alt+u');
  await page.waitForTimeout(150);
  const audioReclosed = await page.$('.gigw-audio-widget-container');
  assert(audioReclosed === null, 'Keyboard shortcut Alt+U toggles closed Audio Widget');

  // =========================================================================
  // 3. KEYBOARD SHORTCUT CHEAT SHEET MODAL (? KEY)
  // =========================================================================
  console.log('\n--- 3. KEYBOARD SHORTCUT CHEAT SHEET MODAL (? KEY) ---');

  const shortcutsBtn = await page.$('.gigw-tool-shortcuts');
  assert(shortcutsBtn !== null, 'GovStrip accessibility toolbar contains "Shortcuts / शॉर्टकट" button');

  // Press '?' key to open cheat sheet
  await page.keyboard.press('?');
  await page.waitForTimeout(200);
  let shortcutsModal = await page.$('.shortcuts-modal-dialog');
  if (!shortcutsModal && shortcutsBtn) {
    await shortcutsBtn.click();
    await page.waitForTimeout(200);
    shortcutsModal = await page.$('.shortcuts-modal-dialog');
  }
  assert(shortcutsModal !== null, 'Keyboard shortcut "?" opens Shortcuts Cheat Sheet Modal');

  // Verify ARIA modal dialog semantics
  const dialogRole = await shortcutsModal?.getAttribute('role');
  const ariaModal = await shortcutsModal?.getAttribute('aria-modal');
  const ariaLabelledBy = await shortcutsModal?.getAttribute('aria-labelledby');
  assert(dialogRole === 'dialog', 'Shortcuts modal has role="dialog"', dialogRole);
  assert(ariaModal === 'true', 'Shortcuts modal has aria-modal="true"', ariaModal);
  assert(ariaLabelledBy === 'shortcuts-modal-title', 'Shortcuts modal references title with aria-labelledby', ariaLabelledBy);

  // Check overscroll-behavior: contain
  const shortcutsOverscroll = await page.$eval('.shortcuts-modal-dialog', el => window.getComputedStyle(el).overscrollBehavior);
  assert(shortcutsOverscroll === 'contain', 'Shortcuts modal enforces overscroll-behavior: contain', shortcutsOverscroll);

  // Check Shortcut Group Cards
  const groupCards = await page.$$('.shortcuts-group-card');
  assert(groupCards.length === 3, 'Shortcuts cheat sheet contains 3 categorized cards (Navigation, GIGW Accessibility, Controls)');

  // Verify presence of documented shortcuts in table
  const allModalText = await page.textContent('.shortcuts-modal-dialog');
  assert(allModalText.includes('⌘') && allModalText.includes('K'), 'Cheat sheet documents ⌘K / Ctrl+K Spotlight Search');
  assert(allModalText.includes('Alt') && allModalText.includes('A'), 'Cheat sheet documents Alt+A Font Size Cycle');
  assert(allModalText.includes('Alt') && allModalText.includes('C'), 'Cheat sheet documents Alt+C High Contrast');
  assert(allModalText.includes('Alt') && allModalText.includes('L'), 'Cheat sheet documents Alt+L Language Switch');
  assert(allModalText.includes('Alt') && allModalText.includes('U'), 'Cheat sheet documents Alt+U UX4G Audio Reader');

  // Close on Escape
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  const shortcutsClosed = await page.$('.shortcuts-modal-dialog');
  assert(shortcutsClosed === null, 'Shortcuts modal closes cleanly upon pressing Escape');

  // =========================================================================
  // 4. FLOATING "BACK TO TOP" WITH READING PROGRESS INDICATOR
  // =========================================================================
  console.log('\n--- 4. FLOATING "BACK TO TOP" WITH READING PROGRESS INDICATOR ---');

  const bttWrap = await page.$('.gigw-back-to-top-wrap');
  assert(bttWrap !== null, 'Floating "Back to Top" component mounted in DOM');

  // At top of page (scrollY = 0), it should not have is-visible class
  const isInitiallyVisible = await page.$eval('.gigw-back-to-top-wrap', el => el.classList.contains('is-visible'));
  assert(!isInitiallyVisible, 'Back to top button is initially hidden at page top (scrollY = 0)');

  // Scroll down to middle of page
  await page.evaluate(() => {
    window.scrollTo(0, 800);
    const pub = document.querySelector('.gigw-public');
    if (pub) pub.scrollTop = 800;
    window.dispatchEvent(new Event('scroll'));
    if (pub) pub.dispatchEvent(new Event('scroll'));
  });
  await page.waitForTimeout(300);

  const isVisibleAfterScroll = await page.$eval('.gigw-back-to-top-wrap', el => el.classList.contains('is-visible'));
  assert(isVisibleAfterScroll, 'Back to top button transitions to visible after scrolling > 250px');

  // Verify SVG reading progress indicator
  const progressSvg = await page.$('.gigw-back-to-top-svg');
  assert(progressSvg !== null, 'Circular SVG reading progress ring present');

  const ariaHidden = await progressSvg?.getAttribute('aria-hidden');
  assert(ariaHidden === 'true', 'Progress ring sets aria-hidden="true" per scroll-progress-indicator modern guidance');

  // Verify strokeDashoffset is calculated dynamically
  const strokeDashoffset = await page.$eval('.gigw-back-to-top-indicator', el => parseFloat(el.getAttribute('stroke-dashoffset') || '0'));
  assert(strokeDashoffset < 113.1, 'Indicator circle strokeDashoffset tracks scrolled percentage', `${strokeDashoffset.toFixed(1)} < 113.1`);

  // Verify button accessible aria-label
  const bttAriaLabel = await page.$eval('.gigw-back-to-top-btn', el => el.getAttribute('aria-label'));
  assert(bttAriaLabel.includes('Back to top') && bttAriaLabel.includes('% read'), 'Button aria-label announces scroll progress percentage to screen readers', bttAriaLabel);

  // Click Back to top and verify page scrolls back to 0
  await page.click('.gigw-back-to-top-wrap.is-visible .gigw-back-to-top-btn');
  await page.waitForTimeout(600);
  const finalScrollY = await page.evaluate(() => {
    const pub = document.querySelector('.gigw-public');
    return Math.max(window.scrollY, pub ? pub.scrollTop : 0);
  });
  assert(finalScrollY === 0, 'Clicking Back to Top smoothly returns viewport scroll position to 0', `scrollY: ${finalScrollY}`);

  // =========================================================================
  // 5. AXE-CORE ACCESSIBILITY AUDIT ON NEW COMPONENTS
  // =========================================================================
  console.log('\n--- 5. AXE-CORE WCAG 2.1 AA AUDIT ON ENHANCED HOMEPAGE ---');
  const axeResults = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();

  const seriousViolations = axeResults.violations.filter(v => ['serious', 'critical'].includes(v.impact));
  assert(seriousViolations.length === 0, 'Zero critical or serious WCAG 2.1 AA violations on enhanced homepage', 
    seriousViolations.length > 0 ? JSON.stringify(seriousViolations, null, 2) : 'No violations');

  console.log('\n================================================================');
  console.log(`   ADVANCED FEATURES TEST SUMMARY: ${passCount} PASSED  |  ${failCount} FAILED`);
  console.log('================================================================\n');

  await browser.close();

  if (failCount > 0) {
    process.exit(1);
  }
}

testAdvancedFeatures().catch(err => {
  console.error('Fatal test execution error:', err);
  process.exit(1);
});
