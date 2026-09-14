import {
  isEmployeeEditableBookStatus,
  isEmployeeStepUnlocked,
  isUnexpiredTokenExpiry,
} from "../_shared/workflowStatus.mjs";

type TokenRow = Record<string, unknown>;
type BookRow = Record<string, unknown>;

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item || "").trim()) : [];
}

export function authorizeEmployeePageRead(
  tokenRow: TokenRow,
  bookId: string,
  nowMs = Date.now(),
): { ok: boolean; error?: string } {
  if (tokenRow.revoked_at) return { ok: false, error: "Access token has been revoked." };

  if (!isUnexpiredTokenExpiry(tokenRow.expires_at, nowMs)) {
    return { ok: false, error: "Access token has expired or is invalid." };
  }

  if (tokenRow.role !== "employee") {
    return { ok: false, error: "Access token role is not allowed for employee page loading." };
  }

  if (!tokenRow.book_id || String(tokenRow.book_id) !== String(bookId)) {
    return { ok: false, error: "Access token does not belong to this book." };
  }

  if (!strings(tokenRow.allowed_actions).includes("load_employee_page")) {
    return { ok: false, error: "Access token does not allow employee page loading." };
  }

  return { ok: true };
}

export type EmployeeStepName = "details" | "content" | "pricing";

export function normalizeEmployeeStepName(value: unknown): EmployeeStepName | null {
  const step = String(value || "").trim().toLowerCase();
  return step === "details" || step === "content" || step === "pricing" ? step : null;
}

export function isEmployeeStepReadable(
  stepName: EmployeeStepName,
  bookRow: BookRow,
  stepRow: BookRow | null,
): boolean {
  return isEmployeeStepUnlocked(stepName, bookRow, stepRow);
}

export function canReconcileEmployeeFiles(tokenRow: TokenRow, bookRow: BookRow): boolean {
  const actions = strings(tokenRow.allowed_actions);

  return actions.includes("upload_content_file_to_reviewstudio") &&
    isEmployeeEditableBookStatus(bookRow.overall_status);
}
