import { syncReviewRoundWithRuntime } from "../_shared/basecampReviewRuntime.ts";
import { BasecampError } from "../_shared/basecampClient.ts";
import { privilegedDependencies } from "../_shared/basecampRuntime.ts";
import { CORS, json, safeError, serverClient } from "../_shared/edgeSupport.ts";
import { resolvePrivilegedActor } from "../_shared/privilegedRequest.ts";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (request.method !== "POST") return json({ ok: false, error: "Method not allowed." }, 405);
  try {
    const supabase = serverClient();
    const actor = await resolvePrivilegedActor({ ...privilegedDependencies(supabase), authorizationHeader: request.headers.get("Authorization"), requiredCapabilities: ["can_manage_integrations", "can_assign_reviewer"] });
    const body = await request.json().catch(() => ({}));
    const bookId = String(body.bookId || "");
    if (!/^[0-9a-f-]{36}$/i.test(bookId)) throw new BasecampError(400, "A valid book is required.");
    const { data: book, error } = await supabase.from("books").select("latest_review_round_id").eq("id", bookId).maybeSingle();
    const roundId = String(book?.latest_review_round_id || "");
    if (error || !/^[0-9a-f-]{36}$/i.test(roundId)) throw new BasecampError(409, "The current review round is unavailable.");
    await supabase.from("integration_events").insert({ provider: "basecamp", event_type: "review_round_retry_requested", review_round_id: roundId, status: "pending", payload_json: {}, metadata: { actor_privileged_user_id: actor.id } });
    const result = await syncReviewRoundWithRuntime(supabase, roundId);
    return json({ ok: true, basecamp: result });
  } catch (error) { return safeError(error); }
});
