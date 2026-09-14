type Row = Record<string, any>

const BOOKSHELF_CAPABILITIES = new Set(['can_view_all_books', 'can_review', 'can_create_book'])

function bearer(header: string | null | undefined) {
  const match = /^Bearer ([^\s]+)$/i.exec(String(header || '').trim())
  return match?.[1] || null
}

export function sanitizeBook(row: Row, reviewerUserId?: string, capabilities: string[] = []) {
  const references = row.basecamp_references || []
  const finalizedOutcome = ['needs_updates', 'EMPLOYEE_UPDATES', 'approved', 'KDP_INTAKE_APPROVED'].includes(String(row.overall_status || ''))
  const reference = (finalizedOutcome
    ? references.find((item: Row) => item?.reference_kind === 'employee_update' && item?.review_round_id === row.latest_review_round_id)
      || references.find((item: Row) => item?.reference_kind === 'review_round' && item?.review_round_id === row.latest_review_round_id)
    : references.find((item: Row) => item?.reference_kind === 'review_round' && item?.review_round_id === row.latest_review_round_id))
    || references.find((item: Row) => item?.reference_kind === 'book_todo_list')
  const rawStatus = reference?.provisioning_status
  const status = rawStatus === 'provisioned' ? 'ready' : rawStatus === 'failed' ? 'failed' : 'incomplete'
  const retryKind = finalizedOutcome && ['review_round', 'employee_update'].includes(reference?.reference_kind)
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
    basecamp: { status, retryAvailable: Boolean(reference) && (status === 'failed' || status === 'incomplete'), retryKind },
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
    .filter((key: string) => BOOKSHELF_CAPABILITIES.has(key)))]
    .sort()
  if (!capabilities.length) {
    return { status: 403, body: { ok: false, error: 'Bookshelf access is not authorized.' } }
  }

  let rows: Row[] = []
  if (capabilities.includes('can_view_all_books')) {
    rows = await deps.listAllBooks()
  } else if (capabilities.includes('can_review')) {
    const [direct, roundIds] = await Promise.all([
      deps.listDirectAssignedBooks(privilegedUser.id),
      deps.listRoundBookIds(privilegedUser.id),
    ])
    const roundBooks = roundIds.length ? await deps.listBooksByIds(roundIds) : []
    rows = [...direct, ...roundBooks]
  }

  const unique = [...new Map(rows.map((row) => [row.id, row])).values()]
  return {
    status: 200,
    body: {
      ok: true,
      identity: { displayName: privilegedUser.display_name || 'Privileged user' },
      capabilities,
      canViewBookshelf: true,
      canCreateBook: capabilities.includes('can_create_book'),
      books: unique.map((row) => sanitizeBook(row, privilegedUser.id, capabilities)),
    },
  }
}
