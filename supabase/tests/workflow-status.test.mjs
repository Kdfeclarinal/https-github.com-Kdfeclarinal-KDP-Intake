import test from "node:test";
import assert from "node:assert/strict";

import {
  isUnexpiredTokenExpiry,
  isEmployeeEditableBookStatus,
  isEmployeeStepUnlocked,
  normalizeBookWorkflowStatus,
} from "../functions/_shared/workflowStatus.mjs";

test("canonical employee workflow states are normalized without weakening edit authority", () => {
  assert.equal(normalizeBookWorkflowStatus("EMPLOYEE_INTAKE"), "EMPLOYEE_INTAKE");
  assert.equal(normalizeBookWorkflowStatus("EMPLOYEE_UPDATES"), "EMPLOYEE_UPDATES");
  assert.equal(isEmployeeEditableBookStatus("EMPLOYEE_INTAKE"), true);
  assert.equal(isEmployeeEditableBookStatus("EMPLOYEE_UPDATES"), true);
  assert.equal(isEmployeeEditableBookStatus("AWAITING_REVIEW"), false);
  assert.equal(isEmployeeEditableBookStatus("IN_REVIEW"), false);
  assert.equal(isEmployeeEditableBookStatus("KDP_INTAKE_APPROVED"), false);
});

test("legacy editable states remain accepted during the coordinated database cutover", () => {
  assert.equal(normalizeBookWorkflowStatus("draft"), "EMPLOYEE_INTAKE");
  assert.equal(normalizeBookWorkflowStatus("needs_updates"), "EMPLOYEE_UPDATES");
  assert.equal(isEmployeeEditableBookStatus("draft"), true);
  assert.equal(isEmployeeEditableBookStatus("needs_updates"), true);
  assert.equal(isEmployeeEditableBookStatus("for_approval"), false);
  assert.equal(isEmployeeEditableBookStatus("in_admin_review"), false);
  assert.equal(isEmployeeEditableBookStatus("approved"), false);
});

test("unknown or absent states fail closed", () => {
  assert.equal(normalizeBookWorkflowStatus(""), null);
  assert.equal(normalizeBookWorkflowStatus("submitted"), null);
  assert.equal(isEmployeeEditableBookStatus(null), false);
  assert.equal(isEmployeeEditableBookStatus("deleted"), false);
});

test("token expiry rejects invalid and elapsed timestamps", () => {
  const now = Date.parse("2026-09-10T00:00:00.000Z");
  assert.equal(isUnexpiredTokenExpiry(null, now), true);
  assert.equal(isUnexpiredTokenExpiry("2026-09-11T00:00:00.000Z", now), true);
  assert.equal(isUnexpiredTokenExpiry("2026-09-09T00:00:00.000Z", now), false);
  assert.equal(isUnexpiredTokenExpiry("not-a-date", now), false);
});

test("employee step writes fail closed for locked future steps", () => {
  const book = {
    current_employee_step: "details",
    progress_state: { steps: { content: { isUnlocked: false }, pricing: { isUnlocked: false } } },
  };
  assert.equal(isEmployeeStepUnlocked("details", book, null), true);
  assert.equal(isEmployeeStepUnlocked("content", book, { is_unlocked: false }), false);
  assert.equal(isEmployeeStepUnlocked("pricing", book, null), false);
  assert.equal(isEmployeeStepUnlocked("content", book, { is_unlocked: true }), true);
});
