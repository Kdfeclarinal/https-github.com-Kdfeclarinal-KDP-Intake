import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  manageTeamMember,
  authorizeBookReviewerOverride,
  manageReviewerAssignment,
  reassignEmployee,
  deriveEmployeeReassignmentToken,
  resolveEmployeeReassignmentToken,
  sanitizeOperationalSettings,
} from '../functions/_shared/operationalAdministration.ts';
import { syncEmployeeReassignment } from '../functions/_shared/operationalBasecamp.ts';

const actor = (overrides = {}) => ({ id: 'actor', role_key: 'tech_admin', capabilities: ['can_manage_users'], ...overrides });
const settingsEdge = readFileSync(new URL('../functions/loadOperationalSettings/index.ts', import.meta.url), 'utf8');

test('unauthorized and non-Owner Owner administration fail closed', async () => {
  await assert.rejects(() => manageTeamMember({ actor: actor({ capabilities: [] }), target: { id: 'user', role_key: 'reviewer' }, input: { reason: 'Change' }, persist: async () => ({}) }), /not authorized/i);
  await assert.rejects(() => manageTeamMember({ actor: actor(), target: { id: 'owner', role_key: 'owner' }, input: { role: 'reviewer', reason: 'Change' }, persist: async () => ({}) }), /Owner/i);
  await assert.rejects(() => manageTeamMember({ actor: actor(), target: { id: 'actor', role_key: 'tech_admin' }, input: { role: 'owner', reason: 'Change' }, persist: async () => ({}) }), /Owner/i);
});

test('Tech Admin capability delegation is limited and cannot self-escalate', async () => {
  await assert.rejects(() => manageTeamMember({
    actor: actor(), target: { id: 'actor', role_key: 'tech_admin' },
    input: { role: 'tech_admin', active: true, capabilities: ['can_manage_users'], reason: 'Self change' }, persist: async () => ({}),
  }), /own account/i);
  await assert.rejects(() => manageTeamMember({
    actor: actor(), target: { id: 'reviewer', role_key: 'reviewer' },
    input: { role: 'reviewer', active: true, capabilities: ['can_manage_integrations'], reason: 'Escalate' }, persist: async () => ({}),
  }), /capability delegation/i);
  await assert.doesNotReject(() => manageTeamMember({
    actor: actor(), target: { id: 'reviewer', role_key: 'reviewer' },
    input: { role: 'reviewer', active: true, capabilities: ['can_review', 'can_finalize_book'], reason: 'Review duties' }, persist: async () => ({ ok: true }),
  }));
  await assert.doesNotReject(() => manageTeamMember({
    actor: actor(), target: { id: 'other-admin', role_key: 'tech_admin', capabilities: ['can_manage_users'] },
    input: { role: 'tech_admin', active: true, capabilities: ['can_manage_users', 'can_review'], reason: 'Review duties' }, persist: async () => ({ ok: true }),
  }));
  await assert.doesNotReject(() => manageTeamMember({
    actor: actor({ role_key: 'owner' }), target: { id: 'reviewer', role_key: 'reviewer' },
    input: { role: 'tech_admin', active: true, capabilities: ['can_manage_users', 'can_manage_integrations'], reason: 'Owner grant' }, persist: async () => ({ ok: true }),
  }));
});

test('pre-submission reviewer override authorizes every request and rejects same-target no-op', () => {
  assert.throws(() => authorizeBookReviewerOverride({ actor: actor({ role_key: 'reviewer', capabilities: [] }), currentReviewerId: 'reviewer-1', targetReviewerId: 'reviewer-1' }), /not authorized/i);
  assert.throws(() => authorizeBookReviewerOverride({ actor: actor({ capabilities: ['can_reassign_reviewer'] }), currentReviewerId: 'reviewer-1', targetReviewerId: 'reviewer-1' }), /already assigned/i);
  assert.doesNotThrow(() => authorizeBookReviewerOverride({ actor: actor({ capabilities: ['can_reassign_reviewer'] }), currentReviewerId: 'reviewer-1', targetReviewerId: 'reviewer-2' }));
});

test('allowed capability change delegates to the transactional boundary', async () => {
  let persisted;
  const result = await manageTeamMember({
    actor: actor(), target: { id: 'reviewer', role_key: 'reviewer', revision: 3 },
    input: { expectedRevision: 3, role: 'reviewer', active: true, capabilities: ['can_review'], reason: 'Review duties' },
    persist: async (input) => { persisted = input; return { ok: true, revision: 4 }; },
  });
  assert.equal(persisted.actorId, 'actor');
  assert.deepEqual(persisted.capabilities, ['can_review']);
  assert.equal(result.revision, 4);
});

test('review claim is limited to the caller and unassigned active round', async () => {
  let persisted;
  await manageReviewerAssignment({
    actor: actor({ role_key: 'reviewer', capabilities: ['can_review', 'can_claim_review'] }),
    book: { id: 'book', assignedReviewerId: null }, round: { id: 'round', revision: 2, reviewerId: null },
    input: { action: 'claim', targetReviewerId: 'actor', reason: 'Claiming queue item' },
    eligibleReviewers: [{ id: 'actor' }], persist: async (input) => { persisted = input; return { ok: true }; },
  });
  assert.equal(persisted.expectedRevision, 2);
  await assert.rejects(() => manageReviewerAssignment({
    actor: actor({ role_key: 'reviewer', capabilities: ['can_review', 'can_claim_review'] }),
    book: { id: 'book', assignedReviewerId: 'other' }, round: { id: 'round', revision: 2, reviewerId: 'other' },
    input: { action: 'claim', targetReviewerId: 'actor', reason: 'Claiming' }, eligibleReviewers: [{ id: 'actor' }], persist: async () => ({}),
  }), /unassigned/i);
  await assert.rejects(() => manageReviewerAssignment({
    actor: actor({ role_key: 'reviewer', capabilities: ['can_review', 'can_assign_reviewer'] }),
    book: { id: 'book', assignedReviewerId: null }, round: { id: 'round', revision: 2, reviewerId: null },
    input: { action: 'assign', targetReviewerId: 'other', reason: 'Assigning' }, eligibleReviewers: [{ id: 'other' }], persist: async () => ({}),
  }), /not authorized/i);
});

test('employee reassignment validates project membership before canonical mutation and preserves failure', async () => {
  let canonicalCalls = 0;
  await assert.rejects(() => reassignEmployee({ actor: actor(), book: { id: 'book', employeeRevision: 5, employeePersonId: 'old' }, input: { replacementEmployeePersonId: 'missing', reason: 'Coverage' }, employees: [], persist: async () => { canonicalCalls += 1; } }), /project member/i);
  assert.equal(canonicalCalls, 0);
  const result = await reassignEmployee({
    actor: actor(), book: { id: 'book', employeeRevision: 5, employeePersonId: 'old' },
    input: { replacementEmployeePersonId: 'new', reason: 'Coverage' }, employees: [{ id: 'new', displayName: 'New Employee', email: 'new@example.test' }],
    tokenFactory: () => 'fresh-token', hashToken: async () => 'fresh-hash',
    persist: async () => ({ ok: true, employee_revision: 6, integration_event_id: 'event' }),
    syncBasecamp: async () => { throw new Error('downstream'); },
  });
  assert.equal(result.employeeRevision, 6);
  assert.deepEqual(result.basecamp, { status: 'failed', retryAvailable: true });

  const settledFailure = await reassignEmployee({
    actor: actor(), book: { id: 'book', employeeRevision: 6, employeePersonId: 'old' },
    input: { replacementEmployeePersonId: 'new', reason: 'Coverage' }, employees: [{ id: 'new', displayName: 'New Employee' }],
    tokenFactory: () => 'another-fresh-token', hashToken: async () => 'another-fresh-hash',
    persist: async () => ({ employee_revision: 7, integration_event_id: 'event-2' }),
    syncBasecamp: async () => ({ status: 'failed', retryAvailable: true }),
  });
  assert.deepEqual(settledFailure.basecamp, { status: 'failed', retryAvailable: true });
});

test('settings serialization excludes credentials and exposes intervention metadata only', () => {
  const result = sanitizeOperationalSettings({
    actor: { id: 'actor', role_key: 'owner', capabilities: ['can_manage_users'] }, users: [], defaultReviewerId: null,
    reviewerMappings: [{ privileged_user_id: 'reviewer', basecamp_person_id: '42', display_name_snapshot: 'Reviewer Person', project_id: 'project' }],
    integrations: { basecamp: { status: 'connected', projectId: '42', access_token: 'secret' }, reviewstudio: { configured: true, apiKey: 'secret' }, ghl: { configured: false, secret: 'secret' } },
  });
  assert.equal(JSON.stringify(result).includes('secret'), false);
  assert.deepEqual(result.integrations.basecamp, { status: 'connected', projectId: '42' });
  assert.deepEqual(result.reviewerMappings, [{ reviewerId: 'reviewer', personId: '42', displayName: 'Reviewer Person', projectId: 'project' }]);

  const assignmentOnly = sanitizeOperationalSettings({
    actor: { id: 'assigner', role_key: 'tech_admin', capabilities: ['can_assign_reviewer'] },
    users: [{ id: 'reviewer', display_name: 'Reviewer', email_snapshot: 'private@example.test', role_key: 'reviewer', capabilities: ['can_review', 'can_manage_users'] }],
    reviewerMappings: [{ privileged_user_id: 'reviewer', basecamp_person_id: '42' }],
  });
  assert.equal(assignmentOnly.users[0].email, '');
  assert.deepEqual(assignmentOnly.users[0].capabilities, ['can_review']);
  assert.deepEqual(assignmentOnly.reviewerMappings, []);
});

test('Settings reports the same server-only ReviewStudio configuration used by upload and reconciliation', () => {
  assert.match(settingsEdge, /REVIEWSTUDIO_API_KEY/);
  assert.match(settingsEdge, /REVIEWSTUDIO_API_BASE_URL/);
  assert.doesNotMatch(settingsEdge, /REVIEWSTUDIO_API_TOKEN|REVIEWSTUDIO_BASE_URL/);
});

test('Basecamp employee reassignment updates one existing task and settles the durable event', async () => {
  const calls = [];
  const result = await syncEmployeeReassignment({
    event: { id: 'event', status: 'pending' }, reference: { todo_id: 'todo', project_id: 'project' },
    projectId: 'project', employeePersonId: '42', employeeDeepLink: 'https://intake.example/book',
    claim: async () => calls.push({ claim: true }),
    loadTodo: async () => ({ id: 'todo', content: 'Employee Intake', description: '<div>Existing marker</div>' }),
    updateTodo: async (id, payload) => calls.push({ id, payload }),
    settle: async (status) => calls.push({ status }),
  });
  assert.equal(result.status, 'ready');
  assert.deepEqual(calls[0], { claim: true });
  assert.equal(calls.filter((call) => call.id === 'todo').length, 1);
  assert.deepEqual(calls[1].payload.assignee_ids, [42]);
  assert.match(calls[1].payload.description, /https:\/\/intake\.example\/book/);
  assert.deepEqual(calls.at(-1), { status: 'success' });
});

test('Basecamp access delivery replaces every stale employee launcher with one reproducible link', async () => {
  const calls = [];
  const result = await syncEmployeeReassignment({
    event: { id: 'event', status: 'failed' }, reference: { todo_id: 'todo', project_id: 'project' },
    projectId: 'project', employeePersonId: '42', employeeDeepLink: 'https://intake.example/current',
    claim: async () => {},
    loadTodo: async () => ({
      id: 'todo', content: 'Employee Intake',
      description: '<div>Complete the Kindle eBook intake: <a href="https://intake.example/revoked">Open KDP Intake</a></div><div>Open the reassigned KDP Intake: <a href="https://intake.example/old">Open KDP Intake</a></div><div>KDP Intake Book: book</div>',
    }),
    updateTodo: async (_id, payload) => calls.push(payload),
    settle: async () => {},
  });
  assert.equal(result.status, 'ready');
  assert.equal((calls[0].description.match(/Open KDP Intake/g) || []).length, 1);
  assert.doesNotMatch(calls[0].description, /revoked|\/old/);
  assert.match(calls[0].description, /https:\/\/intake\.example\/current/);
});

test('Basecamp reassignment failure remains retryable without a duplicate task', async () => {
  const calls = [];
  const result = await syncEmployeeReassignment({
    event: { id: 'event', status: 'pending' }, reference: { todo_id: 'todo', project_id: 'project' }, projectId: 'project',
    employeePersonId: '42', employeeDeepLink: 'https://intake.example/book', claim: async () => {}, loadTodo: async () => ({ id: 'todo', content: 'Employee Intake' }),
    updateTodo: async () => { throw new Error('downstream'); }, settle: async (status) => calls.push(status),
  });
  assert.deepEqual(result, { status: 'failed', retryAvailable: true });
  assert.deepEqual(calls, ['failed']);
});

test('Basecamp reassignment cannot report success when event settlement fails', async () => {
  await assert.rejects(() => syncEmployeeReassignment({
    event: { id: 'event', status: 'pending' }, reference: { todo_id: 'todo', project_id: 'project' }, projectId: 'project',
    employeePersonId: '42', employeeDeepLink: 'https://intake.example/book', claim: async () => {}, loadTodo: async () => ({ id: 'todo', content: 'Employee Intake' }),
    updateTodo: async () => ({}), settle: async () => { throw new Error('canonical event update failed'); },
  }), /durably settled/i);
});

test('employee reassignment retry can reproduce only its server-side token without storing it', async () => {
  const secret = '0123456789abcdef0123456789abcdef';
  const first = await deriveEmployeeReassignmentToken(secret, '11111111-1111-4111-8111-111111111111');
  const again = await deriveEmployeeReassignmentToken(secret, '11111111-1111-4111-8111-111111111111');
  const other = await deriveEmployeeReassignmentToken(secret, '22222222-2222-4222-8222-222222222222');
  assert.equal(first, again);
  assert.notEqual(first, other);
  assert.match(first, /^kdp_er_[A-Za-z0-9_-]+$/);
});

test('pending employee access remains retryable across one controlled derivation-secret rotation', async () => {
  const previous = 'previous-secret-0123456789abcdef0123456789';
  const current = 'current-secret-0123456789abcdef01234567890';
  const eventId = '11111111-1111-4111-8111-111111111111';
  const expected = await deriveEmployeeReassignmentToken(previous, eventId);
  const resolved = await resolveEmployeeReassignmentToken({
    secrets: [current, previous], eventId,
    expectedHash: `hash:${expected}`,
    hashToken: async (token) => `hash:${token}`,
  });
  assert.equal(resolved, expected);
});
