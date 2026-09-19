import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  MARKETPLACES,
  applyFxRates,
  deliveryCost,
  effectiveRoyaltyPlan,
  estimatedRoyalty,
  hydratePricingState,
  kdpFileSizeMB,
  priceLimits,
  serializePricingState,
  setPrimaryPrice,
  setMarketplacePrice,
  setRoyaltyPlan,
  validatePricing,
} from '../src/pricing/pricingState.js';
import { TERRITORIES } from '../src/pricing/territories.js';

test('project territory list exactly matches the authoritative ordered contract', () => {
  assert.equal(TERRITORIES.length, 245);
  assert.equal(new Set(TERRITORIES).size, TERRITORIES.length);
  assert.equal(
    crypto.createHash('sha256').update(JSON.stringify(TERRITORIES)).digest('hex'),
    '624674bbf7e546893c3c0cb517040be541723c3d1724575be940214b121b7985',
  );
});

test('individual territory selections preserve exact strings through draft hydration', () => {
  const selectedTerritories = [
    'Isle Of Man',
    "Côte D'Ivoire",
    'Congo, The Democratic Republic Of The',
    'Virgin Islands, U.S.',
  ];
  const initial = {
    ...hydratePricingState(null, { primary_marketplace: 'amazon.com' }),
    territoryMode: 'individual_territories',
    selectedTerritories,
  };
  const hydrated = hydratePricingState({ sections: serializePricingState(initial) }, { primary_marketplace: 'amazon.com' });
  assert.equal(hydrated.territoryMode, 'individual_territories');
  assert.deepEqual(hydrated.selectedTerritories, selectedTerritories);
});

test('fresh Pricing drafts preserve unanswered values', () => {
  const state = hydratePricingState(null, { primary_marketplace: 'amazon.com' });
  assert.equal(state.kdpSelect, false);
  assert.equal(state.territoryMode, null);
  assert.equal(state.royaltyPlan, null);
  assert.equal(state.primaryListPrice, null);
  assert.equal(state.marketplaces.length, 13);
  assert.ok(state.marketplaces.every((row) => row.listPrice === null));
});

test('Pricing serialization uses the verified v14 section contract', () => {
  const state = hydratePricingState(null, { primary_marketplace: 'amazon.com' });
  const sections = serializePricingState({ ...state, territoryMode: 'all_territories', royaltyPlan: '70', primaryListPrice: 4.99 });
  assert.deepEqual(Object.keys(sections), ['territories', 'primary_marketplace', 'kdp_select', 'royalty_and_pricing']);
  assert.equal(sections.territories.worldwideRights, true);
  assert.equal(sections.primary_marketplace.readOnly, true);
  assert.equal(sections.royalty_and_pricing.royaltyPlan, '70');
  assert.equal(sections.royalty_and_pricing.primaryListPrice, 4.99);
});

test('current marketplace price bands and file-size-dependent 35% minimums are enforced', () => {
  assert.deepEqual(priceLimits('amazon.com', '35', 2.9), { min: 0.99, max: 200 });
  assert.deepEqual(priceLimits('amazon.com', '35', 3), { min: 1.99, max: 200 });
  assert.deepEqual(priceLimits('amazon.com', '35', 10), { min: 2.99, max: 200 });
  assert.deepEqual(priceLimits('amazon.co.jp', '70', 1), { min: 250, max: 1650 });
  assert.deepEqual(priceLimits('amazon.com.au', '70', 1), { min: 3.99, max: 15.99 });
});

test('35% has no delivery deduction and Japan waives delivery at 10 MB', () => {
  assert.equal(deliveryCost(MARKETPLACES[0], '35', 5), 0);
  const japan = MARKETPLACES.find((row) => row.id === 'amazon.co.jp');
  assert.equal(deliveryCost(japan, '70', 9), 9);
  assert.equal(deliveryCost(japan, '70', 10), 0);
});

test('primary price propagation respects manual marketplace overrides', () => {
  let state = hydratePricingState({ sections: { royalty_and_pricing: { value: {
    primaryMarketplace: 'amazon.com',
    marketplaces: MARKETPLACES.map((row) => ({ ...row, rate: row.id === 'amazon.ca' ? 1.35 : null, listPrice: null, manualOverride: false })),
  } } } }, { primary_marketplace: 'amazon.com' });
  state = setPrimaryPrice(state, 4);
  assert.equal(state.marketplaces.find((row) => row.id === 'amazon.ca').listPrice, 5.4);
  state = setMarketplacePrice(state, 'amazon.ca', 6.25);
  state = setPrimaryPrice(state, 5);
  assert.equal(state.marketplaces.find((row) => row.id === 'amazon.ca').listPrice, 6.25);
  assert.equal(state.marketplaces.find((row) => row.id === 'amazon.ca').manualOverride, true);
});

test('server FX rates populate blank non-primary prices and clamp to marketplace limits', () => {
  let state = { ...hydratePricingState(null, { primary_marketplace: 'amazon.com' }), royaltyPlan: '35', fileSizeMB: 1 };
  state = applyFxRates(state, { base: 'USD', asOf: '2026-09-08', source: 'test', rates: { USD: 1, CAD: 1.35, JPY: 150, EUR: 0.9, GBP: 0.8, INR: 84, BRL: 5.4, MXN: 19, AUD: 1.5 } });
  state = setPrimaryPrice(state, 25);
  assert.ok(state.marketplaces.filter((row) => row.id !== 'amazon.com').every((row) => row.listPrice !== null));
  assert.equal(state.marketplaces.find((row) => row.id === 'amazon.ca').listPrice, 33.75);
  const automaticBefore = new Map(state.marketplaces.map((row) => [row.id, row.listPrice]));
  state = setMarketplacePrice(state, 'amazon.co.uk', 7.77);
  state = setPrimaryPrice(state, 24);
  assert.equal(state.marketplaces.find((row) => row.id === 'amazon.co.uk').listPrice, 7.77);
  assert.ok(state.marketplaces.filter((row) => row.id !== 'amazon.com' && row.id !== 'amazon.co.uk').every((row) => row.listPrice !== automaticBefore.get(row.id)));
  assert.equal(state.marketplaces.find((row) => row.id === 'amazon.co.jp').listPrice, 3600);
  assert.equal(state.fxSource, 'test');
  assert.equal(state.fxAsOf, '2026-09-08');
});

test('70% propagation respects each marketplace price band and manual overrides', () => {
  let state = { ...hydratePricingState(null, { primary_marketplace: 'amazon.com' }), royaltyPlan: '70', fileSizeMB: 1 };
  state = applyFxRates(state, { base: 'USD', rates: { USD: 1, CAD: 2, JPY: 100, EUR: 1, GBP: 1, INR: 100, BRL: 10, MXN: 100, AUD: 2 } });
  state = setPrimaryPrice(state, 12);
  assert.equal(state.marketplaces.find((row) => row.id === 'amazon.ca').listPrice, 12.99);
  state = setMarketplacePrice(state, 'amazon.ca', 8.75);
  state = setPrimaryPrice(state, 10);
  assert.equal(state.marketplaces.find((row) => row.id === 'amazon.ca').listPrice, 8.75);
});

test('35 to 70 plan change preserves the primary input, revalidates, and recalculates automatic rows', () => {
  let state = { ...hydratePricingState(null, { primary_marketplace: 'amazon.com' }), royaltyPlan: '35', fileSizeMB: 1 };
  state = applyFxRates(state, { base: 'USD', rates: { USD: 1, CAD: 1.35, JPY: 150, EUR: 0.9, GBP: 0.8, INR: 84, BRL: 5.4, MXN: 19, AUD: 1.5 } });
  state = setPrimaryPrice(state, 25);
  state = setMarketplacePrice(state, 'amazon.co.uk', 8.25);
  state = setRoyaltyPlan(state, '70');
  assert.equal(state.primaryListPrice, 25);
  assert.equal(state.marketplaces.find((row) => row.id === 'amazon.com').listPrice, 25);
  assert.equal(state.marketplaces.find((row) => row.id === 'amazon.co.uk').listPrice, 8.25);
  assert.equal(state.marketplaces.find((row) => row.id === 'amazon.ca').listPrice, 12.99);
  assert.match(validatePricing({ ...state, territoryMode: 'all_territories' })['pricing.royalty_and_pricing'], /Amazon\.com/);
  state = setPrimaryPrice(state, 10);
  assert.equal(state.marketplaces.find((row) => row.id === 'amazon.co.uk').listPrice, 8.25);
  assert.equal(state.primaryListPrice, 10);
});

test('delivery and estimated royalty recalculate with royalty plan', () => {
  const row = { ...MARKETPLACES[0], listPrice: 10 };
  assert.equal(deliveryCost(row, '35', 2), 0);
  assert.equal(estimatedRoyalty(row, '35', 2, false), 3.5);
  assert.equal(deliveryCost(row, '70', 2), 0.3);
  assert.equal(estimatedRoyalty(row, '70', 2, false), 6.79);
});

test('manual overrides survive draft serialization and hydration', () => {
  let state = hydratePricingState(null, { primary_marketplace: 'amazon.com' });
  state = setMarketplacePrice(state, 'amazon.co.uk', 6.49);
  const hydrated = hydratePricingState({ sections: serializePricingState(state) }, { primary_marketplace: 'amazon.com' });
  const uk = hydrated.marketplaces.find((row) => row.id === 'amazon.co.uk');
  assert.equal(uk.listPrice, 6.49);
  assert.equal(uk.manualOverride, true);
});

test('hydration restores primaryListPrice from the primary marketplace row', () => {
  const state = hydratePricingState({ sections: { royalty_and_pricing: {
    primaryMarketplace: 'amazon.com',
    marketplaces: [{ id: 'amazon.com', marketplace: 'Amazon.com', currency: 'USD', listPrice: 6.99 }],
  } } }, { primary_marketplace: 'amazon.com' });
  assert.equal(state.primaryListPrice, 6.99);
  assert.match(validatePricing({ ...state, territoryMode: 'all_territories', royaltyPlan: '70' })['pricing.royalty_and_pricing'], /Amazon\.in/);
});

test('Details book field remains the single authoritative primary marketplace', () => {
  const state = hydratePricingState({ sections: { royalty_and_pricing: { primaryMarketplace: 'amazon.com' } } }, { primary_marketplace: 'amazon.ca' });
  assert.equal(state.primaryMarketplace, 'amazon.ca');
});

test('completion validation rejects missing sections and out-of-band primary prices', () => {
  const blank = hydratePricingState(null, { primary_marketplace: 'amazon.com' });
  assert.deepEqual(Object.keys(validatePricing(blank)).sort(), ['pricing.royalty_and_pricing', 'pricing.territories']);
  const invalid = { ...blank, territoryMode: 'individual_territories', selectedTerritories: [], royaltyPlan: '70', primaryListPrice: 20 };
  assert.deepEqual(Object.keys(validatePricing(invalid)).sort(), ['pricing.royalty_and_pricing', 'pricing.territories']);
  assert.match(validatePricing({ ...blank, territoryMode: 'all_territories', royaltyPlan: '70', primaryListPrice: 25 })['pricing.royalty_and_pricing'], /Amazon\.com/);
});

test('completion validation rejects missing and out-of-band manual marketplace prices', () => {
  let state = { ...hydratePricingState(null, { primary_marketplace: 'amazon.com' }), territoryMode: 'all_territories', royaltyPlan: '35' };
  state = { ...state, primaryListPrice: 25, marketplaces: state.marketplaces.map((row) => ({ ...row, listPrice: Math.max(25, row.limits35[0]) })) };
  assert.equal(validatePricing(state)['pricing.royalty_and_pricing'], undefined);
  state = setMarketplacePrice(state, 'amazon.ca', 500);
  assert.match(validatePricing(state)['pricing.royalty_and_pricing'], /Amazon\.ca/);
});


test('KDP delivery file size rounds up to the nearest kilobyte', () => {
  assert.equal(kdpFileSizeMB(1), 1 / 1024);
  assert.equal(kdpFileSizeMB(1024), 1 / 1024);
  assert.equal(kdpFileSizeMB(1025), 2 / 1024);
  assert.equal(kdpFileSizeMB(null), null);
});

test('70% calculation deducts delivery before applying 70 percent', () => {
  const row = { ...MARKETPLACES.find((market) => market.id === 'amazon.com'), listPrice: 4.99 };
  assert.equal(deliveryCost(row, '70', 1), 0.15);
  assert.equal(estimatedRoyalty(row, '70', 1, false), 3.39);
});

test('KDP Select-gated marketplaces fall back to 35% with no displayed delivery deduction', () => {
  const india = { ...MARKETPLACES.find((market) => market.id === 'amazon.in'), listPrice: 199 };
  assert.equal(effectiveRoyaltyPlan('amazon.in', '70', false), '35');
  assert.equal(deliveryCost(india, effectiveRoyaltyPlan('amazon.in', '70', false), 2), 0);
  assert.equal(estimatedRoyalty(india, '70', 2, false), 69.65);
  assert.equal(effectiveRoyaltyPlan('amazon.in', '70', true), '70');
});

test('serialized marketplace delivery follows the effective royalty plan', () => {
  const base = hydratePricingState(null, { primary_marketplace: 'amazon.com' });
  const state = {
    ...base,
    kdpSelect: false,
    royaltyPlan: '70',
    fileSizeMB: 1,
    primaryListPrice: 4.99,
    marketplaces: base.marketplaces.map((row) => ({
      ...row,
      listPrice: row.id === 'amazon.com' ? 4.99 : row.limits70[0],
    })),
  };
  const serialized = serializePricingState(state).royalty_and_pricing.marketplaces;
  assert.equal(serialized.find((row) => row.id === 'amazon.com').delivery, 0.15);
  assert.equal(serialized.find((row) => row.id === 'amazon.in').delivery, 0);
});
