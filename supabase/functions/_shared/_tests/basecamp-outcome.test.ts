import { assertEquals } from 'jsr:@std/assert'
import { syncBasecampReviewOutcome } from '../basecampOutcomeLifecycle.ts'

Deno.test('request updates completes review and creates one employee task', async () => {
  const calls: string[] = []
  const result = await syncBasecampReviewOutcome({
    outcome: 'request_updates', round: { id: 'r1', roundNumber: 1 }, employeePersonId: '42', reviewTodo: { id: 'review', completed: false }, existingEmployeeTodo: null,
    completeTodo: async () => { calls.push('complete') },
    createEmployeeTodo: async () => { calls.push('create'); return { id: 'employee' } },
    persist: async () => { calls.push('persist') },
  })
  assertEquals(result.status, 'ready')
  assertEquals(calls, ['complete', 'create', 'persist'])
})

Deno.test('approve book completes review without employee task', async () => {
  const calls: string[] = []
  await syncBasecampReviewOutcome({ outcome: 'approve_book', round: { id: 'r1', roundNumber: 1 }, reviewTodo: { id: 'review', completed: false }, completeTodo: async () => calls.push('complete'), persist: async () => calls.push('persist') })
  assertEquals(calls, ['complete', 'persist'])
})
