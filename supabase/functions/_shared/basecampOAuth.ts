import { BasecampError, enabledTodoset } from "./basecampClient.ts";

type Row = Record<string, any>;

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function randomState(bytes: Uint8Array) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function initiateBasecampOAuth(deps: Row) {
  if (!deps.clientId || !deps.redirectUri || !deps.initiatorId || !deps.accountId || !deps.projectId) {
    throw new BasecampError(500, "Basecamp OAuth configuration is incomplete.");
  }
  const bytes = deps.randomBytes ? deps.randomBytes() : crypto.getRandomValues(new Uint8Array(32));
  const state = randomState(bytes);
  const now = deps.now || new Date();
  await deps.storeState({
    stateHash: await sha256Hex(state),
    initiatorId: deps.initiatorId,
    accountId: String(deps.accountId),
    projectId: String(deps.projectId),
    expiresAt: new Date(now.getTime() + 10 * 60_000).toISOString(),
  });
  const url = new URL("https://launchpad.37signals.com/authorization/new");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", deps.clientId);
  url.searchParams.set("redirect_uri", deps.redirectUri);
  url.searchParams.set("state", state);
  return { authorizationUrl: url.toString() };
}

export async function completeBasecampOAuth(deps: Row) {
  if (!deps.code || !deps.state) throw new BasecampError(400, "OAuth callback is incomplete.");
  const consumed = await deps.consumeState(await sha256Hex(deps.state));
  if (!consumed?.ok) throw new BasecampError(400, "OAuth state is invalid or expired.", "invalid_state");

  let tokens: Row;
  try {
    tokens = await deps.exchangeCode({
      grant_type: "authorization_code", code: deps.code, client_id: deps.clientId,
      client_secret: deps.clientSecret, redirect_uri: deps.redirectUri,
    });
  } catch {
    throw new BasecampError(502, "Basecamp authorization could not be completed.", "exchange_failed");
  }
  if (!tokens?.access_token || !tokens?.refresh_token || !Number(tokens?.expires_in)) {
    throw new BasecampError(502, "Basecamp returned an invalid authorization response.");
  }
  const authorization = await deps.discoverAuthorization(tokens.access_token);
  const account = (authorization?.accounts || []).find((item: Row) =>
    String(item?.id) === String(consumed.accountId) && item?.product === "bc3"
  );
  if (!account?.href) throw new BasecampError(409, "The configured Basecamp account is not accessible.");
  const project = await deps.loadProject(account.href, consumed.projectId, tokens.access_token);
  if (String(project?.id) !== String(consumed.projectId)) {
    throw new BasecampError(409, "The configured Pre-Press project is not accessible.");
  }
  const todosetId = enabledTodoset(project);

  const expiresAt = new Date(Date.now() + Number(tokens.expires_in) * 1000).toISOString();
  let credentialReference: string;
  try {
    credentialReference = await deps.storeTokens({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: expiresAt,
    });
  } catch {
    throw new BasecampError(503, "Basecamp credential storage is unavailable.", "credential_store_unavailable");
  }
  await deps.saveConnection({
    initiatorId: consumed.initiatorId,
    accountId: String(account.id),
    accountHref: String(account.href),
    projectId: String(project.id),
    todosetId,
    credentialReference,
    expiresAt,
  });
  return { connected: true, accountId: String(account.id), projectId: String(project.id) };
}
