import { BasecampError } from './basecampClient.ts'
import { validateReviewFinalization, validateReviewMutation } from './adminReviewWorkflow.ts'

type Row = Record<string, any>
const ITEM_ACTIONS = new Set(['approve', 'reopen'])
const FINAL_ACTIONS = new Set(['request_updates', 'approve_book'])
const ALLOWED_ACTIONS = new Set(['approve', 'reopen', 'comment', 'reply', 'edit_comment', 'resolve_comment', 'delete_comment', 'approve_all', 'reach_step', ...FINAL_ACTIONS])

export async function mutatePrivilegedAdminReview(deps: Row, input: Row) {
  try {
    const bookId = String(input?.bookId || '').trim()
    const roundId = String(input?.reviewRoundId || '').trim()
    const action = String(input?.action || '').trim()
    const expectedRevision = Number(input?.expectedRevision)
    if (!bookId || !roundId || !ALLOWED_ACTIONS.has(action)
      || input?.expectedRevision == null || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
      throw new BasecampError(400, 'Review request is invalid.')
    }
    const actor = await deps.resolveActor()
    const [book, round] = await Promise.all([deps.findBook(bookId), deps.findRound(roundId)])
    let item = null
    const itemRequired = ITEM_ACTIONS.has(action) || (action === 'comment' && input.actionable === true)
    if (itemRequired) {
      if (!input.itemId) throw new BasecampError(400, 'A review section is required.')
      item = await deps.findItem(String(input.itemId))
    }
    const assignmentOverride = FINAL_ACTIONS.has(action) && (actor.capabilities.includes('can_manage_users') || actor.capabilities.includes('can_reassign_reviewer'))
    if (FINAL_ACTIONS.has(action)) {
      validateReviewFinalization({ actor, round, book, outcome: action, allowAssignmentOverride: assignmentOverride })
      await deps.finalizeRound({ bookId, roundId, actorId: actor.id, outcome: action, expectedRevision })
    } else {
      validateReviewMutation({ actor, round, book, item, allowAssignmentOverride: assignmentOverride })
      await deps.applyAction({
        bookId, roundId, actorId: actor.id, action, expectedRevision,
        payload: {
          item_id: input.itemId || null,
          comment_id: input.commentId || null,
          body: input.body || null,
          actionable: input.actionable === true,
          step_name: input.step || null,
        },
      })
    }
    const authoritative = await deps.reload(bookId)
    return { status: 200, body: authoritative }
  } catch (error) {
    if (error instanceof BasecampError) return { status: error.status, body: { ok: false, error: error.message } }
    throw error
  }
}
