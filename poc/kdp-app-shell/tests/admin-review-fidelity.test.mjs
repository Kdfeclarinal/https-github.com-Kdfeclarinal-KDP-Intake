import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const page = readFileSync(new URL('../src/adminReview/AdminReviewPage.jsx', import.meta.url), 'utf8');
const submitted = readFileSync(new URL('../src/adminReview/AdminSubmittedStep.jsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/app.css', import.meta.url), 'utf8');

test('admin review renders the frozen employee-facing submission instead of a generic metadata inspector', () => {
  assert.match(page, /SubmittedSectionBody/);
  assert.doesNotMatch(page, /ReadOnlyValue/);
  assert.doesNotMatch(page, /Storage Strategy/i);
  assert.doesNotMatch(page, /Wrapper Selector/i);
  assert.doesNotMatch(page, /Books Column/i);
});

test('details review preserves recognizable employee controls and reviewer actions', () => {
  for (const contract of [
    'Book Title',
    'Subtitle (Optional)',
    'Primary Author or Contributor',
    'Your title’s current categories',
    'Your Keywords (Optional)',
    'I am ready to release my book now',
  ]) assert.ok(submitted.includes(contract), `missing employee-facing contract: ${contract}`);
  assert.match(page, /APPROVE/);
  assert.match(page, /Approve All/);
  assert.match(page, /Review Next Page/);
});

test('review panel follows the approved comments and filter composition', () => {
  assert.match(page, /Latest Comment/);
  assert.match(page, /Oldest Comment/);
  assert.match(page, /ADD YOUR COMMENT/);
  assert.match(css, /right:\s*calc\(100% \+ 12px\)/);
  assert.match(css, /kdp-review-comment-list/);
});
