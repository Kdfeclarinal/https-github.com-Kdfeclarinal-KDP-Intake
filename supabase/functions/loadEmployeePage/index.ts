import { createClient } from "npm:@supabase/supabase-js@2";
import { reconcileBookFiles } from "../uploadContentFileToReviewStudio/_reconcile.ts";
import {
  authorizeEmployeePageRead,
  canReconcileEmployeeFiles,
  isEmployeeStepReadable,
  normalizeEmployeeStepName,
} from "./_authorization.ts";
import { sanitizeEmployeeUpdateContext } from "../_shared/employeeUpdates.ts";
import { publicEmployeeFile } from "./_publicFile.ts";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

const PREVIEW_URL_LIFETIME_SECONDS = 15 * 60;

type AnyObject = Record<string, any>;

// Server-only ReviewStudio headers. These are the same credentials the
// upload function uses; the loader only ever issues read-only GETs.
function reviewStudioHeaders() {
  return {
    "X-REVIEWSTUDIO-EMAIL": Deno.env.get("REVIEWSTUDIO_ADMIN_EMAIL") || "",
    "X-REVIEWSTUDIO-TOKEN": Deno.env.get("REVIEWSTUDIO_API_KEY") || "",
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return jsonResponse({ ok: true }, 200);
  }

  if (request.method !== "POST") {
    return jsonResponse(
      {
        ok: false,
        error: "Method not allowed."
      },
      405
    );
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const serviceRoleKey =
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const previewBucket =
      Deno.env.get("REVIEWSTUDIO_TEMP_BUCKET") || "";

    if (!supabaseUrl || !serviceRoleKey) {
      return jsonResponse(
        {
          ok: false,
          error: "Missing Supabase environment variables."
        },
        500
      );
    }

    const payload = await request.json().catch(() => ({}));

    const bookId = cleanString(payload.book_id);
    const accessToken = cleanString(payload.access_token);
    const stepName = normalizeEmployeeStepName(payload.step_name || "content");

    if (!stepName) {
      return jsonResponse(
        { ok: false, error: "Invalid employee step." },
        400
      );
    }

    if (!bookId) {
      return jsonResponse(
        {
          ok: false,
          error: "Missing book_id."
        },
        400
      );
    }

    if (!accessToken) {
      return jsonResponse(
        {
          ok: false,
          error: "Missing access_token."
        },
        400
      );
    }

    const supabase = createClient(
      supabaseUrl,
      serviceRoleKey,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false
        }
      }
    );

    const tokenHash = await sha256Hex(accessToken);

    const { data: tokenRow, error: tokenError } =
      await supabase
        .from("book_access_tokens")
        .select("*")
        .eq("token_hash", tokenHash)
        .maybeSingle();

    if (tokenError) {
      console.error("[loadEmployeePage] token lookup failed:", getErrorMessage(tokenError));
      return jsonResponse(
        {
          ok: false,
          error: "Could not validate access token."
        },
        500
      );
    }

    if (!tokenRow) {
      return jsonResponse(
        {
          ok: false,
          error: "Invalid access token."
        },
        403
      );
    }

    const tokenValidation = authorizeEmployeePageRead(
      tokenRow,
      bookId
    );

    if (!tokenValidation.ok) {
      return jsonResponse(
        {
          ok: false,
          error: tokenValidation.error
        },
        403
      );
    }

    const { data: bookRow, error: bookError } =
      await supabase
        .from("books")
        .select("*")
        .eq("id", bookId)
        .maybeSingle();

    if (bookError) {
      console.error("[loadEmployeePage] book lookup failed:", getErrorMessage(bookError));
      return jsonResponse(
        {
          ok: false,
          error: "Could not load book."
        },
        500
      );
    }

    if (!bookRow) {
      return jsonResponse(
        {
          ok: false,
          error: "Book not found."
        },
        404
      );
    }

    const { data: stepRow, error: stepError } =
      await supabase
        .from("book_step_data")
        .select("*")
        .eq("book_id", bookId)
        .eq("step_name", stepName)
        .maybeSingle();

    if (stepError) {
      console.error("[loadEmployeePage] step lookup failed:", getErrorMessage(stepError));
      return jsonResponse(
        {
          ok: false,
          error: "Could not load step data."
        },
        500
      );
    }

    if (!isEmployeeStepReadable(stepName, bookRow, stepRow)) {
      return jsonResponse(
        { ok: false, error: "This employee step is not unlocked." },
        403
      );
    }

    const { data: fileRows, error: filesError } =
      await supabase
        .from("book_files")
        .select("*")
        .eq("book_id", bookId)
        // Content file replacement marks superseded rows is_latest=false.
        // The loader must surface only the current authoritative file
        // per (book_id, file_type, section_key). is_latest is
        // NOT NULL DEFAULT true on the live schema, so an explicit
        // equality check is sufficient and correct.
        .eq("is_latest", true)
        .order("created_at", {
          ascending: false
        });

    if (filesError) {
      console.error("[loadEmployeePage] file lookup failed:", getErrorMessage(filesError));
      return jsonResponse(
        {
          ok: false,
          error: "Could not load book files."
        },
        500
      );
    }

    // --------------------------------------------------------------
    // ReviewStudio external-deletion reconciliation.
    //
    // For each is_latest=true manuscript/cover row that has stored
    // review_id + file_id, verify the resource still exists in RS
    // via GET /reviews/{review_id}/files/{review_file_id}. Only
    // confirmed-missing (404/410) invalidates the mapping; transient
    // errors (network, 401/403/429, 5xx) are treated as indeterminate
    // and the row is left as-is so a flaky RS does not silently strip
    // files. The orchestrator also patches the row with
    // metadata.reconciliation_reason and metadata.reconciled_at on
    // confirmed missing, so the next page load sees an empty set and
    // the operator can see the audit trail.
    //
    // The verifier runs server-side using the same RS credentials the
    // upload function uses. The browser never sees review_id / file_id
    // for stale rows because the verified subset is what we surface.
    // --------------------------------------------------------------
    const rowsForReconcile = Array.isArray(fileRows) ? fileRows : [];
    let verifiedRows: AnyObject[] = rowsForReconcile;
    try {
      const rsBaseUrl =
        Deno.env.get("REVIEWSTUDIO_API_BASE_URL") || "";
      const rsEmail =
        Deno.env.get("REVIEWSTUDIO_ADMIN_EMAIL") || "";
      const rsToken =
        Deno.env.get("REVIEWSTUDIO_API_KEY") || "";
      // A protected read alone never grants mutation authority. Reconciliation
      // may write only for the same book-specific token that can upload files,
      // and only while the book remains employee-editable.
      const reconciliationAuthorized = canReconcileEmployeeFiles(
        tokenRow,
        bookRow
      );
      if (reconciliationAuthorized && rsBaseUrl && rsEmail && rsToken) {
        const recon = await reconcileBookFiles({
          rows: rowsForReconcile,
          supabase,
          fetchImpl: fetch,
          rsBaseUrl,
          rsHeaders: reviewStudioHeaders(),
        });
        verifiedRows = recon.verified;
        if (recon.marked_stale.length > 0) {
          const { data: revisedBook, error: revisedBookError } = await supabase.from("books").select("employee_revision").eq("id", bookId).maybeSingle();
          if (revisedBookError) throw revisedBookError;
          bookRow.employee_revision = Number(revisedBook?.employee_revision) || 0;
          console.warn(
            "[loadEmployeePage] reconciled " +
              recon.marked_stale.length +
              " stale RS file mapping(s) for book " +
              bookId +
              " (counts: " +
              JSON.stringify(recon.counts) +
              ")"
          );
        }
      } else if (reconciliationAuthorized) {
        // Missing RS env vars: skip reconciliation. The page still
        // returns the rows as loaded, matching the previous behavior.
        console.warn(
          "[loadEmployeePage] RS env vars missing; skipping reconciliation for book " +
            bookId
        );
      }
    } catch (reconErr) {
      // Reconciliation must not fail the page load. The unverified
      // rows are still considered current; a future load can retry.
      console.error(
        "[loadEmployeePage] reconciliation pass failed; serving unverified rows",
        getErrorMessage(reconErr)
      );
    }

    const filesForStep = verifiedRows
      .map(normalizeBookFile)
      .filter((file) =>
        shouldReturnFileForStep(file, stepName)
      );

    const normalizedFiles = await addPreviewUrls(
      supabase,
      filesForStep,
      previewBucket
    );

    let employeeUpdate = null;
    if (["needs_updates", "EMPLOYEE_UPDATES"].includes(String(bookRow.overall_status))) {
      const { data: round } = await supabase.from("book_review_rounds")
        .select("id,round_number,outcome,finalized_at").eq("id", bookRow.latest_review_round_id)
        .eq("book_id", bookId).maybeSingle();
      if (round?.finalized_at && round.outcome === "request_updates") {
        const [{ data: updateItems }, { data: updateComments }, { data: updateCycle }] = await Promise.all([
          supabase.from("book_review_items").select("id,step_name,section_key,decision").eq("review_round_id", round.id),
          supabase.from("book_review_comments").select("id,review_item_id,parent_comment_id,body,comment_text,round_comment_number,actionable,created_at,deleted_at").eq("review_round_id", round.id).is("deleted_at", null),
          supabase.from("book_review_update_cycles").select("id,status").eq("source_review_round_id", round.id).eq("book_id", bookId).maybeSingle(),
        ]);
        let updateThreads: JsonObject[] = [];
        let updateReplies: JsonObject[] = [];
        if (updateCycle?.id && updateCycle.status === "active") {
          const { data: threadRows, error: threadError } = await supabase.from("book_review_update_threads")
            .select("id,source_item_id,source_comment_id,step_name,section_key,request_body_snapshot,request_number_snapshot,requested_at,baseline_value,baseline_file_references,status")
            .eq("update_cycle_id", updateCycle.id).eq("step_name", stepName).eq("status", "active");
          if (threadError) throw threadError;
          updateThreads = threadRows || [];
          const threadIds = updateThreads.map((thread) => String(thread.id || "")).filter(Boolean);
          if (threadIds.length) {
            const { data: replyRows, error: replyError } = await supabase.from("book_review_update_replies")
              .select("id,update_thread_id,body,author_name_snapshot,created_at").in("update_thread_id", threadIds).order("created_at", { ascending: true });
            if (replyError) throw replyError;
            updateReplies = replyRows || [];
          }
        }
        employeeUpdate = sanitizeEmployeeUpdateContext({
          updateCycleId: updateCycle?.id,
          roundNumber: round.round_number,
          step: stepName,
          items: updateItems || [],
          comments: updateComments || [],
          threads: updateThreads,
          replies: updateReplies,
          currentSections: asObject(stepRow?.state_json).sections || {},
          currentFiles: verifiedRows,
        });
      }
    }

    return jsonResponse(
      {
        ok: true,
        book_id: bookId,
        step_name: stepName,
        book: normalizeBook(bookRow),
        step_data: stepRow
          ? normalizeStepData(stepRow)
          : null,
        files: normalizedFiles.map(publicEmployeeFile),
        progress_state: bookRow.progress_state || null,
        employee_revision: Number(bookRow.employee_revision) || 0,
        employee_update: employeeUpdate
      },
      200
    );
  } catch (error) {
    console.error("[loadEmployeePage] unexpected failure:", getErrorMessage(error));
    return jsonResponse(
      {
        ok: false,
        error: "Unexpected loadEmployeePage error."
      },
      500
    );
  }
});

async function addPreviewUrls(
  supabase: any,
  files: AnyObject[],
  bucket: string
): Promise<AnyObject[]> {
  return Promise.all(
    files.map(async (file) => {
      const fileType = cleanString(
        file.file_type
      ).toLowerCase();

      const storagePath = cleanString(
        file.metadata?.temp_storage_path
      );

      if (
        fileType !== "cover" ||
        !bucket ||
        !storagePath
      ) {
        return {
          ...file,
          preview_url: ""
        };
      }

      const { data, error } = await supabase.storage
        .from(bucket)
        .createSignedUrl(
          storagePath,
          PREVIEW_URL_LIFETIME_SECONDS
        );

      if (error || !data?.signedUrl) {
        console.error(
          "[loadEmployeePage] Could not create cover preview URL:",
          {
            fileId: file.id,
            storagePath,
            error: getErrorMessage(error)
          }
        );

        return {
          ...file,
          preview_url: ""
        };
      }

      return {
        ...file,
        preview_url: data.signedUrl
      };
    })
  );
}

function cleanString(value: unknown): string {
  return String(value || "").trim();
}

async function sha256Hex(
  value: string
): Promise<string> {
  const encoded = new TextEncoder().encode(value);

  const hashBuffer = await crypto.subtle.digest(
    "SHA-256",
    encoded
  );

  return Array.from(new Uint8Array(hashBuffer))
    .map((byte) =>
      byte.toString(16).padStart(2, "0")
    )
    .join("");
}

function normalizeBook(
  bookRow: AnyObject
): AnyObject {
  return {
    id: bookRow.id || "",
    book_id: bookRow.id || "",
    book_title: bookRow.book_title || "",
    subtitle: bookRow.subtitle || "",
    primary_author_name:
      bookRow.primary_author_name || "",
    primary_marketplace:
      bookRow.primary_marketplace || "",
    overall_status:
      bookRow.overall_status || "draft",
    current_employee_step:
      bookRow.current_employee_step || "details",
    progress_state:
      bookRow.progress_state || null,
    created_at: bookRow.created_at || null,
    updated_at: bookRow.updated_at || null
  };
}

function normalizeStepData(
  stepRow: AnyObject
): AnyObject {
  return {
    book_id: stepRow.book_id || "",
    step_name: stepRow.step_name || "",
    step_status:
      stepRow.step_status || "not_started",
    is_complete: !!stepRow.is_complete,
    is_unlocked: !!stepRow.is_unlocked,
    state_json: stepRow.state_json || null,
    extracted_fields:
      stepRow.extracted_fields || null,
    validation_errors:
      stepRow.validation_errors || null,
    saved_at: stepRow.saved_at || null,
    completed_at: stepRow.completed_at || null,
    updated_at: stepRow.updated_at || null
  };
}

function normalizeBookFile(
  fileRow: AnyObject
): AnyObject {
  const metadata = fileRow.metadata || {};

  const sectionKey =
    fileRow.section_key ||
    metadata.section_key ||
    "";

  let inferredFileType =
    fileRow.file_type ||
    metadata.file_type ||
    "";

  if (
    !inferredFileType &&
    String(sectionKey).includes("manuscript")
  ) {
    inferredFileType = "manuscript";
  }

  if (
    !inferredFileType &&
    String(sectionKey).includes("cover")
  ) {
    inferredFileType = "cover";
  }

  return {
    id: fileRow.id || "",
    book_id: fileRow.book_id || "",
    step_name:
      fileRow.step_name ||
      metadata.step_name ||
      "",
    section_key: sectionKey,
    file_type: inferredFileType,
    file_name:
      fileRow.file_name ||
      fileRow.original_file_name ||
      fileRow.filename ||
      metadata.file_name ||
      metadata.original_file_name ||
      "",
    file_status:
      fileRow.file_status ||
      metadata.file_status ||
      "uploaded",
    storage_provider:
      fileRow.storage_provider ||
      metadata.storage_provider ||
      "reviewstudio",
    reviewstudio_project_id:
      fileRow.reviewstudio_project_id ||
      metadata.reviewstudio_project_id ||
      metadata.rs_project_id ||
      "",
    reviewstudio_file_id:
      fileRow.reviewstudio_file_id ||
      metadata.reviewstudio_file_id ||
      metadata.rs_file_id ||
      "",
    reviewstudio_file_url:
      fileRow.reviewstudio_file_url ||
      metadata.reviewstudio_file_url ||
      metadata.view_url ||
      "",
    download_url:
      fileRow.download_url ||
      fileRow.file_url ||
      metadata.download_url ||
      metadata.file_url ||
      "",
    mime_type:
      fileRow.mime_type ||
      metadata.mime_type ||
      "",
    file_size:
      fileRow.file_size ||
      fileRow.size_bytes ||
      metadata.file_size ||
      metadata.size_bytes ||
      null,
    created_at: fileRow.created_at || null,
    updated_at: fileRow.updated_at || null,
    metadata
  };
}

function shouldReturnFileForStep(
  file: AnyObject,
  stepName: string
): boolean {
  const step = cleanString(
    file.step_name
  ).toLowerCase();

  const sectionKey = cleanString(
    file.section_key
  ).toLowerCase();

  const fileType = cleanString(
    file.file_type
  ).toLowerCase();

  if (step === stepName) return true;

  if (
    sectionKey.startsWith(stepName + ".")
  ) {
    return true;
  }

  if (stepName === "content") {
    return (
      fileType === "manuscript" ||
      fileType === "cover"
    );
  }

  return false;
}

function getErrorMessage(
  error: unknown
): string {
  if (!error) return "";

  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "object") {
    try {
      return JSON.stringify(error);
    } catch (_error) {
      return String(error);
    }
  }

  return String(error);
}

function jsonResponse(
  payload: AnyObject,
  status: number
): Response {
  return new Response(
    JSON.stringify(payload),
    {
      status,
      headers: {
        ...CORS_HEADERS,
        "Content-Type": "application/json"
      }
    }
  );
}
