import { chromium, open, login, settle, shot, dumpTo, soft, samplePdf, field, BASE } from '../lib/browser.mjs';
const browser = await chromium.launch();
const pdf = await samplePdf(browser, 'Certificate-of-Incorporation.pdf', 'Certificate of Incorporation', ['Himalaya Wind Energy Pvt Ltd', 'CIN U40108HP2019PTC007788']);
const { page } = await open(browser);
await login(page, 'SJVN Admin');
await page.goto(BASE + '/reia/entities'); await settle(page, 900);
const main = page.locator('main');
const sel = main.locator('select');
await shot(page, '02-ent-list', { marks: [
  { at: page.getByRole('link', { name: 'Stakeholders (Sellers/Buyers)' }), n: 1, pos: 'r', pad: 2 },
  { at: page.getByRole('button', { name: '+ Onboard Stakeholder' }), n: 2, pos: 'l' },
  { at: sel.nth(0), n: 3, pos: 'b' }, { at: sel.nth(1), n: 4, pos: 'b' },
  { at: main.locator('table').first(), n: 5, pos: 'tl', pad: 0 },
] });
await page.getByRole('button', { name: '+ Onboard Stakeholder' }).click(); await settle(page, 500);
const m = page.locator('.modal');
const f = (label) => field(m, label);
await shot(page, '02-ent-new-empty', { tall: 1700, crop: m, margin: 20 });
await f('Entity Type').selectOption({ label: 'Seller' });
await f('Name').fill('Himalaya Wind Energy Pvt Ltd');
await f('Category').fill('RE Generator');
await shot(page, '02-ent-new-s1', { tall: 1700, crop: [m.locator('.modal-header'), f('Category')], margin: 26, marks: [{ at: f('Parent Group'), n: 1, pos: 'l' }, { at: f('Entity Type'), n: 2, pos: 'l' }, { at: f('Name'), n: 3, pos: 'l' }, { at: f('Category'), n: 4, pos: 'l' }] });
const vals = { 'PAN No': 'AAHCH4321K', 'GST No': '02AAHCH4321K1Z7', 'TAN No': 'PTLH01234E', 'CIN': 'U40108HP2019PTC007788', 'Corporate Email': 'accounts@himalayawind.in', 'Corporate Phone': '9816012345', 'Corporate Website': 'www.himalayawind.in', 'Address': 'Mall Road, Shimla, Himachal Pradesh 171001', 'Credit Rating': 'A+', 'Authorised Signatory Name': 'Anil Thakur', 'Signatory Designation': 'DGM (Finance)', 'Commercial Contact Name': 'Ritu Verma', 'Commercial Contact Email': 'billing@himalayawind.in', 'Commercial Contact Phone': '9816054321', 'Technology': 'Wind', 'Capacity (MW)': '50', 'Bank Name': 'State Bank of India', 'Account No': '30214567890', 'IFSC Code': 'SBIN0001234', 'Branch Address': 'The Mall, Shimla' };
for (const [k, v] of Object.entries(vals)) await f(k).fill(v);
await shot(page, '02-ent-new-s2', { tall: 1700, crop: [f('PAN No'), f('Commercial Contact Phone'), f('GST No')], margin: 40, marks: [{ at: f('PAN No'), n: 1, pos: 'tl' }, { at: f('GST No'), n: 2, pos: 'tl' }, { at: f('Corporate Email'), n: 3, pos: 'tl' }, { at: f('Authorised Signatory Name'), n: 4, pos: 'tl' }, { at: f('Commercial Contact Name'), n: 5, pos: 'tl' }] });
await shot(page, '02-ent-new-s3', { tall: 1700, crop: [f('Technology'), f('Branch Address'), f('Capacity (MW)')], margin: 40, marks: [{ at: f('Technology'), n: 1, pos: 'tl' }, { at: f('Capacity (MW)'), n: 2, pos: 'tl' }, { at: f('Bank Name'), n: 3, pos: 'tl' }, { at: f('Account No'), n: 4, pos: 'tl' }, { at: f('IFSC Code'), n: 5, pos: 'tl' }] });
const save = m.getByRole('button', { name: 'Save & Proceed to Documents' });
await shot(page, '02-ent-new-s4', { tall: 1700, crop: [m.getByText('4. Regulatory Approvals Checklist'), save, m.locator('input[type=checkbox]').first()], margin: 30, marks: [{ at: m.locator('input[type=checkbox]').first().locator('xpath=ancestor::label[1]'), n: 1, pos: 'r' }, { at: save, n: 2, pos: 't' }] });
await save.click(); await settle(page, 1200);
await dumpTo(page, '02-after-save', '.modal');
await shot(page, '02-ent-after-save', { tall: 1500 });
// ── the working file that opens after saving ──
const wf = page.locator('.modal').first();
const top = () => page.locator('.modal').last();
await shot(page, '02-wf-top', { crop: wf, margin: 16, marks: [{ at: wf.getByRole('button', { name: /Verify Penny Drop/ }), n: 1, pos: 'r' }, { at: wf.getByText('PENDING').first(), n: 2, pos: 'r' }, { at: wf.getByText('0/8 Mandatory Verified').first(), n: 3, pos: 'r' }] });
await soft('penny', async () => { await wf.getByRole('button', { name: /Verify Penny Drop/ }).click(); await settle(page, 900); await shot(page, '02-wf-penny-done', { crop: [wf.getByText('Bank & Technical'), wf.getByText('Regulatory Approvals').first()], margin: 20, marks: [{ at: wf.getByText('Verified', { exact: true }).first(), n: 1, pos: 'r' }] }); });
const regHead = wf.getByText('Regulatory Approvals', { exact: true }).first();
await regHead.scrollIntoViewIfNeeded();
await shot(page, '02-wf-reg-list', { tall: 1500, crop: [regHead, wf.getByText('Contacts', { exact: true })], margin: 16, marks: [{ at: wf.getByText('Upload', { exact: true }).first(), n: 1, pos: 'b' }, { at: wf.getByRole('button', { name: 'Update' }).first(), n: 2, pos: 'l' }, { at: wf.getByText('Not Started').first(), n: 3, pos: 't' }] });
await soft('proof-upload', async () => {
  await wf.getByText('Upload', { exact: true }).first().click(); await settle(page, 500);
  const u = top();
  await u.locator('input[type=file]').setInputFiles(pdf);
  await field(u, 'Valid until').fill('2031-03-31');
  const auto = u.locator('input[type=checkbox]');
  await shot(page, '02-wf-proof-upload', { crop: u, margin: 24, marks: [{ at: u.locator('input[type=file]'), n: 1, pos: 'l' }, { at: field(u, 'Valid until'), n: 2, pos: 'l' }, { at: field(u, 'Title'), n: 3, pos: 'l' }, { at: auto, n: 4, pos: 'l' }, { at: u.getByRole('button', { name: 'Upload', exact: true }), n: 5, pos: 'b' }] });
  if (await auto.isChecked()) await auto.uncheck();
  await u.getByRole('button', { name: 'Upload', exact: true }).click(); await settle(page, 1200);
});
await regHead.scrollIntoViewIfNeeded();
await shot(page, '02-wf-reg-after-upload', { tall: 1500, crop: [regHead, wf.getByText('Generation License / CEA Registration')], margin: 16 });
await soft('reg-update', async () => {
  await wf.getByRole('button', { name: 'Update' }).first().click(); await settle(page, 400);
  const u = top();
  await field(u, 'Status').selectOption({ label: 'Verified' });
  await field(u, 'Reference').fill('U40108HP2019PTC007788');
  await field(u, 'Issued By').fill('Registrar of Companies, HP');
  await field(u, 'Issued On').fill('2019-06-14');
  await field(u, 'Notes').fill('Checked against MCA portal');
  await shot(page, '02-wf-reg-update', { crop: u, margin: 24, marks: [{ at: field(u, 'Status'), n: 1, pos: 'l' }, { at: field(u, 'Reference'), n: 2, pos: 'l' }, { at: field(u, 'Issued By'), n: 3, pos: 'r' }, { at: field(u, 'Issued On'), n: 4, pos: 'l' }, { at: field(u, 'Valid Until'), n: 5, pos: 'r' }, { at: u.getByRole('button', { name: 'Save' }), n: 6, pos: 'b' }] });
  await u.getByRole('button', { name: 'Save' }).click(); await settle(page, 900);
  await dumpTo(page, '02-after-reg-save', 'top');
});
await regHead.scrollIntoViewIfNeeded();
await shot(page, '02-wf-reg-verified', { tall: 1500, crop: [regHead, wf.getByText('Generation License / CEA Registration')], margin: 16, marks: [{ at: wf.getByText('Verified', { exact: true }).nth(1), n: 1, pos: 't' }] });
// lower half: contacts, letterhead, signature, documents, decision
const docsHead = wf.getByText('Stakeholder Documents', { exact: false }).first();
await shot(page, '02-wf-letterhead', { tall: 2600, widthOf: wf, margin: 6, crop: [wf.getByText('Contacts', { exact: true }), wf.getByRole('button', { name: 'Save' }).first()], margin: 20, marks: [{ at: wf.getByText('Upload Logo'), n: 1, pos: 'r' }, { at: wf.getByText('Upload Signature'), n: 2, pos: 'r' }, { at: wf.getByRole('button', { name: 'Save' }).first(), n: 3, pos: 'r' }] });
const approve = wf.getByRole('button', { name: 'Standard Approval' });
await shot(page, '02-wf-decision', { tall: 2600, widthOf: wf, margin: 6, crop: [docsHead, approve, wf.getByRole('button', { name: 'Reject' }), wf.getByRole('button', { name: 'Direct Admit & Activate Stakeholder' })], margin: 24, marks: [{ at: wf.getByRole('button', { name: 'Upload Document' }), n: 1, pos: 'l' }, { at: wf.getByRole('button', { name: 'Direct Admit & Activate Stakeholder' }), n: 2, pos: 't' }, { at: approve, n: 3, pos: 't' }, { at: field(wf, 'Remarks'), n: 4, pos: 't' }, { at: wf.getByRole('button', { name: 'Reject' }), n: 5, pos: 't' }] });
await soft('approve-refused', async () => {
  await approve.click(); await settle(page, 900);
  await shot(page, '02-wf-approve-refused', { tall: 2600, widthOf: wf, margin: 6, crop: [wf.getByText('Approval Action'), approve], marks: [{ at: wf.getByText(/^Cannot approve/), n: 1, pos: 'tl' }] });
});
await soft('direct-admit', async () => {
  await wf.getByRole('button', { name: 'Direct Admit & Activate Stakeholder' }).click(); await settle(page, 1200);
  const row = page.locator('main tr', { hasText: 'Himalaya Wind Energy' }).first();
  await shot(page, '02-ent-approved', { crop: [page.locator('main h1, main h2').first(), row], widthOf: 'main', margin: 16, marks: [{ at: row.getByText('APPROVED'), n: 1, pos: 't' }, { at: row.getByText('8/8 Mandatory Verified'), n: 2, pos: 't' }] });
});
await browser.close();
