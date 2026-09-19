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
  const rawSectionValue = source.value
    ?? source.submitted_step?.sections?.[row.section_key]
    ?? source.submitted_step?.sections?.[localKey]
    ?? source.submitted_extracted_fields?.[String(row.section_key || '').split('.').pop()]
    ?? null
  const sectionValue = rawSectionValue && typeof rawSectionValue === 'object'
      && !Array.isArray(rawSectionValue)
      && Object.prototype.hasOwnProperty.call(rawSectionValue, 'sectionKey')
      && Object.prototype.hasOwnProperty.call(rawSectionValue, 'value')
    ? rawSectionValue.value
    : rawSectionValue
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

function sanitizeComment(row: Row, continuations: Map<string, Row>, actorId: string, canMutate: boolean) {
  const ownsComment = row.author_privileged_user_id === actorId
  const isRoot = !row.parent_comment_id
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
    permissions: {
      canReply: canMutate && isRoot,
      canEdit: canMutate && ownsComment,
      canResolve: canMutate && isRoot && row.actionable === true && !row.resolved_at,
      canDelete: canMutate && ownsComment,
    },
    persisted: true,
  }
}

function safeHttpsUrl(value: unknown) {
  const text = String(value || '').trim()
  if (!text) return null
  try {
    const parsed = new URL(text)
    return parsed.protocol === 'https:' ? parsed.toString() : null
  } catch {
    return null
  }
}

function sanitizeFiles(round: Row, persistedFiles: Row[] = []) {
  const files = round.submission_snapshot?.files
  if (!Array.isArray(files)) return []
  const persistedById = new Map((persistedFiles || []).map((row: Row) => [String(row.id || ''), row]))

  return files.map((file: Row) => {
    const result: Row = { fileName: String(file.file_name || '') }
    if (file.file_type || file.section_key) result.fileType = String(file.file_type || file.section_key)
    if (Number(file.version_number)) result.versionNumber = Number(file.version_number)
    if (file.mime_type) result.mimeType = String(file.mime_type)
    if (Number.isFinite(Number(file.file_size_bytes))) result.fileSizeBytes = Number(file.file_size_bytes)
    if (file.created_at) result.createdAt = file.created_at

    const persisted = persistedById.get(String(file.id || ''))
    const snapshotFileId = String(file.reviewstudio_file_id || '')
    const persistedFileId = String(persisted?.reviewstudio_file_id || '')
    const sameSubmittedFile = Boolean(persisted && snapshotFileId && persistedFileId && snapshotFileId === persistedFileId)
    if (sameSubmittedFile) {
      const viewUrl = safeHttpsUrl(persisted.reviewstudio_file_url)
      if (viewUrl) result.viewUrl = viewUrl
    }

    return result
  }).filter((file: Row) => file.fileName)
}

function snapshotSection(sections: Row, key: string) {
  const entry = sections?.[key]
  if (entry && typeof entry === 'object' && !Array.isArray(entry) && Object.prototype.hasOwnProperty.call(entry, 'value')) {
    return entry.value
  }
  return entry ?? null
}

function sanitizeSubmittedSteps(round: Row) {
  const steps = round.submission_snapshot?.steps || {}
  const detailsSections = steps.details?.state_json?.sections || {}
  const contentSections = steps.content?.state_json?.sections || {}
  const pricingSections = steps.pricing?.state_json?.sections || {}

  const authorEntry = detailsSections.primary_author || {}
  const rightsEntry = detailsSections.publishing_rights || {}
  const adultEntry = detailsSections.adult_question || {}
  const ageEntry = detailsSections.age_grade_range || {}

  return {
    details: {
      language: snapshotSection(detailsSections, 'language'),
      book_title: snapshotSection(detailsSections, 'book_title'),
      subtitle: snapshotSection(detailsSections, 'subtitle'),
      series: snapshotSection(detailsSections, 'series'),
      edition_number: snapshotSection(detailsSections, 'edition_number'),
      author: {
        value: snapshotSection(detailsSections, 'primary_author'),
        firstName: String(authorEntry?.fields?.author_first_name || ''),
        lastName: String(authorEntry?.fields?.author_last_name || ''),
      },
      contributors: snapshotSection(detailsSections, 'contributors'),
      description: snapshotSection(detailsSections, 'description'),
      publishingRights: {
        value: snapshotSection(detailsSections, 'publishing_rights'),
        label: String(rightsEntry?.label || ''),
      },
      primaryAudience: {
        adult: snapshotSection(detailsSections, 'adult_question'),
        adultLabel: String(adultEntry?.label || ''),
        age: {
          min: String(ageEntry?.fields?.reading_age_min ?? snapshotSection(detailsSections, 'age_grade_range')?.reading_age_min ?? ''),
          max: String(ageEntry?.fields?.reading_age_max ?? snapshotSection(detailsSections, 'age_grade_range')?.reading_age_max ?? ''),
        },
      },
      primary_marketplace: snapshotSection(detailsSections, 'primary_marketplace'),
      categories: snapshotSection(detailsSections, 'categories'),
      keywords: snapshotSection(detailsSections, 'keywords'),
      preorder: snapshotSection(detailsSections, 'preorder'),
    },
    content: {
      manuscript: snapshotSection(contentSections, 'manuscript'),
      cover: snapshotSection(contentSections, 'cover'),
      aiGenerated: snapshotSection(contentSections, 'ai_content'),
      preview: snapshotSection(contentSections, 'preview'),
      isbn: snapshotSection(contentSections, 'isbn'),
      accessibility: snapshotSection(contentSections, 'accessibility'),
    },
    pricing: {
      kdpSelect: pricingSections.kdp_select || null,
      territories: pricingSections.territories || null,
      primaryMarketplace: pricingSections.primary_marketplace?.value || pricingSections.primary_marketplace || null,
      royalty: pricingSections.royalty_and_pricing || null,
    },
  }
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
    const snapshotFileIds = Array.isArray(round.submission_snapshot?.files)
      ? round.submission_snapshot.files.map((file: Row) => String(file?.id || '')).filter(Boolean)
      : []

    const [items, comments, rounds, continuationRows, persistedFiles] = await Promise.all([
      deps.listItems(round.id),
      deps.listComments(round.id),
      deps.listRounds ? deps.listRounds(book.id) : [],
      deps.listContinuations ? deps.listContinuations(round.id) : [],
      deps.listSnapshotFiles && snapshotFileIds.length ? deps.listSnapshotFiles(snapshotFileIds) : [],
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
          snapshotIdentity: `round-${Number(round.round_number) || 1}-schema-${Number(round.submission_snapshot?.schema_version) || 1}`,
          reachedSteps: round.reached_steps || ['details'],
        },
        items: (items || []).filter((row: Row) => row.is_reviewable !== false).map(sanitizeItem).sort((a: Row, b: Row) => a.sortOrder - b.sortOrder),
        comments: (comments || []).map((row: Row) => sanitizeComment(row, continuations, actor.id, canMutate)),
        files: sanitizeFiles(round, persistedFiles || []),
        submittedSteps: sanitizeSubmittedSteps(round),
        roundHistory: (rounds || []).map((entry: Row) => ({ id: entry.id, roundNumber: Number(entry.round_number) || 1, status: entry.status, outcome: entry.outcome || null, finalizedAt: entry.finalized_at || null })),
        permissions: { canMutate, canFinalize: isLatest && !round.finalized_at && actor.capabilities.includes('can_finalize_book') && (canObserveAssigned || actor.capabilities.includes('can_reassign_reviewer') || actor.capabilities.includes('can_manage_users')) },
      },
    }
  } catch (error) {
    if (error instanceof BasecampError) return { status: error.status, body: { ok: false, error: error.message } }
    throw error
  }
}
