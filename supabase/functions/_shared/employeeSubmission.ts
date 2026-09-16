import { BasecampError } from "./basecampClient.ts";
import { isUnexpiredTokenExpiry } from "./workflowStatus.mjs";

type Row = Record<string, any>;

function values(value: unknown) {
  return Array.isArray(value) ? value.map((item) => String(item || "").trim()) : [];
}

export function authorizeEmployeeSubmission(token: Row, bookId: string, nowMs = Date.now()) {
  if (!token || token.role !== "employee") throw new BasecampError(403, "Submission is not authorized.");
  if (token.revoked_at) throw new BasecampError(403, "Access token has been revoked.");
  if (!isUnexpiredTokenExpiry(token.expires_at, nowMs)) throw new BasecampError(403, "Access token has expired or is invalid.");
  if (!token.book_id || String(token.book_id) !== String(bookId)) throw new BasecampError(403, "Access token does not belong to this book.");
  if (token.review_round_id || token.metadata?.token_kind !== "book_specific") throw new BasecampError(403, "A book-specific employee token is required.");
  if (!values(token.allowed_actions).includes("submit_for_approval")) throw new BasecampError(403, "Access token does not allow submission.");
  if (!values(token.allowed_pages).includes("pricing")) throw new BasecampError(403, "Access token does not allow Pricing access.");
  return true;
}

export function resolveSubmissionReviewer(bookReviewerId: unknown, defaultReviewerId: unknown, reviewers: Row[]) {
  const eligible = (reviewers || []).filter((row) => row?.active !== false && row?.id);
  const active = new Set(eligible.map((row) => String(row.id)));
  if (bookReviewerId && active.has(String(bookReviewerId))) return { id: String(bookReviewerId), source: "override" };
  if (defaultReviewerId && active.has(String(defaultReviewerId))) return { id: String(defaultReviewerId), source: "default" };
  const owner = eligible.find((row) => row.role === "owner" || row.role_key === "owner");
  if (owner) return { id: String(owner.id), source: "owner_fallback" };
  return { id: null, source: null };
}

export async function submitEmployeeBook(deps: Row) {
  authorizeEmployeeSubmission(deps.token, deps.bookId, deps.nowMs);
  const canonical = await deps.submitCanonical();
  let basecamp: Row;
  try {
    basecamp = await deps.syncBasecamp(canonical);
  } catch {
    basecamp = { status: "failed", retryAvailable: true };
  }
  return { ...canonical, basecamp };
}
