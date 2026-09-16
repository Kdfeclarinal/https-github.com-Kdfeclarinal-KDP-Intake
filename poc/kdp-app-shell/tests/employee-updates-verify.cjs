const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const BASE = `http://127.0.0.1:${process.env.KDP_VERIFY_PORT || '8139'}`;
let passed = 0;
let failed = 0;
const check = (condition, label) => {
  if (condition) { passed += 1; console.log(`PASS ${label}`); }
  else { failed += 1; console.log(`FAIL ${label}`); }
};

const progress = {
  activeStep: 'details',
  steps: {
    details: { status: 'complete', isUnlocked: true, isComplete: true },
    content: { status: 'complete', isUnlocked: true, isComplete: true },
    pricing: { status: 'complete', isUnlocked: true, isComplete: true },
  },
};

function payload({ reopened = false, replied = false } = {}) {
  return {
    ok: true,
    book: {
      book_title: 'Employee Update Trial',
      overall_status: 'EMPLOYEE_UPDATES',
      current_employee_step: 'details',
      kdp_language: 'en',
      primary_marketplace: 'amazon.com',
    },
    step_name: 'details',
    progress_state: progress,
    employee_revision: reopened || replied ? 5 : 4,
    employee_update: {
      updateCycleId: 'cycle-1',
      roundNumber: 2,
      step: 'details',
      editableSectionKeys: reopened ? ['book_title', 'language'] : ['book_title'],
      threads: [{
        id: 'comment-1',
        continuationId: 'thread-1',
        number: 1,
        sectionKey: 'book_title',
        body: 'Correct the title so it matches the approved cover.',
        replies: replied ? [{ id: 'reply-1', body: 'Updated to match the cover.' }] : [],
        readyForRereview: replied,
      }],
      reopenedSections: reopened ? [{ id: 'reopen-1', sectionKey: 'language', reason: 'The source language was recorded incorrectly.' }] : [],
      reopenableSections: reopened ? [] : [{ itemId: 'approved-language', sectionKey: 'language', label: 'Language' }],
    },
  };
}

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  let reopened = false;
  let replied = false;
  let reopenRequest = null;
  let replyRequest = null;

  await page.route('**/functions/v1/loadEmployeePage', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(payload({ reopened, replied })),
  }));
  await page.route('**/functions/v1/reopenEmployeeReviewSection', (route) => {
    reopenRequest = JSON.parse(route.request().postData() || '{}');
    reopened = true;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
  });
  await page.route('**/functions/v1/respondEmployeeReview', (route) => {
    replyRequest = JSON.parse(route.request().postData() || '{}');
    replied = true;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
  });

  await page.goto(`${BASE}/?book_id=book-1&access_token=employee-token&step=details`);
  await page.getByRole('heading', { name: 'Employee Updates — Round 2' }).waitFor();
  const titleSection = page.locator('.kdp-section').filter({ has: page.getByText('Book Title', { exact: true }) });
  const languageSection = page.locator('.kdp-section').filter({ has: page.getByText('Language', { exact: true }) });
  check(await titleSection.getAttribute('aria-disabled') !== 'true', 'reviewer-requested section is editable');
  check(await languageSection.getAttribute('aria-disabled') === 'true', 'approved section stays inert until explicitly reopened');
  check(await page.getByText('Awaiting a reply or saved change before re-review.').count() === 1, 'unresolved continuation shows truthful readiness state');

  await page.getByText('Need to correct another approved section?').click();
  await page.getByRole('button', { name: 'Reopen Language' }).click();
  await page.getByLabel('Reason').fill('The source language was recorded incorrectly.');
  await page.getByRole('button', { name: 'Reopen section' }).click();
  await page.getByText('language reopened').waitFor();
  check(reopenRequest?.expectedRevision === 4 && reopenRequest?.sectionKey === 'language' && reopenRequest?.updateCycleId === 'cycle-1', 'reopen request is scoped and revision guarded');
  check(await page.locator('.kdp-section').filter({ has: page.getByText('Language', { exact: true }) }).getAttribute('aria-disabled') !== 'true', 'server-confirmed reopened section becomes editable');

  await page.getByRole('button', { name: 'Reply' }).click();
  await page.getByLabel('Reply to comment 1').fill('Updated to match the cover.');
  await page.getByRole('button', { name: 'Post Reply' }).click();
  await page.getByText('Ready for re-review. Reviewer resolution is still required.').waitFor();
  check(replyRequest?.expectedRevision === 5 && replyRequest?.commentId === 'comment-1', 'reply request is scoped and revision guarded');
  check(await page.getByText('Updated to match the cover.', { exact: true }).count() === 1, 'employee reply is rendered from refreshed continuation state');

  if (process.env.KDP_CAPTURE_DIR) {
    fs.mkdirSync(process.env.KDP_CAPTURE_DIR, { recursive: true });
    await page.screenshot({ path: path.join(process.env.KDP_CAPTURE_DIR, 'employee-updates-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    check(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), 'Employee Updates has no page-level mobile overflow');
    await page.screenshot({ path: path.join(process.env.KDP_CAPTURE_DIR, 'employee-updates-mobile.png'), fullPage: true });
  }

  await context.close();
  await browser.close();
  console.log(`RESULT ${passed}/${passed + failed}`);
  process.exit(failed ? 1 : 0);
})().catch((error) => { console.error(error); process.exit(2); });
