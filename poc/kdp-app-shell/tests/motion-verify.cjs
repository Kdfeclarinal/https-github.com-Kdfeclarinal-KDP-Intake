const { chromium } = require('playwright');

const BASE = `http://127.0.0.1:${process.env.KDP_VERIFY_PORT || '8139'}`;
let passed = 0;
let failed = 0;
const check = (condition, label) => {
  if (condition) { passed += 1; console.log(`PASS ${label}`); }
  else { failed += 1; console.log(`FAIL ${label}`); }
};

const progress = {
  activeStep: 'content',
  steps: {
    details: { status: 'complete', isUnlocked: true, isComplete: true },
    content: { status: 'in_progress', isUnlocked: true, isComplete: false },
    pricing: { status: 'locked', isUnlocked: false, isComplete: false },
  },
};
const contentState = { sections: { cover: { value: { option: null, uploaded: false } } } };

function payload(step) {
  return {
    ok: true,
    book: { book_title: 'Motion Test', primary_marketplace: 'amazon.com', overall_status: 'draft', current_employee_step: 'content' },
    step_name: step,
    step_data: { step_name: step, state_json: step === 'content' ? contentState : null },
    progress_state: progress,
    files: [],
  };
}

async function wire(page) {
  await page.route('**/functions/v1/loadEmployeePage', (route) => {
    const request = JSON.parse(route.request().postData() || '{}');
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload(request.step_name)) });
  });
}

async function verifyExpansion(page, step, selector, trigger, label) {
  await page.goto(`${BASE}/?book_id=b&access_token=t&step=${step}`);
  await page.waitForSelector(selector, { state: 'attached' });
  const panel = page.locator(selector);
  check(await panel.evaluate((node) => node.classList.contains('kdp-expand')), `${label} uses the shared expander primitive`);
  check(await panel.locator(':scope > .kdp-expand__inner > :first-child').count() === 1, `${label} keeps spacing inside the animated grid child`);
  const style = await panel.evaluate((node) => {
    const computed = getComputedStyle(node);
    return { duration: computed.transitionDuration, timing: computed.transitionTimingFunction };
  });
  check(style.duration === '0.3s, 0.2s', `${label} uses shared 300ms/200ms timing`);
  check(style.timing.includes('cubic-bezier(0.42, 0, 0.58, 1)'), `${label} uses approved expansion easing`);
  const start = await panel.evaluate((node) => ({ height: node.getBoundingClientRect().height, opacity: Number(getComputedStyle(node).opacity) }));
  await page.locator(trigger).check();
  const scrollStart = await page.evaluate(() => window.scrollY);
  await page.waitForTimeout(80);
  const middle = await panel.evaluate((node) => ({ height: node.getBoundingClientRect().height, opacity: Number(getComputedStyle(node).opacity) }));
  await page.waitForTimeout(300);
  const end = await panel.evaluate((node) => ({ height: node.getBoundingClientRect().height, opacity: Number(getComputedStyle(node).opacity) }));
  check(start.height <= middle.height && middle.height < end.height, `${label} expands progressively without an abrupt height snap`);
  check(start.opacity === 0 && middle.opacity > 0 && middle.opacity < 1 && end.opacity === 1, `${label} fades content without flashing`);
  check(Math.abs((await page.evaluate(() => window.scrollY)) - scrollStart) < 2, `${label} does not cause an unexpected scroll jump`);
}

(async () => {
  const browser = await chromium.launch({ headless: process.env.KDP_HEADED !== '1', args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1100, height: 3000 } });
  await wire(page);
  await verifyExpansion(page, 'details', '.kdp-preorder-extra', 'input[name="publishOption"] >> nth=1', 'Details pre-order');
  await verifyExpansion(page, 'content', '.kdp-cover-extra', 'input[name="coverOption"][value="upload"]', 'Content cover');
  await page.close();

  const reduced = await browser.newPage({ viewport: { width: 1100, height: 850 }, reducedMotion: 'reduce' });
  await wire(reduced);
  await reduced.goto(`${BASE}/?book_id=b&access_token=t&step=details`);
  check(await reduced.locator('.kdp-preorder-extra').evaluate((node) => getComputedStyle(node).transitionDuration) === '0s', 'Details pre-order respects reduced motion');
  await reduced.goto(`${BASE}/?book_id=b&access_token=t&step=content`);
  check(await reduced.locator('.kdp-cover-extra').evaluate((node) => getComputedStyle(node).transitionDuration) === '0s', 'Content cover respects reduced motion');
  await reduced.close();
  await browser.close();
  console.log(`RESULT ${passed}/${passed + failed}`);
  process.exit(failed ? 1 : 0);
})().catch((error) => { console.error(error); process.exit(2); });
