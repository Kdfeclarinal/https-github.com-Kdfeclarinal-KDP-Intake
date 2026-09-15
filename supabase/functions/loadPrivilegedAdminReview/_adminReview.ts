import { BasecampError } from '../_shared/basecampClient.ts'
import { resolvePrivilegedActor } from '../_shared/privilegedRequest.ts'

type Row = Record<string, any>

const ACTIVE_BOOK_STATUSES = new Set(['for_approval', 'AWAITING_REVIEW', 'in_admin_review', 'IN_REVIEW'])
const ACTIVE_ROUND_STATUSES = new Set(['submitted', 'in_review'])

function decisionOf(row: Row) {
  const value = String(row.decision || row.review_status || row.status || 'pending').toLowerCase()
  return ['pending', 'approved', 'needs_updates'].includes(value) ? value : 'pending'
}

function sanitizeItem(row: Row) {
  const source = row.section_snapshot && typeof row.section_snapshot === 'object' ? row.section_snapshot : {}
  const localKey = String(row.section_key || '').split('.').pop()
  const sectionValue = source.value
    ?? source.submitted_step?.sections?.[row.section_key]
    ?? source.submitted_step?.sections?.[localKey]
    ?? source.submitted_extracted_fields?.[String(row.section_key || '').split('.').pop()]
    ?? null
  return {
    id: row.id,
    step: row.step_name,
    sectionKey: row.section_key,
    label: row.section_label || 'Review section',
    sortOrder: Number(row.sort_order) || 0,
    fileSection: row.is_file_section === true,
    decision: decisionOf(row),
    required: row.is_reviewable !== false,
    carried: Boolean(row.carried_from_review_item_id),
    snapshot: { value: sectionValue },
  }
}

function sanitizeContinuation(row: Row) {
  return {
    threadId: row.id,
    sourceRoundNumber: Number(row.source_round_number) || null,
    originalRequest: String(row.request_body_snapshot || ''),
    originalIssueNumber: row.request_number_snapshot || null,
    originalReviewer: String(row.reviewer_name_snapshot || 'Reviewer'),
    requestedAt: row.requested_at || null,
    readyForRereview: Boolean(row.ready_at || row.ready_via_reply || row.ready_via_change || row.ready_via_file_change),
    readiness: {
      viaReply: row.ready_via_reply === true,
      viaChange: row.ready_via_change === true,
      viaFileChange: row.ready_via_file_change === true,
    },
    employeeReplies: (row.replies || []).map((reply: Row) => ({
      id: reply.id,
      body: String(reply.body || ''),
      author: String(reply.author_name_snapshot || 'Employee'),
      createdAt: reply.created_at || null,
    })),
  }
}

function sanitizeComment(row: Row, continuations: Map<string, Row>) {
  return {
    id: row.id,
    itemId: row.review_item_id || null,
    parentCommentId: row.parent_comment_id || null,
    body: String(row.comment_text || row.comment || row.body || ''),
    author: String(row.admin_name || row.author_name || 'Reviewer'),
    createdAt: row.created_at || null,
    actionable: row.actionable === true && !row.parent_comment_id,
    issueNumber: row.round_comment_number || null,
    resolved: Boolean(row.resolved_at),
    resolvedAt: row.resolved_at || null,
    editedAt: row.edited_at || null,
    authorActorType: row.author_actor_type || 'privileged',
    continuation: continuations.has(row.id) ? sanitizeContinuation(continuations.get(row.id)) : null,
    persisted: true,
  }
}

function sanitizeFiles(round: Row) {
  const files = round.submission_snapshot?.files
  if (!Array.isArray(files)) return []
  return files.map((file: Row) => {
    const result: Row = { fileName: String(file.file_name || '') }
    if (file.file_type || file.section_key) result.fileType = String(file.file_type || file.section_key)
    if (Number(file.version_number)) result.versionNumber = Number(file.version_number)
    return result
  }).filter((file: Row) => file.fileName)
}

export async function resolvePrivilegedAdminReview(deps: Row, bookId: unknown, requestedRoundId?: unknown) {
  try {
    const normalizedBookId = String(bookId || '').trim()
    if (!normalizedBookId) return { status: 400, body: { ok: false, error: 'A book is required.' } }
    const actor = await resolvePrivilegedActor({ ...deps, requiredCapabilities: ['can_review', 'can_view_all_books'] })
    const book = await deps.findBook(normalizedBookId)
    if (!book || book.deleted_at) return { status: 404, body: { ok: false, error: 'Review not found.' } }
    const roundId = String(requestedRoundId || book.latest_review_round_id || '').trim()
    const round = await deps.findRound(roundId)
    const isLatest = round?.id === book.latest_review_round_id
    const currentActive = ACTIVE_BOOK_STATUSES.has(String(book.overall_status || ''))
      && ACTIVE_ROUND_STATUSES.has(String(round?.status || '')) && !round?.finalized_at
    const immutableHistory = Boolean(round?.finalized_at)
    if (!round || round.book_id !== book.id || (!currentActive && !immutableHistory) || (!isLatest && !immutableHistory)) {
      return { status: 409, body: { ok: false, error: 'The active review round is unavailable.' } }
    }
    const assignedReviewer = round.reviewer_user_id || book.assigned_reviewer_user_id
    const canObserveAssigned = Boolean(assignedReviewer) && assignedReviewer === actor.id && actor.capabilities.includes('can_review')
    const canMutate = isLatest && Boolean(assignedReviewer) && assignedReviewer === actor.id && actor.capabilities.includes('can_review') && !round.finalized_at
    if (!canObserveAssigned && !actor.capabilities.includes('can_view_all_books')) {
      return { status: 403, body: { ok: false, error: 'This review is not assigned to the current reviewer.' } }
    }
    const [items, comments, rounds, continuationRows] = await Promise.all([
      deps.listItems(round.id),
      deps.listComments(round.id),
      deps.listRounds ? deps.listRounds(book.id) : [],
      deps.listContinuations ? deps.listContinuations(round.id) : [],
    ])
    const continuations = new Map((continuationRows || []).map((row: Row) => [row.target_comment_id, row]))
    return {
      status: 200,
      body: {
        ok: true,
        identity: { displayName: actor.display_name || 'Reviewer' },
        book: { id: book.id, title: book.book_title || 'Untitled', author: book.primary_author_name || '' },
        reviewRound: {
          id: round.id,
          revision: Number(round.revision) || 0,
          roundNumber: Number(round.round_number) || 1,
          status: round.status,
          outcome: round.outcome || null,
          submittedAt: round.submitted_at || null,
          submittedBy: round.submitted_by_name || null,
          finalizedAt: round.finalized_at || null,
          finalizedBy: round.finalized_by_name || null,
          reviewer: round.reviewer_name_snapshot || null,
          reachedSteps: round.reached_steps || ['details'],
        },
        items: (items || []).filter((row: Row) => row.is_reviewable !== false).map(sanitizeItem).sort((a: Row, b: Row) => a.sortOrder - b.sortOrder),
        comments: (comments || []).map((row: Row) => sanitizeComment(row, continuations)),
        files: sanitizeFiles(round),
        roundHistory: (rounds || []).map((entry: Row) => ({ id: entry.id, roundNumber: Number(entry.round_number) || 1, status: entry.status, outcome: entry.outcome || null, finalizedAt: entry.finalized_at || null })),
        permissions: { canMutate, canFinalize: isLatest && !round.finalized_at && actor.capabilities.includes('can_finalize_book') && (canObserveAssigned || actor.capabilities.includes('can_reassign_reviewer') || actor.capabilities.includes('can_manage_users')) },
      },
    }
  } catch (error) {
    if (error instanceof BasecampError) return { status: error.status, body: { ok: false, error: error.message } }
    throw error
  }
}
