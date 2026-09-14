import { BasecampError } from "./basecampClient.ts";

type Row = Record<string, any>;

export const reviewRoundMarker = (roundId: string) => `KDP Intake Review Round: ${roundId}`;

export async function syncBasecampReviewRound(deps: Row) {
  const now = new Date().toISOString();
  try {
    await deps.updateReviewReference({
      provisioning_status: "pending",
      provisioning_attempts: Number(deps.reviewReference?.attempts || 0) + 1,
      last_provisioning_attempt_at: now,
      last_provisioning_error: null,
    });

    if (!deps.employeeReference?.completedAt) {
      const employeeTodo = await deps.getTodo(deps.employeeReference?.todoId);
      if (!employeeTodo?.completed) await deps.completeTodo(deps.employeeReference?.todoId);
      await deps.updateEmployeeReference({ source_todo_completed_at: now });
    }

    if (!deps.round?.reviewerUserId) {
      await deps.updateReviewReference({ provisioning_status: "failed", last_provisioning_error: "reviewer_required" });
      return { status: "pending", retryAvailable: true, reason: "reviewer_required" };
    }
    const personId = deps.reviewerMapping?.personId ? String(deps.reviewerMapping.personId) : null;
    if (!personId) {
      await deps.updateReviewReference({ provisioning_status: "failed", last_provisioning_error: "reviewer_mapping_required" });
      return { status: "pending", retryAvailable: true, reason: "reviewer_mapping_required" };
    }
    if (!(deps.projectPeople || []).some((person: Row) => String(person?.id) === personId)) {
      await deps.updateReviewReference({ provisioning_status: "failed", last_provisioning_error: "reviewer_mapping_stale" });
      return { status: "pending", retryAvailable: true, reason: "reviewer_mapping_stale" };
    }

    const existing = await deps.reconcileReviewTodo(reviewRoundMarker(deps.round.id));
    let todoId = existing?.id ? String(existing.id) : null;
    if (!todoId) {
      const created = await deps.createReviewTodo({
        content: `Admin Review — Round ${deps.round.roundNumber}`,
        description: `<div>${reviewRoundMarker(deps.round.id)}</div><div>${String(deps.book?.title || "Untitled")}</div>`,
        assignee_ids: [Number(personId)],
      });
      if (!created?.id) throw new BasecampError(502, "Basecamp returned an invalid Admin Review task.");
      todoId = String(created.id);
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
    await deps.updateReviewReference({ provisioning_status: "failed", last_provisioning_error: code });
    return { status: "failed", retryAvailable: true };
  }
}
