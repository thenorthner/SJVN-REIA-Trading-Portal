import * as cheerio from 'cheerio';
import fetch from 'node-fetch';

async function testScrape() {
  const url = 'https://cea.nic.in/monthly-reports-archive/';
  console.log(`Fetching ${url}...`);
  try {
    const res = await fetch(url);
    const html = await res.text();
    const $ = cheerio.load(html);
    
    console.log($('body').text().slice(0, 1000));
    console.log('---');
    const links = [];
    $('a').each((i, el) => {
      links.push($(el).attr('href'));
    });
    console.log(`Found ${links.length} total links.`);
    if (links.length > 0) {
      console.log('Sample links:', links.filter(l => l && l.includes('cea')).slice(0, 10));
    }

    console.log(`Found ${links.length} document links.`);
    if (links.length > 0) {
      console.log('Sample links:', links.slice(0, 10));
    }
  } catch (err) {
    console.error('Failed to fetch:', err);
  }
}

testScrape();
