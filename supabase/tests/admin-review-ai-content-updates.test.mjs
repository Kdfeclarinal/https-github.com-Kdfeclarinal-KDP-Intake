import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const saveSource = readFileSync(new URL('../functions/saveEmployeeStep/index.ts', import.meta.url), 'utf8');
const finalizationMigration = readFileSync(new URL('../migrations/20260926000000_admin_review_finalization_fix.sql', import.meta.url), 'utf8');
const idempotencyMigration = readFileSync(new URL('../migrations/20260927000000_admin_review_finalization_idempotency_fix.sql', import.meta.url), 'utf8');
const revisionMigration = readFileSync(new URL('../migrations/20260928000000_admin_review_finalization_revision_fix.sql', import.meta.url), 'utf8');
const reviewFoundation = readFileSync(new URL('../migrations/20260914000000_review_round_completion.sql', import.meta.url), 'utf8');

test('Content completion requires structured AI disclosure with the exact all-None error', () => {
  assert.match(saveSource, /content\.ai_content/);
  assert.match(saveSource, /ai_generated_content/);
  assert.match(saveSource, /Specify what type of content was AI generated\. If none, select “No”\./);
  assert.match(saveSource, /details\.every\(\(value\) => value === 'none'\)|aiTexts === "none"[\s\S]*aiImages === "none"[\s\S]*aiTranslations === "none"/);
});

test('terminal review finalization writes enum-typed target statuses', () => {
  assert.match(finalizationMigration, /v_target public\.kdp_book_status/i);
  assert.match(finalizationMigration, /v_target := 'EMPLOYEE_UPDATES'::public\.kdp_book_status/i);
  assert.match(finalizationMigration, /v_target := 'KDP_INTAKE_APPROVED'::public\.kdp_book_status/i);
  assert.match(finalizationMigration, /from_status,to_status[\s\S]*v_book\.overall_status,v_target/i);
});

test('deleted actionable comment numbers remain historical and are never reused', () => {
  assert.match(reviewFoundation, /coalesce\(max\(round_comment_number\), 0\) \+ 1[\s\S]*book_review_comments[\s\S]*review_round_id = p_review_round_id/i);
  assert.doesNotMatch(reviewFoundation, /max\(round_comment_number\)[^;]*deleted_at\s+is\s+null/i);
});


test('Request Updates uses conflict-safe Basecamp reference settlement', () => {
  assert.match(idempotencyMigration, /on conflict do nothing/i);
  assert.doesNotMatch(idempotencyMigration, /on conflict\s*\(idempotency_key\)/i);
});

test('terminal CAS advances revision before the round becomes immutable', () => {
  const revisionUpdate = revisionMigration.indexOf('set revision=revision+1');
  const finalizerCall = revisionMigration.indexOf('v_result := public.finalize_kdp_review_round');
  assert.ok(revisionUpdate >= 0 && finalizerCall > revisionUpdate);
});
