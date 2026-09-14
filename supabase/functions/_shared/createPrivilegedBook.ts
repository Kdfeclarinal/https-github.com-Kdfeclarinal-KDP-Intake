import { BasecampError } from "./basecampClient.ts";

type Row = Record<string, any>;

export function generateOpaqueToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return `kdp_${[...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export async function sha256Token(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function createPrivilegedBook(deps: Row) {
  if (!deps.actor?.capabilities?.includes("can_create_book")) {
    throw new BasecampError(403, "Book creation is not authorized.");
  }
  const employee = (deps.employees || []).find((item: Row) => String(item.id) === String(deps.employeePersonId));
  if (!employee) throw new BasecampError(422, "Select a current Pre-Press project member.");
  const reviewer = (deps.reviewers || []).find((item: Row) => String(item.id) === String(deps.reviewerUserId));
  if (!reviewer) throw new BasecampError(422, "Select an eligible reviewer.");

  const rawToken = (deps.tokenFactory || generateOpaqueToken)();
  const tokenHash = await (deps.hashToken || sha256Token)(rawToken);
  const canonical = await deps.createCanonicalBook({
    bookFormat: "kindle_ebook", overallStatus: "draft", employeePersonId: String(employee.id),
    employeeName: employee.displayName, reviewerUserId: String(reviewer.id), actorUserId: deps.actor.id,
    tokenHash, tokenPrefix: rawToken.slice(0, 12), source: "privileged_create_book",
  });

  let basecamp: Row;
  try {
    basecamp = await deps.provision({
      book: canonical.book, referenceId: canonical.referenceId, employeePersonId: String(employee.id),
      rawEmployeeToken: rawToken,
    });
  } catch {
    basecamp = { status: "failed", retryAvailable: true };
  }
  return { book: canonical.book, basecamp };
}
