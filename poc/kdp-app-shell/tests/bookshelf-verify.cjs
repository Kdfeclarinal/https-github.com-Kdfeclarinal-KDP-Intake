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
async function holdForHumanTrial(browser) {
  console.log('HUMAN TRIAL READY — close the Playwright browser or press Ctrl+C in this terminal to stop.');
  await new Promise((resolve) => {
    const stop = () => resolve();
    browser.once('disconnected', stop);
    process.once('SIGINT', stop);
  });
}

(async () => {
  const browser = await chromium.launch({ headless: process.env.KDP_HEADED !== '1', args: ['--no-sandbox'] });
  const missingConfig = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await missingConfig.goto(`${BASE}/?view=bookshelf`);
  await missingConfig.getByRole('heading', { name: 'Privileged access is not configured' }).waitFor();
  check(await missingConfig.locator('.kdp-app--bookshelf').count() === 0, 'Bookshelf URL does not bypass missing auth configuration');
  await missingConfig.goto(`${BASE}/?view=create-new`);
  check(await missingConfig.getByRole('heading', { name: 'Privileged access is not configured' }).count() === 1, 'Create New URL is independently gated');
  await missingConfig.close();

  const signedOutContext = await browser.newContext();
  await signedOutContext.addInitScript(() => { window.KDP_INTAKE_CONFIG = { supabaseUrl: 'https://project.supabase.co', supabasePublishableKey: 'public-test-key' }; });
  const signedOut = await signedOutContext.newPage();
  await signedOut.goto(`${BASE}/?view=bookshelf`);
  await signedOut.getByRole('heading', { name: 'Sign in to Bookshelf' }).waitFor();
  check(await signedOut.getByRole('button', { name: 'Sign in with Google' }).count() === 1, 'unauthenticated visitor receives sign-in state and no data');
  await signedOutContext.close();

  const emptyContext = await browser.newContext();
  await emptyContext.addInitScript(() => { window.KDP_INTAKE_CONFIG = { supabaseUrl: 'https://project.supabase.co', supabasePublishableKey: 'public-test-key' }; });
  await emptyContext.route('https://project.supabase.co/auth/v1/user', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'auth-empty', aud: 'authenticated', role: 'authenticated', app_metadata: { provider: 'google' }, user_metadata: {}, created_at: '2026-09-11T00:00:00Z' }) }));
  await emptyContext.route('https://project.supabase.co/functions/v1/loadPrivilegedBookshelf', async (route) => { await new Promise((resolve) => setTimeout(resolve, 200)); return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, identity: { displayName: 'Reviewer' }, capabilities: ['can_review'], canViewBookshelf: true, canCreateBook: false, books: [] }) }); });
  const empty = await emptyContext.newPage();
  await empty.goto(`${BASE}/?view=bookshelf#access_token=${jwt()}&expires_in=3600&refresh_token=test-refresh&token_type=bearer&type=signup`);
  check(await empty.getByRole('heading', { name: 'Verifying access…' }).count() === 1, 'authorized data path has a loading state');
  await empty.getByRole('heading', { name: 'Publishing workspace is ready' }).waitFor();
  check(await empty.getByText('No titles are available yet.').count() === 1, 'authorized empty result has a safe empty state');
  await emptyContext.close();

  const authorizedContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await authorizedContext.addInitScript(() => { window.KDP_INTAKE_CONFIG = { supabaseUrl: 'https://project.supabase.co', supabasePublishableKey: 'public-test-key' }; });
  await authorizedContext.route('https://project.supabase.co/auth/v1/user', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'auth-1', aud: 'authenticated', role: 'authenticated', email: 'reviewer@example.test', app_metadata: { provider: 'google' }, user_metadata: {}, created_at: '2026-09-11T00:00:00Z' }) }));
  let bookshelfLoads = 0;
  let retryComplete = false;
  let trashRecovered = false;
  await authorizedContext.route('https://project.supabase.co/functions/v1/loadPrivilegedBookshelf', (route) => {
    bookshelfLoads += 1;
    const headers = route.request().headers();
    check(headers.authorization?.startsWith('Bearer ') && headers.apikey === 'public-test-key', 'Bookshelf request carries session JWT and public key');
    const books = [{ id: 'b-1', title: 'Authorized title', author: 'Known Author', type: 'Kindle eBook', status: 'IN_REVIEW', activeReview: true, reviewerId: 'owner-1', reviewerEligible: true, reviewerName: 'Rae Reviewer', reviewAvailable: true, employeePersonId: 'person-1', employeeName: 'Pre-Press Employee', latestFiles: [{ fileType: 'manuscript', fileName: 'authorized-title.docx', url: 'https://files.example.test/authorized-title.docx' }], attention: { state: 'overdue', since: '2026-09-10T00:00:00Z' }, updatedAt: '2026-09-11T00:00:00Z', createdAt: '2026-09-10T00:00:00Z', basecamp: { status: 'ready', retryAvailable: false } }];
    books.push({ id: 'b-trash', title: 'Recoverable title', author: 'History Preserved', type: 'Kindle eBook', status: 'EMPLOYEE_INTAKE', reviewAvailable: false, employeeName: 'Pre-Press Employee', reviewerName: 'Rae Reviewer', deletedAt: trashRecovered ? null : '2026-09-14T00:00:00Z', deletedBy: trashRecovered ? '' : 'Taylor Tech Admin', trashRevision: trashRecovered ? 2 : 1, updatedAt: '2026-09-14T00:00:00Z', createdAt: '2026-09-01T00:00:00Z', basecamp: trashRecovered ? { status: 'ready', retryAvailable: false } : { status: 'incomplete', retryAvailable: false, operatorIntervention: true } });
    if (process.env.KDP_HUMAN_TRIAL === '1') books.push(
      { id: 'b-unassigned', title: 'Awaiting reviewer assignment', author: 'Fixture Author', type: 'Kindle eBook', status: 'AWAITING_REVIEW', activeReview: true, reviewerId: null, reviewerEligible: false, reviewAvailable: false, employeePersonId: 'person-1', employeeName: 'Pre-Press Employee', updatedAt: '2026-09-12T00:00:00Z', createdAt: '2026-09-12T00:00:00Z', basecamp: { status: 'ready', retryAvailable: false } },
      { id: 'b-warning', title: 'Outcome sync needs attention', author: 'Fixture Author', type: 'Kindle eBook', status: 'EMPLOYEE_UPDATES', activeReview: false, reviewerId: 'reviewer-1', reviewerEligible: true, reviewAvailable: false, employeePersonId: 'person-1', employeeName: 'Replacement Employee', updatedAt: '2026-09-13T00:00:00Z', createdAt: '2026-09-13T00:00:00Z', basecamp: { status: 'failed', retryAvailable: true, retryKind: 'review_outcome' } },
    );
    if (bookshelfLoads > 1) books.unshift({ id: 'b-2', title: 'Untitled', author: 'Levi', type: 'Kindle eBook', status: 'draft', updatedAt: '2026-09-12T00:00:00Z', createdAt: '2026-09-12T00:00:00Z', basecamp: retryComplete ? { status: 'ready', retryAvailable: false } : { status: 'failed', retryAvailable: true } });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, identity: { displayName: 'Authorized Reviewer' }, capabilities: ['can_create_book', 'can_review', 'can_view_all_books', 'can_manage_users', 'can_change_default_reviewer', 'can_manage_integrations'], canViewBookshelf: true, canCreateBook: true, books }) });
  });
  await authorizedContext.route('https://project.supabase.co/functions/v1/loadOperationalSettings', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
    ok: true, identity: { id: 'owner-1', displayName: 'Authorized Reviewer', role: 'owner' }, capabilities: ['can_manage_users', 'can_change_default_reviewer', 'can_manage_integrations', 'can_view_all_books'],
    users: [
      { id: 'owner-1', displayName: 'Olivia Owner', email: 'owner@example.test', role: 'owner', active: true, revision: 2, capabilities: ['can_manage_users', 'can_manage_integrations', 'can_review', 'can_finalize_book'] },
      { id: 'admin-1', displayName: 'Taylor Tech Admin', email: 'admin@example.test', role: 'tech_admin', active: true, revision: 1, capabilities: ['can_manage_users', 'can_assign_reviewer', 'can_reassign_reviewer'] },
      { id: 'reviewer-1', displayName: 'Rae Reviewer', email: 'reviewer@example.test', role: 'reviewer', active: true, revision: 4, capabilities: ['can_review', 'can_claim_review'] },
      { id: 'disabled-1', displayName: 'Disabled Reviewer', email: 'disabled@example.test', role: 'reviewer', active: false, revision: 3, capabilities: ['can_review'] },
    ], employees: [{ id: 'person-1', displayName: 'Pre-Press Employee', email: 'employee@example.test' }], defaultReviewerId: 'reviewer-1',
    reviewerMappings: [{ reviewerId: 'owner-1', personId: 'person-1', displayName: 'Pre-Press Employee', projectId: 'project-1' }],
    integrations: { basecamp: { status: 'connected', projectId: 'project-1' }, reviewstudio: { configured: true }, ghl: { configured: true } },
  }) }));
  let reviewerMappingSaved = false;
  await authorizedContext.route('https://project.supabase.co/functions/v1/saveReviewerBasecampMapping', (route) => {
    const body = route.request().postDataJSON();
    check(body.reviewerId === 'owner-1' && body.personId === 'person-1', 'reviewer Basecamp mapping is scoped to selected identities');
    reviewerMappingSaved = true;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, reviewerId: body.reviewerId, basecampPerson: { id: body.personId, displayName: 'Pre-Press Employee' } }) });
  });
    await authorizedContext.route('https://project.supabase.co/functions/v1/loadPrivilegedAdminReview', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, identity: { displayName: 'Authorized Reviewer' }, book: { id: 'b-1', title: 'Authorized title', author: 'Known Author' }, reviewRound: { roundNumber: 1, status: 'in_review' }, items: [{ id: 'item-1', step: 'details', sectionKey: 'details.language', label: 'Language', sortOrder: 1, decision: 'pending', snapshot: { value: { value: 'English' } } }], comments: [], files: [], saveAvailable: false, finalizationAvailable: false }) }));
  await authorizedContext.route('https://project.supabase.co/functions/v1/loadCreateBookOptions', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, employees: [{ id: 'person-1', displayName: 'Pre-Press Employee', avatarUrl: null }], reviewers: [{ id: 'reviewer-1', displayName: 'Eligible Reviewer' }], defaultReviewerId: 'reviewer-1', defaultTurnaround: { value: 7, unit: 'calendar_days' }, defaultDueDate: '2026-09-26' }) }));
  await authorizedContext.route('https://project.supabase.co/functions/v1/createPrivilegedBook', async (route) => {
    const body = route.request().postDataJSON();
    check(body.bookAuthor === 'Levi' && body.employeePersonId === 'person-1' && body.reviewerUserId === 'reviewer-1' && body.dueDate === '2026-09-26', 'Create submits Book Author, selected identities, and resolved due date without client authority claims');
    return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ ok: true, book: { id: 'b-2', title: 'Untitled', status: 'draft' }, basecamp: { status: 'failed', retryAvailable: true } }) });
  });
  await authorizedContext.route('https://project.supabase.co/functions/v1/retryBasecampProvisioning', async (route) => {
    check(route.request().postDataJSON().bookId === 'b-2', 'retry is scoped to the selected canonical book');
    retryComplete = true;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, bookId: 'b-2', basecamp: { status: 'ready' } }) });
  });
  await authorizedContext.route('https://project.supabase.co/functions/v1/mutateBookTrash', async (route) => {
    const body = route.request().postDataJSON();
    check(body.bookId === 'b-trash' && body.action === 'recover' && body.expectedRevision === 1 && body.reason.length >= 3, 'Trash recovery sends the scoped action, revision, and reason');
    trashRecovered = true;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, deleted: false, trashRevision: 2, employeeAccessReestablished: true, basecampSyncRequired: true }) });
  });
  const authorized = await authorizedContext.newPage();
  await authorized.goto(`${BASE}/?view=bookshelf#access_token=${jwt()}&expires_in=3600&refresh_token=test-refresh&token_type=bearer&type=signup`);
  await authorized.getByRole('heading', { name: 'Create. Manage. Publish.' }).waitFor();
  check(await authorized.getByText('Authorized title').count() === 1, 'authorized server result renders a real card');
  check(await authorized.locator('.kdp-bookshelf-book').getByText('In Review', { exact: true }).count() === 1, 'canonical status renders the correct label');
  check(await authorized.getByText('Pre-Press Employee', { exact: true }).count() >= 1 && await authorized.getByText('Rae Reviewer', { exact: true }).count() >= 1, 'Bookshelf card exposes employee and reviewer assignments');
  check(await authorized.getByText('manuscript: authorized-title.docx', { exact: true }).count() === 1, 'Bookshelf card exposes latest useful file access');
  check(await authorized.getByText(/Overdue since/).count() === 1, 'Bookshelf card surfaces derived overdue attention separately from workflow status');
  await authorized.getByRole('button', { name: /View: All titles/ }).click();
  await authorized.getByRole('option', { name: 'Trash' }).click();
  const trashedCard = authorized.locator('.kdp-bookshelf-book').filter({ hasText: 'Recoverable title' });
  check(await trashedCard.getByText('In Trash', { exact: true }).count() === 1 && await trashedCard.getByText(/Taylor Tech Admin/).count() === 1, 'Trash view preserves workflow context and deletion attribution');
  await trashedCard.getByRole('button', { name: 'Manage title' }).click();
  await trashedCard.getByRole('menuitem', { name: 'Recover title' }).click();
  await authorized.getByLabel('Reason').fill('Restore work after accidental removal.');
  await authorized.getByRole('button', { name: 'Recover title', exact: true }).click();
  await trashedCard.waitFor({ state: 'detached' });
  check(trashRecovered, 'authorized Recover returns the title to its prior workflow without a duplicate book');
  await authorized.getByRole('button', { name: /View: Trash/ }).click();
  await authorized.getByRole('option', { name: 'All titles' }).click();
  await authorized.getByRole('button', { name: 'Settings' }).click();
  await authorized.getByRole('heading', { name: 'Settings' }).waitFor();
  check(await authorized.getByRole('heading', { name: 'Team & Permissions' }).count() === 1, 'authorized operational Settings route renders team controls');
  check(await authorized.getByText('connected', { exact: true }).count() === 1 && await authorized.getByText('Configured', { exact: true }).count() === 2, 'Settings exposes sanitized integration presence');
  check((await authorized.locator('body').innerText()).includes('secret') === false, 'Settings does not render integration credentials');
  check(await authorized.getByRole('heading', { name: 'Reviewer Basecamp mapping' }).count() === 1, 'authorized user-management Settings expose reviewer Basecamp mapping');
  await authorized.getByRole('button', { name: 'Update mapping' }).click();
  await authorized.getByText('Changes saved.').waitFor();
  check(reviewerMappingSaved, 'reviewer Basecamp mapping saves through the server-authorized function');
  if (process.env.KDP_CAPTURE_DIR) {
    fs.mkdirSync(process.env.KDP_CAPTURE_DIR, { recursive: true });
    await authorized.screenshot({ path: path.join(process.env.KDP_CAPTURE_DIR, 'settings-desktop.png'), fullPage: true });
  }
  await authorized.getByRole('button', { name: 'Back to Bookshelf' }).click();
  await authorized.getByRole('heading', { name: 'Create. Manage. Publish.' }).waitFor();
  check(!(await authorized.locator('button[title="Open assigned admin review."]').isDisabled()), 'assigned review has an enabled privileged destination');
  await authorized.locator('button[title="Open assigned admin review."]').click();
  await authorized.getByRole('heading', { name: 'Authorized title' }).waitFor();
  check(new URL(authorized.url()).searchParams.get('view') === 'admin-review' && !new URL(authorized.url()).searchParams.has('access_token'), 'Open routes to privileged Admin Review without employee credentials');
  await authorized.getByRole('button', { name: 'Back to Bookshelf', exact: true }).first().click();
  await authorized.getByRole('heading', { name: 'Create. Manage. Publish.' }).waitFor();
  await authorized.getByRole('button', { name: '+ Create new title or series' }).click();
  await authorized.getByRole('heading', { name: 'What would you like to create?' }).waitFor();
  await authorized.getByRole('button', { name: 'Create eBook' }).click();
  await Promise.race([
    authorized.getByRole('heading', { name: 'Create Kindle eBook' }).waitFor(),
    authorized.getByRole('status').waitFor(),
  ]);
  check(await authorized.getByRole('heading', { name: 'Create Kindle eBook' }).count() === 1, `Create options load (${await authorized.getByRole('status').allTextContents()})`);
  await authorized.getByLabel('Book Author').fill('Levi');
  await authorized.getByLabel('Employee').selectOption('person-1');
  check(await authorized.getByLabel('Reviewer').inputValue() === 'reviewer-1', 'configured default reviewer is selected');
  check(await authorized.getByLabel('Due Date').inputValue() === '2026-09-26', 'Create Book preloads the authoritative seven-calendar-day due date');
  await authorized.getByRole('button', { name: 'Create Kindle eBook' }).click();
  await authorized.getByRole('heading', { name: 'Create. Manage. Publish.' }).waitFor();
  const createdBook = authorized.locator('.kdp-bookshelf-book').filter({ hasText: 'Untitled' });
  check(await createdBook.getByText('Basecamp setup needs attention').count() === 1, 'canonical book remains visible with sanitized provisioning failure');
  if (process.env.KDP_CAPTURE_DIR) await authorized.screenshot({ path: path.join(process.env.KDP_CAPTURE_DIR, 'bookshelf-warning-desktop.png'), fullPage: true });
  await authorized.getByRole('button', { name: 'Retry setup' }).click();
  await createdBook.getByText('Basecamp setup needs attention').waitFor({ state: 'detached' });
  check(retryComplete, 'privileged retry refreshes the sanitized integration state');
  check(!new URL(authorized.url()).searchParams.has('book_id') && !new URL(authorized.url()).searchParams.has('access_token'), 'privileged flow never manufactures employee credentials');
  check(await authorized.getByText('Authorized title').count() === 1, 'in-memory session survives creation and context refresh');

  await authorizedContext.unroute('https://project.supabase.co/functions/v1/loadCreateBookOptions');
  await authorizedContext.route('https://project.supabase.co/functions/v1/loadCreateBookOptions', (route) => route.fulfill({
    status: 503,
    contentType: 'application/json',
    body: JSON.stringify({ ok: false, error: 'Basecamp Pre-Press is not configured.' }),
  }));
  await authorized.getByRole('button', { name: '+ Create new title or series' }).click();
  await authorized.getByRole('button', { name: 'Create eBook' }).click();
  await authorized.getByText('Basecamp is not connected. Connect the Pre-Press integration in Settings before creating a book.', { exact: true }).waitFor();
  check(true, 'disconnected Basecamp renders the exact actionable Create Book message');
  await authorized.getByRole('button', { name: 'Back to Bookshelf' }).click();

  if (process.env.KDP_HUMAN_TRIAL === '1') {
    const trialSession = `#access_token=${jwt()}&expires_in=3600&refresh_token=test-refresh&token_type=bearer&type=signup`;
    const settingsTrial = await authorizedContext.newPage();
    await settingsTrial.goto(`${BASE}/?view=settings${trialSession}`);
    await settingsTrial.getByRole('heading', { name: 'Settings' }).waitFor();
    const createTrial = await authorizedContext.newPage();
    await createTrial.goto(`${BASE}/?view=create-new${trialSession}`);
    await createTrial.getByRole('heading', { name: 'What would you like to create?' }).waitFor();
    const reviewTrial = await authorizedContext.newPage();
    await reviewTrial.goto(`${BASE}/?view=admin-review&book_id=b-1&review_step=details${trialSession}`);
    await reviewTrial.getByRole('heading', { name: 'Authorized title' }).waitFor();
    console.log(`Bookshelf: ${BASE}/?view=bookshelf`);
    console.log(`Settings: ${BASE}/?view=settings`);
    console.log(`Create New: ${BASE}/?view=create-new`);
    console.log(`Admin Review fixture: ${BASE}/?view=admin-review&book_id=b-1&review_step=details`);
    await holdForHumanTrial(browser);
    await authorizedContext.close();
    await browser.close();
    process.exit(0);
  }
  await authorizedContext.close();

  const deniedContext = await browser.newContext();
  await deniedContext.addInitScript(() => { window.KDP_INTAKE_CONFIG = { supabaseUrl: 'https://project.supabase.co', supabasePublishableKey: 'public-test-key' }; });
  await deniedContext.route('https://project.supabase.co/auth/v1/user', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'auth-2', aud: 'authenticated', role: 'authenticated', app_metadata: { provider: 'google' }, user_metadata: {}, created_at: '2026-09-11T00:00:00Z' }) }));
  await deniedContext.route('https://project.supabase.co/functions/v1/loadPrivilegedBookshelf', (route) => route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'Privileged access is not authorized.' }) }));
  const denied = await deniedContext.newPage();
  await denied.goto(`${BASE}/?view=bookshelf#access_token=${jwt()}&expires_in=3600&refresh_token=test-refresh&token_type=bearer&type=signup`);
  await denied.getByRole('heading', { name: 'Access denied' }).waitFor();
  check(await denied.locator('.kdp-app--bookshelf').count() === 0, 'Google identity without application authorization receives no data');
  await deniedContext.close();

  const errorContext = await browser.newContext();
  await errorContext.addInitScript(() => { window.KDP_INTAKE_CONFIG = { supabaseUrl: 'https://project.supabase.co', supabasePublishableKey: 'public-test-key' }; });
  await errorContext.route('https://project.supabase.co/auth/v1/user', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'auth-error', aud: 'authenticated', role: 'authenticated', app_metadata: { provider: 'google' }, user_metadata: {}, created_at: '2026-09-11T00:00:00Z' }) }));
  await errorContext.route('https://project.supabase.co/functions/v1/loadPrivilegedBookshelf', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'Bookshelf data is unavailable.' }) }));
  const errorPage = await errorContext.newPage();
  await errorPage.goto(`${BASE}/?view=bookshelf#access_token=${jwt()}&expires_in=3600&refresh_token=test-refresh&token_type=bearer&type=signup`);
  await errorPage.getByRole('heading', { name: 'Bookshelf unavailable' }).waitFor();
  check(await errorPage.locator('.kdp-app--bookshelf').count() === 0, 'backend failure has a closed error state without card data');
  await errorContext.close();

  await browser.close();
  console.log(`RESULT ${passed}/${passed + failed}`);
  process.exit(failed ? 1 : 0);
})().catch((error) => { console.error(error); process.exit(2); });
