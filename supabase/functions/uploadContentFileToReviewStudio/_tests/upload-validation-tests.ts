import {
  validateContentUpload,
} from "../_uploadValidation.ts";
import {
  publicFirstUploadResponse,
  publicReplacementResponse,
  publicUploadError,
} from "../_publicResponse.ts";

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

function expectError(fileType: string, name: string, size: number, type: string) {
  const error = validateContentUpload(fileType, { name, size, type });
  assert(typeof error === "string" && error.length > 0, "expected validation error");
}

assert(validateContentUpload("manuscript", { name: "book.pdf", size: 10, type: "application/pdf" }) === null, "valid PDF");
assert(validateContentUpload("cover", { name: "cover.jpg", size: 10, type: "image/jpeg" }) === null, "valid JPEG");
expectError("manuscript", "book.pdf", 1.5 * 1024 * 1024 * 1024 + 1, "application/pdf");
expectError("cover", "cover.jpg", 50 * 1024 * 1024 + 1, "image/jpeg");
expectError("cover", "cover.jpg", 10, "application/pdf");
expectError("cover", "cover.pdf", 10, "image/jpeg");
expectError("manuscript", "book.docx", 10, "application/pdf");

const first = publicFirstUploadResponse({
  bookId: "book-1",
  fileType: "cover",
  bookFileId: "db-1",
  reviewstudioFileUrl: "https://rs.example/view",
  processingStatus: "processing",
  storedFile: { metadata: { temp_storage_path: "secret-path" }, reviewstudio_review_id: "rev-1" },
});
assert(!("stored_file" in first), "first upload must not expose stored row");
assert(!("reviewstudio_review_id" in first), "first upload must not expose review id");
assert(!("book_file_id" in first), "first upload must not expose database row id");
assert(!("reviewstudio_file_url" in first), "upload response does not need RS URL before protected refresh");

const replacement = publicReplacementResponse({
  bookId: "book-1",
  fileType: "cover",
  bookFileId: "db-2",
  reviewstudioFileUrl: "https://rs.example/view-2",
  processingStatus: "processing",
  cleanupPending: { old_review_file_id: "old-file", reason: "network" },
});
assert(replacement.cleanup_pending === true, "cleanup status is boolean only");
assert(!("replaced_old_review_file_id" in replacement), "replacement must not expose old id");
assert(!("book_file_id" in replacement), "replacement must not expose database row id");
assert(!("reviewstudio_file_url" in replacement), "replacement response does not need RS URL before protected refresh");
assert(!publicUploadError(500, "database secret/path").includes("secret"), "server diagnostics must not reach browser errors");
assert(publicUploadError(400, "Cover exceeds the 50 MB limit.").includes("50 MB"), "safe validation feedback remains specific");

console.log("Passed: upload validation and public response tests");
