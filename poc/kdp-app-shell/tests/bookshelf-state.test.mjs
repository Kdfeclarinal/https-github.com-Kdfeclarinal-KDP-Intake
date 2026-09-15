import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BOOKSHELF_FILTERS,
  bookshelfBookView,
  filterAndSortBooks,
  humanBookStatus,
  isEditableBookStatus,
} from '../src/bookshelf/bookshelfState.js';

import {
  sanitizeBook,
} from '../../../supabase/functions/loadPrivilegedBookshelf/_privilegedBookshelf.ts';

const books = [
  {
    id: 'b-1',
    title: 'Zebra Days',
    author: 'Amara North',
    status: 'draft',
    updatedAt: '2026-09-10T10:00:00Z',
    createdAt: '2026-09-01T10:00:00Z',
  },
  {
    id: 'b-2',
    title: 'Amber Sky',
    author: 'Beau West',
    status: 'SUBMITTED_FOR_APPROVAL',
    updatedAt: '2026-09-08T10:00:00Z',
    createdAt: '2026-09-03T10:00:00Z',
  },
  {
    id: 'b-3',
    title: 'Middle Ground',
    author: 'Cleo East',
    status: 'needs_updates',
    updatedAt: '2026-09-09T10:00:00Z',
    createdAt: '2026-09-02T10:00:00Z',
  },
  {
    id: 'b-4',
    title: 'Approved Work',
    author: 'Dara South',
    status: 'APPROVED',
    updatedAt: '2026-09-07T10:00:00Z',
    createdAt: '2026-09-04T10:00:00Z',
  },
];

test(
  'human-facing status labels map canonical and cutover aliases',
  () => {
    assert.equal(
      humanBookStatus('EMPLOYEE_INTAKE'),
      'Draft'
    );

    assert.equal(
      humanBookStatus('draft'),
      'Draft'
    );

    assert.equal(
      humanBookStatus('SUBMITTED_FOR_APPROVAL'),
      'For Approval'
    );

    assert.equal(
      humanBookStatus('for_approval'),
      'For Approval'
    );

    assert.equal(
      humanBookStatus('EMPLOYEE_UPDATES'),
      'Needs Update'
    );

    assert.equal(
      humanBookStatus('needs_updates'),
      'Needs Update'
    );

    assert.equal(
      humanBookStatus('APPROVED'),
      'Approved'
    );

    assert.equal(
      humanBookStatus('AWAITING_REVIEW'),
      'For Approval'
    );

    assert.equal(
      humanBookStatus('IN_REVIEW'),
      'In Review'
    );

    assert.equal(
      humanBookStatus('KDP_INTAKE_APPROVED'),
      'Approved'
    );
  }
);

test(
  'only employee-editable workflow states receive setup actions',
  () => {
    assert.equal(
      isEditableBookStatus('draft'),
      true
    );

    assert.equal(
      isEditableBookStatus('EMPLOYEE_INTAKE'),
      true
    );

    assert.equal(
      isEditableBookStatus('needs_updates'),
      true
    );

    assert.equal(
      isEditableBookStatus('EMPLOYEE_UPDATES'),
      true
    );

    assert.equal(
      isEditableBookStatus('SUBMITTED_FOR_APPROVAL'),
      false
    );

    assert.equal(
      isEditableBookStatus('APPROVED'),
      false
    );
  }
);

test(
  'book view preserves only the sanitized Basecamp integration state',
  () => {
    const view = bookshelfBookView({
      id: 'book-1',
      reviewAvailable: true,
      basecamp: {
        status: 'failed',
        retryAvailable: true,
        remoteId: 'secret',
      },
    });

    assert.deepEqual(
      view.basecamp,
      {
        status: 'failed',
        retryAvailable: true,
        retryKind: 'book_setup',
      }
    );

    assert.equal(
      view.reviewAvailable,
      true
    );

    assert.equal(
      JSON.stringify(view).includes('remoteId'),
      false
    );
  }
);

test(
  'book view preserves the sanitized review-outcome retry kind',
  () => {
    const view = bookshelfBookView({
      id: 'book-2',
      basecamp: {
        status: 'failed',
        retryAvailable: true,
        retryKind: 'review_outcome',
        remoteId: 'secret',
      },
    });

    assert.deepEqual(
      view.basecamp,
      {
        status: 'failed',
        retryAvailable: true,
        retryKind: 'review_outcome',
      }
    );
  }
);

test(
  'legacy approved status uses finalized-outcome retry classification during Stage A',
  () => {
    const book = sanitizeBook({
      id: 'b1',
      overall_status: 'approved',
      latest_review_round_id: 'r1',
      basecamp_references: [
        {
          reference_kind: 'review_round',
          review_round_id: 'r1',
          provisioning_status: 'failed',
        },
      ],
    });

    assert.equal(
      book.basecamp.retryKind,
      'review_outcome'
    );
  }
);

test(
  'filter list includes required human-facing workflow states',
  () => {
    assert.deepEqual(
      BOOKSHELF_FILTERS.map(
        (item) => item.label
      ),
      [
        'All',
        'Draft',
        'For Approval',
        'In Review',
        'Approved',
        'Needs Update',
      ]
    );
  }
);

test(
  'search matches title and author without mutating source order',
  () => {
    const sourceOrder =
      books.map((book) => book.id);

    assert.deepEqual(
      filterAndSortBooks(
        books,
        {
          query: 'north',
        }
      ).map((book) => book.id),
      ['b-1']
    );

    assert.deepEqual(
      filterAndSortBooks(
        books,
        {
          query: 'amber',
        }
      ).map((book) => book.id),
      ['b-2']
    );

    assert.deepEqual(
      books.map((book) => book.id),
      sourceOrder
    );
  }
);

test(
  'workflow filters accept canonical and deployed aliases',
  () => {
    assert.deepEqual(
      filterAndSortBooks(
        books,
        {
          filter: 'draft',
        }
      ).map((book) => book.id),
      ['b-1']
    );

    assert.deepEqual(
      filterAndSortBooks(
        books,
        {
          filter: 'for_approval',
        }
      ).map((book) => book.id),
      ['b-2']
    );

    assert.deepEqual(
      filterAndSortBooks(
        books,
        {
          filter: 'needs_update',
        }
      ).map((book) => book.id),
      ['b-3']
    );

    assert.deepEqual(
      filterAndSortBooks(
        books,
        {
          filter: 'approved',
        }
      ).map((book) => book.id),
      ['b-4']
    );
  }
);

test(
  'all requested sort orders are deterministic',
  () => {
    assert.deepEqual(
      filterAndSortBooks(
        books,
        {
          sort: 'title_asc',
        }
      ).map((book) => book.title),
      [
        'Amber Sky',
        'Approved Work',
        'Middle Ground',
        'Zebra Days',
      ]
    );

    assert.deepEqual(
      filterAndSortBooks(
        books,
        {
          sort: 'title_desc',
        }
      ).map((book) => book.title),
      [
        'Zebra Days',
        'Middle Ground',
        'Approved Work',
        'Amber Sky',
      ]
    );

    assert.deepEqual(
      filterAndSortBooks(
        books,
        {
          sort: 'last_modified',
        }
      ).map((book) => book.id),
      [
        'b-1',
        'b-3',
        'b-2',
        'b-4',
      ]
    );

    assert.deepEqual(
      filterAndSortBooks(
        books,
        {
          sort: 'newest',
        }
      ).map((book) => book.id),
      [
        'b-4',
        'b-2',
        'b-3',
        'b-1',
      ]
    );

    assert.deepEqual(
      filterAndSortBooks(
        books,
        {
          sort: 'oldest',
        }
      ).map((book) => book.id),
      [
        'b-1',
        'b-3',
        'b-2',
        'b-4',
      ]
    );
  }
);