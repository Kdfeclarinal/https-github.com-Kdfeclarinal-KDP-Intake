import { BasecampError } from './basecampClient.ts'

type Row = Record<string, any>

export const employeeUpdateMarker = (roundId: string) => `KDP Intake Employee Updates Round: ${roundId}`

export async function syncBasecampReviewOutcome(deps: Row) {
  try {
    if (!deps.reviewTodo?.completed) await deps.completeTodo(deps.reviewTodo.id)
    let employeeTodoId = deps.existingEmployeeTodo?.id || null
    if (deps.outcome === 'request_updates' && !employeeTodoId) {
      if (!deps.employeePersonId || !Number.isFinite(Number(deps.employeePersonId))) {
        throw new BasecampError(409, 'The employee Basecamp assignment is unavailable.', 'employee_mapping_unavailable')
      }
      const created = await deps.createEmployeeTodo({
        content: `Employee Updates — Round ${deps.round.roundNumber}`,
        description: `<div>${employeeUpdateMarker(deps.round.id)}</div>`,
        assignee_ids: [Number(deps.employeePersonId)],
      })
      if (!created?.id) throw new BasecampError(502, 'Basecamp returned an invalid Employee Updates task.')
      employeeTodoId = String(created.id)
    }
    await deps.persist({ status: 'provisioned', todo_id: employeeTodoId, last_provisioning_error: null })
    return { status: 'ready', retryAvailable: false }
  } catch (error) {
    await deps.persist({ status: 'failed', last_provisioning_error: error instanceof BasecampError ? error.code : 'review_outcome_sync_failed' })
    return { status: 'failed', retryAvailable: true }
  }
}
