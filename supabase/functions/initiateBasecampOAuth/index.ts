import { initiateBasecampOAuth } from "../_shared/basecampOAuth.ts";
import { BasecampError } from "../_shared/basecampClient.ts";
import { CORS, json, safeError, serverClient } from "../_shared/edgeSupport.ts";
import { privilegedDependencies, serverEnvironment } from "../_shared/basecampRuntime.ts";
import { resolvePrivilegedActor } from "../_shared/privilegedRequest.ts";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (request.method !== "POST") return json({ ok: false, error: "Method not allowed." }, 405);
  try {
    const supabase = serverClient();
    const env = serverEnvironment();
    if (!env.clientId || !env.redirectUri || !env.accountId || !env.projectId) {
      throw new BasecampError(500, "Basecamp OAuth configuration is incomplete.");
    }
    const actor = await resolvePrivilegedActor({
      ...privilegedDependencies(supabase), authorizationHeader: request.headers.get("Authorization"),
      requiredCapability: "can_manage_integrations",
    });
    const result = await initiateBasecampOAuth({
      clientId: env.clientId, redirectUri: env.redirectUri, initiatorId: actor.id,
      accountId: env.accountId, projectId: env.projectId,
      storeState: async (row: Record<string, unknown>) => {
        const { error } = await supabase.from("basecamp_oauth_states").insert({
          state_hash: row.stateHash, initiated_by_user_id: row.initiatorId,
          account_id: row.accountId, project_id: row.projectId, expires_at: row.expiresAt,
        });
        if (error) throw error;
      },
    });
    await supabase.from("integration_events").insert({
      provider: "basecamp", event_type: "oauth_initiated", status: "pending",
      payload_json: {}, metadata: { actor_privileged_user_id: actor.id },
    });
    return json({ ok: true, authorizationUrl: result.authorizationUrl });
  } catch (error) { return safeError(error); }
});
