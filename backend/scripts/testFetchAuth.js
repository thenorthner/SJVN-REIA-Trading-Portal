import fetch from 'node-fetch';

async function testFetchAuth() {
  console.log('Fetching /loginPage...');
  const res1 = await fetch('https://cea.nic.in/loginPage');
  const html1 = await res1.text();
  const cookies1 = res1.headers.raw()['set-cookie'];
  let sessionId = '';
  if (cookies1) {
    const sessionCookie = cookies1.find(c => c.includes('JSESSIONID'));
    if (sessionCookie) sessionId = sessionCookie.split(';')[0];
  }
  
  const csrfMatch = html1.match(/name="_csrf" value="([^"]+)"/);
  const csrf = csrfMatch ? csrfMatch[1] : '';
  
  console.log('JSESSIONID:', sessionId);
  console.log('_csrf:', csrf);
  
  console.log('Fetching /captcha image to initialize session captcha...');
  const resCaptcha = await fetch('https://cea.nic.in/captcha?t=' + Date.now(), {
    headers: { 'Cookie': sessionId }
  });
  const capBuffer = await resCaptcha.arrayBuffer();
  console.log('Captcha fetched, bytes:', capBuffer.byteLength);

  console.log('Posting to /login...');
  const params = new URLSearchParams();
  params.append('username', 'demo');
  params.append('password', 'demo');
  params.append('captcha', '123456');
  if (csrf) params.append('_csrf', csrf);
  
  const res2 = await fetch('https://cea.nic.in/login', {
    method: 'POST',
    body: params,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cookie': sessionId
    },
    redirect: 'manual'
  });
  
  console.log('Login Status:', res2.status);
  console.log('Login Location:', res2.headers.get('location'));
  
  let finalCookies = sessionId;
  const cookies2 = res2.headers.raw()['set-cookie'];
  if (cookies2) {
    const newSession = cookies2.find(c => c.includes('JSESSIONID'));
    if (newSession) finalCookies = newSession.split(';')[0];
  }
  
  console.log('Final Cookie:', finalCookies);
  
  console.log('Fetching archive...');
  const res3 = await fetch('https://cea.nic.in/monthly-reports-archive/', {
    headers: { 'Cookie': finalCookies }
  });
  
  const html3 = await res3.text();
  const linksMatch = html3.match(/href="([^"]+\.xlsx?)"/g);
  const links = linksMatch ? linksMatch.map(m => m.match(/"([^"]+)"/)[1]) : [];
  
  console.log('Found excel links:', links.length);
  if (links.length > 0) {
    console.log(links.slice(0, 5));
  } else {
    console.log('HTML snipp:', html3.slice(0, 500));
  }
}

testFetchAuth().catch(console.error);
