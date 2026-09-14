import { BasecampError } from "./basecampClient.ts";
import { syncBasecampReviewRound } from "./basecampReviewLifecycle.ts";
import { createBasecampRuntime, loadActiveBasecampConnection, serverEnvironment } from "./basecampRuntime.ts";

type Row = Record<string, any>;

export async function syncReviewRoundWithRuntime(supabase: Row, reviewRoundId: string) {
  const { data: round, error: roundError } = await supabase.from("book_review_rounds")
    .select("id,book_id,round_number,reviewer_user_id,status").eq("id", reviewRoundId).maybeSingle();
  if (roundError || !round) throw new BasecampError(404, "Review round was not found.");
  if (!["submitted", "in_review"].includes(String(round.status))) throw new BasecampError(409, "Review round is not active.");
  const { data: book, error: bookError } = await supabase.from("books")
    .select("id,book_title").eq("id", round.book_id).maybeSingle();
  if (bookError || !book) throw new BasecampError(404, "Book was not found.");
  const { data: refs, error: refsError } = await supabase.from("basecamp_references")
    .select("id,book_id,review_round_id,reference_kind,todo_list_id,todo_id,source_todo_completed_at,provisioning_attempts")
    .eq("book_id", round.book_id).in("reference_kind", ["book_todo_list", "review_round"]);
  if (refsError) throw refsError;
  const employeeReference = (refs || []).find((row: Row) => row.reference_kind === "book_todo_list");
  const reviewReference = (refs || []).find((row: Row) => row.reference_kind === "review_round" && row.review_round_id === round.id);
  if (!employeeReference?.todo_id || !reviewReference?.todo_list_id) throw new BasecampError(409, "Basecamp review lifecycle state is unavailable.");

  const connection = await loadActiveBasecampConnection(supabase);
  const env = serverEnvironment();
  if (!env.userAgent) throw new BasecampError(500, "Basecamp User-Agent is not configured.");
  const runtime = await createBasecampRuntime(supabase, connection, env);
  const people = await runtime.getCollection(`projects/${connection.projectId}/people.json`);
  let mapping = null;
  if (round.reviewer_user_id) {
    const { data } = await supabase.from("privileged_user_basecamp_mappings")
      .select("basecamp_person_id,connection_id,account_id,project_id")
      .eq("privileged_user_id", round.reviewer_user_id).eq("connection_id", connection.id).maybeSingle();
    if (data && data.account_id === connection.accountId && data.project_id === connection.projectId) {
      mapping = { personId: data.basecamp_person_id };
    }
  }
  const updateRef = (id: string, patch: Row) => supabase.from("basecamp_references").update(patch).eq("id", id).eq("book_id", book.id);
  const { data: event } = await supabase.from("integration_events").insert({
    provider: "basecamp", event_type: "review_round_sync_attempt", book_id: book.id,
    review_round_id: round.id, status: "pending", payload_json: { reference_id: reviewReference.id }, metadata: {},
  }).select("id").maybeSingle();
  const result = await syncBasecampReviewRound({
    round: { id: round.id, roundNumber: round.round_number, reviewerUserId: round.reviewer_user_id }, book,
    employeeReference: { todoId: employeeReference.todo_id, completedAt: employeeReference.source_todo_completed_at },
    reviewReference: { id: reviewReference.id, todoListId: reviewReference.todo_list_id, todoId: reviewReference.todo_id, attempts: reviewReference.provisioning_attempts },
    reviewerMapping: mapping, projectPeople: people,
    getTodo: (id: string) => runtime.getJson(`todos/${id}.json`),
    completeTodo: (id: string) => runtime.postJson(`todos/${id}/completion.json`),
    reconcileReviewTodo: async (marker: string) => (await runtime.getCollection(`todolists/${reviewReference.todo_list_id}/todos.json`))
      .find((row: Row) => String(row?.description || "").includes(marker)) || null,
    createReviewTodo: (payload: Row) => runtime.postJson(`todolists/${reviewReference.todo_list_id}/todos.json`, payload),
    updateEmployeeReference: (patch: Row) => updateRef(employeeReference.id, patch),
    updateReviewReference: (patch: Row) => updateRef(reviewReference.id, patch),
  });
  if (event?.id) await supabase.from("integration_events").update({
    status: result.status === "ready" ? "success" : "failed", processed_at: new Date().toISOString(),
    error_message: result.status === "ready" ? null : String(result.reason || "basecamp_review_sync_failed"),
  }).eq("id", event.id);
  return result;
}
