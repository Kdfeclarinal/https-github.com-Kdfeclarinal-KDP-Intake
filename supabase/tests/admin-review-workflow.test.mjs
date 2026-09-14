import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assertEmployeeUpdateSections,
  assertEmployeeUpdateFileSection,
  assertEmployeeUpdateExtractedFields,
  assertPageMayAdvance,
  assertWholeBookOutcome,
  deriveSectionState,
  nextRoundDecisions,
  validateReviewMutation,
} from '../functions/_shared/adminReviewWorkflow.ts';

const actor = { id: 'reviewer-1', capabilities: ['can_review', 'can_finalize_book'] };
const round = { id: 'round-1', book_id: 'book-1', reviewer_user_id: 'reviewer-1', status: 'in_review', finalized_at: null };

test('assigned active reviewer may mutate only an item in the active book round', () => {
  assert.doesNotThrow(() => validateReviewMutation({ actor, round, book: { id: 'book-1', latest_review_round_id: 'round-1' }, item: { id: 'item-1', book_id: 'book-1', review_round_id: 'round-1' } }));
  assert.throws(() => validateReviewMutation({ actor, round, book: { id: 'book-2', latest_review_round_id: 'round-1' }, item: { id: 'item-1', book_id: 'book-1', review_round_id: 'round-1' } }), /not authorized/i);
  assert.throws(() => validateReviewMutation({ actor: { ...actor, id: 'reviewer-2' }, round, book: { id: 'book-1', latest_review_round_id: 'round-1' }, item: { id: 'item-1', book_id: 'book-1', review_round_id: 'round-1' } }), /not assigned/i);
  assert.throws(() => validateReviewMutation({ actor, round: { ...round, finalized_at: '2026-09-14T00:00:00Z' }, book: { id: 'book-1', latest_review_round_id: 'round-1' }, item: { id: 'item-1', book_id: 'book-1', review_round_id: 'round-1' } }), /immutable/i);
});

test('section state follows unresolved actionable threads and never auto-approves', () => {
  assert.equal(deriveSectionState('approved', [{ actionable: true, resolved: false }]), 'needs_updates');
  assert.equal(deriveSectionState('needs_updates', [{ actionable: true, resolved: true }]), 'pending');
  assert.equal(deriveSectionState('approved', [{ actionable: false, resolved: false }]), 'approved');
});

test('page navigation requires all required sections to be decided', () => {
  assert.throws(() => assertPageMayAdvance([{ label: 'Title', required: true, decision: 'pending' }]), /Title/);
  assert.doesNotThrow(() => assertPageMayAdvance([{ required: true, decision: 'approved' }, { required: true, decision: 'needs_updates' }]));
});

test('whole-book outcomes enforce finalization capability and authoritative decisions', () => {
  assert.equal(assertWholeBookOutcome({ actor, outcome: 'request_updates', items: [{ required: true, decision: 'needs_updates', unresolvedActionable: 1 }] }), 'EMPLOYEE_UPDATES');
  assert.equal(assertWholeBookOutcome({ actor, outcome: 'approve_book', items: [{ required: true, decision: 'approved', unresolvedActionable: 0 }] }), 'KDP_INTAKE_APPROVED');
  assert.throws(() => assertWholeBookOutcome({ actor: { ...actor, capabilities: ['can_review'] }, outcome: 'approve_book', items: [{ required: true, decision: 'approved' }] }), /finalize/i);
  assert.throws(() => assertWholeBookOutcome({ actor, outcome: 'request_updates', items: [{ required: true, decision: 'pending' }] }), /pending/i);
  assert.throws(() => assertWholeBookOutcome({ actor, outcome: 'approve_book', items: [{ required: true, decision: 'needs_updates', unresolvedActionable: 1 }] }), /approved/i);
});

test('carry-forward is conservative and invalidated by changes, requests, reopen, or dependencies', () => {
  const previous = [
    { sectionKey: 'details.language', decision: 'approved', snapshotHash: 'same' },
    { sectionKey: 'details.title', decision: 'approved', snapshotHash: 'old' },
    { sectionKey: 'pricing.territories', decision: 'approved', snapshotHash: 'same', requested: true },
  ];
  const next = nextRoundDecisions(previous, [
    { sectionKey: 'details.language', snapshotHash: 'same' },
    { sectionKey: 'details.title', snapshotHash: 'new' },
    { sectionKey: 'pricing.territories', snapshotHash: 'same' },
  ]);
  assert.deepEqual(next, {
    'details.language': 'approved',
    'details.title': 'pending',
    'pricing.territories': 'pending',
  });
});

test('employee updates may change only requested sections', () => {
  const existing = { sections: { title: { value: 'Old' }, language: { value: 'English' } } };
  assert.doesNotThrow(() => assertEmployeeUpdateSections(existing, { sections: { title: { value: 'New' }, language: { value: 'English' } } }, ['title']));
  assert.throws(() => assertEmployeeUpdateSections(existing, { sections: { title: { value: 'Old' }, language: { value: 'French' } } }, ['title']), /locked/i);
  assert.doesNotThrow(() => assertEmployeeUpdateSections(existing, { sections: { title: { value: 'New' }, language: { value: 'English' } } }, ['details.title']));
});

test('employee extracted fields cannot bypass an approved section lock', () => {
  assert.throws(() => assertEmployeeUpdateExtractedFields(
    { book_title: 'Approved title', primary_marketplace: 'amazon.com' },
    { book_title: 'Injected title', primary_marketplace: 'amazon.com' },
    ['details.language'],
    'details',
  ), /locked/i);
  assert.doesNotThrow(() => assertEmployeeUpdateExtractedFields(
    { book_title: 'Old title', primary_marketplace: 'amazon.com' },
    { book_title: 'Requested title', primary_marketplace: 'amazon.com' },
    ['details.book_title'],
    'details',
  ));
});

test('employee file replacement requires that exact file section to be requested', () => {
  assert.doesNotThrow(() => assertEmployeeUpdateFileSection('EMPLOYEE_UPDATES', ['manuscript'], 'manuscript'));
  assert.throws(() => assertEmployeeUpdateFileSection('needs_updates', ['cover'], 'manuscript'), /locked/i);
  assert.doesNotThrow(() => assertEmployeeUpdateFileSection('draft', [], 'manuscript'));
});
