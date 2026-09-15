import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const app = read('../src/app.jsx');
const details = read('../src/details/DetailsPage.jsx');
const content = read('../src/content/ContentPage.jsx');
const pricing = read('../src/pricing/PricingPage.jsx');
const admin = read('../src/adminReview/AdminReviewPage.jsx');

test('employee pages send the loaded revision and refetch without replay on conflict', () => {
  assert.match(app, /employee_revision/);
  for (const source of [details, content, pricing]) {
    assert.match(source, /expected_revision/);
    assert.match(source, /status === 409/);
    assert.match(source, /onConcurrencyConflict\?\.\(\)/);
  }
  assert.match(content, /observed_current_file_id/);
});

test('reviewer mutation sends revision and conflict performs one authoritative reload', () => {
  assert.match(admin, /expectedRevision: reviewPayload\.reviewRound\.revision/);
  assert.match(admin, /error\?\.status === 409[\s\S]*loadPrivilegedAdminReview/);
  assert.doesNotMatch(admin, /error\?\.status === 409[\s\S]*mutatePrivilegedAdminReview/);
});
