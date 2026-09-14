import { BasecampError } from "./basecampClient.ts";

type Row = Record<string, any>;

export const bookMarker = (bookId: string) => `KDP Intake Book: ${bookId}`;

function escapeAttribute(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export async function loadCreateBookOptions(deps: Row) {
  if (!deps.connection?.projectId) throw new BasecampError(503, "Basecamp Pre-Press is not configured.");
  const [people, reviewers, defaultReviewerId] = await Promise.all([
    deps.listProjectPeople(deps.connection), deps.listEligibleReviewers(), deps.loadDefaultReviewerId(),
  ]);
  return {
    employees: (people || []).filter((person: Row) => person?.id && person?.name).map((person: Row) => ({
      id: String(person.id), displayName: String(person.name), avatarUrl: person.avatar_url || null,
    })),
    reviewers: (reviewers || []).filter((user: Row) => user?.id).map((user: Row) => ({
      id: String(user.id), displayName: String(user.display_name || "Reviewer"),
    })),
    defaultReviewerId: defaultReviewerId || null,
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
        const created = await deps.createTodoList({
          name: deps.book.title && deps.book.title !== "Untitled" ? `KDP: ${deps.book.title}` : "KDP: New Kindle eBook",
          description: `<div>${marker}</div>`,
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
        const created = await deps.createTodo(listId, {
          content: "Employee Intake",
          description: `<div>Complete the Kindle eBook intake: <a href="${escapeAttribute(deps.employeeDeepLink)}">Open KDP Intake</a></div><div>${marker}</div>`,
          assignee_ids: [Number(deps.employeePersonId)],
        });
        if (!created?.id) throw new BasecampError(502, "Basecamp returned an invalid Employee Intake task.");
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
