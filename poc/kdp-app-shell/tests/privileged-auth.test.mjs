import test from 'node:test';
import assert from 'node:assert/strict';
import { callPrivilegedFunction, loadPrivilegedContext } from '../src/privileged/privilegedAuth.js';

const config = { supabaseUrl: 'https://project.supabase.co', publishableKey: 'public-test-key' };

test('privileged request sends only verified session bearer and public API key', async () => {
  let request;
  const result = await loadPrivilegedContext({
    accessToken: 'google-session-jwt', config,
    fetchImpl: async (url, options) => {
      request = { url, options };
      return { ok: true, status: 200, json: async () => ({ ok: true, books: [] }) };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(request.options.headers.Authorization, 'Bearer google-session-jwt');
  assert.equal(request.options.headers.apikey, 'public-test-key');
  assert.equal(request.options.body, '{}');
  assert.equal(request.options.body.includes('role'), false);
  assert.equal(request.options.body.includes('capabil'), false);
});

test('server denial remains a denial in presentation layer', async () => {
  await assert.rejects(() => loadPrivilegedContext({
    accessToken: 'valid-google-but-no-grant', config,
    fetchImpl: async () => ({ ok: false, status: 403, json: async () => ({ ok: false, error: 'Privileged access is not authorized.' }) }),
  }), (error) => error.status === 403);
});

test('privileged mutation sends only session authority and requested input', async () => {
  let request;
  const body = await callPrivilegedFunction({
    functionName: 'createPrivilegedBook', accessToken: 'session-jwt', config,
    body: { employeePersonId: 'person-1', reviewerUserId: 'reviewer-1' },
    fetchImpl: async (url, options) => {
      request = { url, options };
      return { ok: true, status: 201, json: async () => ({ ok: true, book: { id: 'book-1' } }) };
    },
  });
  assert.equal(body.book.id, 'book-1');
  assert.equal(request.url.endsWith('/functions/v1/createPrivilegedBook'), true);
  assert.equal(request.options.headers.Authorization, 'Bearer session-jwt');
  assert.deepEqual(JSON.parse(request.options.body), { employeePersonId: 'person-1', reviewerUserId: 'reviewer-1' });
  assert.equal(request.options.body.includes('capabil'), false);
  assert.equal(request.options.body.includes('role'), false);
});
