import { BasecampError } from "./basecampClient.ts";

type Row = Record<string, any>;

function bearer(header: unknown) {
  return /^Bearer ([^\s]+)$/i.exec(String(header || "").trim())?.[1] || null;
}

export async function resolvePrivilegedActor(deps: Row) {
  const token = bearer(deps.authorizationHeader);
  if (!token) throw new BasecampError(401, "Authentication required.");
  const authUser = await deps.authenticate(token);
  if (!authUser?.id) throw new BasecampError(401, "Authentication required.");
  const providers = authUser.app_metadata?.providers || [authUser.app_metadata?.provider];
  if (!providers.includes("google")) throw new BasecampError(403, "Google authentication is required.");
  const user = await deps.findPrivilegedUser(authUser.id);
  if (!user || user.disabled_at) throw new BasecampError(403, "Privileged access is not authorized.");
  const capabilities = [...new Set((await deps.listGrants(user.id) || [])
    .filter((grant: Row) => !grant.revoked_at)
    .map((grant: Row) => grant.capability_key))].sort();
  const required = Array.isArray(deps.requiredCapabilities)
    ? deps.requiredCapabilities
    : [deps.requiredCapability].filter(Boolean);
  if (required.length && !required.some((capability: string) => capabilities.includes(capability))) {
    throw new BasecampError(403, "The required capability is not authorized.");
  }
  return { ...user, capabilities };
}
