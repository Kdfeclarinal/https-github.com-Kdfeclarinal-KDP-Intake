import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const migration = readFileSync(new URL('../migrations/20260919000000_review_operations_ux.sql', import.meta.url), 'utf8');
const reopenEdge = readFileSync(new URL('../functions/reopenEmployeeReviewSection/index.ts', import.meta.url), 'utf8');
const trashEdge = readFileSync(new URL('../functions/mutateBookTrash/index.ts', import.meta.url), 'utf8');
const saveEdge = readFileSync(new URL('../functions/saveEmployeeStep/index.ts', import.meta.url), 'utf8');
const uploadEdge = readFileSync(new URL('../functions/uploadContentFileToReviewStudio/uploadContentFileToReviewStudio_reviewstudio_flow.ts', import.meta.url), 'utf8');
const retryEdge = readFileSync(new URL('../functions/retryBasecampEmployeeReassignment/index.ts', import.meta.url), 'utf8');
const closeoutUrl = new URL('../migrations/20260920000000_activation_blocker_closeout.sql', import.meta.url);
const closeout = existsSync(closeoutUrl) ? readFileSync(closeoutUrl, 'utf8') : '';

test('employee reopen is scoped, reasoned, CAS-protected, immutable, and never rewrites finalized review items', () => {
  assert.match(migration, /create table public\.book_review_update_reopens/);
  assert.match(migration, /reason text not null[\s\S]*between 1 and 1000/);
  assert.match(migration, /p_expected_revision[\s\S]*employee_revision is distinct from p_expected_revision/);
  assert.match(migration, /Only an approved section may be reopened/);
  assert.match(migration, /book_review_update_reopens_immutable/);
  const reopenFunction = migration.match(/create or replace function public\.reopen_employee_review_section[\s\S]*?revoke all on function public\.reopen_employee_review_section/)?.[0] || '';
  assert.doesNotMatch(reopenFunction, /update public\.book_review_items/);
  assert.match(migration, /before insert on public\.book_review_items[\s\S]*invalidate_reopened_review_item_carry/);
  assert.match(migration, /primary_marketplace[\s\S]*step_name::text='pricing'[\s\S]*decision='approved'/);
});

test('employee loaders, saves, and uploads use server-recorded reopened sections', () => {
  assert.match(saveEdge, /from\("book_review_update_reopens"\)/);
  assert.match(uploadEdge, /from\("book_review_update_reopens"\)/);
  assert.match(reopenEdge, /reopen_employee_review_section/);
  assert.match(reopenEdge, /expectedRevision/);
});

test('Trash and Recover are privileged soft-state operations with CAS, token revocation, and no raw recovery token response', () => {
  assert.match(migration, /deleted_by_privileged_user_id/);
  assert.match(migration, /trash_revision bigint not null default 0/);
  assert.match(migration, /can_manage_users/);
  assert.match(migration, /update public\.book_access_tokens set revoked_at/);
  assert.match(migration, /book_recovery_sync_requested/);
  assert.match(trashEdge, /requiredCapability: 'can_manage_users'/);
  assert.match(trashEdge, /employeeAccessReestablished/);
  assert.doesNotMatch(trashEdge, /return json\([^\n]*rawToken/);
});

test('Recover persists one reproducible access identity and retry reuses it without inserting access', () => {
  assert.match(closeout, /p_recovery_integration_event_id uuid/i);
  assert.match(closeout, /source','book_recovery','integration_event_id',p_recovery_integration_event_id/i);
  assert.match(closeout, /insert into public\.integration_events\(id,provider,event_type,book_id,status,payload_json,metadata\)[\s\S]*employee_access_recovery_requested/i);
  assert.match(closeout, /trash_revision is distinct from p_expected_revision/i);
  assert.match(trashEdge, /deriveEmployeeReassignmentToken\(secret, integrationEventId\)/);
  assert.match(retryEdge, /employee_access_recovery_requested/);
  assert.match(retryEdge, /resolveEmployeeReassignmentToken/);
  assert.match(retryEdge, /EMPLOYEE_ACCESS_TOKEN_DERIVATION_PREVIOUS_SECRET/);
  assert.match(retryEdge, /eq\('book_id', body\.bookId\)/);
  assert.doesNotMatch(retryEdge, /insert\([^)]*book_access_tokens|\.rpc\('set_kdp_book_trash_state'/i);
  assert.doesNotMatch(`${closeout}\n${trashEdge}\n${retryEdge}`, /raw[_ ]?token[^\n]*(insert|update).*book_access_tokens/i);
});

test('Recover reports delivery only after durable downstream settlement', () => {
  assert.match(trashEdge, /employeeAccessReestablished: basecamp\.status === 'ready'/);
  assert.match(trashEdge, /basecampSyncRequired: data\.recovery_event_id \? basecamp\.status !== 'ready' : data\.basecamp_sync_required === true/);
  assert.match(retryEdge, /integration event settlement failed/i);
  assert.doesNotMatch(trashEdge, /employeeAccessReestablished: data\.employee_access_reestablished/);
});

test('employee access delivery is claimed and serialized before any Basecamp write', () => {
  assert.match(closeout, /claim_employee_access_delivery/i);
  assert.match(closeout, /settle_employee_access_delivery/i);
  assert.match(closeout, /employee_access_one_in_flight/i);
  assert.match(closeout, /pg_advisory_xact_lock\(hashtextextended\('kdp:employee-access:'\|\|p_book_id::text,0\)\)/i);
  assert.match(trashEdge, /rpc\('claim_employee_access_delivery'/);
  assert.match(retryEdge, /rpc\('claim_employee_access_delivery'/);
  assert.match(trashEdge, /rpc\('settle_employee_access_delivery'/);
  assert.match(retryEdge, /rpc\('settle_employee_access_delivery'/);
});
