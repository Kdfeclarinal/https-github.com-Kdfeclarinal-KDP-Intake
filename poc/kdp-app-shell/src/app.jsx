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
import { SettingsPage } from './settings/SettingsPage.jsx';

// Stage B1: ONE protected employee read via the existing loadEmployeePage Edge Function.
// READ ONLY. No write, no storage, no new dependency.
const READ_ENDPOINT = 'https://wpuexhsrhuxieobeanjr.supabase.co/functions/v1/loadEmployeePage';
const EXCHANGE_ENDPOINT = 'https://wpuexhsrhuxieobeanjr.supabase.co/functions/v1/exchangeEmployeeAccess';
const employeeSessionKey = (bookId) => `kdp:employee-session:${bookId}`;

function sanitizeEmployeeUrl() {
  const url = new URL(window.location.href);
  url.searchParams.delete('access_token');
  window.history.replaceState({}, '', url);
}

function SubmittedForReview({ book }) {
  const approved = ['approved', 'KDP_INTAKE_APPROVED'].includes(String(book?.overall_status || ''));
  return React.createElement(
    'main',
    { className: 'kdp-app kdp-employee-readonly' },
    React.createElement('section', { className: 'kdp-employee-readonly__card', role: 'status' },
      React.createElement('span', { className: 'kdp-employee-readonly__eyebrow' }, approved ? 'KDP Intake complete' : 'KDP Intake submitted'),
      React.createElement('h1', null, approved ? 'KDP Intake Approved' : 'Submitted for Review'),
      React.createElement('p', null, approved
        ? 'This intake has been approved and is read-only.'
        : 'Your intake was submitted successfully and is now read-only while the reviewer is working.'),
      React.createElement('p', { className: 'kdp-employee-readonly__hint' }, approved
        ? 'No further employee changes are available from this link.'
        : 'If updates are requested, this same book link will reopen the requested sections for you.')
    )
  );
}

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
  const [employeeRevision, setEmployeeRevision] = React.useState(0);
  const [employeeMode, setEmployeeMode] = React.useState('intake');
  const [canEdit, setCanEdit] = React.useState(true);
  const [refreshVersion, setRefreshVersion] = React.useState(0);

  // Re-run the protected read whenever the requested step changes (Details ->
  // Content navigation). book_id + access_token are read from the URL once.
  React.useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams(window.location.search);
    const requestedBookId = params.get('book_id');
    const launcherToken = params.get('access_token');

    setState('loading');
    setBook(null);
    setStepName(null);
    setSavedState(null);
    setProgressState(null);
    setFiles([]);
    setEmployeeUpdate(null);
    setEmployeeRevision(0);
    setEmployeeMode('intake');
    setCanEdit(true);

    if (!requestedBookId) {
      setState('missing');
      return;
    }

    setBookId(requestedBookId);

    async function readEmployee(runtimeToken) {
      const response = await fetch(READ_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ book_id: requestedBookId, access_token: runtimeToken, step_name: step }),
      });
      if (cancelled) return;
      setHttpStatus(response.status);
      const data = await response.json().catch(() => null);
      if (cancelled) return;

      if (response.ok === true && data?.ok === true && data.book) {
        setBook(data.book);
        setStepName(data.step_name || data.step_data?.step_name || null);
        const sj = data.step_data?.state_json || data.state_json;
        if (sj) setSavedState(sj);
        if (data.progress_state) setProgressState(data.progress_state);
        setFiles(Array.isArray(data.files) ? data.files : []);
        setEmployeeUpdate(data.employee_update || null);
        setEmployeeRevision(Number(data.employee_revision) || 0);
        setEmployeeMode(String(data.employee_mode || 'intake'));
        setCanEdit(data.can_edit !== false);
        setState('success');
        return;
      }

      if (response.status === 401 || response.status === 403) {
        sessionStorage.removeItem(employeeSessionKey(requestedBookId));
      }
      setState('error');
    }

    async function resolveEmployeeAccess() {
      let runtimeToken = sessionStorage.getItem(employeeSessionKey(requestedBookId)) || '';

      if (launcherToken) {
        const response = await fetch(EXCHANGE_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ book_id: requestedBookId, access_token: launcherToken }),
        });
        if (cancelled) return;
        setHttpStatus(response.status);
        const data = await response.json().catch(() => null);
        if (!response.ok || data?.ok !== true || !data.session_token) {
          setState('error');
          return;
        }

        runtimeToken = String(data.session_token);
        sessionStorage.setItem(employeeSessionKey(requestedBookId), runtimeToken);
        // The Basecamp launcher credential is consumed only for exchange.
        // Continue with the short-lived book-scoped session and remove the
        // long-lived credential from the visible/history URL immediately.
        sanitizeEmployeeUrl();
      }

      if (!runtimeToken) {
        setState('missing');
        return;
      }

      setAccessToken(runtimeToken);
      await readEmployee(runtimeToken);
    }

    resolveEmployeeAccess().catch(() => {
      if (!cancelled) setState('error');
    });

    return () => { cancelled = true; };
  }, [step, refreshVersion]);

  return { state, book, stepName, httpStatus, bookId, accessToken, savedState, progressState, files, employeeUpdate, employeeRevision, employeeMode, canEdit, refresh: () => setRefreshVersion((value) => value + 1) };
}

function ProtectedReadGate() {
  // Which step is being viewed. Defaults to 'details' (preserves the Stage B1
  // behavior). The Content page is reached by navigating to step 'content'
  // (progress card / URL ?step=content). The backend receives step_name and is
  // authoritative on which step is unlocked for this access context.
  const initialStep = new URLSearchParams(window.location.search).get('step') || 'details';
  const [step, setStep] = React.useState(initialStep);
  const { state, book, stepName, httpStatus, bookId, accessToken, savedState, progressState, files, employeeUpdate, employeeRevision, employeeMode, canEdit, refresh } =
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

  // Decision 69: the same employee link remains readable after submission,
  // but mutation UI disappears until the authoritative state enters Employee Updates.
  if (employeeMode === 'submitted' || canEdit === false) {
    return React.createElement(SubmittedForReview, { book });
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
    return React.createElement(EmployeeUpdateContext.Provider, { value: employeeUpdate }, React.createElement(EmployeeUpdateNotice, { context: employeeUpdate, bookId, accessToken, employeeRevision, onConcurrencyConflict: refresh }), React.createElement(ContentPage, {
      key: `content:${employeeRevision}`,
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
      employeeRevision,
      onConcurrencyConflict: refresh,
      onNavigate: navigate,
    }));
  }
  if (step === 'pricing') {
    return React.createElement(EmployeeUpdateContext.Provider, { value: employeeUpdate }, React.createElement(EmployeeUpdateNotice, { context: employeeUpdate, bookId, accessToken, employeeRevision, onConcurrencyConflict: refresh }), React.createElement(PricingPage, {
      key: `pricing:${employeeRevision}`,
      book, bookId, accessToken, savedState,
      initialProgress: progressState, files, onNavigate: navigate, employeeUpdate, employeeRevision, onConcurrencyConflict: refresh,
    }));
  }
  return React.createElement(EmployeeUpdateContext.Provider, { value: employeeUpdate }, React.createElement(EmployeeUpdateNotice, { context: employeeUpdate, bookId, accessToken, employeeRevision, onConcurrencyConflict: refresh }), React.createElement(DetailsPage, {
    key: `details:${employeeRevision}`,
    book,
    stepName,
    bookId,
    accessToken,
    savedState,
    initialProgress: progressState,
    employeeRevision,
    onConcurrencyConflict: refresh,
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

  if (view === 'bookshelf' || view === 'create-new' || view === 'admin-review' || view === 'settings') {
    return React.createElement(PrivilegedGate, { contextFunction: view === 'settings' ? 'loadOperationalSettings' : 'loadPrivilegedBookshelf' }, (context, onSignOut, privilegedApi) => view === 'bookshelf'
      ? React.createElement(BookshelfPage, {
          books: context.books,
          identity: context.identity,
          canCreateBook: context.canCreateBook,
          capabilities: context.capabilities,
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
      : view === 'admin-review' ? React.createElement(AdminReviewGate, {
          privilegedApi,
          onBackToBookshelf: () => navigateView('bookshelf'),
          onSignOut,
        }) : React.createElement(SettingsPage, { context, privilegedApi, onNavigate: navigateView, onSignOut }));
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
