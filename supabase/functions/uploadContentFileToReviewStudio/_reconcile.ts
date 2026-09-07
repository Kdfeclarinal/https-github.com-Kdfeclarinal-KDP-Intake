// ============================================================
// Content file load-time reconciliation — pure orchestration module
//
// Extracted from loadEmployeePage/index.ts so the per-row RS
// verification + reconciliation pass can be unit-tested without
// a Deno runtime.
//
// Inputs are passed in (no module-level state, no Deno globals).
//
// What this module does (per the "ReviewStudio external deletion
// reconciliation" brief):
//
//   1. For each is_latest=true row with a manuscript/cover
//      (file_type or file_kind) and a stored review_id + file_id,
//      issue a server-only read-only GET to
//         /reviews/{review_id}/files/{review_file_id}
//      using the same ReviewStudio credentials the upload function
//      uses. NEVER accepts review_id / file_id from the browser.
//
//   2. Classify the response as one of:
//        - "present":       resource exists (HTTP 200 + valid body)
//        - "missing":       resource is confirmed gone (HTTP 404/410,
//                           or RS body { errors: [...] } indicating
//                           the resource is deleted / not found)
//        - "indeterminate": anything else — network error, timeout,
//                           401/403/429, 5xx, malformed body. These
//                           MUST NOT be treated as proof of deletion.
//                           The point is: only confirmed-missing
//                           invalidates the mapping.
//
//   3. For each row classified "missing":
//        - set is_latest=false      (loader filter excludes it)
//        - write metadata.reconciliation_reason="externally_missing"
//        - write metadata.reconciled_at=<iso>
//        - leave replaced_by_file_id NULL (this was not a
//          replacement; it was an external deletion)
//        - do NOT hard-delete
//        - do NOT touch the historical row beyond the metadata patch
//          (reviewstudio_response is preserved)
//
//   4. For each row classified "present" or "indeterminate":
//        - leave the row untouched
//
//   5. The verified subset is the rows still is_latest=true after
//      the updates. The caller returns that subset to the employee
//      page; nothing more.
//
// Failure cases:
//   - If a per-row update fails (e.g. transient DB error), the
//     row stays untouched and is still considered verified-current
//     for this load. We do NOT mark a row stale based on a DB
//     write failure.
// ============================================================

export type ReviewStudioAuthHeaders = {
  "X-REVIEWSTUDIO-EMAIL": string;
  "X-REVIEWSTUDIO-TOKEN": string;
  "Content-Type": string;
  Accept: string;
};

export type SupabaseLike = {
  from: (table: string) => any;
};

export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string> },
) => Promise<{
  status: number;
  ok: boolean;
  text: () => Promise<string>;
}>;

export type ReconcileInputRow = {
  id: string;
  book_id: string;
  file_type?: string | null;
  file_kind?: string | null;
  reviewstudio_review_id?: string | null;
  reviewstudio_file_id?: string | null;
  reviewstudio_project_id?: string | null;
  reviewstudio_client_id?: string | null;
  metadata?: Record<string, unknown> | null;
};

export type ReconcileResult = {
  // The rows that remain is_latest=true after the reconciliation pass.
  // This is what the caller should return to the employee page.
  verified: ReconcileInputRow[];
  // Rows that were confirmed missing and marked stale. Surfaced for
  // logging / audit; the caller does not return these.
  marked_stale: Array<{ id: string; review_id: string; review_file_id: string; reason: string }>;
  // Per-row classification counts (no PII, no RS ids leaked).
  counts: { present: number; missing: number; indeterminate: number; skipped: number };
};

const MAX_PARALLEL = 4;
const FETCH_TIMEOUT_MS = 8000;

function rsUrl(base: string, path: string): string {
  const cleanBase = base.replace(/\/+$/, "");
  const cleanPath = String(path || "").startsWith("/") ? path : "/" + path;
  return cleanBase + cleanPath;
}

function isManuscriptOrCover(input: ReconcileInputRow): boolean {
  const ft = String(input.file_type || "").toLowerCase();
  const fk = String(input.file_kind || "").toLowerCase();
  return ft === "manuscript" || ft === "cover" || fk === "manuscript" || fk === "cover";
}

function hasReusableIds(input: ReconcileInputRow): boolean {
  return !!(input.reviewstudio_review_id && input.reviewstudio_file_id);
}

type Classification = "present" | "missing" | "indeterminate";

function classifyRsGetResponse(status: number, bodyText: string, expectedId: string): Classification {
  if (status === 200) {
    if (!bodyText) return "indeterminate";
    // RS sometimes returns 200 with an errors object for a deleted
    // resource; treat that as "missing" only if the body explicitly
    // indicates "not found" / "deleted".
    if (bodyText) {
      try {
        const data = JSON.parse(bodyText);
        if (data && typeof data === "object" && !Array.isArray(data)) {
          const errs = (data as any).errors || (data as any).error;
          if (errs) {
            const txt = typeof errs === "string" ? errs : JSON.stringify(errs);
            if (/not\s*found|deleted|missing/i.test(txt)) {
              return "missing";
            }
            // Some RS error bodies don't include "not found" wording
            // but still indicate an error; treat as indeterminate to
            // avoid false-positive stale marking.
            return "indeterminate";
          }
          const entity = (data as any).data && typeof (data as any).data === "object"
            ? (data as any).data
            : data;
          const id = entity.id || entity.review_file?.id;
          if (!id || String(id) !== String(expectedId)) return "indeterminate";
        } else {
          return "indeterminate";
        }
      } catch (_e) {
        // Malformed body — indeterminate.
        return "indeterminate";
      }
    }
    return "present";
  }
  if (status === 404 || status === 410) return "missing";
  return "indeterminate";
}

async function fetchWithTimeout(
  fetchImpl: FetchLike,
  url: string,
  init: { method: string; headers: Record<string, string> },
  timeoutMs: number,
): Promise<{ status: number; ok: boolean; text: () => Promise<string> }> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error("RS GET timed out after " + timeoutMs + "ms"));
    }, timeoutMs);
    fetchImpl(url, init)
      .then((res) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(res);
      })
      .catch((err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err);
      });
  });
}

async function verifyRow(
  row: ReconcileInputRow,
  fetchImpl: FetchLike,
  rsBaseUrl: string,
  rsHeaders: ReviewStudioAuthHeaders,
): Promise<Classification> {
  const url = rsUrl(
    rsBaseUrl,
    "/reviews/" +
      encodeURIComponent(String(row.reviewstudio_review_id)) +
      "/files/" +
      encodeURIComponent(String(row.reviewstudio_file_id)),
  );
  let res: { status: number; ok: boolean; text: () => Promise<string> };
  try {
    res = await fetchWithTimeout(
      fetchImpl,
      url,
      { method: "GET", headers: { ...rsHeaders } },
      FETCH_TIMEOUT_MS,
    );
  } catch (_e) {
    return "indeterminate";
  }
  let bodyText = "";
  try {
    bodyText = await res.text();
  } catch (_e) {
    // Body unreadable — use status alone.
  }
  return classifyRsGetResponse(
    res.status,
    bodyText,
    String(row.reviewstudio_file_id || ""),
  );
}

async function markRowStale(
  supabase: SupabaseLike,
  row: ReconcileInputRow,
  reason: string,
  nowIso: string,
): Promise<{ ok: boolean; error?: string }> {
  const existingMetadata =
    row.metadata && typeof row.metadata === "object" ? { ...row.metadata } : {};
  const nextMetadata = Object.assign({}, existingMetadata, {
    reconciliation_reason: reason,
    reconciled_at: nowIso,
  });
  try {
    const { error } = await supabase
      .from("book_files")
      .update({
        is_latest: false,
        // replaced_by_file_id is intentionally NOT set: an external
        // deletion is not a replacement.
        metadata: nextMetadata,
      })
      .eq("id", row.id);
    if (error) {
      return { ok: false, error: error.message || String(error) };
    }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}

async function runWithLimit<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, idx: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const idx = next;
      next += 1;
      if (idx >= items.length) return;
      out[idx] = await worker(items[idx], idx);
    }
  });
  await Promise.all(runners);
  return out;
}

export async function reconcileBookFiles(input: {
  rows: ReconcileInputRow[];
  supabase: SupabaseLike;
  fetchImpl: FetchLike;
  rsBaseUrl: string;
  rsHeaders: ReviewStudioAuthHeaders;
}): Promise<ReconcileResult> {
  const counts = { present: 0, missing: 0, indeterminate: 0, skipped: 0 };
  const marked_stale: ReconcileResult["marked_stale"] = [];

  // Step 1: filter to rows that actually need verification.
  const candidates = input.rows.filter(
    (r) => isManuscriptOrCover(r) && hasReusableIds(r),
  );
  // Rows that don't need verification stay verified as-is.
  for (const r of input.rows) {
    if (!candidates.includes(r)) counts.skipped += 1;
  }

  // Step 2: classify every candidate in parallel (bounded).
  const classifications = await runWithLimit(candidates, MAX_PARALLEL, (row) =>
    verifyRow(row, input.fetchImpl, input.rsBaseUrl, input.rsHeaders),
  );

  // Step 3: for each candidate, persist the update if missing, otherwise leave.
  const nowIso = new Date().toISOString();
  const finalClassification: Array<Classification> = new Array(candidates.length);
  await runWithLimit(candidates, MAX_PARALLEL, async (row, i) => {
    const cls = classifications[i];
    if (cls === "missing") {
      const r = await markRowStale(
        input.supabase,
        row,
        "externally_missing",
        nowIso,
      );
      if (r.ok) {
        counts.missing += 1;
        marked_stale.push({
          id: row.id,
          review_id: String(row.reviewstudio_review_id || ""),
          review_file_id: String(row.reviewstudio_file_id || ""),
          reason: "externally_missing",
        });
        finalClassification[i] = "missing";
      } else {
        // DB write failed — keep the row verified-current for this load
        // (do NOT mark stale based on a transient DB error).
        counts.indeterminate += 1;
        finalClassification[i] = "indeterminate";
      }
    } else if (cls === "present") {
      counts.present += 1;
      finalClassification[i] = "present";
    } else {
      counts.indeterminate += 1;
      finalClassification[i] = "indeterminate";
    }
  });

  // Step 4: build the verified subset. A row is verified if it was
  // not a candidate, OR if its final classification is "present" or
  // "indeterminate" (indeterminate means we couldn't confirm missing,
  // so we keep it).
  const verified: ReconcileInputRow[] = [];
  for (let i = 0; i < candidates.length; i += 1) {
    if (finalClassification[i] === "missing") continue;
    verified.push(candidates[i]);
  }
  // Append non-candidate rows (e.g. pricing files if any ever leak in).
  for (const r of input.rows) {
    if (!candidates.includes(r)) verified.push(r);
  }

  return { verified, marked_stale, counts };
}
