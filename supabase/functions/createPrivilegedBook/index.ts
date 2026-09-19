import { BasecampError, enabledTodoset } from "../_shared/basecampClient.ts";
import { employeeDeepLink, loadBookProvisioningRecord, provisionBookWithRuntime } from "../_shared/basecampBookRuntime.ts";
import { loadCreateBookOptions } from "../_shared/basecampProvisioning.ts";
import { createPrivilegedBook } from "../_shared/createPrivilegedBook.ts";
import { CORS, json, safeError, serverClient } from "../_shared/edgeSupport.ts";
import {
  createBasecampRuntime, listEligibleReviewers, loadActiveBasecampConnection,
  loadDefaultReviewerId, privilegedDependencies, serverEnvironment,
} from "../_shared/basecampRuntime.ts";
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
    const connection = await loadActiveBasecampConnection(supabase);
    const env = serverEnvironment();
    if (!env.userAgent || !env.employeeIntakeUrl) throw new BasecampError(500, "Basecamp creation configuration is incomplete.");
    const runtime = await createBasecampRuntime(supabase, connection, env);
    const project = await runtime.getJson(`projects/${connection.projectId}.json`);
    if (String(project?.id) !== connection.projectId || enabledTodoset(project) !== connection.todosetId) {
      throw new BasecampError(409, "The configured Pre-Press project is not accessible.");
    }
    const options = await loadCreateBookOptions({
      connection,
      listProjectPeople: () => runtime.getCollection(`projects/${connection.projectId}/people.json`),
      listEligibleReviewers: () => listEligibleReviewers(supabase),
      loadDefaultReviewerId: () => loadDefaultReviewerId(supabase),
      loadWorkflowDefaults: async () => {
        const { data, error } = await supabase.from("workflow_settings")
          .select("setting_value")
          .eq("setting_key", "kdp_workflow_defaults")
          .eq("is_active", true)
          .maybeSingle();
        if (error) throw error;
        return data?.setting_value || {};
      },
    });
    const reviewerUserId = payload.reviewerUserId || options.defaultReviewerId;
    const requestedDueDate = String(payload.dueDate || "").trim();
    const resolvedDueDate = requestedDueDate || String(options.defaultDueDate || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(resolvedDueDate)) throw new BasecampError(422, "Select a valid due date.");
    const today = new Date().toISOString().slice(0, 10);
    if (resolvedDueDate < today) throw new BasecampError(422, "Due date cannot be in the past.");
    const dueDateSource = requestedDueDate && requestedDueDate !== options.defaultDueDate ? "override" : "default";

    const result = await createPrivilegedBook({
      actor, employeePersonId: payload.employeePersonId, reviewerUserId,
      bookAuthor: payload.bookAuthor, dueDate: resolvedDueDate, dueDateSource,
      employees: options.employees, reviewers: options.reviewers,
      createCanonicalBook: async (input: Record<string, unknown>) => {
        const { data, error } = await supabase.rpc("create_privileged_kdp_book", {
          p_actor_user_id: actor.id, p_connection_id: connection.id,
          p_employee_basecamp_person_id: input.employeePersonId, p_employee_name: input.employeeName,
          p_reviewer_user_id: input.reviewerUserId, p_token_hash: input.tokenHash,
          p_token_prefix: input.tokenPrefix, p_book_author_name: input.bookAuthor,
          p_employee_intake_due_date: input.dueDate, p_employee_intake_due_date_source: input.dueDateSource,
          p_source: input.source,
        });
        if (error || !data?.book?.id || !data?.referenceId) throw new BasecampError(500, "The canonical book could not be created.");
        return data;
      },
      provision: async ({ book, referenceId, employeePersonId, rawEmployeeToken }: Record<string, string>) => {
        const record = await loadBookProvisioningRecord(supabase, book.id);
        if (record.reference.id !== referenceId) throw new BasecampError(409, "Basecamp provisioning state did not match the book.");
        return provisionBookWithRuntime({
          supabase, runtime, connection, book: record.book, reference: record.reference,
          employeePersonId, employeeDeepLink: employeeDeepLink(env.employeeIntakeUrl, book.id, rawEmployeeToken),
        });
      },
    });
    return json({ ok: true, book: result.book, basecamp: result.basecamp }, 201);
  } catch (error) { return safeError(error); }
});
