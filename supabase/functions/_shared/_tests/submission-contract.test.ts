import test from "node:test";
import assert from "node:assert/strict";
import {
  authorizeEmployeeSubmission,
  resolveSubmissionReviewer,
  submitEmployeeBook,
} from "../employeeSubmission.ts";
import { validateReviewerMapping } from "../reviewerMapping.ts";
import {
  selectReviewSourceReference,
  syncBasecampReviewRound,
} from "../basecampReviewLifecycle.ts";

const validToken = {
  id: "token-1",
  role: "employee",
  book_id: "book-1",
  review_round_id: null,
  revoked_at: null,
  expires_at: "2099-01-01T00:00:00.000Z",
  allowed_actions: ["submit_for_approval"],
  allowed_pages: ["pricing"],
  metadata: { token_kind: "book_specific" },
};

test(
  "submission authorization is book, role, action, expiry, and revocation scoped",
  () => {
    assert.equal(
      authorizeEmployeeSubmission(
        validToken,
        "book-1",
        Date.parse("2026-01-01")
      ),
      true
    );

    for (const token of [
      { ...validToken, book_id: "book-2" },
      { ...validToken, role: "admin" },
      { ...validToken, allowed_actions: [] },
      { ...validToken, allowed_pages: [] },
      { ...validToken, revoked_at: "2026-01-01" },
      { ...validToken, expires_at: "2025-01-01" },
      { ...validToken, review_round_id: "round-1" },
      { ...validToken, metadata: {} },
    ]) {
      assert.throws(() =>
        authorizeEmployeeSubmission(
          token,
          "book-1",
          Date.parse("2026-01-01")
        )
      );
    }
  }
);

test(
  "submission uses per-book, default, then eligible Owner fallback and safely allows unassigned",
  () => {
    const reviewers = [
      { id: "book-reviewer", active: true },
      { id: "default-reviewer", active: true },
    ];

    assert.deepEqual(
      resolveSubmissionReviewer(
        "book-reviewer",
        "default-reviewer",
        reviewers
      ),
      {
        id: "book-reviewer",
        source: "override",
      }
    );

    assert.deepEqual(
      resolveSubmissionReviewer(
        "inactive",
        "default-reviewer",
        reviewers
      ),
      {
        id: "default-reviewer",
        source: "default",
      }
    );

    assert.deepEqual(
      resolveSubmissionReviewer(
        "inactive",
        "also-inactive",
        [...reviewers, { id: "owner-reviewer", active: true, role: "owner" }]
      ),
      {
        id: "owner-reviewer",
        source: "owner_fallback",
      }
    );

    assert.deepEqual(
      resolveSubmissionReviewer(
        "inactive",
        "also-inactive",
        reviewers
      ),
      {
        id: null,
        source: null,
      }
    );
  }
);

test(
  "canonical submission commits before Basecamp and survives Basecamp failure",
  async () => {
    const order: string[] = [];

    const result = await submitEmployeeBook({
      token: validToken,
      bookId: "book-1",

      submitCanonical: async () => {
        order.push("canonical");

        return {
          book_id: "book-1",
          review_round_id: "round-1",
          round_number: 1,
        };
      },

      syncBasecamp: async () => {
        order.push("basecamp");
        throw new Error("offline");
      },
    });

    assert.deepEqual(order, ["canonical", "basecamp"]);
    assert.equal(result.review_round_id, "round-1");

    assert.deepEqual(result.basecamp, {
      status: "failed",
      retryAvailable: true,
    });
  }
);

test(
  "reviewer mapping requires user-management authority, eligible reviewer, and current project person",
  () => {
    const input = {
      actor: {
        id: "admin",
        capabilities: ["can_manage_users"],
      },
      reviewerId: "reviewer-1",
      personId: "person-1",
    };

    assert.deepEqual(
      validateReviewerMapping({
        ...input,
        reviewers: [
          {
            id: "reviewer-1",
            active: true,
          },
        ],
        projectPeople: [
          {
            id: "person-1",
            name: "Reviewer Person",
          },
        ],
      }),
      {
        reviewerId: "reviewer-1",
        personId: "person-1",
        displayName: "Reviewer Person",
      }
    );

    assert.throws(() =>
      validateReviewerMapping({
        ...input,
        actor: {
          id: "reviewer-1",
          capabilities: ["can_review"],
        },
        reviewers: [],
        projectPeople: [],
      })
    );

    assert.throws(() =>
      validateReviewerMapping({
        ...input,
        reviewers: [],
        projectPeople: [
          {
            id: "person-1",
          },
        ],
      })
    );

    assert.throws(() =>
      validateReviewerMapping({
        ...input,
        reviewers: [
          {
            id: "reviewer-1",
            active: true,
          },
        ],
        projectPeople: [
          {
            id: "other",
          },
        ],
      })
    );
  }
);

test(
  "Basecamp review source uses Employee Intake for Round 1 and previous Employee Updates for later rounds",
  () => {
    const references = [
      {
        id: "book-reference",
        reference_kind: "book_todo_list",
        review_round_id: null,
        todo_id: "employee-intake-todo",
      },
      {
        id: "round-1-review-reference",
        reference_kind: "review_round",
        review_round_id: "round-1",
        todo_id: "admin-review-round-1",
      },
      {
        id: "round-1-update-reference",
        reference_kind: "employee_update",
        review_round_id: "round-1",
        todo_id: "employee-updates-round-1",
      },
      {
        id: "round-2-review-reference",
        reference_kind: "review_round",
        review_round_id: "round-2",
        todo_id: "admin-review-round-2",
      },
    ];

    const roundOneSource = selectReviewSourceReference(
      {
        id: "round-1",
        previousRoundId: null,
      },
      references
    );

    assert.equal(
      roundOneSource?.id,
      "book-reference",
      "Round 1 must complete the original Employee Intake task"
    );

    const roundTwoSource = selectReviewSourceReference(
      {
        id: "round-2",
        previousRoundId: "round-1",
      },
      references
    );

    assert.equal(
      roundTwoSource?.id,
      "round-1-update-reference",
      "Round 2 must complete Employee Updates — Round 1"
    );

    const missingPreviousUpdate = selectReviewSourceReference(
      {
        id: "round-3",
        previousRoundId: "missing-round",
      },
      references
    );

    assert.equal(
      missingPreviousUpdate,
      null,
      "A later round must fail closed rather than falling back to Employee Intake"
    );
  }
);

test(
  "Basecamp lifecycle completes Employee Intake and creates one assigned review task",
  async () => {
    const actions: string[] = [];
    const updates: Record<string, unknown>[] = [];

    const result = await syncBasecampReviewRound({
      round: {
        id: "round-1",
        roundNumber: 1,
        reviewerUserId: "reviewer-1",
      },

      book: {
        id: "book-1",
        title: "Book",
      },

      employeeReference: {
        todoId: "employee-todo",
        completedAt: null,
      },

      reviewReference: {
        id: "ref-1",
        todoListId: "list-1",
        todoId: null,
        attempts: 0,
      },

      reviewerMapping: {
        personId: "9",
      },

      projectPeople: [
        {
          id: "9",
        },
      ],

      getTodo: async () => ({
        id: "employee-todo",
        completed: false,
      }),

      completeTodo: async () => {
        actions.push("complete");
      },

      reconcileReviewTodo: async () => null,

      createReviewTodo: async (payload) => {
        actions.push("create");

        assert.deepEqual(payload.assignee_ids, [9]);
        assert.equal(payload.content, "Review — Round 1");

        return {
          id: "review-todo",
        };
      },

      updateEmployeeReference: async (patch) => {
        updates.push(patch);
      },

      updateReviewReference: async (patch) => {
        updates.push(patch);
      },
    });

    assert.deepEqual(actions, [
      "create",
      "complete",
    ]);

    assert.equal(
      result.status,
      "ready"
    );

    assert.equal(
      updates.some(
        (patch) =>
          patch.todo_id === "review-todo"
      ),
      true
    );
  }
);

test(
  "missing reviewer mapping never completes the employee source task",
  async () => {
    let completed = false;
    const result = await syncBasecampReviewRound({
      round: { id: "round-1", roundNumber: 1, reviewerUserId: "reviewer-1" },
      book: { id: "book-1", title: "Book" },
      employeeReference: { todoId: "employee-todo", completedAt: null },
      reviewReference: { id: "ref-1", todoListId: "list-1", todoId: null, attempts: 0 },
      reviewerMapping: null,
      projectPeople: [],
      getTodo: async () => ({ id: "employee-todo", completed: false }),
      completeTodo: async () => { completed = true; },
      reconcileReviewTodo: async () => null,
      createReviewTodo: async () => ({ id: "unexpected" }),
      updateEmployeeReference: async () => {},
      updateReviewReference: async () => {},
    });
    assert.equal(completed, false);
    assert.equal(result.reason, "reviewer_mapping_required");
  }
);

test(
  "Basecamp lifecycle is partial-progress safe and does not invent reviewer assignment",
  async () => {
    const actions: string[] = [];

    const result = await syncBasecampReviewRound({
      round: {
        id: "round-1",
        roundNumber: 1,
        reviewerUserId: "reviewer-1",
      },

      book: {
        id: "book-1",
        title: "Book",
      },

      employeeReference: {
        todoId: "employee-todo",
        completedAt: "2026-01-01",
      },

      reviewReference: {
        id: "ref-1",
        todoListId: "list-1",
        todoId: null,
        attempts: 1,
      },

      reviewerMapping: null,
      projectPeople: [],

      getTodo: async () => {
        actions.push("get");
        return null;
      },

      completeTodo: async () => {
        actions.push("complete");
      },

      reconcileReviewTodo: async () => null,

      createReviewTodo: async () => {
        actions.push("create");

        return {
          id: "x",
        };
      },

      updateEmployeeReference: async () => {},
      updateReviewReference: async () => {},
    });

    assert.deepEqual(
      actions,
      []
    );

    assert.deepEqual(
      result,
      {
        status: "pending",
        retryAvailable: true,
        reason: "reviewer_mapping_required",
      }
    );
  }
);

test(
  "Basecamp lifecycle reconciles an ambiguous task before creating another",
  async () => {
    let creates = 0;

    const result = await syncBasecampReviewRound({
      round: {
        id: "round-1",
        roundNumber: 1,
        reviewerUserId: "reviewer-1",
      },

      book: {
        id: "book-1",
        title: "Book",
      },

      employeeReference: {
        todoId: "employee-todo",
        completedAt: "done",
      },

      reviewReference: {
        id: "ref-1",
        todoListId: "list-1",
        todoId: null,
        attempts: 1,
      },

      reviewerMapping: {
        personId: "9",
      },

      projectPeople: [
        {
          id: "9",
        },
      ],

      getTodo: async () => null,
      completeTodo: async () => {},

      reconcileReviewTodo: async () => ({
        id: "existing-review-todo",
      }),

      createReviewTodo: async () => {
        creates += 1;

        return {
          id: "new",
        };
      },

      updateEmployeeReference: async () => {},
      updateReviewReference: async () => {},
    });

    assert.equal(
      creates,
      0
    );

    assert.equal(
      result.status,
      "ready"
    );
  }
);
