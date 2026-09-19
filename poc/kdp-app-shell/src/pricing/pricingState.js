const BASE = [
  ['amazon.com', 'Amazon.com', 'USD', 0.15, [0.99, 1.99, 2.99, 200], [2.99, 12.99]],
  ['amazon.in', 'Amazon.in', 'INR', 7, [49, 69, 99, 10999], [99, 599]],
  ['amazon.co.uk', 'Amazon.co.uk', 'GBP', 0.10, [0.77, 1.25, 1.49, 150], [1.77, 12.99]],
  ['amazon.de', 'Amazon.de', 'EUR', 0.12, [0.89, 1.79, 2.69, 215], [2.69, 12.99]],
  ['amazon.fr', 'Amazon.fr', 'EUR', 0.12, [0.89, 1.79, 2.69, 215], [2.69, 12.99]],
  ['amazon.es', 'Amazon.es', 'EUR', 0.12, [0.89, 1.79, 2.69, 215], [2.69, 12.99]],
  ['amazon.it', 'Amazon.it', 'EUR', 0.12, [0.89, 1.79, 2.69, 215], [2.69, 12.99]],
  ['amazon.nl', 'Amazon.nl', 'EUR', 0.12, [0.89, 1.79, 2.69, 215], [2.69, 12.99]],
  ['amazon.co.jp', 'Amazon.co.jp', 'JPY', 1, [99, 99, 99, 20000], [250, 1650]],
  ['amazon.com.br', 'Amazon.com.br', 'BRL', 0.30, [1.99, 3.99, 5.99, 400], [5.99, 31.99]],
  ['amazon.ca', 'Amazon.ca', 'CAD', 0.15, [0.99, 1.99, 2.99, 200], [2.99, 12.99]],
  ['amazon.com.mx', 'Amazon.com.mx', 'MXN', 1, [11.99, 23.99, 34.99, 2500], [34.99, 199.99]],
  ['amazon.com.au', 'Amazon.com.au', 'AUD', 0.15, [0.99, 1.99, 3.99, 220], [3.99, 15.99]],
];

export const MARKETPLACES = BASE.map(([id, marketplace, currency, deliveryRate, limits35, limits70]) => ({
  id, marketplace, currency, deliveryRate, limits35, limits70,
}));

const num = (value) => value === '' || value == null || !Number.isFinite(Number(value)) ? null : Number(value);
const sectionValue = (section) => section && typeof section === 'object' && section.value && typeof section.value === 'object' ? section.value : (section || {});
const roundCurrency = (value, currency) => currency === 'JPY' ? Math.round(value) : Math.round((value + Number.EPSILON) * 100) / 100;

export function kdpFileSizeMB(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) return null;
  // KDP rounds the delivered file size up to the nearest kilobyte before
  // applying the marketplace per-MB delivery rate.
  return Math.ceil(value / 1024) / 1024;
}

export function effectiveRoyaltyPlan(marketplaceId, royaltyPlan, kdpSelect) {
  const selectMarkets = new Set(['amazon.in', 'amazon.co.jp', 'amazon.com.br', 'amazon.com.mx']);
  return royaltyPlan === '70' && selectMarkets.has(marketplaceId) && !kdpSelect ? '35' : royaltyPlan;
}

function boundedConvertedPrice(value, market, state) {
  const rounded = roundCurrency(value, market.currency);
  if (!state.royaltyPlan) return rounded;
  const limits = priceLimits(market.id, state.royaltyPlan, state.fileSizeMB);
  return Math.min(limits.max, Math.max(limits.min, rounded));
}

export function priceLimits(marketplaceId, royaltyPlan, fileSizeMB) {
  const market = MARKETPLACES.find((row) => row.id === marketplaceId) || MARKETPLACES[0];
  if (royaltyPlan === '70') return { min: market.limits70[0], max: market.limits70[1] };
  const size = num(fileSizeMB) || 0;
  const min = size < 3 ? market.limits35[0] : size < 10 ? market.limits35[1] : market.limits35[2];
  return { min, max: market.limits35[3] };
}

export function deliveryCost(marketplace, royaltyPlan, fileSizeMB) {
  if (royaltyPlan !== '70') return 0;
  const size = num(fileSizeMB);
  if (size === null) return null;
  if (marketplace.id === 'amazon.co.jp' && size >= 10) return 0;
  const minimum = marketplace.currency === 'JPY' || marketplace.currency === 'INR' || marketplace.currency === 'MXN' ? 1 : 0.01;
  return roundCurrency(Math.max(minimum, size * marketplace.deliveryRate), marketplace.currency);
}

export function estimatedRoyalty(row, royaltyPlan, fileSizeMB, kdpSelect) {
  const price = num(row.listPrice);
  if (price === null || !royaltyPlan) return null;
  const effectivePlan = effectiveRoyaltyPlan(row.id, royaltyPlan, kdpSelect);
  const delivery = deliveryCost(row, effectivePlan, fileSizeMB);
  if (effectivePlan === '70' && delivery === null) return null;
  // This is a pre-tax estimate. Exact KDP royalties can differ where the
  // customer-facing list price includes applicable VAT/tax.
  return roundCurrency(Math.max(0, (price - (delivery || 0)) * (effectivePlan === '70' ? 0.70 : 0.35)), row.currency);
}

export function hydratePricingState(savedState, book) {
  const sections = savedState && savedState.sections && typeof savedState.sections === 'object' ? savedState.sections : {};
  const territories = sectionValue(sections.territories);
  const select = sectionValue(sections.kdp_select);
  const pricing = sectionValue(sections.royalty_and_pricing);
  const primary = sectionValue(sections.primary_marketplace);
  // Details owns this value. Pricing may retain a historical display copy, but
  // it must never override the current server-returned book field.
  const primaryMarketplace = book?.primary_marketplace || pricing.primaryMarketplace || pricing.primary_marketplace || primary.value || 'amazon.com';
  const savedRows = Array.isArray(pricing.marketplaces) ? pricing.marketplaces : [];
  const rows = MARKETPLACES.map((market) => {
    const saved = savedRows.find((row) => row && (row.id === market.id || row.marketplace === market.marketplace)) || {};
    return { ...market, rate: num(saved.rate), listPrice: num(saved.listPrice), delivery: num(saved.delivery), royalty: num(saved.royalty), manualOverride: saved.manualOverride === true };
  });
  const explicitPrimaryPrice = num(pricing.primaryListPrice ?? pricing.primary_list_price);
  const primaryPrice = explicitPrimaryPrice ?? rows.find((item) => item.id === primaryMarketplace)?.listPrice ?? null;
  if (primaryPrice !== null) {
    const row = rows.find((item) => item.id === primaryMarketplace);
    if (row) row.listPrice = primaryPrice;
  }
  return {
    kdpSelect: select.enrolled === true,
    territoryMode: territories.territoryMode || territories.territory_mode || null,
    selectedTerritories: Array.isArray(territories.selectedTerritories) ? territories.selectedTerritories.slice() : [],
    primaryMarketplace,
    royaltyPlan: pricing.royaltyPlan || pricing.royalty_plan || null,
    primaryListPrice: primaryPrice,
    fileSizeMB: num(pricing.fileSizeMB ?? pricing.file_size_mb),
    fxSource: pricing.fxSource || pricing.fx_source || null,
    fxAsOf: pricing.fxAsOf || pricing.fx_as_of || null,
    marketplaces: rows,
  };
}

export function applyFxRates(state, payload) {
  if (!payload || payload.base !== (MARKETPLACES.find((row) => row.id === state.primaryMarketplace)?.currency) || !payload.rates || typeof payload.rates !== 'object') return state;
  const primaryCurrency = payload.base;
  return {
    ...state,
    fxSource: payload.source || null,
    fxAsOf: payload.asOf || null,
    marketplaces: state.marketplaces.map((row) => {
      const rawRate = row.currency === primaryCurrency ? 1 : Number(payload.rates[row.currency]);
      if (!Number.isFinite(rawRate) || rawRate <= 0) return row;
      if (row.id === state.primaryMarketplace) return { ...row, rate: 1 };
      if (row.manualOverride || state.primaryListPrice === null) return { ...row, rate: rawRate };
      return { ...row, rate: rawRate, listPrice: boundedConvertedPrice(state.primaryListPrice * rawRate, row, state) };
    }),
  };
}

export function setPrimaryPrice(state, value) {
  const price = num(value);
  return {
    ...state,
    primaryListPrice: price,
    marketplaces: state.marketplaces.map((row) => {
      if (row.id === state.primaryMarketplace) return { ...row, listPrice: price, manualOverride: false };
      if (row.manualOverride || price === null || row.rate === null) return row;
      return { ...row, listPrice: boundedConvertedPrice(price * row.rate, row, state) };
    }),
  };
}

export function setRoyaltyPlan(state, royaltyPlan) {
  const next = { ...state, royaltyPlan };
  return setPrimaryPrice(next, next.primaryListPrice);
}

export function setMarketplacePrice(state, id, value) {
  const price = num(value);
  return { ...state, marketplaces: state.marketplaces.map((row) => row.id === id ? { ...row, listPrice: price, manualOverride: id !== state.primaryMarketplace } : row) };
}

export function validatePricing(state) {
  const errors = {};
  if (!state.territoryMode || (state.territoryMode === 'individual_territories' && state.selectedTerritories.length === 0)) {
    errors['pricing.territories'] = state.territoryMode === 'individual_territories' ? 'Select at least one territory.' : 'Select territories for your book.';
  }
  const limits = state.royaltyPlan ? priceLimits(state.primaryMarketplace, state.royaltyPlan, state.fileSizeMB) : null;
  if (!state.royaltyPlan || state.primaryListPrice === null || (limits && (state.primaryListPrice < limits.min || state.primaryListPrice > limits.max))) {
    errors['pricing.royalty_and_pricing'] = limits && state.primaryListPrice !== null
      ? `Enter a list price from ${limits.min} to ${limits.max} ${MARKETPLACES.find((row) => row.id === state.primaryMarketplace)?.currency || ''}.`
      : 'Choose a royalty plan and enter a valid primary list price.';
  }
  if (state.royaltyPlan) {
    const invalidRow = state.marketplaces.find((row) => {
      const price = num(row.listPrice);
      const rowLimits = priceLimits(row.id, state.royaltyPlan, state.fileSizeMB);
      return price === null || price < rowLimits.min || price > rowLimits.max;
    });
    if (invalidRow) errors['pricing.royalty_and_pricing'] = `Enter a valid ${invalidRow.marketplace} list price.`;
  }
  return errors;
}

export function serializePricingState(state) {
  return {
    territories: { territoryMode: state.territoryMode, selectedTerritories: state.selectedTerritories.slice(), worldwideRights: state.territoryMode === 'all_territories' },
    primary_marketplace: { value: state.primaryMarketplace || null, inheritedFromDetails: true, readOnly: true },
    kdp_select: { enrolled: state.kdpSelect === true },
    royalty_and_pricing: {
      royaltyPlan: state.royaltyPlan,
      primaryListPrice: state.primaryListPrice,
      primaryMarketplace: state.primaryMarketplace,
      fileSizeMB: state.fileSizeMB,
      fxSource: state.fxSource,
      fxAsOf: state.fxAsOf,
      marketplaces: state.marketplaces.map((row) => ({
        id: row.id, marketplace: row.marketplace, currency: row.currency, rate: row.rate,
        listPrice: row.listPrice,
        delivery: deliveryCost(row, effectiveRoyaltyPlan(row.id, state.royaltyPlan, state.kdpSelect), state.fileSizeMB),
        royalty: estimatedRoyalty(row, state.royaltyPlan, state.fileSizeMB, state.kdpSelect),
        manualOverride: row.manualOverride,
      })),
    },
  };
}
