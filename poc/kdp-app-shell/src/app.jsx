import React from 'react';
import { createRoot } from 'react-dom/client';
import './app.css';
import { DetailsPage } from './details/DetailsPage.jsx';

// Stage B1: ONE protected employee read via the existing loadEmployeePage Edge Function.
// READ ONLY. No write, no storage, no new dependency.
const READ_ENDPOINT = 'https://wpuexhsrhuxieobeanjr.supabase.co/functions/v1/loadEmployeePage';

function useProtectedEmployeeRead() {
  // 'loading' | 'missing' | 'success' | 'error'
  const [state, setState] = React.useState('loading');
  const [book, setBook] = React.useState(null);
  const [stepName, setStepName] = React.useState(null);
  const [httpStatus, setHttpStatus] = React.useState(null);
  const called = React.useRef(false);

  if (!called.current) {
    called.current = true;

    const params = new URLSearchParams(window.location.search);
    const bookId = params.get('book_id');
    const accessToken = params.get('access_token');

    if (!bookId || !accessToken) {
      setState('missing');
    } else {
      // accessToken exists only in this local scope, only long enough to make the request.
      fetch(READ_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ book_id: bookId, access_token: accessToken, step_name: 'details' }),
      })
        .then((res) => {
          setHttpStatus(res.status);
          const ok = res.ok; // captured from the live Response before any async state update
          return res.json().catch(() => null).then((data) => ({ ok, data }));
        })
        .then(({ ok, data }) => {
          // Success requires a real 2xx response, the backend's own ok flag, and a book payload.
          // Never trust only the browser; never let a blank display field fail the read.
          if (ok === true && data && data.ok === true && data.book) {
            setBook(data.book);
            setStepName(data.step_name || null);
            setState('success');
          } else {
            setState('error');
          }
        })
        .catch(() => setState('error'));
    }
  }

  return { state, book, stepName, httpStatus };
}

function ProtectedReadGate() {
  const { state, book, stepName, httpStatus } = useProtectedEmployeeRead();

  if (state === 'missing') {
    return React.createElement(
      'div',
      { className: 'kdp-msg kdp-msg--missing' },
      React.createElement('p', { className: 'kdp-msg__label' }, 'Protected read not started.'),
      React.createElement(
        'p',
        { className: 'kdp-msg__hint' },
        'Open this staging page with the disposable test book parameters.'
      )
    );
  }

  if (state === 'loading') {
    return React.createElement('p', { className: 'kdp-msg__label' }, 'Protected read: Loading…');
  }

  if (state === 'error') {
    return React.createElement(
      'div',
      { className: 'kdp-msg kdp-msg--error' },
      React.createElement('p', { className: 'kdp-msg__label' }, 'Protected read: Failed'),
      React.createElement(
        'p',
        { className: 'kdp-msg__hint' },
        'The test book could not be loaded with this access context.'
      ),
      httpStatus
        ? React.createElement('p', { className: 'kdp-msg__status' }, 'HTTP status: ' + httpStatus)
        : null
    );
  }

  // success — hydrate the Details form from the protected payload.
  return React.createElement(DetailsPage, { book, stepName });
}

function App() {
  return React.createElement(ProtectedReadGate);
}

// Smallest reliable idempotency guard: a module-level boolean.
// Rejects repeated mounts from DOMContentLoaded, hydrationDone (fired any
// number of times), or any other re-invocation. No storage used.
let mounted = false;

function mountOnce() {
  if (mounted) return;
  const root = document.getElementById('kdp-intake-app');
  if (!root) return;
  mounted = true;
  createRoot(root).render(React.createElement(App));
}

// 1 + 2: document already ready OR wait for DOMContentLoaded.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mountOnce);
} else {
  mountOnce();
}

// 3 + 4 + 5: GHL hydrationDone may fire 0, 1, or many times; mount stays once.
window.addEventListener('hydrationDone', mountOnce);
