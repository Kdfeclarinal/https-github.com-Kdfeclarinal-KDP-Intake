// Local verification harness — NOT part of the app. Mocks the protected read
// with a fake token/response; never uses a real scoped token.
const { chromium } = require('playwright');

const BASE = `http://127.0.0.1:${process.env.KDP_VERIFY_PORT || '8139'}`;

// A plausible successful loadEmployeePage response (read-only, no secrets).
const MOCK_OK = {
  ok: true,
  book: {
    book_title: '',
    overall_status: 'draft',
    current_employee_step: 'details',
    kdp_language: 'en',
    primary_marketplace: 'amazon.com',
  },
  step_name: 'details',
};

async function attachMock(page) {
  await page.route('**/functions/v1/exchangeEmployeeAccess', (route) => {
    const parsed = JSON.parse(route.request().postData() || '{}');
    return route.fulfill({
      status: parsed.book_id && parsed.access_token ? 200 : 400,
      contentType: 'application/json',
      body: JSON.stringify(parsed.book_id && parsed.access_token
        ? { ok: true, book_id: parsed.book_id, session_token: 'kdp_es_local_session', expires_at: '2099-01-01T00:00:00Z' }
        : { ok: false }),
    });
  });
  return page.route('**/functions/v1/loadEmployeePage', (route) => {
    const req = route.request();
    const body = req.postData();
    // Only succeed when a token + book_id were supplied (mimics backend gating).
    let parsed = {};
    try { parsed = JSON.parse(body || '{}'); } catch (e) {}
    if (parsed.access_token && parsed.book_id) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_OK) });
    }
    return route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ ok: false }) });
  });
}

(async () => {
  const results = [];
  const ok = (name, cond, extra) => results.push({ name, pass: !!cond, extra: extra || '' });

  const browser = await chromium.launch();

  // ---- 1. Desktop 1280 with token ----
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push('PAGEERROR: ' + e.message));

  await attachMock(page);
  await page.goto(BASE + '/?book_id=book1&access_token=faketoken-local-only', { waitUntil: 'networkidle' });

  // wait for form
  await page.waitForSelector('.kdp-form', { timeout: 5000 });

  ok('employee launcher credential is removed from visible URL after exchange', !new URL(page.url()).searchParams.has('access_token'));
  ok('short-lived employee session is kept only in tab session storage', await page.evaluate(() => sessionStorage.getItem('kdp:employee-session:book1') === 'kdp_es_local_session'));
  ok('complete Details page renders (form present)', await page.locator('.kdp-form').count() === 1);
  ok('exactly one React root (#kdp-intake-app)', await page.evaluate(() => document.querySelectorAll('#kdp-intake-app').length === 1));
  ok('workflow header has Details/Content/Pricing',
    (await page.locator('.kdp-progress-title', { hasText: 'Details' }).count()) === 1 &&
    (await page.locator('.kdp-progress-title', { hasText: 'Content' }).count()) === 1 &&
    (await page.locator('.kdp-progress-title', { hasText: 'Pricing' }).count()) === 1);
  ok('Details step active', await page.locator('.kdp-progress-item[data-active="true"] .kdp-progress-title').innerText() === 'Kindle eBook Details');
  ok('Content step locked', await page.locator('.kdp-progress-item.is-locked .kdp-progress-title').first().innerText() === 'Kindle eBook Content');
  ok('Pricing step locked', (await page.locator('.kdp-progress-item.is-locked').count()) === 2);

  // Language
  ok('Language select present + English default', (await page.locator('#kdp-language').inputValue()) === 'en');
  // Book title + subtitle
  ok('Book Title input present', await page.locator('#kdp-title').count() === 1);
  ok('Subtitle input present', await page.locator('#kdp-subtitle').count() === 1);
  // Series UI
  ok('Series "Add to series" button present', (await page.getByRole('button', { name: 'Add to series' }).count()) === 1);
  // Edition
  ok('Edition Number input present', await page.locator('#kdp-edition').count() === 1);
  // Primary author separate
  ok('Primary Author first + last present', (await page.locator('#kdp-author-first').count()) === 1 && (await page.locator('#kdp-author-last').count()) === 1);
  // Contributors add/remove
  ok('Contributors "Add Another" present', (await page.getByRole('button', { name: 'Add Another' }).count()) === 1);
  ok('Contributor editor starts with one row', (await page.locator('.kdp-contrib-row').count()) === 1);
  await page.getByRole('button', { name: 'Add Another' }).click();
  ok('Contributor row added', (await page.locator('.kdp-contrib-row').count()) === 2);
  await page.locator('.kdp-contrib-row .kdp-btn--remove', { hasText: 'Remove' }).first().click();
  ok('Contributor row removed while one editable row remains', (await page.locator('.kdp-contrib-row').count()) === 1);
  // Description + 4000 count
  ok('Description textarea present', await page.locator('#kdp-description').count() === 1);
  await page.locator('#kdp-description').fill('Hello world description');
  const countText = await page.locator('.kdp-count').innerText();
  ok('Description char count updates', countText.includes('3977'), countText);
  await page.locator('#kdp-description').fill('x'.repeat(4001));
  ok('Description maxlength enforced (<=4000)', (await page.locator('#kdp-description').textContent()).length === 4000);
  await page.locator('#kdp-description').fill('');
  // Publishing rights radios
  const rights = await page.locator('input[name="publishingRights"]').count();
  ok('Publishing Rights has 2 radios', rights === 2);
  await page.locator('input[name="publishingRights"]').first().check();
  ok('Publishing Rights radio toggles', await page.locator('input[name="publishingRights"]').first().isChecked());
  // Adult-only
  const adult = await page.locator('input[name="adultOnly"]').count();
  ok('Adult-only Yes/No radios present', adult === 2);
  await page.locator('input[name="adultOnly"]').nth(1).check(); // No
  // Reading age
  ok('Reading Age min/max present', (await page.locator('#kdp-age-min').count()) === 1 && (await page.locator('#kdp-age-max').count()) === 1);
  // Marketplace
  ok('Marketplace select present + amazon.com default', (await page.locator('#kdp-marketplace').inputValue()) === 'amazon.com');
  // Keywords exactly 7
  const kw = await page.locator('[id^="kdp-keyword-"]').count();
  ok('Exactly 7 keyword inputs', kw === 7, 'count=' + kw);
  // Pre-order reveals date
  ok('Pre-order radio count 2', (await page.locator('input[name="publishOption"]').count()) === 2);
  await page.locator('input[name="publishOption"]').nth(1).check(); // preorder
  ok('Pre-order date revealed when Pre-order selected', (await page.locator('#kdp-preorder-date').count()) === 1);
  await page.locator('input[name="publishOption"]').nth(0).check(); // release now
  ok('Pre-order date collapses when Release now', await page.locator('.kdp-preorder-extra').evaluate((el) => !el.classList.contains('is-open')));
  // Save actions remain available while no save request is in flight.
  ok('Save as Draft present', (await page.getByRole('button', { name: 'Save as Draft' }).count()) === 1);
  ok('Save and Continue present', (await page.getByRole('button', { name: 'Save and Continue' }).count()) === 1);
  ok('Save actions enabled when idle', !(await page.getByRole('button', { name: 'Save and Continue' }).isDisabled()));

  // With marketplace and audience answered, the authoritative taxonomy chooser opens.
  await page.getByRole('button', { name: 'Choose categories' }).click();
  ok('Category taxonomy chooser opens', (await page.getByRole('dialog', { name: 'Categories' }).count()) === 1);
  ok('Category taxonomy chooser exposes placement controls',
    (await page.locator('.kdp-cat-block').count()) === 1 &&
    (await page.getByRole('button', { name: 'Save categories' }).count()) === 1);
  await page.getByRole('button', { name: 'Cancel' }).click();

  // CSS leak check: native GHL body should NOT be styled by our rules
  ok('CSS scoped (body has no kdp class)', await page.evaluate(() => !document.body.className.includes('kdp-')));

  // Verify incomplete completion is rejected before saveEmployeeStep is called.
  const saveCalls = [];
  page.on('request', (r) => { if (r.url().includes('saveEmployeeStep')) saveCalls.push(r.url()); });
  await page.getByRole('button', { name: 'Save and Continue' }).click();
  ok('Incomplete Details completion stays client-gated', saveCalls.length === 0, 'calls=' + saveCalls.length);

  await ctx.close();

  // ---- 2. Mobile 375 ----
  const mctx = await browser.newContext({ viewport: { width: 375, height: 800 } });
  const mpage = await mctx.newPage();
  mpage.on('pageerror', (e) => consoleErrors.push('MOBILE PAGEERROR: ' + e.message));
  await attachMock(mpage);
  await mpage.goto(BASE + '/?book_id=book1&access_token=faketoken-local-only', { waitUntil: 'networkidle' });
  await mpage.waitForSelector('.kdp-form', { timeout: 5000 });
  // no horizontal scroll
  const overflow = await mpage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  ok('Mobile: no horizontal overflow', overflow);
  ok('Mobile: keyword grid one column', await mpage.evaluate(() => {
    const g = document.querySelector('.kdp-keyword-grid');
    return getComputedStyle(g).gridTemplateColumns.split(' ').length === 1;
  }));
  ok('Mobile: section grid stacks to one column', await mpage.evaluate(() => {
    const s = document.querySelector('.kdp-section');
    return getComputedStyle(s).gridTemplateColumns.split(' ').length === 1;
  }));
  await mctx.close();

  // ---- 3. Missing token state ----
  const nctx = await browser.newContext();
  const npage = await nctx.newPage();
  const missingCalls = [];
  npage.on('request', (r) => { if (r.url().includes('loadEmployeePage')) missingCalls.push(r.url()); });
  // Do NOT mock -> default behavior: missing token short-circuits client-side before fetch
  await npage.goto(BASE + '/?book_id=book1', { waitUntil: 'networkidle' });
  ok('Missing token shows safe state (no protected read)', (await npage.locator('.kdp-msg--missing').count()) === 1);
  ok('Missing token: no loadEmployeePage fetch performed', missingCalls.length === 0, 'calls=' + missingCalls.length);
  await nctx.close();

  // ---- 4. Repeated hydrationDone (idempotency) ----
  const hctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const hpage = await hctx.newPage();
  let readCount = 0;
  hpage.on('request', (r) => { if (r.url().includes('loadEmployeePage')) readCount++; });
  await attachMock(hpage);
  await hpage.goto(BASE + '/?book_id=book1&access_token=faketoken-local-only', { waitUntil: 'networkidle' });
  await hpage.waitForSelector('.kdp-form', { timeout: 5000 });
  // fire hydrationDone repeatedly
  for (let i = 0; i < 5; i++) {
    await hpage.evaluate(() => window.dispatchEvent(new Event('hydrationDone')));
  }
  await hpage.waitForTimeout(300);
  const roots = await hpage.evaluate(() => document.querySelectorAll('#kdp-intake-app > *').length);
  ok('Repeated hydrationDone: still one React root child', roots === 1, 'children=' + roots);
  ok('Repeated hydrationDone: read not duplicated (1 call)', readCount === 1, 'calls=' + readCount);
  await hctx.close();

  await browser.close();

  // saveEmployeeStep network assertion across all contexts
  ok('Invalid completion never calls saveEmployeeStep', saveCalls.length === 0, 'calls=' + saveCalls.length);
  ok('No console/page errors', consoleErrors.length === 0, consoleErrors.join(' | '));

  // Report
  let pass = 0, fail = 0;
  for (const r of results) {
    const tag = r.pass ? 'PASS' : 'FAIL';
    console.log(`[${tag}] ${r.name}${r.extra ? ' :: ' + r.extra : ''}`);
    r.pass ? pass++ : fail++;
  }
  console.log(`\nSUMMARY: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(2); });
