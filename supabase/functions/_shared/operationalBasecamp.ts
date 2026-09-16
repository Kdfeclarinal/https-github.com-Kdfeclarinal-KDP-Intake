import { BasecampError } from './basecampClient.ts';

type Row = Record<string, any>;

function escapeAttribute(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

export async function syncEmployeeReassignment(deps: Row) {
  try {
    if (!deps.event?.id || !['pending', 'failed'].includes(String(deps.event.status))) throw new BasecampError(409, 'Employee reassignment sync is unavailable.');
    if (typeof deps.claim !== 'function') throw new BasecampError(409, 'Employee reassignment sync claim is unavailable.');
    await deps.claim();
    if (!deps.reference?.todo_id || String(deps.reference.project_id) !== String(deps.projectId)) throw new BasecampError(409, 'The active Basecamp employee task is unavailable.');
    const todo = await deps.loadTodo(String(deps.reference.todo_id));
    if (!todo?.id || String(todo.id) !== String(deps.reference.todo_id)) throw new BasecampError(409, 'The active Basecamp employee task is unavailable.');
    const prior = String(todo.description || '')
      .replace(/<div>Complete the Kindle eBook intake:[\s\S]*?<\/div>/gi, '')
      .replace(/<div>Open the (?:reassigned|current) KDP Intake:[\s\S]*?<\/div>/gi, '');
    await deps.updateTodo(String(todo.id), {
      content: String(todo.content || 'Employee Intake'),
      description: `${prior}<div>Open the current KDP Intake: <a href="${escapeAttribute(deps.employeeDeepLink)}">Open KDP Intake</a></div>`,
      assignee_ids: [Number(deps.employeePersonId)],
    });
    await deps.settle('success');
    return { status: 'ready', retryAvailable: false };
  } catch {
    try {
      await deps.settle('failed');
    } catch {
      throw new BasecampError(502, 'The Basecamp reassignment could not be durably settled.', 'integration_settlement_failed');
    }
    return { status: 'failed', retryAvailable: true };
  }
}
