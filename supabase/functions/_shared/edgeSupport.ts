import { createClient } from "npm:@supabase/supabase-js@2";
import { BasecampError } from "./basecampClient.ts";

export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

export const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" },
});

export function serverClient() {
  const url = Deno.env.get("SUPABASE_URL") || "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!url || !key) throw new BasecampError(500, "Server configuration is unavailable.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export function safeError(error: unknown) {
  if (error instanceof BasecampError) return json({ ok: false, error: error.message }, error.status);
  console.error("[basecamp] server operation failed");
  return json({ ok: false, error: "The requested operation is unavailable." }, 500);
}
