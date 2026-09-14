import { syncReviewOutcomeWithRuntime } from "../_shared/basecampOutcomeRuntime.ts";
import { BasecampError } from "../_shared/basecampClient.ts";
import { privilegedDependencies } from "../_shared/basecampRuntime.ts";
import { CORS, json, safeError, serverClient } from "../_shared/edgeSupport.ts";
import { resolvePrivilegedActor } from "../_shared/privilegedRequest.ts";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (request.method !== "POST") return json({ ok: false, error: "Method not allowed." }, 405);
  try {
    const supabase = serverClient();
    const actor = await resolvePrivilegedActor({
      ...privilegedDependencies(supabase),
      authorizationHeader: request.headers.get("Authorization"),
      requiredCapabilities: ["can_finalize_book", "can_assign_reviewer"],
    });
    const body = await request.json().catch(() => ({}));
    const bookId = String(body.bookId || "");
    if (!/^[0-9a-f-]{36}$/i.test(bookId)) throw new BasecampError(400, "A valid book is required.");
    const { data: book, error } = await supabase.from("books")
      .select("latest_review_round_id").eq("id", bookId).maybeSingle();
    const roundId = String(book?.latest_review_round_id || "");
    if (error || !/^[0-9a-f-]{36}$/i.test(roundId)) throw new BasecampError(409, "The finalized review round is unavailable.");
    const { data: round } = await supabase.from("book_review_rounds")
      .select("outcome,finalized_at").eq("id", roundId).eq("book_id", bookId).maybeSingle();
    if (!round?.finalized_at || !["request_updates", "approved"].includes(String(round.outcome))) {
      throw new BasecampError(409, "The finalized review outcome is unavailable.");
    }
    const outcome = round.outcome === "approved" ? "approve_book" : "request_updates";
    const { data: event, error: eventError } = await supabase.from("integration_events").insert({
      provider: "basecamp", event_type: "review_outcome_retry_requested", book_id: bookId,
      review_round_id: roundId, status: "pending", payload_json: { outcome },
      metadata: { actor_privileged_user_id: actor.id },
    }).select("id").maybeSingle();
    if (eventError || !event?.id) throw new BasecampError(409, "A Basecamp outcome sync is already pending or could not be audited.");
    let result;
    try {
      result = await syncReviewOutcomeWithRuntime(supabase, roundId, outcome);
    } catch (error) {
      if (event?.id) await supabase.from("integration_events").update({
        status: "failed",
        processed_at: new Date().toISOString(),
        error_message: "basecamp_review_outcome_sync_failed",
      }).eq("id", event.id);
      throw error;
    }
    if (event?.id) await supabase.from("integration_events").update({
      status: result.status === "ready" ? "success" : "failed",
      processed_at: new Date().toISOString(),
      error_message: result.status === "ready" ? null : "basecamp_review_outcome_sync_failed",
    }).eq("id", event.id);
    return json({ ok: true, basecamp: result });
  } catch (error) {
    return safeError(error);
  }
});
