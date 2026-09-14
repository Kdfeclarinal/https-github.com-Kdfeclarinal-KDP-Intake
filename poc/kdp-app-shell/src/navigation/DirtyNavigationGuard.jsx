import React from 'react';

const h = React.createElement;

export function useDirtyNavigation({ currentStep, isDirty, saveDraft, navigate }) {
  const [target, setTarget] = React.useState(null);
  const [saving, setSaving] = React.useState(false);
  const modalRef = React.useRef(null);
  const returnFocusRef = React.useRef(null);

  React.useEffect(() => {
    if (!target) return undefined;
    returnFocusRef.current = document.activeElement;
    const modal = modalRef.current;
    const focusable = () => Array.from(modal?.querySelectorAll('button:not([disabled])') || []);
    focusable()[0]?.focus();
    const onKeyDown = (event) => {
      if (event.key === 'Escape' && !saving) { event.preventDefault(); setTarget(null); return; }
      if (event.key !== 'Tab') return;
      const items = focusable();
      if (!items.length) return;
      const first = items[0]; const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => { document.removeEventListener('keydown', onKeyDown); returnFocusRef.current?.focus?.(); };
  }, [saving, target]);

  const requestNavigation = React.useCallback((nextStep) => {
    if (!nextStep || nextStep === currentStep) return;
    if (!isDirty) navigate?.(nextStep);
    else setTarget(nextStep);
  }, [currentStep, isDirty, navigate]);

  const close = React.useCallback(() => { if (!saving) setTarget(null); }, [saving]);
  const discard = React.useCallback(() => {
    const next = target;
    setTarget(null);
    if (next) navigate?.(next);
  }, [navigate, target]);
  const saveAndLeave = React.useCallback(async () => {
    if (!target || saving) return;
    setSaving(true);
    const next = target;
    const saved = await saveDraft?.();
    setSaving(false);
    if (saved) {
      setTarget(null);
      navigate?.(next);
    }
  }, [navigate, saveDraft, saving, target]);

  const modal = target ? h('div', { className: 'kdp-modal-overlay kdp-unsaved-overlay', onMouseDown: (event) => { if (event.target === event.currentTarget) close(); } },
    h('div', { ref: modalRef, className: 'kdp-unsaved-modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'kdp-unsaved-title', 'aria-describedby': 'kdp-unsaved-body' },
      h('div', { className: 'kdp-unsaved-modal__header' }, h('h2', { id: 'kdp-unsaved-title' }, 'You have unsaved changes')),
      h('div', { className: 'kdp-unsaved-modal__body' }, h('p', { id: 'kdp-unsaved-body' }, 'You have unsaved changes that will be lost if you decide to leave this page.')),
      h('div', { className: 'kdp-unsaved-modal__actions' },
        h('button', { type: 'button', className: 'kdp-btn kdp-btn--primary', autoFocus: true, disabled: saving, onClick: saveAndLeave }, saving ? 'Saving…' : 'Save Changes'),
        h('button', { type: 'button', className: 'kdp-btn kdp-btn--secondary', disabled: saving, onClick: discard }, 'Continue without Saving'),
        h('button', { type: 'button', className: 'kdp-btn kdp-btn--secondary', disabled: saving, onClick: close }, 'Cancel')))) : null;

  return { requestNavigation, modal };
}
