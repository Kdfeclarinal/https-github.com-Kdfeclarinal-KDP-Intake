import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(
  new URL('../migrations/20260922000000_decisions_68_70.sql', import.meta.url),
  'utf8',
);
const createEdge = readFileSync(
  new URL('../functions/createPrivilegedBook/index.ts', import.meta.url),
  'utf8',
);
const loadOptions = readFileSync(
  new URL('../functions/loadCreateBookOptions/index.ts', import.meta.url),
  'utf8',
);
const loadEmployee = readFileSync(
  new URL('../functions/loadEmployeePage/index.ts', import.meta.url),
  'utf8',
);

test('Decision 68 stores operational Book Author separately from authoritative KDP author', () => {
  assert.match(migration, /add column if not exists book_author_name text/i);
  assert.match(migration, /distinct from authoritative KDP primary_author_name/i);
  assert.doesNotMatch(migration, /set\s+primary_author_name\s*=\s*p_book_author_name/i);
  assert.match(createEdge, /p_book_author_name:\s*input\.bookAuthor/i);
});

test('Decision 70 defaults to seven calendar days from server workflow settings', () => {
  assert.match(migration, /employee_intake_turnaround/i);
  assert.match(migration, /"value":7/i);
  assert.match(migration, /"unit":"calendar_days"/i);
  assert.match(loadOptions, /workflow_settings/i);
  assert.match(createEdge, /options\.defaultDueDate/i);
});

test('Decision 70 stores a resolved per-book due date and does not backfill old books', () => {
  assert.match(migration, /add column if not exists employee_intake_due_date date/i);
  assert.match(migration, /employee_intake_due_date_source/i);
  const bookUpdates = [...migration.matchAll(/update\s+public\.books[\s\S]*?;/gi)].map((match) => match[0]);
  assert.equal(bookUpdates.length, 1);
  assert.match(bookUpdates[0], /where\s+id\s*=\s*v_book_id/i);
  assert.doesNotMatch(migration, /update\s+public\.books\s+set[\s\S]*?where\s+employee_intake_due_date\s+is\s+null/i);
});

test('Decision 69 employee mode remains server-authoritative', () => {
  assert.match(loadEmployee, /employee_mode/i);
  assert.match(loadEmployee, /isEmployeeEditableBookStatus\(bookRow\.overall_status\)/i);
  assert.match(loadEmployee, /"employee_updates"/i);
  assert.match(loadEmployee, /"submitted"/i);
});

test('new create-book overload is service-role only', () => {
  assert.match(migration, /revoke all on function public\.create_privileged_kdp_book\([\s\S]*?from public,anon,authenticated/i);
  assert.match(migration, /grant execute on function public\.create_privileged_kdp_book\([\s\S]*?to service_role/i);
});


test('Decision 70 mirrors the stored Stage 1 due date to Basecamp without recalculation', () => {
  const provisioning = readFileSync(
    new URL('../functions/_shared/basecampProvisioning.ts', import.meta.url),
    'utf8',
  );
  assert.match(provisioning, /payload\.due_on\s*=\s*dueDate/i);
});
