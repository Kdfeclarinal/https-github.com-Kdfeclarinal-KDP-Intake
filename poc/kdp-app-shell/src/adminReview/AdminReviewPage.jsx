import React from 'react';
import { KdpProgress } from '../progress/KdpProgress.jsx';
import {
  createReviewDraft,
  filterReviewComments,
  reviewIssueNumber,
  reviewPageProgress,
  reviewStepAccessible,
  reviewMutationControlsVisible,
} from './adminReviewState.js';

const h = React.createElement;
const STEPS = ['details', 'content', 'pricing'];

function labelKey(value) {
  return String(value || '').replaceAll('_', ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (letter) => letter.toUpperCase());
}

function presentValue(value) {
  if (value === null || value === undefined || value === '') return 'Not answered';
  if (value === true) return 'Yes';
  if (value === false) return 'No';
  if (Array.isArray(value)) return value.length ? value.map(presentValue).join(', ') : 'None selected';
  return String(value);
}

function sectionData(item) {
  const snapshot = item.snapshot || {};
  if (Object.hasOwn(snapshot, 'value')) return snapshot.value;
  const submitted = snapshot.submitted_step || {};
  return submitted.sections?.[item.sectionKey]
    ?? submitted.sections?.[item.section_key]
    ?? snapshot.submitted_extracted_fields?.[String(item.sectionKey || '').split('.').pop()]
    ?? {};
}

function ReadOnlyValue({ name, value, depth = 0 }) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const entries = Object.entries(value).filter(([key]) => !['validationErrors', 'progressState', 'savedAt'].includes(key));
    if (!entries.length) return h('div', { className: 'kdp-review-empty-value' }, 'No submitted value');
    return h('div', { className: depth ? 'kdp-review-nested-values' : 'kdp-review-values' }, entries.map(([key, child]) => h(ReadOnlyValue, { key, name: key, value: child, depth: depth + 1 })));
  }
  return h('div', { className: 'kdp-review-field' },
    h('span', { className: 'kdp-review-field__label' }, labelKey(name)),
    h('div', { className: 'kdp-review-field__value', title: presentValue(value) }, presentValue(value))
  );
}

function DecisionControl({ item, decision, onApprove, onReopen, disabled }) {
  if (decision === 'approved') {
    return h(
      'div',
      {
        className:
          'kdp-review-decision kdp-review-decision--approved',
      },
      h('span', null, 'APPROVED ✓'),
      h(
        'button',
        {
          type: 'button',
          className: 'kdp-link-button',
          disabled,
          onClick: onReopen,
        },
        'Reopen Decision'
      )
    );
  }

  if (decision === 'needs_updates') {
    return h(
      'div',
      {
        className:
          'kdp-review-decision kdp-review-decision--updates',
      },
      h('span', null, 'UPDATES REQUESTED')
    );
  }

  return h(
    'button',
    {
      type: 'button',
      className:
        'kdp-btn kdp-btn--primary kdp-review-approve',
      disabled,
      onClick: onApprove,
      'aria-label': `APPROVE ${item.label}`,
    },
    'APPROVE'
  );
}

function HistoricalDecision({ decision }) {
  const text = decision === 'approved' ? 'APPROVED' : decision === 'needs_updates' ? 'UPDATES REQUESTED' : 'PENDING';
  return h('div', { className: `kdp-review-decision kdp-review-decision--${decision === 'approved' ? 'approved' : 'updates'}` }, h('span', null, text));
}

function ContinuationContext({ continuation }) {
  if (!continuation) return null;
  const evidence = [];
  if (continuation.readiness?.viaChange) evidence.push('saved section change');
  if (continuation.readiness?.viaFileChange) evidence.push('file/version change');
  if (continuation.readiness?.viaReply) evidence.push('employee reply');
  return h('div', { className: 'kdp-review-continuation', role: 'note' },
    h('strong', null, `Continued from Round ${continuation.sourceRoundNumber || '?'}`),
    h('p', null, continuation.originalRequest),
    continuation.employeeReplies?.length
      ? h('div', null, h('span', null, 'Employee update'), continuation.employeeReplies.map((reply) => h('blockquote', { key: reply.id }, h('p', null, reply.body), h('footer', null, `${reply.author} · ${reply.createdAt ? new Date(reply.createdAt).toLocaleString() : 'Time unavailable'}`))))
      : null,
    h('p', { className: 'kdp-review-continuation__status' }, continuation.readyForRereview ? `Ready for re-review${evidence.length ? ` via ${evidence.join(' and ')}` : ''}. Reviewer resolution is still required.` : 'Awaiting employee update evidence.')
  );
}

function CommentComposer({ sectionLabel, initialBody = '', title, onClose, onPost }) {
  const [body, setBody] = React.useState(initialBody);
  const [position, setPosition] = React.useState({ x: 0, y: 0 });
  const drag = React.useRef(null);

  React.useEffect(() => {
    const escape = (event) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [onClose]);

  const startDrag = (event) => {
    drag.current = { x: event.clientX - position.x, y: event.clientY - position.y };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const moveDrag = (event) => {
    if (!drag.current) return;
    setPosition({ x: event.clientX - drag.current.x, y: event.clientY - drag.current.y });
  };

  return h('div', { className: 'kdp-review-composer-layer', role: 'presentation' },
    h('div', {
      className: 'kdp-review-composer', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'review-comment-title',
      style: { transform: `translate(${position.x}px, ${position.y}px)` },
    },
    h('div', { className: 'kdp-review-composer__handle', onPointerDown: startDrag, onPointerMove: moveDrag, onPointerUp: () => { drag.current = null; } },
      h('h2', { id: 'review-comment-title' }, title || (sectionLabel ? `Comment on ${sectionLabel}` : 'Add a general comment')),
      h('button', { type: 'button', className: 'kdp-icon-button', onClick: onClose, 'aria-label': 'Close comment composer' },
        h('svg', { viewBox: '0 0 20 20', 'aria-hidden': 'true' }, h('path', { d: 'm4 4 12 12M16 4 4 16' }))
      )
    ),
    h('label', { className: 'kdp-review-composer__body' }, h('span', { className: 'kdp-sr-only' }, 'Comment'), h('textarea', { 'aria-label': 'Comment', value: body, onChange: (event) => setBody(event.target.value), placeholder: 'Describe what needs attention…', maxLength: 2000, autoFocus: true })),
    h('div', { className: 'kdp-review-composer__footer' }, h('span', null, `${body.length}/2000`), h('button', { type: 'button', className: 'kdp-btn kdp-btn--secondary', onClick: () => { if (body.trim()) onPost({ body }); }, disabled: !body.trim(), 'aria-label': 'Post comment' }, 'Post'))
    )
  );
}

function ReviewPanel({ draft, activeItemId, onSelect, onAddGeneral, onReply, onEdit, onResolve, onDelete, mutationControlsVisible }) {
  const [tab, setTab] = React.useState('comments');
  const [collapsed, setCollapsed] = React.useState(false);
  const [filtersOpen, setFiltersOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [sort, setSort] = React.useState('newest');
  const pageIds = React.useMemo(() => new Set(draft.items.map((item) => item.id)), [draft.items]);
  const comments = filterReviewComments(draft.comments.filter((comment) => !comment.itemId || pageIds.has(comment.itemId)), { query, sort });
  const selectedIndex = Math.max(0, comments.findIndex((comment) => comment.id === activeItemId));
  const selected = comments[selectedIndex] || null;
  const decided = Object.values(draft.decisions).filter((decision) => decision !== 'pending').length;

  React.useEffect(() => { setFiltersOpen(false); }, [draft.step]);

  const move = (direction) => {
    if (!comments.length) return;
    const index = (selectedIndex + direction + comments.length) % comments.length;
    onSelect(comments[index]);
  };

  return h('aside', { className: `kdp-review-panel${collapsed ? ' is-collapsed' : ''}`, 'aria-label': 'Review panel' },
    h('div', { className: 'kdp-review-panel__tabs', role: 'tablist' },
      ['comments', 'approvals'].map((name) => h('button', { type: 'button', role: 'tab', key: name, 'aria-selected': tab === name ? 'true' : 'false', onClick: () => { setTab(name); setCollapsed(false); } }, labelKey(name)))
    ),
    h('div', { className: 'kdp-review-panel__toolbar' },
      h('button', { type: 'button', className: 'kdp-link-button', onClick: () => setFiltersOpen((open) => !open), 'aria-expanded': filtersOpen ? 'true' : 'false' }, 'Filter & Sort'),
      h('span', { className: 'kdp-review-panel__nav' },
        h('button', { type: 'button', className: 'kdp-icon-button', onClick: () => move(-1), disabled: !comments.length, 'aria-label': 'Previous comment' }, '<'),
        h('button', { type: 'button', className: 'kdp-icon-button', onClick: () => move(1), disabled: !comments.length, 'aria-label': 'Next comment' }, '>'),
        h('button', { type: 'button', className: 'kdp-icon-button', onClick: () => setCollapsed((value) => !value), 'aria-label': collapsed ? 'Expand review panel' : 'Collapse review panel' },
          h('svg', { viewBox: '0 0 20 20', 'aria-hidden': 'true' }, h('path', { d: collapsed ? 'm5 7 5 6 5-6' : 'm5 13 5-6 5 6' }))
        )
      )
    ),
    filtersOpen && !collapsed ? h('div', { className: 'kdp-review-filter' },
      h('label', null, h('span', null, 'Comment contains'), h('input', { type: 'search', value: query, onChange: (event) => setQuery(event.target.value), placeholder: 'Search comments' })),
      h('fieldset', null, h('legend', null, 'Sort comments by'), ['newest', 'oldest'].map((value) => h('label', { key: value }, h('input', { type: 'radio', name: 'comment-sort', value, checked: sort === value, onChange: () => setSort(value) }), value === 'newest' ? 'Newest comments' : 'Oldest comments')))
    ) : null,
    collapsed ? null : tab === 'comments'
      ? h('div', { className: 'kdp-review-panel__body' },
          selected ? h('article', { className: 'kdp-review-comment' },
            h('div', { className: 'kdp-review-comment__index' }, selected.issueNumber || '•'),
            h('div', null, h('strong', null, selected.author), h('span', null, selected.itemId ? draft.items.find((item) => item.id === selected.itemId)?.label || 'Section comment' : 'General comment'), h('p', null, selected.body), h('time', null, new Date(selected.createdAt).toLocaleString()),
              h(ContinuationContext, { continuation: selected.continuation }),
              mutationControlsVisible ? h('div', { className: 'kdp-review-comment__actions' },
                !selected.parentCommentId ? h('button', { type: 'button', className: 'kdp-link-button', onClick: () => onReply(selected) }, 'Reply') : null,
                selected.authorActorType !== 'employee' ? h('button', { type: 'button', className: 'kdp-link-button', onClick: () => onEdit(selected) }, 'Edit') : null,
                selected.actionable && !selected.resolved ? h('button', { type: 'button', className: 'kdp-link-button', onClick: () => onResolve(selected) }, 'Resolve') : null,
                selected.authorActorType !== 'employee' ? h('button', { type: 'button', className: 'kdp-link-button', onClick: () => onDelete(selected) }, 'Delete') : null
              ) : null)
          ) : h('div', { className: 'kdp-review-panel__empty' }, h('h3', null, 'No comments on this page'), h('p', null, 'Add a general note or comment directly on a section.')),
          mutationControlsVisible ? h('button', { type: 'button', className: 'kdp-btn kdp-btn--secondary kdp-review-panel__add', onClick: onAddGeneral }, 'Add Comment') : null
        )
      : h('div', { className: 'kdp-review-panel__body kdp-review-approvals' },
          h('h3', null, 'Current page'), h('p', null, `${decided} of ${draft.items.length} sections decided`),
          h('ul', null, draft.items.map((item) => h('li', { key: item.id }, h('span', null, item.label), h('strong', { className: `is-${draft.decisions[item.id]}` }, labelKey(draft.decisions[item.id])))))
        )
  );
}

function progressFromItems(items, reachedSteps = []) {
  return Object.fromEntries(STEPS.map((step) => {
    if (!reviewStepAccessible(items, step, reachedSteps)) return [step, { status: 'locked', active: false }];
    const status = reviewPageProgress(items, step);
    return [step, { status, active: false }];
  }));
}

export function AdminReviewPage({ payload, initialStep = 'details', onBackToBookshelf, onSignOut, privilegedApi }) {
  const [reviewPayload, setReviewPayload] = React.useState(payload);
  const [step, setStep] = React.useState(() => reviewStepAccessible(payload?.items, initialStep, payload?.reviewRound?.reachedSteps) ? initialStep : 'details');
  const [draft, setDraft] = React.useState(() => createReviewDraft(payload, step));
  const [composer, setComposer] = React.useState(null);
  const [selectedCommentId, setSelectedCommentId] = React.useState(null);
  const [jumpItemId, setJumpItemId] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const [feedback, setFeedback] = React.useState(null);
  const sectionRefs = React.useRef(new Map());

  React.useEffect(() => { setReviewPayload(payload); }, [payload]);
  React.useEffect(() => { setDraft(createReviewDraft(reviewPayload, step)); }, [reviewPayload, step]);
  React.useEffect(() => {
    const syncStep = () => {
      const requested = new URLSearchParams(window.location.search).get('review_step') || 'details';
      if (reviewStepAccessible(reviewPayload.items, requested, reviewPayload.reviewRound?.reachedSteps)) setStep(requested);
    };
    window.addEventListener('popstate', syncStep);
    return () => window.removeEventListener('popstate', syncStep);
  }, [reviewPayload]);

  const runAction = async (action, input = {}) => {
    const finalAction = action === 'request_updates' || action === 'approve_book';
    if (busy || !privilegedApi || (finalAction ? !reviewPayload.permissions?.canFinalize : !reviewPayload.permissions?.canMutate)) return false;
    setBusy(true); setFeedback(null);
    try {
      const next = await privilegedApi.call('mutatePrivilegedAdminReview', { bookId: reviewPayload.book.id, reviewRoundId: reviewPayload.reviewRound.id, expectedRevision: reviewPayload.reviewRound.revision, action, step, ...input });
      setReviewPayload(next);
      return true;
    } catch (error) {
      if (error?.status === 409) {
        try {
          const authoritative = await privilegedApi.call('loadPrivilegedAdminReview', { bookId: reviewPayload.book.id, reviewRoundId: reviewPayload.reviewRound.id });
          setReviewPayload(authoritative);
        } catch { /* retain the current screen while reporting the original conflict */ }
        setFeedback({ kind: 'error', text: 'This review changed elsewhere. The latest version was loaded.' });
      } else {
        setFeedback({ kind: 'error', text: error.message || 'The review action could not be completed.' });
      }
      return false;
    } finally { setBusy(false); }
  };

  const navigateStep = async (nextStep) => {
    if (!STEPS.includes(nextStep) || nextStep === step) return;
    if (!reviewStepAccessible(reviewPayload.items, nextStep, reviewPayload.reviewRound?.reachedSteps)) return;
    if (STEPS.indexOf(nextStep) > STEPS.indexOf(step)) {
      const pending = draft.items.filter((item) => draft.decisions[item.id] === 'pending');
      if (pending.length) {
        setFeedback({ kind: 'error', text: `Decide all required sections before continuing: ${pending.map((item) => item.label).join(', ')}.` });
        setJumpItemId(pending[0].id);
        sectionRefs.current.get(pending[0].id)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
      if (reviewPayload.permissions?.canMutate && !reviewPayload.reviewRound?.reachedSteps?.includes(nextStep)) {
        const reached = await runAction('reach_step', { step: nextStep });
        if (!reached) return;
      }
    }
    const url = new URL(window.location.href);
    url.searchParams.set('review_step', nextStep);
    window.history.pushState({}, '', url);
    setStep(nextStep);
    setFeedback(null);
  };
  const closeComposer = React.useCallback(() => setComposer(null), []);
  const postComment = async ({ body }) => {
    const action = composer.mode === 'edit' ? 'edit_comment' : composer.mode === 'reply' ? 'reply' : 'comment';
    const ok = await runAction(action, { itemId: composer.itemId || null, commentId: composer.comment?.id || null, actionable: composer.mode === 'comment' && Boolean(composer.itemId), body });
    if (ok) setComposer(null);
  };
  const selectComment = (comment) => {
    setSelectedCommentId(comment.id);
    if (comment.itemId) {
      setJumpItemId(comment.itemId);
      sectionRefs.current.get(comment.itemId)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      window.setTimeout(() => setJumpItemId(null), 900);
    }
  };
  const selectRound = async (reviewRoundId) => {
    if (busy || !privilegedApi || reviewRoundId === reviewPayload.reviewRound.id) return;
    setBusy(true); setFeedback(null);
    try {
      const next = await privilegedApi.call('loadPrivilegedAdminReview', { bookId: reviewPayload.book.id, reviewRoundId });
      const url = new URL(window.location.href);
      url.searchParams.set('review_round_id', reviewRoundId);
      url.searchParams.set('review_step', 'details');
      window.history.pushState({}, '', url);
      setReviewPayload(next);
      setStep('details');
    } catch (error) {
      setFeedback({ kind: 'error', text: error.message || 'The selected review round could not be loaded.' });
    } finally { setBusy(false); }
  };
  const nextIndex = STEPS.indexOf(step) + 1;
  const composerItem = draft.items.find((item) => item.id === composer?.itemId);
  const progress = progressFromItems(reviewPayload.items || [], reviewPayload.reviewRound?.reachedSteps);
  const allItems = reviewPayload.items || [];
  const allDecided = allItems.length > 0 && allItems.every((item) => item.decision !== 'pending');
  const hasUpdates = allItems.some((item) => item.decision === 'needs_updates');
  const immutable = Boolean(reviewPayload.reviewRound?.finalizedAt);
  const controlsDisabled = busy || immutable || !reviewPayload.permissions?.canMutate;
  const mutationControlsVisible = reviewMutationControlsVisible(reviewPayload);

  return h('main', { className: 'kdp-app kdp-admin-review' },
    h('div', { className: 'kdp-privileged-session' }, h('span', null, `${reviewPayload.identity?.displayName || 'Reviewer'} · Round ${reviewPayload.reviewRound?.roundNumber || 1}`), h('button', { type: 'button', className: 'kdp-link-button', onClick: onSignOut }, 'Sign out')),
    h('div', { className: 'kdp-admin-review__layout', inert: composer ? '' : undefined },
      h('div', { className: 'kdp-admin-review__workspace', inert: composer ? '' : undefined },
        h('header', { className: 'kdp-admin-review__header' }, h('button', { type: 'button', className: 'kdp-back-link', onClick: onBackToBookshelf }, '‹ Back to Bookshelf'), h('h1', null, reviewPayload.book?.title || 'Admin review'), h('p', null, `Reviewing ${reviewPayload.book?.author || 'submitted title'} · Employee values are read-only.`),
          reviewPayload.roundHistory?.length > 1 ? h('label', { className: 'kdp-review-round-picker' }, h('span', null, 'Review round'), h('select', { value: reviewPayload.reviewRound.id, disabled: busy, onChange: (event) => selectRound(event.target.value) }, reviewPayload.roundHistory.map((entry) => h('option', { key: entry.id, value: entry.id }, `Round ${entry.roundNumber}${entry.finalizedAt ? ` — ${labelKey(entry.outcome)}` : ' — Current'}`)))) : null),
        h(KdpProgress, { progress, currentStep: step, onNavigate: navigateStep }),
        immutable ? h('div', { className: 'kdp-review-contract-note', role: 'status' },
          h('strong', null, `Historical review round ${reviewPayload.reviewRound.roundNumber || 1}`),
          ` · ${labelKey(reviewPayload.reviewRound.outcome)}${reviewPayload.reviewRound.submittedAt ? ` · Submitted ${new Date(reviewPayload.reviewRound.submittedAt).toLocaleString()}${reviewPayload.reviewRound.submittedBy ? ` by ${reviewPayload.reviewRound.submittedBy}` : ''}` : ''} · Finalized ${reviewPayload.reviewRound.finalizedAt ? new Date(reviewPayload.reviewRound.finalizedAt).toLocaleString() : 'at an unavailable time'}${reviewPayload.reviewRound.finalizedBy ? ` by ${reviewPayload.reviewRound.finalizedBy}` : ''}${reviewPayload.reviewRound.reviewer ? ` · Reviewer: ${reviewPayload.reviewRound.reviewer}` : ''}. This submitted snapshot and review history are permanently read-only.`
        ) : null,
        feedback ? h('div', { className: `kdp-msg kdp-msg--${feedback.kind}`, role: 'alert' }, feedback.text) : null,
        h('div', { className: 'kdp-admin-review__sections' }, draft.items.map((item) => {
          const issueNumber = reviewIssueNumber(draft.comments, item.id);
          return h('section', { className: `kdp-section kdp-admin-review-section${jumpItemId === item.id ? ' is-jump-target' : ''}`, key: item.id, ref: (node) => { if (node) sectionRefs.current.set(item.id, node); else sectionRefs.current.delete(item.id); } },
            h('div', { className: 'kdp-section-label' }, h('span', null, item.label), issueNumber ? h('button', { type: 'button', className: 'kdp-review-marker', onClick: () => selectComment(draft.comments.find((comment) => comment.itemId === item.id)), 'aria-label': `Open comment ${issueNumber} for ${item.label}` }, issueNumber) : null),
            h('div', { className: 'kdp-section-content kdp-review-readonly' },
              h(ReadOnlyValue, { name: item.label, value: sectionData(item) }),
              mutationControlsVisible ? h('button', { type: 'button', disabled: controlsDisabled, className: 'kdp-link-button kdp-review-add-section-comment', onClick: () => setComposer({ mode: 'comment', itemId: item.id }), 'aria-label': `Add comment to ${item.label}` }, '+ Add section comment') : null
            ),
            mutationControlsVisible
              ? h(DecisionControl, { item, decision: draft.decisions[item.id], disabled: controlsDisabled, onApprove: () => runAction('approve', { itemId: item.id }), onReopen: () => runAction('reopen', { itemId: item.id }) })
              : h(HistoricalDecision, { decision: draft.decisions[item.id] })
          );
        })),
        h('footer', { className: 'kdp-admin-review__actions' },
          h('button', { type: 'button', className: 'kdp-btn kdp-btn--secondary', onClick: step === 'details' ? onBackToBookshelf : () => navigateStep(STEPS[STEPS.indexOf(step) - 1]) }, step === 'details' ? 'Back to Bookshelf' : `Back to ${labelKey(STEPS[STEPS.indexOf(step) - 1])}`),
          h('div', null,
            mutationControlsVisible ? h('button', { type: 'button', className: 'kdp-btn kdp-btn--secondary', disabled: controlsDisabled, onClick: () => runAction('approve_all') }, busy ? 'Working…' : 'Approve All') : null,
            nextIndex < STEPS.length
              ? h('button', { type: 'button', className: 'kdp-btn kdp-btn--primary', onClick: () => navigateStep(STEPS[nextIndex]), 'aria-label': 'Review Next Page' }, 'Review Next Page')
              : !mutationControlsVisible ? null
                : hasUpdates
                ? h('button', { type: 'button', className: 'kdp-btn kdp-btn--primary', disabled: controlsDisabled || !allDecided || !reviewPayload.permissions?.canFinalize, onClick: () => runAction('request_updates') }, 'Request Updates')
                : h('button', { type: 'button', className: 'kdp-btn kdp-btn--primary', disabled: controlsDisabled || !allDecided || !reviewPayload.permissions?.canFinalize, onClick: () => runAction('approve_book') }, 'Approve Book')
          )
        )
      ),
      h(ReviewPanel, { draft, activeItemId: selectedCommentId, onSelect: selectComment, onAddGeneral: () => setComposer({ mode: 'comment', itemId: null }), mutationControlsVisible,
        onReply: (comment) => setComposer({ mode: 'reply', comment, itemId: comment.itemId }),
        onEdit: (comment) => setComposer({ mode: 'edit', comment, itemId: comment.itemId }),
        onResolve: (comment) => runAction('resolve_comment', { commentId: comment.id }),
        onDelete: (comment) => runAction('delete_comment', { commentId: comment.id }),
      })
    ),
    composer ? h(CommentComposer, { sectionLabel: composerItem?.label, title: composer.mode === 'reply' ? 'Reply to comment' : composer.mode === 'edit' ? 'Edit comment' : null, initialBody: composer.mode === 'edit' ? composer.comment.body : '', onClose: closeComposer, onPost: postComment }) : null
  );
}
