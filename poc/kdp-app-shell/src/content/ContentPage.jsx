import React from 'react';
import { KdpProgress } from '../progress/KdpProgress.jsx';
import { useDirtyNavigation } from '../navigation/DirtyNavigationGuard.jsx';
import { useEmployeeUpdateSection } from '../employeeUpdates/EmployeeUpdateNotice.jsx';
import {
  authoritativeContentState,
  serializeContentExtractedFields,
  serializeOptionalChoice,
} from '../state/employeeState.js';

// Employee Kindle eBook Content page.
// Local-only form state. UI + interaction proof; no backend save contract is
// asserted for the Content step because its section schema is not present in
// this repository. Uses React.createElement so the classic IIFE build needs no
// JSX transform.
//
// Visual system is a faithful translation of the live KDP Content UI guided by
// the approved Details page (poc/kdp-app-shell/src/details/DetailsPage.jsx) as
// the design-system baseline. No interpretive styling.

// Protected save endpoint — same scoped opaque-token model as the Details step.
// The raw access_token is read from the page URL at runtime; it is never
// persisted, logged, or embedded in the bundle.
const SAVE_ENDPOINT = 'https://wpuexhsrhuxieobeanjr.supabase.co/functions/v1/saveEmployeeStep';

// File upload endpoint. VERIFIED to exist and be deployed (slug
// uploadContentFileToReviewStudio, ACTIVE, ReviewStudio-flow integration).
// NOTE: the exact request/response shape is NOT fully captured in this repo, so
// the envelope below is the minimal safest derivation from the VERIFIED book_files
// schema and the LIVE runtime rejection "Invalid file_type. Use manuscript or cover."
// (captured against the deployed function) — which proves the field name is
// `file_type` (NOT `file_kind`) and that the accepted values are "manuscript" or
// "cover". Completion is driven ONLY by a real `ok === true` response — local
// state alone never counts as an uploaded manuscript/cover. The PDF/EPUB etc.
// allowlist is the browser-side mirror, not a security control.
const UPLOAD_ENDPOINT = 'https://wpuexhsrhuxieobeanjr.supabase.co/functions/v1/uploadContentFileToReviewStudio';

// Native KDP help links. The Content topics did not have their exact help-topic
// codes captured in this repo, so they reuse the same verified generic KDP help
// page already used by Details' "Learn more" (LINKS.learnMore). Swap in the exact
// codes once a live Content capture confirms them.
const CONTENT_HELP = 'https://kdp.amazon.com/en_US/help/topic/G201097560';

// Enforced at the UI convenience layer only. The trusted backend (the upload
// Edge Function + book_files constraints) remains authoritative. These lists are
// the browser-side mirror of the contract; they are not a security control.
const MANUSCRIPT_ACCEPT = ['.doc', '.docx', '.rtf', '.html', '.htm', '.txt', '.kpf', '.epub', '.pdf', '.mobi'];
const COVER_ACCEPT = ['.jpg', '.jpeg', '.tif', '.tiff'];
const MANUSCRIPT_MAX_BYTES = 1.5 * 1024 * 1024 * 1024; // 1.5 GB
const COVER_MAX_BYTES = 50 * 1024 * 1024; // 50 MB

// Content completion must be server-authoritative. The current UI required segments
// (manuscript, DRM decision, cover, AI question, accessibility choice) are
// are mirrored here for client-side feedback. Deployed saveEmployeeStep v14 is
// the authority for completion; its current omission of AI validation remains a
// known policy mismatch. Preview is intentionally NOT required. ISBN/Publisher
// are optional and must never block completion.
const REQUIRED_KEYS = ['manuscript', 'drm', 'cover', 'ai_content', 'accessibility'];
const REQUIRED_MSG = {
  manuscript: 'Upload your manuscript.',
  drm: 'Choose whether to apply Digital Rights Management.',
  cover: 'Add a cover for your book.',
  ai_content: 'Answer the AI-generated content question.',
  accessibility: 'Select an accessibility option.',
};

// --- native KDP content copy (from the live Content audit) ----------------

const CONTENT_INTRO = {
  coverCreator:
    'Use Cover Creator to make your book cover (upload your own cover image or use KDP\'s stock images)',
  coverUpload: 'Upload a cover you already have (JPG/TIFF only)',
  aiIntro: 'Amazon is collecting information about the use of Artificial Intelligence (AI) tools in creating content.',
  aiWhatIs: 'What is AI-generated content?',
  aiQuestion: 'Did you use AI tools in creating texts, images, and/or translations in your book?',
  isbnNote: 'Kindle eBooks are not required to have an ISBN.',
  isbnWhat: 'What is an ISBN?',
  accessibilityIntro:
    'This will provide customers with detailed information about accessibility features in your eBook. Customers can review these features on your book’s product detail page.',
  accessibilityWhy: 'Learn why accessibility is important to readers',
  accessibilityQuestion: 'Are your images accessible?',
  accessibleImagesHelp: 'Learn what it means to have accessible images',
};

const ACCESSIBILITY_OPTIONS = [
  { value: 'dont_know', label: 'I don\'t know if my informative images include alternative text and/or extended description.' },
  { value: 'none', label: 'None of the informative images include alternative text and/or extended description.' },
  { value: 'some', label: 'Some informative images include alternative text and/or extended description.' },
  { value: 'all', label: 'All informative images include alternative text and/or extended description.' },
];

// --- helpers -------------------------------------------------------------

function h(tag, props, ...children) {
  return React.createElement(tag, props, ...children);
}

function Section({ label, children, error }) {
  const update = useEmployeeUpdateSection(label);
  return h(
    'div',
    { className: `kdp-section${update.locked ? ' kdp-section--update-locked' : ''}${update.requested ? ' kdp-section--update-requested' : ''}`, inert: update.locked ? '' : undefined, 'aria-disabled': update.locked ? 'true' : undefined },
    h('div', { className: 'kdp-section-label' }, h('span', null, label)),
    h('div', { className: 'kdp-section-content' }, children, error ? h(KdpErrorAlert, null, error) : null)
  );
}

function Label({ children, htmlFor }) {
  return h('label', { className: 'kdp-label', htmlFor }, children);
}

function Help({ children }) {
  return h('p', { className: 'kdp-help' }, children);
}

function TextField({ id, value, onChange, placeholder, maxLength }) {
  return h('input', {
    id,
    className: 'kdp-input',
    type: 'text',
    value: value || '',
    placeholder: placeholder || '',
    maxLength: maxLength || undefined,
    onChange: (e) => onChange(e.target.value),
  });
}

function KdpLink({ href, text }) {
  return h('a', { className: 'kdp-link', href, target: '_blank', rel: 'noopener noreferrer' }, text);
}

// --- icon primitives (match Details; no icon package) --------------------

function Svg(props, ...children) {
  const size = props && props.size != null ? props.size : 16;
  const className = props && props.className;
  return h(
    'svg',
    {
      width: size,
      height: size,
      viewBox: '0 0 16 16',
      fill: 'none',
      'aria-hidden': 'true',
      focusable: 'false',
      className: 'kdp-icon' + (className ? ' ' + className : ''),
    },
    ...children
  );
}

function KdpCheckIcon(props) {
  return Svg(props,
    h('circle', { cx: 8, cy: 8, r: 8, fill: '#007600' }),
    h('path', { d: 'M4.6 8.2l2.2 2.2 4.6-4.8', fill: 'none', stroke: '#fff', 'stroke-width': 1.6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })
  );
}

function KdpLockIcon(props) {
  return Svg(props,
    h('path', { d: 'M4 7V5a4 4 0 018 0v2h1v7H3V7h1zm1.5 0h5V5a2.5 2.5 0 00-5 0v2z', fill: '#565959' })
  );
}

function KdpErrorIcon(props) {
  return Svg(props,
    h('circle', { cx: 8, cy: 8, r: 8, fill: '#c10015' }),
    h('rect', { x: 7.3, y: 4.4, width: 1.4, height: 4.9, rx: 0.7, fill: '#fff' }),
    h('circle', { cx: 8, cy: 11.3, r: 0.95, fill: '#fff' })
  );
}

function KdpErrorAlert({ children }) {
  return h(
    'div',
    { className: 'kdp-error-alert', role: 'alert' },
    KdpErrorIcon({ className: 'kdp-error-alert__icon' }),
    h('div', { className: 'kdp-error-alert__msg' }, children)
  );
}

function ValidationSummary({ errs }) {
  const items = [];
  REQUIRED_KEYS.forEach(function (k) {
    if (errs[k]) items.push(errs[k]);
  });
  if (items.length === 0) return null;
  return h(
    'div',
    { className: 'kdp-validation-summary', role: 'alert' },
    h('p', { className: 'kdp-validation-summary__title' }, 'Please fix the highlighted error(s) to continue.'),
    h('ul', { className: 'kdp-validation-summary__list' }, items.map(function (m) { return h('li', { className: 'kdp-validation-summary__item', key: m }, m); }))
  );
}

// --- progress state --------------------------------------------------------

// Map a server-returned progress_state onto the 3-tile display. Same contract
// as Details: native {activeStep, steps:{...}} or legacy flat shape; content
// defaults to in-progress when the server is silent (Content is the current step).
function progressFromServer(ps) {
  const out = {
    details: { status: 'complete', active: false },
    content: { status: 'in_progress', active: true },
    pricing: { status: 'locked', active: false },
  };
  if (!ps || typeof ps !== 'object') return out;
  const steps = ps.steps && typeof ps.steps === 'object' ? ps.steps : null;
  const raw = {};
  ['details', 'content', 'pricing'].forEach(function (k) {
    const v = steps ? steps[k] : ps[k];
    if (typeof v === 'string') raw[k] = v;
    else if (v && typeof v === 'object') raw[k] = v.status || v.state || (v.complete ? 'complete' : null);
  });
  const activeStep = ps.activeStep || ps.current_step || 'content';
  ['details', 'content', 'pricing'].forEach(function (k) {
    const status =
      raw[k] ||
      (k === activeStep ? 'in_progress' : k === 'details' ? 'complete' : 'locked');
    out[k] = { status: status, active: k === activeStep || status === 'in_progress' };
  });
  return out;
}

function buildProgressState(activeStep) {
  return {
    activeStep: activeStep,
    steps: {
      details: { status: 'complete', isUnlocked: true, isComplete: true },
      content: { status: activeStep === 'content' ? 'in_progress' : 'complete', isUnlocked: true, isComplete: activeStep !== 'content' },
      pricing: { status: activeStep === 'pricing' ? 'in_progress' : 'locked', isUnlocked: activeStep === 'pricing', isComplete: false },
    },
  };
}

// 3-tile progress header. Unlocked (non-locked) tiles are clickable and call
// onNavigate; locked tiles render a lock and never navigate. Server-authoritative
// status drives both the icon and click-eligibility — client state cannot unlock.
function KdpProgressTiles({ progress, onNavigate }) {
  // Shared with DetailsPage. currentStep="content" so the
  // visual "is-active" underline tracks the rendered page
  // (Content), not the workflow's activeStep. Status text
  // (Complete / In Progress / Not Started) is still derived
  // from progress[key].status.
  return h(KdpProgress, { progress, onNavigate, currentStep: 'content' });
}

// --- file selection --------------------------------------------------------

// T4: select the authoritative persisted file record for a given file_type.
// Live contract fields (verified from a real loadEmployeePage response):
//   - file_type: "manuscript" | "cover"
//   - section_key: "content.manuscript" | "content.cover"
//   - updated_at, created_at: ISO timestamps used to pick the newest record
//     when more than one of the same file_type ever exists.
// Returns null when no matching record exists. This is display selection only;
// we never delete or mutate older records from the UI.
function selectFile(files, fileType, sectionKey) {
  if (!Array.isArray(files) || files.length === 0) return null;
  const matches = files.filter(function (f) {
    if (!f || typeof f !== 'object') return false;
    if (f.file_type !== fileType) return false;
    // Prefer the section_key match when present; fall back to file_type-only
    // so a malformed section_key still surfaces the file.
    if (f.section_key && sectionKey) return f.section_key === sectionKey;
    return true;
  });
  if (matches.length === 0) return null;
  // Newest first by updated_at, then created_at as fallback.
  matches.sort(function (a, b) {
    const ua = a.updated_at || a.created_at || '';
    const ub = b.updated_at || b.created_at || '';
    if (ua < ub) return 1;
    if (ua > ub) return -1;
    return 0;
  });
  return matches[0];
}

function validHttpsUrl(s) {
  if (typeof s !== 'string' || !s) return false;
  try {
    const u = new URL(s);
    return u.protocol === 'https:';
  } catch (e) { return false; }
}

// --- state / initialization ------------------------------------------------

function initContentState(book, saved) {
  const s = saved && typeof saved === 'object' ? saved : {};
  const sections = s.sections && typeof s.sections === 'object' ? s.sections : null;
  const v = (key, pick) => {
    const sec = sections && sections[key];
    if (!sec) return undefined;
    return pick ? pick(sec) : sec.value;
  };
  const cover = v('cover') || {};
  const isbn = v('isbn') || {};
  return {
    manuscriptHasFile: !!v('manuscript', (sec) => sec.value && sec.value.uploaded),
    drmChoice: v('manuscript', (sec) => sec.value && sec.value.drm) || '',
    coverOption: cover.option || '',
    coverHasFile: !!(cover.uploaded),
    aiChoice: v('ai_content') || '',
    hasPreview: !!v('preview', (sec) => sec.value && sec.value.hasPreview),
    isbn: isbn.isbn || '',
    publisher: isbn.publisher || '',
    accessibleImages: v('accessibility') || '',
  };
}

function buildContentSections(s) {
  return {
    manuscript: { sectionKey: 'manuscript', sectionLabel: 'Manuscript', required: false, reviewable: true, value: { uploaded: !!s.manuscriptHasFile, drm: s.drmChoice } },
    cover: { sectionKey: 'cover', sectionLabel: 'Kindle eBook Cover', required: false, reviewable: true, value: { option: s.coverOption, uploaded: !!s.coverHasFile } },
    ai_content: { sectionKey: 'ai_content', sectionLabel: 'AI-Generated Content', required: false, reviewable: true, value: serializeOptionalChoice(s.aiChoice, ['yes', 'no']) },
    preview: { sectionKey: 'preview', sectionLabel: 'Kindle eBook Preview', required: false, reviewable: true, value: { hasPreview: !!s.hasPreview } },
    isbn: { sectionKey: 'isbn', sectionLabel: 'Kindle eBook ISBN', required: false, reviewable: true, value: { isbn: s.isbn, publisher: s.publisher } },
    accessibility: { sectionKey: 'accessibility', sectionLabel: 'Accessibility Features', required: false, reviewable: true, value: s.accessibleImages || '' },
  };
}

// NOTE: The Content step's section schema is not documented in this repo. This
// payload follows the Details structural convention (page / stepName / sections /
// progressState) but the content section keys are a POC placeholder pending a
// live capture of the real content step_data — see the task report.
function buildContentStateJson(s, saveType, activeStep, errs) {
  const extractedFields = serializeContentExtractedFields(s);
  return {
    page: 'content',
    stepName: 'content',
    stepLabel: 'Kindle eBook Content',
    saveType: saveType,
    savedAt: new Date().toISOString(),
    sections: buildContentSections(s),
    extractedFields: extractedFields,
    progressState: buildProgressState(activeStep),
    validationRequiredKeys: REQUIRED_KEYS,
    validationErrors: errs || {},
  };
}

// Required-segment check for a COMPLETE (Save and Continue) submission only.
// Returns { key: message } using the exact platform copy. Draft saves bypass this.
// Preview is intentionally absent; ISBN/Publisher are optional and never block.
function requiredErrors(s) {
  const errs = {};
  if (!s.manuscriptHasFile) errs.manuscript = REQUIRED_MSG.manuscript;
  if (!s.drmChoice) errs.drm = REQUIRED_MSG.drm;
  if (!s.coverHasFile) errs.cover = REQUIRED_MSG.cover;
  if (!s.aiChoice) errs.ai_content = REQUIRED_MSG.ai_content;
  if (!s.accessibleImages) errs.accessibility = REQUIRED_MSG.accessibility;
  return errs;
}

function extOf(name) {
  const i = String(name || '').lastIndexOf('.');
  return i >= 0 ? String(name).slice(i).toLowerCase() : '';
}

function fileTypeOk(name, accept) {
  return accept.indexOf(extOf(name)) >= 0;
}

function fileSizeOk(size, maxBytes) {
  return typeof size === 'number' && size > 0 && size <= maxBytes;
}

function safeSaveError(data, status) {
  if (data && typeof data.error === 'string' && data.error) return data.error;
  if (data && typeof data.message === 'string' && data.message) return data.message;
  if (status) return 'The save could not be completed (HTTP ' + status + '). No changes were saved.';
  return 'The save could not be completed. No changes were saved.';
}

// Translate raw upload error messages from the backend into neutral, user-facing
// copy. The employee UI must never echo internal field names (file_type, file_kind,
// section_key, book_id, access_token, etc.) — those leak the API surface and
// confuse non-technical users. The actual allowlist of supported formats is the
// server's, so we don't enumerate extensions here either.
function safeUploadError(data, status, kind) {
  const isMs = kind === 'manuscript';
  const fallback = isMs
    ? 'The manuscript could not be uploaded. Please try again with a supported file.'
    : 'The cover could not be uploaded. Please try again with a supported file.';
  const raw =
    (data && typeof data.error === 'string' && data.error) ||
    (data && typeof data.message === 'string' && data.message) ||
    '';
  if (raw) {
    const lower = raw.toLowerCase();
    // Backend explicitly returns: "Invalid file_type. Use manuscript or cover."
    // The phrase "file type" is the natural-language user wording; we never
    // echo the underscore form `file_type` or the older `file_kind` to the UI.
    if (lower.includes('invalid file_type') || lower.includes('invalid file type') || lower.includes('invalid file_kind')) {
      return isMs
        ? 'Invalid file type. Please upload a supported manuscript file.'
        : 'Invalid file type. Please upload a supported cover file.';
    }
    if (lower.includes('unauthorized') || lower.includes('access token') || lower.includes('forbidden')) {
      return 'This upload link is no longer valid. Please reopen the page from your bookshelf link.';
    }
    if (lower.includes('too large') || lower.includes('size')) {
      return isMs ? 'The manuscript file is too large.' : 'The cover file is too large.';
    }
    // For any other backend error string, return the neutral fallback so we
    // never echo an internal/unsupported phrase to the employee.
  }
  // T1: do NOT append HTTP status, status code, or any internal diagnostic to
  // the user-facing message. The `status` argument is still accepted (and
  // available internally for debugging) but is intentionally unused in the
  // return value. Internal field names (file_type, file_kind, section_key,
  // book_id, access_token) are also never echoed — they belong to controlled
  // development logs only, not the employee UI.
  void status;
  return fallback;
}

// --- page component --------------------------------------------------------

export function ContentPage({ book, stepName, bookId, accessToken, savedState, initialProgress, onNavigate, files }) {
  const [state, setState] = React.useState(() => initContentState(book, savedState));
  const cleanStateRef = React.useRef(JSON.stringify(state));
  const [serverProgress, setServerProgress] = React.useState(() => progressFromServer(initialProgress));
  const [validationErrors, setValidationErrors] = React.useState({});
  const [feedback, setFeedback] = React.useState(null);
  const [saving, setSaving] = React.useState(false);
  const savingRef = React.useRef(false);
  const [overlay, setOverlay] = React.useState(null); // { phase: 'saving' | 'done', label, done }
  const [uploadState, setUploadState] = React.useState({ kind: null, busy: false, error: null }); // kind: 'manuscript' | 'cover'
  // T4: persistent authoritativeness comes from the backend's `files[]`.
  // `serverFiles` is the latest snapshot from loadEmployeePage; the
  // post-upload refresh updates this so the View buttons + thumbnail
  // appear without requiring a manual page reload.
  const [serverFiles, setServerFiles] = React.useState(Array.isArray(files) ? files : []);

  // T6: if the parent re-supplies `files` (e.g. after a navigation back from
  // Details, or a future top-level refresh), keep `serverFiles` in sync.
  // We do not overwrite during an in-flight upload to avoid clobbering a
  // refresh that has not yet completed.
  React.useEffect(() => {
    if (!uploadState.busy) setServerFiles(Array.isArray(files) ? files : []);
  }, [files, uploadState.busy]);

  // T6: re-pull the authoritative file state from loadEmployeePage after a
  // successful upload. Reuses the same protected envelope the parent already
  // owns. No new data architecture, no new fetcher inside ContentPage —
  // it lives here only because the upload handler is here, and the refresh
  // is a self-contained fetch that mirrors the parent's read.
  const refreshAuthoritativeFiles = () => {
    if (!bookId || !accessToken) return Promise.resolve(null);
    const ep = 'https://wpuexhsrhuxieobeanjr.supabase.co/functions/v1/loadEmployeePage';
    return fetch(ep, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ book_id: bookId, access_token: accessToken, step_name: 'content' }),
    })
      .then((res) => res.json().catch(() => null).then((data) => ({ ok: res.ok, data })))
      .then(({ ok, data }) => {
        if (ok && data && data.ok === true) {
          setServerFiles(Array.isArray(data.files) ? data.files : []);
        }
        return null;
      })
      .catch(() => null);
  };

  const setField = (key, value) => setState((s) => Object.assign({}, s, { [key]: value }));

  // Reusable Saving.../Done! overlay. The Done state holds ~650ms then clears.
  // Honors prefers-reduced-motion (CSS shortens the transition, but we also cap
  // the JS hold so no fake timer games the UX). Driven only by real server calls.
  const runSaveOverlay = (label) =>
    new Promise((resolve) => {
      setOverlay({ phase: 'saving', label, done: false });
      // Resolve after the network path; Done render is handled by caller.
      resolve();
    });

  const showDone = (label) => {
    setOverlay({ phase: 'done', label, done: true });
    const reduce = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const hold = reduce ? 300 : 650;
    window.setTimeout(() => setOverlay((cur) => (cur && cur.done ? null : cur)), hold);
  };

  const clearOverlay = () => setOverlay(null);

  // Real file upload via the VERIFIED deployed Edge Function. The exact request
  // envelope is UNVERIFIED (no source/capture available), so we send the minimal
  // safest shape derived from the VERIFIED book_files schema and treat only a
  // real `ok === true` response as success. Local state is updated ONLY on success.
  const uploadFile = (kind, file) => {
    if (uploadState.busy || savingRef.current) return;
    const isManuscript = kind === 'manuscript';
    const accept = isManuscript ? MANUSCRIPT_ACCEPT : COVER_ACCEPT;
    const maxBytes = isManuscript ? MANUSCRIPT_MAX_BYTES : COVER_MAX_BYTES;
    if (!fileTypeOk(file.name, accept)) {
      setUploadState({ kind, busy: false, error: isManuscript ? 'Unsupported manuscript format. Allowed: ' + MANUSCRIPT_ACCEPT.join(', ') : 'Unsupported cover format. Allowed: JPG/TIFF only.' });
      return;
    }
    if (!fileSizeOk(file.size, maxBytes)) {
      setUploadState({ kind, busy: false, error: isManuscript ? 'Manuscript exceeds the 1.5 GB limit.' : 'Cover exceeds the 50 MB limit.' });
      return;
    }
    if (!bookId || !accessToken) {
      setUploadState({ kind, busy: false, error: 'Missing book or access context. Reopen this page from your bookshelf link.' });
      return;
    }
    setUploadState({ kind, busy: true, error: null });
    const form = new FormData();
    form.append('book_id', bookId);
    form.append('access_token', accessToken); // runtime URL value only; never persisted/logged
    form.append('section_key', isManuscript ? 'content.manuscript' : 'content.cover');
    form.append('file_type', isManuscript ? 'manuscript' : 'cover');
    form.append('file', file);
    fetch(UPLOAD_ENDPOINT, { method: 'POST', body: form })
      .then((res) => res.json().catch(() => null).then((data) => ({ ok: res.ok, status: res.status, data })))
      .then(({ ok, status, data }) => {
        // Completion requires a genuine persisted/uploaded file. Local state alone
        // (choosing a file, clicking) does NOT count — only the server's ok.
        if (ok === true && data && data.ok === true) {
          // T6: refresh the authoritative files[] from the protected read so
          // the View buttons + cover thumbnail light up from the same source
          // of truth as a page reload, without the employee needing one.
          // Do not optimistically mark the file present: only the protected
          // loader's reconciled file set can establish current-file state.
          setUploadState({ kind, busy: false, error: null });
          return refreshAuthoritativeFiles();
        }
        setUploadState({ kind, busy: false, error: safeUploadError(data, status, kind) });
        return null;
      })
      .catch(() => setUploadState({ kind, busy: false, error: (kind === 'manuscript' ? 'The manuscript could not be uploaded. The file was not uploaded.' : 'The cover could not be uploaded. The file was not uploaded.') }));
  };

  const doSave = (saveType, nextStepName, activeStep, completion) => {
    // T7: symmetric concurrency guard. A save must not start while a real
    // upload fetch is still in flight — both operations change server state
    // and overlapping them is unsafe. The upload side already blocks on
    // savingRef.current, so this is the missing reverse direction.
    if (savingRef.current) { completion?.(false); return; } // one click = one save
    if (uploadState.busy) { completion?.(false); return; } // do not interleave save + upload
    if (!bookId || !accessToken) {
      setFeedback({ kind: 'error', msg: 'Missing book or access context. Reopen this page from your bookshelf link.' });
      completion?.(false); return;
    }
    // File presence comes only from the latest server-confirmed file set.
    // Saved form booleans cannot complete Content after reconciliation has
    // removed a stale manuscript or cover.
    const stateForSave = authoritativeContentState(state, serverFiles);
    const errs = saveType === 'complete' ? requiredErrors(stateForSave) : {};
    if (saveType === 'complete' && Object.keys(errs).length > 0) {
      setValidationErrors(errs); // block completion; Pricing stays locked
      setFeedback(null);
      completion?.(false); return;
    }
    setValidationErrors({});
    setFeedback(null);
    savingRef.current = true;
    setSaving(true);
    runSaveOverlay('Saving…');
    var progressState = buildProgressState(activeStep);
    var stateJson = buildContentStateJson(stateForSave, saveType, activeStep, errs);
    var extractedFields = serializeContentExtractedFields(stateForSave);
    fetch(SAVE_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        book_id: bookId,
        access_token: accessToken, // runtime URL value only; never persisted/logged
        step_name: 'content',
        next_step_name: nextStepName,
        save_type: saveType,
        state_json: stateJson,
        extracted_fields: extractedFields,
        validation_required_keys: REQUIRED_KEYS,
        validation_errors: errs,
        progress_state: progressState,
        source: 'ghl_kdp_content_page',
      }),
    })
      .then((res) => res.json().catch(() => null).then((data) => ({ ok: res.ok, status: res.status, data })))
      .then(({ ok, status, data }) => {
        if (ok === true && data && data.ok === true) {
          cleanStateRef.current = JSON.stringify(state);
          // Server-authoritative progress: hydrate from the backend, never client-guess.
          if (data.progress_state) setServerProgress(progressFromServer(data.progress_state));
          if (saveType === 'complete') {
            const ps = data.progress_state;
            const contentComplete = !!(ps && ps.steps && ps.steps.content && ps.steps.content.isComplete === true);
            const pricingUnlocked = !!(ps && ps.steps && ps.steps.pricing && ps.steps.pricing.isUnlocked === true);
            if (contentComplete && pricingUnlocked && typeof onNavigate === 'function') {
              showDone('Done!');
              const reduce = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
              window.setTimeout(() => onNavigate(nextStepName), reduce ? 300 : 650);
            } else {
              clearOverlay();
              setFeedback({ kind: 'ok', msg: 'Content was saved, but Pricing is not unlocked yet.' });
            }
          } else {
            showDone('Draft saved.');
            setFeedback({ kind: 'ok', msg: 'Draft saved.' + (data.data_valid === false ? ' The form is not complete yet.' : '') });
          }
          completion?.(true);
        } else {
          clearOverlay();
          setFeedback({ kind: 'error', msg: safeSaveError(data, status) });
          completion?.(false);
        }
      })
      .catch(() => { clearOverlay(); setFeedback({ kind: 'error', msg: 'Could not reach the server. No changes were saved.' }); completion?.(false); })
      .finally(() => {
        savingRef.current = false;
        setSaving(false);
      });
  };

  const handleDraft = () => doSave('draft', null, 'content');
  const handleContinue = () => doSave('complete', 'pricing', 'pricing');
  const saveDraftForNavigation = React.useCallback(() => new Promise((resolve) => doSave('draft', null, 'content', resolve)), [state, serverFiles, bookId, accessToken, uploadState.busy]);
  const navigation = useDirtyNavigation({ currentStep: 'content', isDirty: JSON.stringify(state) !== cleanStateRef.current, saveDraft: saveDraftForNavigation, navigate: onNavigate });

  const displayProgress = serverProgress || progressFromServer(null);
  const bookTitle = book && book.book_title ? book.book_title : '';

  // T4: authoritative persisted records for the current employee view.
  // These come from the backend's `files[]`; the local "uploaded" booleans
  // are only a transient signal during an in-flight upload.
  const persistedManuscript = selectFile(serverFiles, 'manuscript', 'content.manuscript');
  const persistedCover = selectFile(serverFiles, 'cover', 'content.cover');

  // T5: View Manuscript / View Cover URLs. We use ONLY the backend's
  // authoritative `reviewstudio_file_url` and only treat it as valid when
  // it parses as an https URL. We never derive URLs from
  // reviewstudio_project_id / reviewstudio_file_id / review_id.
  const manuscriptViewUrl = validHttpsUrl(persistedManuscript && persistedManuscript.reviewstudio_file_url)
    ? persistedManuscript.reviewstudio_file_url
    : null;
  const coverViewUrl = validHttpsUrl(persistedCover && persistedCover.reviewstudio_file_url)
    ? persistedCover.reviewstudio_file_url
    : null;

  // Cover thumbnail source: the verified top-level `preview_url` only.
  // Never use `metadata.reviewstudio_response.thumbnail_url` or
  // `reviewstudio_file_url` as an <img src>.
  const coverPreviewUrl = (persistedCover && typeof persistedCover.preview_url === 'string' && persistedCover.preview_url)
    ? persistedCover.preview_url
    : '';

  // File-presence UI and save validation share the same protected-loader
  // snapshot. Saved booleans are legacy input only and never authoritative.
  const manuscriptHasFile = !!persistedManuscript;
  const coverHasFile = !!persistedCover;

  // --- Manuscript ---------------------------------------------------------
  // T7: the upload buttons reflect the same in-flight lock as the runtime
  // guard. A manuscript upload is blocked while (a) a manuscript upload is
  // already in flight, (b) a cover upload is in flight, or (c) a save is
  // in flight. Mirror logic is used for the cover button below.
  // `msUploadInFlight` is the literal "this button's upload is in flight"
  // flag (used for the label + error binding). `msUploadDisabled` is the
  // broader non-interactive flag (used for the disabled attribute + title).
  const msUploadInFlight = uploadState.busy && uploadState.kind === 'manuscript';
  const msUploadDisabled = uploadState.busy || saving;
  const msUploadErr = uploadState.error && uploadState.kind === 'manuscript' ? uploadState.error : null;
  const manuscriptSection = h(
    Section,
    { label: 'Manuscript', error: msUploadErr || (validationErrors.manuscript ? REQUIRED_MSG.manuscript : null) },
    h(Help, null, 'Upload your manuscript (i.e. your book’s interior content). We recommend using a KPF file. ',
      KdpLink({ href: CONTENT_HELP, text: 'See all supported file types' })),
    h(Help, null, 'For help designing your manuscript with professional themes, chapter titles, or images, you can use ',
      KdpLink({ href: CONTENT_HELP, text: 'Kindle Create' }),
      ' or our ',
      KdpLink({ href: CONTENT_HELP, text: 'eBook Formatting Guide' }),
      '.'),
    h('input', {
      type: 'file',
      id: 'kdp-ms-file',
      className: 'kdp-visually-hidden',
      accept: MANUSCRIPT_ACCEPT.join(','),
      onChange: (e) => {
        const f = e.target.files && e.target.files[0];
        if (f) uploadFile('manuscript', f);
        e.target.value = '';
      },
    }),
    h(
      'button',
      {
        type: 'button',
        className: 'kdp-btn kdp-btn--primary kdp-btn--upload',
        disabled: msUploadDisabled,
        onClick: () => { const el = document.getElementById('kdp-ms-file'); if (el) el.click(); },
        'data-upload-kind': 'manuscript',
        'data-upload-mode': manuscriptHasFile ? 'replace' : 'upload',
        title: msUploadDisabled
          ? (saving ? 'A save is in progress…' : 'Another upload is in progress…')
          : (manuscriptHasFile
              ? 'Replace the current manuscript. The previous file is removed from the proofing review.'
              : 'Upload your manuscript file via the protected backend.'),
      },
      msUploadInFlight
        ? (manuscriptHasFile ? 'Replacing…' : 'Uploading…')
        : (manuscriptHasFile ? 'Replace manuscript' : 'Upload manuscript')
    ),
    manuscriptHasFile ? h('span', { className: 'kdp-has-file', role: 'status' }, 'Manuscript uploaded') : null,
    h('div', { className: 'kdp-gap' }),
    h('p', { className: 'kdp-help' },
      'Digital Rights Management (DRM) protects the rights of copyright holders, and limits unauthorized access and distribution of the content. ',
      KdpLink({ href: CONTENT_HELP, text: 'Learn more' })),
    h('div', { className: 'kdp-field' }, h(Label, { htmlFor: 'kdp-drm-question' }, 'Would you like to apply Digital Rights Management (DRM) to your files?')),
    h('div', { className: 'kdp-radio-stack' },
      h('label', { className: 'kdp-radio' },
        h('input', { type: 'radio', name: 'drmChoice', value: 'yes', checked: state.drmChoice === 'yes', onChange: () => setField('drmChoice', 'yes') }),
        h('span', null, 'Yes, apply Digital Rights Management')
      ),
      h('label', { className: 'kdp-radio' },
        h('input', { type: 'radio', name: 'drmChoice', value: 'no', checked: state.drmChoice === 'no', onChange: () => setField('drmChoice', 'no') }),
        h('span', null, 'No, do not apply Digital Rights Management and allow customers who buy this book to download it as a PDF or EPUB file')
      )
    )
  );

  // --- Kindle eBook Cover --------------------------------------------------
  const coverExtraOpen = state.coverOption === 'upload';
  const coverExtraClass = 'kdp-expand kdp-cover-extra' + (coverExtraOpen ? ' is-open' : '');
  const coverExtraInnerClass = 'kdp-expand__inner kdp-cover-extra-inner';
  // T7: see msUpload* above. Cover upload uses the same split: the literal
  // "this upload is in flight" flag drives the label; the broader
  // non-interactive flag drives the disabled attribute + title.
  const coverUploadInFlight = uploadState.busy && uploadState.kind === 'cover';
  const coverUploadDisabled = uploadState.busy || saving;
  const coverUploadErr = uploadState.error && uploadState.kind === 'cover' ? uploadState.error : null;
  const coverSection = h(
    Section,
    { label: 'Kindle eBook Cover', error: coverUploadErr || (validationErrors.cover ? REQUIRED_MSG.cover : null) },
    h(Help, null, 'Upload a front cover for your book or use our Cover Creator to design one today. ',
      KdpLink({ href: CONTENT_HELP, text: 'Required cover specifications' })),
    h('div', { className: 'kdp-cover-card' },
      h('div', { className: 'kdp-cover-option' + (state.coverOption === 'cover_creator' ? ' is-selected' : '') },
        h('label', { className: 'kdp-radio' },
          h('input', { type: 'radio', name: 'coverOption', value: 'cover_creator', checked: state.coverOption === 'cover_creator', onChange: () => setField('coverOption', 'cover_creator') }),
          h('span', { className: 'kdp-option-title' }, CONTENT_INTRO.coverCreator)
        ),
        state.coverOption === 'cover_creator'
          ? h('div', { className: 'kdp-cover-body' },
              h('div', { className: 'kdp-cover-placeholder' }, 'No Cover Uploaded'),
              h(
                'a',
                { className: 'kdp-btn kdp-btn--primary kdp-btn--cover', href: 'https://www.adobe.com/home', target: '_blank', rel: 'noopener noreferrer' },
                'Launch Cover Creator'
              )
            )
          : null
      ),
      h('div', { className: 'kdp-cover-divider' }),
      h('div', { className: 'kdp-cover-option' + (state.coverOption === 'upload' ? ' is-selected' : '') },
        h('label', { className: 'kdp-radio' },
          h('input', { type: 'radio', name: 'coverOption', value: 'upload', checked: state.coverOption === 'upload', onChange: () => setField('coverOption', 'upload') }),
          h('span', { className: 'kdp-option-title' }, CONTENT_INTRO.coverUpload)
        ),
        h('div', { className: coverExtraClass },
          h('div', { className: coverExtraInnerClass },
            h('div', { className: 'kdp-cover-extra-content' },
            // Cover thumbnail: use the verified top-level `preview_url`
            // from the persisted file record. Falls back to the existing
            // dashed placeholder if no usable URL is present yet. The
            // image never crops (object-fit: contain), keeps the same
            // ~70×110 footprint, and on error swaps back to the placeholder
            // treatment without showing the raw URL to the employee.
            coverPreviewUrl
              ? h('img', {
                  className: 'kdp-cover-thumb',
                  src: coverPreviewUrl,
                  alt: 'Uploaded book cover',
                  width: 70,
                  height: 110,
                  loading: 'lazy',
                  onError: function (e) {
                    // Hide the broken <img> and re-show the placeholder
                    // text in place. Use a class swap so the test suite
                    // can observe the fallback without having to wait on
                    // a real network image to time out.
                    e.currentTarget.classList.add('kdp-cover-thumb--failed');
                    const sib = e.currentTarget.nextElementSibling;
                    if (sib) sib.classList.remove('kdp-cover-thumb--hidden');
                  },
                })
              : null,
            h('div', {
              className: 'kdp-cover-placeholder' + (coverPreviewUrl ? ' kdp-cover-thumb--hidden' : ''),
            }, coverHasFile ? 'Cover uploaded' : 'No Cover Uploaded'),
            h('input', {
              type: 'file',
              id: 'kdp-cover-file',
              className: 'kdp-visually-hidden',
              accept: COVER_ACCEPT.join(','),
              onChange: (e) => {
                const f = e.target.files && e.target.files[0];
                if (f) uploadFile('cover', f);
                e.target.value = '';
              },
            }),
            h(
              'button',
              {
                type: 'button',
                className: 'kdp-btn kdp-btn--primary kdp-btn--cover',
                disabled: coverUploadDisabled,
                onClick: () => { const el = document.getElementById('kdp-cover-file'); if (el) el.click(); },
                'data-upload-kind': 'cover',
                'data-upload-mode': coverHasFile ? 'replace' : 'upload',
                title: coverUploadDisabled
                  ? (saving ? 'A save is in progress…' : 'Another upload is in progress…')
                  : (coverHasFile
                      ? 'Replace the current cover. The previous file is removed from the proofing review.'
                      : 'Upload your cover file (JPG/TIFF) via the protected backend.'),
              },
              coverUploadInFlight
                ? (coverHasFile ? 'Replacing…' : 'Uploading…')
                : (coverHasFile ? 'Replace cover' : 'Upload cover')
            )
            )
          )
        )
      )
    )
  );

  // --- AI-Generated Content -------------------------------------------------
  const aiSection = h(
    Section,
    { label: 'AI-Generated Content', error: validationErrors.ai_content ? REQUIRED_MSG.ai_content : null },
    h(Help, null, CONTENT_INTRO.aiIntro),
    h('p', { className: 'kdp-help' }, KdpLink({ href: CONTENT_HELP, text: CONTENT_INTRO.aiWhatIs })),
    h('div', { className: 'kdp-field' }, h(Label, { htmlFor: 'kdp-ai-question' }, CONTENT_INTRO.aiQuestion)),
    h('div', { className: 'kdp-choice-box' },
      h('label', { className: 'kdp-choice-row' },
        h('input', { type: 'radio', name: 'aiChoice', value: 'yes', checked: state.aiChoice === 'yes', onChange: () => setField('aiChoice', 'yes') }),
        h('span', null, 'Yes')
      ),
      h('div', { className: 'kdp-choice-divider' }),
      h('label', { className: 'kdp-choice-row' },
        h('input', { type: 'radio', name: 'aiChoice', value: 'no', checked: state.aiChoice === 'no', onChange: () => setField('aiChoice', 'no') }),
        h('span', null, 'No')
      )
    )
  );

  // --- Review Uploaded Files -------------------------------------------------
  // T3 + T5: the two review buttons render as semantic <a> when a valid
  // `reviewstudio_file_url` is available for that file_type, and as a
  // disabled <button> when it is not. We use the EXACT backend-supplied
  // `reviewstudio_file_url` as the href; we never derive a URL from
  // reviewstudio_project_id / reviewstudio_file_id / review_id. file_status
  // is intentionally NOT consulted for button availability — the live
  // contract shows `processing` while the review still opens correctly.
  function reviewButton(kind, label, url) {
    if (url) {
      return h('a', {
        className: 'kdp-btn kdp-btn--primary kdp-btn--review',
        href: url,
        target: '_blank',
        rel: 'noopener noreferrer',
        'data-review-kind': kind,
        'data-review-enabled': 'true',
      }, label);
    }
    return h('button', {
      type: 'button',
      className: 'kdp-btn kdp-btn--primary kdp-btn--review',
      disabled: true,
      'aria-disabled': 'true',
      'data-review-kind': kind,
    }, label);
  }
  const previewSection = h(
    Section,
    { label: 'Review Uploaded Files' },
    h('p', { className: 'kdp-help' }, 'Review your uploaded manuscript and cover before continuing.'),
    h('div', { className: 'kdp-review-actions' },
      reviewButton('manuscript', 'View Manuscript', manuscriptViewUrl),
      reviewButton('cover', 'View Cover', coverViewUrl)
    ),
    h('div', { className: 'kdp-info-box' },
      h('div', { className: 'kdp-info-box__icon' }, 'ℹ'),
      h('div', { className: 'kdp-info-box__msg' }, 'Uploaded files will open in ReviewStudio for review.')
    )
  );

  // --- Kindle eBook ISBN ----------------------------------------------------
  const isbnSection = h(
    Section,
    { label: 'Kindle eBook ISBN' },
    h(Help, null, CONTENT_INTRO.isbnNote + ' ',
      KdpLink({ href: CONTENT_HELP, text: CONTENT_INTRO.isbnWhat })),
    h('div', { className: 'kdp-field' },
      Label({ htmlFor: 'kdp-isbn', children: 'ISBN (Optional)' }),
      TextField({ id: 'kdp-isbn', value: state.isbn, onChange: (v) => setField('isbn', v) })
    ),
    h('div', { className: 'kdp-field' },
      Label({ htmlFor: 'kdp-publisher', children: 'Publisher (Optional)' }),
      TextField({ id: 'kdp-publisher', value: state.publisher, onChange: (v) => setField('publisher', v) })
    )
  );

  // --- Accessibility Features ------------------------------------------------
  const accessibilitySection = h(
    Section,
    { label: 'Accessibility Features', error: validationErrors.accessibility ? REQUIRED_MSG.accessibility : null },
    h(Help, null, CONTENT_INTRO.accessibilityIntro + ' ',
      KdpLink({ href: CONTENT_HELP, text: CONTENT_INTRO.accessibilityWhy })),
    h('div', { className: 'kdp-field' }, h(Label, { htmlFor: 'kdp-accessibility' }, CONTENT_INTRO.accessibilityQuestion, ' ',
      KdpLink({ href: CONTENT_HELP, text: CONTENT_INTRO.accessibleImagesHelp }))),
    h('div', { className: 'kdp-radio-stack kdp-radio-stack--accessibility' },
      ACCESSIBILITY_OPTIONS.map(function (o) {
        return h('label', { className: 'kdp-radio', key: o.value },
          h('input', { type: 'radio', name: 'accessibleImages', value: o.value, checked: state.accessibleImages === o.value, onChange: () => setField('accessibleImages', o.value) }),
          h('span', null, o.label)
        );
      })
    )
  );

  // --- Bottom navigation -------------------------------------------------------
  const handleBack = () => navigation.requestNavigation('details');
  // T7: a single derived flag drives BOTH the runtime guard inside doSave
  // and the disabled state of these buttons, so the UI cannot lie about
  // whether an operation is in flight. While either a save or an upload is
  // in progress, all three bottom action buttons are non-interactive.
  const operationInFlight = saving || uploadState.busy;
  const opTitle = saving
    ? 'Saving…'
    : uploadState.busy
    ? 'Upload in progress…'
    : '';
  const actions = h(
    'div',
    { className: 'kdp-actions kdp-actions--nav' },
    h('button', { type: 'button', className: 'kdp-btn kdp-btn--secondary kdp-btn--back', onClick: handleBack, title: 'Back to the Kindle eBook Details step.' }, '< Back to Details'),
    h(
      'div',
      { className: 'kdp-actions__group' },
      h('button', { type: 'button', className: 'kdp-btn kdp-btn--secondary', onClick: handleDraft, disabled: operationInFlight, title: operationInFlight ? opTitle : 'Save the current content without completing it.' }, saving ? 'Saving…' : 'Save as Draft'),
      h(
        'div',
        { className: 'kdp-actions__primary' },
        h('button', { type: 'button', className: 'kdp-btn kdp-btn--primary kdp-btn--continue', onClick: handleContinue, disabled: operationInFlight, title: operationInFlight ? opTitle : 'Complete the Content step.' }, saving ? 'Saving…' : 'Save and Continue'),
        h('div', { className: 'kdp-actions__next' }, 'Next step: Pricing')
      )
    )
  );

  const feedbackNote = feedback
    ? h('p', { className: 'kdp-note' + (feedback.kind === 'error' ? ' kdp-note--error' : ' kdp-note--ok') }, feedback.msg)
    : null;

  // Reusable Saving.../Done! blocking overlay. Demonstrated here for Content; the
  // same component is reused by Details/Pricing later. The Done state holds briefly
  // (~650ms, ~300ms with prefers-reduced-motion) then auto-clears. No fake timers;
  // visible only while a real save/upload call is in flight or just completed.
  const overlayEl = overlay
    ? h(
        'div',
        { className: 'kdp-save-overlay', role: 'status', 'aria-live': 'polite' },
        h(
          'div',
          { className: 'kdp-save-overlay__box' },
          overlay.phase === 'saving'
            ? h('div', { className: 'kdp-spinner', 'aria-hidden': 'true' })
            : h(KdpCheckIcon, { size: 28 }),
          h('p', { className: 'kdp-save-overlay__label' }, overlay.phase === 'saving' ? (overlay.label || 'Saving…') : 'Done!')
        )
      )
    : null;

  return h(
    'div',
    { className: 'kdp-app kdp-app--content' },
    bookTitle ? h('h1', { className: 'kdp-book-title' }, bookTitle) : null,
    ValidationSummary({ errs: validationErrors }),
    KdpProgressTiles({ progress: displayProgress, onNavigate: navigation.requestNavigation }),
    h('form', { className: 'kdp-form', onSubmit: (e) => e.preventDefault() },
      manuscriptSection,
      coverSection,
      aiSection,
      previewSection,
      isbnSection,
      accessibilitySection,
      actions,
      ValidationSummary({ errs: validationErrors }),
      feedbackNote
    ),
    navigation.modal,
    overlayEl
  );
}
