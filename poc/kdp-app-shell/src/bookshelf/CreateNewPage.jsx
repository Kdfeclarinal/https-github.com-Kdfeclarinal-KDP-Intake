import React from 'react';
import { BrandLogo } from './BrandLogo.jsx';

const h = React.createElement;
const TYPES = [
  { id: 'ebook', title: 'Kindle eBook', description: 'Prepare a digital edition for Kindle and other eBook readers.', action: 'Create eBook', active: true },
  { id: 'paperback', title: 'Paperback', description: 'Prepare a print edition that can be produced and shipped to readers.', action: 'Create paperback' },
  { id: 'hardcover', title: 'Hardcover', description: 'Prepare a case-bound print edition for your publishing catalog.', action: 'Create hardcover' },
  { id: 'series', title: 'Series Page', description: 'Bring related titles together in a single series experience.', action: 'Create series page' },
];

export function CreateNewPage({ onNavigate, canCreateBook, privilegedApi, onCreated }) {
  const [notice, setNotice] = React.useState(null);
  const [mode, setMode] = React.useState('types');
  const [options, setOptions] = React.useState(null);
  const [employeePersonId, setEmployeePersonId] = React.useState('');
  const [reviewerUserId, setReviewerUserId] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  async function selectType(type) {
    if (type.active) {
      if (!canCreateBook) {
        setNotice('Your current application permissions do not allow book creation. No book was created.');
        return;
      }
      setBusy(true); setNotice(null);
      try {
        const loaded = await privilegedApi.call('loadCreateBookOptions', {});
        setOptions(loaded);
        setReviewerUserId(loaded.defaultReviewerId || '');
        setMode('ebook');
      } catch (error) { setNotice(error.message); }
      finally { setBusy(false); }
      return;
    }
    setNotice(`${type.title} is coming soon.`);
  }

  async function createBook(event) {
    event.preventDefault();
    if (!employeePersonId || !reviewerUserId) { setNotice('Select an employee and reviewer.'); return; }
    setBusy(true); setNotice(null);
    try {
      await privilegedApi.call('createPrivilegedBook', { employeePersonId, reviewerUserId });
      try { await onCreated(); }
      catch { setNotice('The book was created, but Bookshelf could not refresh. Return to Bookshelf and try again.'); setBusy(false); }
    } catch (error) { setNotice(error.message); setBusy(false); }
  }

  return h('main', { className: 'kdp-app kdp-app--privileged kdp-app--create-new' },
    h('header', { className: 'kdp-create-new-header' },
      h('nav', { className: 'kdp-breadcrumb', 'aria-label': 'Breadcrumb' }, h('a', { href: '?view=bookshelf', onClick: (event) => { event.preventDefault(); onNavigate('bookshelf'); } }, 'Bookshelf'), h('svg', { viewBox: '0 0 8 12', 'aria-hidden': 'true' }, h('path', { d: 'm1.5 1 5 5-5 5' })), h('span', { 'aria-current': 'page' }, 'Create New')),
      h(BrandLogo, { className: 'kdp-brand-logo--create-new' })
    ),
    h('section', { className: 'kdp-create-new-content' },
      h('div', { className: 'kdp-create-new-intro' }, h('h1', null, mode === 'ebook' ? 'Create Kindle eBook' : 'What would you like to create?'), h('p', null, mode === 'ebook' ? 'Assign the employee who will complete Intake and the eligible reviewer for this title.' : "Pick an option and we'll get you started. You can save your progress as you go.")),
      notice ? h('div', { className: 'kdp-create-notice', role: 'status', 'aria-live': 'polite' }, notice) : null,
      mode === 'types'
        ? h('div', { className: 'kdp-create-grid' }, TYPES.map((type) => h('article', { className: `kdp-create-card${type.active ? ' is-active' : ''}`, key: type.id }, h('h2', null, type.title), h('span', { className: 'kdp-create-card__rule', 'aria-hidden': 'true' }), h('p', null, type.description), h('button', { type: 'button', disabled: busy, className: 'kdp-btn kdp-btn--primary', onClick: () => selectType(type) }, busy && type.active ? 'Loading…' : type.action))))
        : h('form', { className: 'kdp-create-book-form', onSubmit: createBook },
            h('label', null, h('span', null, 'Employee'), h('select', { value: employeePersonId, onChange: (event) => setEmployeePersonId(event.target.value), required: true }, h('option', { value: '' }, 'Select a Pre-Press project member'), ...(options?.employees || []).map((employee) => h('option', { key: employee.id, value: employee.id }, employee.displayName)))),
            h('label', null, h('span', null, 'Reviewer'), h('select', { value: reviewerUserId, onChange: (event) => setReviewerUserId(event.target.value), required: true }, h('option', { value: '' }, 'Select an eligible reviewer'), ...(options?.reviewers || []).map((reviewer) => h('option', { key: reviewer.id, value: reviewer.id }, reviewer.displayName)))),
            h('p', { className: 'kdp-create-book-form__hint' }, 'The Kindle eBook record is created in KDP Intake first. Basecamp setup continues separately and can be retried if needed.'),
            h('div', { className: 'kdp-create-book-form__actions' },
              h('button', { type: 'button', className: 'kdp-btn kdp-btn--secondary', disabled: busy, onClick: () => { setMode('types'); setNotice(null); } }, 'Back'),
              h('button', { type: 'submit', className: 'kdp-btn kdp-btn--primary', disabled: busy }, busy ? 'Creating…' : 'Create Kindle eBook')
            )
          )
    )
  );
}
