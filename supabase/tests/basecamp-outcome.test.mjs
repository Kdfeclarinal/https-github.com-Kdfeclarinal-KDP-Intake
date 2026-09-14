import test from 'node:test';
import assert from 'node:assert/strict';

import { syncBasecampReviewOutcome } from '../functions/_shared/basecampOutcomeLifecycle.ts';

test('request updates completes the review task and creates one assigned employee task', async () => {
  const calls = [];
  const result = await syncBasecampReviewOutcome({
    outcome: 'request_updates', round: { id: 'round-1', roundNumber: 1 }, employeePersonId: '42',
    reviewTodo: { id: 'review-task', completed: false }, existingEmployeeTodo: null,
    completeTodo: async () => calls.push('complete'),
    createEmployeeTodo: async (payload) => { calls.push(payload); return { id: 'employee-task' }; },
    persist: async (patch) => calls.push(patch),
  });
  assert.equal(result.status, 'ready');
  assert.deepEqual(calls[1].assignee_ids, [42]);
  assert.equal(calls[1].content, 'Employee Updates — Round 1');
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
