import React from 'react';
import { createRoot } from 'react-dom/client';
import './app.css';

// Stage A shell — unchanged.
function Shell({ children }) {
  return React.createElement(
    'section',
    { className: 'kdp-shell' },
    React.createElement('h1', { className: 'kdp-shell__title' }, 'KDP App Shell POC'),
    React.createElement('p', { className: 'kdp-shell__status' }, 'React mounted successfully.'),
    React.createElement('p', { className: 'kdp-shell__mount' }, 'Mount status: Ready'),
    children
  );
}

// Stage B1: ONE protected employee read via the existing loadEmployeePage Edge Function.
// READ ONLY. No write, no storage, no new dependency.
const READ_ENDPOINT = 'https://wpuexhsrhuxieobeanjr.supabase.co/functions/v1/loadEmployeePage';

function StageB1() {
  const [state, setState] = React.useState('loading'); // loading | success | error | missing
  const [safe, setSafe] = React.useState({});
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
            setSafe({
              title: data.book.book_title || 'Not set',
              status: data.book.overall_status,
              step: data.book.current_employee_step,
              stepName: data.step_name,
            });
            setState('success');
          } else {
            setState('error');
          }
        })
        .catch(() => setState('error'));
    }
  }

  if (state === 'missing') {
    return React.createElement(
      'div',
      { className: 'kdp-b1 kdp-b1--missing' },
      React.createElement('p', { className: 'kdp-b1__label' }, 'Protected read not started.'),
      React.createElement(
        'p',
        { className: 'kdp-b1__hint' },
        'Open this staging page with the disposable test book parameters.'
      )
    );
  }

  if (state === 'loading') {
    return React.createElement('p', { className: 'kdp-b1__label' }, 'Protected read: Loading…');
  }

  if (state === 'error') {
    return React.createElement(
      'div',
      { className: 'kdp-b1 kdp-b1--error' },
      React.createElement('p', { className: 'kdp-b1__label' }, 'Protected read: Failed'),
      React.createElement(
        'p',
        { className: 'kdp-b1__hint' },
        'The test book could not be loaded with this access context.'
      ),
      httpStatus
        ? React.createElement('p', { className: 'kdp-b1__status' }, 'HTTP status: ' + httpStatus)
        : null
    );
  }

  // success — render only useful non-sensitive fields.
  return React.createElement(
    'div',
    { className: 'kdp-b1 kdp-b1--success' },
    React.createElement('p', { className: 'kdp-b1__label' }, 'Protected read: Success'),
    safe.title ? React.createElement('p', { className: 'kdp-b1__row' }, 'Book: ' + safe.title) : null,
    safe.status ? React.createElement('p', { className: 'kdp-b1__row' }, 'Status: ' + safe.status) : null,
    safe.step ? React.createElement('p', { className: 'kdp-b1__row' }, 'Step: ' + safe.step) : null,
    safe.stepName ? React.createElement('p', { className: 'kdp-b1__row' }, 'Step name: ' + safe.stepName) : null
  );
}

function App() {
  return React.createElement(Shell, null, React.createElement(StageB1));
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
