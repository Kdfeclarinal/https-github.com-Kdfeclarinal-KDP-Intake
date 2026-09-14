import { BasecampError, enabledTodoset } from "../_shared/basecampClient.ts";
import { confirmProvisioningMapping, employeeDeepLink, loadBookProvisioningRecord, provisionBookWithRuntime } from "../_shared/basecampBookRuntime.ts";
import { generateOpaqueToken, sha256Token } from "../_shared/createPrivilegedBook.ts";
import { CORS, json, safeError, serverClient } from "../_shared/edgeSupport.ts";
import { createBasecampRuntime, loadActiveBasecampConnection, privilegedDependencies, serverEnvironment } from "../_shared/basecampRuntime.ts";
import { resolvePrivilegedActor } from "../_shared/privilegedRequest.ts";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (request.method !== "POST") return json({ ok: false, error: "Method not allowed." }, 405);
  try {
    const supabase = serverClient();
    const actor = await resolvePrivilegedActor({
      ...privilegedDependencies(supabase), authorizationHeader: request.headers.get("Authorization"), requiredCapability: "can_create_book",
    });
    const payload = await request.json().catch(() => ({}));
    const bookId = String(payload.bookId || "");
    if (!/^[0-9a-f-]{36}$/i.test(bookId)) throw new BasecampError(400, "A valid book is required.");
    const connection = await loadActiveBasecampConnection(supabase);
    const env = serverEnvironment();
    if (!env.userAgent || !env.employeeIntakeUrl) throw new BasecampError(500, "Basecamp creation configuration is incomplete.");
    const runtime = await createBasecampRuntime(supabase, connection, env);
    const project = await runtime.getJson(`projects/${connection.projectId}.json`);
    if (String(project?.id) !== connection.projectId || enabledTodoset(project) !== connection.todosetId) throw new BasecampError(409, "The configured Pre-Press project is not accessible.");
    const { book, reference } = await loadBookProvisioningRecord(supabase, bookId);
    if (reference.account_id !== connection.accountId || reference.project_id !== connection.projectId || reference.assigned_employee_person_id !== book.employee_basecamp_person_id) {
      throw new BasecampError(409, "Basecamp provisioning does not belong to the configured project and book.");
    }
    const people = await runtime.getCollection(`projects/${connection.projectId}/people.json`);
    if (!people.some((person: Record<string, unknown>) => String(person.id) === String(book.employee_basecamp_person_id))) {
      throw new BasecampError(422, "The assigned employee is no longer a Pre-Press project member.");
    }

    const lists = await runtime.getCollection(`todosets/${connection.todosetId}/todolists.json`);
    const confirmed = await confirmProvisioningMapping(runtime, reference, book.id, lists);
    if (confirmed.listId && confirmed.todoId) {
      await supabase.from("basecamp_references").update({
        todo_list_id: confirmed.listId, todo_id: confirmed.todoId, provisioning_status: "provisioned", last_provisioning_error: null,
      }).eq("id", reference.id).eq("book_id", book.id);
      return json({ ok: true, bookId: book.id, basecamp: { status: "ready" } });
    }

    const rawToken = generateOpaqueToken();
    const { data: rotated, error: rotateError } = await supabase.rpc("rotate_employee_book_token", {
      p_actor_user_id: actor.id, p_book_id: book.id, p_token_hash: await sha256Token(rawToken),
      p_token_prefix: rawToken.slice(0, 12), p_source: "basecamp_provisioning_retry",
    });
    if (rotateError || rotated !== true) throw new BasecampError(500, "A fresh employee link could not be issued.");
    const result = await provisionBookWithRuntime({
      supabase, runtime, connection, book, reference: { ...reference, todo_list_id: confirmed.listId, todo_id: null },
      employeePersonId: book.employee_basecamp_person_id,
      employeeDeepLink: employeeDeepLink(env.employeeIntakeUrl, book.id, rawToken),
    });
    return json({ ok: true, bookId: book.id, basecamp: result });
  } catch (error) { return safeError(error); }
});
