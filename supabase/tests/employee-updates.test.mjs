import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveReadyForRereview,
  sanitizeEmployeeUpdateContext,
} from '../functions/_shared/employeeUpdates.ts';

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

test('meaningful normalized change or a later continuation reply independently makes a thread ready', () => {
  const base = {
    baselineValue: { value: '  Same title  ', metadata: { order: 1 } },
    currentValue: { metadata: { order: 1 }, value: 'Same title' },
    baselineFiles: [],
    currentFiles: [],
    requestedAt: '2026-09-14T10:00:00Z',
  };

  assert.deepEqual(deriveReadyForRereview(base), {
    ready: false,
    viaReply: false,
    viaChange: false,
    viaFileChange: false,
  });
  assert.equal(deriveReadyForRereview({ ...base, currentValue: { value: 'A new title', metadata: { order: 1 } } }).ready, true);
  assert.equal(deriveReadyForRereview({ ...base, replies: [{ created_at: '2026-09-14T10:01:00Z' }] }).ready, true);
});

test('file identity changes are meaningful but readiness never becomes review resolution', () => {
  const result = deriveReadyForRereview({
    baselineValue: null,
    currentValue: null,
    baselineFiles: [{ id: 'file-1', version_number: 1 }],
    currentFiles: [{ id: 'file-2', version_number: 2 }],
    replies: [],
  });
  assert.deepEqual(result, {
    ready: true,
    viaReply: false,
    viaChange: false,
    viaFileChange: true,
  });
  assert.equal(Object.hasOwn(result, 'resolved'), false);
  assert.equal(Object.hasOwn(result, 'decision'), false);
});

test('employee context reads replies and readiness from continuation state, not finalized comments', () => {
  const result = sanitizeEmployeeUpdateContext({
    updateCycleId: 'cycle-1',
    roundNumber: 1,
    step: 'details',
    items: [{ id: 'i1', step_name: 'details', section_key: 'details.book_title', decision: 'needs_updates' }],
    comments: [{ id: 'c1', review_item_id: 'i1', body: 'Historical request', actionable: true }],
    threads: [{
      id: 'thread-1', source_item_id: 'i1', source_comment_id: 'c1', step_name: 'details',
      section_key: 'details.book_title', request_body_snapshot: 'Historical request',
      requested_at: '2026-09-14T10:00:00Z', baseline_value: { value: 'Old' },
      baseline_file_references: [], status: 'active',
    }],
    replies: [{ id: 'reply-1', update_thread_id: 'thread-1', body: 'Updated.', author_name_snapshot: 'Employee', created_at: '2026-09-14T10:01:00Z' }],
    currentSections: { book_title: { value: 'Old' } },
    currentFiles: [],
  });
  assert.equal(result.threads[0].id, 'c1');
  assert.equal(result.updateCycleId, 'cycle-1');
  assert.equal(result.threads[0].continuationId, 'thread-1');
  assert.equal(result.threads[0].replies[0].body, 'Updated.');
  assert.equal(result.threads[0].readyForRereview, true);
  assert.equal(result.threads[0].resolved, undefined);
});
