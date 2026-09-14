import { BasecampError } from "../_shared/basecampClient.ts";
import { CORS, json, safeError, serverClient } from "../_shared/edgeSupport.ts";
import { loadActiveBasecampConnection, privilegedDependencies } from "../_shared/basecampRuntime.ts";
import { resolvePrivilegedActor } from "../_shared/privilegedRequest.ts";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (request.method !== "POST") return json({ ok: false, error: "Method not allowed." }, 405);
  try {
    const supabase = serverClient();
    const actor = await resolvePrivilegedActor({
      ...privilegedDependencies(supabase), authorizationHeader: request.headers.get("Authorization"),
      requiredCapability: "can_manage_integrations",
    });
    const connection = await loadActiveBasecampConnection(supabase);
    const { error: vaultError } = await supabase.rpc("delete_basecamp_token_bundle", {
      p_credential_reference: connection.credentialReference,
    });
    if (vaultError) throw new BasecampError(503, "Basecamp credential storage is unavailable.");
    const { error } = await supabase.from("basecamp_connections").update({
      connection_status: "disabled", disabled_at: new Date().toISOString(),
    }).eq("id", connection.id);
    if (error) throw error;
    await supabase.from("integration_events").insert({
      provider: "basecamp", event_type: "connection_disabled", status: "processed",
      payload_json: {}, metadata: { actor_privileged_user_id: actor.id },
    });
    return json({ ok: true, disconnected: true });
  } catch (error) { return safeError(error); }
});
