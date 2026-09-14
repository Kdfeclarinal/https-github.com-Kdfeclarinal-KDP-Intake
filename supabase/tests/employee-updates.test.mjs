import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeEmployeeUpdateContext } from '../functions/_shared/employeeUpdates.ts';

test('employee receives only requested sections and safe actionable thread data', () => {
  const result = sanitizeEmployeeUpdateContext({ roundNumber: 1, step: 'details', items: [
    { id: 'i1', step_name: 'details', section_key: 'title', decision: 'needs_updates' },
    { id: 'i2', step_name: 'details', section_key: 'language', decision: 'approved' },
  ], comments: [{ id: 'c1', review_item_id: 'i1', body: 'Fix title', round_comment_number: 1, admin_email: 'private@example.com' }] });
  assert.deepEqual(result.editableSectionKeys, ['title']);
  assert.equal(result.threads[0].body, 'Fix title');
  assert.equal(JSON.stringify(result).includes('private@example.com'), false);
});

test('qualified database section keys are exposed as step-local employee keys', () => {
  const result = sanitizeEmployeeUpdateContext({ roundNumber: 2, step: 'details', items: [
    { id: 'i1', step_name: 'details', section_key: 'details.book_title', decision: 'needs_updates' },
  ], comments: [{ id: 'c1', review_item_id: 'i1', body: 'Fix title', actionable: true }] });
  assert.deepEqual(result.editableSectionKeys, ['book_title']);
  assert.equal(result.threads[0].sectionKey, 'book_title');
});
