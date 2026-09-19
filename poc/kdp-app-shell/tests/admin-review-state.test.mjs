import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  addReviewComment,
  createReviewDraft,
  filterReviewComments,
  reviewPageProgress,
  reviewStepAccessible,
  reviewMutationControlsVisible,
  setReviewDecision,
} from '../src/adminReview/adminReviewState.js';

const adminReviewPageSource = readFileSync(
  new URL(
    '../src/adminReview/AdminReviewPage.jsx',
    import.meta.url
  ),
  'utf8'
);

const items = [
  {
    id: 'i-1',
    step: 'details',
    sectionKey: 'details.language',
    label: 'Language',
    decision: 'approved',
  },
  {
    id: 'i-2',
    step: 'details',
    sectionKey: 'details.title',
    label: 'Book Title',
    decision: 'pending',
  },
  {
    id: 'i-3',
    step: 'content',
    sectionKey: 'content.manuscript',
    label: 'Manuscript',
    decision: 'pending',
  },
];

test(
  'review draft keeps only the selected page items and authoritative decisions',
  () => {
    const draft = createReviewDraft(
      {
        items,
        comments: [],
      },
      'details'
    );

    assert.deepEqual(
      draft.items.map((item) => item.id),
      ['i-1', 'i-2']
    );

    assert.deepEqual(
      draft.decisions,
      {
        'i-1': 'approved',
        'i-2': 'pending',
      }
    );
  }
);

test('finalized history exposes no mutation controls while active assigned review still does', () => {
  assert.equal(reviewMutationControlsVisible({ reviewRound: { finalizedAt: '2026-09-14T00:00:00Z' }, permissions: { canMutate: true } }), false);
  assert.equal(reviewMutationControlsVisible({ reviewRound: { finalizedAt: null }, permissions: { canMutate: true } }), true);
  assert.match(adminReviewPageSource, /Historical review round/);
  assert.match(adminReviewPageSource, /reviewMutationControlsVisible/);
});

test(
  'approving and reopening a section changes only the local draft decision',
  () => {
    const draft = createReviewDraft(
      {
        items,
        comments: [],
      },
      'details'
    );

    const approved = setReviewDecision(
      draft,
      'i-2',
      'approved'
    );

    assert.equal(
      approved.decisions['i-2'],
      'approved'
    );

    assert.equal(
      draft.decisions['i-2'],
      'pending'
    );

    assert.equal(
      setReviewDecision(
        approved,
        'i-2',
        'pending'
      ).decisions['i-2'],
      'pending'
    );
  }
);

test(
  'a new actionable section comment changes an approved section to requested updates',
  () => {
    const draft = createReviewDraft(
      {
        items,
        comments: [],
      },
      'details'
    );

    const next = addReviewComment(
      draft,
      {
        itemId: 'i-1',
        body: 'Please confirm the language.',
        author: 'Reviewer',
      }
    );

    assert.equal(
      next.decisions['i-1'],
      'needs_updates'
    );

    assert.equal(
      next.comments[0].issueNumber,
      1
    );

    assert.equal(
      next.comments[0].actionable,
      true
    );
  }
);

test(
  'general comments do not consume round-local section issue numbers',
  () => {
    let draft = createReviewDraft(
      {
        items,
        comments: [],
      },
      'details'
    );

    draft = addReviewComment(
      draft,
      {
        body: 'General note',
        author: 'Reviewer',
      }
    );

    draft = addReviewComment(
      draft,
      {
        itemId: 'i-2',
        body: 'Fix title',
        author: 'Reviewer',
      }
    );

    assert.equal(
      draft.comments[0].issueNumber,
      null
    );

    assert.equal(
      draft.comments[1].issueNumber,
      1
    );
  }
);

test(
  'reply hierarchy remains explicit so nested replies are not offered',
  () => {
    const draft = createReviewDraft(
      {
        items,
        comments: [
          {
            id: 'reply-1',
            itemId: 'i-1',
            parentCommentId: 'root-1',
            body: 'Reply',
            actionable: false,
          },
        ],
      },
      'details'
    );

    assert.equal(
      draft.comments[0].parentCommentId,
      'root-1'
    );
  }
);

test(
  'comment filtering supports text search and deterministic newest/oldest ordering',
  () => {
    const comments = [
      {
        id: 'c-1',
        body: 'Language note',
        createdAt: '2026-09-12T10:00:00Z',
      },
      {
        id: 'c-2',
        body: 'Title needs attention',
        createdAt: '2026-09-13T10:00:00Z',
      },
    ];

    assert.deepEqual(
      filterReviewComments(
        comments,
        {
          query: 'title',
          sort: 'newest',
        }
      ).map((item) => item.id),
      ['c-2']
    );

    assert.deepEqual(
      filterReviewComments(
        comments,
        {
          sort: 'oldest',
        }
      ).map((item) => item.id),
      ['c-1', 'c-2']
    );

    assert.deepEqual(
      filterReviewComments(
        comments,
        {
          sort: 'newest',
        }
      ).map((item) => item.id),
      ['c-2', 'c-1']
    );
  }
);

test(
  'progress uses persisted server decisions and does not infer completion from current page',
  () => {
    assert.equal(
      reviewPageProgress(
        [
          {
            step: 'pricing',
            decision: 'pending',
          },
        ],
        'pricing'
      ),
      'in_progress'
    );

    assert.equal(
      reviewPageProgress(
        [
          {
            step: 'pricing',
            decision: 'approved',
          },
        ],
        'pricing'
      ),
      'complete'
    );

    assert.equal(
      reviewPageProgress(
        [],
        'pricing'
      ),
      'locked'
    );
  }
);

test(
  'review step access requires prior pages to be decided unless the step was already reached',
  () => {
    const pending = [
      {
        step: 'details',
        decision: 'pending',
      },
      {
        step: 'content',
        decision: 'pending',
      },
      {
        step: 'pricing',
        decision: 'pending',
      },
    ];

    assert.equal(
      reviewStepAccessible(
        pending,
        'details',
        []
      ),
      true
    );

    assert.equal(
      reviewStepAccessible(
        pending,
        'content',
        []
      ),
      false
    );

    assert.equal(
      reviewStepAccessible(
        pending,
        'pricing',
        []
      ),
      false
    );

    assert.equal(
      reviewStepAccessible(
        pending,
        'content',
        ['content']
      ),
      true
    );

    const detailsDecided =
      pending.map((item) =>
        item.step === 'details'
          ? {
              ...item,
              decision: 'needs_updates',
            }
          : item
      );

    assert.equal(
      reviewStepAccessible(
        detailsDecided,
        'content',
        []
      ),
      true
    );

    assert.equal(
      reviewStepAccessible(
        detailsDecided,
        'pricing',
        []
      ),
      false
    );

    const priorDecided =
      detailsDecided.map((item) =>
        item.step === 'content'
          ? {
              ...item,
              decision: 'approved',
            }
          : item
      );

    assert.equal(
      reviewStepAccessible(
        priorDecided,
        'pricing',
        []
      ),
      true
    );
  }
);

test(
  'requested-update sections cannot offer Reopen Decision while approved sections still can',
  () => {
    const approvedMatch =
      /if \(decision === 'approved'\) \{([\s\S]*?)if \(decision === 'needs_updates'\)/.exec(
        adminReviewPageSource
      );

    assert.ok(
      approvedMatch,
      'Approved DecisionControl branch must exist'
    );

    assert.match(
      approvedMatch[1],
      /Reopen Decision/
    );

    assert.match(
      approvedMatch[1],
      /onReopen/
    );

    const updatesMatch =
      /if \(decision === 'needs_updates'\) \{([\s\S]*?)\r?\n  \}\r?\n\r?\n  return h\(/.exec(
        adminReviewPageSource
      );

    assert.ok(
      updatesMatch,
      'Requested-updates DecisionControl branch must exist'
    );

    assert.match(
      updatesMatch[1],
      /UPDATES REQUESTED/
    );

    assert.doesNotMatch(
      updatesMatch[1],
      /Reopen Decision/
    );

    assert.doesNotMatch(
      updatesMatch[1],
      /onReopen/
    );
  }
);
