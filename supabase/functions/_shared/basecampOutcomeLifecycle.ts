import { BasecampError } from './basecampClient.ts'

type Row = Record<string, any>

export const employeeUpdateMarker = (roundId: string) => `KDP Intake Employee Updates Round: ${roundId}`

const escapeHtml = (value: unknown) => String(value || '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;')

export function employeeUpdateSummary(deps: Row) {
  const sections = [...new Set((deps.requestedSections || []).map((value: unknown) => String(value || '').trim()).filter(Boolean))]
  const count = sections.length
  return [
    deps.bookAuthor ? `<p><strong>Book Author:</strong> ${escapeHtml(deps.bookAuthor)}</p>` : '',
    `<div><small>Internal reference: ${escapeHtml(employeeUpdateMarker(deps.round.id))}</small></div>`,
    `<p><strong>Reviewer:</strong> ${escapeHtml(deps.reviewerName || 'Assigned reviewer')}</p>`,
    `<p><strong>${count} ${count === 1 ? 'section requires' : 'sections require'} updates:</strong> ${sections.length ? sections.map(escapeHtml).join(', ') : 'See the KDP Intake review.'}</p>`,
    '<p>Open the existing KDP Pre-Press link for the book to review requests, reply, make changes, and resubmit.</p>',
  ].join('')
}

export async function syncBasecampReviewOutcome(deps: Row) {
  try {
    let employeeTodoId = deps.existingEmployeeTodo?.id || null

    if (deps.outcome === 'request_updates' && !employeeTodoId) {
      if (!deps.employeePersonId || !Number.isFinite(Number(deps.employeePersonId))) {
        throw new BasecampError(409, 'The employee Basecamp assignment is unavailable.', 'employee_mapping_unavailable')
      }
      const created = await deps.createEmployeeTodo({
        content: `KDP Pre-Press — Stage ${Number(deps.round.roundNumber || 0) + 1}`,
        description: employeeUpdateSummary(deps),
        assignee_ids: [Number(deps.employeePersonId)],
      })
      if (!created?.id) throw new BasecampError(502, 'Basecamp returned an invalid KDP Pre-Press task.')
      employeeTodoId = String(created.id)
    }

    // For Request Updates, create/reconcile the next employee task first.
    // Only then complete Review so Basecamp never has a dead-end handoff.
    if (!deps.reviewTodo?.completed) await deps.completeTodo(deps.reviewTodo.id)

    await deps.persist({ status: 'provisioned', todo_id: employeeTodoId, last_provisioning_error: null })
    return { status: 'ready', retryAvailable: false }
  } catch (error) {
    await deps.persist({ status: 'failed', last_provisioning_error: error instanceof BasecampError ? error.code : 'review_outcome_sync_failed' })
    return { status: 'failed', retryAvailable: true }
  }
}
