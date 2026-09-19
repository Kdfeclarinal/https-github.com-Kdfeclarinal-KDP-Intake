import React from 'react';
import { useDirtyNavigation } from '../navigation/DirtyNavigationGuard.jsx';
import { KdpCheckIcon, KdpProgress } from '../progress/KdpProgress.jsx';
import { useEmployeeUpdateSection } from '../employeeUpdates/EmployeeUpdateNotice.jsx';
import { TERRITORIES } from './territories.js';
import { MARKETPLACES, applyFxRates, deliveryCost, estimatedRoyalty, hydratePricingState, priceLimits, serializePricingState, setMarketplacePrice, setPrimaryPrice, setRoyaltyPlan } from './pricingState.js';

const h = React.createElement;
const SAVE_ENDPOINT = 'https://wpuexhsrhuxieobeanjr.supabase.co/functions/v1/saveEmployeeStep';
const SUBMIT_ENDPOINT = 'https://wpuexhsrhuxieobeanjr.supabase.co/functions/v1/submitBookForApproval';
const RESUBMIT_ENDPOINT = 'https://wpuexhsrhuxieobeanjr.supabase.co/functions/v1/resubmitBookForReview';
const FX_ENDPOINT = 'https://wpuexhsrhuxieobeanjr.supabase.co/functions/v1/loadPricingFxRates';
const REQUIRED_KEYS = ['territories', 'primary_marketplace', 'royalty_and_pricing'];
const PRICING_HELP = 'https://kdp.amazon.com/en_US/help/topic/G200641280';
const RIGHTS_HELP = 'https://kdp.amazon.com/en_US/help/topic/A1H1OSSLAY4B4F';
const SELECT_HELP = 'https://kdp.amazon.com/en_US/help/topic/G200798990';
const STORYTELLER_HELP = 'https://www.amazon.co.uk/b?node=12061299031';
const TERMS_HELP = 'https://kdp.amazon.com/terms-and-conditions';
const SELECT_MARKETS = new Set(['amazon.in', 'amazon.co.jp', 'amazon.com.br', 'amazon.com.mx']);

function progressFromServer(raw) {
  const fallback = { details: { status: 'complete' }, content: { status: 'complete' }, pricing: { status: 'in_progress' } };
  if (!raw || !raw.steps) return fallback;
  return Object.fromEntries(['details', 'content', 'pricing'].map((key) => {
    const step = raw.steps[key] || {};
    return [key, { status: step.isComplete || step.status === 'complete' ? 'complete' : step.isUnlocked || step.status === 'in_progress' ? 'in_progress' : 'locked' }];
  }));
}
function Section({ label, error, children }) {
  const update = useEmployeeUpdateSection(label);
  return h('section', { className: `kdp-section${update.locked ? ' kdp-section--update-locked' : ''}${update.requested ? ' kdp-section--update-requested' : ''}`, inert: update.locked ? '' : undefined, 'aria-disabled': update.locked ? 'true' : undefined }, h('div', { className: 'kdp-section-label' }, h('span', null, label)), h('div', { className: 'kdp-section-content' }, children, error ? h('div', { className: 'kdp-error-alert', role: 'alert' }, error) : null));
}
function ExternalLink({ href, children }) { return h('a', { className: 'kdp-link', href, target: '_blank', rel: 'noopener noreferrer' }, children); }
function money(value, currency) {
  if (value == null) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: currency === 'JPY' ? 0 : 2 }).format(value);
}
function dirtySnapshot(state) {
  return JSON.stringify({ kdpSelect: state.kdpSelect, territoryMode: state.territoryMode, selectedTerritories: state.selectedTerritories, royaltyPlan: state.royaltyPlan, primaryListPrice: state.primaryListPrice, marketplaces: state.marketplaces.map(({ id, listPrice, manualOverride }) => ({ id, listPrice, manualOverride })) });
}

export function PricingPage({ book, bookId, accessToken, savedState, initialProgress, onNavigate, files, employeeUpdate, employeeRevision, onConcurrencyConflict, onSubmitted }) {
  const [state, setState] = React.useState(() => hydratePricingState(savedState, book));
  const baselineRef = React.useRef(dirtySnapshot(state));
  const [progress, setProgress] = React.useState(() => progressFromServer(initialProgress));
  const [feedback, setFeedback] = React.useState(null);
  const [saving, setSaving] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [submitted, setSubmitted] = React.useState(false);
  const [overlay, setOverlay] = React.useState(null);
  const [fxStatus, setFxStatus] = React.useState('loading');
  const [revision, setRevision] = React.useState(Number(employeeRevision) || 0);
  const savingRef = React.useRef(false);
  const submittingRef = React.useRef(false);
  const primaryMarket = MARKETPLACES.find((row) => row.id === state.primaryMarketplace) || MARKETPLACES[0];

  React.useEffect(() => {
    let cancelled = false;
    setFxStatus('loading');
    fetch(FX_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ book_id: bookId, access_token: accessToken, base_currency: primaryMarket.currency }) })
      .then((response) => response.json().catch(() => null).then((data) => ({ ok: response.ok, data })))
      .then(({ ok, data }) => {
        if (cancelled) return;
        if (!ok || !data || data.ok !== true) throw new Error('fx_unavailable');
        setState((current) => applyFxRates(current, data)); setFxStatus('ready');
      }).catch(() => { if (!cancelled) setFxStatus('error'); });
    return () => { cancelled = true; };
  }, [accessToken, bookId, primaryMarket.currency]);

  function update(patch) { setState((current) => ({ ...current, ...patch })); }
  function toggleTerritory(name) { setState((current) => ({ ...current, selectedTerritories: current.selectedTerritories.includes(name) ? current.selectedTerritories.filter((item) => item !== name) : [...current.selectedTerritories, name] })); }
  async function savePricing(saveType = 'draft') {
    if (savingRef.current || !bookId || !accessToken) return false;
    setFeedback(null); setSaving(true); savingRef.current = true; setOverlay('saving');
    const sections = serializePricingState(state);
    const stateJson = { page: 'pricing', stepName: 'pricing', stepLabel: 'Kindle eBook Pricing', saveType, savedAt: new Date().toISOString(), sections, extractedFields: {}, progressState: initialProgress || null, validationRequiredKeys: REQUIRED_KEYS, validationErrors: {} };
    try {
      const response = await fetch(SAVE_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ book_id: bookId, access_token: accessToken, expected_revision: revision, step_name: 'pricing', next_step_name: null, save_type: saveType, state_json: stateJson, extracted_fields: {}, validation_required_keys: REQUIRED_KEYS, validation_errors: {}, progress_state: initialProgress || null, source: 'ghl_kdp_pricing_page' }) });
      const data = await response.json().catch(() => null);
      if (response.status === 409) {
        setFeedback({ kind: 'error', text: 'This book changed elsewhere. The latest version is being loaded.' });
        onConcurrencyConflict?.();
        return false;
      }
      if (!response.ok || !data || data.ok !== true) throw new Error('save_failed');
      setRevision(Number(data.employee_revision));
      if (saveType === 'complete' && data.data_valid !== true) throw new Error('validation_failed');
      if (data.progress_state) setProgress(progressFromServer(data.progress_state));
      baselineRef.current = dirtySnapshot(state);
      if (saveType === 'draft') {
        setOverlay('done'); setFeedback({ kind: 'ok', text: 'Draft saved.' });
        window.setTimeout(() => setOverlay(null), window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 300 : 650);
      }
      return Number(data.employee_revision);
    } catch {
      setOverlay(null); setFeedback({ kind: 'error', text: saveType === 'complete' ? 'Complete all required Pricing fields before submitting.' : 'The pricing information could not be saved. Please try again.' }); return false;
    } finally { savingRef.current = false; setSaving(false); }
  }

  const saveDraft = () => savePricing('draft');
  async function submitForApproval() {
    if (submitted || submittingRef.current || savingRef.current) return;
    submittingRef.current = true; setSubmitting(true); setFeedback(null);
    try {
      const savedRevision = await savePricing('complete');
      if (savedRevision === false) return;
      setOverlay('submitting');
      const response = await fetch(employeeUpdate ? RESUBMIT_ENDPOINT : SUBMIT_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(employeeUpdate ? { bookId, accessToken, updateCycleId: employeeUpdate.updateCycleId, expectedRevision: savedRevision } : { book_id: bookId, access_token: accessToken, expected_revision: savedRevision }) });
      const data = await response.json().catch(() => null);
      if (response.status === 409) { setOverlay(null); setFeedback({ kind: 'error', text: 'This book changed elsewhere. The latest version is being loaded.' }); onConcurrencyConflict?.(); return; }
      if (!response.ok || !data || data.ok !== true) throw new Error('submit_failed');
      setSubmitted(true); setOverlay('done'); setFeedback({ kind: 'ok', text: employeeUpdate ? 'Updates submitted for re-review.' : 'Submitted for approval.' });
      onSubmitted?.();
      window.setTimeout(() => setOverlay(null), window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 300 : 650);
    } catch {
      setOverlay(null); setFeedback({ kind: 'error', text: employeeUpdate ? 'The book is not ready for re-review.' : 'The book could not be submitted for approval. Please try again.' });
    } finally { submittingRef.current = false; setSubmitting(false); }
  }

  const navigation = useDirtyNavigation({ currentStep: 'pricing', isDirty: dirtySnapshot(state) !== baselineRef.current, saveDraft, navigate: onNavigate });
  const rowState = (market) => state.marketplaces.find((row) => row.id === market.id) || market;
  const limits = state.royaltyPlan ? priceLimits(primaryMarket.id, state.royaltyPlan, state.fileSizeMB) : null;
  function renderRow(market, primary, alternate = false) {
    const row = rowState(market);
    const rowLimits = state.royaltyPlan ? priceLimits(market.id, state.royaltyPlan, state.fileSizeMB) : { min: 0, max: undefined };
    const priceInvalid = state.royaltyPlan && row.listPrice != null && (row.listPrice < rowLimits.min || row.listPrice > rowLimits.max);
    const delivery = deliveryCost(row, state.royaltyPlan, state.fileSizeMB);
    const royalty = estimatedRoyalty(row, state.royaltyPlan, state.fileSizeMB, state.kdpSelect);
    const effectiveRate = state.royaltyPlan === '70' && SELECT_MARKETS.has(row.id) && !state.kdpSelect ? '35%*' : state.royaltyPlan ? `${state.royaltyPlan}%` : '—';
    return h('div', { className: 'kdp-price-row' + (primary ? ' is-primary' : '') + (!primary && alternate ? ' is-alt' : ''), key: market.id, role: 'row' },
      h('div', { className: 'kdp-price-market', 'data-label': 'Marketplace', role: 'cell' }, h('strong', null, market.marketplace), primary ? h('span', { className: 'kdp-primary-pill' }, 'Primary') : null),
      h('div', { className: 'kdp-price-input-wrap', 'data-label': 'List price', role: 'cell' }, h('label', { className: 'kdp-visually-hidden', htmlFor: `price-${market.id}` }, `${market.marketplace} list price`), h('input', { id: `price-${market.id}`, className: 'kdp-input kdp-price-input', type: 'number', inputMode: 'decimal', min: rowLimits.min, max: rowLimits.max, step: market.currency === 'JPY' ? '1' : '0.01', value: row.listPrice == null ? '' : String(row.listPrice), 'aria-invalid': priceInvalid ? 'true' : 'false', 'aria-describedby': priceInvalid ? `price-error-${market.id}` : undefined, onChange: (event) => { const value = event.target.value === '' ? null : Number(event.target.value); setState((current) => primary ? setPrimaryPrice(current, value) : setMarketplacePrice(current, market.id, value)); } }), h('span', { className: 'kdp-currency' }, market.currency), !primary && row.manualOverride ? h('button', { type: 'button', className: 'kdp-price-reset', onClick: () => setState((current) => setPrimaryPrice({ ...current, marketplaces: current.marketplaces.map((item) => item.id === market.id ? { ...item, manualOverride: false } : item) }, current.primaryListPrice)) }, 'Use estimated price') : null, priceInvalid ? h('span', { id: `price-error-${market.id}`, className: 'kdp-price-error' }, `Set a list price between ${money(rowLimits.min, market.currency)}–${money(rowLimits.max, market.currency)}.`) : null),
      h('div', { 'data-label': 'Delivery', role: 'cell' }, state.royaltyPlan === '35' ? 'No deduction' : money(delivery, market.currency)), h('div', { 'data-label': 'Rate', role: 'cell' }, effectiveRate), h('div', { 'data-label': 'Estimated royalty', role: 'cell' }, money(royalty, market.currency)));
  }
  const secondaryMarkets = MARKETPLACES.filter((row) => row.id !== primaryMarket.id);

  return h('div', { className: 'kdp-app kdp-app--pricing' },
    book?.book_title ? h('h1', { className: 'kdp-book-title' }, book.book_title) : null,
    h(KdpProgress, { progress, currentStep: 'pricing', onNavigate: navigation.requestNavigation }),
    h('form', { className: 'kdp-form', onSubmit: (event) => event.preventDefault() },
      h(Section, { label: 'KDP Select Enrollment' }, h('p', { className: 'kdp-help' }, h('strong', null, 'Reach more readers. Maximize your sales potential.'), ' ', h('span', { className: 'kdp-optional' }, '(Optional)')), h('p', { className: 'kdp-help' }, 'KDP Select is a free, 90-day program offered to Kindle eBooks. It allows you to run discounts and participate in promotions like Kindle Unlimited. ', h('strong', null, 'To enter the ', h(ExternalLink, { href: STORYTELLER_HELP }, 'Kindle Storyteller'), ' contest, your eBook needs to be enrolled in KDP Select.'), ' ', h(ExternalLink, { href: SELECT_HELP }, 'Rules and requirements')), h('label', { className: 'kdp-checkbox-row' }, h('input', { type: 'checkbox', checked: state.kdpSelect, onChange: (event) => update({ kdpSelect: event.target.checked }) }), h('span', null, 'Enroll my book in KDP Select'))),
      h(Section, { label: 'Territories' }, h('p', { className: 'kdp-help' }, 'Select the territories where you have rights to sell this book. This will determine where the book is available for sale. ', h(ExternalLink, { href: RIGHTS_HELP }, 'Which territory option should I pick?')),
        h('div', { className: 'kdp-choice-box' }, h('label', { className: 'kdp-choice-row' }, h('input', { type: 'radio', name: 'territories', checked: state.territoryMode === 'all_territories', onChange: () => update({ territoryMode: 'all_territories', selectedTerritories: [] }) }), h('span', null, h('strong', null, 'All territories'), ' (worldwide rights) ', h(ExternalLink, { href: RIGHTS_HELP }, 'What are worldwide rights?'))), h('div', { className: 'kdp-choice-divider' }), h('label', { className: 'kdp-choice-row' }, h('input', { type: 'radio', name: 'territories', checked: state.territoryMode === 'individual_territories', onChange: () => update({ territoryMode: 'individual_territories' }) }), h('span', null, h('strong', null, 'Individual territories'), ' ', h(ExternalLink, { href: RIGHTS_HELP }, 'What are individual territory rights?')))),
        h('div', { className: 'kdp-expand kdp-territory-expand' + (state.territoryMode === 'individual_territories' ? ' is-open' : ''), 'aria-hidden': state.territoryMode === 'individual_territories' ? 'false' : 'true' }, h('div', { className: 'kdp-expand__inner kdp-territory-expand__inner' }, h('fieldset', { className: 'kdp-territory-selector', disabled: state.territoryMode !== 'individual_territories' }, h('legend', { className: 'kdp-visually-hidden' }, 'Territories where you hold distribution rights'), h('div', { className: 'kdp-territory-toolbar' }, h('strong', null, 'Select: '), h('button', { type: 'button', className: 'kdp-link-button', onClick: () => update({ selectedTerritories: TERRITORIES.slice() }) }, 'All'), h('span', null, ' | '), h('button', { type: 'button', className: 'kdp-link-button', onClick: () => update({ selectedTerritories: [] }) }, 'None')), h('div', { className: 'kdp-territory-grid' }, TERRITORIES.map((name) => h('label', { key: name, className: 'kdp-checkbox-row' }, h('input', { type: 'checkbox', checked: state.selectedTerritories.includes(name), onChange: () => toggleTerritory(name) }), h('span', null, name)))), h('div', { className: 'kdp-territory-summary' }, h('strong', null, `Selected territories (${state.selectedTerritories.length} of ${TERRITORIES.length})`), state.selectedTerritories.length ? h('p', null, state.selectedTerritories.slice(0, 12).join(', '), state.selectedTerritories.length > 12 ? ` and ${state.selectedTerritories.length - 12} more…` : '') : null))))),
      h(Section, { label: 'Primary marketplace' }, h('p', { className: 'kdp-help' }, 'Pricing below is based on the primary marketplace you selected on the Details tab. To change your primary marketplace, return to the Details tab and make a new selection. If you change your primary marketplace, please reconfirm your list price before publishing your book.'), h('select', { className: 'kdp-select kdp-primary-marketplace', value: primaryMarket.id, disabled: true, 'aria-label': 'Primary marketplace from Details' }, h('option', { value: primaryMarket.id }, primaryMarket.marketplace))),
      h(Section, { label: 'Pricing, royalty, and distribution' }, h('p', { className: 'kdp-help' }, h('strong', null, 'Select a royalty plan and set your Kindle eBook list prices below.'), ' ', h(ExternalLink, { href: PRICING_HELP }, 'How does pricing and royalties work?')), h('div', { className: 'kdp-royalty-options' }, ['35', '70'].map((plan) => h('label', { className: 'kdp-radio', key: plan }, h('input', { type: 'radio', name: 'royaltyPlan', checked: state.royaltyPlan === plan, onChange: () => setState((current) => setRoyaltyPlan(current, plan)) }), h('span', null, `${plan}% royalty`)))), state.royaltyPlan === '70' ? h('div', { className: 'kdp-info-box' }, h('div', { className: 'kdp-info-box__msg' }, 'The 70% option is available only within each marketplace’s eligible price band and deducts delivery costs. Brazil, Japan, Mexico, and India also require KDP Select eligibility.')) : null, h('p', { className: 'kdp-file-size' }, state.fileSizeMB == null ? 'Converted eBook file size is not available yet.' : `Your converted eBook file size is ${state.fileSizeMB.toFixed(2)} MB.`), limits ? h('p', { className: 'kdp-price-guidance' }, `Primary price range for this selection: ${money(limits.min, primaryMarket.currency)}–${money(limits.max, primaryMarket.currency)}.`) : null,
        h('div', { className: 'kdp-price-table', role: 'table', 'aria-label': 'Marketplace pricing' }, h('div', { className: 'kdp-price-head', role: 'row' }, ['Marketplace', 'List price', 'Delivery', 'Rate', 'Estimated royalty'].map((label) => h('div', { role: 'columnheader', key: label }, label))), renderRow(primaryMarket, true), h('div', { className: 'kdp-price-conversion-note', role: 'row' }, h('div', { role: 'cell' }, 'The following list prices were converted based on the previous price you entered.')), secondaryMarkets.map((market, index) => renderRow(market, false, index % 2 === 0))),
        fxStatus === 'loading' ? h('p', { className: 'kdp-help kdp-fx-status', role: 'status' }, 'Loading estimated currency conversion rates…') : fxStatus === 'error' ? h('p', { className: 'kdp-note kdp-note--error kdp-fx-status', role: 'status' }, 'Currency estimates are temporarily unavailable.') : h('p', { className: 'kdp-help kdp-fx-status' }, `Converted prices are estimates using ${state.fxSource || 'server-provided reference rates'}${state.fxAsOf ? ` dated ${state.fxAsOf}` : ''}; Amazon may use different conversion and rounding.`)),
      h(Section, { label: 'Terms & Conditions' }, h('p', { className: 'kdp-help' }, 'It can take up to 72 hours for your title to be available for purchase on Amazon.'), h('p', { className: 'kdp-help kdp-terms-confirmation' }, 'By submitting for approval, I confirm that I agree to and am in compliance with the ', h(ExternalLink, { href: TERMS_HELP }, 'KDP Terms and Conditions'), ' and that I have all rights necessary to make the content I am uploading available for marketing, distribution and sale in each territory I have indicated above.')),
      h('div', { className: 'kdp-actions kdp-actions--nav' }, h('button', { type: 'button', className: 'kdp-btn kdp-btn--secondary kdp-btn--back', disabled: saving || submitting || submitted, onClick: () => navigation.requestNavigation('content') }, '< Back to Content'), h('div', { className: 'kdp-actions__group' }, h('button', { type: 'button', className: 'kdp-btn kdp-btn--secondary', disabled: saving || submitting || submitted, onClick: saveDraft }, saving && !submitting ? 'Saving…' : 'Save as Draft'), h('button', { type: 'button', className: 'kdp-btn kdp-btn--primary kdp-btn--continue', disabled: saving || submitting || submitted, onClick: submitForApproval }, submitting ? 'Submitting…' : submitted ? 'Submitted' : employeeUpdate ? 'Resubmit for Review' : 'Submit for Approval'))), feedback ? h('p', { className: `kdp-note kdp-note--${feedback.kind}`, role: feedback.kind === 'error' ? 'alert' : 'status' }, feedback.text) : null),
    navigation.modal,
    overlay ? h('div', { className: 'kdp-save-overlay', role: 'status', 'aria-live': 'polite' }, h('div', { className: 'kdp-save-overlay__box' }, overlay === 'done' ? h(KdpCheckIcon, { size: 28 }) : h('div', { className: 'kdp-spinner', 'aria-hidden': 'true' }), h('p', { className: 'kdp-save-overlay__label' }, overlay === 'saving' ? 'Saving…' : overlay === 'submitting' ? 'Submitting…' : 'Done!'))) : null);
}
