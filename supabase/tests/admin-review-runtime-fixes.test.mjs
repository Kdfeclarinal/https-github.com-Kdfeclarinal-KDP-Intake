import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const actorFix = readFileSync(new URL('../migrations/20260924000000_admin_review_status_actor_fix.sql', import.meta.url), 'utf8');
const commentFix = readFileSync(new URL('../migrations/20260925000000_admin_review_comment_persistence_fix.sql', import.meta.url), 'utf8');

test('review start records a valid admin actor and preserves privileged attribution', () => {
  assert.match(actorFix, /'review_started','admin',p_actor_user_id/i);
  assert.match(actorFix, /actor_privileged_user_id/i);
  assert.doesNotMatch(actorFix, /'review_started','privileged'/i);
});

test('current review comments support both section-bound and general comments', () => {
  assert.match(commentFix, /alter column review_item_id drop not null/i);
  assert.match(commentFix, /alter column step_name drop not null/i);
  assert.match(commentFix, /alter column section_key drop not null/i);
});
