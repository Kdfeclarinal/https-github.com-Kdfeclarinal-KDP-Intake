const { chromium } = require('playwright');
const BASE = `http://127.0.0.1:${process.env.KDP_VERIFY_PORT || '8139'}`;
let passed = 0; let failed = 0;
function check(condition, label) { if (condition) { passed++; console.log(`PASS ${label}`); } else { failed++; console.log(`FAIL ${label}`); } }
const progress = { activeStep: 'pricing', steps: { details: { status: 'complete', isUnlocked: true, isComplete: true }, content: { status: 'complete', isUnlocked: true, isComplete: true }, pricing: { status: 'in_progress', isUnlocked: true, isComplete: false } } };
function payload(step = 'pricing', stateJson = null) { return { ok: true, book: { book_title: 'Pricing Contract Test', primary_marketplace: 'amazon.com', overall_status: 'draft', current_employee_step: 'pricing' }, step_name: step, step_data: { step_name: step, state_json: stateJson }, progress_state: progress, files: [{ file_type: 'manuscript', section_key: 'content.manuscript', file_size: 5242880 }] }; }
const fx = { ok: true, base: 'USD', source: 'Frankfurter / ECB reference rates', asOf: '2026-09-08', rates: { USD: 1, AUD: 1.5, BRL: 5.4, CAD: 1.35, EUR: .9, GBP: .8, INR: 84, JPY: 150, MXN: 19 } };

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const page = await context.newPage(); const saves = []; const submissions = [];
  await page.route('**/functions/v1/exchangeEmployeeAccess', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, book_id: 'fake-b', session_token: 'kdp_es_pricing', expires_at: '2099-01-01T00:00:00Z' }) }));
  await page.route('**/functions/v1/loadEmployeePage', (route) => { const request = JSON.parse(route.request().postData() || '{}'); route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload(request.step_name)) }); });
  await page.route('**/functions/v1/loadPricingFxRates', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fx) }));
  await page.route('**/functions/v1/saveEmployeeStep', (route) => { const request = JSON.parse(route.request().postData() || '{}'); saves.push(request); route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, employee_revision: request.expected_revision + 1, data_valid: request.save_type === 'complete', progress_state: request.save_type === 'complete' ? { ...progress, steps: { ...progress.steps, pricing: { status: 'complete', isUnlocked: true, isComplete: true } } } : progress }) }); });
  await page.route('**/functions/v1/submitBookForApproval', (route) => { submissions.push(JSON.parse(route.request().postData() || '{}')); route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, review_round_id: 'round-1', round_number: 1, overall_status: 'AWAITING_REVIEW', basecamp: { status: 'ready' } }) }); });
  await page.goto(`${BASE}/?book_id=fake-b&access_token=fake-t&step=pricing`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.kdp-app--pricing'); await page.getByText(/Converted prices are estimates/).waitFor();
  check(await page.locator('.kdp-section').count() === 5, 'five Pricing sections render');
  const territoryMotion = await page.locator('.kdp-territory-expand').evaluate((node) => ({ duration: getComputedStyle(node).transitionDuration, timing: getComputedStyle(node).transitionTimingFunction }));
  check(territoryMotion.duration === '0.3s, 0.2s' && territoryMotion.timing.includes('cubic-bezier(0.42, 0, 0.58, 1)'), 'Territories uses approved shared motion');
  check(await page.getByText('Reach more readers. Maximize your sales potential.', { exact: true }).count() === 1, 'approved KDP Select heading copy renders');
  check(await page.getByText(/KDP Select is a free, 90-day program offered to Kindle eBooks/).count() === 1, 'approved KDP Select explanatory copy renders');
  check(await page.getByRole('link', { name: 'Kindle Storyteller' }).getAttribute('href') === 'https://www.amazon.co.uk/b?node=12061299031', 'Kindle Storyteller uses approved URL');
  check(await page.getByRole('link', { name: 'Which territory option should I pick?' }).getAttribute('href') === 'https://kdp.amazon.com/en_US/help/topic/A1H1OSSLAY4B4F', 'territory help uses approved URL');
  check(await page.getByRole('link', { name: 'How does pricing and royalties work?' }).getAttribute('href') === 'https://kdp.amazon.com/en_US/help/topic/G200641280', 'royalty help uses approved URL');
  check(await page.getByText(/By submitting for approval, I confirm that I agree/).count() === 1, 'approved Terms and Conditions copy renders');
  check(await page.getByRole('link', { name: 'KDP Terms and Conditions' }).getAttribute('href') === 'https://kdp.amazon.com/terms-and-conditions', 'Terms use approved URL');
  check(Number(await page.locator('.kdp-terms-confirmation').evaluate((node) => getComputedStyle(node).fontWeight)) >= 700, 'entire confirmation paragraph is bold');
  check(await page.getByText(/Without KDP Select, eligible sales/).count() === 0, 'persistent KDP Select table footnote is removed');
  check(await page.locator('.kdp-price-row').count() === 13, 'all 13 marketplaces render');
  check(await page.locator('.kdp-progress-item[data-step="pricing"][data-active="true"] .kdp-icon circle[fill="#007eb9"]').count() === 1, 'Pricing in progress uses info icon');
  check(await page.locator('.kdp-progress-item[data-step="details"] .kdp-icon circle[fill="#007600"]').count() === 1, 'completed step keeps check icon away from its page');
  check(await page.locator('.kdp-primary-marketplace').isDisabled(), 'primary marketplace is Details-derived and read-only');
  check((await page.locator('.kdp-primary-marketplace').inputValue()) === 'amazon.com', 'primary marketplace value is inherited');
  const fileSizeText = await page.locator('.kdp-file-size').textContent();
  check(fileSizeText.includes('not available'), `raw upload bytes are not presented as converted delivery size (${fileSizeText})`);
  check(!(await page.getByRole('button', { name: 'Submit for Approval' }).isDisabled()), 'Submit for Approval is enabled by the real server contract');
  check(await page.getByRole('button', { name: 'Save and Continue' }).count() === 0, 'no misleading Pricing completion action renders');

  await page.locator('input[name="territories"]').nth(1).check();
  await page.locator('.kdp-territory-expand.is-open').waitFor();
  check(await page.locator('.kdp-territory-grid input').count() === 245, '245 project territories render');
  await page.getByRole('button', { name: 'All', exact: true }).click();
  check((await page.locator('.kdp-territory-summary strong').textContent()).includes('245 of 245'), 'Select All and derived total work');
  await page.getByRole('button', { name: 'None', exact: true }).click();
  check((await page.locator('.kdp-territory-summary strong').textContent()).includes('0 of 245'), 'Select None works');

  await page.locator('input[name="royaltyPlan"]').nth(0).check();
  await page.locator('[id="price-amazon.com"]').fill('25');
  check(await page.locator('[id="price-amazon.ca"]').inputValue() === '33.75', 'blank-page FX propagation populates non-primary prices');
  check((await page.locator('.kdp-price-row.is-primary [data-label="Rate"]').textContent()).includes('35%'), '35% rate renders');
  check((await page.locator('.kdp-price-row.is-primary [data-label="Estimated royalty"]').textContent()).includes('$8.75'), '35% estimated royalty renders');
  await page.locator('[id="price-amazon.co.uk"]').fill('8.25');
  await page.locator('[id="price-amazon.com"]').fill('24');
  check(await page.locator('[id="price-amazon.co.uk"]').inputValue() === '8.25', 'manual override survives later primary edits');
  await page.locator('[id="price-amazon.com"]').fill('25');
  await page.locator('input[name="royaltyPlan"]').nth(1).check();
  check((await page.locator('.kdp-price-guidance').textContent()).includes('$12.99'), '70% range is shown');
  check(await page.locator('[id="price-amazon.com"]').inputValue() === '25', '35 to 70 preserves an invalid primary price');
  check((await page.locator('#price-error-amazon\\.com').textContent()) === 'Set a list price between $2.99–$12.99.', '70% above-maximum validation is exact');
  await page.locator('[id="price-amazon.com"]').fill('2');
  check((await page.locator('#price-error-amazon\\.com').textContent()) === 'Set a list price between $2.99–$12.99.', '70% below-minimum validation is exact');
  await page.locator('[id="price-amazon.com"]').fill('9');
  check(await page.locator('#price-error-amazon\\.com').count() === 0, 'valid 70% primary price clears validation');
  check(await page.locator('[id="price-amazon.co.uk"]').inputValue() === '8.25', 'manual override survives royalty-plan recalculation');

  await page.getByRole('button', { name: 'Save as Draft' }).click(); await page.waitForTimeout(100);
  check(saves[0].save_type === 'draft', 'Pricing Save as Draft uses v14 envelope');
  check(saves[0].state_json.sections.territories.selectedTerritories.length === 0, 'draft preserves zero selected territories');
  check(saves[0].state_json.sections.royalty_and_pricing.marketplaces.find((row) => row.id === 'amazon.co.uk').manualOverride === true, 'draft persists manual overrides');
  check(!JSON.stringify(saves[0].state_json).includes('Terms and Conditions'), 'informational Terms copy is not persisted in Pricing state');
  await page.waitForTimeout(700);

  await page.locator('input[name="territories"]').nth(0).check();
  await page.getByRole('button', { name: 'Submit for Approval' }).dblclick();
  await page.getByText('Submitted for approval.').waitFor();
  check(saves.at(-1).save_type === 'complete', 'Submit first requests authoritative complete Pricing save');
  check(submissions.length === 1, 'double click creates one submission request');
  check(Object.keys(submissions[0]).sort().join(',') === 'access_token,book_id,expected_revision', 'submission sends only book identity, opaque token, and authoritative revision');

  check(await page.getByRole('button', { name: '< Back to Content' }).isDisabled(), 'authoritative submission locks post-submit Pricing navigation');

  const failureContext = await browser.newContext({ viewport: { width: 900, height: 800 } });
  const failurePage = await failureContext.newPage();
  await failurePage.route('**/functions/v1/exchangeEmployeeAccess', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, book_id: 'fake-b', session_token: 'kdp_es_pricing_failure', expires_at: '2099-01-01T00:00:00Z' }) }));
  await failurePage.route('**/functions/v1/loadEmployeePage', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload()) }));
  await failurePage.route('**/functions/v1/loadPricingFxRates', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ ok: false }) }));
  await failurePage.goto(`${BASE}/?book_id=fake-b&access_token=fake-t&step=pricing`);
  await failurePage.getByText('Currency estimates are temporarily unavailable.').waitFor();
  check(await failurePage.getByText('Estimated currency rates are unavailable. Enter marketplace prices manually or try again later.').count() === 0, 'persistent verbose FX failure paragraph is removed');
  check(await failurePage.locator('[id="price-amazon.ca"]').inputValue() === '', 'FX failure is safe and does not fabricate prices');
  await failureContext.close();

  const reducedContext = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  const reducedPage = await reducedContext.newPage();
  await reducedPage.route('**/functions/v1/exchangeEmployeeAccess', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, book_id: 'fake-b', session_token: 'kdp_es_pricing_reduced', expires_at: '2099-01-01T00:00:00Z' }) }));
  await reducedPage.route('**/functions/v1/loadEmployeePage', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload()) }));
  await reducedPage.route('**/functions/v1/loadPricingFxRates', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fx) }));
  await reducedPage.goto(`${BASE}/?book_id=fake-b&access_token=fake-t&step=pricing`); await reducedPage.waitForSelector('.kdp-app--pricing');
  check(await reducedPage.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), 'mobile Pricing has no page-level horizontal overflow');
  check(await reducedPage.locator('.kdp-territory-expand').evaluate((node) => getComputedStyle(node).transitionDuration) === '0s', 'territory animation respects reduced motion');
  await reducedContext.close();

  await context.close(); await browser.close();
  console.log(`RESULT ${passed}/${passed + failed}`); process.exit(failed ? 1 : 0);
})().catch((error) => { console.error(error); process.exit(2); });
