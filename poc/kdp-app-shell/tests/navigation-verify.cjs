const { chromium } = require('playwright');
const BASE = `http://127.0.0.1:${process.env.KDP_VERIFY_PORT || '8139'}`;
let passed = 0; let failed = 0;
const check = (ok, label) => { if (ok) { passed++; console.log(`PASS ${label}`); } else { failed++; console.log(`FAIL ${label}`); } };
const unlocked = { activeStep: 'pricing', steps: { details: { status: 'complete', isUnlocked: true, isComplete: true }, content: { status: 'complete', isUnlocked: true, isComplete: true }, pricing: { status: 'in_progress', isUnlocked: true, isComplete: false } } };
const completedContent = { sections: { manuscript: { value: { uploaded: true, drm: 'yes' } }, cover: { value: { option: 'upload', uploaded: true } }, ai_content: { value: 'no' }, accessibility: { value: 'not_sure' }, isbn: { value: { isbn: '', publisher: '' } } } };
function pagePayload(step, contentState = completedContent) { return { ok: true, book: { book_title: 'Navigation Test', primary_marketplace: 'amazon.com' }, step_name: step, step_data: { step_name: step, state_json: step === 'content' ? contentState : null }, progress_state: unlocked, files: [{ file_type: 'manuscript', section_key: 'content.manuscript', is_latest: true, file_size: 1048576 }, { file_type: 'cover', section_key: 'content.cover', is_latest: true }] }; }

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 1100, height: 850 } });
  const saves = [];
  async function wire(page, contentState = completedContent) {
    await page.route('**/functions/v1/loadEmployeePage', (route) => { const body = JSON.parse(route.request().postData() || '{}'); route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(pagePayload(body.step_name, contentState)) }); });
    await page.route('**/functions/v1/loadPricingFxRates', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ ok: false }) }));
    await page.route('**/functions/v1/saveEmployeeStep', (route) => { const body = JSON.parse(route.request().postData() || '{}'); saves.push(body); route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data_valid: true, progress_state: unlocked }) }); });
  }

  for (const [from, targetSelector, targetStep] of [
    ['details', '.kdp-app--content', 'content'],
    ['content', '.kdp-app:not(.kdp-app--content):not(.kdp-app--pricing)', 'details'],
    ['pricing', '.kdp-app--content', 'content'],
  ]) {
    const clean = await context.newPage(); await wire(clean);
    await clean.goto(`${BASE}/?book_id=b&access_token=t&step=${from}`);
    await clean.waitForSelector(from === 'pricing' ? '.kdp-app--pricing' : from === 'content' ? '.kdp-app--content' : '.kdp-app:not(.kdp-app--content):not(.kdp-app--pricing)');
    const saveCount = saves.length;
    await clean.locator(`.kdp-progress-item[data-step="${targetStep}"]`).click();
    await clean.waitForSelector(targetSelector);
    check(await clean.evaluate((expected) => new URL(location.href).searchParams.get('step') === expected, targetStep), `clean ${from} navigation updates the employee deep link`);
    check(await clean.getByRole('dialog', { name: 'You have unsaved changes' }).count() === 0, `clean ${from} navigation does not open modal`);
    check(saves.length === saveCount, `clean ${from} navigation does not save`);
    await clean.close();
  }

  const details = await context.newPage(); await wire(details);
  await details.goto(`${BASE}/?book_id=b&access_token=t&step=details`); await details.waitForSelector('.kdp-app:not(.kdp-app--content):not(.kdp-app--pricing)');
  await details.locator('#kdp-title').fill('Changed title'); await details.locator('.kdp-progress-item[data-step="content"]').click();
  check(await details.getByRole('dialog', { name: 'You have unsaved changes' }).count() === 1, 'dirty Details navigation opens shared modal');
  check(await details.getByRole('dialog').getByRole('button', { name: 'Save Changes' }).evaluate((button) => button === document.activeElement), 'dirty modal moves focus inside');
  await details.keyboard.press('Escape'); check(await details.locator('#kdp-title').inputValue() === 'Changed title', 'Escape closes modal and preserves Details edits');

  const content = await context.newPage(); await wire(content);
  await content.goto(`${BASE}/?book_id=b&access_token=t&step=content`); await content.waitForSelector('.kdp-app--content');
  await content.locator('input[name="drmChoice"][value="no"]').check(); await content.locator('.kdp-progress-item[data-step="details"]').click();
  check(await content.getByRole('dialog', { name: 'You have unsaved changes' }).count() === 1, 'dirty Content navigation opens shared modal');
  await content.getByRole('dialog', { name: 'You have unsaved changes' }).getByRole('button', { name: 'Save Changes' }).click(); await content.waitForSelector('#kdp-title');
  check(await content.evaluate(() => new URL(location.href).searchParams.get('step') === 'details'), 'dirty navigation updates the employee deep link after save');
  check(saves.some((save) => save.step_name === 'content' && save.save_type === 'draft' && save.next_step_name === null), 'cross-step save safely persists Content as draft');

  const complete = await context.newPage(); await wire(complete);
  await complete.goto(`${BASE}/?book_id=b&access_token=t&step=content`); await complete.waitForSelector('.kdp-app--content');
  await complete.getByRole('button', { name: 'Save and Continue' }).click();
  await complete.locator('.kdp-save-overlay__label', { hasText: 'Saving…' }).waitFor();
  await complete.waitForSelector('.kdp-app--pricing', { timeout: 3000 });
  check(await complete.evaluate(() => new URL(location.href).searchParams.get('step') === 'pricing'), 'authoritative Content continuation updates the employee deep link');
  check(true, 'Content authoritatively complete and Pricing unlocked auto-navigates after Done');

  await browser.close(); console.log(`RESULT ${passed}/${passed + failed}`); process.exit(failed ? 1 : 0);
})().catch((error) => { console.error(error); process.exit(2); });
