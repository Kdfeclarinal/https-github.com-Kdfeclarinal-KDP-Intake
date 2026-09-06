// ============================================================
// ======= KDP CONTENT FILE UPLOAD TO REVIEWSTUDIO =======
// Function: uploadContentFileToReviewStudio
// Flow: Client -> Project -> separate Review per file type -> Review File
//
// Employee editability rule:
// - Uploads are allowed only while the book is "draft" or
//   "needs_updates".
// - Submitted, under-review, approved, archived, or deleted books
//   are rejected before any integration event, temp upload,
//   ReviewStudio request, or book_files write occurs.
//
// Content file replacement (2026-09-05):
// - When a current book_files row already exists for the
//   (book_id, file_type, section_key) tuple, this function takes
//   the replacement path. The orchestration is implemented in
//   _replaceOrchestration.ts so it can be unit-tested without Deno.
// - Replacement uploads the new file into the SAME Review, persists
//   a new book_files row (is_latest=true), marks the old row
//   superseded, and DELETEs the old ReviewStudio review file.
// - The OLD project and review are NEVER deleted.
// - The OLD book_files row is NEVER hard-deleted; it is marked
//   is_latest=false and a reconciliation job is responsible for
//   final cleanup if the RS DELETE fails (cleanup_pending).
// ============================================================

import { createClient } from "npm:@supabase/supabase-js@2";
import { replaceContentFile } from "./_replaceOrchestration.ts";
import { verifyReviewStudioResources } from "./_verifyRsResources.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

class AppError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "AppError";
    this.status = status;
  }
}

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS,
      "Content-Type": "application/json",
    },
  });
}

function env(name: string) {
  const value = Deno.env.get(name);

  if (!value) {
    throw new Error("Missing environment variable: " + name);
  }

  return value;
}

function rsUrl(path: string) {
  const base = env("REVIEWSTUDIO_API_BASE_URL").replace(/\/+$/, "");
  const cleanPath = String(path || "").startsWith("/") ? path : "/" + path;

  return base + cleanPath;
}

function rsHeaders() {
  return {
    "X-REVIEWSTUDIO-EMAIL": env("REVIEWSTUDIO_ADMIN_EMAIL"),
    "X-REVIEWSTUDIO-TOKEN": env("REVIEWSTUDIO_API_KEY"),
    "Content-Type": "application/json",
  };
}

async function rsRequest(
  path: string,
  options: RequestInit = {},
) {
  const response = await fetch(rsUrl(path), {
    ...options,
    headers: {
      ...rsHeaders(),
      ...(options.headers || {}),
    },
  });

  const text = await response.text();
  let data: unknown = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch (_error) {
    data = text;
  }

  if (!response.ok) {
    console.error("[ReviewStudio API Error]", {
      path,
      status: response.status,
      response: data,
    });

    throw new AppError(
      502,
      "ReviewStudio request failed at " +
        path +
        " with status " +
        response.status,
    );
  }

  return data as any;
}

async function hashToken(token: string) {
  const bytes = new TextEncoder().encode(token);
  const buffer = await crypto.subtle.digest("SHA-256", bytes);

  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function normalizeName(value: unknown) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function normalizeStatus(value: unknown) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

function toApiId(value: unknown) {
  const text = String(value || "").trim();
  const numberValue = Number(text);

  return Number.isFinite(numberValue) && text !== "" ? numberValue : text;
}

function getList(data: any, key: string) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data?.[key])) return data[key];

  return [];
}

function getId(data: any) {
  return String(
    data?.id ||
      data?.data?.id ||
      data?.client?.id ||
      data?.project?.id ||
      data?.review?.id ||
      "",
  );
}

function getReviewFileId(data: any) {
  return String(
    data?.id ||
      data?.data?.id ||
      data?.review_file?.id ||
      data?.data?.review_file?.id ||
      "",
  );
}

function getReviewFileUrl(data: any) {
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

function getProcessingStatus(data: any) {
  return String(
    data?.processing_status ||
      data?.data?.processing_status ||
      data?.review_file?.processing_status ||
      "processing",
  );
}

function validateUuid(value: string, fieldName: string) {
  const uuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  if (!uuidPattern.test(value)) {
    throw new AppError(400, "Invalid " + fieldName + ".");
  }
}

function validateFile(fileType: string, file: File) {
  const name = String(file.name || "").toLowerCase();

  if (!file.size) {
    throw new AppError(400, "The selected file is empty.");
  }

  if (fileType === "manuscript") {
    if (
      name.endsWith(".pdf") ||
      name.endsWith(".doc") ||
      name.endsWith(".docx")
    ) {
      return;
    }

    throw new AppError(400, "Manuscript must be PDF, DOC, or DOCX.");
  }

  if (fileType === "cover") {
    if (
      name.endsWith(".jpg") ||
      name.endsWith(".jpeg") ||
      name.endsWith(".tif") ||
      name.endsWith(".tiff")
    ) {
      return;
    }

    throw new AppError(400, "Cover must be JPG, JPEG, TIF, or TIFF.");
  }

  throw new AppError(400, "Invalid file_type. Use manuscript or cover.");
}

function safeFileName(name: string) {
  return String(name || "upload")
    .replace(/[^\w.\-]+/g, "_")
    .slice(0, 120);
}

function getReviewName(book: any, fileType: string) {
  const title = normalizeName(book.book_title || "Untitled Kindle eBook");
  const label = fileType === "cover" ? "Cover Review" : "Manuscript Review";

  return title + " - " + label;
}

async function getToken(
  supabase: any,
  accessToken: string,
  bookId: string,
) {
  const tokenHash = await hashToken(accessToken);

  const { data, error } = await supabase
    .from("book_access_tokens")
    .select("*")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new AppError(401, "Invalid access token.");
  if (data.revoked_at) throw new AppError(401, "Access token is revoked.");

  if (data.expires_at && new Date(data.expires_at).getTime() <= Date.now()) {
    throw new AppError(401, "Access token has expired.");
  }

  if (data.role !== "employee") {
    throw new AppError(403, "Access token is not an employee token.");
  }

  // Uploads must always use the book-specific token returned by
  // createBookIntake/openBookIntake. A reusable Bookshelf token must not
  // be able to upload files to an arbitrary book.
  if (!data.book_id || String(data.book_id) !== bookId) {
    throw new AppError(403, "Access token does not match this book.");
  }

  const allowed = Array.isArray(data.allowed_actions)
    ? data.allowed_actions
    : [];

  if (!allowed.includes("upload_content_file_to_reviewstudio")) {
    throw new AppError(
      403,
      "Access token does not allow ReviewStudio upload.",
    );
  }

  return data;
}

async function getBook(supabase: any, bookId: string, token: any) {
  const { data, error } = await supabase
    .from("books")
    .select(
      [
        "id",
        "book_title",
        "primary_author_name",
        "employee_email",
        "employee_name",
        "overall_status",
        "deleted_at",
      ].join(","),
    )
    .eq("id", bookId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data || data.deleted_at) {
    throw new AppError(404, "Book not found.");
  }

  if (
    token.employee_email &&
    data.employee_email &&
    String(token.employee_email).toLowerCase() !==
      String(data.employee_email).toLowerCase()
  ) {
    throw new AppError(403, "Access token does not belong to this book.");
  }

  const overallStatus = normalizeStatus(data.overall_status);

  if (!["draft", "needs_updates"].includes(overallStatus)) {
    throw new AppError(
      409,
      "This book is not currently editable by an employee.",
    );
  }

  return data;
}

async function createIntegrationEvent(
  supabase: any,
  bookId: string,
  fileType: string,
  file: File,
) {
  const { data, error } = await supabase
    .from("integration_events")
    .insert({
      provider: "reviewstudio",
      event_type: "content_file_upload",
      status: "pending",
      book_id: bookId,
      payload_json: {
        file_type: fileType,
        file_name: file.name,
        file_size: file.size,
        mime_type: file.type || "",
      },
      metadata: {
        source: "uploadContentFileToReviewStudio",
      },
    })
    .select("id")
    .single();

  if (error) {
    console.warn("[KDP ReviewStudio Upload] Could not create audit event:", error);
    return "";
  }

  return String(data?.id || "");
}

async function finishIntegrationEvent(
  supabase: any,
  eventId: string,
  status: "success" | "failed",
  responseJson: Record<string, unknown> = {},
  errorMessage = "",
) {
  if (!eventId) return;

  const { error } = await supabase
    .from("integration_events")
    .update({
      status,
      response_json: responseJson,
      error_message: errorMessage || null,
      processed_at: new Date().toISOString(),
    })
    .eq("id", eventId);

  if (error) {
    console.warn("[KDP ReviewStudio Upload] Could not finish audit event:", error);
  }
}

async function getReviewStudioContext(
  supabase: any,
  bookId: string,
  fileType: string,
) {
  const { data, error } = await supabase
    .from("book_files")
    .select(
      "file_type, file_kind, reviewstudio_client_id, reviewstudio_project_id, reviewstudio_review_id, metadata",
    )
    .eq("book_id", bookId);

  if (error) throw new Error(error.message);

  const rows = Array.isArray(data) ? data : [];
  const anyRow = rows.find((row: any) => row.reviewstudio_project_id) || {};
  const fileRow = rows.find((row: any) => {
    return row.file_type === fileType || row.file_kind === fileType;
  }) || {};

  const candidate = {
    projectId: anyRow.reviewstudio_project_id || "",
    reviewId: fileRow.reviewstudio_review_id || "",
  };

  // No stored ids to verify: first-time upload. The create flow
  // runs unchanged.
  if (!candidate.projectId && !candidate.reviewId) {
    return {
      clientId: anyRow.reviewstudio_client_id || "",
      projectId: "",
      reviewId: "",
    };
  }

  let verified;
  try {
    verified = await verifyReviewStudioResources({
      candidate,
      fetchImpl: fetch,
      rsBaseUrl: env("REVIEWSTUDIO_API_BASE_URL"),
      rsHeaders: {
        "X-REVIEWSTUDIO-EMAIL": env("REVIEWSTUDIO_ADMIN_EMAIL"),
        "X-REVIEWSTUDIO-TOKEN": env("REVIEWSTUDIO_API_KEY"),
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    });
  } catch (_verifyErr) {
    // The verifier itself failing counts as indeterminate: do not
    // reuse stale ids, do not create duplicates. The caller maps
    // this to a 502 with safe copy.
    throw new AppError(
      502,
      "ReviewStudio could not be reached to verify prior mapping. " +
        "Please try again in a moment.",
    );
  }

  if (verified.anyIndeterminate) {
    // A transient RS failure (network / 5xx / 401 / 403 / 429)
    // means we cannot prove the stored id is stale. Reusing it
    // is unsafe; creating a new project / review could produce
    // a duplicate. The operator must investigate.
    throw new AppError(
      502,
      "ReviewStudio could not be reached to verify prior mapping. " +
        "Please try again in a moment.",
    );
  }

  // Confirmed-present ids are safe to reuse. Confirmed-missing
  // ids are blanked so the create flow runs.
  return {
    clientId: anyRow.reviewstudio_client_id || "",
    projectId: verified.projectId,
    reviewId: verified.reviewId,
  };
}

async function findOrCreateClient(book: any, existingClientId: string) {
  if (existingClientId) return existingClientId;

  const clientName = normalizeName(
    book.primary_author_name || book.book_title || "Unknown Author",
  );

  const searchData = await rsRequest(
    "/clients?search=" + encodeURIComponent(clientName),
  );

  const match = getList(searchData, "clients").find((client: any) => {
    return normalizeName(client.name).toLowerCase() === clientName.toLowerCase();
  });

  if (match?.id) return String(match.id);

  const created = await rsRequest("/clients", {
    method: "POST",
    body: JSON.stringify({ name: clientName }),
  });

  const clientId = getId(created);

  if (!clientId) {
    console.error("[ReviewStudio] Create client response:", created);
    throw new AppError(502, "ReviewStudio did not return a client ID.");
  }

  return clientId;
}

async function findOrCreateProject(
  book: any,
  clientId: string,
  existingProjectId: string,
) {
  if (existingProjectId) return existingProjectId;

  const projectName = normalizeName(
    book.book_title || "Untitled Kindle eBook",
  );

  const created = await rsRequest("/projects", {
    method: "POST",
    body: JSON.stringify({
      name: projectName,
      client_id: toApiId(clientId),
    }),
  });

  const projectId = getId(created);

  if (!projectId) {
    console.error("[ReviewStudio] Create project response:", created);
    throw new AppError(502, "ReviewStudio did not return a project ID.");
  }

  return projectId;
}

async function createReview(book: any, projectId: string, fileType: string) {
  const reviewName = getReviewName(book, fileType);

  const created = await rsRequest("/reviews", {
    method: "POST",
    body: JSON.stringify({
      project_id: toApiId(projectId),
      description: reviewName,
      webhook_url: env("REVIEWSTUDIO_WEBHOOK_URL"),
      status: "active",
      allow_download: true,
      allow_guest_access: true,
      guests_can_approve: true,
      deadline_active: false,
      sort_files_by: "manual",
      sort_files_order: "asc",
    }),
  });

  const reviewId = getId(created);

  if (!reviewId) {
    console.error("[ReviewStudio] Create review response:", created);
    throw new AppError(502, "ReviewStudio did not return a review ID.");
  }

  return reviewId;
}

async function uploadTempFile(
  supabase: any,
  bookId: string,
  fileType: string,
  file: File,
) {
  const bucket = env("REVIEWSTUDIO_TEMP_BUCKET");
  const path =
    bookId +
    "/" +
    fileType +
    "-" +
    Date.now() +
    "-" +
    safeFileName(file.name);

  const { error: uploadError } = await supabase.storage
    .from(bucket)
    .upload(path, await file.arrayBuffer(), {
      contentType: file.type || "application/octet-stream",
      upsert: false,
    });

  if (uploadError) throw new Error(uploadError.message);

  const { data, error: signedUrlError } = await supabase.storage
    .from(bucket)
    .createSignedUrl(path, 60 * 60);

  if (signedUrlError) throw new Error(signedUrlError.message);
  if (!data?.signedUrl) {
    throw new Error("Could not create Supabase signed URL.");
  }

  return { path, signedUrl: data.signedUrl };
}

async function uploadReviewFile(
  reviewId: string,
  fileType: string,
  file: File,
  signedUrl: string,
) {
  const order = fileType === "manuscript" ? 0 : 1;

  const data = await rsRequest(
    "/reviews/" + encodeURIComponent(reviewId) + "/files",
    {
      method: "POST",
      body: JSON.stringify({
        name: file.name,
        review_file_url: signedUrl,
        source: "file",
        order,
      }),
    },
  );

  const reviewFileId = getReviewFileId(data);

  if (!reviewFileId) {
    console.error("[ReviewStudio] Upload file response:", data);
    throw new AppError(502, "ReviewStudio did not return a review file ID.");
  }

  return {
    id: reviewFileId,
    url: getReviewFileUrl(data),
    processingStatus: getProcessingStatus(data),
    raw: data,
  };
}

async function saveBookFile(supabase: any, payload: any) {
  const sectionKey = "content." + payload.fileType;
  const nowIso = new Date().toISOString();

  const record = {
    book_id: payload.bookId,
    step_name: "content",
    section_key: sectionKey,
    file_kind: payload.fileType,
    file_type: payload.fileType,
    file_name: payload.file.name,
    original_filename: payload.file.name,
    file_status: payload.processingStatus,
    storage_provider: "reviewstudio",
    reviewstudio_client_id: payload.clientId,
    reviewstudio_project_id: payload.projectId,
    reviewstudio_review_id: payload.reviewId,
    reviewstudio_file_id: payload.reviewFileId,
    reviewstudio_file_url: payload.reviewFileUrl,
    download_url: payload.reviewFileUrl,
    mime_type: payload.file.type || "",
    file_size: payload.file.size,
    file_size_bytes: payload.file.size,
    uploaded_by_name: payload.uploadedByName || null,
    uploaded_by_email: payload.uploadedByEmail || null,
    uploaded_at: nowIso,
    is_latest: true,
    metadata: {
      review_kind: payload.fileType,
      review_name: payload.reviewName,
      temp_storage_path: payload.tempPath,
      reviewstudio_response: payload.raw,
      uploaded_at: nowIso,
    },
  };

  const existing = await supabase
    .from("book_files")
    .select("id")
    .eq("book_id", payload.bookId)
    .eq("file_type", payload.fileType)
    .eq("section_key", sectionKey)
    .limit(1);

  if (existing.error) throw new Error(existing.error.message);

  if (existing.data?.length) {
    const { data, error } = await supabase
      .from("book_files")
      .update(record)
      .eq("id", existing.data[0].id)
      .select("*")
      .single();

    if (error) throw new Error(error.message);
    return data;
  }

  const { data, error } = await supabase
    .from("book_files")
    .insert(record)
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  return data;
}

Deno.serve(async function (request) {
  if (request.method === "OPTIONS") {
    return new Response("ok", {
      status: 200,
      headers: CORS,
    });
  }

  if (request.method !== "POST") {
    return json(405, {
      ok: false,
      error: "Method not allowed.",
    });
  }

  let supabase: any = null;
  let integrationEventId = "";

  try {
    const form = await request.formData();

    const bookId = String(form.get("book_id") || "").trim();
    const accessToken = String(form.get("access_token") || "").trim();
    const fileType = String(form.get("file_type") || "")
      .trim()
      .toLowerCase();
    const file = form.get("file");

    if (!bookId) throw new AppError(400, "Missing book_id.");
    if (!accessToken) throw new AppError(400, "Missing access_token.");

    validateUuid(bookId, "book_id");

    supabase = createClient(
      env("SUPABASE_URL"),
      env("SUPABASE_SERVICE_ROLE_KEY"),
      {
        auth: { persistSession: false },
      },
    );

    /*
     * Authenticate and confirm the book is still employee-editable before
     * validating or processing the file. This makes the submitted-book
     * guard testable without creating a temp file or ReviewStudio request.
     */
    const token = await getToken(supabase, accessToken, bookId);
    const book = await getBook(supabase, bookId, token);

    if (!(file instanceof File)) {
      throw new AppError(400, "Missing file.");
    }

    validateFile(fileType, file);

    integrationEventId = await createIntegrationEvent(
      supabase,
      bookId,
      fileType,
      file,
    );

    // ----------------------------------------------------------------
    // Content file replacement branch (2026-09-05).
    //
    // A current book_files row already exists for this
    // (book_id, file_type, section_key). Take the safe-replacement
    // path: upload new, persist new, mark old superseded, delete old
    // ReviewStudio file. The old Project and the old Review are kept
    // untouched; only the old review file is removed.
    //
    // The trigger is purely server-side: the browser sends the same
    // fields as for a first-time upload. We never trust browser-side
    // flags like replace_existing; the persisted row IS the trigger.
    // ----------------------------------------------------------------
    const sectionKey = "content." + fileType;
    const { data: currentRow, error: currentRowError } = await supabase
      .from("book_files")
      .select("id, reviewstudio_review_id, reviewstudio_file_id")
      .eq("book_id", bookId)
      .eq("file_type", fileType)
      .eq("section_key", sectionKey)
      .eq("is_latest", true)
      .limit(1)
      .maybeSingle();

    if (currentRowError) {
      throw new Error(
        "Could not check for existing book_files row: " +
          currentRowError.message,
      );
    }

    if (currentRow && currentRow.reviewstudio_review_id && currentRow.reviewstudio_file_id) {
      const replaceResult = await replaceContentFile({
        bookId,
        fileType: fileType as "manuscript" | "cover",
        sectionKey,
        file,
        tempBucket: env("REVIEWSTUDIO_TEMP_BUCKET"),
        supabase,
        fetchImpl: fetch,
        rsBaseUrl: env("REVIEWSTUDIO_API_BASE_URL"),
        rsHeaders: rsHeaders(),
        safeFileName,
      });

      if (!replaceResult.ok) {
        // Persist the full structured failure context to integration_events
        // so reconciliation identifiers survive even if the employee
        // closes the browser. The browser-facing HTTP response is
        // sanitized below — internal ReviewStudio cleanup topology
        // (review_id, old_review_file_id, etc.) is NOT exposed.
        const auditResponse = {
          phase: "replacement",
          orphan_cleanup: replaceResult.orphan_cleanup || null,
        };
        if (replaceResult.requires_reconciliation) {
          // Server-side audit only.
          (auditResponse as Record<string, unknown>).requires_reconciliation =
            replaceResult.requires_reconciliation;
        }

        await finishIntegrationEvent(
          supabase,
          integrationEventId,
          "failed",
          auditResponse,
          replaceResult.error,
        );

        // Sanitize the employee-facing HTTP response. Do not leak
        // internal ReviewStudio reconciliation topology, signed URLs,
        // or cleanup internals to the Content UI.
        let employeeMessage: string;
        if (replaceResult.requires_reconciliation) {
          employeeMessage =
            "The replacement could not be completed. Please try again or contact support.";
        } else if (replaceResult.orphan_cleanup) {
          employeeMessage =
            "The upload could not be saved. Please try again or contact support.";
        } else {
          // Generic failure path (Case A: temp upload / RS POST failed,
          // or preflight errors). Surface the orchestrator's error
          // since it does not include internal RS topology.
          employeeMessage = replaceResult.error;
        }

        const employeeResponse: Record<string, unknown> = {
          ok: false,
          error: employeeMessage,
        };
        if (!replaceResult.requires_reconciliation) {
          // Case B (DB INSERT failed, orphan cleanup attempted) is safe
          // to expose at a high level — there is no internal RS cleanup
          // topology in the response.
          employeeResponse.orphan_cleanup = replaceResult.orphan_cleanup;
        }

        return json(replaceResult.status, employeeResponse);
      }

      await finishIntegrationEvent(
        supabase,
        integrationEventId,
        "success",
        {
          phase: "replacement",
          book_file_id: replaceResult.book_file_id,
          reviewstudio_review_id: replaceResult.reviewstudio_review_id,
          reviewstudio_file_id: replaceResult.reviewstudio_file_id,
          processing_status: replaceResult.processing_status,
          replaced_old_review_file_id:
            replaceResult.replaced_old_review_file_id,
          cleanup_pending: replaceResult.cleanup_pending || null,
        },
      );

      return json(200, {
        ok: true,
        book_id: bookId,
        file_type: fileType,
        operation: "replace",
        book_file_id: replaceResult.book_file_id,
        reviewstudio_review_id: replaceResult.reviewstudio_review_id,
        reviewstudio_file_id: replaceResult.reviewstudio_file_id,
        reviewstudio_file_url: replaceResult.reviewstudio_file_url,
        processing_status: replaceResult.processing_status,
        replaced_old_review_file_id:
          replaceResult.replaced_old_review_file_id,
        cleanup_pending: replaceResult.cleanup_pending || null,
      });
    }

    // ----------------------------------------------------------------
    // First-time upload path (unchanged from prior version).
    // ----------------------------------------------------------------
    const context = await getReviewStudioContext(
      supabase,
      bookId,
      fileType,
    );

    const clientId = await findOrCreateClient(book, context.clientId);
    const projectId = await findOrCreateProject(
      book,
      clientId,
      context.projectId,
    );
    const reviewId = context.reviewId ||
      await createReview(book, projectId, fileType);

    const tempFile = await uploadTempFile(
      supabase,
      bookId,
      fileType,
      file,
    );

    const reviewFile = await uploadReviewFile(
      reviewId,
      fileType,
      file,
      tempFile.signedUrl,
    );

    const reviewName = getReviewName(book, fileType);

    const savedFile = await saveBookFile(supabase, {
      bookId,
      fileType,
      file,
      clientId,
      projectId,
      reviewId,
      reviewFileId: reviewFile.id,
      reviewFileUrl: reviewFile.url,
      processingStatus: reviewFile.processingStatus,
      reviewName,
      tempPath: tempFile.path,
      raw: reviewFile.raw,
      uploadedByName: token.employee_name || book.employee_name || null,
      uploadedByEmail: token.employee_email || book.employee_email || null,
    });

    await finishIntegrationEvent(
      supabase,
      integrationEventId,
      "success",
      {
        reviewstudio_client_id: clientId,
        reviewstudio_project_id: projectId,
        reviewstudio_review_id: reviewId,
        reviewstudio_file_id: reviewFile.id,
        processing_status: reviewFile.processingStatus,
        book_file_id: savedFile.id,
      },
    );

    return json(200, {
      ok: true,
      book_id: bookId,
      file_type: fileType,
      review_name: reviewName,
      reviewstudio_client_id: clientId,
      reviewstudio_project_id: projectId,
      reviewstudio_review_id: reviewId,
      reviewstudio_file_id: reviewFile.id,
      reviewstudio_file_url: reviewFile.url,
      processing_status: reviewFile.processingStatus,
      stored_file: savedFile,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = error instanceof AppError ? error.status : 500;

    console.error("[KDP ReviewStudio Upload] failed:", error);

    if (supabase && integrationEventId) {
      await finishIntegrationEvent(
        supabase,
        integrationEventId,
        "failed",
        {},
        message,
      );
    }

    return json(status, {
      ok: false,
      error: message,
    });
  }
});
