import { BasecampError } from "../_shared/basecampClient.ts";
import { createBasecampRuntime, listEligibleReviewers, loadActiveBasecampConnection, privilegedDependencies, serverEnvironment } from "../_shared/basecampRuntime.ts";
import { CORS, json, safeError, serverClient } from "../_shared/edgeSupport.ts";
import { resolvePrivilegedActor } from "../_shared/privilegedRequest.ts";
import { validateReviewerMapping } from "../_shared/reviewerMapping.ts";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (request.method !== "POST") return json({ ok: false, error: "Method not allowed." }, 405);
  try {
    const supabase = serverClient();
    const actor = await resolvePrivilegedActor({ ...privilegedDependencies(supabase), authorizationHeader: request.headers.get("Authorization"), requiredCapability: "can_manage_users" });
    const body = await request.json().catch(() => ({}));
    const connection = await loadActiveBasecampConnection(supabase);
    const env = serverEnvironment();
    if (!env.userAgent) throw new BasecampError(500, "Basecamp User-Agent is not configured.");
    const runtime = await createBasecampRuntime(supabase, connection, env);
    const people = await runtime.getCollection(`projects/${connection.projectId}/people.json`);
    const reviewers = await listEligibleReviewers(supabase);
    const mapping = validateReviewerMapping({ actor, reviewerId: body.reviewerId, personId: body.personId, reviewers, projectPeople: people });
    const person = people.find((row: Record<string, unknown>) => String(row.id) === mapping.personId);
    const { error } = await supabase.from("privileged_user_basecamp_mappings").upsert({
      privileged_user_id: mapping.reviewerId, connection_id: connection.id, account_id: connection.accountId,
      project_id: connection.projectId, basecamp_person_id: mapping.personId, display_name_snapshot: mapping.displayName,
      email_snapshot: person?.email_address || null, mapped_by_privileged_user_id: actor.id, updated_at: new Date().toISOString(),
    }, { onConflict: "privileged_user_id" });
    if (error) throw new BasecampError(500, "Reviewer mapping could not be saved.");
    await supabase.from("integration_events").insert({ provider: "basecamp", event_type: "reviewer_mapping_changed", status: "processed", payload_json: { reviewer_user_id: mapping.reviewerId, basecamp_person_id: mapping.personId }, metadata: { actor_privileged_user_id: actor.id } });
    return json({ ok: true, reviewerId: mapping.reviewerId, basecampPerson: { id: mapping.personId, displayName: mapping.displayName } });
  } catch (error) { return safeError(error); }
});
