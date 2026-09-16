import {
  resolvePrivilegedBookshelf,
  sanitizeBook,
} from '../_privilegedBookshelf.ts'

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message)
}

const book = (id: string, assigned: string | null = null) => ({
  id,
  book_title: `Book ${id}`,
  primary_author_name: `Author ${id}`,
  overall_status: 'IN_REVIEW',
  updated_at: '2026-09-11T00:00:00Z',
  created_at: '2026-09-10T00:00:00Z',
  assigned_reviewer_user_id: assigned,
  latest_review_round_id: 'round-current',
  deleted_at: null,
  access_token: 'never-return-this',
  basecamp_references: [{ reference_kind: 'book_todo_list', provisioning_status: 'failed', last_provisioning_error: 'private-detail' }],
})

const base = {
  authorizationHeader: 'Bearer google-jwt',
  authenticate: async (token: string) => token === 'google-jwt' ? { id: 'auth-1', app_metadata: { provider: 'google' } } : null,
  findPrivilegedUser: async () => ({ id: 'priv-1', display_name: 'Reviewer', disabled_at: null }),
  listGrants: async () => [{ capability_key: 'can_review', revoked_at: null }],
  listAllBooks: async () => [book('all')],
  listDirectAssignedBooks: async () => [book('direct', 'priv-1')],
  listRoundBookIds: async () => ['round'],
  listBooksByIds: async () => [book('round')],
  listActiveRounds: async () => [{ id: 'round-current', reviewer_user_id: 'priv-1', revision: 2, status: 'in_review', submitted_at: '2026-09-12T12:00:00Z' }],
  listReviewerProfiles: async () => [{ id: 'priv-1', display_name: 'Rae Reviewer' }],
  listLatestFiles: async () => [{ book_id: 'direct', file_type: 'manuscript', file_name: 'draft.docx', reviewstudio_file_url: 'https://review.example/draft' }],
  attentionPolicy: { reviewDueHours: 24, reviewEscalationHours: 72, employeeUpdatesDueHours: 48, employeeUpdatesEscalationHours: 96 },
  now: Date.parse('2026-09-16T12:00:00Z'),
}

async function run() {
  let result = await resolvePrivilegedBookshelf({ ...base, authorizationHeader: null })
  assert(result.status === 401, 'unauthenticated request must be denied')

  result = await resolvePrivilegedBookshelf({ ...base, authorizationHeader: 'Bearer employee-opaque-token' })
  assert(result.status === 401, 'employee opaque token must not authenticate privileged access')

  result = await resolvePrivilegedBookshelf({ ...base, authenticate: async () => ({ id: 'auth-1', app_metadata: { provider: 'email' } }) })
  assert(result.status === 403, 'non-Google Supabase identity must not enter the privileged flow')

  result = await resolvePrivilegedBookshelf({ ...base, findPrivilegedUser: async () => null })
  assert(result.status === 403, 'authenticated identity without application record must be denied')

  result = await resolvePrivilegedBookshelf({ ...base, findPrivilegedUser: async () => ({ id: 'priv-1', display_name: 'Reviewer', disabled_at: '2026-09-11T00:00:00Z' }) })
  assert(result.status === 403, 'disabled privileged identity must be denied')

  result = await resolvePrivilegedBookshelf({ ...base, listGrants: async () => [{ capability_key: 'can_review', revoked_at: '2026-09-11T00:00:00Z' }] })
  assert(result.status === 403, 'revoked grants must not authorize')

  result = await resolvePrivilegedBookshelf({ ...base, listGrants: async () => [{ capability_key: 'can_manage_users', revoked_at: null }] })
  assert(result.status === 403, 'unrelated capabilities must not authorize Bookshelf')

  result = await resolvePrivilegedBookshelf({ ...base, role: 'admin', can_view_all_books: true, listGrants: async () => [] })
  assert(result.status === 403, 'client-supplied role and capability claims must grant nothing')

  result = await resolvePrivilegedBookshelf(base)
  assert(result.status === 200, 'assigned reviewer must be authorized')
  assert(result.body.books.map((item: { id: string }) => item.id).join(',') === 'direct,round', 'reviewer sees direct and review-round assignments only')
  assert(!('access_token' in result.body.books[0]), 'response excludes raw employee tokens')
  assert(!('assigned_reviewer_user_id' in result.body.books[0]), 'response excludes internal assignment ids')

  result = await resolvePrivilegedBookshelf({ ...base, listGrants: async () => [{ capability_key: 'can_view_all_books', revoked_at: null }] })
  assert(result.status === 200 && result.body.books[0].id === 'all', 'can_view_all_books receives authoritative full list')

  result = await resolvePrivilegedBookshelf({ ...base, listGrants: async () => [{ capability_key: 'can_create_book', revoked_at: null }] })
  assert(result.status === 200 && result.body.books.length === 0, 'create-only user may enter Bookshelf but receives no unauthorized books')
  assert(result.body.canCreateBook === true, 'create capability is exposed only as presentation context')

  result = await resolvePrivilegedBookshelf({
    ...base,
    listGrants: async () => [{ capability_key: 'can_review', revoked_at: null }, { capability_key: 'can_claim_review', revoked_at: null }],
    listUnassignedActiveBookIds: async () => ['claimable'],
    listBooksByIds: async (ids: string[]) => ids.map((id) => book(id)),
  })
  assert(result.status === 200 && result.body.books.some((item: { id: string }) => item.id === 'claimable'), 'claim-capable reviewer sees the unassigned active review queue')

  const safe = sanitizeBook(book('safe'))
  assert(Object.keys(safe).sort().join(',') === 'activeReview,attention,author,basecamp,createdAt,deletedAt,deletedBy,employeeName,employeePersonId,employeeRevision,id,latestFiles,reviewAvailable,reviewRevision,reviewerAssignmentRevision,reviewerEligible,reviewerId,reviewerName,status,title,trashRevision,type,updatedAt', 'book projection includes only presentation and operational-control fields')
  assert(safe.basecamp.status === 'failed' && safe.basecamp.retryAvailable === true, 'failed Basecamp provisioning exposes only retry-safe state')
  assert(!JSON.stringify(safe).includes('private-detail'), 'Basecamp internal errors are not returned')

  const reassignmentWarning = sanitizeBook({ ...book('employee-sync'), integration_events: [
    { event_type: 'employee_reassignment_requested', status: 'failed', created_at: '2026-09-17T00:00:00Z', payload_json: { token: 'never-return' } },
  ] })
  assert(reassignmentWarning.basecamp.status === 'failed' && reassignmentWarning.basecamp.retryKind === 'employee_reassignment', 'failed employee reassignment is exposed as a sanitized retry state')
  assert(!JSON.stringify(reassignmentWarning).includes('never-return'), 'integration event payload is never returned')

  const recoveryWarning = sanitizeBook({ ...book('employee-recovery'), integration_events: [
    { event_type: 'employee_access_recovery_requested', status: 'failed', created_at: '2026-09-17T00:00:00Z' },
  ] })
  assert(recoveryWarning.basecamp.status === 'failed' && recoveryWarning.basecamp.retryAvailable === true, 'failed employee access recovery remains retryable')
  assert(recoveryWarning.basecamp.retryKind === 'employee_reassignment', 'employee access recovery reuses the deterministic employee sync retry boundary')

  const reviewWarning = sanitizeBook({ ...book('review-warning'), basecamp_references: [
    { reference_kind: 'book_todo_list', provisioning_status: 'provisioned' },
    { reference_kind: 'review_round', review_round_id: 'round-current', provisioning_status: 'failed', last_provisioning_error: 'private-detail' },
  ] })
  assert(reviewWarning.basecamp.status === 'failed' && reviewWarning.basecamp.retryAvailable === true, 'current review lifecycle warning takes precedence without exposing detail')
  assert(reviewWarning.basecamp.retryKind === 'review_round', 'current review lifecycle exposes only the safe retry kind')

  const outcomeWarning = sanitizeBook({ ...book('outcome-warning'), overall_status: 'EMPLOYEE_UPDATES', basecamp_references: [
    { reference_kind: 'book_todo_list', provisioning_status: 'provisioned' },
    { reference_kind: 'review_round', review_round_id: 'round-current', provisioning_status: 'provisioned' },
    { reference_kind: 'employee_update', review_round_id: 'round-current', provisioning_status: 'failed', last_provisioning_error: 'private-detail' },
  ] })
  assert(outcomeWarning.basecamp.status === 'failed' && outcomeWarning.basecamp.retryAvailable === true, 'finalized outcome sync warning takes precedence without exposing detail')
  assert(outcomeWarning.basecamp.retryKind === 'review_outcome', 'finalized outcome exposes the dedicated retry kind')

  const enriched = await resolvePrivilegedBookshelf(base)
  const direct = enriched.body.books.find((item: { id: string }) => item.id === 'direct')
  assert(direct.reviewerName === 'Rae Reviewer', 'assigned reviewer name is projected for the operational card')
  assert(direct.latestFiles[0].fileName === 'draft.docx' && direct.latestFiles[0].url === 'https://review.example/draft', 'latest safe file access is projected without backend identifiers')
  assert(direct.attention?.state === 'escalated', 'overdue attention is derived from configured thresholds without changing workflow state')
  assert(!('reviewstudio_file_id' in direct.latestFiles[0]), 'file projection excludes unnecessary backend identifiers')

  console.log('PASS privileged authorization and Bookshelf scoping (25 assertions)')
}

await run()
