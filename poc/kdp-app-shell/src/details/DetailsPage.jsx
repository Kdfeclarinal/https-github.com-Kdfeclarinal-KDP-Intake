import React from 'react';
import { KDP_CATEGORIES, KDP_CATEGORY_LEAVES, KDP_CATEGORY_MAX, KDP_CATEGORY_ROOT } from './kdpCategories.js';
import { KdpProgress, KdpCheckIcon } from '../progress/KdpProgress.jsx';
import { useDirtyNavigation } from '../navigation/DirtyNavigationGuard.jsx';
import { useEmployeeUpdateSection } from '../employeeUpdates/EmployeeUpdateNotice.jsx';
import {
  serializeOptionalChoice,
  serializePublishingRights,
} from '../state/employeeState.js';

// Employee Kindle eBook Details page.
// Local form state persists through the server-authoritative employee save contract.
// Uses React.createElement so the classic IIFE build needs no JSX transform.
//
// This is a DIRECT, faithful translation of the live KDP Details UI
// (kdp-details-ui-audit-v1) and the project category taxonomy. No interpretive
// styling, no generic UI/UX judgment — the visual system comes from the spec.

const DESCRIPTION_MAX = 4000;
const KEYWORD_COUNT = 7;
const KEYWORD_MAX = 50;
const MAX_CONTRIBUTORS = 9;
const ROOT = KDP_CATEGORY_ROOT;

// Protected save endpoint — same scoped opaque-token model as the load.
// The raw access_token is read from the page URL at runtime; it is never
// persisted, logged, or embedded in the bundle.
const SAVE_ENDPOINT = 'https://wpuexhsrhuxieobeanjr.supabase.co/functions/v1/saveEmployeeStep';
const REQUIRED_KEYS = ['book_title', 'primary_author', 'description', 'publishing_rights', 'categories'];
// Client-side block text for the required keys (native KDP copy). Server remains authoritative.
const REQUIRED_MSG = {
  book_title: 'Enter a title.',
  primary_author: 'Add the author\'s name.',
  description: 'Enter a description of 4,000 characters or fewer.',
  publishing_rights: 'Enter a selection for publishing rights.',
  categories: 'Add a category for your book.',
};

// --- authoritative option lists (from live KDP audit) -------------------

const LANGUAGES = [
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Spanish' },
  { value: 'fr', label: 'French' },
  { value: 'de', label: 'German' },
  { value: 'it', label: 'Italian' },
  { value: 'pt', label: 'Portuguese' },
  { value: 'ja', label: 'Japanese' },
];

// Primary marketplace: visible label is the storefront name; the persisted
// value stays the hostname so backend state shape is unchanged.
// 13 storefronts per the KDP marketplace list (adds Amazon.nl + Amazon.com.mx).
const MARKETPLACES = [
  { value: 'amazon.com', label: 'Amazon.com' },
  { value: 'amazon.in', label: 'Amazon.in' },
  { value: 'amazon.co.uk', label: 'Amazon.co.uk' },
  { value: 'amazon.de', label: 'Amazon.de' },
  { value: 'amazon.fr', label: 'Amazon.fr' },
  { value: 'amazon.es', label: 'Amazon.es' },
  { value: 'amazon.it', label: 'Amazon.it' },
  { value: 'amazon.nl', label: 'Amazon.nl' },
  { value: 'amazon.co.jp', label: 'Amazon.co.jp' },
  { value: 'amazon.com.br', label: 'Amazon.com.br' },
  { value: 'amazon.ca', label: 'Amazon.ca' },
  { value: 'amazon.com.mx', label: 'Amazon.com.mx' },
  { value: 'amazon.com.au', label: 'Amazon.com.au' },
];

// Exact 9 roles captured from the live KDP contributor dialog.
const CONTRIBUTOR_ROLES = [
  { value: 'author', label: 'Author' },
  { value: 'editor', label: 'Editor' },
  { value: 'foreword', label: 'Foreword' },
  { value: 'illustrator', label: 'Illustrator' },
  { value: 'introduction', label: 'Introduction' },
  { value: 'narrator', label: 'Narrator' },
  { value: 'photographer', label: 'Photographer' },
  { value: 'preface', label: 'Preface' },
  { value: 'translator', label: 'Translator' },
];

// Reading Age: Select (placeholder), Baby, then 1..17 (per live audit capture).
const READING_AGE_OPTIONS = [{ value: 'baby', label: 'Baby' }].concat(
  Array.from({ length: 17 }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }))
);

// KDP informational links.
// `href` present  -> real KDP help link (opens new tab, rel noopener).
// `href` absent   -> JS-handler link whose audit href was void(0); rendered as
//                    a KDP-styled non-navigating element (no URL invented).
// The pre-order link in the live audit pointed at a real title-setup URL that
// embeds a private book id, so we render it as a bare (non-navigating) link to
// avoid leaking that id — consistent with the other bare KDP links here.
const LINKS = {
  supportedLanguages: { href: 'https://kdp.amazon.com/en_US/help/topic/A9FDO0A3V0119', text: 'Supported languages' },
  bookTitle: { href: 'https://kdp.amazon.com/en_US/help/topic/GW7J4WEKBVU25YEC', text: 'Book title guidelines' },
  startSeries: { href: 'https://kdp.amazon.com/en_US/help/topic/GMFKBUS43QQ5AJ5A', text: 'Learn how to start a series' },
  author: { href: 'https://kdp.amazon.com/en_US/help/topic/G2BWJN2BY98T5PV2', text: 'Author guidelines' },
  learnMore: { href: 'https://kdp.amazon.com/en_US/help/topic/G201097560', text: 'Learn more' },
  newEdition: { text: 'What counts as a new edition?' },
  publishingRights: { text: 'What are publishing rights?' },
  publicDomain: { text: 'What is a public domain work?' },
  formatDescription: { text: 'How do I format the description?' },
  categories: { text: 'What are categories?' },
  chooseKeywords: { text: 'How do I choose keywords?' },
  preorder: { text: 'Make my Kindle eBook available for Pre-order. Is KDP Pre-order right for me?' },
};

// --- helpers -------------------------------------------------------------

function h(tag, props, ...children) {
  return React.createElement(tag, props, ...children);
}

// --- dedicated KDP icon primitives (no icon package; explicit fills) -----

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

function KdpInfoIcon(props) {
  return Svg(props,
    h('circle', { cx: 8, cy: 8, r: 8, fill: '#007185' }),
    h('rect', { x: 7.3, y: 6.8, width: 1.4, height: 4.4, rx: 0.7, fill: '#fff' }),
    h('circle', { cx: 8, cy: 4.7, r: 0.95, fill: '#fff' })
  );
}

function KdpCloseIcon(props) {
  return Svg(props,
    h('path', { d: 'M4 4l8 8M12 4l-8 8', stroke: 'currentColor', 'stroke-width': '1.6', 'stroke-linecap': 'round' })
  );
}

function KdpChevronIcon(props) {
  return Svg(props,
    h('path', { d: 'M4 6l4 4 4-4', stroke: 'currentColor', 'stroke-width': '1.4', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })
  );
}

function KdpEditIcon(props) {
  return Svg(props,
    h('path', {
      d: 'M11.3 2.7l1.8 1.8c.4.4.4 1 0 1.4l-6.4 6.4-3.2.8.8-3.2 6.4-6.4c.4-.4 1-.4 1.4 0zM4 13h9',
      stroke: 'currentColor',
      'stroke-width': '1.3',
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
    })
  );
}

function KdpErrorIcon(props) {
  return Svg(props,
    h('circle', { cx: 8, cy: 8, r: 8, fill: '#c10015' }),
    h('rect', { x: 7.3, y: 4.4, width: 1.4, height: 4.9, rx: 0.7, fill: '#fff' }),
    h('circle', { cx: 8, cy: 11.3, r: 0.95, fill: '#fff' })
  );
}

function KdpNumberedListIcon() {
  return Svg(null,
    h('path', { d: 'M6 3.5h7M6 8h7M6 12.5h7', stroke: 'currentColor', 'stroke-width': '1.3', 'stroke-linecap': 'round' }),
    h('text', { x: 2, y: 5.5, 'font-size': '4', fill: 'currentColor' }, '1'),
    h('text', { x: 2, y: 10, 'font-size': '4', fill: 'currentColor' }, '2'),
    h('text', { x: 2, y: 14.5, 'font-size': '4', fill: 'currentColor' }, '3')
  );
}

function KdpBulletedListIcon() {
  return Svg(null,
    h('path', { d: 'M6 3.5h7M6 8h7M6 12.5h7', stroke: 'currentColor', 'stroke-width': '1.3', 'stroke-linecap': 'round' }),
    h('circle', { cx: 3, cy: 3.5, r: 1, fill: 'currentColor' }),
    h('circle', { cx: 3, cy: 8, r: 1, fill: 'currentColor' }),
    h('circle', { cx: 3, cy: 12.5, r: 1, fill: 'currentColor' })
  );
}

function KdpSourceIcon() {
  return Svg(null,
    h('path', { d: 'M5 4l-2 4 2 4M11 4l2 4-2 4M9 3l-2 10', stroke: 'currentColor', 'stroke-width': '1.3', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })
  );
}

function KdpCalendarIcon() {
  return Svg(
    { size: 18, className: 'kdp-calendar-icon' },
    h('rect', { x: 2.5, y: 3.5, width: 11, height: 10, rx: 1.6, fill: 'none', stroke: 'currentColor', 'stroke-width': '1.3' }),
    h('path', { d: 'M2.5 6.5h11M5.5 2v3M10.5 2v3', stroke: 'currentColor', 'stroke-width': '1.3', 'stroke-linecap': 'round' })
  );
}

function KdpSearchIcon() {
  return Svg(
    { size: 18, className: 'kdp-series-search__icon' },
    h('circle', { cx: 7, cy: 7, r: 4.4, fill: 'none', stroke: 'currentColor', 'stroke-width': '1.4' }),
    h('path', { d: 'M10.4 10.4L13.6 13.6', stroke: 'currentColor', 'stroke-width': '1.4', 'stroke-linecap': 'round' })
  );
}

// Native value <-> React value domain maps (the live page stores the full
// lowercase language name and capitalized contributor labels).
const NATIVE_LANG_BY_CODE = { en: 'english', es: 'spanish', fr: 'french', de: 'german', it: 'italian', pt: 'portuguese', ja: 'japanese' };
const NATIVE_ROLE_BY_VALUE = {};
CONTRIBUTOR_ROLES.forEach(function (r) { NATIVE_ROLE_BY_VALUE[r.value] = r.label; });

function initState(book, saved) {
  const s = saved && typeof saved === 'object' ? saved : {};
  const sections = s.sections && typeof s.sections === 'object' ? s.sections : null;
  // Hydrate from the native sections wrapper (state_json from the server).
  const v = (key, pick) => {
    const sec = sections && sections[key];
    if (!sec) return undefined;
    return pick ? pick(sec) : sec.value;
  };
  const emptyKeywords = Array.from({ length: KEYWORD_COUNT }, () => '');
  const savedKeywords = v('keywords', (sec) => sec.value.keywords) || [];
  var authorName = [];
  const pa = v('primary_author');
  if (pa && typeof pa === 'object') {
    const f = v('primary_author', (sec) => sec.fields) || {};
    authorName = [f.author_first_name, f.author_last_name].filter(Boolean);
    if (!authorName.length && pa.value) authorName = String(pa.value).trim().split(/\s+/);
  } else if (typeof pa === 'string' && pa.trim()) {
    authorName = pa.trim().split(/\s+/);
  }
  const langFull = v('language') || (book && (book.kdp_language || book.language)) || 'en';
  const langCode = NATIVE_LANG_BY_CODE[langFull] ? langFull : (Object.keys(NATIVE_LANG_BY_CODE).find((c) => NATIVE_LANG_BY_CODE[c] === langFull) || langFull || 'en');
  const contribs = v('contributors');
  const rightsFull = v('publishing_rights') || '';
  const rightsCode = rightsFull === 'copyright_owner' ? 'copyright' : (rightsFull === 'public_domain' ? 'public_domain' : '');
  const age = v('age_grade_range', (sec) => sec.value) || {};
  const catsValue = v('categories', (sec) => sec.value) || {};
  // categories.json is a stringified array of { root, path, category, subcategories, placement, displayPath }.
  let savedCats = [];
  try {
    const parsed = typeof catsValue.json === 'string' ? JSON.parse(catsValue.json) : (Array.isArray(catsValue.json) ? catsValue.json : []);
    savedCats = (Array.isArray(parsed) ? parsed : []).map(function (e) {
      const display = (e.displayPath || (e.root + (e.path && e.path.length ? ' › ' + e.path.join(' › ') : '') + (e.placement ? ' › ' + e.placement : ''))).replace(/ > /g, ' › ');
      return { key: display.toLowerCase(), name: display };
    });
  } catch (e) { savedCats = []; }
  const pre = v('preorder') || {};
  return {
    language: langCode,
    bookTitle: v('book_title') || (book && book.book_title) || '',
    subtitle: v('subtitle') || '',
    seriesOpen: false,
    seriesName: '',
    editionNumber: v('edition_number') || '',
    primaryAuthor: {
      firstName: authorName[0] || '',
      lastName: authorName.slice(1).join(' ') || '',
    },
    contributors:
      Array.isArray(contribs) && contribs.length
        ? contribs.map(function (c) {
            const roleCode = c && c.role ? (NATIVE_ROLE_BY_VALUE[c.role] ? c.role : (Object.keys(NATIVE_ROLE_BY_VALUE).find((v) => NATIVE_ROLE_BY_VALUE[v] === c.role) || c.role)) : 'author';
            return {
              role: roleCode,
              firstName: (c && c.firstName) || '',
              lastName: (c && c.lastName) || '',
            };
          })
        : [{ role: 'author', firstName: '', lastName: '' }],
    description: v('description', (sec) => sec.value.text) || '',
    publishingRights: rightsCode,
    adultOnly: v('adult_question') || '',
    readingAgeMin: (age.reading_age_min != null && String(age.reading_age_min)) || '',
    readingAgeMax: (age.reading_age_max != null && String(age.reading_age_max)) || '',
    marketplace: v('primary_marketplace') || (book && book.primary_marketplace) || 'amazon.com',
    categories: savedCats,
    keywords: Array.from({ length: KEYWORD_COUNT }, function (_, i) { return savedKeywords[i] || ''; }),
    publishOption: (pre.releaseMode) || 'release_now',
    preorderDate: (pre.releaseDateGMT) || '',
  };
}

// --- save payload builders (native contract) --------------------------------
// Emits the full state_json wrapper with keyed sections, plus extracted_fields
// helpers. Field-level shapes match the authoritative live GHL details page.
// Series is intentionally absent — it is UI-only and not part of the Details
// save contract.

function cleanOptional(v) {
  return v === undefined || v === null ? '' : v;
}

function buildProgressState(activeStep) {
  return {
    activeStep: activeStep,
    steps: {
      details: { status: activeStep === 'details' ? 'in_progress' : 'complete', isUnlocked: true, isComplete: activeStep !== 'details' },
      content: { status: activeStep === 'content' ? 'in_progress' : 'locked', isUnlocked: activeStep === 'content', isComplete: false },
      pricing: { status: 'locked', isUnlocked: false, isComplete: false },
    },
  };
}

function buildCategoriesValue(cats) {
  var entries = [];
  if (Array.isArray(cats)) {
    entries = cats.map(function (c) {
      var parts = String(c && c.name || '').split(' › ').filter(Boolean);
      if (!parts.length) return null;
      var root = parts[0];
      var placement = parts[parts.length - 1];
      var path = parts.slice(1, -1);
      var category = path.length ? path[0] : '';
      var subcategories = path.length > 1 ? path.slice(1) : [];
      return { root: root, path: path, category: category, subcategories: subcategories, placement: placement, displayPath: parts.join(' > ') };
    }).filter(Boolean);
  }
  return {
    selections: entries.map(function (e) { return { root: e.root, path: e.path.slice(), category: e.category, subcategories: e.subcategories.slice(), placement: e.placement, displayPath: e.displayPath }; }),
    selectedCount: entries.length,
    maxSelected: KDP_CATEGORY_MAX,
    displayText: entries.map(function (e) { return e.displayPath; }).join('\n'),
    json: entries.length ? JSON.stringify(entries.map(function (e) { return { root: e.root, path: e.path.slice(), category: e.category, subcategories: e.subcategories.slice(), placement: e.placement, displayPath: e.displayPath }; }), null, 2) : '[]',
    lastSaved: entries.map(function (e) { return { root: e.root, path: e.path.slice(), category: e.category, subcategories: e.subcategories.slice(), placement: e.placement, displayPath: e.displayPath }; }),
  };
}

function buildStateJson(s, saveType, activeStep, errs) {
  var sections = {
    language: { sectionKey: 'language', sectionLabel: 'Language', wrapperSelector: '#custom-code-LQpuP3XOMQ', storageStrategy: 'page_json', booksColumn: null, required: false, reviewable: true, value: NATIVE_LANG_BY_CODE[s.language] || 'english' },
    book_title: { sectionKey: 'book_title', sectionLabel: 'Book Title', wrapperSelector: '#custom-code-Alppf8QDvH', storageStrategy: 'dedicated_column', booksColumn: 'book_title', required: true, reviewable: true, value: s.bookTitle },
    subtitle: { sectionKey: 'subtitle', sectionLabel: 'Subtitle', wrapperSelector: '#custom-code-j4SrVFbPtR', storageStrategy: 'dedicated_column', booksColumn: 'subtitle', required: false, reviewable: true, value: s.subtitle },
    edition_number: { sectionKey: 'edition_number', sectionLabel: 'Edition Number / Series Info', wrapperSelector: '#custom-code-lW9ss8QCsv', storageStrategy: 'page_json', booksColumn: null, required: false, reviewable: true, value: s.editionNumber },
    primary_author: { sectionKey: 'primary_author', sectionLabel: 'Primary Author', wrapperSelector: '#custom-code-Ov8kPjV-mW', storageStrategy: 'dedicated_column', booksColumn: 'primary_author_name', required: true, reviewable: true, value: [s.primaryAuthor.firstName, s.primaryAuthor.lastName].filter(Boolean).join(' '), fields: { author_first_name: s.primaryAuthor.firstName, author_last_name: s.primaryAuthor.lastName } },
    contributors: { sectionKey: 'contributors', sectionLabel: 'Contributors', wrapperSelector: '#custom-code-AHb2KdiWfO', storageStrategy: 'review_item', booksColumn: null, required: false, reviewable: true, value: s.contributors.map(function (c) { var roleLabel = NATIVE_ROLE_BY_VALUE[c.role] || 'Author'; return { role: roleLabel, firstName: c.firstName, lastName: c.lastName, fullName: [c.firstName, c.lastName].filter(Boolean).join(' ') }; }) },
    description: { sectionKey: 'description', sectionLabel: 'Description', wrapperSelector: '#custom-code-zEDVDgQMTg', storageStrategy: 'review_item', booksColumn: null, required: true, reviewable: true, value: { html: s.description, text: s.description, source: '', sourceMode: false, characterCount: s.description.length, remainingCharacters: DESCRIPTION_MAX - s.description.length, maxCharacters: DESCRIPTION_MAX } },
    publishing_rights: { sectionKey: 'publishing_rights', sectionLabel: 'Publishing Rights', wrapperSelector: '#custom-code-XpFnYPLsfO', storageStrategy: 'review_item', booksColumn: null, required: true, reviewable: true, value: serializePublishingRights(s.publishingRights), label: s.publishingRights === 'public_domain' ? 'This is a public domain work. What is a public domain work?' : (s.publishingRights === 'copyright' ? 'I own the copyright and I hold the necessary publishing rights. What are publishing rights?' : '') },
    adult_question: { sectionKey: 'adult_question', sectionLabel: 'Adult Content Question', wrapperSelector: '#custom-code-zPDxMwyMCS', storageStrategy: 'review_item', booksColumn: null, required: false, reviewable: true, value: serializeOptionalChoice(s.adultOnly, ['yes', 'no']), label: s.adultOnly === 'yes' ? 'Yes' : (s.adultOnly === 'no' ? 'No' : '') },
    age_grade_range: { sectionKey: 'age_grade_range', sectionLabel: 'Age and Grade Range', wrapperSelector: '#custom-code-20X4apRnbR', storageStrategy: 'review_item', booksColumn: null, required: false, reviewable: true, value: { reading_age_min: s.readingAgeMin || '', reading_age_max: s.readingAgeMax || '' }, fields: { reading_age_min: s.readingAgeMin || '', reading_age_max: s.readingAgeMax || '' } },
    primary_marketplace: { sectionKey: 'primary_marketplace', sectionLabel: 'Primary Marketplace', wrapperSelector: '#custom-code-TduJNHpI04', storageStrategy: 'dedicated_column', booksColumn: 'primary_marketplace', required: false, reviewable: true, value: s.marketplace },
    categories: { sectionKey: 'categories', sectionLabel: 'Categories', wrapperSelector: '#custom-code-Fju8Br12Wa', storageStrategy: 'review_item', booksColumn: null, required: true, reviewable: true, value: buildCategoriesValue(s.categories) },
    keywords: { sectionKey: 'keywords', sectionLabel: 'Keywords', wrapperSelector: '#custom-code-W8ztlhlKkr', storageStrategy: 'review_item', booksColumn: null, required: false, reviewable: true, value: { keywords: s.keywords.map(function (k) { return String(k).slice(0, KEYWORD_MAX); }), filledCount: s.keywords.filter(function (k) { return String(k).trim() !== ''; }).length, maxKeywords: KEYWORD_COUNT, maxCharactersPerKeyword: KEYWORD_MAX } },
    preorder: { sectionKey: 'preorder', sectionLabel: 'Pre-Order', wrapperSelector: '#custom-code-sDZTg6xzEk', storageStrategy: 'review_item', booksColumn: null, required: false, reviewable: true, value: { releaseMode: s.publishOption, preorderEnabled: s.publishOption === 'preorder', releaseDateGMT: s.preorderDate || null, isValid: true, validationMessage: '' } },
  };
  return {
    page: 'details',
    stepName: 'details',
    stepLabel: 'Kindle eBook Details',
    saveType: saveType,
    savedAt: new Date().toISOString(),
    sections: sections,
    extractedFields: { book_title: s.bookTitle, subtitle: s.subtitle || null, primary_author_name: [s.primaryAuthor.firstName, s.primaryAuthor.lastName].filter(Boolean).join(' ') || null, primary_marketplace: s.marketplace },
    progressState: buildProgressState(activeStep),
    validationRequiredKeys: REQUIRED_KEYS,
    validationErrors: errs || {},
  };
}

// extracted_fields carries the handful of top-level values the backend reads
// straight off the book record. Exact keys per the native contract.
function buildExtractedFields(s) {
  return {
    book_title: s.bookTitle,
    subtitle: s.subtitle || null,
    primary_author_name: [s.primaryAuthor.firstName, s.primaryAuthor.lastName].filter(Boolean).join(' ') || null,
    primary_marketplace: s.marketplace,
  };
}

// Required-key check for a COMPLETE submission only. Returns { key: message }.
function requiredErrors(s) {
  const errs = {};
  if (!String(cleanOptional(s.bookTitle)).trim()) errs.book_title = REQUIRED_MSG.book_title;
  if (!String(cleanOptional(s.primaryAuthor.firstName)).trim() && !String(cleanOptional(s.primaryAuthor.lastName)).trim())
    errs.primary_author = REQUIRED_MSG.primary_author;
  if (!String(cleanOptional(s.description)).trim()) errs.description = REQUIRED_MSG.description;
  if (!s.publishingRights) errs.publishing_rights = REQUIRED_MSG.publishing_rights;
  if (!s.categories || s.categories.length === 0) errs.categories = REQUIRED_MSG.categories;
  return errs;
}

// Map a server-returned progress_state onto the 3-tile display. The server
// shape is not invented here — both the native {activeStep, steps:{...}} form
// and the legacy flat {details:'complete',...} form are honored; anything else
// falls back to the safe default (Details in progress, Content + Pricing locked).
function progressFromServer(ps) {
  const out = {
    details: { status: 'in_progress', active: true },
    content: { status: 'locked', active: false },
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
  const activeStep = ps.activeStep || ps.current_step || null;
  ['details', 'content', 'pricing'].forEach(function (k) {
    const status =
      raw[k] ||
      (k === activeStep
        ? 'in_progress'
        : k === 'details'
          ? 'in_progress'
          : 'locked');
    out[k] = { status: status, active: k === activeStep || status === 'in_progress' };
  });
  return out;
}

// Build a safe, user-presentable error message from a save response. Never
// echo back request bodies or token values.
function safeSaveError(data, status) {
  if (data && typeof data.error === 'string' && data.error) return data.error;
  if (data && typeof data.message === 'string' && data.message) return data.message;
  if (status) return 'The save could not be completed (HTTP ' + status + '). No changes were saved.';
  return 'The save could not be completed. No changes were saved.';
}

// --- small presentational helpers ---------------------------------------

function Section({ label, children, error }) {
  const update = useEmployeeUpdateSection(label);
  return h(
    'div',
    { className: `kdp-section${update.locked ? ' kdp-section--update-locked' : ''}${update.requested ? ' kdp-section--update-requested' : ''}`, inert: update.locked ? '' : undefined, 'aria-disabled': update.locked ? 'true' : undefined },
    h('div', { className: 'kdp-section-label' }, h('span', null, label)),
    h(
      'div',
      { className: 'kdp-section-content' },
      children,
      error ? h(KdpErrorAlert, null, error) : null
    )
  );
}

function Label({ children, htmlFor }) {
  return h('label', { className: 'kdp-label', htmlFor }, children);
}

function Help({ children }) {
  return h('p', { className: 'kdp-help' }, children);
}

function KdpLink({ link }) {
  if (link.href) {
    return h(
      'a',
      {
        className: 'kdp-link',
        href: link.href,
        target: '_blank',
        rel: 'noopener noreferrer',
      },
      link.text
    );
  }
  // Non-navigating KDP-styled link (audit href was void(0); no URL invented).
  return h(
    'span',
    {
      className: 'kdp-link kdp-link--bare',
      role: 'link',
      tabIndex: 0,
      onClick: (e) => e.preventDefault(),
      onKeyDown: (e) => {
        if (e.key === 'Enter' || e.key === ' ') e.preventDefault();
      },
    },
    link.text
  );
}

function TextField({ id, value, onChange, placeholder, maxLength, onBlur }) {
  return h('input', {
    id,
    className: 'kdp-input',
    type: 'text',
    value: value || '',
    placeholder: placeholder || '',
    maxLength: maxLength || undefined,
    onChange: (e) => onChange(e.target.value),
    onBlur: onBlur || undefined,
  });
}

function Select({ id, value, onChange, options, defaultLabel }) {
  return h(
    'select',
    {
      id,
      className: 'kdp-select',
      value: value || '',
      onChange: (e) => onChange(e.target.value),
    },
    h('option', { value: '' }, defaultLabel || 'Select'),
    ...options.map((o) => h('option', { key: o.value, value: o.value }, o.label))
  );
}

// --- inline error alert (4-sided red border) -----------------------------

function KdpErrorAlert({ children }) {
  return h(
    'div',
    { className: 'kdp-error-alert', role: 'alert' },
    KdpErrorIcon({ className: 'kdp-error-alert__icon' }),
    h('div', { className: 'kdp-error-alert__msg' }, children)
  );
}

// --- completion validation summary ------------------------------------
// Native copy: "Please fix the highlighted error(s) to continue." plus the
// applicable required-field messages. Rendered both above the progress tiles
// and below the Save buttons when a COMPLETE save is blocked client-side.

// Ordered list of the required-field messages currently failing (native order).
function validationMessages(errs) {
  const out = [];
  REQUIRED_KEYS.forEach(function (k) {
    if (errs[k]) out.push(errs[k]);
  });
  return out;
}

function ValidationSummary({ errs }) {
  const items = validationMessages(errs);
  if (items.length === 0) return null;
  return h(
    'div',
    { className: 'kdp-validation-summary', role: 'alert' },
    h('p', { className: 'kdp-validation-summary__title' }, 'Please fix the highlighted error(s) to continue.'),
    h(
      'ul',
      { className: 'kdp-validation-summary__list' },
      items.map(function (m) {
        return h('li', { className: 'kdp-validation-summary__item', key: m }, m);
      })
    )
  );
}

// --- 3-step progress header (KDP-style tiles) ----------------------------
//
// KdpProgress is shared between DetailsPage and ContentPage (see
// src/progress/KdpProgress.jsx). When `currentStep` is provided,
// the visual "is-active" underline is determined by currentStep
// (unlocked-only) instead of the server's progress[key].active
// flag. The Complete / In Progress / Not Started text is still
// derived from the server's progress[key].status.

// --- Series modal (local multi-step flow; no external API; no save) ------

function SeriesModal({ onClose }) {
  const [step, setStep] = React.useState('start');
  const [search, setSearch] = React.useState('');

  const close = () => onClose(); // parent resets to 'start'

  const Back = (to) => () => setStep(to);

  const startCards = [
    {
      key: 'new',
      title: 'New series',
      desc: 'Add this title to a new series.',
      action: 'Create series',
      onClick: () => setStep('relation'),
    },
    {
      key: 'existing',
      title: 'Existing series',
      desc: 'Add this title to an existing series.',
      action: 'Select series',
      onClick: () => setStep('select-series'),
    },
  ];

  const relationCards = [
    {
      key: 'main',
      title: 'Main content',
      desc: 'This book is one of the primary titles in the series.',
      action: 'Main content',
      onClick: () => setStep('create-next'),
    },
    {
      key: 'related',
      title: 'Related content',
      desc: 'This book is supplemental content for the series (i.e. prequel, short story, etc.).',
      action: 'Related content',
      onClick: () => setStep('related-type'),
    },
  ];

  const relatedTypes = [
    { title: 'Box set or collection', desc: 'This is a set of items bundled together, containing content related to the series.' },
    { title: 'Novella', desc: 'A short novel (or long short story), related to the main titles in the series.' },
    { title: 'Prequel', desc: 'A story featuring events preceding the main titles in the series.' },
    { title: 'Short story', desc: 'A single short story or a collection of short stories related to the main titles in the series.' },
    { title: 'Other', desc: 'Content that does not meet the other selections, but is related to the series.' },
  ];

  const header = (title) =>
    h(
      'div',
      { className: 'kdp-series-modal__header' },
      h('h2', { className: 'kdp-series-modal__title' }, title),
      h('button', { type: 'button', className: 'kdp-modal__close', 'aria-label': 'Close', onClick: close }, KdpCloseIcon())
    );

  const body = (...children) => h('div', { className: 'kdp-series-modal__body' }, ...children);

  const card = (c) =>
    h(
      'button',
      { type: 'button', className: 'kdp-series-card', onClick: c.onClick },
      h(
        'div',
        null,
        h('div', { className: 'kdp-series-card__title' }, c.title),
        h('div', { className: 'kdp-series-card__desc' }, c.desc)
      ),
      h('div', { className: 'kdp-series-card__action' },
        h('button', { type: 'button', className: 'kdp-btn kdp-btn--primary', onClick: (e) => { e.stopPropagation(); c.onClick(); } }, c.action)
      )
    );

  let content;
  if (step === 'start') {
    content = body(
      startCards.map((c) => card(c))
    );
  } else if (step === 'relation') {
    content = body(
      h('h3', { className: 'kdp-series-step-heading' }, 'How is this title related to the series?'),
      relationCards.map((c) => card(c)),
      h('div', { className: 'kdp-series-modal__actions' },
        h('button', { type: 'button', className: 'kdp-btn kdp-btn--secondary', onClick: Back('start') }, 'Back')
      )
    );
  } else if (step === 'create-next') {
    content = body(
      h('h3', { className: 'kdp-series-step-heading' }, 'Next step: Enter series details'),
      h('p', { className: 'kdp-help' }, 'You’ll be taken to a new page to create the series. Your title changes will be saved as draft. Linked formats will be automatically added to the series once title setup is complete.'),
      h('div', { className: 'kdp-series-modal__actions' },
        h('button', { type: 'button', className: 'kdp-btn kdp-btn--secondary', onClick: Back('relation') }, 'Back'),
        h('button', { type: 'button', className: 'kdp-btn kdp-btn--primary', onClick: (e) => { e.preventDefault(); } }, 'Go to series setup')
      )
    );
  } else if (step === 'related-type') {
    content = body(
      h('h3', { className: 'kdp-series-step-heading' }, 'Select the type of content this title best matches'),
      relatedTypes.map((t) =>
        h(
          'button',
          { type: 'button', className: 'kdp-related-type', onClick: (e) => { e.preventDefault(); } },
          h('span', { className: 'kdp-related-type-title' }, t.title),
          h('span', { className: 'kdp-related-type-description' }, t.desc)
        )
      ),
      h('div', { className: 'kdp-series-modal__actions' },
        h('button', { type: 'button', className: 'kdp-btn kdp-btn--secondary', onClick: Back('relation') }, 'Back')
      )
    );
  } else if (step === 'select-series') {
    content = body(
      h('h3', { className: 'kdp-series-step-heading' }, 'Select a series:'),
      h(
        'div',
        { className: 'kdp-series-search' },
        h(
          'div',
          { className: 'kdp-series-search__field' },
          h(KdpSearchIcon()),
          h('input', {
            className: 'kdp-series-search__input',
            type: 'text',
            value: search,
            onChange: (e) => setSearch(e.target.value),
          })
        ),
        h('button', { type: 'button', className: 'kdp-series-search__btn', onClick: (e) => { e.preventDefault(); } }, 'Search')
      ),
      h('p', { className: 'kdp-series-no-results' }, 'No results'),
      h(
        'p',
        { className: 'kdp-series-no-results' },
        'Don’t see your series listed? Check your spelling or use different search terms. You can only add a title to a series that is associated with your account and is not already part of another series.'
      ),
      h('div', { className: 'kdp-series-modal__actions' },
        h('button', { type: 'button', className: 'kdp-btn kdp-btn--secondary', onClick: Back('start') }, 'Back')
      )
    );
  }

  return h(
    'div',
    { className: 'kdp-modal-overlay', onClick: (e) => { if (e.target === e.currentTarget) close(); } },
    h(
      'div',
      { className: 'kdp-series-modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Add title to a series' },
      header('Add title to a series'),
      content
    )
  );
}

// --- Category modal (path-driven recursive drill-down + accordion blocks) ---

// Resolve a tree node by a category path array (source-faithful: names only).
function catGetNodeByPath(path) {
  let nodes = KDP_CATEGORIES;
  let current = null;
  for (let k = 0; k < path.length; k++) {
    current = (nodes || []).find((item) => item.name === path[k]);
    if (!current) return null;
    nodes = current.children || [];
  }
  return current;
}

const CAT_DEFAULT_ROOT_PLACEMENTS = ['Classics', 'General'];

function catGetPlacementsForPath(path) {
  if (!path.length) {
    return { title: KDP_CATEGORY_ROOT, placements: CAT_DEFAULT_ROOT_PLACEMENTS, emptyMessage: '' };
  }
  const node = catGetNodeByPath(path);
  if (!node) {
    return { title: path[path.length - 1] || KDP_CATEGORY_ROOT, placements: [], emptyMessage: 'Choose a valid category path.' };
  }
  if (Array.isArray(node.placements) && node.placements.length) {
    return { title: node.name, placements: node.placements, emptyMessage: '' };
  }
  const leaf = (KDP_CATEGORY_LEAVES || []).find(
    (item) => Array.isArray(item.path) && item.path.join('') === path.join('')
  );
  if (leaf && Array.isArray(leaf.placements) && leaf.placements.length) {
    return { title: path[path.length - 1] || KDP_CATEGORY_ROOT, placements: leaf.placements, emptyMessage: '' };
  }
  return {
    title: node.name,
    placements: [],
    emptyMessage:
      Array.isArray(node.children) && node.children.length
        ? 'Choose a subcategory to view placement options.'
        : 'No placement options found for this path in the category snapshot.',
  };
}

function catBuildDisplayPath(path, placement) {
  return [KDP_CATEGORY_ROOT].concat(path || []).concat(placement ? [placement] : []).join(' › ');
}
function catBuildStorageKey(path, placement) {
  return catBuildDisplayPath(path, placement).toLowerCase();
}

function catParseName(name) {
  if (!name) return { path: [], placement: '' };
  const parts = name.split(' › ');
  const placement = parts[parts.length - 1] || '';
  const path = parts.slice(1, parts.length - 1).filter(Boolean);
  return { path, placement };
}

let CAT_BLOCK_SEQ = 0;
function catCreateBlock(collapsed) {
  CAT_BLOCK_SEQ += 1;
  return { id: 'cat_' + CAT_BLOCK_SEQ, path: [], selectedPlacements: [], collapsed: Boolean(collapsed) };
}

function KdpCategoryModal({ existing, onSave, onCancel }) {
  const [blocks, setBlocks] = React.useState(() => {
    if (existing && existing.length) {
      return existing.map((c) => {
        const { path, placement } = catParseName(c.name);
        return { id: 'cat_' + (CAT_BLOCK_SEQ += 1), path, selectedPlacements: placement ? [placement] : [], collapsed: false };
      });
    }
    return [catCreateBlock(false)];
  });

  const [saveNote, setSaveNote] = React.useState('');
  const topNodes = KDP_CATEGORIES;

  const allSelections = () =>
    blocks.reduce((acc, b) => {
      b.selectedPlacements.forEach((p) => acc.push({ blockId: b.id, path: b.path.slice(), placement: p }));
      return acc;
    }, []);

  const totalChecked = allSelections().length;
  const atMax = totalChecked >= KDP_CATEGORY_MAX;

  const isDuplicateOutsideBlock = (block, placement) => {
    const key = catBuildStorageKey(block.path, placement);
    return blocks.some((other) => {
      if (other.id === block.id) return false;
      return other.selectedPlacements.some((item) => catBuildStorageKey(other.path, item) === key);
    });
  };

  const updateBlock = (id, patch) =>
    setBlocks((b) => b.map((blk) => (blk.id === id ? Object.assign({}, blk, patch) : blk)));

  const onSelectLevel = (id, level, value) => {
    setBlocks((b) =>
      b.map((blk) => {
        if (blk.id !== id) return blk;
        const path = blk.path.slice(0, level);
        if (value) path[level] = value;
        return Object.assign({}, blk, { path, selectedPlacements: [] });
      })
    );
  };

  const togglePlacement = (id, placement) => {
    setBlocks((b) =>
      b.map((blk) => {
        if (blk.id !== id) return blk;
        const checked = blk.selectedPlacements.includes(placement);
        if (checked) {
          return Object.assign({}, blk, {
            selectedPlacements: blk.selectedPlacements.filter((p) => p !== placement),
          });
        }
        const selections = allSelections().concat([{ blockId: id, path: blk.path, placement }]);
        if (selections.length > KDP_CATEGORY_MAX) return blk;
        if (isDuplicateOutsideBlock(blk, placement)) return blk;
        return Object.assign({}, blk, { selectedPlacements: blk.selectedPlacements.concat(placement) });
      })
    );
  };

  const toggleBlock = (id) => {
    setBlocks((b) => {
      const target = b.find((blk) => blk.id === id);
      const willExpand = target ? target.collapsed : false;
      return b.map((blk) =>
        blk.id === id
          ? Object.assign({}, blk, { collapsed: !willExpand })
          : Object.assign({}, blk, { collapsed: true })
      );
    });
  };

  const resetBlock = (id) =>
    setBlocks((b) =>
      b.map((blk) =>
        blk.id === id ? Object.assign({}, blk, { path: [], selectedPlacements: [], collapsed: false }) : blk
      )
    );

  const deleteBlock = (id) => {
    setBlocks((b) => {
      const next = b.filter((blk) => blk.id !== id);
      if (next.length && !next.some((blk) => !blk.collapsed)) {
        next[next.length - 1] = Object.assign({}, next[next.length - 1], { collapsed: false });
      }
      return next;
    });
  };

  const addBlock = () => {
    setBlocks((b) => {
      if (b.length >= KDP_CATEGORY_MAX) return b;
      if (allSelections().length >= KDP_CATEGORY_MAX) return b;
      const collapsed = b.map((blk) => Object.assign({}, blk, { collapsed: true }));
      return collapsed.concat([catCreateBlock(false)]);
    });
  };

  const removeSelection = (blockId, placement) =>
    setBlocks((b) =>
      b.map((blk) =>
        blk.id === blockId
          ? Object.assign({}, blk, { selectedPlacements: blk.selectedPlacements.filter((p) => p !== placement) })
          : blk
      )
    );

  const close = () => onCancel();

  const breadcrumbFor = (block) => [KDP_CATEGORY_ROOT].concat(block.path).join(' › ');

  // Dependent Subcategory selects rendered at every depth where the current
  // node still has children (source-faithful recursive drill-down).
  const renderDropdownStack = (block) => {
    const selects = [
      h(
        'div',
        { className: 'kdp-cat-field' },
        h('span', { className: 'kdp-cat-field-label' }, 'Category'),
        Select({
          id: 'kdp-cat-top-' + block.id,
          value: block.path[0] || '',
          onChange: (v) => onSelectLevel(block.id, 0, v),
          options: topNodes.map((n) => ({ value: n.name, label: n.name })),
          defaultLabel: 'Select one',
        })
      ),
    ];
    for (let level = 1; level <= block.path.length; level++) {
      const children = (() => {
        if (level === 1) {
          const top = topNodes.find((n) => n.name === block.path[0]);
          return top && Array.isArray(top.children) ? top.children : [];
        }
        const parent = catGetNodeByPath(block.path.slice(0, level));
        return parent && Array.isArray(parent.children) ? parent.children : [];
      })();
      if (!children.length) break;
      selects.push(
        h(
          'div',
          { className: 'kdp-cat-field', style: { marginTop: '12px' } },
          h('span', { className: 'kdp-cat-field-label' }, 'Subcategory'),
          Select({
            id: 'kdp-cat-sub-' + block.id + '-' + level,
            value: block.path[level] || '',
            onChange: (v) => onSelectLevel(block.id, level, v),
            options: children.map((n) => ({ value: n.name, label: n.name })),
            defaultLabel: 'Select one',
          })
        )
      );
    }
    return selects;
  };

  const renderPlacements = (block) => {
    const info = catGetPlacementsForPath(block.path);
    const body = info.placements.length
      ? h(
          'div',
          { className: 'kdp-placement-grid' },
          info.placements.map((placement) => {
            const checked = block.selectedPlacements.includes(placement);
            const disabledByLimit = !checked && atMax;
            const disabledByDuplicate = !checked && isDuplicateOutsideBlock(block, placement);
            const disabled = disabledByLimit || disabledByDuplicate;
            return h(
              'label',
              { key: placement, className: 'kdp-placement-option' + (disabled ? ' is-disabled' : '') },
              h('input', {
                type: 'checkbox',
                checked: checked,
                disabled: disabled,
                onChange: () => togglePlacement(block.id, placement),
              }),
              h('span', null, placement)
            );
          })
        )
      : h('div', { className: 'kdp-cat-empty-placement' }, info.emptyMessage);
    return h(
      'div',
      { className: 'kdp-cat-placement-panel' },
      h('div', { className: 'kdp-cat-placement-title' }, info.title),
      body
    );
  };

  const renderBlock = (block) =>
    h(
      'section',
      {
        key: block.id,
        className: 'kdp-cat-block ' + (block.collapsed ? 'is-collapsed' : 'is-expanded'),
        'data-block-id': block.id,
      },
      h(
        'div',
        { className: 'kdp-cat-block-header' },
        h(
          'button',
          { type: 'button', className: 'kdp-cat-block-toggle', onClick: () => toggleBlock(block.id) },
          h('span', null, breadcrumbFor(block)),
          h('span', { className: 'kdp-cat-arrow' }, block.collapsed ? '⌄' : '⌃')
        ),
        h(
          'div',
          { className: 'kdp-cat-block-actions' },
          h('button', { type: 'button', className: 'kdp-cat-link-btn', onClick: () => resetBlock(block.id) }, 'Reset'),
          blocks.length > 1
            ? h('button', { type: 'button', className: 'kdp-cat-link-btn', onClick: () => deleteBlock(block.id) }, 'Delete')
            : null
        )
      ),
      block.collapsed
        ? null
        : h(
            'div',
            { className: 'kdp-cat-block-body' },
            h('div', { className: 'kdp-cat-left-column' }, renderDropdownStack(block)),
            h('div', { className: 'kdp-cat-right-column' }, renderPlacements(block))
          )
    );

  const summary = allSelections();
  const summaryRows = summary.map((sel, idx) =>
    h(
      'div',
      { key: sel.blockId + '|' + sel.placement + '|' + idx, className: 'kdp-cat-summary-row' },
      h('span', { className: 'kdp-cat-summary-path' }, catBuildDisplayPath(sel.path, sel.placement) + ' ↗'),
      h('span', { className: 'kdp-cat-summary-separator' }, '|'),
      h(
        'button',
        {
          type: 'button',
          className: 'kdp-cat-summary-remove',
          onClick: () => removeSelection(sel.blockId, sel.placement),
        },
        'Remove ',
        h('span', { 'aria-hidden': 'true' }, '×')
      )
    )
  );

  const canAdd = blocks.length < KDP_CATEGORY_MAX && totalChecked < KDP_CATEGORY_MAX;

  const save = () => {
    const selections = allSelections();
    if (!selections.length) {
      setSaveNote('Select at least one final placement before saving.');
      return;
    }
    const result = selections.map((s) => ({ key: catBuildDisplayPath(s.path, s.placement), name: catBuildDisplayPath(s.path, s.placement) }));
    setSaveNote('');
    onSave(result);
  };

  return h(
    'div',
    { className: 'kdp-modal-overlay', onClick: (e) => { if (e.target === e.currentTarget) close(); } },
    h(
      'div',
      { className: 'kdp-modal kdp-modal--cat', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Categories' },
      h(
        'div',
        { className: 'kdp-cat-modal__header' },
        h('h2', { className: 'kdp-cat-modal__title' }, 'Categories'),
        h('button', { type: 'button', className: 'kdp-modal__close', 'aria-label': 'Close', onClick: close }, KdpCloseIcon())
      ),
      h(
        'div',
        { className: 'kdp-cat-modal__intro' },
        h('p', null, 'Select categories and subcategories in the drop-down menus below to find up to 3 category placements that most accurately describe your book’s subject matter. Your book will appear in these locations in the Amazon Store.'),
        h('p', null, 'Tips for choosing categories: Choose the most specific categories that fit your book so readers can find it. You can select up to ' + KDP_CATEGORY_MAX + ' category placements.')
      ),
      h(
        'div',
        { className: 'kdp-cat-work' },
        h('div', { className: 'kdp-cat-chooser' }, blocks.map(renderBlock)),
        h('p', { className: 'kdp-cat-chooser__count' }, totalChecked + ' out of ' + KDP_CATEGORY_MAX + ' category placements selected'),
        summaryRows.length
          ? h('div', { className: 'kdp-cat-summary' }, summaryRows)
          : null,
        canAdd
          ? h(
              'button',
              { type: 'button', className: 'kdp-btn kdp-btn--secondary', onClick: addBlock, style: { marginTop: '12px' } },
              'Add another category'
            )
          : null
      ),
      h(
        'div',
        { className: 'kdp-cat-modal__footer' },
        saveNote
          ? h('span', { className: 'kdp-cat-save-note is-error' }, saveNote)
          : null,
        h('button', { type: 'button', className: 'kdp-btn kdp-btn--secondary', onClick: onCancel }, 'Cancel'),
        h('button', { type: 'button', className: 'kdp-btn kdp-btn--primary', onClick: save }, 'Save categories')
      )
    )
  );
}


// --- Description editor (functional toolbar + contentEditable surface) ---

function KdpDescriptionEditor({ value, onChange, maxLength }) {
  const [source, setSource] = React.useState(false);
  const surfaceRef = React.useRef(null);

  // Hydrate the uncontrolled contentEditable from the persisted value. No-op
  // while typing: onInput already pushes the same text up, so DOM == value.
  React.useEffect(() => {
    const el = surfaceRef.current;
    if (!el || el.isContentEditable !== true) return;
    const current = el.textContent || '';
    if (current !== (value || '')) el.textContent = value || '';
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, source]);

  const exec = (cmd, arg) => {
    const el = surfaceRef.current;
    if (!el) return;
    el.focus();
    document.execCommand(cmd, false, arg || null);
    syncValue();
  };

  const syncValue = () => {
    const el = surfaceRef.current;
    if (!el) return;
    const text = el.textContent || '';
    if (text.length > maxLength) {
      el.textContent = text.slice(0, maxLength);
    }
    onChange(el.textContent || '');
  };

  const len = (value || '').length;
  const remaining = maxLength - len;

  return h(
    'div',
    { className: 'kdp-description-editor' },
    h(
      'div',
      { className: 'kdp-editor-toolbar', role: 'toolbar', 'aria-label': 'Formatting' },
      h('button', { type: 'button', className: 'kdp-editor-btn kdp-editor-btn--bold', title: 'Bold', 'aria-label': 'Bold', onMouseDown: (e) => e.preventDefault(), onClick: () => exec('bold') }, 'B'),
      h('button', { type: 'button', className: 'kdp-editor-btn kdp-editor-btn--italic', title: 'Italic', 'aria-label': 'Italic', onMouseDown: (e) => e.preventDefault(), onClick: () => exec('italic') }, 'I'),
      h('button', { type: 'button', className: 'kdp-editor-btn kdp-editor-btn--underline', title: 'Underline', 'aria-label': 'Underline', onMouseDown: (e) => e.preventDefault(), onClick: () => exec('underline') }, 'U'),
      h('span', { className: 'kdp-editor-sep' }),
      h('button', { type: 'button', className: 'kdp-editor-btn', title: 'Numbered list', 'aria-label': 'Numbered list', onMouseDown: (e) => e.preventDefault(), onClick: () => exec('insertOrderedList') }, KdpNumberedListIcon()),
      h('button', { type: 'button', className: 'kdp-editor-btn', title: 'Bulleted list', 'aria-label': 'Bulleted list', onMouseDown: (e) => e.preventDefault(), onClick: () => exec('insertUnorderedList') }, KdpBulletedListIcon()),
      h('span', { className: 'kdp-editor-sep' }),
      h('button', { type: 'button', className: 'kdp-editor-btn', title: 'Source', 'aria-label': 'Source', onMouseDown: (e) => e.preventDefault(), onClick: () => setSource((s) => !s) }, KdpSourceIcon())
    ),
    source
      ? h('textarea', {
          id: 'kdp-description',
          className: 'kdp-textarea kdp-editor-surface',
          value: value || '',
          maxLength: maxLength,
          rows: 9,
          onChange: (e) => onChange(e.target.value),
        })
      : h('div', {
          id: 'kdp-description',
          ref: surfaceRef,
          className: 'kdp-editor-surface',
          contentEditable: true,
          suppressContentEditableWarning: true,
          onInput: () => syncValue(),
        }),
    h(
      'div',
      { className: 'kdp-count' },
      h('span', { className: 'kdp-desc-count__value' }, String(remaining)),
      ' characters remaining'
    )
  );
}

// --- main component ------------------------------------------------------

export function DetailsPage({ book, stepName, bookId, accessToken, savedState, initialProgress, onNavigate, employeeRevision, onConcurrencyConflict }) {
  const [state, setState] = React.useState(() => initState(book, savedState));
  const cleanStateRef = React.useRef(JSON.stringify(state));
  const [categoryAttempted, setCategoryAttempted] = React.useState(false);
  const [chooserOpen, setChooserOpen] = React.useState(false);
  const [seriesModalOpen, setSeriesModalOpen] = React.useState(false);
  const [seriesError, setSeriesError] = React.useState(false);
  const [titleTouched, setTitleTouched] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const savingRef = React.useRef(false); // synchronous in-flight guard (double-click safe)
  // Reusable Saving… / Done! overlay. The Done state holds ~650ms
  // (300ms under prefers-reduced-motion) then clears. Driven
  // only by real server responses.
  const [overlay, setOverlay] = React.useState(null); // { phase: 'saving' | 'done', label, done }
  const runSaveOverlay = (label) => {
    setOverlay({ phase: 'saving', label, done: false });
  };
  const showDone = (label) => {
    setOverlay({ phase: 'done', label, done: true });
    const reduce = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const hold = reduce ? 300 : 650;
    window.setTimeout(() => setOverlay((cur) => (cur && cur.done ? null : cur)), hold);
  };
  const clearOverlay = () => setOverlay(null);
  const [feedback, setFeedback] = React.useState(null); // { kind: 'error'|'ok', msg }
  const [validationErrors, setValidationErrors] = React.useState({});
  const [serverProgress, setServerProgress] = React.useState(
    initialProgress ? progressFromServer(initialProgress) : null
  );
  const [revision, setRevision] = React.useState(Number(employeeRevision) || 0);

  const setField = (key, value) =>
    setState((s) => Object.assign({}, s, { [key]: value }));

  const setAuthor = (key, value) =>
    setState((s) =>
      Object.assign({}, s, { primaryAuthor: Object.assign({}, s.primaryAuthor, { [key]: value }) })
    );

  const addContributor = () =>
    setState((s) => {
      if (s.contributors.length >= MAX_CONTRIBUTORS) return s; // max 9 enforced
      return Object.assign({}, s, {
        contributors: s.contributors.concat([{ role: '', firstName: '', lastName: '' }]),
      });
    });

  const updateContributor = (idx, key, value) =>
    setState((s) => {
      const next = s.contributors.slice();
      next[idx] = Object.assign({}, next[idx], { [key]: value });
      return Object.assign({}, s, { contributors: next });
    });

  const removeContributor = (idx) =>
    setState((s) => {
      const next = s.contributors.slice();
      next.splice(idx, 1);
      return Object.assign({}, s, { contributors: next });
    });

  const setKeyword = (idx, value) =>
    setState((s) => {
      const next = s.keywords.slice();
      next[idx] = value.slice(0, KEYWORD_MAX);
      return Object.assign({}, s, { keywords: next });
    });

  // --- Save handlers (one request at a time; no write on load) ----------
  const doSave = (saveType, nextStepName, activeStep, completion) => {
    if (savingRef.current) { completion?.(false); return; } // request protection: one click = one request
    if (!bookId || !accessToken) {
      setFeedback({ kind: 'error', msg: 'Missing book or access context. Reopen this page from your bookshelf link.' });
      completion?.(false); return;
    }
    const errs = saveType === 'complete' ? requiredErrors(state) : {};
    if (saveType === 'complete' && Object.keys(errs).length > 0) {
      setValidationErrors(errs); // block completion; Content stays locked
      setFeedback(null); // top + bottom ValidationSummary render from validationErrors
      completion?.(false); return;
    }
    setValidationErrors({});
    setFeedback(null);
    savingRef.current = true;
    setSaving(true);
    runSaveOverlay('Saving…');
    var progressState = buildProgressState(activeStep);
    var stateJson = buildStateJson(state, saveType, activeStep, errs);
    fetch(SAVE_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        book_id: bookId,
        access_token: accessToken, // runtime URL value only; never persisted/logged
        expected_revision: revision,
        step_name: 'details',
        next_step_name: nextStepName,
        save_type: saveType,
        state_json: stateJson,
        extracted_fields: buildExtractedFields(state),
        validation_required_keys: REQUIRED_KEYS,
        validation_errors: errs,
        progress_state: progressState,
        source: 'ghl_kdp_details_page',
      }),
    })
      .then((res) => res.json().catch(() => null).then((data) => ({ ok: res.ok, status: res.status, data })))
      .then(({ ok, status, data }) => {
        // Defer the success/clear transition one tick so the Saving
        // overlay is guaranteed to paint at least one frame, even
        // when the response is instantaneous. Without this defer
        // React 18 batches the saving -> done state update and the
        // saving phase is never visible to the user (or the test).
        window.setTimeout(() => {
          if (ok === true && data && data.ok === true) {
            setRevision(Number(data.employee_revision));
            cleanStateRef.current = JSON.stringify(state);
            if (data.progress_state) setServerProgress(progressFromServer(data.progress_state));
            if (saveType === 'complete') {
              // Authoritative gate: only navigate to Content when
              // the server itself confirms details is complete and
              // content is unlocked. Otherwise stay on Details and
              // surface the existing feedback.
              const ps = data.progress_state;
              const detailsComplete = !!(ps && ps.steps && ps.steps.details && ps.steps.details.isComplete === true);
              const contentUnlocked = !!(ps && ps.steps && ps.steps.content && ps.steps.content.isUnlocked === true);
              if (detailsComplete && contentUnlocked && typeof onNavigate === 'function') {
                showDone('Done!');
                // Show Done! then navigate. The showDone timer
                // already clears the overlay; the navigate fires
                // after the hold so the user sees the success
                // state before the page change.
                const reduce = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
                const hold = reduce ? 300 : 650;
                window.setTimeout(() => {
                  if (typeof onNavigate === 'function') onNavigate(nextStepName);
                }, hold);
              } else {
                // Server returned ok but did not authorize the
                // move. Fall back to the safe "details complete"
                // message, no Done overlay, no navigation.
                setFeedback({ kind: 'ok', msg: 'Details are complete. Content is unlocked.' });
                clearOverlay();
              }
            } else {
              // Draft: success overlay, no navigation.
              showDone('Done!');
              setFeedback({
                kind: 'ok',
                msg:
                  'Draft saved.' +
                  (data.data_valid === false ? ' The form is not complete yet.' : ''),
              });
            }
            completion?.(true);
          } else {
            if (status === 409) {
              setFeedback({ kind: 'error', msg: 'This book changed elsewhere. The latest version is being loaded.' });
              onConcurrencyConflict?.();
              clearOverlay();
              completion?.(false);
              return;
            }
            setFeedback({ kind: 'error', msg: safeSaveError(data, status) });
            clearOverlay();
            completion?.(false);
          }
        }, 50);
      })
      .catch(() => { setFeedback({ kind: 'error', msg: 'Could not reach the server. No changes were saved.' }); clearOverlay(); completion?.(false); })
      .finally(() => {
        savingRef.current = false;
        setSaving(false);
      });
  };

  const handleDraft = () => doSave('draft', null, 'details');
  const handleContinue = () => doSave('complete', 'content', 'content');
  const saveDraftForNavigation = React.useCallback(() => new Promise((resolve) => doSave('draft', null, 'details', resolve)), [state, bookId, accessToken]);
  const navigation = useDirtyNavigation({ currentStep: 'details', isDirty: JSON.stringify(state) !== cleanStateRef.current, saveDraft: saveDraftForNavigation, navigate: onNavigate });

  const fieldErr = (key) => validationErrors[key] || null;
  // No server progress yet → safe default (Details in progress, rest not started).
  const displayProgress = serverProgress || progressFromServer(null);

  const descLen = (state.description || '').length;
  const descRemaining = DESCRIPTION_MAX - descLen;

  const adultAnswered = state.adultOnly === 'yes' || state.adultOnly === 'no';
  const titleError = titleTouched && !state.bookTitle.trim() ? 'Enter a title.' : null;

  // --- Language ---
  const languageSection = h(
    Section,
    { label: 'Language' },
    h(Help, null, 'Choose the primary language your book is written in. ', KdpLink({ link: LINKS.supportedLanguages }), '.'),
    h(
      'div',
      { className: 'kdp-field kdp-field--narrow' },
      Select({
        id: 'kdp-language',
        value: state.language,
        onChange: (v) => setField('language', v),
        options: LANGUAGES,
        defaultLabel: 'Select language',
      })
    )
  );

  // --- Book Title + Subtitle ---
  const titleSection = h(
    Section,
    { label: 'Book Title', error: titleError || fieldErr('book_title') },
    h(Help, null, 'Enter your title as it appears on the book cover. If you add a subtitle, a colon will be inserted between the title and subtitle. Before continuing, check your spelling since this field cannot be updated after publication. ', KdpLink({ link: LINKS.bookTitle }), '.'),
    Label({ htmlFor: 'kdp-title', children: 'Book Title' }),
    h(TextField, {
      id: 'kdp-title',
      value: state.bookTitle,
      onChange: (v) => setField('bookTitle', v),
      onBlur: () => setTitleTouched(true),
    }),
    h('div', { className: 'kdp-gap' }),
    Label({ htmlFor: 'kdp-subtitle', children: 'Subtitle (Optional)' }),
    h(TextField, {
      id: 'kdp-subtitle',
      value: state.subtitle,
      onChange: (v) => setField('subtitle', v),
    })
  );

  // --- Series ---
  const openSeries = () => {
    if (!state.bookTitle.trim()) {
      setSeriesError(true);
      return;
    }
    setSeriesError(false);
    setSeriesModalOpen(true);
  };

  const seriesSection = h(
    Section,
    { label: 'Series' },
    h(Help, null, 'If your book is part of a series (or will eventually be), you can add it now. Alternatively, you can add it later using the options on the Bookshelf. ', KdpLink({ link: LINKS.startSeries }), '.'),
    state.seriesName
      ? h(
          'div',
          { className: 'kdp-field kdp-field--narrow' },
          Label({ htmlFor: 'kdp-series', children: 'Series name' }),
          h(TextField, {
            id: 'kdp-series',
            value: state.seriesName,
            onChange: (v) => setField('seriesName', v),
          }),
          h('div', { className: 'kdp-gap' }),
          h(
            'button',
            { type: 'button', className: 'kdp-btn kdp-btn--remove', onClick: () => setField('seriesName', '') },
            'Remove series'
          )
        )
      : h(
          'button',
          {
            type: 'button',
            className: 'kdp-btn kdp-btn--secondary kdp-btn--with-icon',
            onClick: openSeries,
          },
          KdpEditIcon(),
          'Add to series'
        ),
    seriesError ? h(KdpErrorAlert, null, 'Enter a title.') : null
  );

  // --- Edition Number ---
  const editionSection = h(
    Section,
    { label: 'Edition Number' },
    h(Help, null, 'The edition number tells readers whether the book is an original or updated version. Note: This cannot be changed after the book is published. ', KdpLink({ link: LINKS.newEdition }), '.'),
    h('div', { className: 'kdp-gap' }),
    h(
      'div',
      { className: 'kdp-field kdp-field--narrow' },
      Label({ htmlFor: 'kdp-edition', children: 'Edition Number (Optional)' }),
      h(TextField, {
        id: 'kdp-edition',
        value: state.editionNumber,
        onChange: (v) => setField('editionNumber', v),
      })
    )
  );

  // --- Primary Author ---
  const authorSection = h(
    Section,
    { label: 'Author', error: fieldErr('primary_author') },
    h(Help, null, 'Enter the primary author or contributor for this book. See ', KdpLink({ link: LINKS.author }), '.'),
    Label({ htmlFor: 'kdp-author-first', children: 'Primary Author or Contributor' }),
    h(
      'div',
      { className: 'kdp-author-name-row' },
      h(TextField, {
        id: 'kdp-author-first',
        placeholder: 'First name',
        value: state.primaryAuthor.firstName,
        onChange: (v) => setAuthor('firstName', v),
      }),
      h(TextField, {
        id: 'kdp-author-last',
        placeholder: 'Last name',
        value: state.primaryAuthor.lastName,
        onChange: (v) => setAuthor('lastName', v),
      })
    )
  );

  // --- Additional Contributors ---
  const canRemove = state.contributors.length > 1;
  const contributorRows = state.contributors.map((c, idx) =>
    h(
      'div',
      {
        className: 'kdp-contrib-row' + (canRemove ? '' : ' kdp-contrib-row--single'),
        key: idx,
      },
      h(
        'div',
        { className: 'kdp-field kdp-field--role' },
        Select({
          id: 'kdp-contrib-role-' + idx,
          value: c.role,
          onChange: (v) => updateContributor(idx, 'role', v),
          options: CONTRIBUTOR_ROLES,
          defaultLabel: 'Role',
        })
      ),
      h(TextField, {
        id: 'kdp-contrib-first-' + idx,
        placeholder: 'First name',
        value: c.firstName,
        onChange: (v) => updateContributor(idx, 'firstName', v),
      }),
      h(TextField, {
        id: 'kdp-contrib-last-' + idx,
        placeholder: 'Last name',
        value: c.lastName,
        onChange: (v) => updateContributor(idx, 'lastName', v),
      }),
      canRemove
        ? h(
            'button',
            { type: 'button', className: 'kdp-btn kdp-btn--remove kdp-remove-contributor', onClick: () => removeContributor(idx) },
            'Remove'
          )
        : null
    )
  );

  const contributorsSection = h(
    Section,
    { label: 'Contributors' },
    h(Help, null, 'Add up to 9 contributors. They’ll display on Amazon using the order you enter below.'),
    h('div', { className: 'kdp-contrib-list' }, contributorRows),
    h(
      'button',
      {
        type: 'button',
        className: 'kdp-btn kdp-btn--secondary',
        onClick: addContributor,
        disabled: state.contributors.length >= MAX_CONTRIBUTORS,
      },
      'Add Another'
    )
  );

  // --- Description (KDP-like editor shell) ---
  const descriptionSection = h(
    Section,
    { label: 'Description', error: fieldErr('description') },
    h(Help, null, 'Summarize your book. This will be your product description on Amazon, so customers can learn more about your book. ', KdpLink({ link: LINKS.formatDescription }), '.'),
    h(KdpDescriptionEditor, {
      value: state.description,
      onChange: (v) => setField('description', v.slice(0, DESCRIPTION_MAX)),
      maxLength: DESCRIPTION_MAX,
    })
  );

  // --- Publishing Rights ---
  const rightsSection = h(
    Section,
    { label: 'Publishing Rights', error: fieldErr('publishing_rights') },
    h(
      'div',
      { className: 'kdp-radio-stack' },
      h(
        'label',
        { className: 'kdp-radio' },
        h('input', {
          type: 'radio',
          name: 'publishingRights',
          checked: state.publishingRights === 'copyright',
          onChange: () => setField('publishingRights', 'copyright'),
        }),
        h('span', null, 'I own the copyright and I hold the necessary publishing rights ', KdpLink({ link: LINKS.publishingRights }), '.')
      ),
      h(
        'label',
        { className: 'kdp-radio' },
        h('input', {
          type: 'radio',
          name: 'publishingRights',
          checked: state.publishingRights === 'public_domain',
          onChange: () => setField('publishingRights', 'public_domain'),
        }),
        h('span', null, 'This is a public domain work ', KdpLink({ link: LINKS.publicDomain }), '.')
      )
    )
  );

  // --- Primary Audience ---
  const audienceSection = h(
    Section,
    { label: 'Primary Audience' },
    h('p', { className: 'kdp-subhead' }, 'Sexually Explicit Images or Title'),
    h(Help, null, 'Does the book’s cover or interior contain sexually explicit images, or does the book’s title contain sexually explicit language? ', KdpLink({ link: LINKS.learnMore }), '.'),
    h(
      'div',
      { className: 'kdp-radio-row' },
      h(
        'label',
        { className: 'kdp-radio' },
        h('input', {
          type: 'radio',
          name: 'adultOnly',
          value: 'yes',
          checked: state.adultOnly === 'yes',
          onChange: () => setField('adultOnly', 'yes'),
        }),
        h('span', null, 'Yes')
      ),
      h(
        'label',
        { className: 'kdp-radio' },
        h('input', {
          type: 'radio',
          name: 'adultOnly',
          value: 'no',
          checked: state.adultOnly === 'no',
          onChange: () => setField('adultOnly', 'no'),
        }),
        h('span', null, 'No')
      )
    ),
    h('div', { className: 'kdp-gap' }),
    h('p', { className: 'kdp-subhead' }, 'Reading Age (Optional)'),
    h(Help, null, 'Select the appropriate reading age range for your book.'),
    h(
      'div',
      { className: 'kdp-row kdp-row--two' },
      h(
        'div',
        { className: 'kdp-field' },
        Label({ htmlFor: 'kdp-age-min', children: 'Minimum' }),
        Select({
          id: 'kdp-age-min',
          value: state.readingAgeMin,
          onChange: (v) => setField('readingAgeMin', v),
          options: READING_AGE_OPTIONS,
          defaultLabel: 'Select',
        })
      ),
      h(
        'div',
        { className: 'kdp-field' },
        Label({ htmlFor: 'kdp-age-max', children: 'Maximum' }),
        Select({
          id: 'kdp-age-max',
          value: state.readingAgeMax,
          onChange: (v) => setField('readingAgeMax', v),
          options: READING_AGE_OPTIONS,
          defaultLabel: 'Select',
        })
      )
    )
  );

  // --- Primary Marketplace ---
  const marketplaceSection = h(
    Section,
    { label: 'Primary marketplace' },
    h(Help, null, 'Choose the location where you expect the majority of your book sales. Changing your primary marketplace may impact your list price. Please confirm your list price before publishing your book.'),
    h(
      'div',
      { className: 'kdp-field kdp-field--narrow' },
      Select({
        id: 'kdp-marketplace',
        value: state.marketplace,
        onChange: (v) => setField('marketplace', v),
        options: MARKETPLACES,
        defaultLabel: 'Select marketplace',
      })
    )
  );

  // --- Categories (button opens the 2-pane modal; saved list shows below) ---
  const openCategories = () => {
    if (!adultAnswered) {
      setCategoryAttempted(true);
      return;
    }
    setChooserOpen(true);
  };

  const categoriesSection = h(
    Section,
    { label: 'Categories', error: fieldErr('categories') },
    h(Help, null, 'Choose up to three categories that describe your book. Note: You must select your primary marketplace and audience first. ', KdpLink({ link: LINKS.categories }), '.'),
    h(
      'div',
      { className: 'kdp-cat-area' },
      state.categories.length === 0
        ? h(
            'button',
            { type: 'button', className: 'kdp-btn kdp-btn--secondary kdp-btn--with-icon', onClick: openCategories },
            KdpEditIcon(),
            'Choose categories'
          )
        : h(
            'div',
            null,
            h('p', { className: 'kdp-subhead' }, 'Your title’s current categories'),
            h(
              'ul',
              { className: 'kdp-cat-list' },
              state.categories.map((c, idx) =>
                h(
                  'li',
                  { key: c.key || idx, className: 'kdp-cat-item' },
                  h('span', null, c.name),
                  h('button', { type: 'button', className: 'kdp-btn kdp-btn--remove', onClick: () => removeCat(idx) }, 'Remove')
                )
              )
            ),
            h(
              'button',
              { type: 'button', className: 'kdp-btn kdp-btn--secondary kdp-btn--with-icon', onClick: openCategories },
              KdpEditIcon(),
              'Edit categories'
            )
          ),
      categoryAttempted && !adultAnswered
        ? h(KdpErrorAlert, null, 'Answer the Adult-only question before choosing a category.')
        : null
    ),
    chooserOpen
      ? h(KdpCategoryModal, {
          existing: state.categories,
          onSave: (sel) => {
            setState((s) => Object.assign({}, s, { categories: sel }));
            setChooserOpen(false);
          },
          onCancel: () => setChooserOpen(false),
        })
      : null
  );

  function removeCat(idx) {
    setState((s) => {
      const next = s.categories.slice();
      next.splice(idx, 1);
      return Object.assign({}, s, { categories: next });
    });
  }

  // --- Keywords ---
  const keywordInputs = state.keywords.map((kw, idx) =>
    h(TextField, {
      key: idx,
      id: 'kdp-keyword-' + (idx + 1),
      value: kw,
      onChange: (v) => setKeyword(idx, v),
      placeholder: '',
      maxLength: KEYWORD_MAX,
    })
  );
  const keywordsSection = h(
    Section,
    { label: 'Keywords' },
    h(Help, null, 'Choose up to 7 keywords highlighting your book’s unique traits. Keywords are typically short phrases, up to 50 characters, that customers use to narrow their book search on Amazon. ', KdpLink({ link: LINKS.chooseKeywords }), '.'),
    Label({ htmlFor: 'kdp-keyword-1', children: 'Your Keywords (Optional)' }),
    h('div', { className: 'kdp-keyword-grid' }, keywordInputs)
  );

  // --- Pre-order ---
  const releaseNowInfo = h(
    'p',
    { className: 'kdp-preorder-info' },
    'After you submit for publication, it can take up to 72 hours to go live. During this time, edits cannot be made to your book. ',
    h('span', { className: 'kdp-link kdp-link--bare', role: 'link', tabIndex: 0 }, 'Learn more about release timelines')
  );

  const preorderBlock = h(
    'div',
    { className: 'kdp-preorder-info' },
    h('p', null, 'Enter the date you would like your book to be available to readers. Amazon will allow customers to pre-order your book.'),
    h(
      'div',
      { className: 'kdp-field kdp-field--narrow kdp-preorder-date' },
      h('p', { className: 'kdp-subhead' }, 'Set Release Date (GMT)'),
      h(
        'div',
        { className: 'kdp-date-row' },
        h('input', {
          id: 'kdp-preorder-date',
          className: 'kdp-input',
          type: 'date',
          value: state.preorderDate || '',
          onChange: (e) => setField('preorderDate', e.target.value),
        }),
        KdpCalendarIcon()
      )
    )
  );

  const preorderSection = h(
    Section,
    { label: 'Pre-order' },
    h(
      'div',
      { className: 'kdp-preorder-group' },
      h(
        'div',
        { className: 'kdp-preorder-option' + (state.publishOption === 'release_now' ? ' is-selected' : '') },
        h(
          'label',
          { className: 'kdp-radio' },
          h('input', {
            type: 'radio',
            name: 'publishOption',
            checked: state.publishOption === 'release_now',
            onChange: () => setField('publishOption', 'release_now'),
          }),
          h('span', { className: 'kdp-option-title' }, 'I am ready to release my book now')
        )
      ),
      state.publishOption === 'release_now' ? releaseNowInfo : null,
      h(
        'div',
        { className: 'kdp-preorder-option kdp-preorder-option--bottom' + (state.publishOption === 'preorder' ? ' is-selected' : '') },
        h(
          'label',
          { className: 'kdp-radio' },
          h('input', {
            type: 'radio',
            name: 'publishOption',
            checked: state.publishOption === 'preorder',
            onChange: () => setField('publishOption', 'preorder'),
          }),
          h('span', { className: 'kdp-option-title' },
            KdpLink({ link: LINKS.preorder })
          )
        )
      ),
      h(
        'div',
        { className: 'kdp-expand kdp-preorder-extra' + (state.publishOption === 'preorder' ? ' is-open' : '') },
        h(
          'div',
          { className: 'kdp-expand__inner kdp-preorder-extra-inner' },
          h('div', { className: 'kdp-preorder-extra-content' }, preorderBlock)
        )
      )
    )
  );

  // --- Bottom actions ---
  const actions = h(
    'div',
    { className: 'kdp-actions' },
    h(
      'button',
      {
        type: 'button',
        className: 'kdp-btn kdp-btn--secondary',
        onClick: handleDraft,
        disabled: saving,
        title: saving ? 'Saving…' : 'Save the current details without completing them.',
      },
      saving ? 'Saving…' : 'Save as Draft'
    ),
    h(
      'div',
      { className: 'kdp-actions__primary' },
      h(
        'button',
        {
          type: 'button',
          className: 'kdp-btn kdp-btn--primary kdp-btn--continue',
          onClick: handleContinue,
          disabled: saving,
          title: saving ? 'Saving…' : 'Validate and complete the Details step.',
        },
        saving ? 'Saving…' : 'Save and Continue'
      ),
      h('div', { className: 'kdp-actions__next' }, 'Next step: Content')
    )
  );

  const feedbackNote = feedback
    ? h(
        'p',
        { className: 'kdp-note' + (feedback.kind === 'error' ? ' kdp-note--error' : ' kdp-note--ok') },
        feedback.msg
      )
    : null;

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

  const bookTitle = book && book.book_title ? book.book_title : '';

  return h(
    'div',
    { className: 'kdp-app' },
    bookTitle ? h('h1', { className: 'kdp-book-title' }, bookTitle) : null,
    ValidationSummary({ errs: validationErrors }),
    KdpProgress({ progress: displayProgress, onNavigate: navigation.requestNavigation, currentStep: 'details' }),
    h('form', { className: 'kdp-form', onSubmit: (e) => e.preventDefault() },
      languageSection,
      titleSection,
      seriesSection,
      editionSection,
      authorSection,
      contributorsSection,
      descriptionSection,
      rightsSection,
      audienceSection,
      marketplaceSection,
      categoriesSection,
      keywordsSection,
      preorderSection,
      actions,
      ValidationSummary({ errs: validationErrors }),
      feedbackNote
    ),
    seriesModalOpen ? h(SeriesModal, { onClose: () => setSeriesModalOpen(false) }) : null,
    navigation.modal,
    overlayEl
  );
}
