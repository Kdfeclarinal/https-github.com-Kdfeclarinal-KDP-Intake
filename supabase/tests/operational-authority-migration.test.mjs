import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const sql = readFileSync(new URL('../migrations/20260917000000_operational_administration.sql', import.meta.url), 'utf8');
const config = readFileSync(new URL('../config.toml', import.meta.url), 'utf8');
const retrySource = readFileSync(new URL('../functions/retryBasecampEmployeeReassignment/index.ts', import.meta.url), 'utf8');
const closeoutSql = readFileSync(new URL('../migrations/20260918000000_administration_blocker_closeout.sql', import.meta.url), 'utf8');
const activationCloseoutUrl = new URL('../migrations/20260920000000_activation_blocker_closeout.sql', import.meta.url);
const activationCloseoutSql = existsSync(activationCloseoutUrl) ? readFileSync(activationCloseoutUrl, 'utf8') : '';

test('first Owner bootstrap is a single-use service-role transaction for an explicit Google identity', () => {
  const bootstrap = activationCloseoutSql.match(/create or replace function public\.bootstrap_initial_owner[\s\S]*?grant execute on function public\.bootstrap_initial_owner/)?.[0] || '';
  assert.match(bootstrap, /p_auth_user_id uuid/i);
  assert.match(bootstrap, /pg_advisory_xact_lock\s*\(hashtext\('kdp:owner-administration'\)\)/i);
  assert.match(bootstrap, /from auth\.users[\s\S]*id=p_auth_user_id/i);
  assert.match(bootstrap, /provider[\s\S]*google/i);
  assert.match(bootstrap, /role_key='owner'[\s\S]*capability_key='can_manage_users'[\s\S]*revoked_at is null/i);
  assert.match(bootstrap, /A valid active Owner already exists/i);
  assert.match(bootstrap, /insert into public\.administrative_audit_events/i);
  assert.match(bootstrap, /revoke all on function public\.bootstrap_initial_owner\(uuid,text\) from public,anon,authenticated/i);
  assert.match(activationCloseoutSql, /grant execute on function public\.bootstrap_initial_owner\(uuid,text\) to service_role/i);
  assert.doesNotMatch(bootstrap, /@[a-z0-9.-]+\.[a-z]{2,}/i);
});

test('Owner administration is transactional and cannot remove the final active Owner', () => {
  assert.match(sql, /role_key text not null default 'reviewer'/i);
  assert.match(sql, /pg_advisory_xact_lock\s*\(hashtext\('kdp:owner-administration'\)\)/i);
  assert.match(sql, /At least one active Owner must remain/i);
  assert.match(sql, /role_key='owner'[\s\S]*capability_key='can_manage_users'/i);
  assert.match(sql, /p_actor_user_id\s*=\s*p_target_user_id[\s\S]*p_role_key\s*=\s*'owner'/i);
  assert.match(sql, /insert into public\.administrative_audit_events/i);
  assert.match(sql, /tech_admin_delegable_capabilities/i);
  assert.match(sql, /A Tech Admin cannot administer their own account/i);
  assert.match(sql, /Capability delegation is not authorized/i);
});

test('authorized administration can allowlist an existing Google auth identity without client-supplied identity authority', () => {
  assert.match(sql, /create or replace function public\.create_privileged_user/i);
  assert.match(sql, /from auth\.users[\s\S]*lower\(email\)/i);
  assert.match(sql, /raw_user_meta_data/i);
  assert.match(sql, /Only an Owner may create Owner authority/i);
});

test('reviewer assignment and claim preserve one active round under revision CAS', () => {
  assert.match(sql, /create or replace function public\.manage_review_assignment/i);
  assert.match(sql, /p_expected_revision bigint/i);
  assert.match(sql, /for update/i);
  assert.match(sql, /can_claim_review/i);
  assert.match(sql, /can_reassign_reviewer/i);
  assert.match(sql, /reviewer_user_id\s*=\s*p_target_reviewer_user_id/i);
  assert.doesNotMatch(sql, /insert into public\.book_review_rounds[\s\S]*reviewer_(assigned|reassigned)/i);
});

test('reviewer ineligibility removes active ownership once without deleting work or creating a round', () => {
  assert.match(sql, /reviewer_ineligibility_intervention/i);
  assert.match(sql, /update public\.book_review_rounds set reviewer_user_id=null[\s\S]*revision=revision\+1/i);
  assert.match(sql, /delete from public\.review_assignment_defaults where reviewer_user_id=v_target\.id/i);
  assert.doesNotMatch(sql, /reviewer_ineligibility_intervention[\s\S]{0,800}insert into public\.book_review_rounds/i);
});

test('default reviewer mutation validates eligibility without changing active rounds', () => {
  assert.match(sql, /create or replace function public\.set_default_reviewer/i);
  assert.match(sql, /can_change_default_reviewer/i);
  assert.match(sql, /review_assignment_defaults/i);
});

test('pre-submission per-book reviewer override is separately revision protected', () => {
  assert.match(sql, /reviewer_assignment_revision bigint not null default 0/i);
  assert.match(sql, /create or replace function public\.set_book_reviewer_override/i);
  assert.match(sql, /reviewer_assignment_revision is distinct from p_expected_revision/i);
  assert.match(sql, /reviewer_assignment_source='override'/i);
  assert.match(sql, /else[\s\S]*can_reassign_reviewer[\s\S]*v_old is not distinct from p_target_reviewer_user_id[\s\S]*already assigned/i);
  assert.match(sql, /v_old is null[\s\S]*can_assign_reviewer[\s\S]*else[\s\S]*can_reassign_reviewer/i);
});

test('employee reassignment revokes old access, issues one fresh token, and advances book CAS', () => {
  assert.match(sql, /create or replace function public\.reassign_book_employee/i);
  assert.match(sql, /p_expected_employee_revision bigint/i);
  assert.match(sql, /p_expected_employee_person_id text/i);
  assert.match(sql, /update public\.book_access_tokens[\s\S]*revoked_at\s*=\s*now\(\)/i);
  assert.match(sql, /insert into public\.book_access_tokens/i);
  assert.match(sql, /employee_revision\s*=\s*employee_revision\s*\+\s*1/i);
  assert.match(sql, /employee_reassignment_requested/i);
  assert.match(sql, /EMPLOYEE_UPDATES[\s\S]*reply_to_review[\s\S]*resubmit_for_review/i);
});

test('Owner fallback is delivered by an upgrade-safe forward migration', () => {
  assert.match(closeoutSql, /create(?: or replace)? function public\.submit_kdp_book_for_approval/i);
  assert.match(closeoutSql, /role_key='owner'[\s\S]*owner_fallback/i);
  assert.doesNotMatch(readFileSync(new URL('../migrations/20260913000000_secure_basecamp_submission_foundation.sql', import.meta.url), 'utf8'), /owner_fallback/i);
});

test('fresh and already-installed migration paths converge on compatible submission signatures', () => {
  const concurrencySql = readFileSync(new URL('../migrations/20260916000000_optimistic_concurrency.sql', import.meta.url), 'utf8');
  assert.match(concurrencySql, /create or replace function public\.submit_kdp_book_for_approval\(p_book_id uuid,p_token_hash text,p_source text,p_expected_revision bigint\)/i);
  assert.match(closeoutSql, /alter function public\.submit_kdp_book_for_approval\(uuid,text,text\)[\s\S]*rename to submit_kdp_book_for_approval_without_owner_fallback/i);
  assert.match(closeoutSql, /create(?: or replace)? function public\.submit_kdp_book_for_approval\([\s\S]*p_book_id uuid[\s\S]*p_token_hash text[\s\S]*p_source text default/i);
  assert.match(closeoutSql, /grant execute on function public\.submit_kdp_book_for_approval\(uuid,text,text\) to service_role/i);
  assert.match(concurrencySql, /grant execute on function public\.submit_kdp_book_for_approval\(uuid,text,text,bigint\) to service_role/i);
});

test('review reach is navigation-only and meaningful mutation starts exactly once', () => {
  assert.match(closeoutSql, /started_at timestamptz/i);
  assert.match(closeoutSql, /started_by_user_id uuid/i);
  assert.match(closeoutSql, /p_action = 'reach_step'[\s\S]*status=v_round\.status[\s\S]*reached_steps/i);
  assert.match(closeoutSql, /else[\s\S]*status='in_review'[\s\S]*started_at=coalesce\(started_at,now\(\)\)[\s\S]*started_by_user_id=coalesce\(started_by_user_id,p_actor_user_id\)/i);
  assert.match(closeoutSql, /v_round\.started_at is null[\s\S]*overall_status='IN_REVIEW'[\s\S]*review_started/i);
});

test('Basecamp settlement callbacks surface canonical update errors', () => {
  const assignmentSource = readFileSync(new URL('../functions/mutateBookAssignment/index.ts', import.meta.url), 'utf8');
  assert.match(assignmentSource, /integration event settlement failed/i);
  assert.match(retrySource, /integration event settlement failed/i);
});

test('management RPCs remain service-role only', () => {
  for (const name of ['create_privileged_user', 'manage_privileged_user', 'set_default_reviewer', 'set_book_reviewer_override', 'manage_review_assignment', 'reassign_book_employee']) {
    assert.match(sql, new RegExp(`revoke all on function public\\.${name}\\(`, 'i'));
    assert.match(sql, new RegExp(`grant execute on function public\\.${name}\\(`, 'i'));
  }
});

test('operational Edge Functions require JWTs and employee sync retry reuses canonical access', () => {
  for (const name of ['loadOperationalSettings', 'mutateOperationalSettings', 'mutateBookAssignment', 'retryBasecampEmployeeReassignment']) {
    assert.match(config, new RegExp(`\\[functions\\.${name}\\]\\s*verify_jwt = true`));
  }
  assert.match(retrySource, /resolveEmployeeReassignmentToken/);
  assert.match(retrySource, /select\('id,token_hash'\)/);
  assert.match(retrySource, /EMPLOYEE_ACCESS_TOKEN_DERIVATION_PREVIOUS_SECRET/);
  assert.doesNotMatch(retrySource, /insert\([^)]*book_access_tokens|createTodo|postJson/i);
});
