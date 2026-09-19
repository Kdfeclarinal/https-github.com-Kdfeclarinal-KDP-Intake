import { createClient } from "npm:@supabase/supabase-js@2";
import { isUnexpiredTokenExpiry } from "../_shared/workflowStatus.mjs";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function sessionToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return `kdp_es_${[...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function sessionMinutes() {
  const configured = Number(Deno.env.get("EMPLOYEE_SESSION_TTL_MINUTES") || "480");
  return Number.isInteger(configured) && configured >= 15 && configured <= 720 ? configured : 480;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (request.method !== "POST") return json({ ok: false, error: "Method not allowed." }, 405);

  try {
    const body = await request.json().catch(() => ({}));
    const bookId = String(body.book_id || "").trim();
    const launcher = String(body.access_token || "").trim();
    if (!uuid.test(bookId) || !launcher) return json({ ok: false, error: "Employee access link is invalid." }, 400);

    const url = Deno.env.get("SUPABASE_URL") || "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    if (!url || !serviceRoleKey) return json({ ok: false, error: "Employee access is unavailable." }, 500);

    const supabase = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const launcherHash = await sha256(launcher);
    const { data: token, error: tokenError } = await supabase.from("book_access_tokens")
      .select("*")
      .eq("token_hash", launcherHash)
      .maybeSingle();

    if (tokenError) return json({ ok: false, error: "Employee access could not be validated." }, 500);
    if (!token || token.role !== "employee" || String(token.book_id || "") !== bookId || token.revoked_at) {
      return json({ ok: false, error: "Employee access link is no longer valid." }, 403);
    }
    if (!isUnexpiredTokenExpiry(token.expires_at)) return json({ ok: false, error: "Employee access link has expired." }, 403);
    if (token.metadata?.token_kind !== "book_specific" || token.metadata?.credential_kind === "employee_session") {
      return json({ ok: false, error: "Employee access link is invalid." }, 403);
    }

    const { data: book, error: bookError } = await supabase.from("books")
      .select("id,employee_basecamp_person_id,deleted_at")
      .eq("id", bookId)
      .maybeSingle();
    if (bookError) return json({ ok: false, error: "Employee access could not be validated." }, 500);
    if (!book || book.deleted_at) return json({ ok: false, error: "This book is unavailable." }, 404);
    if (token.basecamp_person_id && book.employee_basecamp_person_id &&
        String(token.basecamp_person_id) !== String(book.employee_basecamp_person_id)) {
      return json({ ok: false, error: "Employee access has changed. Open the latest assigned link." }, 403);
    }

    const rawSession = sessionToken();
    const expiresAt = new Date(Date.now() + sessionMinutes() * 60_000).toISOString();
    const { error: insertError } = await supabase.from("book_access_tokens").insert({
      role: "employee",
      book_id: bookId,
      review_round_id: null,
      token_hash: await sha256(rawSession),
      token_prefix: rawSession.slice(0, 12),
      employee_name: token.employee_name || null,
      employee_email: token.employee_email || null,
      basecamp_person_id: token.basecamp_person_id || null,
      created_by_name: token.created_by_name || null,
      created_by_email: token.created_by_email || null,
      allowed_pages: token.allowed_pages || [],
      allowed_actions: token.allowed_actions || [],
      expires_at: expiresAt,
      metadata: {
        ...(token.metadata || {}),
        token_kind: "book_specific",
        credential_kind: "employee_session",
        launcher_token_id: token.id,
        source: "employee_access_exchange",
      },
    });
    if (insertError) return json({ ok: false, error: "Employee session could not be established." }, 500);

    return json({ ok: true, book_id: bookId, session_token: rawSession, expires_at: expiresAt });
  } catch {
    return json({ ok: false, error: "Employee session could not be established." }, 500);
  }
});
