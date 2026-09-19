import test from 'node:test';
import assert from 'node:assert/strict';

import { syncBasecampReviewOutcome } from '../functions/_shared/basecampOutcomeLifecycle.ts';

test('request updates creates the next employee task before completing review', async () => {
  const calls = [];
  const result = await syncBasecampReviewOutcome({
    outcome: 'request_updates', round: { id: 'round-1', roundNumber: 1 }, employeePersonId: '42', reviewerName: 'Rae Reviewer', requestedSections: ['Book Title', 'Kindle eBook Cover'],
    reviewTodo: { id: 'review-task', completed: false }, existingEmployeeTodo: null,
    completeTodo: async () => calls.push('complete'),
    createEmployeeTodo: async (payload) => { calls.push(payload); return { id: 'employee-task' }; },
    persist: async (patch) => calls.push(patch),
  });
  assert.equal(result.status, 'ready');
  assert.equal(calls[0].content, 'KDP Pre-Press — Stage 2');
  assert.deepEqual(calls[0].assignee_ids, [42]);
  assert.equal(calls[1], 'complete');
  assert.match(calls[0].description, /Reviewer:<\/strong> Rae Reviewer/);
  assert.match(calls[0].description, /2 sections require updates/);
  assert.match(calls[0].description, /Book Title/);
  assert.match(calls[0].description, /Open the existing KDP Pre-Press link/);
  assert.doesNotMatch(calls[0].description, /private comment body/);
});

test('request updates fails safely instead of creating an unassigned employee task', async () => {
  let createCount = 0;
  let persisted;
  const result = await syncBasecampReviewOutcome({
    outcome: 'request_updates', round: { id: 'round-1', roundNumber: 1 }, employeePersonId: null,
    reviewTodo: { id: 'review-task', completed: true }, existingEmployeeTodo: null,
    completeTodo: async () => {},
    createEmployeeTodo: async () => { createCount += 1; return { id: 'wrong' }; },
    persist: async (patch) => { persisted = patch; },
  });
  assert.equal(result.status, 'failed');
  assert.equal(createCount, 0);
  assert.equal(persisted.status, 'failed');
});
