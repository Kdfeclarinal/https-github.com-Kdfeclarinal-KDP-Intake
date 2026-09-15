const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');

const BASE = `http://127.0.0.1:${process.env.KDP_VERIFY_PORT || '8139'}`;
let passed = 0;
let failed = 0;
function check(condition, label) {
  if (condition) { passed += 1; console.log(`PASS ${label}`); }
  else { failed += 1; console.log(`FAIL ${label}`); }
}
function jwt() {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none', typ: 'JWT' })}.${encode({ sub: 'auth-1', exp: Math.floor(Date.now() / 1000) + 3600 })}.test`;
}

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addInitScript(() => { window.KDP_INTAKE_CONFIG = { supabaseUrl: 'https://project.supabase.co', supabasePublishableKey: 'public-test-key' }; });
  await context.route('https://project.supabase.co/auth/v1/user', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'auth-1', app_metadata: { provider: 'google' }, user_metadata: {}, created_at: '2026-09-14T00:00:00Z' }) }));
  await context.route('https://project.supabase.co/functions/v1/loadPrivilegedBookshelf', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, identity: { displayName: 'Rae Reviewer' }, capabilities: ['can_review'], canCreateBook: false, books: [{ id: 'book-1', title: 'Kein\'s Book', author: 'Kein Eclarinal', status: 'IN_REVIEW', reviewAvailable: true, basecamp: { status: 'ready' } }] }) }));
  const reviewData = {
      ok: true,
      identity: { displayName: 'Rae Reviewer' },
      book: { id: 'book-1', title: "Kein's Book", author: 'Kein Eclarinal' },
      reviewRound: { id: 'round-1', roundNumber: 1, status: 'in_review', revision: 0, reachedSteps: ['details'] },
      permissions: { canMutate: true, canFinalize: false }, roundHistory: [],
      items: [
        { id: 'details-language', step: 'details', sectionKey: 'details.language', label: 'Language', sortOrder: 1, decision: 'pending', snapshot: { value: { value: 'English' } } },
        { id: 'details-title', step: 'details', sectionKey: 'details.title', label: 'Book Title', sortOrder: 2, decision: 'approved', snapshot: { value: { title: "Kein's Book", subtitle: 'A subtitle' } } },
        { id: 'content-manuscript', step: 'content', sectionKey: 'content.manuscript', label: 'Manuscript', sortOrder: 1, decision: 'pending', snapshot: { value: { fileName: 'manuscript.docx' } } },
        { id: 'pricing-territories', step: 'pricing', sectionKey: 'pricing.territories', label: 'Territories', sortOrder: 1, decision: 'pending', snapshot: { value: { territoryMode: 'all' } } },
      ],
      comments: [], files: [{ fileName: 'manuscript.docx' }],
  };
  const continuationData = {
    ...reviewData,
    book: { ...reviewData.book, id: 'book-context' },
    reviewRound: { id: 'round-2', roundNumber: 2, status: 'in_review', reachedSteps: ['details'] },
    items: [{ ...reviewData.items[0], id: 'continued-item', decision: 'needs_updates' }],
    comments: [{
      id: 'continued-comment', itemId: 'continued-item', body: 'Please correct this value.', author: 'Rae Reviewer',
      createdAt: '2026-09-15T01:00:00Z', actionable: true, issueNumber: 1, authorActorType: 'privileged',
      continuation: { sourceRoundNumber: 1, originalRequest: 'Please correct this value.', readyForRereview: true, readiness: { viaReply: true, viaChange: false, viaFileChange: false }, employeeReplies: [{ id: 'update-reply', body: 'Corrected and saved.', author: 'Employee', createdAt: '2026-09-15T00:30:00Z' }] },
    }],
  };
  const historicalData = {
    ...reviewData,
    book: { ...reviewData.book, id: 'book-history' },
    reviewRound: { id: 'round-old', roundNumber: 1, status: 'in_review', outcome: 'request_updates', submittedAt: '2026-09-14T09:00:00Z', submittedBy: 'Employee', finalizedAt: '2026-09-14T10:00:00Z', finalizedBy: 'Rae Reviewer', reviewer: 'Rae Reviewer', reachedSteps: ['details', 'content', 'pricing'] },
    permissions: { canMutate: false, canFinalize: false },
    items: reviewData.items.map((item) => ({ ...item, decision: item.decision === 'pending' ? 'needs_updates' : item.decision })),
    comments: [{ id: 'history-comment', itemId: 'details-language', body: 'Historical request.', author: 'Rae Reviewer', createdAt: '2026-09-14T09:30:00Z', actionable: true, issueNumber: 1, authorActorType: 'privileged' }],
  };
  const dataFor = (body) => body.bookId === 'book-history' ? historicalData : body.bookId === 'book-context' ? continuationData : reviewData;
  const fulfillReview = (route, data = reviewData) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
  await context.route('https://project.supabase.co/functions/v1/loadPrivilegedAdminReview', async (route) => {
    const body = route.request().postDataJSON();
    check(['book-1', 'book-context', 'book-history'].includes(body.bookId), 'review loader request is scoped by book id only');
    return fulfillReview(route, dataFor(body));
  });
  await context.route('https://project.supabase.co/functions/v1/mutatePrivilegedAdminReview', async (route) => {
    const body = route.request().postDataJSON();
    check(body.expectedRevision === reviewData.reviewRound.revision, 'review mutation carries the last authoritative revision');
    const item = reviewData.items.find((entry) => entry.id === body.itemId);
    if (body.action === 'approve' && item) item.decision = 'approved';
    if (body.action === 'comment' && item) {
      item.decision = 'needs_updates';
      reviewData.comments.push({ id: 'comment-1', itemId: item.id, body: body.body, author: 'Rae Reviewer', createdAt: new Date().toISOString(), actionable: true, issueNumber: 1, authorActorType: 'privileged' });
    }
    reviewData.reviewRound.revision += 1;
    return fulfillReview(route);
  });

  const page = await context.newPage();
  page.on('pageerror', (error) => console.error('PAGE ERROR', error));
  page.on('console', (message) => { if (message.type() === 'error') console.error('BROWSER ERROR', message.text()); });
  await page.goto(`${BASE}/?view=admin-review&book_id=book-1&review_step=details#access_token=${jwt()}&expires_in=3600&refresh_token=test-refresh&token_type=bearer`);
  await page.waitForTimeout(500);
  await page.getByRole('heading', { name: "Kein's Book" }).waitFor({ timeout: 3000 });
  if (process.env.KDP_CAPTURE_DIR) {
    fs.mkdirSync(process.env.KDP_CAPTURE_DIR, { recursive: true });
    await page.screenshot({ path: path.join(process.env.KDP_CAPTURE_DIR, 'admin-review-desktop.png'), fullPage: true });
  }
  check(await page.getByText('Round 1').count() === 1, 'review round context is visible');
  check(await page.getByRole('button', { name: 'APPROVE Language' }).count() === 1, 'pending section has approval action');
  check(await page.getByText('APPROVED ✓').count() === 1, 'persisted approved section renders quietly');

  await page.getByRole('button', { name: 'APPROVE Language' }).click();
  await page.getByText('APPROVED ✓').nth(1).waitFor();
  check(await page.getByText('APPROVED ✓').count() === 2, 'section approve restores authoritative persisted state');
  await page.getByRole('button', { name: 'Add comment to Language' }).click();
  await page.locator('.kdp-review-composer').waitFor();
  if (process.env.KDP_CAPTURE_DIR) await page.screenshot({ path: path.join(process.env.KDP_CAPTURE_DIR, 'admin-review-composer.png'), fullPage: true });
  check(await page.locator('.kdp-admin-review__workspace').evaluate((node) => Boolean(node.closest('[inert]'))), 'open composer makes review workspace inert');
  check(await page.locator('.kdp-admin-review__layout').getAttribute('inert') !== null, 'open composer also makes the review panel inert');
  await page.getByRole('textbox', { name: 'Comment', exact: true }).fill('Please confirm this value.');
  await page.getByRole('button', { name: 'Post comment' }).click();
  await page.getByText('UPDATES REQUESTED').waitFor();
  check(await page.getByText('UPDATES REQUESTED').count() === 1, 'actionable comment authoritatively requests updates');
  check(await page.getByRole('button', { name: 'Open comment 1 for Language' }).count() === 1, 'section comment receives a round-local marker');

  await page.getByRole('tab', { name: 'Approvals' }).click();
  check(await page.getByText('2 of 2 sections decided').count() === 1, 'approvals tab summarizes the current page');
  await page.getByRole('tab', { name: 'Comments' }).click();
  await page.getByRole('button', { name: 'Filter & Sort' }).click();
  check(await page.getByPlaceholder('Search comments').count() === 1 && await page.getByText('Oldest comments').count() === 1, 'comments panel exposes compact search and sort controls');
  await page.getByRole('button', { name: 'Review Next Page' }).click();
  await page.locator('.kdp-admin-review__sections').getByText('Manuscript', { exact: true }).waitFor();
  check(await page.getByPlaceholder('Search comments').count() === 0, 'page navigation closes the transient filter popover');
  check(new URL(page.url()).searchParams.get('review_step') === 'content', 'next-page navigation updates the privileged review route');
  check(await page.getByRole('button', { name: 'Approve All' }).isEnabled(), 'review actions remain immediately persistent without a generic save button');

  const horizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  check(!horizontalOverflow, 'admin review has no page-level horizontal overflow');
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  check(!mobileOverflow && await page.locator('.kdp-review-panel').isVisible(), 'review panel and sections remain usable at mobile width');
  if (process.env.KDP_CAPTURE_DIR) await page.screenshot({ path: path.join(process.env.KDP_CAPTURE_DIR, 'admin-review-mobile.png'), fullPage: true });

  const continuationPage = await context.newPage();
  await continuationPage.goto(`${BASE}/?view=admin-review&book_id=book-context&review_step=details#access_token=${jwt()}&expires_in=3600&refresh_token=test-refresh&token_type=bearer`);
  await continuationPage.getByText('Continued from Round 1').waitFor();
  check(await continuationPage.getByText('Corrected and saved.').count() === 1, 'next active round shows employee continuation reply');
  check(await continuationPage.getByText(/Ready for re-review via employee reply/).count() === 1, 'continuation readiness is visible without resolving the issue');
  check(await continuationPage.getByRole('button', { name: 'Resolve' }).count() === 1, 'continued active issue still requires reviewer resolution');

  const historicalPage = await context.newPage();
  await historicalPage.goto(`${BASE}/?view=admin-review&book_id=book-history&review_step=details#access_token=${jwt()}&expires_in=3600&refresh_token=test-refresh&token_type=bearer`);
  await historicalPage.getByText(/Historical review round 1/).waitFor();
  check(await historicalPage.getByText(/permanently read-only/).count() === 1, 'finalized round shows historical attribution banner');
  for (const name of ['Approve All', 'Reopen Decision', 'Add Comment', 'Reply', 'Edit', 'Resolve', 'Delete', 'Request Updates', 'Approve Book']) {
    check(await historicalPage.getByRole('button', { name, exact: true }).count() === 0, `historical round omits ${name}`);
  }
  await context.close();
  await browser.close();
  console.log(`RESULT ${passed}/${passed + failed}`);
  process.exit(failed ? 1 : 0);
})().catch((error) => { console.error(error); process.exit(2); });
