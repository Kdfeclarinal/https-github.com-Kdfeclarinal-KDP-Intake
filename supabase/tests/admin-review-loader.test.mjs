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
    findRound: async () => ({ id: 'round-1', book_id: 'book-1', round_number: 1, status: 'submitted', reviewer_user_id: 'reviewer-1', revision: 7, submission_snapshot: { files: [{ file_name: 'manuscript.docx', reviewstudio_file_id: 'private-id' }] } }),
    listItems: async () => [{ id: 'item-1', step_name: 'details', section_key: 'details.language', section_label: 'Language', sort_order: 1, is_reviewable: true, section_snapshot: { submitted_step: { sections: { 'details.language': { value: 'English' }, 'details.private_duplicate': { value: 'do not duplicate' } } } }, status: 'pending' }],
    listComments: async () => [{ id: 'comment-1', review_item_id: 'item-1', comment_text: 'Check this', admin_name: 'Rae', author_privileged_user_id: 'reviewer-1', actionable: true, created_at: '2026-09-14T00:00:00Z' }],
    listRounds: async () => [{ id: 'round-1', round_number: 1, status: 'submitted', finalized_at: null, outcome: null }],
    listContinuations: async () => [],
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
  assert.equal(result.body.reviewRound.revision, 7);
  assert.deepEqual(result.body.comments[0].permissions, { canReply: true, canEdit: true, canResolve: true, canDelete: true });
});

test('comment permissions are actor-owned and finalized rounds are immutable', async () => {
  const active = await resolvePrivilegedAdminReview(deps({
    listComments: async () => [
      { id: 'own', review_item_id: 'item-1', comment_text: 'Own', author_privileged_user_id: 'reviewer-1', actionable: true },
      { id: 'other', review_item_id: 'item-1', comment_text: 'Other', author_privileged_user_id: 'reviewer-2', actionable: true },
    ],
  }), 'book-1');
  assert.deepEqual(active.body.comments.map((comment) => comment.permissions), [
    { canReply: true, canEdit: true, canResolve: true, canDelete: true },
    { canReply: true, canEdit: false, canResolve: true, canDelete: false },
  ]);

  const historical = await resolvePrivilegedAdminReview(deps({
    findRound: async () => ({ id: 'round-1', book_id: 'book-1', round_number: 1, status: 'in_review', reviewer_user_id: 'reviewer-1', finalized_at: '2026-09-14T00:00:00Z', outcome: 'request_updates', submission_snapshot: {} }),
  }), 'book-1');
  assert.deepEqual(historical.body.comments[0].permissions, { canReply: false, canEdit: false, canResolve: false, canDelete: false });
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

test('next active round exposes minimized linked continuation context', async () => {
  const result = await resolvePrivilegedAdminReview(deps({
    listContinuations: async () => [{
      id: 'thread-1', target_comment_id: 'comment-1', target_item_id: 'item-1', source_round_number: 1,
      request_body_snapshot: 'Please fix the title.', request_number_snapshot: 2,
      reviewer_name_snapshot: 'Prior reviewer', requested_at: '2026-09-14T00:00:00Z',
      ready_via_reply: true, ready_via_change: false, ready_via_file_change: false,
      ready_at: '2026-09-14T01:00:00Z', readiness_evidence: { changed: false },
      replies: [{ id: 'reply-1', body: 'Fixed.', author_name_snapshot: 'Employee', created_at: '2026-09-14T00:30:00Z', author_employee_token_id: 'private-token' }],
    }],
  }), 'book-1');
  assert.equal(result.status, 200);
  assert.equal(result.body.comments[0].continuation.originalRequest, 'Please fix the title.');
  assert.equal(result.body.comments[0].continuation.employeeReplies[0].body, 'Fixed.');
  assert.equal(JSON.stringify(result.body).includes('private-token'), false);
});

test('historical response preserves finalized attribution and safe file version identity', async () => {
  const result = await resolvePrivilegedAdminReview(deps({
    findRound: async () => ({
      id: 'round-1', book_id: 'book-1', round_number: 1, status: 'in_review', reviewer_user_id: 'reviewer-1',
      finalized_at: '2026-09-14T00:00:00Z', finalized_by_name: 'Rae Reviewer', reviewer_name_snapshot: 'Rae Reviewer',
      outcome: 'request_updates', submission_snapshot: { schema_version: 2, files: [{ file_name: 'manuscript.docx', file_type: 'manuscript', version_number: 3, mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', file_size_bytes: 4096, created_at: '2026-09-13T10:00:00Z', reviewstudio_file_id: 'private-id' }] },
    }),
  }), 'book-1');
  assert.equal(result.body.reviewRound.finalizedBy, 'Rae Reviewer');
  assert.equal(result.body.reviewRound.reviewer, 'Rae Reviewer');
  assert.equal(result.body.reviewRound.snapshotIdentity, 'round-1-schema-2');
  assert.deepEqual(result.body.files, [{ fileName: 'manuscript.docx', fileType: 'manuscript', versionNumber: 3, mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', fileSizeBytes: 4096, createdAt: '2026-09-13T10:00:00Z' }]);
});


test('submitted step payload preserves employee-facing values without storage metadata', async () => {
  const result = await resolvePrivilegedAdminReview(deps({
    findRound: async () => ({
      id: 'round-1',
      book_id: 'book-1',
      round_number: 1,
      status: 'submitted',
      reviewer_user_id: 'reviewer-1',
      revision: 7,
      submission_snapshot: {
        files: [],
        steps: {
          details: {
            state_json: {
              sections: {
                language: { value: 'english', sectionKey: 'language', storageStrategy: 'page_json', wrapperSelector: '#private' },
                book_title: { value: 'Visible Title', sectionKey: 'book_title', booksColumn: 'book_title' },
                subtitle: { value: 'Visible Subtitle', sectionKey: 'subtitle' },
                primary_author: { value: 'Ada Author', fields: { author_first_name: 'Ada', author_last_name: 'Author' }, sectionKey: 'primary_author' },
                publishing_rights: { value: 'copyright_owner', label: 'I own the copyright', sectionKey: 'publishing_rights' },
                adult_question: { value: 'no', label: 'No', sectionKey: 'adult_question' },
                age_grade_range: { value: { reading_age_min: '8', reading_age_max: '12' }, fields: { reading_age_min: '8', reading_age_max: '12' } },
              },
            },
          },
          content: {
            state_json: { sections: { ai_content: { value: 'no' }, accessibility: { value: 'all' } } },
          },
          pricing: {
            state_json: { sections: { kdp_select: { enrolled: true }, royalty_and_pricing: { royaltyPlan: '35', marketplaces: [] } } },
          },
        },
      },
    }),
  }), 'book-1');

  assert.equal(result.status, 200);
  assert.equal(result.body.submittedSteps.details.book_title, 'Visible Title');
  assert.equal(result.body.submittedSteps.details.subtitle, 'Visible Subtitle');
  assert.deepEqual(result.body.submittedSteps.details.author, { value: 'Ada Author', firstName: 'Ada', lastName: 'Author' });
  assert.equal(result.body.submittedSteps.details.primaryAudience.adult, 'no');
  assert.deepEqual(result.body.submittedSteps.details.primaryAudience.age, { min: '8', max: '12' });
  assert.equal(result.body.submittedSteps.content.aiGenerated, 'no');
  assert.equal(result.body.submittedSteps.pricing.kdpSelect.enrolled, true);
  assert.equal(JSON.stringify(result.body.submittedSteps).includes('storageStrategy'), false);
  assert.equal(JSON.stringify(result.body.submittedSteps).includes('wrapperSelector'), false);
  assert.equal(JSON.stringify(result.body.submittedSteps).includes('booksColumn'), false);
});
