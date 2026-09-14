import { BasecampError } from "./basecampClient.ts";

type Row = Record<string, any>;

export function validateReviewerMapping(deps: Row) {
  if (!deps.actor?.capabilities?.includes("can_manage_users")) {
    throw new BasecampError(403, "Reviewer mapping is not authorized.");
  }
  const reviewer = (deps.reviewers || []).find((row: Row) => row?.active !== false && String(row?.id) === String(deps.reviewerId));
  if (!reviewer) throw new BasecampError(422, "Select an active eligible reviewer.");
  const person = (deps.projectPeople || []).find((row: Row) => row?.id && String(row.id) === String(deps.personId));
  if (!person) throw new BasecampError(422, "Select a current Pre-Press project member.");
  return { reviewerId: String(reviewer.id), personId: String(person.id), displayName: String(person.name || "Basecamp member") };
}
