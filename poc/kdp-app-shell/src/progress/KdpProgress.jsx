// ============================================================
// KdpProgress — shared 3-step progress header tile row.
//
// Used by DetailsPage and ContentPage so the orange "is-active"
// underline tracks the currently rendered page, not the
// workflow's activeStep. The text label (Complete / In Progress
// / Not Started) is still derived from the server's
// progress_state. Only the visual "active" state can be
// overridden by an explicit currentStep prop.
//
// `currentStep` is optional. When provided, the active underline
// is set on the tile whose key matches currentStep (if that tile
// is unlocked). When omitted, the active flag falls back to the
// server's `progress[key].active`.
// ============================================================

import { createElement as h } from 'react';
import { progressVisual } from './progressVisual.js';

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
    h('path', {
      d: 'M4 7V5a4 4 0 018 0v2h1v7H3V7h1zm1.5 0h5V5a2.5 2.5 0 00-5 0v2z',
      fill: '#565959',
    })
  );
}

function KdpInfoIcon(props) {
  return Svg(props,
    h('circle', { cx: 8, cy: 8, r: 8, fill: '#007eb9' }),
    h('path', { d: 'M8 7v5M8 4.25v.25', fill: 'none', stroke: '#fff', 'stroke-width': 1.7, 'stroke-linecap': 'round' })
  );
}

function KdpProgress({ progress, onNavigate, currentStep }) {
  // progress: { details|content|pricing: { status, active } }.
  // status: 'complete' | 'in_progress' | 'locked' (or anything else → Not Started).
  // Unlocked (non-locked) tiles are clickable and call onNavigate; locked tiles
  // render a lock and never navigate (server-authoritative, same as Content).
  //
  // currentStep (optional): when provided, drives the visual
  // "is-active" underline on the matching tile (when unlocked),
  // regardless of progress[key].active. The status text still
  // comes from progress[key].status.
  const p = progress || {};
  const steps = [
    { title: 'Kindle eBook Details', key: 'details' },
    { title: 'Kindle eBook Content', key: 'content' },
    { title: 'Kindle eBook Pricing', key: 'pricing' },
  ];
  return h(
    'div',
    { className: 'kdp-progress' },
    steps.map((s) => {
      const st = p[s.key] || {};
      const status = st.status || 'locked';
      const unlocked = status !== 'locked';
      // Visual active state: when currentStep is provided, the
      // active underline is set on the matching unlocked tile.
      // Otherwise fall back to the server's progress[key].active.
      const serverActive = !!st.active;
      const active = currentStep
        ? s.key === currentStep && unlocked
        : serverActive;
      const nav = () => { if (unlocked && s.key !== currentStep && onNavigate) onNavigate(s.key); };
      const visual = progressVisual(status);
      return h(
        'div',
        {
          key: s.title,
          className: 'kdp-progress-item' + (active ? ' is-active' : '') + (unlocked ? ' is-clickable' : ' is-locked'),
          role: 'button',
          tabIndex: unlocked ? 0 : -1,
          onClick: unlocked && onNavigate ? nav : null,
          onKeyDown: unlocked && onNavigate ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); nav(); } } : null,
          'aria-disabled': unlocked ? 'false' : 'true',
          'data-step': s.key,
          'data-active': active ? 'true' : 'false',
        },
        h('div', { className: 'kdp-progress-title' }, s.title),
        h(
          'div',
          { className: 'kdp-progress-status' },
          visual.icon === 'check' ? KdpCheckIcon() : visual.icon === 'info' ? KdpInfoIcon() : KdpLockIcon(),
          h('span', null, visual.text)
        )
      );
    })
  );
}

export { KdpProgress, KdpCheckIcon, KdpInfoIcon, KdpLockIcon };
export default KdpProgress;
