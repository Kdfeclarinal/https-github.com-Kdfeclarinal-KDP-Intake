import test from 'node:test';
import assert from 'node:assert/strict';
import { canManageTeamMember, canOpenSettings, manageableCapabilities, reviewerAssignmentAction, reviewerIntervention, teamMemberDraft } from '../src/settings/settingsState.js';

test('Settings visibility is capability-aware but does not invent authority', () => {
  assert.equal(canOpenSettings(['can_manage_users']), true);
  assert.equal(canOpenSettings(['can_claim_review']), true);
  assert.equal(canOpenSettings(['can_review']), false);
});

test('unassigned or ineligible active reviewer requires intervention', () => {
  assert.equal(reviewerIntervention({ activeReview: true, reviewerId: null, reviewerEligible: false }), 'unassigned');
  assert.equal(reviewerIntervention({ activeReview: true, reviewerId: 'r1', reviewerEligible: false }), 'ineligible');
  assert.equal(reviewerIntervention({ activeReview: true, reviewerId: 'r1', reviewerEligible: true }), null);
});

test('reviewer controls distinguish self-claim from administrative assignment', () => {
  assert.equal(reviewerAssignmentAction({ reviewerId: null }, { id: 'r1', role: 'reviewer', capabilities: ['can_review', 'can_claim_review'] }, 'r1'), 'claim');
  assert.equal(reviewerAssignmentAction({ reviewerId: null }, { id: 'r1', role: 'reviewer', capabilities: ['can_review'] }, 'r2'), null);
  assert.equal(reviewerAssignmentAction({ reviewerId: null }, { id: 'admin', role: 'tech_admin', capabilities: ['can_assign_reviewer'] }, 'r2'), 'assign');
  assert.equal(reviewerAssignmentAction({ reviewerId: 'r1' }, { id: 'admin', role: 'tech_admin', capabilities: ['can_reassign_reviewer'] }, 'r2'), 'reassign');
  assert.equal(reviewerAssignmentAction({ reviewerId: 'r1' }, { id: 'r2', role: 'reviewer', capabilities: ['can_reassign_reviewer'] }, 'r2'), null);
});

test('team editor preserves server revision and normalized capabilities', () => {
  assert.deepEqual(teamMemberDraft({ id: 'u', role: 'reviewer', active: true, revision: 4, capabilities: ['can_review', 'can_review'] }), {
    id: 'u', role: 'reviewer', active: true, revision: 4, capabilities: ['can_review'], reason: '',
  });
});

test('Settings mirrors the server capability-delegation boundary without becoming authority', () => {
  assert.deepEqual(manageableCapabilities('tech_admin').includes('can_manage_users'), false);
  assert.deepEqual(manageableCapabilities('tech_admin').includes('can_manage_integrations'), false);
  assert.deepEqual(manageableCapabilities('owner').includes('can_manage_users'), true);
  assert.equal(canManageTeamMember({ id: 'admin', role: 'tech_admin' }, { id: 'admin', role: 'tech_admin' }), false);
  assert.equal(canManageTeamMember({ id: 'admin', role: 'tech_admin' }, { id: 'reviewer', role: 'reviewer' }), true);
  assert.equal(canManageTeamMember({ id: 'admin', role: 'tech_admin' }, { id: 'owner', role: 'owner' }), false);
});
