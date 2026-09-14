import { BasecampError } from './basecampClient.ts'
import { employeeUpdateMarker, syncBasecampReviewOutcome } from './basecampOutcomeLifecycle.ts'
import { createBasecampRuntime, loadActiveBasecampConnection, serverEnvironment } from './basecampRuntime.ts'

type Row = Record<string, any>

export async function syncReviewOutcomeWithRuntime(supabase: Row, roundId: string, outcome: string) {
  const { data: round } = await supabase.from('book_review_rounds').select('id,book_id,round_number,outcome,finalized_at').eq('id', roundId).maybeSingle()
  if (!round?.finalized_at) throw new BasecampError(409, 'Review outcome is unavailable.')
  const { data: book } = await supabase.from('books').select('id,employee_basecamp_person_id').eq('id', round.book_id).maybeSingle()
  const { data: refs } = await supabase.from('basecamp_references').select('*').eq('book_id', round.book_id).in('reference_kind', ['review_round', 'employee_update'])
  const reviewRef = (refs || []).find((row: Row) => row.reference_kind === 'review_round' && row.review_round_id === round.id)
  const updateRef = (refs || []).find((row: Row) => row.reference_kind === 'employee_update' && row.review_round_id === round.id)
  if (!reviewRef?.todo_id) throw new BasecampError(409, 'Basecamp review task is unavailable.')
  const connection = await loadActiveBasecampConnection(supabase)
  const env = serverEnvironment()
  if (!env.userAgent) throw new BasecampError(500, 'Basecamp User-Agent is not configured.')
  const runtime = await createBasecampRuntime(supabase, connection, env)
  const reviewTodo = await runtime.getJson(`todos/${reviewRef.todo_id}.json`)
  const existing = outcome === 'request_updates' ? (await runtime.getCollection(`todolists/${reviewRef.todo_list_id}/todos.json`)).find((row: Row) => String(row.description || '').includes(employeeUpdateMarker(round.id))) : null
  return syncBasecampReviewOutcome({
    outcome, round: { id: round.id, roundNumber: round.round_number }, reviewTodo,
    existingEmployeeTodo: existing, employeePersonId: book?.employee_basecamp_person_id,
    completeTodo: (id: string) => runtime.postJson(`todos/${id}/completion.json`),
    createEmployeeTodo: (payload: Row) => runtime.postJson(`todolists/${reviewRef.todo_list_id}/todos.json`, payload),
    persist: async (patch: Row) => {
      const target = outcome === 'request_updates' ? updateRef : reviewRef
      if (target?.id) await supabase.from('basecamp_references').update({ provisioning_status: patch.status, todo_id: patch.todo_id || target.todo_id, last_provisioning_error: patch.last_provisioning_error }).eq('id', target.id)
    },
  })
}
