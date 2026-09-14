import React from 'react';

const h = React.createElement;

function Line({ width = '100%' }) {
  return h('span', { className: 'kdp-skel-line', style: { width } });
}

export function AdminReviewSkeleton() {
  return h('main', { className: 'kdp-app kdp-admin-review kdp-admin-review--loading', 'aria-busy': 'true', 'aria-label': 'Loading admin review' },
    h('div', { className: 'kdp-admin-review__skeleton-main', 'aria-hidden': 'true' },
      h(Line, { width: '28%' }),
      h('div', { className: 'kdp-skel-progress' }, [0, 1, 2].map((key) => h('div', { className: 'kdp-skel-card', key }, h(Line, { width: '72%' }), h(Line, { width: '42%' })))),
      [0, 1, 2, 3].map((key) => h('section', { className: 'kdp-section kdp-admin-review-section', key }, h(Line, { width: '76%' }), h('div', null, h(Line), h(Line, { width: '64%' })), h(Line, { width: '80%' })))
    ),
    h('aside', { className: 'kdp-review-panel kdp-review-panel--skeleton', 'aria-hidden': 'true' }, h(Line, { width: '70%' }), h(Line), h(Line, { width: '82%' }))
  );
}
