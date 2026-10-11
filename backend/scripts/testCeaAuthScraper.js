import fetch from 'node-fetch';
import * as cheerio from 'cheerio';

async function testAuthScrape() {
  const baseUrl = 'https://cea.nic.in';
  
  // 1. Get Login Page & CSRF token
  const res1 = await fetch(`${baseUrl}/loginPage`);
  const html1 = await res1.text();
  const cookies1 = res1.headers.raw()['set-cookie'];
  console.log('Cookies from /loginPage:', cookies1);
  
  const $1 = cheerio.load(html1);
  const csrf = $1('input[name="_csrf"]').val();
  console.log('CSRF Token:', csrf);
  
  const cookieHeader = cookies1 ? cookies1.map(c => c.split(';')[0]).join('; ') : '';

  // 2. Perform Login POST
  const params = new URLSearchParams();
  params.append('_csrf', csrf);
  params.append('username', 'demo');
  params.append('password', 'demo');
  params.append('captcha', '123456');

  console.log('Sending login POST...');
  const res2 = await fetch(`${baseUrl}/login`, {
    method: 'POST',
    body: params,
    headers: {
      'Cookie': cookieHeader,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    redirect: 'manual'
  });

  const cookies2 = res2.headers.raw()['set-cookie'] || [];
  console.log('Login Response Status:', res2.status);
  console.log('Login Location:', res2.headers.get('location'));
  
  const finalCookies = [...cookies1, ...cookies2].map(c => c.split(';')[0]).join('; ');

  // 3. Get Archive Page
  console.log('Fetching Archive Page...');
  const res3 = await fetch(`${baseUrl}/monthly-reports-archive/`, {
    headers: {
      'Cookie': finalCookies
    }
  });

  const html3 = await res3.text();
  const $3 = cheerio.load(html3);
  
  const links = [];
  $3('a').each((i, el) => {
    links.push($3(el).attr('href'));
  });
  
  console.log(`Found ${links.length} total links on archive page.`);
  if (links.length > 0) {
    const excelLinks = links.filter(l => l && (l.endsWith('.xlsx') || l.endsWith('.xls') || l.includes('xlsx')));
    console.log('Excel/Report Links:', excelLinks);
  }
}

testAuthScrape();
