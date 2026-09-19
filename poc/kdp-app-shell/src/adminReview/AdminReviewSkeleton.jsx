import React from 'react';

const h = React.createElement;

function Band({ width = '100%', height = '13px', className = '' }) {
  return h('span', {
    className: `kdp-skel-band${className ? ` ${className}` : ''}`,
    style: { width, height },
    'aria-hidden': 'true',
  });
}

function ProgressCard() {
  return h('div', { className: 'kdp-skel-progress-item', 'aria-hidden': 'true' },
    h(Band, { width: '74%', height: '14px', className: 'kdp-skel-band--text' }),
    h(Band, { width: '48%', height: '12px', className: 'kdp-skel-band--text kdp-skel-band--dim' })
  );
}

function ReviewSectionSkeleton({ tall = false }) {
  return h('div', { className: 'kdp-skel-section kdp-admin-review-skeleton-section', 'aria-hidden': 'true' },
    h('div', { className: 'kdp-skel-section-label' },
      h(Band, { width: '86%', height: '16px', className: 'kdp-skel-band--text' })
    ),
    h('div', { className: 'kdp-skel-section-body' },
      h(Band, { width: '88%', height: '13px' }),
      h('div', { className: 'kdp-skel-row' }, h(Band, { width: tall ? '76%' : '62%', height: '13px' })),
      h('div', { className: 'kdp-skel-row kdp-skel-row--control' },
        h(Band, { width: tall ? '78%' : '56%', height: tall ? '74px' : '32px', className: 'kdp-skel-band--input' })
      )
    ),
    h('div', { className: 'kdp-admin-review-skeleton-action' },
      h(Band, { width: '96px', height: '38px', className: 'kdp-skel-band--btn' })
    )
  );
}

export function AdminReviewSkeleton() {
  return h('main', { className: 'kdp-app kdp-admin-review kdp-admin-review--loading', 'aria-busy': 'true', 'aria-label': 'Loading admin review' },
    h('div', { className: 'kdp-admin-review__skeleton-main', 'aria-hidden': 'true' },
      h('div', { className: 'kdp-admin-review-skeleton-title' },
        h(Band, { width: '210px', height: '18px', className: 'kdp-skel-band--text' })
      ),
      h('div', { className: 'kdp-skel-progress' },
        h(ProgressCard),
        h(ProgressCard),
        h(ProgressCard)
      ),
      h('div', { className: 'kdp-skel-sections' },
        h(ReviewSectionSkeleton),
        h(ReviewSectionSkeleton, { tall: true }),
        h(ReviewSectionSkeleton),
        h(ReviewSectionSkeleton, { tall: true })
      )
    ),
    h('aside', { className: 'kdp-review-panel kdp-review-panel--skeleton', 'aria-hidden': 'true' },
      h(Band, { width: '68%', height: '15px' }),
      h(Band, { width: '90%', height: '12px', className: 'kdp-skel-band--dim' }),
      h(Band, { width: '78%', height: '12px' }),
      h(Band, { width: '42%', height: '34px', className: 'kdp-skel-band--btn' })
    )
  );
}
