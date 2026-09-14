import { completeBasecampOAuth } from "../_shared/basecampOAuth.ts";
import { BasecampError, basecampRequest } from "../_shared/basecampClient.ts";
import { safeError, serverClient } from "../_shared/edgeSupport.ts";
import { serverEnvironment } from "../_shared/basecampRuntime.ts";

async function tokenExchange(parameters: Record<string, string>, userAgent: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch("https://launchpad.37signals.com/authorization/token", {
      method: "POST", signal: controller.signal,
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json", "User-Agent": userAgent },
      body: new URLSearchParams(parameters).toString(),
    });
    if (!response.ok) throw new Error("exchange failed");
    return response.json();
  } finally { clearTimeout(timer); }
}

Deno.serve(async (request) => {
  if (request.method !== "GET") return new Response("Method not allowed.", { status: 405 });
  try {
    const supabase = serverClient();
    const env = serverEnvironment();
    if (!env.clientId || !env.clientSecret || !env.redirectUri || !env.userAgent) {
      throw new BasecampError(500, "Basecamp OAuth configuration is incomplete.");
    }
    const url = new URL(request.url);
    const result = await completeBasecampOAuth({
      code: url.searchParams.get("code"), state: url.searchParams.get("state"),
      clientId: env.clientId, clientSecret: env.clientSecret, redirectUri: env.redirectUri,
      consumeState: async (stateHash: string) => {
        const { data, error } = await supabase.rpc("consume_basecamp_oauth_state", { p_state_hash: stateHash });
        if (error) throw error;
        return data;
      },
      exchangeCode: (parameters: Record<string, string>) => tokenExchange(parameters, env.userAgent),
      discoverAuthorization: async (accessToken: string) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 10_000);
        try {
          const response = await fetch("https://launchpad.37signals.com/authorization.json", {
            signal: controller.signal,
            headers: { Authorization: `Bearer ${accessToken}`, "User-Agent": env.userAgent, Accept: "application/json" },
          });
          if (!response.ok) throw new BasecampError(502, "Basecamp account discovery failed.");
          return response.json();
        } finally { clearTimeout(timer); }
      },
      loadProject: async (accountHref: string, projectId: string, accessToken: string) => {
        const response = await basecampRequest(new URL(`projects/${projectId}.json`, `${accountHref}/`).toString(), {
          method: "GET", accessToken, userAgent: env.userAgent,
        });
        return response.json();
      },
      storeTokens: async (tokens: Record<string, string>) => {
        const { data: current } = await supabase.from("basecamp_connections")
          .select("credential_reference").eq("connection_key", "company").maybeSingle();
        const { data, error } = await supabase.rpc("store_basecamp_token_bundle", {
          p_access_token: tokens.access_token, p_refresh_token: tokens.refresh_token, p_expires_at: tokens.expires_at,
          p_credential_reference: current?.credential_reference || null,
        });
        if (error || !data) throw new Error("credential vault unavailable");
        return String(data);
      },
      saveConnection: async (row: Record<string, string>) => {
        const { error } = await supabase.from("basecamp_connections").upsert({
          connection_key: "company", account_id: row.accountId, account_href: row.accountHref,
          project_id: row.projectId, todoset_id: row.todosetId,
          credential_reference: row.credentialReference, connected_by_user_id: row.initiatorId,
          token_expires_at: row.expiresAt, connection_status: "connected", disabled_at: null,
        }, { onConflict: "connection_key" });
        if (error) throw error;
        await supabase.from("integration_events").insert({
          provider: "basecamp", event_type: "oauth_connected", status: "success",
          payload_json: {}, metadata: { actor_privileged_user_id: row.initiatorId }, processed_at: new Date().toISOString(),
        });
      },
    });
    if (env.returnUrl) return Response.redirect(env.returnUrl, 303);
    return new Response(JSON.stringify({ ok: true, ...result }), { status: 200, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  } catch (error) { return safeError(error); }
});
