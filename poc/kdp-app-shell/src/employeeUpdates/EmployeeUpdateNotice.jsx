import React from 'react';
import { userFacingError } from '../errors/userFacingError.js';

const h = React.createElement;
export const EmployeeUpdateContext = React.createContext(null);

const SECTION_KEYS = {
  'Book Title': 'book_title', 'Edition Number': 'edition_number', Author: 'primary_author',
  'Publishing Rights': 'publishing_rights', 'Primary Audience': ['adult_question', 'age_grade_range'],
  'Age and Grade Range': 'age_grade_range', 'Primary marketplace': 'primary_marketplace',
  'Kindle eBook Cover': 'cover', 'AI-Generated Content': 'ai_content', 'Kindle eBook Preview': 'preview',
  'Kindle eBook ISBN': 'isbn', 'Accessibility Features': 'accessibility',
  'KDP Select Enrollment': 'kdp_select', Territories: 'territories',
  'Pricing, royalty, and distribution': 'royalty_distribution',
};

export function useEmployeeUpdateSection(label) {
  const context = React.useContext(EmployeeUpdateContext);
  if (!context) return { locked: false, requested: false };
  const configured = SECTION_KEYS[label] || String(label || '').toLowerCase().replaceAll(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  const keys = Array.isArray(configured) ? configured : [configured];
  const requested = keys.some((key) => context.editableSectionKeys.includes(key));
  return { locked: !requested, requested };
}

export function EmployeeUpdateNotice({ context, bookId, accessToken, employeeRevision, onConcurrencyConflict }) {
  const [replying, setReplying] = React.useState(null);
  const [body, setBody] = React.useState('');
  const [message, setMessage] = React.useState('');
  const [reopening, setReopening] = React.useState(null);
  const [reason, setReason] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  if (!context) return null;
  const submitReply = async () => {
    try {
      const response = await fetch('https://wpuexhsrhuxieobeanjr.supabase.co/functions/v1/respondEmployeeReview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bookId, accessToken, expectedRevision: employeeRevision, commentId: replying, body }) });
      if (response.status === 409) { setMessage('This book changed elsewhere. The latest version is being loaded.'); onConcurrencyConflict?.(); return; }
      if (!response.ok) { setMessage('Your reply could not be saved.'); return; }
      setMessage('Reply saved. This issue is ready for re-review.'); setReplying(null); setBody(''); onConcurrencyConflict?.();
    } catch (error) { setMessage(userFacingError(error, 'Your reply could not be saved. Try again.').message); }
  };
  const reopenSection = async () => {
    if (!reopening || !reason.trim() || busy) return;
    setBusy(true); setMessage('');
    try {
      const response = await fetch('https://wpuexhsrhuxieobeanjr.supabase.co/functions/v1/reopenEmployeeReviewSection', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bookId, accessToken, updateCycleId: context.updateCycleId, step: context.step, sectionKey: reopening.sectionKey, reason, expectedRevision: employeeRevision }) });
      if (response.status === 409) { setMessage('This book changed elsewhere. The latest version is being loaded.'); onConcurrencyConflict?.(); return; }
      if (!response.ok) throw Object.assign(new Error('reopen failed'), { status: response.status });
      setMessage(`${reopening.label} is now editable. Its prior approval remains preserved in the finalized round.`); setReopening(null); setReason(''); onConcurrencyConflict?.();
    } catch (error) { setMessage(userFacingError(error, 'The section could not be reopened. Try again.').message); }
    finally { setBusy(false); }
  };
  return h('section', { className: 'kdp-employee-update-notice', 'aria-label': 'Requested updates' },
    h('h2', null, `Employee Updates — Round ${context.roundNumber}`),
    h('p', null, 'Reviewer-requested sections are editable. If another approved section also needs correction, reopen it explicitly and record why.'),
    context.threads.map((thread) => h('article', { key: thread.id }, h('strong', null, `#${thread.number || '•'} ${thread.sectionKey}`), h('p', null, thread.body),
      thread.replies?.length ? h('div', { className: 'kdp-employee-update-replies', 'aria-label': `Replies to comment ${thread.number}` }, thread.replies.map((reply) => h('blockquote', { key: reply.id }, reply.body))) : null,
      h('p', { className: `kdp-employee-update-readiness${thread.readyForRereview ? ' is-ready' : ''}` }, thread.readyForRereview ? 'Ready for re-review. Reviewer resolution is still required.' : 'Awaiting a reply or saved change before re-review.'),
      replying === thread.id ? h('div', null, h('textarea', { value: body, maxLength: 2000, onChange: (event) => setBody(event.target.value), 'aria-label': `Reply to comment ${thread.number}` }), h('button', { type: 'button', className: 'kdp-btn kdp-btn--secondary', disabled: !body.trim(), onClick: submitReply }, 'Post Reply')) : h('button', { type: 'button', className: 'kdp-link-button', onClick: () => setReplying(thread.id) }, 'Reply'))),
    context.reopenedSections?.map((section) => h('article', { key: section.id, className: 'kdp-employee-update-reopened' }, h('strong', null, `${section.sectionKey} reopened`), h('p', null, section.reason))),
    context.reopenableSections?.length ? h('details', { className: 'kdp-employee-update-reopen' }, h('summary', null, 'Need to correct another approved section?'), h('div', null, context.reopenableSections.map((section) => h('button', { key: section.itemId, type: 'button', className: 'kdp-link-button', onClick: () => { setReopening(section); setReason(''); } }, `Reopen ${section.label}`)))) : null,
    reopening ? h('div', { className: 'kdp-modal-overlay', role: 'presentation' }, h('div', { className: 'kdp-modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'employee-reopen-title' }, h('div', { className: 'kdp-modal__header' }, h('h2', { id: 'employee-reopen-title', className: 'kdp-modal__title' }, `Reopen ${reopening.label}?`)), h('p', null, 'Explain why this approved section also needs correction. The finalized review history will not be changed.'), h('label', null, h('span', null, 'Reason'), h('textarea', { value: reason, maxLength: 1000, onChange: (event) => setReason(event.target.value), autoFocus: true })), h('div', { className: 'kdp-bookshelf-action-modal__actions' }, h('button', { type: 'button', className: 'kdp-btn kdp-btn--secondary', disabled: busy, onClick: () => setReopening(null) }, 'Cancel'), h('button', { type: 'button', className: 'kdp-btn kdp-btn--primary', disabled: busy || !reason.trim(), onClick: reopenSection }, busy ? 'Reopening…' : 'Reopen section')))) : null,
    message ? h('p', { role: 'status' }, message) : null
  );
}
