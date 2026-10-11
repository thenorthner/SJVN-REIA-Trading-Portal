import puppeteer from 'puppeteer';

async function testPuppeteer() {
  console.log('Launching puppeteer...');
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  
  console.log('Going to login page...');
  await page.goto('https://cea.nic.in/loginPage', { waitUntil: 'networkidle2' });
  
  console.log('Filling form...');
  await page.type('#username', 'demo');
  await page.type('#password', 'demo');
  await page.type('#captchaInput', '123456');
  
  console.log('Clicking login...');
  await Promise.all([
    page.click('button[type="submit"]'),
    page.waitForNavigation({ waitUntil: 'networkidle2' }),
  ]);
  
  console.log('Going to archive...');
  await page.goto('https://cea.nic.in/monthly-reports-archive/', { waitUntil: 'networkidle2' });
  
  const links = await page.$$eval('a', as => as.map(a => a.href));
  const excelLinks = links.filter(l => l && (l.endsWith('.xlsx') || l.endsWith('.xls') || l.includes('xlsx')));
  
  console.log(`Found ${excelLinks.length} excel links.`);
  if (excelLinks.length > 0) {
    console.log(excelLinks.slice(0, 10));
  } else {
    console.log('No excel links found. Page content:');
    const body = await page.evaluate(() => document.body.innerText);
    console.log(body.slice(0, 1000));
  }
  
  await browser.close();
}

testPuppeteer().catch(console.error);
