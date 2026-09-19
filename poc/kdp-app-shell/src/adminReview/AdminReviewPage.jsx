import React from 'react';
import { KdpProgress } from '../progress/KdpProgress.jsx';
import { userFacingError } from '../errors/userFacingError.js';
import { PricingTermsReadOnly, SubmittedSectionBody } from './AdminSubmittedStep.jsx';
import {
  createReviewDraft,
  filterReviewComments,
  reviewIssueNumber,
  reviewPageProgress,
  reviewStepAccessible,
  reviewMutationControlsVisible,
  commentMutationControls,
  terminalReviewConfirmation,
} from './adminReviewState.js';

const h = React.createElement;
const STEPS = ['details', 'content', 'pricing'];

function labelKey(value) {
  return String(value || '').replaceAll('_', ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (letter) => letter.toUpperCase());
}

function reviewDisplayLabel(item) {
  const key = String(item?.sectionKey || '').split('.').pop();
  const labels = {
    preview: 'Review Uploaded Files',
    accessibility_features: 'Accessibility Features',
    kdp_select_enrollment: 'KDP Select Enrollment',
    primary_marketplace: item?.step === 'pricing' ? 'Primary marketplace' : 'Primary Marketplace',
    royalty_distribution: 'Pricing, royalty, and distribution',
  };
  return labels[key] || item?.label || 'Review section';
}

function DecisionControl({ item, decision, onApprove, onReopen, disabled, pendingAction }) {
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
        pendingAction === 'reopen' ? 'Reopening…' : 'Reopen Decision'
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
    pendingAction === 'approve' ? 'Approving…' : 'APPROVE'
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

function CommentComposer({ sectionLabel, initialBody = '', title, onClose, onPost, busy = false }) {
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
    h('div', { className: 'kdp-review-composer__handle' },
      h('h2', { id: 'review-comment-title', onPointerDown: startDrag, onPointerMove: moveDrag, onPointerUp: () => { drag.current = null; } }, title || 'ADD YOUR COMMENT'),
      h('button', { type: 'button', className: 'kdp-icon-button', onPointerUp: onClose, onClick: onClose, 'aria-label': 'Close comment composer' },
        h('svg', { viewBox: '0 0 20 20', 'aria-hidden': 'true' }, h('path', { d: 'm4 4 12 12M16 4 4 16' }))
      )
    ),
    sectionLabel ? h('p', { className: 'kdp-review-composer__section' }, `Section: ${sectionLabel}`) : null,
    h('label', { className: 'kdp-review-composer__body' }, h('span', { className: 'kdp-sr-only' }, 'Comment'), h('textarea', { 'aria-label': 'Comment', value: body, onChange: (event) => setBody(event.target.value), placeholder: 'Describe what needs attention…', maxLength: 2000, autoFocus: true })),
    h('div', { className: 'kdp-review-composer__footer' }, h('span', null, `${body.length}/2000`), h('button', { type: 'button', className: 'kdp-btn kdp-btn--secondary', onClick: () => { if (body.trim() && !busy) onPost({ body }); }, disabled: !body.trim() || busy, 'aria-label': 'Post comment' }, busy ? 'Posting…' : 'Post'))
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
      h('label', null, h('span', null, 'Comment contains'), h('input', { type: 'search', value: query, onChange: (event) => setQuery(event.target.value), placeholder: 'Comment Contains' })),
      h('fieldset', null, h('legend', null, 'Sort comments by'), ['newest', 'oldest'].map((value) => h('label', { key: value }, h('input', { type: 'radio', name: 'comment-sort', value, checked: sort === value, onChange: () => setSort(value) }), value === 'newest' ? 'Latest Comment' : 'Oldest Comment')))
    ) : null,
    collapsed ? null : tab === 'comments'
      ? h('div', { className: 'kdp-review-panel__body' },
          comments.length ? h('div', { className: 'kdp-review-comment-list' }, comments.map((comment) => {
            const expanded = selected?.id === comment.id;
            const controls = commentMutationControls(comment, !mutationControlsVisible);
            const item = comment.itemId ? draft.items.find((candidate) => candidate.id === comment.itemId) : null;
            return h('article', { className: `kdp-review-comment${expanded ? ' is-expanded' : ''}`, key: comment.id },
              h('button', { type: 'button', className: 'kdp-review-comment__header', onClick: () => onSelect(comment), 'aria-expanded': expanded ? 'true' : 'false' },
                h('span', { className: 'kdp-review-comment__index' }, comment.issueNumber || '•'),
                h('span', { className: 'kdp-review-comment__who' }, h('strong', null, comment.author), h('small', null, comment.itemId ? reviewDisplayLabel(item) : 'General comment'))
              ),
              expanded ? h('div', { className: 'kdp-review-comment__detail' },
                h('p', null, comment.body),
                h('time', null, comment.createdAt ? new Date(comment.createdAt).toLocaleString() : 'Time unavailable'),
                h(ContinuationContext, { continuation: comment.continuation }),
                mutationControlsVisible ? h('div', { className: 'kdp-review-comment__actions' },
                  controls.reply ? h('button', { type: 'button', className: 'kdp-link-button', onClick: () => onReply(comment) }, 'Reply') : null,
                  controls.edit ? h('button', { type: 'button', className: 'kdp-link-button', onClick: () => onEdit(comment) }, 'Edit') : null,
                  controls.resolve ? h('button', { type: 'button', className: 'kdp-link-button', onClick: () => onResolve(comment) }, 'Resolve') : null,
                  controls.delete ? h('button', { type: 'button', className: 'kdp-link-button', onClick: () => onDelete(comment) }, 'Delete') : null
                ) : null
              ) : null
            );
          })) : h('div', { className: 'kdp-review-panel__empty' }, h('h3', null, 'No comments on this page'), h('p', null, 'Add a general note or comment directly on a section.')),
          mutationControlsVisible ? h('button', { type: 'button', className: 'kdp-btn kdp-btn--secondary kdp-review-panel__add', onClick: onAddGeneral }, 'Add Comment') : null
        )
      : h('div', { className: 'kdp-review-panel__body kdp-review-approvals' },
          h('h3', null, 'Current page'), h('p', null, `${decided} of ${draft.items.length} sections decided`),
          h('ul', null, draft.items.map((item) => h('li', { key: item.id }, h('span', null, item.label), h('strong', { className: `is-${draft.decisions[item.id]}` }, labelKey(draft.decisions[item.id])))))
        )
  );
}

function TerminalConfirmationDialog({ confirmation, busy, onCancel, onConfirm }) {
  if (!confirmation) return null;
  return h('div', { className: 'kdp-review-composer-layer', role: 'presentation' },
    h('div', { className: 'kdp-confirm-dialog', role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': 'terminal-confirm-title', 'aria-describedby': 'terminal-confirm-body' },
      h('h2', { id: 'terminal-confirm-title' }, confirmation.title),
      h('p', { id: 'terminal-confirm-body' }, confirmation.body),
      confirmation.sections?.length ? h('div', { className: 'kdp-confirm-dialog__summary' }, h('strong', null, 'Sections requiring updates'), h('ul', null, confirmation.sections.map((section) => h('li', { key: section }, section)))) : null,
      h('div', { className: 'kdp-confirm-dialog__actions' },
        h('button', { type: 'button', className: 'kdp-btn kdp-btn--secondary', disabled: busy, onClick: onCancel }, 'Cancel'),
        h('button', { type: 'button', className: 'kdp-btn kdp-btn--primary', disabled: busy, onClick: onConfirm }, busy ? 'Working…' : confirmation.confirmLabel)
      )
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
  const [pendingAction, setPendingAction] = React.useState(null);
  const [feedback, setFeedback] = React.useState(null);
  const [terminalAction, setTerminalAction] = React.useState(null);
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
    setBusy(true); setPendingAction({ action, itemId: input.itemId || null }); setFeedback(null);
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
        setFeedback({ kind: 'error', text: userFacingError(error, 'The review action could not be completed. Try again.').message });
      }
      return false;
    } finally { setBusy(false); setPendingAction(null); }
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
      setFeedback({ kind: 'error', text: userFacingError(error, 'The selected review round could not be loaded. Try again.').message });
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
  const terminalConfirmation = terminalAction ? terminalReviewConfirmation(terminalAction, allItems) : null;

  const confirmTerminalAction = async () => {
    const action = terminalAction;
    if (!action) return;
    const ok = await runAction(action);
    if (ok) setTerminalAction(null);
  };

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
        immutable ? h('section', { className: 'kdp-review-history-summary', 'aria-label': 'Historical submission record' },
          h('div', null, h('strong', null, 'Snapshot identity'), h('span', null, reviewPayload.reviewRound.snapshotIdentity || `Round ${reviewPayload.reviewRound.roundNumber || 1}`)),
          h('div', null, h('strong', null, 'Submitted files'), reviewPayload.files?.length
            ? h('ul', null, reviewPayload.files.map((file, index) => h('li', { key: `${file.fileType || 'file'}-${file.versionNumber || index}` }, `${file.fileName}${file.versionNumber ? ` · Version ${file.versionNumber}` : ''}${file.fileSizeBytes ? ` · ${Math.ceil(file.fileSizeBytes / 1024)} KB` : ''}${file.createdAt ? ` · ${new Date(file.createdAt).toLocaleString()}` : ''}`)))
            : h('span', null, 'No submitted file metadata was preserved for this snapshot.'))
        ) : null,
        feedback ? h('div', { className: `kdp-msg kdp-msg--${feedback.kind}`, role: 'alert' }, feedback.text) : null,
        h('div', { className: 'kdp-admin-review__sections' }, draft.items.map((item) => {
          const issueNumber = reviewIssueNumber(draft.comments, item.id);
          return h('section', { className: `kdp-section kdp-admin-review-section${jumpItemId === item.id ? ' is-jump-target' : ''}`, key: item.id, ref: (node) => { if (node) sectionRefs.current.set(item.id, node); else sectionRefs.current.delete(item.id); } },
            h('div', { className: 'kdp-section-label' }, h('span', null, reviewDisplayLabel(item)), issueNumber ? h('button', { type: 'button', className: 'kdp-review-marker', onClick: () => selectComment(draft.comments.find((comment) => comment.itemId === item.id)), 'aria-label': `Open comment ${issueNumber} for ${reviewDisplayLabel(item)}` }, issueNumber) : null),
            h('div', { className: 'kdp-section-content kdp-review-readonly', tabIndex: mutationControlsVisible && !controlsDisabled ? 0 : undefined, role: mutationControlsVisible && !controlsDisabled ? 'button' : undefined, 'aria-label': mutationControlsVisible && !controlsDisabled ? `Comment on ${reviewDisplayLabel(item)}` : undefined, onClick: mutationControlsVisible && !controlsDisabled ? () => setComposer({ mode: 'comment', itemId: item.id }) : undefined, onKeyDown: mutationControlsVisible && !controlsDisabled ? (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setComposer({ mode: 'comment', itemId: item.id }); } } : undefined },
              h(SubmittedSectionBody, { item, submittedSteps: reviewPayload.submittedSteps, files: reviewPayload.files }),
              mutationControlsVisible ? h('button', { type: 'button', disabled: controlsDisabled, className: 'kdp-link-button kdp-review-add-section-comment', onClick: (event) => { event.stopPropagation(); setComposer({ mode: 'comment', itemId: item.id }); }, 'aria-label': `Add comment to ${reviewDisplayLabel(item)}` }, '+ Add section comment') : null
            ),
            mutationControlsVisible
              ? h('div', { onClick: (event) => event.stopPropagation() }, h(DecisionControl, { item, decision: draft.decisions[item.id], disabled: controlsDisabled, pendingAction: pendingAction?.itemId === item.id ? pendingAction.action : null, onApprove: () => runAction('approve', { itemId: item.id }), onReopen: () => runAction('reopen', { itemId: item.id }) }))
              : h(HistoricalDecision, { decision: draft.decisions[item.id] })
          );
        })),
        step === 'pricing' ? h(PricingTermsReadOnly) : null,
        h('footer', { className: 'kdp-admin-review__actions' },
          h('button', { type: 'button', className: 'kdp-btn kdp-btn--secondary', onClick: step === 'details' ? onBackToBookshelf : () => navigateStep(STEPS[STEPS.indexOf(step) - 1]) }, step === 'details' ? 'Back to Bookshelf' : `Back to ${labelKey(STEPS[STEPS.indexOf(step) - 1])}`),
          h('div', null,
            mutationControlsVisible ? h('button', { type: 'button', className: 'kdp-btn kdp-btn--secondary', disabled: controlsDisabled, onClick: () => runAction('approve_all') }, busy ? 'Working…' : 'Approve All') : null,
            nextIndex < STEPS.length
              ? h('button', { type: 'button', className: 'kdp-btn kdp-btn--primary', onClick: () => navigateStep(STEPS[nextIndex]), 'aria-label': 'Review Next Page' }, 'Review Next Page')
              : !mutationControlsVisible ? null
                : hasUpdates
                ? h('button', { type: 'button', className: 'kdp-btn kdp-btn--primary', disabled: controlsDisabled || !allDecided || !reviewPayload.permissions?.canFinalize, onClick: () => setTerminalAction('request_updates') }, 'Request Updates')
                : h('button', { type: 'button', className: 'kdp-btn kdp-btn--primary', disabled: controlsDisabled || !allDecided || !reviewPayload.permissions?.canFinalize, onClick: () => setTerminalAction('approve_book') }, 'Approve Book')
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
    composer ? h(CommentComposer, { sectionLabel: composerItem?.label, title: composer.mode === 'reply' ? 'Reply to comment' : composer.mode === 'edit' ? 'Edit comment' : null, initialBody: composer.mode === 'edit' ? composer.comment.body : '', onClose: closeComposer, onPost: postComment, busy }) : null,
    h(TerminalConfirmationDialog, { confirmation: terminalConfirmation, busy, onCancel: () => setTerminalAction(null), onConfirm: confirmTerminalAction })
  );
}
