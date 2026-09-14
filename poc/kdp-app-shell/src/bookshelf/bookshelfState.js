const STATUS_GROUPS = {
  draft: new Set(['draft', 'employee_intake']),
  for_approval: new Set(['for_approval', 'submitted', 'submitted_for_approval', 'awaiting_review']),
  in_review: new Set(['in_review', 'in_admin_review']),
  approved: new Set(['approved', 'kdp_intake_approved']),
  needs_update: new Set(['needs_update', 'needs_updates', 'employee_updates']),
  archived: new Set(['archived']),
  deleted: new Set(['deleted']),
};

export const BOOKSHELF_FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'draft', label: 'Draft' },
  { value: 'for_approval', label: 'For Approval' },
  { value: 'in_review', label: 'In Review' },
  { value: 'approved', label: 'Approved' },
  { value: 'needs_update', label: 'Needs Update' },
];

export const BOOKSHELF_SORTS = [
  { value: 'last_modified', label: 'Last modified' },
  { value: 'title_asc', label: 'Title A-Z' },
  { value: 'title_desc', label: 'Title Z-A' },
  { value: 'newest', label: 'Newest' },
  { value: 'oldest', label: 'Oldest' },
];

export const BOOKSHELF_VIEWS = [
  { value: 'all', label: 'All titles' },
  { value: 'active', label: 'Active titles' },
  { value: 'archived', label: 'Archived titles' },
];

function key(value) {
  return String(value || '').trim().toLowerCase();
}

function belongsTo(status, group) {
  return STATUS_GROUPS[group]?.has(key(status)) || false;
}

export function humanBookStatus(status) {
  if (belongsTo(status, 'draft')) return 'Draft';
  if (belongsTo(status, 'for_approval')) return 'For Approval';
  if (belongsTo(status, 'in_review')) return 'In Review';
  if (belongsTo(status, 'approved')) return 'Approved';
  if (belongsTo(status, 'needs_update')) return 'Needs Update';
  if (belongsTo(status, 'archived')) return 'Archived';
  if (belongsTo(status, 'deleted')) return 'Deleted';
  return 'Status unavailable';
}

export function isEditableBookStatus(status) {
  return belongsTo(status, 'draft') || belongsTo(status, 'needs_update');
}

function titleOf(book) { return String(book.title || book.book_title || 'Untitled'); }
function authorOf(book) { return String(book.author || book.author_name || ''); }
function updatedOf(book) { return Date.parse(book.updatedAt || book.updated_at || '') || 0; }
function createdOf(book) { return Date.parse(book.createdAt || book.created_at || '') || 0; }

export function filterAndSortBooks(books, options = {}) {
  const query = String(options.query || '').trim().toLocaleLowerCase();
  const filter = options.filter || 'all';
  const view = options.view || 'all';
  const sort = options.sort || 'last_modified';

  const result = (Array.isArray(books) ? books : []).filter((book) => {
    const status = book.status || book.overall_status;
    if (view === 'active' && (belongsTo(status, 'archived') || belongsTo(status, 'deleted'))) return false;
    if (view === 'archived' && !belongsTo(status, 'archived')) return false;
    if (filter !== 'all' && !belongsTo(status, filter)) return false;
    return !query || `${titleOf(book)} ${authorOf(book)}`.toLocaleLowerCase().includes(query);
  });

  return result.sort((a, b) => {
    if (sort === 'title_asc') return titleOf(a).localeCompare(titleOf(b));
    if (sort === 'title_desc') return titleOf(b).localeCompare(titleOf(a));
    if (sort === 'newest') return createdOf(b) - createdOf(a);
    if (sort === 'oldest') return createdOf(a) - createdOf(b);
    return updatedOf(b) - updatedOf(a);
  });
}

export function bookshelfBookView(book) {
  const basecampStatus = ['ready', 'failed', 'incomplete'].includes(book.basecamp?.status)
    ? book.basecamp.status
    : 'incomplete';
  return {
    id: book.id || book.book_id || '',
    title: titleOf(book),
    author: authorOf(book) || 'Author unavailable',
    type: book.type || book.book_type || 'Kindle eBook',
    status: humanBookStatus(book.status || book.overall_status),
    editable: isEditableBookStatus(book.status || book.overall_status),
    updatedAt: book.updatedAt || book.updated_at || null,
    coverUrl: book.coverUrl || book.cover_url || null,
    intakeUrl: book.intakeUrl || book.intake_url || null,
    reviewAvailable: book.reviewAvailable === true,
    basecamp: {
      status: basecampStatus,
      retryAvailable: basecampStatus !== 'ready' && book.basecamp?.retryAvailable === true,
      retryKind: ['review_round', 'review_outcome'].includes(book.basecamp?.retryKind) ? book.basecamp.retryKind : 'book_setup',
    },
  };
}
