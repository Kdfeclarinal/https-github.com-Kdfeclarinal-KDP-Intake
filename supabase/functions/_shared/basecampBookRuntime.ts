import { BasecampError } from "./basecampClient.ts";
import { bookMarker, provisionEmployeeIntake } from "./basecampProvisioning.ts";

type Row = Record<string, any>;

function containsMarker(row: Row, marker: string) {
  return String(row?.description || "").includes(marker);
}

async function loadMappedResource(runtime: Row, path: string) {
  try {
    return await runtime.getJson(path);
  } catch (error) {
    if (error instanceof BasecampError && error.code === "http_404") return null;
    throw error;
  }
}

export async function confirmProvisioningMapping(runtime: Row, reference: Row, bookId: string, listRows: Row[]) {
  const marker = bookMarker(bookId);
  let list: Row | null = null;
  if (reference?.todo_list_id) {
    const mapped = await loadMappedResource(runtime, `todolists/${reference.todo_list_id}.json`);
    if (mapped && String(mapped.id) === String(reference.todo_list_id) && containsMarker(mapped, marker)) list = mapped;
  }
  if (!list) list = listRows.find((row: Row) => row?.id && containsMarker(row, marker)) || null;
  if (!list?.id) return { listId: null, todoId: null };

  let todo: Row | null = null;
  if (reference?.todo_id) {
    const mapped = await loadMappedResource(runtime, `todos/${reference.todo_id}.json`);
    if (mapped && String(mapped.id) === String(reference.todo_id) && mapped.content === "Employee Intake" &&
      containsMarker(mapped, marker) && String(mapped.parent?.id) === String(list.id)) todo = mapped;
  }
  if (!todo) {
    const rows = await runtime.getCollection(`todolists/${list.id}/todos.json`);
    todo = rows.find((row: Row) => row?.id && row?.content === "Employee Intake" && containsMarker(row, marker) &&
      (!row.parent?.id || String(row.parent.id) === String(list.id))) || null;
  }
  return { listId: String(list.id), todoId: todo?.id ? String(todo.id) : null };
}

export function employeeDeepLink(base: string, bookId: string, rawToken: string) {
  let url: URL;
  try { url = new URL(base); } catch { throw new BasecampError(500, "Employee Intake URL is not configured."); }
  if (url.protocol !== "https:") throw new BasecampError(500, "Employee Intake URL is not configured.");
  url.searchParams.set("book_id", bookId);
  url.searchParams.set("access_token", rawToken);
  url.searchParams.set("step", "details");
  return url.toString();
}

export async function loadBookProvisioningRecord(supabase: Row, bookId: string) {
  const { data: book, error: bookError } = await supabase.from("books")
    .select("id,book_title,overall_status,employee_name,employee_basecamp_person_id,deleted_at")
    .eq("id", bookId).is("deleted_at", null).maybeSingle();
  if (bookError || !book) throw new BasecampError(404, "Book was not found.");
  const { data: reference, error: referenceError } = await supabase.from("basecamp_references")
    .select("id,book_id,account_id,project_id,assigned_employee_person_id,reference_kind,todo_list_id,todo_id,provisioning_status,provisioning_attempts")
    .eq("book_id", bookId).eq("reference_kind", "book_todo_list").maybeSingle();
  if (referenceError || !reference) throw new BasecampError(409, "Basecamp provisioning state is unavailable.");
  return { book, reference };
}

export async function provisionBookWithRuntime(deps: Row) {
  const marker = bookMarker(deps.book.id);
  const listRows = async () => deps.runtime.getCollection(`todosets/${deps.connection.todosetId}/todolists.json`);
  const todoRows = async (listId: string) => deps.runtime.getCollection(`todolists/${listId}/todos.json`);
  const { data: auditRow } = await deps.supabase.from("integration_events").insert({
    provider: "basecamp", event_type: "book_provisioning_attempt", book_id: deps.book.id,
    status: "pending", payload_json: { reference_id: deps.reference.id }, metadata: {},
  }).select("id").maybeSingle();
  const result = await provisionEmployeeIntake({
    connection: deps.connection,
    book: { id: deps.book.id, title: deps.book.book_title || deps.book.title || "Untitled" },
    employeePersonId: deps.employeePersonId,
    employeeDeepLink: deps.employeeDeepLink,
    reference: deps.reference,
    mappingConfirmed: deps.mappingConfirmed === true,
    reconcileList: async () => (await listRows()).find((row: Row) => containsMarker(row, marker)) || null,
    reconcileTodo: async (listId: string) => (await todoRows(listId)).find((row: Row) => row?.content === "Employee Intake" && containsMarker(row, marker)) || null,
    createTodoList: (payload: Row) => deps.runtime.postJson(`todosets/${deps.connection.todosetId}/todolists.json`, payload),
    createTodo: (listId: string, payload: Row) => deps.runtime.postJson(`todolists/${listId}/todos.json`, payload),
    updateReference: async (patch: Row) => {
      const { error } = await deps.supabase.from("basecamp_references").update(patch)
        .eq("id", deps.reference.id).eq("book_id", deps.book.id).eq("project_id", deps.connection.projectId);
      if (error) throw error;
    },
  });
  if (auditRow?.id) {
    await deps.supabase.from("integration_events").update({
      status: result.status === "ready" ? "success" : "failed",
      processed_at: new Date().toISOString(),
      error_message: result.status === "ready" ? null : "basecamp_provisioning_failed",
    }).eq("id", auditRow.id);
  }
  return result;
}
