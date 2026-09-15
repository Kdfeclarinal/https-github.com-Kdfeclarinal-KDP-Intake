import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(new URL('../migrations/20260916000000_optimistic_concurrency.sql', import.meta.url), 'utf8');
const saveEdge = readFileSync(new URL('../functions/saveEmployeeStep/index.ts', import.meta.url), 'utf8');
const uploadEdge = readFileSync(new URL('../functions/uploadContentFileToReviewStudio/uploadContentFileToReviewStudio_reviewstudio_flow.ts', import.meta.url), 'utf8');
const reviewerEdge = readFileSync(new URL('../functions/mutatePrivilegedAdminReview/index.ts', import.meta.url), 'utf8');

test('reviewer CAS covers the single mutation and finalization boundaries', () => {
  assert.match(migration, /book_review_rounds[\s\S]*revision bigint not null default 0/i);
  assert.match(migration, /apply_admin_review_action\([\s\S]*p_expected_revision bigint[\s\S]*errcode='40001'[\s\S]*revision=revision\+1/i);
  assert.match(migration, /finalize_kdp_review_round\([\s\S]*p_expected_revision bigint[\s\S]*finalized_at is not null[\s\S]*return public\.finalize_kdp_review_round[\s\S]*errcode='40001'[\s\S]*revision=revision\+1/i);
  assert.match(migration, /revoke all on function public\.apply_admin_review_action\(uuid,uuid,uuid,text,jsonb\) from service_role/i);
  assert.match(reviewerEdge, /p_expected_revision: expectedRevision/);
});

test('employee step save is one authorized atomic CAS mutation', () => {
  assert.match(migration, /books[\s\S]*employee_revision bigint not null default 0/i);
  assert.match(migration, /save_employee_step_if_revision\([\s\S]*for update[\s\S]*revoked_at[\s\S]*allowed_pages[\s\S]*allowed_actions[\s\S]*employee_revision is distinct from p_expected_revision[\s\S]*update public\.book_step_data[\s\S]*update public\.books[\s\S]*employee_revision=employee_revision\+1[\s\S]*insert into public\.book_status_history/i);
  assert.match(saveEdge, /p_expected_revision: expectedRevision/);
  assert.doesNotMatch(saveEdge, /\.from\("book_step_data"\)\s*\.upsert/);
});

test('file promotion compares revision and explicit observed current identity', () => {
  assert.match(migration, /promote_content_file_if_revision\([\s\S]*employee_revision is distinct from p_expected_revision[\s\S]*v_current_id is distinct from p_expected_old_file_id[\s\S]*is_latest=false[\s\S]*is_latest=true[\s\S]*employee_revision=employee_revision\+1/i);
  assert.match(uploadEdge, /observed_current_file_id/);
  assert.match(uploadEdge, /authoritativeCurrentId !== observedCurrentFile/);
  assert.match(uploadEdge, /is_latest: false/);
  assert.match(uploadEdge, /promote_content_file_if_revision/);
  assert.match(migration, /reconcile_missing_content_file\([\s\S]*is_latest=false[\s\S]*employee_revision=employee_revision\+1/i);
});

test('reply, initial submit, and resubmit use the same book revision', () => {
  for (const name of ['add_employee_review_reply', 'submit_kdp_book_for_approval', 'resubmit_kdp_book_for_review']) {
    assert.match(migration, new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*p_expected_revision bigint`, 'i'));
  }
  assert.match(migration, /status='consumed'[\s\S]*return public\.resubmit_kdp_book_for_review[\s\S]*employee_revision is distinct from p_expected_revision/i);
});
