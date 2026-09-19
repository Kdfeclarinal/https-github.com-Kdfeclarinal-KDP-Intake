import { BasecampError } from "./basecampClient.ts";

type Row = Record<string, any>;

export const bookMarker = (bookId: string) => `KDP Intake Book: ${bookId}`;

function escapeHtml(value: unknown) {
  return String(value || "").replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function calendarDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

export function normalizeEmployeeIntakeTurnaround(settings: Row = {}) {
  const configured = settings?.employee_intake_turnaround || {};
  const value = Number(configured.value);
  return {
    value: Number.isInteger(value) && value > 0 && value <= 365 ? value : 7,
    unit: "calendar_days",
  };
}

export function defaultEmployeeIntakeDueDate(policy: Row, now = Date.now()) {
  const date = new Date(now);
  const utc = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  utc.setUTCDate(utc.getUTCDate() + Number(policy.value || 7));
  return calendarDate(utc);
}

export async function loadCreateBookOptions(deps: Row) {
  if (!deps.connection?.projectId) throw new BasecampError(503, "Basecamp Pre-Press is not configured.");
  const [people, reviewers, defaultReviewerId, workflowDefaults] = await Promise.all([
    deps.listProjectPeople(deps.connection),
    deps.listEligibleReviewers(),
    deps.loadDefaultReviewerId(),
    deps.loadWorkflowDefaults ? deps.loadWorkflowDefaults() : {},
  ]);
  const defaultTurnaround = normalizeEmployeeIntakeTurnaround(workflowDefaults || {});
  return {
    employees: (people || []).filter((person: Row) => person?.id && person?.name).map((person: Row) => ({
      id: String(person.id), displayName: String(person.name), avatarUrl: person.avatar_url || null,
    })),
    reviewers: (reviewers || []).filter((user: Row) => user?.id).map((user: Row) => ({
      id: String(user.id), displayName: String(user.display_name || "Reviewer"),
    })),
    defaultReviewerId: defaultReviewerId || null,
    defaultTurnaround,
    defaultDueDate: defaultEmployeeIntakeDueDate(defaultTurnaround, deps.now ?? Date.now()),
  };
}

export async function provisionEmployeeIntake(deps: Row) {
  const reference = deps.reference;
  if (deps.mappingConfirmed === true && reference?.provisioning_status === "provisioned" && reference?.todo_list_id && reference?.todo_id) {
    return { status: "ready" };
  }
  const marker = bookMarker(deps.book.id);
  let listId = reference?.todo_list_id ? String(reference.todo_list_id) : null;
  let todoId = reference?.todo_id ? String(reference.todo_id) : null;

  try {
    await deps.updateReference({
      provisioning_status: "pending",
      provisioning_attempts: Number(reference?.provisioning_attempts || 0) + 1,
      last_provisioning_attempt_at: new Date().toISOString(),
      last_provisioning_error: null,
    });
    if (!listId) {
      const existing = await deps.reconcileList(marker);
      if (existing?.id) listId = String(existing.id);
      else {
        const author = String(deps.book.author || deps.book.title || "Untitled").trim() || "Untitled";
        const created = await deps.createTodoList({
          name: `${author} — KDP Pre-Press`,
          description: `<div><strong>Book Author:</strong> ${escapeHtml(author)}</div><div><small>Internal reference: ${escapeHtml(marker)}</small></div>`,
        });
        if (!created?.id) throw new BasecampError(502, "Basecamp returned an invalid To-do List.");
        listId = String(created.id);
      }
      await deps.updateReference({ todo_list_id: listId });
    }
    if (!todoId) {
      const existing = await deps.reconcileTodo(listId, marker);
      if (existing?.id) todoId = String(existing.id);
      else {
        const author = String(deps.book.author || deps.book.title || "Untitled").trim() || "Untitled";
        const dueDate = deps.dueDate ? String(deps.dueDate) : "";
        const payload: Row = {
          content: "KDP Pre-Press — Stage 1",
          description:
            `<div><strong>Book Author:</strong> ${escapeHtml(author)}</div>` +
            (dueDate ? `<div><strong>Due:</strong> ${escapeHtml(dueDate)}</div>` : "") +
            `<div><a href="${escapeHtml(deps.employeeDeepLink)}">Open KDP Intake</a></div>` +
            `<div><small>Internal reference: ${escapeHtml(marker)}</small></div>`,
          assignee_ids: [Number(deps.employeePersonId)],
        };
        // The canonical due date is stored on the book. Do not guess a provider
        // field for Basecamp here: the exact create-todo due-date property must
        // be verified against current Basecamp API documentation before sending it.
        const created = await deps.createTodo(listId, payload);
        if (!created?.id) throw new BasecampError(502, "Basecamp returned an invalid KDP Pre-Press task.");
        todoId = String(created.id);
      }
      await deps.updateReference({ todo_id: todoId });
    }
    await deps.updateReference({ provisioning_status: "provisioned", todo_list_id: listId, todo_id: todoId, last_provisioning_error: null });
    return { status: "ready" };
  } catch (error) {
    const safeCode = error instanceof BasecampError ? error.code : "provisioning_failed";
    await deps.updateReference({ provisioning_status: "failed", last_provisioning_error: safeCode });
    return { status: "failed", retryAvailable: true };
  }
}
