import test from 'node:test';
import assert from 'node:assert/strict';

import { mutatePrivilegedAdminReview } from '../functions/_shared/adminReviewMutation.ts';

function deps(overrides = {}) {
  const calls = [];
  return {
    calls,
    resolveActor: async () => ({ id: 'reviewer-1', capabilities: ['can_review', 'can_finalize_book'] }),
    findBook: async () => ({ id: 'book-1', latest_review_round_id: 'round-1' }),
    findRound: async () => ({ id: 'round-1', book_id: 'book-1', reviewer_user_id: 'reviewer-1', status: 'in_review', finalized_at: null }),
    findItem: async () => ({ id: 'item-1', book_id: 'book-1', review_round_id: 'round-1' }),
    applyAction: async (args) => { calls.push(args); return { ok: true }; },
    finalizeRound: async (args) => { calls.push(args); return { ok: true, outcome: args.outcome }; },
    reload: async () => ({ ok: true, items: [] }),
    ...overrides,
  };
}

test('approve persists before authoritative state is returned', async () => {
  const d = deps();
  const result = await mutatePrivilegedAdminReview(d, { bookId: 'book-1', reviewRoundId: 'round-1', action: 'approve', itemId: 'item-1' });
  assert.equal(result.status, 200);
  assert.equal(d.calls[0].action, 'approve');
  assert.equal(result.body.ok, true);
});

test('stale round and wrong item fail before persistence', async () => {
  const stale = deps({ findBook: async () => ({ id: 'book-1', latest_review_round_id: 'round-2' }) });
  assert.equal((await mutatePrivilegedAdminReview(stale, { bookId: 'book-1', reviewRoundId: 'round-1', action: 'approve', itemId: 'item-1' })).status, 403);
  assert.equal(stale.calls.length, 0);
  const wrong = deps({ findItem: async () => ({ id: 'item-1', book_id: 'book-2', review_round_id: 'round-1' }) });
  assert.equal((await mutatePrivilegedAdminReview(wrong, { bookId: 'book-1', reviewRoundId: 'round-1', action: 'approve', itemId: 'item-1' })).status, 403);
  assert.equal(wrong.calls.length, 0);
});

test('finalization requires explicit server capability', async () => {
  const d = deps({ resolveActor: async () => ({ id: 'reviewer-1', capabilities: ['can_review'] }) });
  const result = await mutatePrivilegedAdminReview(d, { bookId: 'book-1', reviewRoundId: 'round-1', action: 'approve_book' });
  assert.equal(result.status, 403);
  assert.equal(d.calls.length, 0);
});

test('owner-level finalizer may finalize without silently taking reviewer edits', async () => {
  const d = deps({
    resolveActor: async () => ({ id: 'owner-1', capabilities: ['can_review', 'can_view_all_books', 'can_finalize_book', 'can_manage_users'] }),
  });
  const result = await mutatePrivilegedAdminReview(d, { bookId: 'book-1', reviewRoundId: 'round-1', action: 'approve_book' });
  assert.equal(result.status, 200);
  assert.equal(d.calls[0].outcome, 'approve_book');
});

test('reaching an unlocked page is persisted before navigation', async () => {
  const d = deps();
  const result = await mutatePrivilegedAdminReview(d, { bookId: 'book-1', reviewRoundId: 'round-1', action: 'reach_step', step: 'content' });
  assert.equal(result.status, 200);
  assert.equal(d.calls[0].action, 'reach_step');
  assert.equal(d.calls[0].payload.step_name, 'content');
});
