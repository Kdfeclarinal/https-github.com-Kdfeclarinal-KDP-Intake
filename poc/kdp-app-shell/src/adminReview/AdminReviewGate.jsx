import React from 'react';
import { AdminReviewPage } from './AdminReviewPage.jsx';
import { AdminReviewSkeleton } from './AdminReviewSkeleton.jsx';
import { userFacingError } from '../errors/userFacingError.js';

const h = React.createElement;

export function AdminReviewGate({ privilegedApi, onBackToBookshelf, onSignOut }) {
  const params = new URLSearchParams(window.location.search);
  const bookId = params.get('book_id');
  const reviewRoundId = params.get('review_round_id');
  const step = params.get('review_step') || 'details';
  const [state, setState] = React.useState(bookId ? 'loading' : 'missing');
  const [payload, setPayload] = React.useState(null);
  const [message, setMessage] = React.useState('');
  const [retryVersion, setRetryVersion] = React.useState(0);

  React.useEffect(() => {
    if (!bookId) return undefined;
    let cancelled = false;
    setState('loading');
    privilegedApi.call('loadPrivilegedAdminReview', { bookId, reviewRoundId })
      .then((result) => { if (!cancelled) { setPayload(result); setState('ready'); } })
      .catch((error) => { if (!cancelled) { setMessage(userFacingError(error, 'This review could not be loaded. Try again.').message); setState('error'); } });
    return () => { cancelled = true; };
  }, [bookId, reviewRoundId, privilegedApi, retryVersion]);

  if (state === 'loading') return h(AdminReviewSkeleton);
  if (state === 'missing') return h('main', { className: 'kdp-app' }, h('div', { className: 'kdp-msg kdp-msg--error' }, h('p', { className: 'kdp-msg__label' }, 'Review not selected'), h('p', null, 'Return to Bookshelf and choose an assigned review.'), h('button', { type: 'button', className: 'kdp-btn kdp-btn--secondary', onClick: onBackToBookshelf }, 'Back to Bookshelf')));
  if (state === 'error') return h('main', { className: 'kdp-app' }, h('div', { className: 'kdp-msg kdp-msg--error' }, h('p', { className: 'kdp-msg__label' }, 'Admin review unavailable'), h('p', null, message || 'This review could not be loaded.'), h('div', { className: 'kdp-actions' }, h('button', { type: 'button', className: 'kdp-btn kdp-btn--secondary', onClick: onBackToBookshelf }, 'Back to Bookshelf'), h('button', { type: 'button', className: 'kdp-btn kdp-btn--primary', onClick: () => setRetryVersion((value) => value + 1) }, 'Try again'))));
  return h(AdminReviewPage, { payload, initialStep: step, onBackToBookshelf, onSignOut, privilegedApi });
}
