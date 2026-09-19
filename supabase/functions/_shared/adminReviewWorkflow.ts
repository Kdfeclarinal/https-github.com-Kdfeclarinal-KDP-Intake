import { BasecampError } from './basecampClient.ts'

type Row = Record<string, any>

const decided = (value: unknown) => ['approved', 'needs_updates'].includes(String(value || '').toLowerCase())

export function validateReviewMutation({ actor, round, book, item, allowAssignmentOverride = false }: Row) {
  if (!actor?.capabilities?.includes('can_review')) throw new BasecampError(403, 'Review is not authorized.')
  if (!round || round.book_id !== book?.id || book.latest_review_round_id !== round.id) throw new BasecampError(403, 'Review is not authorized.')
  if (round.reviewer_user_id !== actor.id && !allowAssignmentOverride) throw new BasecampError(403, 'This review is not assigned to the current reviewer.')
  if (round.finalized_at || !['submitted', 'in_review'].includes(String(round.status))) throw new BasecampError(409, 'The review round is immutable.')
  if (item && (item.book_id !== book.id || item.review_round_id !== round.id)) throw new BasecampError(403, 'Review item is not authorized.')
  return true
}

export function validateReviewFinalization({ actor, round, book, outcome, allowAssignmentOverride = false }: Row) {
  if (!actor?.capabilities?.includes('can_review') || !actor?.capabilities?.includes('can_finalize_book')) throw new BasecampError(403, 'Book finalization is not authorized.')
  if (!round || round.book_id !== book?.id) throw new BasecampError(403, 'Review finalization is not authorized.')
  if (round.reviewer_user_id !== actor.id && !allowAssignmentOverride) throw new BasecampError(403, 'Review finalization is not assigned or authorized.')
  const expected = outcome === 'approve_book' ? 'approved' : outcome === 'request_updates' ? 'request_updates' : null
  if (!expected) throw new BasecampError(400, 'Review outcome is invalid.')
  if (round.finalized_at) {
    if (round.outcome === expected) return 'replay'
    throw new BasecampError(409, 'Review round is immutable.')
  }
  if (book.latest_review_round_id !== round.id) throw new BasecampError(403, 'Review finalization is not authorized.')
  if (!['submitted', 'in_review'].includes(String(round.status))) throw new BasecampError(409, 'Review round is immutable.')
  return 'active'
}

export function deriveSectionState(current: unknown, threads: Row[] = []) {
  const actionable = threads.filter((thread) => thread.actionable !== false)
  if (actionable.some((thread) => !thread.resolved && !thread.deleted)) return 'needs_updates'
  if (String(current) === 'needs_updates') return 'pending'
  return ['pending', 'approved'].includes(String(current)) ? String(current) : 'pending'
}

export function assertPageMayAdvance(items: Row[]) {
  const pending = items.filter((item) => item.required !== false && !decided(item.decision))
  if (pending.length) throw new BasecampError(422, `Decide all required sections before continuing: ${pending.map((item) => item.label || item.sectionKey).join(', ')}.`)
  return true
}

export function assertWholeBookOutcome({ actor, outcome, items }: Row) {
  if (!actor?.capabilities?.includes('can_finalize_book')) throw new BasecampError(403, 'The current user cannot finalize this book.')
  const required = (items || []).filter((item: Row) => item.required !== false)
  if (required.some((item: Row) => !decided(item.decision))) throw new BasecampError(422, 'Required review sections are still pending.')
  if (outcome === 'request_updates') {
    if (!required.some((item: Row) => item.decision === 'needs_updates')) throw new BasecampError(422, 'Request Updates requires at least one requested change.')
    return 'EMPLOYEE_UPDATES'
  }
  if (outcome === 'approve_book') {
    if (required.some((item: Row) => item.decision !== 'approved' || Number(item.unresolvedActionable || 0) > 0)) throw new BasecampError(422, 'All required sections must be approved.')
    return 'KDP_INTAKE_APPROVED'
  }
  throw new BasecampError(400, 'Review outcome is invalid.')
}

export function nextRoundDecisions(previous: Row[], current: Row[]) {
  const old = new Map((previous || []).map((item: Row) => [item.sectionKey, item]))
  return Object.fromEntries((current || []).map((item: Row) => {
    const prior = old.get(item.sectionKey)
    const carries = prior?.decision === 'approved'
      && prior.snapshotHash === item.snapshotHash
      && !prior.requested
      && !prior.reopened
      && !prior.dependencyInvalidated
      && !item.dependencyInvalidated
    return [item.sectionKey, carries ? 'approved' : 'pending']
  }))
}

function normalized(value: any): any {
  if (typeof value === 'string') return value.trim()
  if (Array.isArray(value)) return value.map(normalized)
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, normalized(value[key])]))
  return value ?? null
}

const localSectionKey = (value: unknown) => String(value || '').replace(/^[^.]+\./, '')

export function assertEmployeeUpdateSections(existingState: Row, nextState: Row, editableSectionKeys: string[]) {
  const editable = new Set((editableSectionKeys || []).map(localSectionKey))
  const before = existingState?.sections || {}
  const after = nextState?.sections || {}
  const keys = new Set([...Object.keys(before), ...Object.keys(after)])
  const lockedChanges = [...keys].filter((key) => !editable.has(key)
    && JSON.stringify(normalized(before[key])) !== JSON.stringify(normalized(after[key])))
  if (lockedChanges.length) throw new BasecampError(403, `Approved sections are locked: ${lockedChanges.join(', ')}.`)
  return true
}

const EXTRACTED_FIELD_SECTIONS: Record<string, Record<string, string>> = {
  details: {
    book_title: 'book_title',
    subtitle: 'subtitle',
    primary_author_name: 'primary_author',
    primary_marketplace: 'primary_marketplace',
  },
  content: {
    drm: 'manuscript',
    cover_option: 'cover',
    ai_generated_content: 'ai_content',
    accessibility: 'accessibility',
  },
}

export function assertEmployeeUpdateExtractedFields(existingFields: Row, nextFields: Row, editableSectionKeys: string[], step: string) {
  const editable = new Set((editableSectionKeys || []).map(localSectionKey))
  const before = existingFields || {}
  const after = nextFields || {}
  const mapping = EXTRACTED_FIELD_SECTIONS[String(step)] || {}
  const keys = new Set([...Object.keys(before), ...Object.keys(after)])
  const lockedChanges = [...keys].filter((key) => {
    if (JSON.stringify(normalized(before[key])) === JSON.stringify(normalized(after[key]))) return false
    return !editable.has(mapping[key] || localSectionKey(key))
  })
  if (lockedChanges.length) throw new BasecampError(403, `Approved extracted fields are locked: ${lockedChanges.join(', ')}.`)
  return true
}

export function assertEmployeeUpdateFileSection(status: unknown, editableSectionKeys: string[], fileType: string) {
  if (!['needs_updates', 'EMPLOYEE_UPDATES'].includes(String(status))) return true
  const allowed = new Set((editableSectionKeys || []).map((key) => String(key).replace(/^content\./, '')))
  if (!allowed.has(String(fileType).replace(/^content\./, ''))) throw new BasecampError(403, 'This approved file section is locked.')
  return true
}
