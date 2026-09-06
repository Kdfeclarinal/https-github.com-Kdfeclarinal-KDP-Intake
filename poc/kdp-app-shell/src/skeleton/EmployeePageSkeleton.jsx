// EmployeePageSkeleton — reusable initial-load placeholder for the protected
// employee page shell. Used by the load gate in app.jsx while the protected
// read is in flight, so Details, Content, and (later) Pricing share the same
// loading shape instead of each showing a different plain "Loading…" string.
//
// Geometry mirrors the real employee page:
//   - 980px max-width canvas, gray (#e9e9e9) background
//   - book-title placeholder (20px tall)
//   - 3 progress-card placeholders (same row footprint, ~76px tall, 12px gap)
//   - 5–6 white content-section placeholders using the same 139px / 770px
//     two-column grid as .kdp-section, with varied heights per the spec
//
// Single subtle horizontal shimmer: only background-position animates. No
// opacity pulse, no dimension changes, no slide. prefers-reduced-motion
// disables the animation entirely (handled in app.css).
//
// `variant` is a small hook for future per-step section counts — kept as a
// prop now so callers do not need to swap components later. Default renders
// the shared 3 progress cards + 6 section bands; "details" / "content" /
// "pricing" all currently map to the same shared geometry because the real
// pages share the same shell.
//
// All placeholders are visual only. No internal field names, no IDs, no
// file-type labels, no ReviewStudio URLs. Marked aria-hidden so screen
// readers do not announce skeleton text.
import React from 'react';

function el(tag, props, ...children) {
  return React.createElement(tag, props, ...children);
}

// One shimmer band (an inline block element). `w` is a CSS width token (e.g.
// "65%" or "300px"), `h` is a height token (e.g. "12px" or "36px"). Extra
// class is appended for the few that need a different radius.
function Band({ w, h, className }) {
  return el('span', {
    className: 'kdp-skel-band' + (className ? ' ' + className : ''),
    style: { width: w, height: h },
    'aria-hidden': 'true',
  });
}

// One progress card placeholder — same row footprint as a real .kdp-progress-item.
function ProgressCard() {
  return el(
    'div',
    { className: 'kdp-skel-progress-item', 'aria-hidden': 'true' },
    el(Band, { w: '78%', h: '14px', className: 'kdp-skel-band--text' }),
    el(Band, { w: '52%', h: '12px', className: 'kdp-skel-band--text kdp-skel-band--dim' })
  );
}

// One content-section placeholder — same two-column grid as the real section.
// `kind` controls the right-column composition to give visual variety while
// staying faithful to the page geometry.
function SectionPlaceholder({ kind }) {
  let body;
  if (kind === 'tall') {
    // Taller content: paragraph block + a row of placeholder controls.
    body = el(
      'div',
      null,
      el(Band, { w: '88%', h: '13px' }),
      el('div', { className: 'kdp-skel-row' }, el(Band, { w: '74%', h: '13px' })),
      el('div', { className: 'kdp-skel-row' }, el(Band, { w: '60%', h: '13px' })),
      el('div', { className: 'kdp-skel-row kdp-skel-row--control' }, el(Band, { w: '300px', h: '32px', className: 'kdp-skel-band--input' })),
      el('div', { className: 'kdp-skel-row kdp-skel-row--control' }, el(Band, { w: '160px', h: '36px', className: 'kdp-skel-band--btn' }))
    );
  } else if (kind === 'choice') {
    // Two stacked option rows with a small circular indicator each (radios).
    body = el(
      'div',
      { className: 'kdp-skel-choice' },
      el('div', { className: 'kdp-skel-choice-row' },
        el('span', { className: 'kdp-skel-radio', 'aria-hidden': 'true' }),
        el(Band, { w: '70%', h: '13px' })
      ),
      el('div', { className: 'kdp-skel-choice-row' },
        el('span', { className: 'kdp-skel-radio', 'aria-hidden': 'true' }),
        el(Band, { w: '55%', h: '13px' })
      )
    );
  } else if (kind === 'short') {
    // Short section: label + one shorter line.
    body = el(
      'div',
      null,
      el(Band, { w: '46%', h: '13px' }),
      el('div', { className: 'kdp-skel-row' }, el(Band, { w: '35%', h: '13px' }))
    );
  } else {
    // Default (medium): label + two normal lines + an input-shape.
    body = el(
      'div',
      null,
      el(Band, { w: '80%', h: '13px' }),
      el('div', { className: 'kdp-skel-row' }, el(Band, { w: '65%', h: '13px' })),
      el('div', { className: 'kdp-skel-row kdp-skel-row--control' }, el(Band, { w: '380px', h: '32px', className: 'kdp-skel-band--input' }))
    );
  }
  return el(
    'div',
    { className: 'kdp-skel-section', 'aria-hidden': 'true' },
    el('div', { className: 'kdp-skel-section-label' },
      el(Band, { w: '90%', h: '16px', className: 'kdp-skel-band--text' })
    ),
    el('div', { className: 'kdp-skel-section-body' }, body)
  );
}

// Variant → section composition. All current variants share the same shell
// (3 progress cards + 6 white section bands with varied heights), since
// Details, Content, and Pricing all use the same employee page geometry.
// The hook is kept so a future per-step section count can be added without
// changing call sites.
function compositionFor(variant) {
  // 6 sections, varied heights per spec: medium / taller / medium / taller
  // / medium / short. Order matches the visual rhythm of the real pages.
  const kinds = ['medium', 'tall', 'medium', 'tall', 'medium', 'short'];
  if (variant === 'details' || variant === 'content' || variant === 'pricing') return kinds;
  return kinds; // default
}

export function EmployeePageSkeleton({ variant }) {
  const kinds = compositionFor(variant);
  return el(
    'div',
    {
      className: 'kdp-app kdp-app--skeleton',
      // Wrapper is also aria-hidden: placeholders are visual only; the parent
      // gate announces its own loading label.
      'aria-hidden': 'true',
    },
    // Title placeholder at the same position as .kdp-book-title.
    el('div', { className: 'kdp-skel-title' },
      el(Band, { w: '260px', h: '20px', className: 'kdp-skel-band--text' })
    ),
    // Progress row — same 3-up grid as the real progress tiles.
    el('div', { className: 'kdp-skel-progress' },
      el(ProgressCard, null),
      el(ProgressCard, null),
      el(ProgressCard, null)
    ),
    // Section bands — varied kinds, same two-column grid.
    el('div', { className: 'kdp-skel-sections' },
      kinds.map(function (k, i) {
        return el(SectionPlaceholder, { key: 's' + i, kind: k });
      })
    )
  );
}
