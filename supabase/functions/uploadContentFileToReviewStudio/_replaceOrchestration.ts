// ============================================================
// Content File Replacement — pure orchestration module
//
// Extracted from uploadContentFileToReviewStudio_reviewstudio_flow.ts
// so the replacement flow can be unit-tested without a Deno runtime.
//
// Inputs are passed in (no module-level state, no Deno globals).
// The module is the single source of truth for the safe-replacement
// order required by the Content file replacement brief:
//
//   1. resolve current persisted book_files row  ->  trusted review_id / review_file_id
//   2. upload NEW file into the SAME Review        (POST /reviews/{review_id}/files)
//   3. verify RS accepted the new file
//   4. persist the NEW mapping as staged            (is_latest=false)
//   5. atomically promote NEW + supersede OLD       (database RPC)
//   6. DELETE the OLD ReviewStudio review file     (DELETE /reviews/{review_id}/files/{old_review_file_id})
//   7. return the new authoritative file state
//
// The brief explicitly forbids deleting the old book_files row hard
// until the RS DELETE is confirmed, so step 5 marks superseded
// rather than deletes. Hard delete is the reconciliation job's
// responsibility.
//
// Failure cases (A–D) map to short-circuited early returns with
// a structured status object. The caller (Edge Function) maps that
// to an HTTP response and an integration_events row.
// ============================================================

export type ReviewStudioAuthHeaders = {
  "X-REVIEWSTUDIO-EMAIL": string;
  "X-REVIEWSTUDIO-TOKEN": string;
  "Content-Type": string;
  Accept: string;
};

export type SupabaseLike = {
  from: (table: string) => any;
  rpc: (name: string, args: Record<string, unknown>) => Promise<{
    data: unknown;
    error: { message: string } | null;
  }>;
  storage: {
    from: (bucket: string) => {
      upload: (
        path: string,
        bytes: ArrayBuffer,
        opts: { contentType: string; upsert: boolean },
      ) => Promise<{ error: { message: string } | null }>;
      createSignedUrl: (
        path: string,
        expiresInSec: number,
      ) => Promise<{ data: { signedUrl: string } | null; error: { message: string } | null }>;
    };
  };
};

export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<{
  status: number;
  ok: boolean;
  text: () => Promise<string>;
}>;

export type ReplaceInput = {
  bookId: string;
  fileType: "manuscript" | "cover";
  sectionKey: string; // "content.manuscript" or "content.cover"
  file: { name: string; type: string; size: number; arrayBuffer: () => Promise<ArrayBuffer> };
  tempBucket: string;
  supabase: SupabaseLike;
  fetchImpl: FetchLike;
  rsBaseUrl: string;
  rsHeaders: ReviewStudioAuthHeaders;
  signedUrlTtlSec?: number; // default 3600
  safeFileName?: (name: string) => string;
  tokenHash: string;
  expectedRevision: number;
  expectedCurrentFileId: string;
};

export type CurrentFileRow = {
  id: string;
  reviewstudio_review_id: string;
  reviewstudio_file_id: string;
  reviewstudio_project_id: string;
};

export type ReplaceResult =
  | {
      ok: true;
      book_file_id: string;
      reviewstudio_review_id: string;
      reviewstudio_file_id: string;
      reviewstudio_file_url: string;
      processing_status: string;
      // RS-DELETE failed but the new file is already authoritative.
      // Caller should surface a "cleanup pending" hint to the employee
      // (UI still shows the new file as current).
      cleanup_pending?: { old_review_file_id: string; reason: string };
      replaced_old_review_file_id?: string;
    }
  | {
      ok: false;
      // HTTP-equivalent status. Caller maps to JSON response.
      status: number;
      error: string;
      // Case B: new RS file was created but the DB INSERT failed.
      // We attempted to delete the orphan; the result of that attempt
      // is reported here so the caller can decide whether to surface
      // it to the user or to a reconciliation job.
      orphan_cleanup?: { attempted: boolean; rs_delete_ok?: boolean; rs_delete_status?: number };
      // Case E: new RS file was created AND the new book_files row
      // was inserted, but the supersede UPDATE on the OLD row failed.
      // Both new artifacts are real and need reconciliation. The
      // loader is now in a duplicated-authoritative state until a
      // reconciliation job sets old.is_latest=false and
      // old.replaced_by_file_id=new.id. The old RS file is
      // intentionally NOT deleted (would worsen the orphan).
      requires_reconciliation?: {
        new_book_file_id: string;
        new_review_file_id: string;
        old_book_file_id: string;
        old_review_file_id: string;
        review_id: string;
        reason: string;
      };
    };

const DEFAULT_TTL_SEC = 60 * 60;
const MANUSCRIPT_ORDER = 0;
const COVER_ORDER = 1;

function defaultSafeFileName(name: string): string {
  return String(name || "upload").replace(/[^\w.\-]+/g, "_").slice(0, 120);
}

function rsUrl(base: string, path: string): string {
  const cleanBase = base.replace(/\/+$/, "");
  const cleanPath = String(path || "").startsWith("/") ? path : "/" + path;
  return cleanBase + cleanPath;
}

async function fetchJson<T = any>(
  fetchImpl: FetchLike,
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
): Promise<{ status: number; data: T | null; raw: string }> {
  const res = await fetchImpl(url, init);
  const text = await res.text();
  let data: T | null = null;
  if (text) {
    try {
      data = JSON.parse(text) as T;
    } catch (_e) {
      data = null;
    }
  }
  return { status: res.status, data, raw: text };
}

function pickReviewFileId(data: any): string {
  return String(
    data?.id ||
      data?.data?.id ||
      data?.review_file?.id ||
      data?.data?.review_file?.id ||
      "",
  );
}

function pickReviewFileUrl(data: any): string {
  return String(
    data?.review_url ||
      data?.url ||
      data?.data?.review_url ||
      data?.data?.url ||
      data?.review_file?.review_url ||
      data?.review_file?.url ||
      "",
  );
}

function pickProcessingStatus(data: any): string {
  return String(
    data?.processing_status ||
      data?.data?.processing_status ||
      data?.review_file?.processing_status ||
      "processing",
  );
}

async function resolveCurrentFile(
  supabase: SupabaseLike,
  bookId: string,
  fileType: string,
  sectionKey: string,
): Promise<CurrentFileRow | null> {
  const { data, error } = await supabase
    .from("book_files")
    .select(
      "id, reviewstudio_review_id, reviewstudio_file_id, reviewstudio_project_id",
    )
    .eq("book_id", bookId)
    .eq("file_type", fileType)
    .eq("section_key", sectionKey)
    .eq("is_latest", true)
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Could not load current book_files row: ${error.message || String(error)}`);
  }
  if (!data) return null;
  return {
    id: String(data.id || ""),
    reviewstudio_review_id: String(data.reviewstudio_review_id || ""),
    reviewstudio_file_id: String(data.reviewstudio_file_id || ""),
    reviewstudio_project_id: String(data.reviewstudio_project_id || ""),
  };
}

async function uploadTempFile(
  supabase: SupabaseLike,
  bucket: string,
  bookId: string,
  fileType: string,
  file: ReplaceInput["file"],
  safeFileName: (s: string) => string,
): Promise<{ path: string; signedUrl: string }> {
  const path =
    bookId + "/" + fileType + "-" + Date.now() + "-" + safeFileName(file.name);

  const { error: uploadError } = await supabase.storage
    .from(bucket)
    .upload(path, await file.arrayBuffer(), {
      contentType: file.type || "application/octet-stream",
      upsert: false,
    });

  if (uploadError) {
    throw new Error(`Temp upload failed: ${uploadError.message}`);
  }

  const { data, error: signedUrlError } = await supabase.storage
    .from(bucket)
    .createSignedUrl(path, DEFAULT_TTL_SEC);

  if (signedUrlError || !data?.signedUrl) {
    throw new Error(
      `Could not create signed URL: ${signedUrlError?.message || "no signedUrl"}`,
    );
  }
  return { path, signedUrl: data.signedUrl };
}

async function postNewReviewFile(
  fetchImpl: FetchLike,
  rsBaseUrl: string,
  rsHeaders: ReviewStudioAuthHeaders,
  reviewId: string,
  fileType: "manuscript" | "cover",
  fileName: string,
  signedUrl: string,
): Promise<{ status: number; data: any; raw: string }> {
  const order = fileType === "manuscript" ? MANUSCRIPT_ORDER : COVER_ORDER;
  return fetchJson(
    fetchImpl,
    rsUrl(rsBaseUrl, "/reviews/" + encodeURIComponent(reviewId) + "/files"),
    {
      method: "POST",
      headers: { ...rsHeaders },
      body: JSON.stringify({
        name: fileName,
        review_file_url: signedUrl,
        source: "file",
        order,
      }),
    },
  );
}

async function deleteOldReviewFile(
  fetchImpl: FetchLike,
  rsBaseUrl: string,
  rsHeaders: ReviewStudioAuthHeaders,
  reviewId: string,
  oldReviewFileId: string,
): Promise<{ status: number; ok: boolean }> {
  // Do NOT pass delete_all_versions: our workflow is independent-file
  // replacement, not version-chain deletion.
  const res = await fetchImpl(
    rsUrl(
      rsBaseUrl,
      "/reviews/" +
        encodeURIComponent(reviewId) +
        "/files/" +
        encodeURIComponent(oldReviewFileId),
    ),
    { method: "DELETE", headers: { ...rsHeaders } },
  );
  return { status: res.status, ok: res.ok };
}

async function insertNewBookFile(
  supabase: SupabaseLike,
  record: Record<string, unknown>,
): Promise<{ id: string }> {
  const { data, error } = await supabase
    .from("book_files")
    .insert(record)
    .select("id")
    .single();
  if (error) {
    throw new Error(`Could not insert new book_files row: ${error.message || String(error)}`);
  }
  return { id: String(data?.id || "") };
}

async function promoteReplacementBookFile(
  supabase: SupabaseLike,
  bookId: string,
  fileType: string,
  sectionKey: string,
  oldBookFileId: string,
  newBookFileId: string,
  tokenHash: string,
  expectedRevision: number,
): Promise<void> {
  const { data, error } = await supabase.rpc("promote_content_file_if_revision", {
    p_book_id: bookId,
    p_token_hash: tokenHash,
    p_expected_revision: expectedRevision,
    p_file_type: fileType,
    p_section_key: sectionKey,
    p_expected_old_file_id: oldBookFileId,
    p_new_file_id: newBookFileId,
  });
  if (error || typeof data !== "number" || !Number.isSafeInteger(data)) {
    throw new Error(
      "Could not atomically promote replacement book_files row: " +
        (error?.message || "the current file changed during replacement"),
    );
  }
}

export async function replaceContentFile(input: ReplaceInput): Promise<ReplaceResult> {
  const safeFileName = input.safeFileName || defaultSafeFileName;

  // 1. Resolve current persisted row (may not exist for a brand-new
  //    book; in that case we fall through to the existing first-upload
  //    path in the caller and this function is not invoked).
  let current: CurrentFileRow | null = null;
  try {
    current = await resolveCurrentFile(
      input.supabase,
      input.bookId,
      input.fileType,
      input.sectionKey,
    );
  } catch (e: any) {
    return { ok: false, status: 500, error: e?.message || String(e) };
  }
  if (!current) {
    return {
      ok: false,
      status: 409,
      error: "No current book_files row to replace.",
    };
  }
  if (current.id !== input.expectedCurrentFileId) {
    return { ok: false, status: 409, error: "The current file changed elsewhere. Reload and try again." };
  }
  if (!current.reviewstudio_review_id || !current.reviewstudio_file_id) {
    return {
      ok: false,
      status: 500,
      error:
        "Current book_files row is missing ReviewStudio review_id or file_id. Cannot replace.",
    };
  }

  const reviewId = current.reviewstudio_review_id;
  const oldReviewFileId = current.reviewstudio_file_id;

  // 2. Upload the NEW file to Supabase temp storage and get a signed URL.
  let temp: { path: string; signedUrl: string };
  try {
    temp = await uploadTempFile(
      input.supabase,
      input.tempBucket,
      input.bookId,
      input.fileType,
      input.file,
      safeFileName,
    );
  } catch (e: any) {
    // Case A (partial): old file is untouched, no RS call was made.
    return { ok: false, status: 502, error: e?.message || String(e) };
  }

  // 3. POST the NEW file into the SAME Review.
  let post: { status: number; data: any; raw: string };
  try {
    post = await postNewReviewFile(
      input.fetchImpl,
      input.rsBaseUrl,
      input.rsHeaders,
      reviewId,
      input.fileType,
      input.file.name,
      temp.signedUrl,
    );
  } catch (e: any) {
    return { ok: false, status: 502, error: e?.message || String(e) };
  }

  if (!post.status || post.status < 200 || post.status >= 300) {
    // Case A: new RS upload failed. Old file is untouched.
    return {
      ok: false,
      status: 502,
      error:
        "ReviewStudio did not accept the new file (status " +
        post.status +
        "). Original file is unchanged.",
    };
  }

  const newReviewFileId = pickReviewFileId(post.data);
  const newReviewFileUrl = pickReviewFileUrl(post.data);
  const processingStatus = pickProcessingStatus(post.data);

  if (!newReviewFileId) {
    // 201 without an id is a contract drift — treat as failure.
    return {
      ok: false,
      status: 502,
      error: "ReviewStudio accepted the upload but did not return a review file ID.",
    };
  }

  // 4. Persist the NEW book_files mapping.
  const nowIso = new Date().toISOString();
  const newRecord: Record<string, unknown> = {
    book_id: input.bookId,
    step_name: "content",
    section_key: input.sectionKey,
    file_kind: input.fileType,
    file_type: input.fileType,
    file_name: input.file.name,
    original_filename: input.file.name,
    file_status: processingStatus,
    storage_provider: "reviewstudio",
    reviewstudio_project_id: current.reviewstudio_project_id || null,
    reviewstudio_review_id: reviewId,
    reviewstudio_file_id: newReviewFileId,
    reviewstudio_file_url: newReviewFileUrl,
    download_url: newReviewFileUrl,
    mime_type: input.file.type || "",
    file_size: input.file.size,
    file_size_bytes: input.file.size,
    uploaded_at: nowIso,
    // Staged until the transactional RPC atomically supersedes the old row.
    is_latest: false,
    metadata: {
      review_kind: input.fileType,
      temp_storage_path: temp.path,
      reviewstudio_response: post.data,
      uploaded_at: nowIso,
      replaces_book_file_id: current.id,
      replaces_review_file_id: oldReviewFileId,
    },
  };

  let inserted: { id: string };
  try {
    inserted = await insertNewBookFile(input.supabase, newRecord);
  } catch (e: any) {
    // Case B: new RS file exists, DB INSERT failed.
    // Attempt to clean up the orphan RS file. If cleanup also fails,
    // report orphan_cleanup so the caller can flag a reconciliation job.
    let cleanup: { attempted: true; rs_delete_ok: boolean; rs_delete_status: number } = {
      attempted: true,
      rs_delete_ok: false,
      rs_delete_status: 0,
    };
    try {
      const del = await deleteOldReviewFile(
        input.fetchImpl,
        input.rsBaseUrl,
        input.rsHeaders,
        reviewId,
        newReviewFileId, // <-- the just-created one
      );
      cleanup.rs_delete_ok = del.ok;
      cleanup.rs_delete_status = del.status;
    } catch (_cleanupErr) {
      // ignore; already in cleanup struct
    }
    return {
      ok: false,
      status: 500,
      error:
        e?.message ||
        "Could not persist the new book_files mapping. " +
          "Replacement was rolled back where possible.",
      orphan_cleanup: cleanup,
    };
  }

  // 5. Atomically supersede OLD and promote NEW. The migration-backed RPC
  //    verifies the expected current tuple, so concurrent replacements cannot
  //    both become authoritative. Failure leaves OLD current and NEW staged.
  //
  //    On failure we therefore:
  //      - skip step 6 (do NOT delete the old RS file)
  //      - return a structured failure with all ids needed for
  //        a future reconciliation job to repair the state.
  try {
    await promoteReplacementBookFile(
      input.supabase,
      input.bookId,
      input.fileType,
      input.sectionKey,
      current.id,
      inserted.id,
      input.tokenHash,
      input.expectedRevision,
    );
  } catch (e: any) {
    const stale = /changed elsewhere|40001/i.test(e?.message || "");
    return {
      ok: false,
      status: stale ? 409 : 500,
      error:
        (stale ? "The current file changed elsewhere. Reload and try again." : e?.message) ||
        "Could not mark the old book_files row as superseded. " +
          "Replacement aborted; new RS file and new book_files row " +
          "are real and require reconciliation.",
      requires_reconciliation: {
        new_book_file_id: inserted.id,
        new_review_file_id: newReviewFileId,
        old_book_file_id: current.id,
        old_review_file_id: oldReviewFileId,
        review_id: reviewId,
        reason: e?.message || "supersede UPDATE failed",
      },
    };
  }

  // 6. DELETE the OLD ReviewStudio review file.
  let cleanupPending: { old_review_file_id: string; reason: string } | undefined;
  try {
    const del = await deleteOldReviewFile(
      input.fetchImpl,
      input.rsBaseUrl,
      input.rsHeaders,
      reviewId,
      oldReviewFileId,
    );
    if (!del.ok) {
      // Case C: new file is already authoritative (loader filter sees it).
      // Case D: 404 means the old file was already gone; treat as success.
      if (del.status !== 404) {
        cleanupPending = {
          old_review_file_id: oldReviewFileId,
          reason: "ReviewStudio DELETE returned status " + del.status,
        };
      }
    }
  } catch (e: any) {
    // Network error or fetch threw. New file is still authoritative.
    cleanupPending = {
      old_review_file_id: oldReviewFileId,
      reason: e?.message || "ReviewStudio DELETE request threw",
    };
  }

  return {
    ok: true,
    book_file_id: inserted.id,
    reviewstudio_review_id: reviewId,
    reviewstudio_file_id: newReviewFileId,
    reviewstudio_file_url: newReviewFileUrl,
    processing_status: processingStatus,
    cleanup_pending: cleanupPending,
    replaced_old_review_file_id: oldReviewFileId,
  };
}
