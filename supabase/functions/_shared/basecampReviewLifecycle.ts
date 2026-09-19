import { BasecampError } from "./basecampClient.ts";

type Row = Record<string, any>;

export const reviewRoundMarker = (roundId: string) =>
  `KDP Intake Review Round: ${roundId}`;

/**
 * Selects the Basecamp task that must be completed before a new
 * Admin Review task is created.
 *
 * Round 1:
 *   Employee Intake
 *   → Admin Review — Round 1
 *
 * Round 2+:
 *   Employee Updates — Round N
 *   → Admin Review — Round N+1
 *
 * Later rounds intentionally fail closed when the corresponding previous
 * Employee Updates task cannot be found. They must never fall back to the
 * original Employee Intake task.
 */
export function selectReviewSourceReference(
  round: Row,
  references: Row[]
) {
  const rows = Array.isArray(references) ? references : [];

  const previousRoundId = String(
    round?.previousRoundId ||
      round?.previous_round_id ||
      ""
  ).trim();

  if (!previousRoundId) {
    return (
      rows.find(
        (row: Row) =>
          row?.reference_kind === "book_todo_list"
      ) || null
    );
  }

  return (
    rows.find(
      (row: Row) =>
        row?.reference_kind === "employee_update" &&
        String(row?.review_round_id || "") === previousRoundId
    ) || null
  );
}

export async function syncBasecampReviewRound(deps: Row) {
  const now = new Date().toISOString();

  try {
    await deps.updateReviewReference({
      provisioning_status: "pending",
      provisioning_attempts: Number(deps.reviewReference?.attempts || 0) + 1,
      last_provisioning_attempt_at: now,
      last_provisioning_error: null,
    });

    if (!deps.round?.reviewerUserId) {
      await deps.updateReviewReference({
        provisioning_status: "failed",
        last_provisioning_error: "reviewer_required",
      });
      return { status: "pending", retryAvailable: true, reason: "reviewer_required" };
    }

    const personId = deps.reviewerMapping?.personId
      ? String(deps.reviewerMapping.personId)
      : null;

    if (!personId) {
      await deps.updateReviewReference({
        provisioning_status: "failed",
        last_provisioning_error: "reviewer_mapping_required",
      });
      return { status: "pending", retryAvailable: true, reason: "reviewer_mapping_required" };
    }

    if (!(deps.projectPeople || []).some((person: Row) => String(person?.id) === personId)) {
      await deps.updateReviewReference({
        provisioning_status: "failed",
        last_provisioning_error: "reviewer_mapping_stale",
      });
      return { status: "pending", retryAvailable: true, reason: "reviewer_mapping_stale" };
    }

    const existing = await deps.reconcileReviewTodo(reviewRoundMarker(deps.round.id));
    let todoId = existing?.id ? String(existing.id) : null;

    if (!todoId) {
      const created = await deps.createReviewTodo({
        content: `Review — Round ${deps.round.roundNumber}`,
        description:
          `<div>${String(deps.book?.title || "Untitled")}</div>` +
          `<div><small>Internal reference: ${reviewRoundMarker(deps.round.id)}</small></div>`,
        assignee_ids: [Number(personId)],
      });

      if (!created?.id) {
        throw new BasecampError(502, "Basecamp returned an invalid Review task.");
      }
      todoId = String(created.id);
    }

    // Do not complete the employee-side source until the next Review task
    // is confirmed. This keeps Basecamp operational continuity on failures.
    if (!deps.employeeReference?.completedAt) {
      const sourceTodo = await deps.getTodo(deps.employeeReference?.todoId);
      if (!sourceTodo?.completed) {
        await deps.completeTodo(deps.employeeReference?.todoId);
      }
      await deps.updateEmployeeReference({ source_todo_completed_at: now });
    }

    await deps.updateReviewReference({
      todo_id: todoId,
      assigned_admin_person_id: personId,
      provisioning_status: "provisioned",
      last_provisioning_error: null,
    });

    return { status: "ready", retryAvailable: false };
  } catch (error) {
    const code = error instanceof BasecampError ? error.code : "review_lifecycle_failed";
    await deps.updateReviewReference({
      provisioning_status: "failed",
      last_provisioning_error: code,
    });
    return { status: "failed", retryAvailable: true };
  }
}
