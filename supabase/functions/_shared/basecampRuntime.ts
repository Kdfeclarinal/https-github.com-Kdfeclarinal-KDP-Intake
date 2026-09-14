import { BasecampError, basecampRequest, collectBasecampPages, nextLink } from "./basecampClient.ts";

type Row = Record<string, any>;

export function privilegedDependencies(supabase: Row) {
  return {
    authenticate: async (token: string) => {
      const { data, error } = await supabase.auth.getUser(token);
      return error ? null : data.user;
    },
    findPrivilegedUser: async (authUserId: string) => {
      const { data, error } = await supabase.from("privileged_users")
        .select("id,display_name,email_snapshot,disabled_at").eq("auth_user_id", authUserId).maybeSingle();
      if (error) throw error;
      return data;
    },
    listGrants: async (privilegedUserId: string) => {
      const { data, error } = await supabase.from("privileged_user_capability_grants")
        .select("capability_key,revoked_at").eq("privileged_user_id", privilegedUserId);
      if (error) throw error;
      return data || [];
    },
  };
}

export async function loadActiveBasecampConnection(supabase: Row) {
  const { data, error } = await supabase.from("basecamp_connections")
    .select("id,account_id,account_href,project_id,todoset_id,credential_reference,connection_status,token_expires_at,disabled_at")
    .eq("connection_key", "company").eq("connection_status", "connected").is("disabled_at", null).maybeSingle();
  if (error || !data) throw new BasecampError(503, "Basecamp Pre-Press is not configured.");
  return {
    id: data.id, accountId: data.account_id, accountHref: data.account_href,
    projectId: data.project_id, todosetId: data.todoset_id,
    credentialReference: data.credential_reference, tokenExpiresAt: data.token_expires_at,
  };
}

export async function loadBasecampCredential(supabase: Row, credentialReference: string) {
  const { data, error } = await supabase.rpc("read_basecamp_token_bundle", {
    p_credential_reference: credentialReference,
  });
  if (error || !data?.access_token || !data?.refresh_token) {
    throw new BasecampError(503, "Basecamp credential storage is unavailable.", "credential_store_unavailable");
  }
  return data;
}

async function launchpadToken(body: Row, fetchImpl = fetch, userAgent = "") {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetchImpl("https://launchpad.37signals.com/authorization/token", {
      method: "POST", signal: controller.signal,
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json", "User-Agent": userAgent },
      body: new URLSearchParams(body).toString(),
    });
    if (!response.ok) {
      const code = [400, 401].includes(response.status) ? "oauth_refresh_rejected" : "oauth_refresh_failed";
      throw new BasecampError(502, "Basecamp authorization could not be completed.", code);
    }
    return await response.json();
  } catch (error) {
    if (error instanceof BasecampError) throw error;
    throw new BasecampError(502, "Basecamp authorization could not be completed.");
  } finally { clearTimeout(timer); }
}

export async function refreshBasecampCredential(supabase: Row, connection: Row, credential: Row, env: Row) {
  let tokens: Row;
  try {
    tokens = await launchpadToken({
      grant_type: "refresh_token", refresh_token: credential.refresh_token,
      client_id: env.clientId, client_secret: env.clientSecret,
    }, env.fetchImpl, env.userAgent);
  } catch (error) {
    if (error instanceof BasecampError && error.code === "oauth_refresh_rejected") {
      await supabase.from("basecamp_connections").update({ connection_status: "refresh_required" }).eq("id", connection.id);
    }
    throw error;
  }
  if (!tokens?.access_token || !tokens?.refresh_token || !Number(tokens?.expires_in)) {
    throw new BasecampError(502, "Basecamp returned an invalid refresh response.");
  }
  const expiresAt = new Date(Date.now() + Number(tokens.expires_in) * 1000).toISOString();
  const { error } = await supabase.rpc("store_basecamp_token_bundle", {
    p_credential_reference: connection.credentialReference,
    p_access_token: tokens.access_token,
    p_refresh_token: tokens.refresh_token,
    p_expires_at: expiresAt,
  });
  if (error) throw new BasecampError(503, "Basecamp credential storage is unavailable.", "credential_store_unavailable");
  const { error: connectionError } = await supabase.from("basecamp_connections")
    .update({ token_expires_at: expiresAt, connection_status: "connected" }).eq("id", connection.id);
  if (connectionError) throw new BasecampError(503, "Basecamp connection state could not be updated.");
  credential.access_token = tokens.access_token;
  credential.refresh_token = tokens.refresh_token;
  credential.expires_at = expiresAt;
  return tokens.access_token;
}

export async function createBasecampRuntime(supabase: Row, connection: Row, env: Row) {
  const credential = await loadBasecampCredential(supabase, connection.credentialReference);
  const refreshAccessToken = () => refreshBasecampCredential(supabase, connection, credential, env);
  if (credential.expires_at && Date.parse(credential.expires_at) <= Date.now() + 60_000) {
    await refreshAccessToken();
  }
  const request = (path: string, options: Row = {}) => basecampRequest(new URL(path, `${connection.accountHref}/`).toString(), {
    ...options, accessToken: credential.access_token, refreshAccessToken,
    userAgent: env.userAgent, fetchImpl: env.fetchImpl,
  });
  const getCollection = (path: string) => collectBasecampPages(new URL(path, `${connection.accountHref}/`).toString(), async (url) => {
    const response = await basecampRequest(url, {
      method: "GET", accessToken: credential.access_token, refreshAccessToken,
      userAgent: env.userAgent, fetchImpl: env.fetchImpl,
    });
    return { body: await response.json(), next: nextLink(response.headers.get("Link")) };
  });
  return {
    getJson: async (path: string) => (await request(path, { method: "GET" })).json(),
    getCollection,
    postJson: async (path: string, body?: Row) => {
      const response = await request(path, { method: "POST", ...(body === undefined ? {} : { body }) });
      const text = await response.text();
      return text ? JSON.parse(text) : {};
    },
  };
}

export async function listEligibleReviewers(supabase: Row) {
  const { data: grants, error: grantError } = await supabase.from("privileged_user_capability_grants")
    .select("privileged_user_id").eq("capability_key", "can_review").is("revoked_at", null);
  if (grantError) throw grantError;
  const ids = [...new Set((grants || []).map((row: Row) => row.privileged_user_id).filter(Boolean))];
  if (!ids.length) return [];
  const { data, error } = await supabase.from("privileged_users")
    .select("id,display_name").in("id", ids).is("disabled_at", null);
  if (error) throw error;
  return data || [];
}

export async function loadDefaultReviewerId(supabase: Row) {
  const { data, error } = await supabase.from("review_assignment_defaults")
    .select("reviewer_user_id").eq("scope_key", "kindle_ebook").maybeSingle();
  if (error) throw error;
  return data?.reviewer_user_id || null;
}

export function serverEnvironment() {
  return {
    clientId: Deno.env.get("BASECAMP_CLIENT_ID") || "",
    clientSecret: Deno.env.get("BASECAMP_CLIENT_SECRET") || "",
    redirectUri: Deno.env.get("BASECAMP_OAUTH_REDIRECT_URI") || "",
    returnUrl: Deno.env.get("BASECAMP_OAUTH_RETURN_URL") || "",
    accountId: Deno.env.get("BASECAMP_ACCOUNT_ID") || "",
    projectId: Deno.env.get("BASECAMP_PREPRESS_PROJECT_ID") || "",
    employeeIntakeUrl: Deno.env.get("KDP_EMPLOYEE_INTAKE_URL") || "",
    userAgent: Deno.env.get("BASECAMP_USER_AGENT") || "",
  };
}
