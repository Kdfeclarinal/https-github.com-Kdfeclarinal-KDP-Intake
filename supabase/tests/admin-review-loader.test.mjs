import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { resolvePrivilegedAdminReview } from '../functions/loadPrivilegedAdminReview/_adminReview.ts';

const loaderSource = readFileSync(new URL('../functions/loadPrivilegedAdminReview/index.ts', import.meta.url), 'utf8');

test('admin loader excludes soft-deleted comments at the database boundary', () => {
  assert.match(loaderSource, /from\('book_review_comments'\)[\s\S]*\.is\('deleted_at', null\)/);
});

function deps(overrides = {}) {
  return {
    authorizationHeader: 'Bearer valid',
    authenticate: async () => ({ id: 'auth-1', app_metadata: { providers: ['google'] } }),
    findPrivilegedUser: async () => ({ id: 'reviewer-1', display_name: 'Rae', disabled_at: null }),
    listGrants: async () => [{ capability_key: 'can_review', revoked_at: null }],
    findBook: async () => ({ id: 'book-1', book_title: 'A Book', primary_author_name: 'A. Writer', overall_status: 'AWAITING_REVIEW', latest_review_round_id: 'round-1', assigned_reviewer_user_id: 'reviewer-1', deleted_at: null }),
    findRound: async () => ({ id: 'round-1', book_id: 'book-1', round_number: 1, status: 'submitted', reviewer_user_id: 'reviewer-1', submission_snapshot: { files: [{ file_name: 'manuscript.docx', reviewstudio_file_id: 'private-id' }] } }),
    listItems: async () => [{ id: 'item-1', step_name: 'details', section_key: 'details.language', section_label: 'Language', sort_order: 1, is_reviewable: true, section_snapshot: { submitted_step: { sections: { 'details.language': { value: 'English' }, 'details.private_duplicate': { value: 'do not duplicate' } } } }, status: 'pending' }],
    listComments: async () => [{ id: 'comment-1', review_item_id: 'item-1', comment_text: 'Check this', admin_name: 'Rae', created_at: '2026-09-14T00:00:00Z' }],
    listRounds: async () => [{ id: 'round-1', round_number: 1, status: 'submitted', finalized_at: null, outcome: null }],
    ...overrides,
  };
}

test('assigned Google reviewer receives minimized frozen review data', async () => {
  const result = await resolvePrivilegedAdminReview(deps(), 'book-1');
  assert.equal(result.status, 200);
  assert.equal(result.body.ok, true);
  assert.deepEqual(result.body.items[0].snapshot, { value: { value: 'English' } });
  assert.equal(result.body.comments[0].body, 'Check this');
  assert.deepEqual(result.body.files, [{ fileName: 'manuscript.docx' }]);
  assert.equal(JSON.stringify(result.body).includes('reviewstudio_file_id'), false);
  assert.equal(JSON.stringify(result.body).includes('private_duplicate'), false);
});

test('assigned reviewer can load an immutable previous round by explicit id', async () => {
  const result = await resolvePrivilegedAdminReview(deps({
    findRound: async (id) => id === 'round-old' ? { id, book_id: 'book-1', round_number: 1, status: 'in_review', reviewer_user_id: 'reviewer-1', finalized_at: '2026-09-13T00:00:00Z', outcome: 'request_updates', submission_snapshot: {} } : null,
  }), 'book-1', 'round-old');
  assert.equal(result.status, 200);
  assert.equal(result.body.reviewRound.id, 'round-old');
  assert.equal(result.body.permissions.canMutate, false);
});

test('book id knowledge cannot bypass reviewer assignment', async () => {
  const result = await resolvePrivilegedAdminReview(deps({ findRound: async () => ({ id: 'round-1', book_id: 'book-1', status: 'submitted', reviewer_user_id: 'reviewer-2' }) }), 'book-1');
  assert.equal(result.status, 403);
});

test('missing review capability fails closed', async () => {
  const result = await resolvePrivilegedAdminReview(deps({ listGrants: async () => [] }), 'book-1');
  assert.equal(result.status, 403);
});

test('can_view_all_books may observe another reviewer without mutation authority', async () => {
  const result = await resolvePrivilegedAdminReview(deps({
    listGrants: async () => [{ capability_key: 'can_view_all_books', revoked_at: null }],
    findRound: async () => ({ id: 'round-1', book_id: 'book-1', round_number: 1, status: 'in_review', reviewer_user_id: 'reviewer-2', submission_snapshot: {} }),
  }), 'book-1');
  assert.equal(result.status, 200);
  assert.equal(result.body.permissions.canMutate, false);
});

test('inactive book or mismatched latest round cannot be loaded', async () => {
  const inactive = await resolvePrivilegedAdminReview(deps({ findBook: async () => ({ id: 'book-1', overall_status: 'draft', latest_review_round_id: 'round-1', assigned_reviewer_user_id: 'reviewer-1' }) }), 'book-1');
  assert.equal(inactive.status, 409);
  const mismatch = await resolvePrivilegedAdminReview(deps({ findRound: async () => ({ id: 'round-2', book_id: 'book-1', status: 'submitted', reviewer_user_id: 'reviewer-1' }) }), 'book-1');
  assert.equal(mismatch.status, 409);
});

test('latest finalized round remains available as immutable history', async () => {
  const result = await resolvePrivilegedAdminReview(deps({
    findBook: async () => ({ id: 'book-1', overall_status: 'EMPLOYEE_UPDATES', latest_review_round_id: 'round-1', assigned_reviewer_user_id: 'reviewer-1' }),
    findRound: async () => ({ id: 'round-1', book_id: 'book-1', round_number: 1, status: 'in_review', reviewer_user_id: 'reviewer-1', finalized_at: '2026-09-14T00:00:00Z', outcome: 'request_updates', submission_snapshot: {} }),
  }), 'book-1');
  assert.equal(result.status, 200);
  assert.equal(result.body.permissions.canMutate, false);
  assert.equal(result.body.reviewRound.outcome, 'request_updates');
});
