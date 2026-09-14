const { chromium } = require('playwright');

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
  await authorizedContext.route('https://project.supabase.co/functions/v1/loadPrivilegedBookshelf', (route) => {
    bookshelfLoads += 1;
    const headers = route.request().headers();
    check(headers.authorization?.startsWith('Bearer ') && headers.apikey === 'public-test-key', 'Bookshelf request carries session JWT and public key');
    const books = [{ id: 'b-1', title: 'Authorized title', author: 'Known Author', type: 'Kindle eBook', status: 'IN_REVIEW', reviewAvailable: true, updatedAt: '2026-09-11T00:00:00Z', createdAt: '2026-09-10T00:00:00Z', basecamp: { status: 'ready', retryAvailable: false } }];
    if (bookshelfLoads > 1) books.unshift({ id: 'b-2', title: 'Untitled', author: '', type: 'Kindle eBook', status: 'draft', updatedAt: '2026-09-12T00:00:00Z', createdAt: '2026-09-12T00:00:00Z', basecamp: retryComplete ? { status: 'ready', retryAvailable: false } : { status: 'failed', retryAvailable: true } });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, identity: { displayName: 'Authorized Reviewer' }, capabilities: ['can_create_book', 'can_review', 'can_view_all_books'], canViewBookshelf: true, canCreateBook: true, books }) });
  });
  await authorizedContext.route('https://project.supabase.co/functions/v1/loadPrivilegedAdminReview', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, identity: { displayName: 'Authorized Reviewer' }, book: { id: 'b-1', title: 'Authorized title', author: 'Known Author' }, reviewRound: { roundNumber: 1, status: 'in_review' }, items: [{ id: 'item-1', step: 'details', sectionKey: 'details.language', label: 'Language', sortOrder: 1, decision: 'pending', snapshot: { value: { value: 'English' } } }], comments: [], files: [], saveAvailable: false, finalizationAvailable: false }) }));
  await authorizedContext.route('https://project.supabase.co/functions/v1/loadCreateBookOptions', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, employees: [{ id: 'person-1', displayName: 'Pre-Press Employee', avatarUrl: null }], reviewers: [{ id: 'reviewer-1', displayName: 'Eligible Reviewer' }], defaultReviewerId: 'reviewer-1' }) }));
  await authorizedContext.route('https://project.supabase.co/functions/v1/createPrivilegedBook', async (route) => {
    const body = route.request().postDataJSON();
    check(body.employeePersonId === 'person-1' && body.reviewerUserId === 'reviewer-1', 'Create submits selected identities without client authority claims');
    return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ ok: true, book: { id: 'b-2', title: 'Untitled', status: 'draft' }, basecamp: { status: 'failed', retryAvailable: true } }) });
  });
  await authorizedContext.route('https://project.supabase.co/functions/v1/retryBasecampProvisioning', async (route) => {
    check(route.request().postDataJSON().bookId === 'b-2', 'retry is scoped to the selected canonical book');
    retryComplete = true;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, bookId: 'b-2', basecamp: { status: 'ready' } }) });
  });
  const authorized = await authorizedContext.newPage();
  await authorized.goto(`${BASE}/?view=bookshelf#access_token=${jwt()}&expires_in=3600&refresh_token=test-refresh&token_type=bearer&type=signup`);
  await authorized.getByRole('heading', { name: 'Create. Manage. Publish.' }).waitFor();
  check(await authorized.getByText('Authorized title').count() === 1, 'authorized server result renders a real card');
  check(await authorized.locator('.kdp-bookshelf-book').getByText('In Review', { exact: true }).count() === 1, 'canonical status renders the correct label');
  check(!(await authorized.getByRole('button', { name: 'Open' }).isDisabled()), 'assigned review has an enabled privileged destination');
  await authorized.getByRole('button', { name: 'Open' }).click();
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
  await authorized.getByLabel('Employee').selectOption('person-1');
  check(await authorized.getByLabel('Reviewer').inputValue() === 'reviewer-1', 'configured default reviewer is selected');
  await authorized.getByRole('button', { name: 'Create Kindle eBook' }).click();
  await authorized.getByRole('heading', { name: 'Create. Manage. Publish.' }).waitFor();
  check(await authorized.getByText('Basecamp setup needs attention').count() === 1, 'canonical book remains visible with sanitized provisioning failure');
  await authorized.getByRole('button', { name: 'Retry setup' }).click();
  await authorized.getByText('Basecamp setup needs attention').waitFor({ state: 'detached' });
  check(retryComplete, 'privileged retry refreshes the sanitized integration state');
  check(!new URL(authorized.url()).searchParams.has('book_id') && !new URL(authorized.url()).searchParams.has('access_token'), 'privileged flow never manufactures employee credentials');
  check(await authorized.getByText('Authorized title').count() === 1, 'in-memory session survives creation and context refresh');
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
