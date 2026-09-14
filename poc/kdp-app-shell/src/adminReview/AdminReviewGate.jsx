import React from 'react';
import { AdminReviewPage } from './AdminReviewPage.jsx';
import { AdminReviewSkeleton } from './AdminReviewSkeleton.jsx';

const h = React.createElement;

export function AdminReviewGate({ privilegedApi, onBackToBookshelf, onSignOut }) {
  const params = new URLSearchParams(window.location.search);
  const bookId = params.get('book_id');
  const reviewRoundId = params.get('review_round_id');
  const step = params.get('review_step') || 'details';
  const [state, setState] = React.useState(bookId ? 'loading' : 'missing');
  const [payload, setPayload] = React.useState(null);
  const [message, setMessage] = React.useState('');

  React.useEffect(() => {
    if (!bookId) return undefined;
    let cancelled = false;
    setState('loading');
    privilegedApi.call('loadPrivilegedAdminReview', { bookId, reviewRoundId })
      .then((result) => { if (!cancelled) { setPayload(result); setState('ready'); } })
      .catch((error) => { if (!cancelled) { setMessage(error.message); setState('error'); } });
    return () => { cancelled = true; };
  }, [bookId, reviewRoundId, privilegedApi]);

  if (state === 'loading') return h(AdminReviewSkeleton);
  if (state === 'missing') return h('main', { className: 'kdp-app' }, h('div', { className: 'kdp-msg kdp-msg--error' }, h('p', { className: 'kdp-msg__label' }, 'Review not selected'), h('p', null, 'Return to Bookshelf and choose an assigned review.'), h('button', { type: 'button', className: 'kdp-btn kdp-btn--secondary', onClick: onBackToBookshelf }, 'Back to Bookshelf')));
  if (state === 'error') return h('main', { className: 'kdp-app' }, h('div', { className: 'kdp-msg kdp-msg--error' }, h('p', { className: 'kdp-msg__label' }, 'Admin review unavailable'), h('p', null, message || 'This review could not be loaded.'), h('button', { type: 'button', className: 'kdp-btn kdp-btn--secondary', onClick: onBackToBookshelf }, 'Back to Bookshelf')));
  return h(AdminReviewPage, { payload, initialStep: step, onBackToBookshelf, onSignOut, privilegedApi });
}
