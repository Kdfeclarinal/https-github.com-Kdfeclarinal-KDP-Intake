const SETTINGS_CAPABILITIES = new Set(['can_manage_users', 'can_change_default_reviewer', 'can_assign_reviewer', 'can_reassign_reviewer', 'can_claim_review', 'can_manage_integrations']);
const ALL_CAPABILITIES = ['can_review', 'can_claim_review', 'can_assign_reviewer', 'can_reassign_reviewer', 'can_change_default_reviewer', 'can_create_book', 'can_view_all_books', 'can_finalize_book', 'can_manage_users', 'can_manage_integrations'];
const TECH_ADMIN_DELEGABLE = new Set(ALL_CAPABILITIES.filter((capability) => !['can_manage_users', 'can_manage_integrations'].includes(capability)));

export function manageableCapabilities(actorRole) {
  return actorRole === 'owner' ? [...ALL_CAPABILITIES] : ALL_CAPABILITIES.filter((capability) => TECH_ADMIN_DELEGABLE.has(capability));
}

export function canManageTeamMember(actor = {}, user = {}) {
  if (actor.role === 'owner') return true;
  return actor.role === 'tech_admin' && actor.id !== user.id && user.role !== 'owner';
}

export function canOpenSettings(capabilities = []) {
  return capabilities.some((capability) => SETTINGS_CAPABILITIES.has(capability));
}

export function reviewerIntervention(book = {}) {
  if (!book.activeReview) return null;
  if (!book.reviewerId) return 'unassigned';
  return book.reviewerEligible ? null : 'ineligible';
}

export function reviewerAssignmentAction(book = {}, actor = {}, targetReviewerId = '') {
  const capabilities = Array.isArray(actor.capabilities) ? actor.capabilities : [];
  if (!book.reviewerId) {
    if (['owner', 'tech_admin'].includes(actor.role) && capabilities.includes('can_assign_reviewer')) return 'assign';
    if (targetReviewerId === actor.id && capabilities.includes('can_review') && capabilities.includes('can_claim_review')) return 'claim';
    return null;
  }
  return ['owner', 'tech_admin'].includes(actor.role) && capabilities.includes('can_reassign_reviewer') && targetReviewerId !== book.reviewerId
    ? 'reassign'
    : null;
}

export function teamMemberDraft(user) {
  return {
    id: user.id,
    role: user.role || 'reviewer',
    active: user.active === true,
    revision: Number(user.revision) || 0,
    capabilities: [...new Set(user.capabilities || [])].sort(),
    reason: '',
  };
}
