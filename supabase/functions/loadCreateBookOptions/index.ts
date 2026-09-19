import { BasecampError, enabledTodoset } from "../_shared/basecampClient.ts";
import { loadCreateBookOptions } from "../_shared/basecampProvisioning.ts";
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
    await resolvePrivilegedActor({ ...privilegedDependencies(supabase), authorizationHeader: request.headers.get("Authorization"), requiredCapability: "can_create_book" });
    const connection = await loadActiveBasecampConnection(supabase);
    const env = serverEnvironment();
    if (!env.userAgent) throw new BasecampError(500, "Basecamp User-Agent is not configured.");
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
    return json({ ok: true, ...options });
  } catch (error) { return safeError(error); }
});
