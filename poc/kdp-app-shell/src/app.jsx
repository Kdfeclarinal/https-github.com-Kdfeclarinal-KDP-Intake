import React from 'react';
import { createRoot } from 'react-dom/client';
import './app.css';
import { DetailsPage } from './details/DetailsPage.jsx';
import { ContentPage } from './content/ContentPage.jsx';
import { PricingPage } from './pricing/PricingPage.jsx';
import { EmployeePageSkeleton } from './skeleton/EmployeePageSkeleton.jsx';
import { BookshelfPage } from './bookshelf/BookshelfPage.jsx';
import { CreateNewPage } from './bookshelf/CreateNewPage.jsx';
import { PrivilegedGate } from './privileged/PrivilegedGate.jsx';
import { AdminReviewGate } from './adminReview/AdminReviewGate.jsx';
import { EmployeeUpdateContext, EmployeeUpdateNotice } from './employeeUpdates/EmployeeUpdateNotice.jsx';

// Stage B1: ONE protected employee read via the existing loadEmployeePage Edge Function.
// READ ONLY. No write, no storage, no new dependency.
const READ_ENDPOINT = 'https://wpuexhsrhuxieobeanjr.supabase.co/functions/v1/loadEmployeePage';

function useProtectedEmployeeRead(step) {
  // 'loading' | 'missing' | 'success' | 'error'
  const [state, setState] = React.useState('loading');
  const [book, setBook] = React.useState(null);
  const [stepName, setStepName] = React.useState(null);
  const [httpStatus, setHttpStatus] = React.useState(null);
  const [bookId, setBookId] = React.useState(null);
  const [accessToken, setAccessToken] = React.useState(null); // runtime URL value; memory only, never persisted
  const [savedState, setSavedState] = React.useState(null);
  const [progressState, setProgressState] = React.useState(null);
  // T4: surface the live persisted file records from loadEmployeePage. The
  // backend is authoritative for whether a manuscript/cover actually exists;
  // the local upload success state is a transient signal only. We tolerate a
  // missing or non-array `files` and default to an empty list so the page
  // never crashes on a payload that pre-dates this field.
  const [files, setFiles] = React.useState([]);
  const [employeeUpdate, setEmployeeUpdate] = React.useState(null);

  // Re-run the protected read whenever the requested step changes (Details ->
  // Content navigation). book_id + access_token are read from the URL once.
  React.useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams(window.location.search);
    const bookId = params.get('book_id');
    const accessToken = params.get('access_token');

    setState('loading');
    setBook(null);
    setStepName(null);
    setSavedState(null);
    setProgressState(null);
    setFiles([]);
    setEmployeeUpdate(null);

    if (!bookId || !accessToken) {
      setState('missing');
      return;
    }
    setBookId(bookId);
    setAccessToken(accessToken);
    // accessToken exists only in this closure, only long enough to make the request.
    fetch(READ_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ book_id: bookId, access_token: accessToken, step_name: step }),
    })
      .then((res) => {
        if (cancelled) return null;
        setHttpStatus(res.status);
        const ok = res.ok; // captured from the live Response before any async state update
        return res.json().catch(() => null).then((data) => ({ ok, data }));
      })
      .then((result) => {
        if (cancelled || !result) return;
        const { ok, data } = result;
        // Success requires a real 2xx response, the backend's own ok flag, and a book payload.
        // Never trust only the browser; never let a blank display field fail the read.
        if (ok === true && data && data.ok === true && data.book) {
          setBook(data.book);
          setStepName((data.step_name) || (data.step_data && data.step_data.step_name) || null);
          // Hydration source for a previously-saved step form (when the backend
          // returns it); absent on a fresh book. The real loadEmployeePage nests
          // state_json under step_data; tolerate the legacy top-level shape too.
          const sj = data.step_data && data.step_data.state_json ? data.step_data.state_json : data.state_json;
          if (sj) setSavedState(sj);
          if (data.progress_state) setProgressState(data.progress_state);
          // T4: the live contract returns a top-level `files` array. Default
          // to an empty list when absent so the Content page never treats
          // an unknown field as a non-empty record.
          setFiles(Array.isArray(data.files) ? data.files : []);
          setEmployeeUpdate(data.employee_update || null);
          setState('success');
        } else {
          setState('error');
        }
      })
      .catch(() => { if (!cancelled) setState('error'); });

    return () => { cancelled = true; };
  }, [step]);

  return { state, book, stepName, httpStatus, bookId, accessToken, savedState, progressState, files, employeeUpdate };
}

function ProtectedReadGate() {
  // Which step is being viewed. Defaults to 'details' (preserves the Stage B1
  // behavior). The Content page is reached by navigating to step 'content'
  // (progress card / URL ?step=content). The backend receives step_name and is
  // authoritative on which step is unlocked for this access context.
  const initialStep = new URLSearchParams(window.location.search).get('step') || 'details';
  const [step, setStep] = React.useState(initialStep);
  const { state, book, stepName, httpStatus, bookId, accessToken, savedState, progressState, files, employeeUpdate } =
    useProtectedEmployeeRead(step);
  React.useEffect(() => {
    const syncStep = () => {
      const requested = new URLSearchParams(window.location.search).get('step') || 'details';
      if (['details', 'content', 'pricing'].includes(requested)) setStep(requested);
    };
    window.addEventListener('popstate', syncStep);
    return () => window.removeEventListener('popstate', syncStep);
  }, []);

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
    // T2: render the shared employee page skeleton during the initial
    // protected read. One component, used by all three employee steps
    // (Details / Content / Pricing). The skeleton announces itself
    // visually only (aria-hidden inside the component) and inherits the
    // prefers-reduced-motion media query for the shimmer.
    return React.createElement(EmployeePageSkeleton, { variant: step });
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

  // success — hydrate the active step's form from the protected payload.
  const navigate = (nextStep) => {
    if (nextStep === step || !['details', 'content', 'pricing'].includes(nextStep)) return;
    const url = new URL(window.location.href);
    url.searchParams.set('step', nextStep);
    window.history.pushState({}, '', url);
    setStep(nextStep);
  };
  if (step === 'content') {
    return React.createElement(EmployeeUpdateContext.Provider, { value: employeeUpdate }, React.createElement(EmployeeUpdateNotice, { context: employeeUpdate, bookId, accessToken }), React.createElement(ContentPage, {
      book,
      stepName,
      bookId,
      accessToken,
      savedState,
      initialProgress: progressState,
      // T4: ContentPage reads `files` as the authoritative source for
      // manuscript/cover presence, view URLs, and the cover thumbnail.
      // DetailsPage is intentionally unchanged.
      files,
      onNavigate: navigate,
    }));
  }
  if (step === 'pricing') {
    return React.createElement(EmployeeUpdateContext.Provider, { value: employeeUpdate }, React.createElement(EmployeeUpdateNotice, { context: employeeUpdate, bookId, accessToken }), React.createElement(PricingPage, {
      book, bookId, accessToken, savedState,
      initialProgress: progressState, files, onNavigate: navigate, employeeUpdate,
    }));
  }
  return React.createElement(EmployeeUpdateContext.Provider, { value: employeeUpdate }, React.createElement(EmployeeUpdateNotice, { context: employeeUpdate, bookId, accessToken }), React.createElement(DetailsPage, {
    book,
    stepName,
    bookId,
    accessToken,
    savedState,
    initialProgress: progressState,
    onNavigate: navigate,
  }));
}

function App() {
  const initialView = new URLSearchParams(window.location.search).get('view');
  const [view, setView] = React.useState(initialView);

  React.useEffect(() => {
    const syncRoute = () => setView(new URLSearchParams(window.location.search).get('view'));
    window.addEventListener('popstate', syncRoute);
    return () => window.removeEventListener('popstate', syncRoute);
  }, []);

  const navigateView = (nextView) => {
    const url = new URL(window.location.href);
    url.searchParams.set('view', nextView);
    if (nextView !== 'admin-review') {
      url.searchParams.delete('book_id');
      url.searchParams.delete('review_step');
    }
    window.history.pushState({}, '', url);
    setView(nextView);
  };

  const openAdminReview = (bookId) => {
    const url = new URL(window.location.href);
    url.searchParams.set('view', 'admin-review');
    url.searchParams.set('book_id', bookId);
    url.searchParams.set('review_step', 'details');
    window.history.pushState({}, '', url);
    setView('admin-review');
  };

  if (view === 'bookshelf' || view === 'create-new' || view === 'admin-review') {
    return React.createElement(PrivilegedGate, null, (context, onSignOut, privilegedApi) => view === 'bookshelf'
      ? React.createElement(BookshelfPage, {
          books: context.books,
          identity: context.identity,
          canCreateBook: context.canCreateBook,
          onSignOut,
          onNavigate: navigateView,
          onOpenReview: openAdminReview,
          privilegedApi,
        })
      : view === 'create-new' ? React.createElement(CreateNewPage, {
          onNavigate: navigateView,
          canCreateBook: context.canCreateBook,
          identity: context.identity,
          onSignOut,
          privilegedApi,
          onCreated: async () => { await privilegedApi.refresh(); navigateView('bookshelf'); },
        })
      : React.createElement(AdminReviewGate, {
          privilegedApi,
          onBackToBookshelf: () => navigateView('bookshelf'),
          onSignOut,
        }));
  }
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
