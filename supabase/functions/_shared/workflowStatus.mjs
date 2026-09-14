const STATUS_ALIASES = Object.freeze({
  EMPLOYEE_INTAKE: "EMPLOYEE_INTAKE",
  AWAITING_REVIEW: "AWAITING_REVIEW",
  IN_REVIEW: "IN_REVIEW",
  EMPLOYEE_UPDATES: "EMPLOYEE_UPDATES",
  KDP_INTAKE_APPROVED: "KDP_INTAKE_APPROVED",
  draft: "EMPLOYEE_INTAKE",
  for_approval: "AWAITING_REVIEW",
  in_admin_review: "IN_REVIEW",
  needs_updates: "EMPLOYEE_UPDATES",
  approved: "KDP_INTAKE_APPROVED",
});

export function normalizeBookWorkflowStatus(value) {
  const status = String(value ?? "").trim();
  return STATUS_ALIASES[status] || null;
}

export function isEmployeeEditableBookStatus(value) {
  const status = normalizeBookWorkflowStatus(value);
  return status === "EMPLOYEE_INTAKE" || status === "EMPLOYEE_UPDATES";
}

export function isUnexpiredTokenExpiry(expiresAt, nowMs = Date.now()) {
  if (expiresAt === null || expiresAt === undefined || expiresAt === "") return true;
  const expiryMs = new Date(String(expiresAt)).getTime();
  return Number.isFinite(expiryMs) && expiryMs > nowMs;
}

export function isEmployeeStepUnlocked(stepName, bookRow, stepRow) {
  const order = ["details", "content", "pricing"];
  const requestedIndex = order.indexOf(String(stepName || "").trim().toLowerCase());
  if (requestedIndex < 0) return false;
  if (requestedIndex === 0) return true;
  if (stepRow?.is_unlocked === true) return true;

  const progressStep = bookRow?.progress_state?.steps?.[order[requestedIndex]];
  if (progressStep?.isUnlocked === true || progressStep?.is_unlocked === true) return true;

  const currentIndex = order.indexOf(
    String(bookRow?.current_employee_step || "").trim().toLowerCase(),
  );
  return currentIndex >= requestedIndex;
}
