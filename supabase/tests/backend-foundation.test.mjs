import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sql = readFileSync(
  new URL("../migrations/20260910000000_locked_workflow_foundation.sql", import.meta.url),
  "utf8",
);
const currentFileSql = readFileSync(
  new URL("../migrations/20260907000000_harden_current_book_file_replacement.sql", import.meta.url),
  "utf8",
);

const canonicalStates = [
  "EMPLOYEE_INTAKE",
  "AWAITING_REVIEW",
  "IN_REVIEW",
  "EMPLOYEE_UPDATES",
  "KDP_INTAKE_APPROVED",
];

const legacyStates = [
  "draft",
  "for_approval",
  "in_admin_review",
  "needs_updates",
  "approved",
];

const capabilities = [
  "can_review",
  "can_claim_review",
  "can_assign_reviewer",
  "can_reassign_reviewer",
  "can_create_book",
  "can_view_all_books",
  "can_finalize_book",
  "can_manage_users",
];

test("migration establishes every locked canonical workflow state", () => {
  for (const state of canonicalStates) assert.match(sql, new RegExp(`'${state}'`));
});

test("Stage A adds canonical states without cutting legacy writers over", () => {
  assert.match(sql, /Stage A/i);
  for (const state of legacyStates) assert.match(sql, new RegExp(`'${state}'`));
  assert.doesNotMatch(sql, /update\s+public\.books[\s\S]*?set[\s\S]*?overall_status/i);
  assert.doesNotMatch(sql, /drop\s+(type|value)[\s\S]*?kdp_book_status/i);
  assert.doesNotMatch(sql, /alter\s+table\s+public\.books[\s\S]*?overall_status[\s\S]*?check/i);
});

test("current-file migration records its coupled upload deployment gate", () => {
  assert.match(currentFileSql, /pause Content replacement uploads/i);
  assert.match(currentFileSql, /deploy the RPC-compatible upload function/i);
  assert.match(currentFileSql, /resume uploads/i);
  assert.match(currentFileSql, /where is_latest = true/i);
  assert.match(currentFileSql, /promote_replacement_book_file/i);
});

test("migration establishes capability grants without email-based authorization", () => {
  assert.match(sql, /create table public\.privileged_users/i);
  assert.match(sql, /auth_user_id uuid not null unique/i);
  assert.match(sql, /references auth\.users \(id\)/i);
  assert.match(sql, /create table public\.privileged_user_capability_grants/i);
  for (const capability of capabilities) assert.match(sql, new RegExp(`'${capability}'`));
  assert.doesNotMatch(sql, /@(gmail|googlemail|iwdnow)\./i);
});

test("migration evolves existing review and assignment records", () => {
  assert.match(sql, /alter table public\.books[\s\S]*assigned_reviewer_user_id/i);
  assert.match(sql, /alter table public\.book_review_rounds[\s\S]*submission_snapshot/i);
  assert.match(sql, /book_review_rounds_one_active_per_book/i);
  assert.match(sql, /parent_comment_id/i);
  assert.match(sql, /prevent_finalized_review_mutation/i);
  assert.match(sql, /alter table public\.book_status_history[\s\S]*actor_privileged_user_id[\s\S]*subject_privileged_user_id/i);
});

test("migration evolves the existing Basecamp mapping with safe retry state", () => {
  assert.match(sql, /alter table public\.basecamp_references/i);
  assert.match(sql, /todo_list_id/i);
  assert.match(sql, /idempotency_key/i);
  assert.match(sql, /provisioning_status/i);
  assert.match(sql, /provisioned[\s\S]*todo_list_id is not null/i);
  assert.doesNotMatch(sql, /https:\/\/3\.basecampapi\.com/i);
});

test("new privileged tables are RLS protected and not browser writable", () => {
  for (const table of [
    "privileged_users",
    "privileged_capabilities",
    "privileged_user_capability_grants",
    "review_assignment_defaults",
  ]) {
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`, "i"));
    assert.match(sql, new RegExp(`revoke all on table public\\.${table} from anon, authenticated`, "i"));
  }
});

test("Basecamp Create Book foundation is server-only and transactional", () => {
  const source = readFileSync(
    new URL("../migrations/20260912000000_basecamp_create_book_foundation.sql", import.meta.url),
    "utf8",
  );
  for (const table of ["basecamp_connections", "basecamp_oauth_states"]) {
    assert.match(source, new RegExp(`create table public\\.${table}`, "i"));
    assert.match(source, new RegExp(`alter table public\\.${table} enable row level security`, "i"));
    assert.match(source, new RegExp(`revoke all on table public\\.${table} from (public, )?anon, authenticated`, "i"));
  }
  assert.match(source, /create or replace function public\.create_privileged_kdp_book/i);
  assert.match(source, /create or replace function public\.rotate_employee_book_token/i);
  assert.match(source, /insert into public\.books/i);
  assert.match(source, /insert into public\.book_step_data/i);
  assert.match(source, /insert into public\.book_access_tokens/i);
  assert.match(source, /insert into public\.basecamp_references/i);
  assert.match(source, /revoke all on function public\.create_privileged_kdp_book/i);
  assert.doesNotMatch(source, /access_token\s+text|refresh_token\s+text/i);
});

test("secure submission foundation uses Vault and denies browser token access", () => {
  const source = readFileSync(new URL("../migrations/20260913000000_secure_basecamp_submission_foundation.sql", import.meta.url), "utf8");
  assert.match(source, /vault\.create_secret/i);
  assert.match(source, /vault\.update_secret/i);
  assert.match(source, /vault\.decrypted_secrets/i);
  for (const fn of ["read_basecamp_token_bundle", "store_basecamp_token_bundle", "delete_basecamp_token_bundle"]) {
    assert.match(source, new RegExp(`revoke all on function public\\.${fn}`, "i"));
    assert.match(source, new RegExp(`grant execute on function public\\.${fn}[^;]+service_role`, "i"));
  }
  assert.doesNotMatch(source, /grant execute on function public\.(read|store|delete)_basecamp_token_bundle[^;]+(anon|authenticated)/i);
});

test("reviewer mapping is capability-controlled metadata, not authorization", () => {
  const source = readFileSync(new URL("../migrations/20260913000000_secure_basecamp_submission_foundation.sql", import.meta.url), "utf8");
  assert.match(source, /create table public\.privileged_user_basecamp_mappings/i);
  assert.match(source, /alter table public\.privileged_user_basecamp_mappings enable row level security/i);
  assert.match(source, /revoke all on table public\.privileged_user_basecamp_mappings from (public, )?anon, authenticated/i);
  assert.match(source, /mapped_by_privileged_user_id/i);
  assert.doesNotMatch(source, /where[^;]+email_snapshot\s*=/i);
});

test("submission RPC reauthorizes, locks, snapshots, and is retry-safe", () => {
  const source = readFileSync(new URL("../migrations/20260913000000_secure_basecamp_submission_foundation.sql", import.meta.url), "utf8");
  assert.match(source, /create or replace function public\.submit_kdp_book_for_approval\([\s\S]*p_token_hash text/i);
  assert.match(source, /for update/i);
  assert.match(source, /book_step_data/i);
  assert.match(source, /is_complete is not true/i);
  assert.match(source, /validation_errors/i);
  assert.match(source, /is_latest = true/i);
  assert.match(source, /submission_snapshot/i);
  assert.match(source, /AWAITING_REVIEW/i);
  assert.match(source, /already_submitted/i);
  assert.match(source, /revoke all on function public\.submit_kdp_book_for_approval/i);
  assert.match(source, /grant execute on function public\.submit_kdp_book_for_approval[^;]+service_role/i);
  assert.match(source, /prevent_submitted_review_snapshot_mutation/i);
});
