import test from "node:test";
import assert from "node:assert/strict";
import {
  BasecampError,
  basecampRequest,
  collectBasecampPages,
  enabledTodoset,
} from "../basecampClient.ts";
import {
  completeBasecampOAuth,
  initiateBasecampOAuth,
} from "../basecampOAuth.ts";
import {
  defaultEmployeeIntakeDueDate,
  loadCreateBookOptions,
  normalizeEmployeeIntakeTurnaround,
  provisionEmployeeIntake,
} from "../basecampProvisioning.ts";
import { confirmProvisioningMapping } from "../basecampBookRuntime.ts";
import { createPrivilegedBook } from "../createPrivilegedBook.ts";
import { resolvePrivilegedActor } from "../privilegedRequest.ts";
import { refreshBasecampCredential } from "../basecampRuntime.ts";

const connection = {
  id: "connection-1",
  accountId: "123",
  accountHref: "https://3.basecampapi.com/123",
  projectId: "456",
  todosetId: "789",
  credentialReference: "vault:item-1",
};

const assertEquals = assert.deepEqual;
const assertRejects = assert.rejects;

test("OAuth initiation stores a hashed, expiring server state", async () => {
  let stored: Record<string, unknown> | null = null;
  const result = await initiateBasecampOAuth({
    clientId: "client-id",
    redirectUri: "https://example.test/basecamp/callback",
    initiatorId: "priv-1",
    accountId: "123",
    projectId: "456",
    now: new Date("2026-09-12T00:00:00Z"),
    randomBytes: () => new Uint8Array(32).fill(7),
    storeState: async (row) => { stored = row; },
  });
  assertEquals(result.authorizationUrl.startsWith("https://launchpad.37signals.com/authorization/new?"), true);
  assertEquals(result.authorizationUrl.includes("state="), true);
  assertEquals(String(stored?.stateHash).length, 64);
  assertEquals(stored?.initiatorId, "priv-1");
  assertEquals(stored?.accountId, "123");
  assertEquals(stored?.projectId, "456");
});

test("OAuth callback rejects invalid, expired, and replayed state", async () => {
  for (const reason of ["invalid", "expired", "replayed"]) {
    await assertRejects(() => completeBasecampOAuth({
      code: "code",
      state: "state",
      clientId: "client",
      clientSecret: "secret",
      redirectUri: "https://example.test/callback",
      consumeState: async () => ({ ok: false, reason }),
      exchangeCode: async () => { throw new Error("must not exchange"); },
      discoverAuthorization: async () => ({}),
      loadProject: async () => ({}),
      storeTokens: async () => "never",
      saveConnection: async () => {},
    }), BasecampError, "OAuth state is invalid or expired.");
  }
});

test("OAuth callback validates account, project, and enabled todoset before storing tokens", async () => {
  let stored = false;
  let saved: Record<string, unknown> | null = null;
  await completeBasecampOAuth({
    code: "code",
    state: "state",
    clientId: "client",
    clientSecret: "secret",
    redirectUri: "https://example.test/callback",
    consumeState: async () => ({ ok: true, initiatorId: "priv-1", accountId: "123", projectId: "456" }),
    exchangeCode: async () => ({ access_token: "access", refresh_token: "refresh", expires_in: 1209600 }),
    discoverAuthorization: async () => ({ accounts: [{ id: 123, product: "bc3", href: "https://3.basecampapi.com/123" }] }),
    loadProject: async () => ({ id: 456, dock: [{ name: "todoset", enabled: true, id: 789 }] }),
    storeTokens: async (tokens) => { stored = tokens.refresh_token === "refresh"; return "vault:item-1"; },
    saveConnection: async (row) => { saved = row; },
  });
  assertEquals(stored, true);
  assertEquals(saved?.todosetId, "789");
  assertEquals(saved?.credentialReference, "vault:item-1");
  assertEquals(typeof saved?.expiresAt, "string");
  assertEquals(JSON.stringify(saved).includes("refresh"), false);
});

test("OAuth callback fails closed when token storage fails", async () => {
  await assertRejects(() => completeBasecampOAuth({
    code: "code", state: "state", clientId: "client", clientSecret: "secret", redirectUri: "https://example.test/callback",
    consumeState: async () => ({ ok: true, initiatorId: "priv-1", accountId: "123", projectId: "456" }),
    exchangeCode: async () => ({ access_token: "access", refresh_token: "refresh", expires_in: 1209600 }),
    discoverAuthorization: async () => ({ accounts: [{ id: 123, product: "bc3", href: "https://3.basecampapi.com/123" }] }),
    loadProject: async () => ({ id: 456, dock: [{ name: "todoset", enabled: true, id: 789 }] }),
    storeTokens: async () => { throw new Error("vault unavailable"); },
    saveConnection: async () => { throw new Error("must not save"); },
  }), BasecampError, "Basecamp credential storage is unavailable.");
});

test("OAuth callback rejects a failed code exchange", async () => {
  await assertRejects(() => completeBasecampOAuth({
    code: "bad", state: "state", clientId: "client", clientSecret: "secret", redirectUri: "https://example.test/callback",
    consumeState: async () => ({ ok: true, initiatorId: "priv-1", accountId: "123", projectId: "456" }),
    exchangeCode: async () => { throw new Error("provider detail"); },
  }), BasecampError, "Basecamp authorization could not be completed.");
});

test("OAuth callback rejects the wrong account and wrong project", async () => {
  const common = {
    code: "code", state: "state", clientId: "client", clientSecret: "secret", redirectUri: "https://example.test/callback",
    consumeState: async () => ({ ok: true, initiatorId: "priv-1", accountId: "123", projectId: "456" }),
    exchangeCode: async () => ({ access_token: "access", refresh_token: "refresh", expires_in: 1209600 }),
    storeTokens: async () => "never", saveConnection: async () => {},
  };
  await assertRejects(() => completeBasecampOAuth({
    ...common, discoverAuthorization: async () => ({ accounts: [{ id: 999, product: "bc3", href: "https://3.basecampapi.com/999" }] }),
  }), BasecampError, "The configured Basecamp account is not accessible.");
  await assertRejects(() => completeBasecampOAuth({
    ...common, discoverAuthorization: async () => ({ accounts: [{ id: 123, product: "bc3", href: "https://3.basecampapi.com/123" }] }),
    loadProject: async () => ({ id: 999, dock: [] }),
  }), BasecampError, "The configured Pre-Press project is not accessible.");
});

test("enabledTodoset rejects missing or disabled project tool", () => {
  assertEquals(enabledTodoset({ dock: [{ name: "todoset", enabled: true, id: 9 }] }), "9");
  for (const dock of [[], [{ name: "todoset", enabled: false, id: 9 }]]) {
    try { enabledTodoset({ dock }); throw new Error("expected failure"); }
    catch (error) { assertEquals(error instanceof BasecampError && error.status === 409, true); }
  }
});

test("project people pagination returns safe fields and tolerates redacted email", async () => {
  const pages = new Map([
    ["https://3.basecampapi.com/123/projects/456/people.json", { body: [{ id: 1, name: "A", avatar_url: "https://img/1" }], next: "https://3.basecampapi.com/123/projects/456/people.json?page=2" }],
    ["https://3.basecampapi.com/123/projects/456/people.json?page=2", { body: [{ id: 2, name: "B", email_address: "redacted" }], next: null }],
  ]);
  const people = await collectBasecampPages("https://3.basecampapi.com/123/projects/456/people.json", async (url) => pages.get(url)!);
  assertEquals(people.map((person) => ({ id: String(person.id), name: person.name })), [{ id: "1", name: "A" }, { id: "2", name: "B" }]);
});

test("safe GET retries 429 and transient 5xx but not 404", async () => {
  const waits: number[] = [];
  let attempts = 0;
  const response = await basecampRequest("https://3.basecampapi.com/123/projects/456.json", {
    method: "GET", accessToken: "token", userAgent: "KDP Intake (ops@example.test)", sleep: async (ms) => { waits.push(ms); },
    fetchImpl: async () => {
      attempts += 1;
      if (attempts === 1) return new Response("", { status: 429, headers: { "Retry-After": "2" } });
      if (attempts === 2) return new Response("", { status: 503 });
      return Response.json({ id: 456 });
    },
  });
  assertEquals(response.status, 200);
  assertEquals(attempts, 3);
  assertEquals(waits, [2000, 1000]);

  attempts = 0;
  await assertRejects(() => basecampRequest("https://3.basecampapi.com/123/projects/missing.json", {
    method: "GET", accessToken: "token", userAgent: "KDP Intake (ops@example.test)",
    fetchImpl: async () => { attempts += 1; return new Response("", { status: 404 }); },
  }), BasecampError);
  assertEquals(attempts, 1);
});

test("non-idempotent POST is never automatically retried", async () => {
  let attempts = 0;
  await assertRejects(() => basecampRequest("https://3.basecampapi.com/123/todosets/789/todolists.json", {
    method: "POST", accessToken: "token", userAgent: "KDP Intake (ops@example.test)", body: { name: "Book" },
    fetchImpl: async () => { attempts += 1; return new Response("", { status: 503 }); },
  }), BasecampError);
  assertEquals(attempts, 1);
});

test("expired access token refreshes through the server token provider", async () => {
  let refreshed = false;
  const result = await basecampRequest("https://3.basecampapi.com/123/projects/456.json", {
    method: "GET", accessToken: "expired", userAgent: "KDP Intake (ops@example.test)",
    refreshAccessToken: async () => { refreshed = true; return "fresh"; },
    fetchImpl: async (_url, init) => new Response(JSON.stringify({ authorization: new Headers(init?.headers).get("Authorization") }), { status: new Headers(init?.headers).get("Authorization") === "Bearer expired" ? 401 : 200 }),
  });
  assertEquals(refreshed, true);
  assertEquals(await result.json(), { authorization: "Bearer fresh" });
});

test("access-token refresh failure is sanitized", async () => {
  await assertRejects(() => basecampRequest("https://3.basecampapi.com/123/projects/456.json", {
    method: "GET", accessToken: "expired", userAgent: "KDP Intake (ops@example.test)",
    refreshAccessToken: async () => { throw new Error("secret provider detail"); },
    fetchImpl: async () => new Response("", { status: 401 }),
  }), BasecampError, "Basecamp authorization could not be refreshed.");
});

test("refresh-token rotation is persisted and permanent refresh failure marks reconnect required", async () => {
  const rpcCalls: Record<string, unknown>[] = [];
  const updates: Record<string, unknown>[] = [];
  const supabase = {
    rpc: async (_name: string, args: Record<string, unknown>) => { rpcCalls.push(args); return { error: null }; },
    from: () => ({ update: (row: Record<string, unknown>) => ({ eq: async () => { updates.push(row); return { error: null }; } }) }),
  };
  const connection = { id: "connection-1", credentialReference: "vault-id" };
  const credential = { access_token: "old-access", refresh_token: "old-refresh" };
  await refreshBasecampCredential(supabase, connection, credential, {
    clientId: "client", clientSecret: "secret", userAgent: "test",
    fetchImpl: async () => Response.json({ access_token: "new-access", refresh_token: "new-refresh", expires_in: 1209600 }),
  });
  assertEquals(rpcCalls[0].p_refresh_token, "new-refresh");
  assertEquals(rpcCalls[0].p_credential_reference, "vault-id");

  await assertRejects(() => refreshBasecampCredential(supabase, connection, credential, {
    clientId: "client", clientSecret: "secret", userAgent: "test",
    fetchImpl: async () => Response.json({ error: "invalid_grant" }, { status: 400 }),
  }), BasecampError);
  assertEquals(updates.some((row) => row.connection_status === "refresh_required"), true);
});

test("Create options contain only current project members and eligible reviewers", async () => {
  const options = await loadCreateBookOptions({
    connection,
    listProjectPeople: async () => [{ id: 1, name: "Employee", avatar_url: null, email_address: null }],
    listEligibleReviewers: async () => [{ id: "reviewer-1", display_name: "Reviewer", email_snapshot: "private@example.test" }],
    loadDefaultReviewerId: async () => "reviewer-1",
    loadWorkflowDefaults: async () => ({ employee_intake_turnaround: { value: 7, unit: "calendar_days" } }),
    now: Date.parse("2026-09-19T00:00:00Z"),
  });
  assertEquals(options.employees, [{ id: "1", displayName: "Employee", avatarUrl: null }]);
  assertEquals(options.reviewers, [{ id: "reviewer-1", displayName: "Reviewer" }]);
  assertEquals(options.defaultTurnaround, { value: 7, unit: "calendar_days" });
  assertEquals(options.defaultDueDate, "2026-09-26");
  assertEquals(JSON.stringify(options).includes("private@example.test"), false);
});

test("turnaround policy is seven calendar days by default and configurable", () => {
  assertEquals(normalizeEmployeeIntakeTurnaround({}), { value: 7, unit: "calendar_days" });
  const policy = normalizeEmployeeIntakeTurnaround({ employee_intake_turnaround: { value: 10, unit: "calendar_days" } });
  assertEquals(defaultEmployeeIntakeDueDate(policy, Date.parse("2026-09-19T12:00:00Z")), "2026-09-29");
});

test("Create denies invalid employee/reviewer before canonical commit", async () => {
  for (const invalid of ["employee", "reviewer"]) {
    let committed = false;
    await assertRejects(() => createPrivilegedBook({
      actor: { id: "priv-1", capabilities: ["can_create_book"] },
      bookAuthor: "Levi", dueDate: "2026-09-26",
      employeePersonId: invalid === "employee" ? "999" : "1",
      reviewerUserId: invalid === "reviewer" ? "bad" : "reviewer-1",
      employees: [{ id: "1", displayName: "Employee" }], reviewers: [{ id: "reviewer-1", displayName: "Reviewer" }],
      createCanonicalBook: async () => { committed = true; return { book: { id: "book-1" }, referenceId: "ref-1" }; },
      provision: async () => ({ status: "ready" }), tokenFactory: () => "test-opaque-value", hashToken: async () => "hash",
    }), BasecampError);
    assertEquals(committed, false);
  }
});

test("privileged operations resolve Google identity and current server grants", async () => {
  const actor = await resolvePrivilegedActor({
    authorizationHeader: "Bearer jwt",
    requiredCapability: "can_create_book",
    authenticate: async () => ({ id: "auth-1", app_metadata: { provider: "google" } }),
    findPrivilegedUser: async () => ({ id: "priv-1", disabled_at: null }),
    listGrants: async () => [{ capability_key: "can_create_book", revoked_at: null }],
  });
  assertEquals(actor.id, "priv-1");
  assertEquals(actor.capabilities, ["can_create_book"]);

  await assertRejects(() => resolvePrivilegedActor({
    authorizationHeader: "Bearer jwt",
    requiredCapability: "can_create_book",
    authenticate: async () => ({ id: "auth-1", app_metadata: { provider: "google" } }),
    findPrivilegedUser: async () => ({ id: "priv-1", disabled_at: null }),
    listGrants: async () => [{ capability_key: "can_review", revoked_at: null }],
  }), BasecampError, "The required capability is not authorized.");
});

test("Create requires can_create_book and commits canonical book before Basecamp", async () => {
  await assertRejects(() => createPrivilegedBook({ actor: { id: "priv-1", capabilities: [] } } as never), BasecampError);
  const order: string[] = [];
  const result = await createPrivilegedBook({
    actor: { id: "priv-1", capabilities: ["can_create_book"] }, bookAuthor: "Levi", dueDate: "2026-09-26", dueDateSource: "default", employeePersonId: "1", reviewerUserId: "reviewer-1",
    employees: [{ id: "1", displayName: "Employee" }], reviewers: [{ id: "reviewer-1", displayName: "Reviewer" }],
    tokenFactory: () => "test-opaque-value", hashToken: async () => "hash",
    createCanonicalBook: async (input) => { order.push("canonical"); assertEquals(input.overallStatus, "draft"); assertEquals(input.bookAuthor, "Levi"); assertEquals(input.dueDate, "2026-09-26"); return { book: { id: "book-1", title: "Untitled", status: "draft" }, referenceId: "ref-1" }; },
    provision: async () => { order.push("basecamp"); return { status: "failed" }; },
  });
  assertEquals(order, ["canonical", "basecamp"]);
  assertEquals(result.book.id, "book-1");
  assertEquals(result.basecamp.status, "failed");
});

test("provisioning persists each mapping and known success never duplicates", async () => {
  const creates: string[] = [];
  const updates: Record<string, unknown>[] = [];
  const result = await provisionEmployeeIntake({
    connection, book: { id: "book-1", title: "Untitled", author: "Levi" }, employeePersonId: "1", employeeDeepLink: "https://intake.test/authorized-book-entry", dueDate: "2026-09-26",
    reference: { id: "ref-1", provisioning_status: "pending", todo_list_id: null, todo_id: null },
    reconcileList: async () => null, reconcileTodo: async () => null,
    createTodoList: async () => { creates.push("list"); return { id: 11 }; },
    createTodo: async (_listId, payload) => { creates.push("todo"); assertEquals(payload.assignee_ids, [1]); assertEquals(payload.content, "KDP Pre-Press — Stage 1"); assert.match(payload.description, /Due:<\/strong> 2026-09-26/); assertEquals(payload.due_on, "2026-09-26"); return { id: 22 }; },
    updateReference: async (patch) => { updates.push(patch); },
  });
  assertEquals(creates, ["list", "todo"]);
  assertEquals(updates.some((row) => row.todo_list_id === "11"), true);
  assertEquals(updates.some((row) => row.todo_id === "22" && row.provisioning_status === "provisioned"), true);
  assertEquals(result.status, "ready");

  creates.length = 0;
  await provisionEmployeeIntake({
    connection, book: { id: "book-1", title: "Untitled" }, employeePersonId: "1", employeeDeepLink: "unused",
    reference: { id: "ref-1", provisioning_status: "provisioned", todo_list_id: "11", todo_id: "22" },
    mappingConfirmed: true,
    reconcileList: async () => null, reconcileTodo: async () => null,
    createTodoList: async () => { creates.push("list"); return { id: 33 }; }, createTodo: async () => { creates.push("todo"); return { id: 44 }; }, updateReference: async () => {},
  });
  assertEquals(creates, []);
});

test("ambiguous create state reconciles before any second POST", async () => {
  const creates: string[] = [];
  await provisionEmployeeIntake({
    connection, book: { id: "book-1", title: "Untitled" }, employeePersonId: "1", employeeDeepLink: "unused",
    reference: { id: "ref-1", provisioning_status: "failed", todo_list_id: null, todo_id: null },
    reconcileList: async () => ({ id: 11 }), reconcileTodo: async () => ({ id: 22 }),
    createTodoList: async () => { creates.push("list"); return { id: 33 }; }, createTodo: async () => { creates.push("todo"); return { id: 44 }; }, updateReference: async () => {},
  });
  assertEquals(creates, []);
});

test("retry trusts mapped resources only after Basecamp confirms their relationship", async () => {
  const marker = "KDP Intake Book: book-1";
  const runtime = {
    getJson: async (path: string) => path.startsWith("todolists/")
      ? { id: 11, description: `<div>${marker}</div>` }
      : { id: 22, content: "Employee Intake", description: `<div>${marker}</div>`, parent: { id: 11 } },
    getCollection: async () => [],
  };
  assertEquals(await confirmProvisioningMapping(runtime, {
    todo_list_id: "11", todo_id: "22",
  }, "book-1", []), { listId: "11", todoId: "22" });

  const wrongParentRuntime = {
    ...runtime,
    getJson: async (path: string) => path.startsWith("todolists/")
      ? { id: 11, description: `<div>${marker}</div>` }
      : { id: 22, content: "Employee Intake", description: `<div>${marker}</div>`, parent: { id: 99 } },
  };
  assertEquals(await confirmProvisioningMapping(wrongParentRuntime, {
    todo_list_id: "11", todo_id: "22",
  }, "book-1", []), { listId: "11", todoId: null });
});

test("retry reconciles stale mapped ids by marker and does not mask indeterminate failures", async () => {
  const marker = "KDP Intake Book: book-1";
  const missing = new BasecampError(404, "missing", "http_404");
  const runtime = {
    getJson: async () => { throw missing; },
    getCollection: async (path: string) => path.startsWith("todolists/")
      ? [{ id: 44, content: "Employee Intake", description: marker, parent: { id: 33 } }]
      : [],
  };
  assertEquals(await confirmProvisioningMapping(runtime, {
    todo_list_id: "11", todo_id: "22",
  }, "book-1", [{ id: 33, description: marker }]), { listId: "33", todoId: "44" });

  await assertRejects(() => confirmProvisioningMapping({
    getJson: async () => { throw new BasecampError(502, "temporary", "http_503"); },
    getCollection: async () => [],
  }, { todo_list_id: "11", todo_id: "22" }, "book-1", []), BasecampError, "temporary");
});
