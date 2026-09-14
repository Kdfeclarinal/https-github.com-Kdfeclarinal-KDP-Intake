import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePricingContract } from '../../../supabase/functions/saveEmployeeStep/_pricingValidation.js';
import { hydratePricingState, MARKETPLACES, serializePricingState } from '../src/pricing/pricingState.js';

function completeState(plan = '35') {
  const state = { ...hydratePricingState(null, { primary_marketplace: 'amazon.com' }), territoryMode: 'all_territories', royaltyPlan: plan, primaryListPrice: plan === '70' ? 9.99 : 25 };
  return { ...state, marketplaces: MARKETPLACES.map((market) => ({ ...market, rate: 1, listPrice: plan === '70' ? market.limits70[0] : Math.max(25, market.limits35[0]), manualOverride: false })).map((row) => row.id === 'amazon.com' ? { ...row, listPrice: state.primaryListPrice } : row) };
}

test('backend Pricing validation rejects invalid royalty, mismatched Details marketplace, and out-of-band rows', () => {
  const valid = serializePricingState(completeState('35'));
  assert.deepEqual(validatePricingContract({ sections: valid }, 'amazon.com'), {});
  assert.ok(validatePricingContract({ sections: { ...valid, primary_marketplace: { value: 'amazon.ca' } } }, 'amazon.com')['pricing.primary_marketplace']);
  const badPlan = structuredClone(valid); badPlan.royalty_and_pricing.royaltyPlan = '99';
  assert.ok(validatePricingContract({ sections: badPlan }, 'amazon.com')['pricing.royalty_and_pricing']);
  const badRow = structuredClone(valid); badRow.royalty_and_pricing.marketplaces.find((row) => row.id === 'amazon.ca').listPrice = 500;
  assert.ok(validatePricingContract({ sections: badRow }, 'amazon.com')['pricing.royalty_and_pricing']);
});

test('backend Pricing validation enforces the 70% band and complete marketplace set', () => {
  const valid = serializePricingState(completeState('70'));
  assert.deepEqual(validatePricingContract({ sections: valid }, 'amazon.com'), {});
  valid.royalty_and_pricing.primaryListPrice = 25;
  valid.royalty_and_pricing.marketplaces.find((row) => row.id === 'amazon.com').listPrice = 25;
  assert.ok(validatePricingContract({ sections: valid }, 'amazon.com')['pricing.royalty_and_pricing']);
  valid.royalty_and_pricing.marketplaces = [];
  assert.ok(validatePricingContract({ sections: valid }, 'amazon.com')['pricing.royalty_and_pricing']);
});
