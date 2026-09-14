import React from 'react';

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

export function EmployeeUpdateNotice({ context, bookId, accessToken }) {
  const [replying, setReplying] = React.useState(null);
  const [body, setBody] = React.useState('');
  const [message, setMessage] = React.useState('');
  if (!context) return null;
  const submitReply = async () => {
    const response = await fetch('https://wpuexhsrhuxieobeanjr.supabase.co/functions/v1/respondEmployeeReview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bookId, accessToken, commentId: replying, body }) });
    if (!response.ok) { setMessage('Your reply could not be saved.'); return; }
    setMessage('Reply saved. This issue is ready for re-review.'); setReplying(null); setBody('');
  };
  return h('section', { className: 'kdp-employee-update-notice', 'aria-label': 'Requested updates' },
    h('h2', null, `Employee Updates — Round ${context.roundNumber}`),
    h('p', null, 'Only sections requested by the reviewer are editable. Approved sections remain locked.'),
    context.threads.map((thread) => h('article', { key: thread.id }, h('strong', null, `#${thread.number || '•'} ${thread.sectionKey}`), h('p', null, thread.body),
      replying === thread.id ? h('div', null, h('textarea', { value: body, maxLength: 2000, onChange: (event) => setBody(event.target.value), 'aria-label': `Reply to comment ${thread.number}` }), h('button', { type: 'button', className: 'kdp-btn kdp-btn--secondary', disabled: !body.trim(), onClick: submitReply }, 'Post Reply')) : h('button', { type: 'button', className: 'kdp-link-button', onClick: () => setReplying(thread.id) }, 'Reply'))),
    message ? h('p', { role: 'status' }, message) : null
  );
}
