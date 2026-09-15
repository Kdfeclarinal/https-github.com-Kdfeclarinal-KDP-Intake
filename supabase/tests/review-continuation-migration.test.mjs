import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const migrationUrl = new URL('../migrations/20260915000000_review_update_continuation.sql', import.meta.url);
const sql = existsSync(migrationUrl) ? readFileSync(migrationUrl, 'utf8') : '';
const resubmitEdge = readFileSync(new URL('../functions/resubmitBookForReview/index.ts', import.meta.url), 'utf8');
const pricingPage = readFileSync(new URL('../../poc/kdp-app-shell/src/pricing/PricingPage.jsx', import.meta.url), 'utf8');

test('finalized review history has no employee-reply mutation exception', () => {
  assert.ok(sql, 'review continuation migration must exist');
  assert.match(sql, /create or replace function public\.prevent_finalized_review_mutation/i);
  const guard = /create or replace function public\.prevent_finalized_review_mutation[\s\S]*?\$\$;/i.exec(sql)?.[0] || '';
  assert.doesNotMatch(guard, /author_actor_type\s*=\s*'employee'/i);
  assert.match(sql, /Finalized review rounds and their history are immutable/i);
});

test('employee update activity is stored in a separate server-only continuation model', () => {
  assert.match(sql, /create table public\.book_review_update_cycles/i);
  assert.match(sql, /create table public\.book_review_update_threads/i);
  assert.match(sql, /create table public\.book_review_update_replies/i);
  assert.match(sql, /enable row level security/i);
  assert.match(sql, /revoke all on table public\.book_review_update_replies from public, anon, authenticated/i);
  assert.match(sql, /source_comment_id[\s\S]*references public\.book_review_comments/i);
});

test('employee reply RPC authorizes the active cycle and never inserts historical comments', () => {
  const functionMatch = /create or replace function public\.add_employee_review_reply[\s\S]*?\$\$;/i.exec(sql);
  assert.ok(functionMatch);
  assert.match(functionMatch[0], /book_review_update_threads/i);
  assert.match(functionMatch[0], /book_review_update_replies/i);
  assert.match(functionMatch[0], /EMPLOYEE_UPDATES/i);
  assert.doesNotMatch(functionMatch[0], /insert into public\.book_review_comments/i);
});

test('resubmission enforces the OR readiness rule and consumes one cycle idempotently', () => {
  assert.match(sql, /review_update_evidence_hash/i);
  assert.match(sql, /ready_via_reply=exists/i);
  assert.match(sql, /ready_via_change=public\.normalize_review_update_json/i);
  assert.match(sql, /target_review_round_id/i);
  assert.match(sql, /cy\.id=p_update_cycle_id/i);
  assert.match(sql, /status\s*=\s*'consumed'/i);
  assert.match(sql, /'replayed',\s*true/i);
  assert.match(sql, /on conflict\s*\(update_thread_id\)\s*do nothing/i);
});

test('continued issues are active only in the next round and still require explicit approval', () => {
  assert.match(sql, /continued_from_comment_id/i);
  assert.match(sql, /decision\s*=\s*'needs_updates'[\s\S]*decision_source\s*=\s*'continued_request'/i);
  assert.match(sql, /target_comment_id/i);
});

test('terminal finalization remains idempotent and creates continuation in its canonical transaction', () => {
  assert.match(sql, /create trigger book_review_rounds_create_update_cycle/i);
  assert.match(sql, /if v_round\.finalized_at is not null[\s\S]*'replayed',true/i);
  assert.match(sql, /review_outcome_sync_requested/i);
});

test('continuation RPCs and tables are not browser executable or writable', () => {
  assert.match(sql, /revoke all on function public\.add_employee_review_reply\(uuid,text,uuid,text\) from public, anon, authenticated/i);
  assert.match(sql, /grant execute on function public\.add_employee_review_reply\(uuid,text,uuid,text\) to service_role/i);
  assert.match(sql, /revoke all on function public\.resubmit_kdp_book_for_review\(uuid,text,text\) from service_role/i);
  assert.match(sql, /grant execute on function public\.resubmit_kdp_book_for_review\(uuid,text,uuid,text\) to service_role/i);
});

test('consumed continuation state and all continuation replies are immutable', () => {
  assert.match(sql, /create or replace function public\.prevent_consumed_review_update_mutation/i);
  assert.match(sql, /Consumed employee update cycles are immutable/i);
  assert.match(sql, /Employee update replies are immutable/i);
  assert.match(sql, /book_review_update_replies_prevent_mutation/i);
});

test('browser and Edge resubmission bind to the exact authoritative update cycle', () => {
  assert.match(pricingPage, /updateCycleId:\s*employeeUpdate\.updateCycleId/i);
  assert.match(resubmitEdge, /p_update_cycle_id:\s*updateCycleId/i);
  assert.match(resubmitEdge, /!bookId\s*\|\|\s*!token\s*\|\|\s*!updateCycleId/i);
});
