import {
  authorizeEmployeePageRead,
  isEmployeeStepReadable,
  normalizeEmployeeStepName,
  canReconcileEmployeeFiles,
} from "../_authorization.ts";
import { publicEmployeeFile } from "../_publicFile.ts";

type TestFn = () => void;
const tests: Array<{ name: string; fn: TestFn }> = [];

function test(name: string, fn: TestFn) {
  tests.push({ name, fn });
}

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

const baseToken = {
  role: "employee",
  book_id: "book-1",
  allowed_actions: ["load_employee_page"],
};

test("authorization: exact employee and book binding is allowed", () => {
  assert(authorizeEmployeePageRead(baseToken, "book-1").ok, "expected allowed read");
});

test("authorization: wrong book is denied", () => {
  assert(!authorizeEmployeePageRead(baseToken, "book-2").ok, "wrong book must fail");
});

test("authorization: missing role is denied", () => {
  assert(!authorizeEmployeePageRead({ ...baseToken, role: "" }, "book-1").ok, "missing role must fail");
});

test("authorization: invalid role is denied", () => {
  assert(!authorizeEmployeePageRead({ ...baseToken, role: "admin" }, "book-1").ok, "admin token must fail");
});

test("authorization: missing book binding is denied even with allowed_book_ids", () => {
  const token = { ...baseToken, book_id: null, metadata: { allowed_book_ids: ["book-1"] } };
  assert(!authorizeEmployeePageRead(token, "book-1").ok, "book-specific loader requires book_id");
});

test("authorization: expired token is denied", () => {
  const token = { ...baseToken, expires_at: "2000-01-01T00:00:00.000Z" };
  assert(!authorizeEmployeePageRead(token, "book-1", Date.parse("2026-09-07T00:00:00.000Z")).ok, "expired token must fail");
});

test("authorization: revoked token is denied", () => {
  assert(!authorizeEmployeePageRead({ ...baseToken, revoked_at: "2026-09-01T00:00:00.000Z" }, "book-1").ok, "revoked token must fail");
});

test("authorization: broad bookshelf action is not a load permission", () => {
  const token = { ...baseToken, allowed_actions: ["view_bookshelf"] };
  assert(!authorizeEmployeePageRead(token, "book-1").ok, "bookshelf action must fail");
});

test("authorization: unknown step is rejected instead of coerced", () => {
  assert(normalizeEmployeeStepName("admin") === null, "unknown step must fail");
  assert(normalizeEmployeeStepName("content") === "content", "known step retained");
});

test("authorization: locked future step cannot be read directly", () => {
  const book = { current_employee_step: "details", progress_state: { steps: { content: { isUnlocked: false } } } };
  assert(!isEmployeeStepReadable("content", book, null), "locked content must fail");
  assert(!isEmployeeStepReadable("pricing", book, { is_unlocked: false }), "locked pricing must fail");
});

test("authorization: current and completed earlier steps remain readable", () => {
  assert(isEmployeeStepReadable("details", { current_employee_step: "content" }, null), "details remains readable");
  assert(isEmployeeStepReadable("content", { current_employee_step: "content" }, null), "current content is readable");
  assert(isEmployeeStepReadable("pricing", { current_employee_step: "content" }, { is_unlocked: true }), "explicit unlock is authoritative");
});

test("reconciliation: editable book plus upload permission is allowed", () => {
  const token = { ...baseToken, allowed_actions: ["load_employee_page", "upload_content_file_to_reviewstudio"] };
  assert(canReconcileEmployeeFiles(token, { overall_status: "draft" }), "draft upload-capable token should reconcile");
  assert(canReconcileEmployeeFiles(token, { overall_status: "needs_updates" }), "needs_updates should reconcile");
});

test("reconciliation: read-only token cannot trigger writes", () => {
  assert(!canReconcileEmployeeFiles(baseToken, { overall_status: "draft" }), "read-only token must not reconcile");
});

test("reconciliation: non-editable book cannot be mutated during read", () => {
  const token = { ...baseToken, allowed_actions: ["load_employee_page", "upload_content_file_to_reviewstudio"] };
  assert(!canReconcileEmployeeFiles(token, { overall_status: "submitted" }), "submitted book must not reconcile");
});

test("response: employee file omits provider topology and metadata", () => {
  const file = publicEmployeeFile({
    id: "file-1",
    book_id: "book-1",
    step_name: "content",
    section_key: "content.cover",
    file_type: "cover",
    file_name: "cover.jpg",
    file_status: "complete",
    reviewstudio_file_url: "https://rs.example/view",
    preview_url: "https://storage.example/preview",
    file_size: 6619771,
    created_at: "2026-09-01T00:00:00Z",
    updated_at: "2026-09-02T00:00:00Z",
    reviewstudio_project_id: "project-secret-topology",
    reviewstudio_review_id: "review-secret-topology",
    reviewstudio_file_id: "file-secret-topology",
    metadata: { temp_storage_path: "private/path" },
  });
  assert(file.reviewstudio_file_url === "https://rs.example/view", "UI URL retained");
  assert(file.preview_url === "https://storage.example/preview", "preview retained");
  assert(file.file_size === 6619771, "file size retained for pricing estimates");
  assert(!("metadata" in file), "metadata omitted");
  assert(!("reviewstudio_project_id" in file), "project id omitted");
  assert(!("reviewstudio_review_id" in file), "review id omitted");
  assert(!("reviewstudio_file_id" in file), "file id omitted");
  assert(!("id" in file), "database row id omitted");
  assert(!("book_id" in file), "redundant book id omitted");
});

let passed = 0;
for (const item of tests) {
  try {
    item.fn();
    passed += 1;
    console.log("  PASS " + item.name);
  } catch (error) {
    console.error("  FAIL " + item.name + ": " + (error instanceof Error ? error.message : String(error)));
  }
}

console.log("Passed: " + passed);
console.log("Failed: " + (tests.length - passed));
if (passed !== tests.length) process.exitCode = 1;
