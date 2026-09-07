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

  if (tokenRow.expires_at) {
    const expiresAt = new Date(String(tokenRow.expires_at)).getTime();
    if (!Number.isFinite(expiresAt) || expiresAt <= nowMs) {
      return { ok: false, error: "Access token has expired or is invalid." };
    }
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
  if (stepName === "details") return true;
  if (stepRow?.is_unlocked === true) return true;

  const progressSteps = bookRow.progress_state && typeof bookRow.progress_state === "object"
    ? (bookRow.progress_state as Record<string, unknown>).steps
    : null;
  const progressStep = progressSteps && typeof progressSteps === "object"
    ? (progressSteps as Record<string, unknown>)[stepName]
    : null;
  if (
    progressStep && typeof progressStep === "object" &&
    (progressStep as Record<string, unknown>).isUnlocked === true
  ) return true;

  const order: EmployeeStepName[] = ["details", "content", "pricing"];
  const current = normalizeEmployeeStepName(bookRow.current_employee_step);
  return current !== null && order.indexOf(stepName) <= order.indexOf(current);
}

export function canReconcileEmployeeFiles(tokenRow: TokenRow, bookRow: BookRow): boolean {
  const actions = strings(tokenRow.allowed_actions);
  const status = String(bookRow.overall_status || "").trim().toLowerCase().replace(/[\s-]+/g, "_");

  return actions.includes("upload_content_file_to_reviewstudio") &&
    (status === "draft" || status === "needs_updates");
}
