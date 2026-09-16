import test from 'node:test';
import assert from 'node:assert/strict';
import { userFacingError } from '../src/errors/userFacingError.js';
import { bookshelfBookView, deriveBookAttention, filterAndSortBooks } from '../src/bookshelf/bookshelfState.js';
import { commentMutationControls, terminalReviewConfirmation } from '../src/adminReview/adminReviewState.js';

test('privileged errors never expose raw network or internal failures', () => {
  assert.deepEqual(userFacingError(new TypeError('Failed to fetch')), {
    kind: 'network',
    message: 'The service could not be reached. Check your connection and try again.',
    action: 'retry',
  });
  assert.deepEqual(userFacingError({ status: 401, message: 'JWT expired' }), {
    kind: 'auth',
    message: 'Your session has expired. Sign in again to continue.',
    action: 'sign_in',
  });
  assert.equal(userFacingError({ status: 403, message: 'database policy detail' }).message, 'You do not have permission to perform this action.');
  assert.equal(userFacingError({ status: 409, message: 'serialization detail' }).action, 'reload');
  assert.equal(userFacingError(new Error('relation private_table does not exist')).message, 'The requested action could not be completed. Try again.');
});

test('comment controls honor server-derived ownership and finalized immutability', () => {
  assert.deepEqual(commentMutationControls({ permissions: { canReply: true, canEdit: true, canDelete: true, canResolve: true } }, false), {
    reply: true, edit: true, delete: true, resolve: true,
  });
  assert.deepEqual(commentMutationControls({ permissions: { canReply: true, canEdit: false, canDelete: false, canResolve: true } }, false), {
    reply: true, edit: false, delete: false, resolve: true,
  });
  assert.deepEqual(commentMutationControls({ permissions: { canReply: true, canEdit: true, canDelete: true, canResolve: true } }, true), {
    reply: false, edit: false, delete: false, resolve: false,
  });
});

test('terminal confirmation summarizes the authoritative consequence without claiming Amazon publication', () => {
  const requested = terminalReviewConfirmation('request_updates', [
    { decision: 'needs_updates', label: 'Book Title' },
    { decision: 'approved', label: 'Language' },
  ]);
  assert.equal(requested.title, 'Request employee updates?');
  assert.deepEqual(requested.sections, ['Book Title']);
  assert.match(requested.body, /finalize/i);
  assert.match(requested.body, /employee update work will begin/i);

  const approved = terminalReviewConfirmation('approve_book', [{ decision: 'approved', label: 'Book Title' }]);
  assert.equal(approved.title, 'Approve this KDP Intake?');
  assert.match(approved.body, /does not publish/i);
  assert.doesNotMatch(approved.body, /has been published/i);
});

test('Bookshelf exposes compact assignment, file, attention, and Trash state', () => {
  const now = Date.parse('2026-09-16T12:00:00Z');
  assert.deepEqual(deriveBookAttention({ status: 'AWAITING_REVIEW', attentionStartedAt: '2026-09-14T12:00:00Z' }, {
    reviewDueHours: 24,
    reviewEscalationHours: 72,
  }, now), { state: 'overdue', since: '2026-09-14T12:00:00Z' });
  assert.equal(deriveBookAttention({ status: 'AWAITING_REVIEW', attentionStartedAt: '2026-09-12T12:00:00Z' }, {
    reviewDueHours: 24,
    reviewEscalationHours: 72,
  }, now).state, 'escalated');
  assert.equal(deriveBookAttention({ status: 'AWAITING_REVIEW', attentionStartedAt: '2026-09-15T18:00:00Z' }, {
    reviewDueHours: 24,
    reviewEscalationHours: 72,
  }, now), null);

  const view = bookshelfBookView({ id: 'b1', status: 'IN_REVIEW', employeeName: 'Em Employee', reviewerName: 'Rae Reviewer',
    latestFiles: [{ fileType: 'manuscript', fileName: 'book.docx', url: 'https://example.test/file' }],
    attention: { state: 'overdue', since: '2026-09-14T12:00:00Z' } });
  assert.equal(view.employeeName, 'Em Employee');
  assert.equal(view.reviewerName, 'Rae Reviewer');
  assert.equal(view.latestFiles[0].fileName, 'book.docx');
  assert.equal(view.attention.state, 'overdue');

  const books = [{ id: 'active', status: 'draft' }, { id: 'trash', status: 'draft', deletedAt: '2026-09-15T00:00:00Z' }];
  assert.deepEqual(filterAndSortBooks(books, { view: 'all' }).map((book) => book.id), ['active']);
  assert.deepEqual(filterAndSortBooks(books, { view: 'trash' }).map((book) => book.id), ['trash']);
});
