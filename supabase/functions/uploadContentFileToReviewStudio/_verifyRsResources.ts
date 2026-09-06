// ============================================================
// ReviewStudio resource existence verifier — pure orchestration
// module.
//
// Used by the first-time upload path of
// uploadContentFileToReviewStudio to decide whether a stored
// project_id / review_id from a previous book_files row is still
// safe to reuse, or whether the operator has externally deleted the
// resource in ReviewStudio.
//
// Same classification rules as _reconcile.ts:
//
//   "present":       200 + valid body without a not-found /
//                    deleted / missing errors object
//   "missing":       404, 410, or 200 with an errors object whose
//                    text matches /not\s*found|deleted|missing/i
//   "indeterminate": network error, timeout, 401/403/429, 5xx,
//                    malformed body, or 200 with a generic errors
//                    object
//
// Inputs are passed in (no module-level state, no Deno globals)
// so the verifier can be unit-tested in pure Node.
// ============================================================

export type ReviewStudioAuthHeaders = {
  "X-REVIEWSTUDIO-EMAIL": string;
  "X-REVIEWSTUDIO-TOKEN": string;
  "Content-Type": string;
  Accept: string;
};

export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string> },
) => Promise<{
  status: number;
  ok: boolean;
  text: () => Promise<string>;
}>;

export type VerifierClassification =
  | "present"
  | "missing"
  | "indeterminate";

export type VerifierCandidate = {
  projectId?: string;
  reviewId?: string;
};

export type VerifiedRsContext = {
  // The same candidate echoed back, but with any confirmed-missing
  // id blanked. The caller treats blank as "do not reuse; create
  // new".
  projectId: string;
  reviewId: string;
  // Per-resource classification. "skipped" means the input was
  // empty so no check was made.
  projectStatus: VerifierClassification | "skipped";
  reviewStatus: VerifierClassification | "skipped";
  // True iff at least one resource is indeterminate. The caller
  // must fail the upload with a 502 in that case: creating a new
  // project / review on indeterminate state could produce a
  // duplicate, and reusing a stale id is unsafe.
  anyIndeterminate: boolean;
};

const FETCH_TIMEOUT_MS = 8000;

function rsUrl(base: string, path: string): string {
  const cleanBase = base.replace(/\/+$/, "");
  const cleanPath = String(path || "").startsWith("/") ? path : "/" + path;
  return cleanBase + cleanPath;
}

function classifyRsGetResponse(
  status: number,
  bodyText: string,
): VerifierClassification {
  if (status === 200) {
    if (bodyText) {
      try {
        const data = JSON.parse(bodyText);
        if (data && typeof data === "object") {
          const errs = (data as any).errors || (data as any).error;
          if (errs) {
            const txt = typeof errs === "string" ? errs : JSON.stringify(errs);
            if (/not\s*found|deleted|missing/i.test(txt)) {
              return "missing";
            }
            // Generic error body without a "not found" signature
            // is treated as indeterminate to avoid falsely
            // invalidating a stored id.
            return "indeterminate";
          }
        }
      } catch (_e) {
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

async function verifyOne(
  fetchImpl: FetchLike,
  rsBaseUrl: string,
  rsHeaders: ReviewStudioAuthHeaders,
  resource: "projects" | "reviews",
  id: string,
): Promise<VerifierClassification> {
  const url = rsUrl(
    rsBaseUrl,
    "/" + resource + "/" + encodeURIComponent(String(id)),
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
  return classifyRsGetResponse(res.status, bodyText);
}

export async function verifyReviewStudioResources(input: {
  candidate: VerifierCandidate;
  fetchImpl: FetchLike;
  rsBaseUrl: string;
  rsHeaders: ReviewStudioAuthHeaders;
}): Promise<VerifiedRsContext> {
  const candidateProjectId = String(input.candidate?.projectId || "").trim();
  const candidateReviewId = String(input.candidate?.reviewId || "").trim();

  // Run both checks in parallel when both ids are present.
  const tasks: Array<Promise<VerifierClassification>> = [];
  const projectPromise = candidateProjectId
    ? verifyOne(
        input.fetchImpl,
        input.rsBaseUrl,
        input.rsHeaders,
        "projects",
        candidateProjectId,
      )
    : Promise.resolve<VerifierClassification>("present");
  const reviewPromise = candidateReviewId
    ? verifyOne(
        input.fetchImpl,
        input.rsBaseUrl,
        input.rsHeaders,
        "reviews",
        candidateReviewId,
      )
    : Promise.resolve<VerifierClassification>("present");
  tasks.push(projectPromise, reviewPromise);
  const [projectStatus, reviewStatus] = await Promise.all(tasks);

  // Only confirmed-present ids are safe to reuse. Confirmed-missing
  // ids are blanked so the caller takes the create-new path.
  // Indeterminate ids are preserved because the caller (via
  // anyIndeterminate) is required to throw 502 and never use them.
  const verifiedProjectId = projectStatus === "present"
    ? candidateProjectId
    : projectStatus === "missing"
      ? ""
      : candidateProjectId;
  const verifiedReviewId = reviewStatus === "present"
    ? candidateReviewId
    : reviewStatus === "missing"
      ? ""
      : candidateReviewId;

  const anyIndeterminate =
    projectStatus === "indeterminate" || reviewStatus === "indeterminate";

  return {
    projectId: verifiedProjectId,
    reviewId: verifiedReviewId,
    projectStatus: candidateProjectId ? projectStatus : "skipped",
    reviewStatus: candidateReviewId ? reviewStatus : "skipped",
    anyIndeterminate,
  };
}
