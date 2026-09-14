import { BasecampError } from "../_shared/basecampClient.ts";
import { syncReviewRoundWithRuntime } from "../_shared/basecampReviewRuntime.ts";
import { authorizeEmployeeSubmission, submitEmployeeBook } from "../_shared/employeeSubmission.ts";
import { CORS, json, safeError, serverClient } from "../_shared/edgeSupport.ts";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (request.method !== "POST") return json({ ok: false, error: "Method not allowed." }, 405);
  try {
    const body = await request.json().catch(() => ({}));
    const bookId = String(body.book_id || "").trim();
    const accessToken = String(body.access_token || "").trim();
    if (!uuid.test(bookId) || !accessToken) throw new BasecampError(400, "A valid book and access token are required.");
    const tokenHash = await sha256(accessToken);
    const supabase = serverClient();
    const { data: token, error: tokenError } = await supabase.from("book_access_tokens")
      .select("id,book_id,review_round_id,role,allowed_actions,allowed_pages,expires_at,revoked_at,metadata")
      .eq("token_hash", tokenHash).maybeSingle();
    if (tokenError) throw new BasecampError(500, "The access token could not be validated.");
    authorizeEmployeeSubmission(token, bookId);

    const result = await submitEmployeeBook({
      token, bookId,
      submitCanonical: async () => {
        const { data, error } = await supabase.rpc("submit_kdp_book_for_approval", {
          p_book_id: bookId, p_token_hash: tokenHash, p_source: "employee_pricing_submit",
        });
        if (error) {
          const message = String(error.message || "");
          const status = /not authorized/i.test(message) ? 403 : /not currently|active review round/i.test(message) ? 409 : 422;
          throw new BasecampError(status, status === 422 ? message : "The book could not be submitted in its current state.");
        }
        if (!data?.review_round_id) throw new BasecampError(500, "The submitted review round could not be confirmed.");
        return data;
      },
      syncBasecamp: (canonical: Record<string, unknown>) => syncReviewRoundWithRuntime(supabase, String(canonical.review_round_id)),
    });
    return json({
      ok: true,
      alreadySubmitted: result.already_submitted === true,
      overallStatus: String(result.overall_status || "AWAITING_REVIEW"),
      submittedAt: result.submitted_at || null,
      basecamp: {
        status: String(result.basecamp?.status || "pending"),
        retryAvailable: result.basecamp?.retryAvailable === true,
      },
    });
  } catch (error) { return safeError(error); }
});
