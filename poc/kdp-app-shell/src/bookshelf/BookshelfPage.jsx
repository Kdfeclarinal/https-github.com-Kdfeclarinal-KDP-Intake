import React from 'react';
import { BrandLogo } from './BrandLogo.jsx';
import {
  BOOKSHELF_FILTERS,
  BOOKSHELF_SORTS,
  BOOKSHELF_VIEWS,
  bookshelfBookView,
  filterAndSortBooks,
} from './bookshelfState.js';

const h = React.createElement;

function Dropdown({ id, label, value, options, open, onOpen, onChange }) {
  const selected = options.find((option) => option.value === value) || options[0];
  return h('div', { className: 'kdp-bookshelf-control' },
    h('span', { className: 'kdp-bookshelf-control__label' }, label),
    h('div', { className: `kdp-bookshelf-dropdown${open ? ' is-open' : ''}`, 'data-menu': id },
      h('button', {
        type: 'button',
        className: 'kdp-bookshelf-dropdown__trigger',
        onClick: () => onOpen(open ? null : id),
        'aria-haspopup': 'listbox',
        'aria-expanded': open ? 'true' : 'false',
        'aria-controls': `bookshelf-${id}-menu`,
        'aria-label': `${label}: ${selected.label}`,
      }, h('span', null, selected.label), h('svg', { viewBox: '0 0 12 8', 'aria-hidden': 'true' }, h('path', { d: 'M1 1.5 6 6.5l5-5' }))),
      h('div', { className: 'kdp-bookshelf-menu', id: `bookshelf-${id}-menu` },
        h('div', { className: 'kdp-bookshelf-menu__inner', role: 'listbox', 'aria-label': label },
          options.map((option) => h('button', {
            type: 'button',
            role: 'option',
            'aria-selected': option.value === value ? 'true' : 'false',
            className: option.value === value ? 'is-selected' : '',
            key: option.value,
            onClick: () => { onChange(option.value); onOpen(null); },
          }, option.label))
        )
      )
    )
  );
}

function BookCover({ book }) {
  if (book.coverUrl) {
    return h('img', { className: 'kdp-bookshelf-book__cover', src: book.coverUrl, alt: `Cover of ${book.title}`, loading: 'lazy', referrerPolicy: 'no-referrer' });
  }
  return h('div', { className: 'kdp-bookshelf-book__cover kdp-bookshelf-book__cover--empty', 'aria-label': `No cover uploaded for ${book.title}` }, h('span', null, 'No cover', h('br'), 'uploaded'));
}

function ManageMenu({ book, open, onOpen, onRequestAction }) {
  return h('div', { className: `kdp-manage-menu${open ? ' is-open' : ''}` },
    h('button', { type: 'button', className: 'kdp-link-button kdp-manage-menu__trigger', onClick: () => onOpen(open ? null : book.id), 'aria-expanded': open ? 'true' : 'false', 'aria-haspopup': 'menu' }, 'Manage title', h('svg', { viewBox: '0 0 12 8', 'aria-hidden': 'true' }, h('path', { d: 'M1 1.5 6 6.5l5-5' }))),
    h('div', { className: 'kdp-manage-menu__panel' }, h('div', { className: 'kdp-manage-menu__inner', role: 'menu' },
      h('button', { type: 'button', role: 'menuitem', onClick: () => onRequestAction('archive', book) }, 'Archive title'),
      h('button', { type: 'button', role: 'menuitem', className: 'is-danger', onClick: () => onRequestAction('delete', book) }, 'Delete title')
    ))
  );
}

function formatDate(value) {
  if (!value) return 'Date unavailable';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Date unavailable';
  return new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'long', day: 'numeric' }).format(date);
}

function SafeActionDialog({ request, onClose }) {
  if (!request) return null;
  const verb = request.action === 'delete' ? 'Delete' : 'Archive';
  return h('div', { className: 'kdp-modal-overlay', role: 'presentation', onMouseDown: (event) => { if (event.target === event.currentTarget) onClose(); } },
    h('div', { className: 'kdp-modal kdp-bookshelf-action-modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'bookshelf-action-title' },
      h('div', { className: 'kdp-modal__header' }, h('h2', { id: 'bookshelf-action-title', className: 'kdp-modal__title' }, `${verb} title?`)),
      h('p', null, `${verb} is not available until the privileged server action contract is connected. No changes have been made to “${request.book.title}.”`),
      h('div', { className: 'kdp-bookshelf-action-modal__actions' }, h('button', { type: 'button', className: 'kdp-btn kdp-btn--secondary', onClick: onClose, autoFocus: true }, 'Close'), h('button', { type: 'button', className: 'kdp-btn kdp-btn--primary', disabled: true, 'aria-disabled': 'true' }, `${verb} title`))
    )
  );
}

export function BookshelfPage({ books = [], identity, canCreateBook, onNavigate, onOpenReview, onSignOut, privilegedApi }) {
  const [openMenu, setOpenMenu] = React.useState(null);
  const [view, setView] = React.useState('all');
  const [sort, setSort] = React.useState('last_modified');
  const [filter, setFilter] = React.useState('all');
  const [searchDraft, setSearchDraft] = React.useState('');
  const [query, setQuery] = React.useState('');
  const [actionRequest, setActionRequest] = React.useState(null);
  const [retryingBookId, setRetryingBookId] = React.useState(null);
  const [integrationNotice, setIntegrationNotice] = React.useState(null);
  const shellRef = React.useRef(null);

  React.useEffect(() => {
    function closeOnOutside(event) { if (!shellRef.current?.contains(event.target)) setOpenMenu(null); }
    function closeOnEscape(event) { if (event.key === 'Escape') { setOpenMenu(null); setActionRequest(null); } }
    document.addEventListener('pointerdown', closeOnOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => { document.removeEventListener('pointerdown', closeOnOutside); document.removeEventListener('keydown', closeOnEscape); };
  }, []);

  const visibleBooks = filterAndSortBooks(books, { view, sort, filter, query });
  const submitSearch = (event) => { event.preventDefault(); setQuery(searchDraft); setOpenMenu(null); };
  const retryBasecamp = async (book) => {
    setRetryingBookId(book.id); setIntegrationNotice(null);
    const functionName = book.basecamp.retryKind === 'review_outcome'
      ? 'retryBasecampReviewOutcome'
      : book.basecamp.retryKind === 'review_round' ? 'retryBasecampReviewLifecycle' : 'retryBasecampProvisioning';
    try { await privilegedApi.call(functionName, { bookId: book.id }); await privilegedApi.refresh(); }
    catch (error) { setIntegrationNotice(error.message); }
    finally { setRetryingBookId(null); }
  };

  return h('main', { className: 'kdp-app kdp-app--privileged kdp-app--bookshelf', ref: shellRef },
    h('div', { className: 'kdp-privileged-session' }, h('span', null, identity?.displayName || 'Privileged user'), h('button', { type: 'button', className: 'kdp-link-button', onClick: onSignOut }, 'Sign out')),
    h('header', { className: 'kdp-bookshelf-hero' },
      h(BrandLogo),
      h('h1', null, 'Create. Manage. Publish.'),
      h('p', null, 'Reach readers in the format they want. Prepare an eBook, paperback, hardcover, or series for your publishing workflow.'),
      h('button', { type: 'button', className: 'kdp-btn kdp-btn--primary kdp-bookshelf-create', disabled: !canCreateBook, title: canCreateBook ? undefined : 'Book creation capability is required.', onClick: () => onNavigate('create-new') }, '+ Create new title or series')
    ),
    h('section', { className: 'kdp-bookshelf-workspace', 'aria-labelledby': 'bookshelf-heading' },
      h('div', { className: 'kdp-bookshelf-heading-row' }, h('h2', { id: 'bookshelf-heading' }, 'Bookshelf'), books.length ? h('span', null, `${visibleBooks.length} of ${books.length} titles`) : null),
      integrationNotice ? h('div', { className: 'kdp-create-notice', role: 'status' }, integrationNotice) : null,
      h('form', { className: 'kdp-bookshelf-controls', onSubmit: submitSearch },
        h(Dropdown, { id: 'view', label: 'View', value: view, options: BOOKSHELF_VIEWS, open: openMenu === 'view', onOpen: setOpenMenu, onChange: setView }),
        h(Dropdown, { id: 'sort', label: 'Sort by', value: sort, options: BOOKSHELF_SORTS, open: openMenu === 'sort', onOpen: setOpenMenu, onChange: setSort }),
        h(Dropdown, { id: 'filter', label: 'Filter by', value: filter, options: BOOKSHELF_FILTERS, open: openMenu === 'filter', onOpen: setOpenMenu, onChange: setFilter }),
        h('label', { className: 'kdp-bookshelf-search' }, h('span', { className: 'kdp-bookshelf-control__label' }, 'Search by title'), h('span', { className: 'kdp-bookshelf-search__field' }, h('svg', { viewBox: '0 0 20 20', 'aria-hidden': 'true' }, h('circle', { cx: 8.5, cy: 8.5, r: 5.5 }), h('path', { d: 'm12.5 12.5 4 4' })), h('input', { type: 'search', value: searchDraft, onChange: (event) => setSearchDraft(event.target.value), placeholder: 'Title or author' }))),
        h('button', { type: 'submit', className: 'kdp-btn kdp-btn--secondary kdp-bookshelf-search-button' }, 'Search')
      ),
      h('div', { className: 'kdp-bookshelf-list' },
        visibleBooks.length ? visibleBooks.map((rawBook) => {
          const book = bookshelfBookView(rawBook);
          return h('article', { className: 'kdp-bookshelf-book', key: book.id || book.title },
            h(BookCover, { book }),
            h('div', { className: 'kdp-bookshelf-book__details' }, h('h3', null, book.title), h('p', { className: 'kdp-bookshelf-book__author' }, `by ${book.author}`), h('div', { className: 'kdp-bookshelf-book__meta' }, h('strong', null, book.type), h('span', { className: `kdp-bookshelf-status kdp-bookshelf-status--${book.status.toLowerCase().replaceAll(' ', '-')}` }, book.status), h('span', null, `Last modified on ${formatDate(book.updatedAt)}`)), book.basecamp.status !== 'ready' ? h('div', { className: `kdp-bookshelf-integration kdp-bookshelf-integration--${book.basecamp.status}` }, h('span', null, book.basecamp.status === 'failed' ? 'Basecamp setup needs attention' : 'Basecamp setup is pending'), book.basecamp.retryAvailable ? h('button', { type: 'button', className: 'kdp-link-button', disabled: retryingBookId === book.id, onClick: () => retryBasecamp(book) }, retryingBookId === book.id ? 'Retrying…' : book.basecamp.retryKind === 'review_outcome' ? 'Retry outcome sync' : book.basecamp.retryKind === 'review_round' ? 'Retry review task' : 'Retry setup') : null) : null),
            h('div', { className: 'kdp-bookshelf-book__actions' }, h(ManageMenu, { book, open: openMenu === `manage-${book.id}`, onOpen: (id) => setOpenMenu(id ? `manage-${id}` : null), onRequestAction: (action, item) => { setOpenMenu(null); setActionRequest({ action, book: item }); } }), h('button', { type: 'button', className: 'kdp-btn kdp-btn--secondary', disabled: !book.reviewAvailable, title: book.reviewAvailable ? 'Open assigned admin review.' : 'No assigned active review is available.', onClick: book.reviewAvailable ? () => onOpenReview(book.id) : undefined }, 'Open'))
          );
        }) : h('div', { className: 'kdp-bookshelf-empty' },
          h('h3', null, query || filter !== 'all' || view !== 'all' ? 'No titles match these controls' : 'Publishing workspace is ready'),
          h('p', null, query || filter !== 'all' || view !== 'all' ? 'Try a different search, view, or workflow filter.' : 'No titles are available yet. Use Create new title or series to choose a publishing format.'),
          query || filter !== 'all' || view !== 'all' ? h('button', { type: 'button', className: 'kdp-link-button', onClick: () => { setSearchDraft(''); setQuery(''); setFilter('all'); setView('all'); } }, 'Clear controls') : null
        )
      )
    ),
    h(SafeActionDialog, { request: actionRequest, onClose: () => setActionRequest(null) })
  );
}
