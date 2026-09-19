type Row = Record<string, any>

const BOOKSHELF_CAPABILITIES = new Set(['can_view_all_books', 'can_review', 'can_create_book'])

function deriveAttention(row: Row, policy: Row = {}, now = Date.now()) {
  const status = String(row.overall_status || '')
  const employeeUpdates = ['needs_updates', 'EMPLOYEE_UPDATES'].includes(status)
  const activeReview = ['for_approval', 'AWAITING_REVIEW', 'in_admin_review', 'IN_REVIEW'].includes(status)
  if (!employeeUpdates && !activeReview) return null
  const dueHours = Number(employeeUpdates ? policy.employeeUpdatesDueHours : policy.reviewDueHours)
  const escalationHours = Number(employeeUpdates ? policy.employeeUpdatesEscalationHours : policy.reviewEscalationHours)
  const since = employeeUpdates
    ? row.active_round?.employee_updates_started_at || row.active_round?.finalized_at
    : row.active_round?.started_at || row.active_round?.submitted_at
  const started = Date.parse(String(since || ''))
  if (!Number.isFinite(started) || !Number.isFinite(dueHours) || dueHours <= 0) return null
  const elapsedHours = (Number(now) - started) / 3_600_000
  if (elapsedHours < dueHours) return null
  return { state: Number.isFinite(escalationHours) && escalationHours > dueHours && elapsedHours >= escalationHours ? 'escalated' : 'overdue', since }
}

function safeHttpsUrl(value: unknown) {
  const raw = String(value || '')
  try { const parsed = new URL(raw); return parsed.protocol === 'https:' ? parsed.toString() : '' } catch { return '' }
}

function safeFile(row: Row) {
  const url = safeHttpsUrl(row.download_url || row.reviewstudio_file_url)
  const previewUrl = safeHttpsUrl(row.metadata?.reviewstudio_response?.thumbnail_url)
  return { fileType: String(row.file_type || ''), fileName: String(row.file_name || ''), url, previewUrl }
}

function bearer(header: string | null | undefined) {
  const match = /^Bearer ([^\s]+)$/i.exec(String(header || '').trim())
  return match?.[1] || null
}

export function sanitizeBook(row: Row, reviewerUserId?: string, capabilities: string[] = [], attentionPolicy: Row = {}, now = Date.now()) {
  const references = row.basecamp_references || []
  const finalizedOutcome = ['needs_updates', 'EMPLOYEE_UPDATES', 'approved', 'KDP_INTAKE_APPROVED'].includes(String(row.overall_status || ''))
  const reference = (finalizedOutcome
    ? references.find((item: Row) => item?.reference_kind === 'employee_update' && item?.review_round_id === row.latest_review_round_id)
      || references.find((item: Row) => item?.reference_kind === 'review_round' && item?.review_round_id === row.latest_review_round_id)
    : references.find((item: Row) => item?.reference_kind === 'review_round' && item?.review_round_id === row.latest_review_round_id))
    || references.find((item: Row) => item?.reference_kind === 'book_todo_list')
  const rawStatus = reference?.provisioning_status
  const reassignmentEvent = [...(row.integration_events || [])]
    .filter((item: Row) => ['employee_reassignment_requested', 'employee_access_recovery_requested'].includes(item?.event_type) && ['pending', 'failed'].includes(item?.status))
    .sort((a: Row, b: Row) => Date.parse(b.created_at || '') - Date.parse(a.created_at || ''))[0]
  const reassignmentPending = ['pending', 'failed'].includes(String(reassignmentEvent?.status || ''))
  const trashEvent = [...(row.integration_events || [])]
    .filter((item: Row) => ['book_trash_sync_requested', 'book_recovery_sync_requested'].includes(item?.event_type) && ['pending', 'failed'].includes(String(item?.status || '')))
    .sort((a: Row, b: Row) => Date.parse(b.created_at || '') - Date.parse(a.created_at || ''))[0]
  const status = trashEvent ? (trashEvent.status === 'failed' ? 'failed' : 'incomplete') : reassignmentPending ? (reassignmentEvent.status === 'failed' ? 'failed' : 'incomplete') : rawStatus === 'provisioned' ? 'ready' : rawStatus === 'failed' ? 'failed' : 'incomplete'
  const retryKind = reassignmentPending ? 'employee_reassignment' : finalizedOutcome && ['review_round', 'employee_update'].includes(reference?.reference_kind)
    ? 'review_outcome'
    : reference?.reference_kind === 'review_round' ? 'review_round' : 'book_setup'
  return {
    id: row.id,
    title: row.book_title || 'Untitled',
    author: row.primary_author_name || '',
    type: 'Kindle eBook',
    status: row.overall_status,
    updatedAt: row.updated_at || null,
    createdAt: row.created_at || null,
    reviewAvailable: capabilities.includes('can_review')
      && Boolean(row.latest_review_round_id)
      && row.assigned_reviewer_user_id === reviewerUserId
      && ['for_approval', 'AWAITING_REVIEW', 'in_admin_review', 'IN_REVIEW'].includes(String(row.overall_status || '')),
    activeReview: Boolean(row.latest_review_round_id) && ['for_approval', 'AWAITING_REVIEW', 'in_admin_review', 'IN_REVIEW'].includes(String(row.overall_status || '')),
    reviewerId: row.active_round?.reviewer_user_id || row.assigned_reviewer_user_id || null,
    reviewerEligible: row.reviewer_eligible === true,
    reviewRevision: Number(row.active_round?.revision) || 0,
    reviewerAssignmentRevision: Number(row.reviewer_assignment_revision) || 0,
    employeePersonId: row.employee_basecamp_person_id || null,
    employeeName: row.employee_name || '',
    reviewerName: row.reviewer_profile?.display_name || row.active_round?.reviewer_name_snapshot || '',
    employeeRevision: Number(row.employee_revision) || 0,
    latestFiles: (row.latest_files || []).map(safeFile).filter((file: Row) => file.fileName),
    coverUrl: ((row.latest_files || []).map(safeFile).find((file: Row) => String(file.fileType).toLowerCase() === 'cover')?.previewUrl) || '',
    deletedAt: row.deleted_at || null,
    deletedBy: row.deleted_by_profile?.display_name || '',
    trashRevision: Number(row.trash_revision) || 0,
    attention: deriveAttention(row, attentionPolicy, now),
    basecamp: { status, retryAvailable: !trashEvent && Boolean(reference) && (status === 'failed' || status === 'incomplete'), retryKind, operatorIntervention: Boolean(trashEvent) },
  }
}

export async function resolvePrivilegedBookshelf(deps: Row) {
  const token = bearer(deps.authorizationHeader)
  if (!token) return { status: 401, body: { ok: false, error: 'Authentication required.' } }

  const authUser = await deps.authenticate(token)
  if (!authUser?.id) return { status: 401, body: { ok: false, error: 'Authentication required.' } }
  const providers = authUser.app_metadata?.providers || [authUser.app_metadata?.provider]
  if (!providers.includes('google')) {
    return { status: 403, body: { ok: false, error: 'Google authentication is required.' } }
  }

  const privilegedUser = await deps.findPrivilegedUser(authUser.id)
  if (!privilegedUser || privilegedUser.disabled_at) {
    return { status: 403, body: { ok: false, error: 'Privileged access is not authorized.' } }
  }

  const grants = await deps.listGrants(privilegedUser.id)
  const capabilities = [...new Set((grants || [])
    .filter((row: Row) => !row.revoked_at)
    .map((row: Row) => row.capability_key)
    .filter((key: unknown): key is string => typeof key === 'string'))]
    .sort()
  if (!capabilities.some((key) => BOOKSHELF_CAPABILITIES.has(key))) {
    return { status: 403, body: { ok: false, error: 'Bookshelf access is not authorized.' } }
  }

  let rows: Row[] = []
  if (capabilities.includes('can_view_all_books')) {
    rows = await deps.listAllBooks()
  } else if (capabilities.includes('can_review')) {
    const [direct, roundIds, claimableIds] = await Promise.all([
      deps.listDirectAssignedBooks(privilegedUser.id),
      deps.listRoundBookIds(privilegedUser.id),
      capabilities.includes('can_claim_review') && deps.listUnassignedActiveBookIds ? deps.listUnassignedActiveBookIds() : [],
    ])
    const relatedIds = [...new Set([...roundIds, ...claimableIds])]
    const roundBooks = relatedIds.length ? await deps.listBooksByIds(relatedIds) : []
    rows = [...direct, ...roundBooks]
  }

  const unique = [...new Map(rows.map((row) => [row.id, row])).values()]
  const [rounds, eligibleReviewerIds] = await Promise.all([
    deps.listActiveRounds ? deps.listActiveRounds(unique.map((row) => row.latest_review_round_id).filter(Boolean)) : [],
    deps.listEligibleReviewerIds ? deps.listEligibleReviewerIds() : [],
  ])
  const roundMap = new Map((rounds || []).map((round: Row) => [round.id, round]))
  const eligible = new Set(eligibleReviewerIds || [])
  const profileIds = [...new Set(unique.flatMap((row) => [roundMap.get(row.latest_review_round_id)?.reviewer_user_id || row.assigned_reviewer_user_id, row.deleted_by_privileged_user_id]).filter(Boolean))]
  const [profiles, files] = await Promise.all([
    deps.listReviewerProfiles ? deps.listReviewerProfiles(profileIds) : [],
    deps.listLatestFiles ? deps.listLatestFiles(unique.map((row) => row.id)) : [],
  ])
  const profileMap = new Map((profiles || []).map((profile: Row) => [profile.id, profile]))
  const filesByBook = new Map<string, Row[]>()
  for (const file of files || []) filesByBook.set(file.book_id, [...(filesByBook.get(file.book_id) || []), file])
  const enriched = unique.map((row) => {
    const activeRound = roundMap.get(row.latest_review_round_id) || null
    const reviewerId = activeRound?.reviewer_user_id || row.assigned_reviewer_user_id || null
    return { ...row, active_round: activeRound, reviewer_profile: profileMap.get(reviewerId), deleted_by_profile: profileMap.get(row.deleted_by_privileged_user_id), latest_files: filesByBook.get(row.id) || [], reviewer_eligible: Boolean(reviewerId) && eligible.has(reviewerId) }
  })
  return {
    status: 200,
    body: {
      ok: true,
      identity: { displayName: privilegedUser.display_name || 'Privileged user' },
      capabilities,
      canViewBookshelf: true,
      canCreateBook: capabilities.includes('can_create_book'),
      books: enriched.map((row) => sanitizeBook(row, privilegedUser.id, capabilities, deps.attentionPolicy || {}, deps.now ?? Date.now())),
    },
  }
}
