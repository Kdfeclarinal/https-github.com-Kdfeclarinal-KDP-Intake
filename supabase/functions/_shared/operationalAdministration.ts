import { BasecampError } from './basecampClient.ts';
import { generateOpaqueToken, sha256Token } from './createPrivilegedBook.ts';

type Row = Record<string, any>;

const has = (actor: Row, capability: string) => Array.isArray(actor?.capabilities) && actor.capabilities.includes(capability);
export const TECH_ADMIN_DELEGABLE_CAPABILITIES = new Set([
  'can_review',
  'can_claim_review',
  'can_assign_reviewer',
  'can_reassign_reviewer',
  'can_create_book',
  'can_view_all_books',
  'can_finalize_book',
  'can_change_default_reviewer',
]);
const reason = (value: unknown) => {
  const result = String(value || '').trim();
  if (!result) throw new BasecampError(422, 'A reason is required.');
  if (result.length > 1000) throw new BasecampError(422, 'The reason is too long.');
  return result;
};

export async function deriveEmployeeReassignmentToken(secret: string, eventId: string) {
  if (secret.length < 32) throw new BasecampError(500, 'Employee reassignment token configuration is incomplete.');
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(`employee-reassignment:${eventId}`)));
  const encoded = btoa(String.fromCharCode(...signature)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
  return `kdp_er_${encoded}`;
}

export async function resolveEmployeeReassignmentToken(deps: Row) {
  for (const secret of deps.secrets || []) {
    if (String(secret || '').length < 32) continue;
    const token = await deriveEmployeeReassignmentToken(String(secret), String(deps.eventId));
    if (await deps.hashToken(token) === deps.expectedHash) return token;
  }
  throw new BasecampError(409, 'The employee access credential can no longer be reconstructed.');
}

export async function manageTeamMember(deps: Row) {
  if (!has(deps.actor, 'can_manage_users')) throw new BasecampError(403, 'User management is not authorized.');
  if (!deps.target?.id) throw new BasecampError(404, 'Team member was not found.');
  const nextRole = String(deps.input?.role || deps.target.role_key || 'reviewer');
  if (!['owner', 'tech_admin', 'reviewer'].includes(nextRole)) throw new BasecampError(422, 'Role is invalid.');
  if (deps.actor.role_key !== 'owner' && (deps.target.role_key === 'owner' || nextRole === 'owner')) {
    throw new BasecampError(403, 'Only an Owner may administer Owner authority.');
  }
  const capabilities = [...new Set((deps.input?.capabilities || []).map(String))].sort();
  if (deps.actor.role_key !== 'owner' && String(deps.actor.id) === String(deps.target.id)) {
    throw new BasecampError(403, 'A Tech Admin cannot administer their own account.');
  }
  const currentCapabilities = new Set((deps.target.capabilities || []).map(String));
  const requestedCapabilities = new Set(capabilities);
  const restrictedCapabilitiesChanged = [...new Set([...currentCapabilities, ...requestedCapabilities])]
    .some((capability) => !TECH_ADMIN_DELEGABLE_CAPABILITIES.has(capability) && currentCapabilities.has(capability) !== requestedCapabilities.has(capability));
  if (deps.actor.role_key !== 'owner' && restrictedCapabilitiesChanged) {
    throw new BasecampError(403, 'Capability delegation is not authorized.');
  }
  return deps.persist({
    actorId: deps.actor.id, targetUserId: deps.target.id,
    expectedRevision: Number(deps.input?.expectedRevision), role: nextRole,
    active: deps.input?.active !== false, capabilities, reason: reason(deps.input?.reason),
  });
}

export function authorizeBookReviewerOverride(input: Row) {
  const current = input.currentReviewerId || null;
  const target = input.targetReviewerId || null;
  if (!['owner', 'tech_admin'].includes(input.actor?.role_key)) throw new BasecampError(403, 'Reviewer assignment is not authorized.');
  if (current) {
    if (!has(input.actor, 'can_reassign_reviewer')) throw new BasecampError(403, 'Reviewer reassignment is not authorized.');
    if (String(current) === String(target)) throw new BasecampError(409, 'This reviewer is already assigned.');
  } else if (!has(input.actor, 'can_assign_reviewer')) {
    throw new BasecampError(403, 'Reviewer assignment is not authorized.');
  }
}

export async function manageReviewerAssignment(deps: Row) {
  const action = String(deps.input?.action || '');
  const current = deps.round?.reviewerId ?? deps.book?.assignedReviewerId ?? null;
  const target = String(deps.input?.targetReviewerId || '');
  if (!deps.book?.id || !deps.round?.id) throw new BasecampError(409, 'Active review assignment is unavailable.');
  if (!(deps.eligibleReviewers || []).some((item: Row) => String(item.id) === target)) throw new BasecampError(422, 'Target reviewer is not eligible.');
  if (action === 'claim') {
    if (current) throw new BasecampError(409, 'Only an unassigned review may be claimed.');
    if (target !== String(deps.actor?.id) || !has(deps.actor, 'can_review') || !has(deps.actor, 'can_claim_review')) throw new BasecampError(403, 'Review claim is not authorized.');
  } else if (action === 'assign') {
    if (current) throw new BasecampError(409, 'This review is already assigned.');
    if (!['owner', 'tech_admin'].includes(deps.actor?.role_key) || !has(deps.actor, 'can_assign_reviewer')) throw new BasecampError(403, 'Review assignment is not authorized.');
  } else if (action === 'reassign') {
    if (!current) throw new BasecampError(409, 'This review is unassigned.');
    if (!['owner', 'tech_admin'].includes(deps.actor?.role_key) || !has(deps.actor, 'can_reassign_reviewer')) throw new BasecampError(403, 'Review reassignment is not authorized.');
  } else throw new BasecampError(422, 'Review assignment action is invalid.');
  return deps.persist({
    actorId: deps.actor.id, bookId: deps.book.id, reviewRoundId: deps.round.id,
    expectedRevision: Number(deps.round.revision), expectedReviewerUserId: current,
    targetReviewerUserId: target, action, reason: reason(deps.input?.reason),
  });
}

export async function reassignEmployee(deps: Row) {
  if (!['owner', 'tech_admin'].includes(deps.actor?.role_key) || !has(deps.actor, 'can_manage_users')) throw new BasecampError(403, 'Employee reassignment is not authorized.');
  const employee = (deps.employees || []).find((item: Row) => String(item.id) === String(deps.input?.replacementEmployeePersonId));
  if (!employee) throw new BasecampError(422, 'Select a current Pre-Press project member.');
  if (String(employee.id) === String(deps.book?.employeePersonId)) throw new BasecampError(422, 'Select a different employee.');
  const rawToken = (deps.tokenFactory || generateOpaqueToken)();
  const tokenHash = await (deps.hashToken || sha256Token)(rawToken);
  const canonical = await deps.persist({
    actorId: deps.actor.id, bookId: deps.book.id,
    expectedEmployeeRevision: Number(deps.book.employeeRevision),
    expectedEmployeePersonId: String(deps.book.employeePersonId || ''),
    replacementEmployeePersonId: String(employee.id), replacementEmployeeName: String(employee.displayName || ''),
    replacementEmployeeEmail: String(employee.email || ''), tokenHash, tokenPrefix: rawToken.slice(0, 12),
    reason: reason(deps.input?.reason),
  });
  let basecamp = { status: 'ready', retryAvailable: false };
  try {
    const result = await deps.syncBasecamp?.({ bookId: deps.book.id, employee, rawEmployeeToken: rawToken, integrationEventId: canonical.integration_event_id });
    if (result?.status === 'failed') basecamp = { status: 'failed', retryAvailable: true };
  } catch {
    basecamp = { status: 'failed', retryAvailable: true };
  }
  return { employeeRevision: Number(canonical.employee_revision), basecamp };
}

export function sanitizeOperationalSettings(input: Row) {
  const integrations = input.integrations || {};
  const mayManageUsers = (input.actor?.capabilities || []).includes('can_manage_users');
  return {
    identity: { id: input.actor?.id, displayName: input.actor?.display_name || 'Privileged user', role: input.actor?.role_key || 'reviewer' },
    capabilities: [...new Set(input.actor?.capabilities || [])].sort(),
    users: (input.users || []).map((user: Row) => ({
      id: user.id, displayName: user.display_name || 'Privileged user', email: mayManageUsers ? user.email_snapshot || '' : '',
      role: user.role_key || 'reviewer', active: !user.disabled_at, revision: Number(user.revision) || 0,
      capabilities: [...new Set(mayManageUsers ? user.capabilities || [] : (user.capabilities || []).filter((item: string) => item === 'can_review'))].sort(),
    })),
    employees: (input.employees || []).map((employee: Row) => ({ id: String(employee.id), displayName: String(employee.displayName || ''), email: String(employee.email || '') })),
    reviewerMappings: mayManageUsers ? (input.reviewerMappings || []).map((mapping: Row) => ({
      reviewerId: String(mapping.privileged_user_id || ''),
      personId: String(mapping.basecamp_person_id || ''),
      displayName: String(mapping.display_name_snapshot || ''),
      projectId: String(mapping.project_id || ''),
    })).filter((mapping: Row) => mapping.reviewerId && mapping.personId) : [],
    defaultReviewerId: input.defaultReviewerId || null,
    integrations: {
      basecamp: { status: integrations.basecamp?.status || 'disconnected', projectId: integrations.basecamp?.projectId || null },
      reviewstudio: { configured: integrations.reviewstudio?.configured === true },
      ghl: { configured: integrations.ghl?.configured === true },
    },
  };
}
