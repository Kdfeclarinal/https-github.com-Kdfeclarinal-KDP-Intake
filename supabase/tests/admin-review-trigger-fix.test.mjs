import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(
  new URL('../migrations/20260923000000_admin_review_trigger_fix.sql', import.meta.url),
  'utf8',
);

test('review snapshot immutability uses table-specific trigger functions', () => {
  assert.match(source, /prevent_submitted_review_round_snapshot_mutation/i);
  assert.match(source, /prevent_submitted_review_item_snapshot_mutation/i);
  assert.match(source, /new\.submission_snapshot\s+is distinct from old\.submission_snapshot/i);
  assert.match(source, /new\.section_snapshot\s+is distinct from old\.section_snapshot/i);
  assert.doesNotMatch(
    source,
    /tg_table_name\s*=\s*'book_review_rounds'[\s\S]*new\.submission_snapshot[\s\S]*tg_table_name\s*=\s*'book_review_items'/i,
  );
  assert.match(source, /drop trigger if exists book_review_items_prevent_snapshot_mutation/i);
  assert.match(source, /before update on public\.book_review_items[\s\S]*prevent_submitted_review_item_snapshot_mutation/i);
});
