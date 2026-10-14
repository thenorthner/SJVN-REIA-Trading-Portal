// Builds the Word manual from content/ and shots/.   node build.mjs
import { build } from './lib/doc.mjs';
import part1 from './content/part1.mjs';
import part2 from './content/part2.mjs';
import part3 from './content/part3.mjs';
import { part4, part5 } from './content/part4.mjs';
import part6 from './content/part6.mjs';

await build('out/SJVN_REIA_User_Manual.docx', {
  title: 'REIA User Manual',
  subtitle: 'Billing & Settlement — step by step, with screenshots',
  version: 'Version 1.0', date: 'October 2026',
  audience: 'SJVN REIA desk, Finance, Management, Sellers and Buyers',
}, [part1(), part2(), part3(), part4(), part5(), part6()]);
