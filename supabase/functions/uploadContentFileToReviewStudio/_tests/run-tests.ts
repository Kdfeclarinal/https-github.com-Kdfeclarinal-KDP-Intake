// ============================================================
// Repo-contained test harness for uploadContentFileToReviewStudio
// orchestration modules.
//
// Strategy: zero-dependency, pure-Node test runner that loads the
// three pure orchestration modules (_replaceOrchestration,
// _verifyRsResources, _reconcile) and exercises the failure paths
// the file replacement / reconciliation contract must guarantee.
//
// Run with: node --experimental-strip-types _tests/run-tests.ts
//
// The harness uses Node >= 22.6's TS type-stripping (no tsx/ts-node
// needed, no compile step, no Deno runtime required).
// ============================================================

process.stderr.write("[kdp-tests] module loaded\n");

import { replaceContentFile } from "../_replaceOrchestration.ts";
import { verifyReviewStudioResources } from "../_verifyRsResources.ts";
import { reconcileBookFiles } from "../_reconcile.ts";

// ---------------------- minimal test framework ----------------------

type TestFn = () => Promise<void> | void;

interface Test {
  name: string;
  fn: TestFn;
}

const tests: Test[] = [];

function test(name: string, fn: TestFn) {
  tests.push({ name, fn });
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error("ASSERT: " + msg);
}

function assertEq<T>(actual: T, expected: T, msg: string) {
  if (!Object.is(actual, expected)) {
    throw new Error(
      "ASSERT_EQ: " + msg + " (expected " + JSON.stringify(expected) + ", got " + JSON.stringify(actual) + ")",
    );
  }
}

function deepIncludes(haystack: unknown, needle: Record<string, unknown>, msg: string) {
  if (!haystack || typeof haystack !== "object") {
    throw new Error("DEEP_INCLUDES: " + msg + " (haystack is not an object)");
  }
  for (const [k, v] of Object.entries(needle)) {
    const actual = (haystack as Record<string, unknown>)[k];
    if (actual !== v) {
      throw new Error(
        "DEEP_INCLUDES: " + msg + " (key " + k + ": expected " + JSON.stringify(v) + ", got " + JSON.stringify(actual) + ")",
      );
    }
  }
}

// ---------------------- test fakes ----------------------

function makeSupabase(opts: {
  currentRow?: { id: string; reviewstudio_review_id: string; reviewstudio_file_id: string; reviewstudio_project_id: string } | null;
  insertError?: { message: string };
  supersedeError?: { message: string };
  promotionResult?: boolean;
  tempUploadError?: { message: string };
  signedUrlError?: { message: string };
} = {}) {
  const calls: { method: string; table?: string; payload?: unknown }[] = [];

  const supabase = {
    async rpc(name: string, payload: unknown) {
      calls.push({ method: "rpc", table: name, payload });
      if (opts.supersedeError) return { data: null, error: opts.supersedeError };
      return { data: opts.promotionResult ?? true, error: null };
    },
    from(table: string) {
      return {
        select() {
          return {
            eq() {
              return {
                eq() {
                  return {
                    eq() {
                      return {
                        eq() {
                          return {
                            limit() {
                              return {
                                async maybeSingle() {
                                  calls.push({ method: "select-current", table });
                                  if (opts.currentRow === undefined) {
                                    return { data: { id: "row-old", reviewstudio_review_id: "rev-1", reviewstudio_file_id: "file-old", reviewstudio_project_id: "proj-1" }, error: null };
                                  }
                                  if (opts.currentRow === null) return { data: null, error: null };
                                  return { data: opts.currentRow, error: null };
                                },
                              };
                            },
                          };
                        },
                      };
                    },
                  };
                },
              };
            },
          };
        },
        insert(payload: unknown) {
          calls.push({ method: "insert", table, payload });
          const self = {
            select() {
              return {
                async single() {
                  if (opts.insertError) return { data: null, error: opts.insertError };
                  return { data: { id: "row-new" }, error: null };
                },
              };
            },
          };
          return self;
        },
        update(payload: unknown) {
          calls.push({ method: "update", table, payload });
          const self = {
            eq(_col: string, _val: unknown) {
              // Return a REAL promise so `await ...update({...}).eq('id', id)`
              // settles. A thenable whose `then()` returns a value but never
              // calls resolve/reject would hang the await forever.
              if (opts.supersedeError) {
                return Promise.reject(new Error(opts.supersedeError.message));
              }
              return Promise.resolve({ data: null, error: null });
            },
          };
          // Support `await supabase.from('book_files').update({...}).eq('id', id)`
          return self;
        },
      };
    },
    storage: {
      from(_bucket: string) {
        return {
          async upload(_path: string, _bytes: ArrayBuffer, _opts: unknown) {
            if (opts.tempUploadError) return { error: opts.tempUploadError };
            return { error: null };
          },
          async createSignedUrl(_path: string, _ttl: number) {
            if (opts.signedUrlError) return { data: null, error: opts.signedUrlError };
            return { data: { signedUrl: "https://temp.example/upload?signed" }, error: null };
          },
        };
      },
    },
  };

  return { supabase, calls };
}

function makeFetch(responses: Array<{ status: number; body?: any; ok?: boolean; throw?: Error }>) {
  let i = 0;
  const seen: { url: string; method: string; headers: Record<string, string>; body?: string }[] = [];
  const fn: any = async (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => {
    seen.push({ url, method: init.method, headers: init.headers, body: init.body });
    const r = responses[i++];
    if (!r) throw new Error("fetch: no more canned responses for call " + i);
    if (r.throw) throw r.throw;
    const body = r.body === undefined ? "" : (typeof r.body === "string" ? r.body : JSON.stringify(r.body));
    return {
      status: r.status,
      ok: r.ok ?? (r.status >= 200 && r.status < 300),
      async text() { return body; },
    };
  };
  return { fetchImpl: fn, seen };
}

const RS_HEADERS = {
  "X-REVIEWSTUDIO-EMAIL": "t@example.com",
  "X-REVIEWSTUDIO-TOKEN": "tok",
  "Content-Type": "application/json",
  Accept: "application/json",
};

const BASE_URL = "https://iwdnow.reviewstudio.com";

const INPUT_BASE = {
  bookId: "book-1",
  fileType: "manuscript" as const,
  sectionKey: "content.manuscript",
  file: { name: "manuscript.pdf", type: "application/pdf", size: 1024, async arrayBuffer() { return new Uint8Array([1, 2, 3]).buffer as ArrayBuffer; } },
  tempBucket: "reviewstudio-temp",
  rsBaseUrl: BASE_URL,
  rsHeaders: RS_HEADERS,
};

// ============================================================
// replaceContentFile — failure-path tests
// ============================================================

test("replace: happy path returns ok with new ids and cleanup_pending undefined when DELETE 204", async () => {
  const { supabase, calls } = makeSupabase();
  const { fetchImpl, seen } = makeFetch([
    { status: 201, body: { id: "file-new", review_url: "https://reviewstudio.example/file-new", processing_status: "ok" } },
    { status: 204 },
  ]);
  const result = await replaceContentFile({ ...INPUT_BASE, supabase, fetchImpl });
  assertEq(result.ok, true, "ok should be true");
  if (!result.ok) return;
  assertEq(result.book_file_id, "row-new", "new book_file_id");
  assertEq(result.reviewstudio_file_id, "file-new", "new RS file id");
  assertEq(result.reviewstudio_review_id, "rev-1", "review id preserved");
  assertEq(result.replaced_old_review_file_id, "file-old", "old file id echoed");
  assertEq(result.cleanup_pending, undefined, "no cleanup_pending on 204");
  // POST went to /reviews/rev-1/files with order=0 for manuscript
  assert(seen.length === 2, "two HTTP calls (POST + DELETE)");
  assert(seen[0].url === BASE_URL + "/reviews/rev-1/files", "POST url");
  assert(seen[1].url === BASE_URL + "/reviews/rev-1/files/file-old", "DELETE url targets old file");
  assert(seen[1].method === "DELETE", "DELETE method");
  const insert = calls.find((call) => call.method === "insert") as any;
  assertEq(insert?.payload?.is_latest, false, "new row is staged non-current");
  assert(calls.some((call) => call.method === "rpc" && call.table === "promote_replacement_book_file"), "transactional promotion RPC called");
});

test("replace: concurrent promotion conflict fails without deleting old RS file", async () => {
  const { supabase } = makeSupabase({ promotionResult: false });
  const { fetchImpl, seen } = makeFetch([
    { status: 201, body: { id: "file-new", review_url: "https://rs.example/new" } },
  ]);
  const result = await replaceContentFile({ ...INPUT_BASE, supabase, fetchImpl });
  assertEq(result.ok, false, "promotion conflict fails");
  assertEq(seen.length, 1, "old RS file is not deleted");
});

test("replace: no current row -> 409 with descriptive error, no RS call", async () => {
  const { supabase } = makeSupabase({ currentRow: null });
  const { fetchImpl, seen } = makeFetch([]);
  const result = await replaceContentFile({ ...INPUT_BASE, supabase, fetchImpl });
  assertEq(result.ok, false, "ok should be false");
  if (result.ok) return;
  assertEq(result.status, 409, "status 409 for no-current-row");
  assert(/No current book_files row/.test(result.error), "error message references missing row");
  assertEq(seen.length, 0, "no HTTP calls when no current row");
});

test("replace: RS POST 5xx -> Case A (502), no DB write, no DELETE", async () => {
  const { supabase, calls } = makeSupabase();
  const { fetchImpl, seen } = makeFetch([
    { status: 503, body: { errors: "upstream" } },
  ]);
  const result = await replaceContentFile({ ...INPUT_BASE, supabase, fetchImpl });
  assertEq(result.ok, false, "ok false");
  if (result.ok) return;
  assertEq(result.status, 502, "502 on RS POST 5xx");
  assert(/ReviewStudio did not accept/.test(result.error), "error names ReviewStudio");
  assertEq(seen.length, 1, "only one HTTP call (POST)");
  assertEq(calls.find((c) => c.method === "insert"), undefined, "no insert attempted");
  assertEq(calls.find((c) => c.method === "update"), undefined, "no supersede update attempted");
});

test("replace: temp upload error -> 502, no RS call, no DB write", async () => {
  const { supabase, calls } = makeSupabase({ tempUploadError: { message: "bucket offline" } });
  const { fetchImpl, seen } = makeFetch([]);
  const result = await replaceContentFile({ ...INPUT_BASE, supabase, fetchImpl });
  assertEq(result.ok, false, "ok false");
  if (result.ok) return;
  assertEq(result.status, 502, "502 on temp upload error");
  assert(/bucket offline/.test(result.error), "error includes underlying temp failure");
  assertEq(seen.length, 0, "no HTTP calls when temp upload fails");
  assertEq(calls.find((c) => c.method === "insert"), undefined, "no insert");
});

test("replace: DB INSERT fails after successful POST -> 500 with orphan_cleanup attempted", async () => {
  const { supabase } = makeSupabase({ insertError: { message: "duplicate key" } });
  const { fetchImpl, seen } = makeFetch([
    { status: 201, body: { id: "file-new", review_url: "https://rs.example/new" } },
    // attempted orphan cleanup DELETE
    { status: 204 },
  ]);
  const result = await replaceContentFile({ ...INPUT_BASE, supabase, fetchImpl });
  assertEq(result.ok, false, "ok false");
  if (result.ok) return;
  assertEq(result.status, 500, "500 on insert failure");
  assert(result.orphan_cleanup, "orphan_cleanup present");
  assertEq(result.orphan_cleanup?.attempted, true, "orphan_cleanup.attempted=true");
  assertEq(result.orphan_cleanup?.rs_delete_ok, true, "orphan_cleanup.rs_delete_ok true");
  assertEq(result.orphan_cleanup?.rs_delete_status, 204, "orphan_cleanup.rs_delete_status=204");
  // DELETE was attempted against the JUST-CREATED file id (not the old one)
  assertEq(seen[1].url, BASE_URL + "/reviews/rev-1/files/file-new", "DELETE targets the orphan new file");
  // Supersede MUST NOT have been attempted
  assert(!seen[2], "no third HTTP call (no DELETE against old file)");
});

test("replace: supersede UPDATE fails -> 500 with requires_reconciliation containing all four ids", async () => {
  const { supabase } = makeSupabase({ supersedeError: { message: "lock timeout" } });
  const { fetchImpl, seen } = makeFetch([
    { status: 201, body: { id: "file-new", review_url: "https://rs.example/new" } },
    // The flow does NOT attempt the old RS DELETE on supersede failure.
  ]);
  const result = await replaceContentFile({ ...INPUT_BASE, supabase, fetchImpl });
  assertEq(result.ok, false, "ok false");
  if (result.ok) return;
  assertEq(result.status, 500, "500 on supersede failure");
  assert(result.requires_reconciliation, "requires_reconciliation present");
  deepIncludes(
    result.requires_reconciliation,
    {
      new_book_file_id: "row-new",
      new_review_file_id: "file-new",
      old_book_file_id: "row-old",
      old_review_file_id: "file-old",
      review_id: "rev-1",
    },
    "requires_reconciliation ids",
  );
  assert(/lock timeout/.test(result.requires_reconciliation?.reason || ""), "reason includes underlying error");
  // Critical: only 1 HTTP call (POST), no DELETE attempted against the old RS file.
  assertEq(seen.length, 1, "no DELETE attempted on old file (would worsen orphan)");
});

test("replace: RS DELETE 5xx after successful insert+supersede -> ok=true with cleanup_pending", async () => {
  const { supabase } = makeSupabase();
  const { fetchImpl } = makeFetch([
    { status: 201, body: { id: "file-new", review_url: "https://rs.example/new" } },
    { status: 500, body: { errors: "internal" } },
  ]);
  const result = await replaceContentFile({ ...INPUT_BASE, supabase, fetchImpl });
  assertEq(result.ok, true, "ok true — new file is authoritative");
  if (!result.ok) return;
  assert(result.cleanup_pending, "cleanup_pending present");
  assertEq(result.cleanup_pending?.old_review_file_id, "file-old", "cleanup_pending targets the OLD file");
  assert(/500/.test(result.cleanup_pending?.reason || ""), "reason mentions status 500");
  assertEq(result.replaced_old_review_file_id, "file-old", "replaced_old_review_file_id echoed");
});

test("replace: RS DELETE 404 after successful insert+supersede -> ok=true with NO cleanup_pending (Case D)", async () => {
  const { supabase } = makeSupabase();
  const { fetchImpl } = makeFetch([
    { status: 201, body: { id: "file-new", review_url: "https://rs.example/new" } },
    { status: 404 },
  ]);
  const result = await replaceContentFile({ ...INPUT_BASE, supabase, fetchImpl });
  assertEq(result.ok, true, "ok true");
  if (!result.ok) return;
  assertEq(result.cleanup_pending, undefined, "404 is treated as success (Case D)");
});

test("replace: RS DELETE network throw -> ok=true with cleanup_pending", async () => {
  const { supabase } = makeSupabase();
  const { fetchImpl } = makeFetch([
    { status: 201, body: { id: "file-new", review_url: "https://rs.example/new" } },
    { throw: new Error("ECONNRESET") },
  ]);
  const result = await replaceContentFile({ ...INPUT_BASE, supabase, fetchImpl });
  assertEq(result.ok, true, "ok true");
  if (!result.ok) return;
  assert(result.cleanup_pending, "cleanup_pending present on network error");
  assert(/ECONNRESET/.test(result.cleanup_pending?.reason || ""), "reason mentions ECONNRESET");
});

test("replace: POST 201 without review_file id -> 502 (contract drift), no insert", async () => {
  const { supabase, calls } = makeSupabase();
  const { fetchImpl } = makeFetch([
    { status: 201, body: { review_url: "https://rs.example/missing-id" } },
  ]);
  const result = await replaceContentFile({ ...INPUT_BASE, supabase, fetchImpl });
  assertEq(result.ok, false, "ok false");
  if (result.ok) return;
  assertEq(result.status, 502, "502 on missing review_file id");
  assert(/did not return a review file ID/.test(result.error), "error names missing id");
  assertEq(calls.find((c) => c.method === "insert"), undefined, "no insert");
});

// ============================================================
// verifyReviewStudioResources — classification tests
// ============================================================

test("verifier: 200 valid body -> present, ids preserved, anyIndeterminate=false", async () => {
  const { fetchImpl } = makeFetch([
    { status: 200, body: { id: "proj-1" } },
    { status: 200, body: { id: "rev-1", project: { id: "proj-1" } } },
  ]);
  const r = await verifyReviewStudioResources({ candidate: { projectId: "proj-1", reviewId: "rev-1" }, fetchImpl, rsBaseUrl: BASE_URL, rsHeaders: RS_HEADERS });
  assertEq(r.projectId, "proj-1", "projectId preserved");
  assertEq(r.reviewId, "rev-1", "reviewId preserved");
  assertEq(r.projectStatus, "present", "project present");
  assertEq(r.reviewStatus, "present", "review present");
  assertEq(r.anyIndeterminate, false, "no indeterminate");
});

test("verifier: 404 -> missing, id blanked, anyIndeterminate=false", async () => {
  const { fetchImpl } = makeFetch([
    { status: 404 },
    { status: 404 },
  ]);
  const r = await verifyReviewStudioResources({ candidate: { projectId: "proj-x", reviewId: "rev-x" }, fetchImpl, rsBaseUrl: BASE_URL, rsHeaders: RS_HEADERS });
  assertEq(r.projectId, "", "projectId blanked");
  assertEq(r.reviewId, "", "reviewId blanked");
  assertEq(r.projectStatus, "missing", "project missing");
  assertEq(r.reviewStatus, "missing", "review missing");
  assertEq(r.anyIndeterminate, false, "no indeterminate (both are confirmed missing)");
});

test("verifier: 410 -> missing", async () => {
  const { fetchImpl } = makeFetch([
    { status: 410 },
    { status: 200, body: { id: "rev-1" } },
  ]);
  const r = await verifyReviewStudioResources({ candidate: { projectId: "proj-x", reviewId: "rev-1" }, fetchImpl, rsBaseUrl: BASE_URL, rsHeaders: RS_HEADERS });
  assertEq(r.projectId, "", "410 -> missing -> blanked");
  assertEq(r.reviewId, "rev-1", "id retained only for fail-closed diagnostics");
  assertEq(r.projectStatus, "missing", "missing");
  assertEq(r.reviewStatus, "indeterminate", "review cannot be reused without its project");
  assertEq(r.anyIndeterminate, true, "split pair fails closed");
});

test("verifier: 200 with errors object containing 'not found' -> missing", async () => {
  const { fetchImpl } = makeFetch([
    { status: 200, body: { errors: [{ message: "Project not found" }] } },
    { status: 200, body: { id: "rev-1" } },
  ]);
  const r = await verifyReviewStudioResources({ candidate: { projectId: "proj-x", reviewId: "rev-1" }, fetchImpl, rsBaseUrl: BASE_URL, rsHeaders: RS_HEADERS });
  assertEq(r.projectId, "", "blanked");
  assertEq(r.projectStatus, "missing", "classified missing");
  assertEq(r.reviewStatus, "indeterminate", "review cannot be reused without its project");
  assertEq(r.anyIndeterminate, true, "split pair fails closed");
});

test("verifier: 200 with generic errors object -> indeterminate, id preserved, anyIndeterminate=true", async () => {
  const { fetchImpl } = makeFetch([
    { status: 200, body: { errors: [{ message: "Server hiccup" }] } },
    { status: 200, body: { id: "rev-1" } },
  ]);
  const r = await verifyReviewStudioResources({ candidate: { projectId: "proj-x", reviewId: "rev-1" }, fetchImpl, rsBaseUrl: BASE_URL, rsHeaders: RS_HEADERS });
  // Generic errors do not match "not found|deleted|missing", so indeterminate.
  assertEq(r.projectStatus, "indeterminate", "project indeterminate");
  assertEq(r.projectId, "proj-x", "id preserved when indeterminate");
  assertEq(r.anyIndeterminate, true, "anyIndeterminate=true -> caller must 502");
});

test("verifier: 401 -> indeterminate, anyIndeterminate=true", async () => {
  const { fetchImpl } = makeFetch([{ status: 401 }, { status: 401 }]);
  const r = await verifyReviewStudioResources({ candidate: { projectId: "proj-x", reviewId: "rev-x" }, fetchImpl, rsBaseUrl: BASE_URL, rsHeaders: RS_HEADERS });
  assertEq(r.projectStatus, "indeterminate", "401 indeterminate");
  assertEq(r.reviewStatus, "indeterminate", "401 indeterminate");
  assertEq(r.anyIndeterminate, true, "anyIndeterminate=true");
  assertEq(r.projectId, "proj-x", "id preserved (caller must fail with 502, not reuse)");
});

test("verifier: 429 -> indeterminate", async () => {
  const { fetchImpl } = makeFetch([{ status: 429 }, { status: 200, body: { id: "rev-1" } }]);
  const r = await verifyReviewStudioResources({ candidate: { projectId: "proj-x", reviewId: "rev-1" }, fetchImpl, rsBaseUrl: BASE_URL, rsHeaders: RS_HEADERS });
  assertEq(r.projectStatus, "indeterminate", "429 indeterminate");
  assertEq(r.anyIndeterminate, true, "anyIndeterminate=true");
});

test("verifier: 5xx -> indeterminate", async () => {
  const { fetchImpl } = makeFetch([{ status: 500 }, { status: 500 }]);
  const r = await verifyReviewStudioResources({ candidate: { projectId: "proj-x", reviewId: "rev-x" }, fetchImpl, rsBaseUrl: BASE_URL, rsHeaders: RS_HEADERS });
  assertEq(r.projectStatus, "indeterminate", "5xx indeterminate");
  assertEq(r.reviewStatus, "indeterminate", "5xx indeterminate");
  assertEq(r.anyIndeterminate, true, "anyIndeterminate=true");
});

test("verifier: fetch throws -> both indeterminate", async () => {
  const fetchImpl: any = async () => { throw new Error("DNS failure"); };
  const r = await verifyReviewStudioResources({ candidate: { projectId: "proj-x", reviewId: "rev-x" }, fetchImpl, rsBaseUrl: BASE_URL, rsHeaders: RS_HEADERS });
  assertEq(r.projectStatus, "indeterminate", "fetch throw -> indeterminate");
  assertEq(r.reviewStatus, "indeterminate", "fetch throw -> indeterminate");
  assertEq(r.anyIndeterminate, true, "anyIndeterminate=true");
});

test("verifier: empty candidate -> both skipped, anyIndeterminate=false", async () => {
  const { fetchImpl, seen } = makeFetch([]);
  const r = await verifyReviewStudioResources({ candidate: {}, fetchImpl, rsBaseUrl: BASE_URL, rsHeaders: RS_HEADERS });
  assertEq(r.projectId, "", "no projectId");
  assertEq(r.reviewId, "", "no reviewId");
  assertEq(r.projectStatus, "skipped", "skipped");
  assertEq(r.reviewStatus, "skipped", "skipped");
  assertEq(r.anyIndeterminate, false, "no indeterminate");
  assertEq(seen.length, 0, "no HTTP calls when both ids empty");
});

test("verifier: 200 with malformed body -> indeterminate", async () => {
  const { fetchImpl } = makeFetch([
    { status: 200, body: "this is not json{" },
  ]);
  const r = await verifyReviewStudioResources({ candidate: { projectId: "proj-x" }, fetchImpl, rsBaseUrl: BASE_URL, rsHeaders: RS_HEADERS });
  assertEq(r.projectStatus, "indeterminate", "malformed body -> indeterminate");
  assertEq(r.anyIndeterminate, true, "anyIndeterminate=true");
});

test("verifier: 200 with empty body -> indeterminate", async () => {
  const { fetchImpl } = makeFetch([{ status: 200, body: "" }]);
  const r = await verifyReviewStudioResources({ candidate: { projectId: "proj-x" }, fetchImpl, rsBaseUrl: BASE_URL, rsHeaders: RS_HEADERS });
  assertEq(r.projectStatus, "indeterminate", "empty body is not confirmation");
  assertEq(r.anyIndeterminate, true, "caller must fail closed");
});

test("verifier: review must belong to the stored project", async () => {
  const { fetchImpl } = makeFetch([
    { status: 200, body: { id: "proj-1" } },
    { status: 200, body: { id: "rev-1", project: { id: "proj-other" } } },
  ]);
  const r = await verifyReviewStudioResources({ candidate: { projectId: "proj-1", reviewId: "rev-1" }, fetchImpl, rsBaseUrl: BASE_URL, rsHeaders: RS_HEADERS });
  assertEq(r.reviewStatus, "indeterminate", "mismatched relationship is not reusable");
  assertEq(r.anyIndeterminate, true, "caller must fail closed");
});

test("verifier: present review is not reusable when its stored project is missing", async () => {
  const { fetchImpl } = makeFetch([
    { status: 404 },
    { status: 200, body: { id: "rev-1", project: { id: "proj-old" } } },
  ]);
  const r = await verifyReviewStudioResources({ candidate: { projectId: "proj-missing", reviewId: "rev-1" }, fetchImpl, rsBaseUrl: BASE_URL, rsHeaders: RS_HEADERS });
  assertEq(r.reviewStatus, "indeterminate", "orphaned pair requires operator review");
  assertEq(r.anyIndeterminate, true, "caller must not create/reuse a split pair");
});

test("verifier: lone review id is indeterminate and cannot be paired with a new project", async () => {
  const { fetchImpl } = makeFetch([
    { status: 200, body: { id: "rev-1", project: { id: "proj-old" } } },
  ]);
  const result = await verifyReviewStudioResources({
    candidate: { reviewId: "rev-1" }, fetchImpl, rsBaseUrl: BASE_URL, rsHeaders: RS_HEADERS,
  });
  assertEq(result.reviewStatus, "indeterminate", "lone review must not be reusable");
  assertEq(result.anyIndeterminate, true, "caller must fail closed");
});

// ============================================================
// reconcileBookFiles — classification & state-mutation tests
// ============================================================

// Helper: make a row that will be classified via the fetchImpl index.
//   index 0 -> project check (first RS call for any row)
//   index 1 -> review/file check (second call for any row)
// Multiple rows run in parallel via Promise.all, so we provide per-row
// pairs of responses.
function rowReconcileSupabase(opts: { dbWriteFails?: boolean; dbWrites?: any[] } = {}) {
  const updates: { id: string; payload: any }[] = [];
  const supabase: any = {
    from(_table: string) {
      return {
        update(payload: any) {
          const self = {
            eq(_col: string, val: any) {
              const id = String(val);
              if (opts.dbWriteFails) {
                return Promise.resolve({ data: null, error: { message: "db down" } });
              }
              updates.push({ id, payload });
              return Promise.resolve({ data: null, error: null });
            },
          };
          return self;
        },
      };
    },
  };
  return { supabase, updates };
}

test("reconcile: 200 with empty body is indeterminate and preserves row", async () => {
  const rows: any[] = [
    { id: "row-1", book_id: "book-1", file_type: "manuscript", reviewstudio_review_id: "rev-1", reviewstudio_file_id: "file-1", metadata: {} },
  ];
  const { supabase, updates } = rowReconcileSupabase();
  const { fetchImpl } = makeFetch([{ status: 200, body: "" }]);
  const r = await reconcileBookFiles({ rows, supabase, fetchImpl, rsBaseUrl: BASE_URL, rsHeaders: RS_HEADERS });
  assertEq(r.counts.indeterminate, 1, "empty body is indeterminate");
  assertEq(r.verified.length, 1, "row preserved on indeterminate");
  assertEq(updates.length, 0, "no stale write");
});

test("reconcile: 404 -> row marked stale, is_latest=false, reconciliation_reason set, replaced_by_file_id NOT set", async () => {
  const rows = [
    { id: "row-1", book_id: "book-1", file_type: "manuscript", file_kind: "manuscript", reviewstudio_review_id: "rev-1", reviewstudio_file_id: "file-1", reviewstudio_project_id: "proj-1", metadata: { foo: "bar" } },
  ];
  const fetchImpl: any = async () => ({ status: 404, ok: false, async text() { return ""; } });
  const { supabase, updates } = rowReconcileSupabase();
  const r = await reconcileBookFiles({ rows, supabase, fetchImpl, rsBaseUrl: BASE_URL, rsHeaders: RS_HEADERS });
  assertEq(r.counts.missing, 1, "1 missing");
  assertEq(r.counts.indeterminate, 0, "0 indeterminate");
  assertEq(r.verified.length, 0, "missing row excluded from verified");
  assertEq(r.marked_stale.length, 1, "1 marked_stale");
  assertEq(r.marked_stale[0].id, "row-1", "marked_stale id");
  assertEq(r.marked_stale[0].reason, "externally_missing", "reason");
  assertEq(updates.length, 1, "one DB update");
  assertEq(updates[0].payload.is_latest, false, "is_latest=false");
  assertEq(updates[0].payload.replaced_by_file_id, undefined, "replaced_by_file_id NOT set on external deletion");
  assert(updates[0].payload.metadata.reconciliation_reason === "externally_missing", "metadata.reconciliation_reason");
  assert(typeof updates[0].payload.metadata.reconciled_at === "string", "metadata.reconciled_at set");
  assertEq(updates[0].payload.metadata.foo, "bar", "preserves prior metadata");
});

test("reconcile: 200 valid -> row preserved in verified, no DB update", async () => {
  const rows = [
    { id: "row-1", book_id: "book-1", file_type: "manuscript", file_kind: "manuscript", reviewstudio_review_id: "rev-1", reviewstudio_file_id: "file-1", reviewstudio_project_id: "proj-1", metadata: {} },
  ];
  const fetchImpl: any = async () => ({ status: 200, ok: true, async text() { return JSON.stringify({ id: "file-1" }); } });
  const { supabase, updates } = rowReconcileSupabase();
  const r = await reconcileBookFiles({ rows, supabase, fetchImpl, rsBaseUrl: BASE_URL, rsHeaders: RS_HEADERS });
  assertEq(r.counts.present, 1, "1 present");
  assertEq(r.verified.length, 1, "verified includes the row");
  assertEq(updates.length, 0, "no DB update for present row");
});

test("reconcile: 401 -> indeterminate, row preserved, no DB update", async () => {
  const rows = [
    { id: "row-1", book_id: "book-1", file_type: "manuscript", file_kind: "manuscript", reviewstudio_review_id: "rev-1", reviewstudio_file_id: "file-1", reviewstudio_project_id: "proj-1", metadata: {} },
  ];
  const fetchImpl: any = async () => ({ status: 401, ok: false, async text() { return ""; } });
  const { supabase, updates } = rowReconcileSupabase();
  const r = await reconcileBookFiles({ rows, supabase, fetchImpl, rsBaseUrl: BASE_URL, rsHeaders: RS_HEADERS });
  assertEq(r.counts.indeterminate, 1, "1 indeterminate");
  assertEq(r.verified.length, 1, "row kept in verified (indeterminate != missing)");
  assertEq(updates.length, 0, "no DB update for indeterminate row");
});

test("reconcile: 429 / 5xx -> indeterminate, row preserved", async () => {
  const rows = [
    { id: "row-1", book_id: "book-1", file_type: "manuscript", file_kind: "manuscript", reviewstudio_review_id: "rev-1", reviewstudio_file_id: "file-1", reviewstudio_project_id: "proj-1", metadata: {} },
  ];
  for (const status of [429, 500, 502, 503]) {
    const fetchImpl: any = async () => ({ status, ok: false, async text() { return ""; } });
    const { supabase } = rowReconcileSupabase();
    const r = await reconcileBookFiles({ rows, supabase, fetchImpl, rsBaseUrl: BASE_URL, rsHeaders: RS_HEADERS });
    assertEq(r.counts.indeterminate, 1, "status " + status + " -> indeterminate");
    assertEq(r.verified.length, 1, "status " + status + " -> row kept");
  }
});

test("reconcile: non-manuscript/cover rows are skipped (not even checked)", async () => {
  const rows = [
    { id: "row-1", book_id: "book-1", file_type: "other", file_kind: "preview", reviewstudio_review_id: "rev-1", reviewstudio_file_id: "file-1", reviewstudio_project_id: "proj-1", metadata: {} },
  ];
  const fetchCalls: any[] = [];
  const fetchImpl: any = async (url: string) => { fetchCalls.push(url); return { status: 404, ok: false, async text() { return ""; } }; };
  const { supabase, updates } = rowReconcileSupabase();
  const r = await reconcileBookFiles({ rows, supabase, fetchImpl, rsBaseUrl: BASE_URL, rsHeaders: RS_HEADERS });
  assertEq(r.counts.skipped, 1, "skipped");
  assertEq(r.counts.missing, 0, "not classified missing");
  assertEq(fetchCalls.length, 0, "no HTTP calls for skipped rows");
  assertEq(updates.length, 0, "no DB update for skipped rows");
});

test("reconcile: rows missing reviewstudio_file_id are skipped", async () => {
  const rows = [
    { id: "row-1", book_id: "book-1", file_type: "manuscript", file_kind: "manuscript", reviewstudio_review_id: "rev-1", metadata: {} },
  ];
  const fetchImpl: any = async () => { throw new Error("should not be called"); };
  const { supabase } = rowReconcileSupabase();
  const r = await reconcileBookFiles({ rows, supabase, fetchImpl, rsBaseUrl: BASE_URL, rsHeaders: RS_HEADERS });
  assertEq(r.counts.skipped, 1, "skipped when no reviewstudio_file_id");
});

test("reconcile: 200 with 'not found' errors object -> missing", async () => {
  const rows = [
    { id: "row-1", book_id: "book-1", file_type: "manuscript", file_kind: "manuscript", reviewstudio_review_id: "rev-1", reviewstudio_file_id: "file-1", reviewstudio_project_id: "proj-1", metadata: {} },
  ];
  const fetchImpl: any = async () => ({ status: 200, ok: true, async text() { return JSON.stringify({ errors: [{ message: "Review file deleted" }] }); } });
  const { supabase, updates } = rowReconcileSupabase();
  const r = await reconcileBookFiles({ rows, supabase, fetchImpl, rsBaseUrl: BASE_URL, rsHeaders: RS_HEADERS });
  assertEq(r.counts.missing, 1, "missing on deleted-error body");
  assertEq(updates.length, 1, "one update");
  assertEq(updates[0].payload.is_latest, false, "is_latest=false");
});

test("reconcile: DB write fails -> indeterminate (NOT marked stale based on DB error)", async () => {
  const rows = [
    { id: "row-1", book_id: "book-1", file_type: "manuscript", file_kind: "manuscript", reviewstudio_review_id: "rev-1", reviewstudio_file_id: "file-1", reviewstudio_project_id: "proj-1", metadata: {} },
  ];
  const fetchImpl: any = async () => ({ status: 404, ok: false, async text() { return ""; } });
  const { supabase } = rowReconcileSupabase({ dbWriteFails: true });
  const r = await reconcileBookFiles({ rows, supabase, fetchImpl, rsBaseUrl: BASE_URL, rsHeaders: RS_HEADERS });
  assertEq(r.counts.indeterminate, 1, "DB write fail -> indeterminate (don't punish on transient DB error)");
  assertEq(r.verified.length, 1, "row preserved in verified");
  assertEq(r.marked_stale.length, 0, "not in marked_stale");
});

test("reconcile: mixed rows -> correct verified output and counts", async () => {
  const rows = [
    { id: "row-present", book_id: "book-1", file_type: "manuscript", file_kind: "manuscript", reviewstudio_review_id: "rev-1", reviewstudio_file_id: "file-1", reviewstudio_project_id: "proj-1", metadata: {} },
    { id: "row-missing", book_id: "book-1", file_type: "cover", file_kind: "cover", reviewstudio_review_id: "rev-1", reviewstudio_file_id: "file-2", reviewstudio_project_id: "proj-1", metadata: {} },
    { id: "row-indet", book_id: "book-1", file_type: "manuscript", file_kind: "manuscript", reviewstudio_review_id: "rev-1", reviewstudio_file_id: "file-3", reviewstudio_project_id: "proj-1", metadata: {} },
    { id: "row-skipped", book_id: "book-1", file_type: "preview", file_kind: "preview", reviewstudio_review_id: "rev-1", reviewstudio_file_id: "file-4", reviewstudio_project_id: "proj-1", metadata: {} },
  ];
  // Order is not guaranteed (parallel) but per-row classification is stable.
  // We map row.id -> desired status via a closure.
  const statusByFileId: Record<string, number> = {
    "file-1": 200,
    "file-2": 404,
    "file-3": 503,
    "file-4": 999, // unreachable
  };
  const fetchImpl: any = async (url: string) => {
    const m = /\/files\/([^/?]+)/.exec(url);
    const fid = m ? m[1] : "";
    const status = statusByFileId[fid] ?? 500;
    if (status === 999) throw new Error("unreachable");
    return {
      status,
      ok: status >= 200 && status < 300,
      async text() {
        if (status === 200) return JSON.stringify({ id: fid });
        return "";
      },
    };
  };
  const { supabase } = rowReconcileSupabase();
  const r = await reconcileBookFiles({ rows, supabase, fetchImpl, rsBaseUrl: BASE_URL, rsHeaders: RS_HEADERS });
  assertEq(r.counts.present, 1, "1 present");
  assertEq(r.counts.missing, 1, "1 missing");
  assertEq(r.counts.indeterminate, 1, "1 indeterminate (5xx)");
  assertEq(r.counts.skipped, 1, "1 skipped (preview)");
  assertEq(r.verified.length, 3, "verified = present + indeterminate + skipped");
  assertEq(r.marked_stale.length, 1, "marked_stale = missing only");
  assertEq(r.marked_stale[0].id, "row-missing", "row-missing marked");
});

// ============================================================
// runner
// ============================================================

(async () => {
  let passed = 0;
  let failed = 0;
  const failures: { name: string; err: string }[] = [];
  try {
    for (const t of tests) {
      try {
        await t.fn();
        passed++;
        console.log("  PASS  " + t.name);
      } catch (e: any) {
        failed++;
        failures.push({ name: t.name, err: e?.message || String(e) });
        console.log("  FAIL  " + t.name);
        console.log("        " + (e?.message || String(e)));
      }
    }
  } catch (e: any) {
    console.log("FATAL: " + (e?.message || String(e)));
    process.exit(2);
  }
  console.log("");
  console.log("=================================");
  console.log("Passed: " + passed);
  console.log("Failed: " + failed);
  console.log("Total:  " + tests.length);
  console.log("=================================");
  if (failed > 0) {
    console.log("");
    console.log("FAILURES:");
    for (const f of failures) console.log("  - " + f.name + ": " + f.err);
    process.exit(1);
  }
})();
