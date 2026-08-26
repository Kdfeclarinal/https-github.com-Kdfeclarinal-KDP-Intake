import React from 'react';
import { createRoot } from 'react-dom/client';
import './app.css';

function App() {
  return React.createElement(
    'section',
    { className: 'kdp-shell' },
    React.createElement('h1', { className: 'kdp-shell__title' }, 'KDP App Shell POC'),
    React.createElement('p', { className: 'kdp-shell__status' }, 'React mounted successfully.'),
    React.createElement('p', { className: 'kdp-shell__mount' }, 'Mount status: Ready')
  );
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
